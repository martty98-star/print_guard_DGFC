import pg from "pg";
const { Client } = pg;

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

async function withClient(run) {
  const conn = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!conn) throw new Error("Missing database connection string");
  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    try { await client.end(); } catch {}
  }
}

async function getColumns(client, tableName) {
  const q = await client.query(`select * from public.${tableName} limit 0`);
  return new Set(q.fields.map((f) => f.name));
}

function pick(cols, candidates, label) {
  for (const name of candidates) {
    if (cols.has(name)) return name;
  }
  throw new Error(
    `Missing ${label} column in print_accounting_rows. ` +
    `Tried: [${candidates.join(", ")}]. ` +
    `Available: [${[...cols].join(", ")}]`
  );
}

function pickOptional(cols, candidates) {
  for (const name of candidates) {
    if (cols.has(name)) return name;
  }
  return null;
}

function buildFilters(query, map, values, arrivalExpr) {
  const where = [];

  if (map.rowType) {
    values.push("print");
    where.push(`${map.rowType} = $${values.length}`);
  }

  if (query.from) {
    values.push(`${query.from}T00:00:00.000Z`);
    where.push(`${arrivalExpr} >= $${values.length}`);
  }

  if (query.to) {
    values.push(`${query.to}T23:59:59.999Z`);
    where.push(`${arrivalExpr} <= $${values.length}`);
  }

  if (query.printer && query.printer !== "all") {
    values.push(query.printer);
    where.push(`${map.printerName} = $${values.length}`);
  }

  if (query.result && query.result !== "all") {
    values.push(query.result);
    where.push(`${map.result} = $${values.length}`);
  }

  return where.length ? `where ${where.join(" and ")}` : "";
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = await withClient(async (client) => {
      const cols = await getColumns(client, "print_accounting_rows");
      const query = event.queryStringParameters || {};

      const map = {
        receptionAt: pickOptional(cols, ["reception_at", "receptionat", "receptionAt"]),
        readyAt: pick(cols, ["ready_at", "readyat", "readyAt"], "readyAt"),
        printerName: pick(cols, ["printer_name", "printername", "printer", "printerName"], "printerName"),
        result: pick(cols, ["result", "status", "print_result"], "result"),
        rowType: pickOptional(cols, ["row_type", "rowtype", "rowType"]),
        jobId: pickOptional(cols, ["job_id", "jobid", "jobId"]),
        jobName: pickOptional(cols, ["job_name", "jobname", "jobName"]),
        sourceFile: pickOptional(cols, ["source_file", "sourcefile", "sourceFile"]),
      };

      const arrivalExpr = map.receptionAt
        ? `coalesce(${map.receptionAt}, ${map.readyAt})`
        : map.readyAt;

      const uniqueJobExpr = map.jobId
        ? `count(distinct ${map.jobId})::int`
        : `count(*)::int`;

      const values = [];
      const where = buildFilters(query, map, values, arrivalExpr);

      const totalsSql = `
        select
          count(*)::int as total_jobs,
          count(*) filter (where lower(${map.result}) = 'done')::int as done_jobs,
          count(*) filter (where lower(${map.result}) in ('abrt', 'aborted'))::int as aborted_jobs,
          count(*) filter (where lower(${map.result}) = 'deleted')::int as deleted_jobs,
          ${uniqueJobExpr} as unique_jobs,
          min(${arrivalExpr}) as first_arrival_at,
          max(${arrivalExpr}) as last_arrival_at
        from public.print_accounting_rows
        ${where}
      `;

      const dailySql = `
        select
          (${arrivalExpr})::date as arrival_date,
          ${map.printerName} as printer_name,
          count(*)::int as total_jobs,
          count(*) filter (where lower(${map.result}) = 'done')::int as done_jobs,
          count(*) filter (where lower(${map.result}) in ('abrt', 'aborted'))::int as aborted_jobs,
          count(*) filter (where lower(${map.result}) = 'deleted')::int as deleted_jobs,
          ${uniqueJobExpr} as unique_jobs,
          min(${arrivalExpr}) as first_arrival_at,
          max(${arrivalExpr}) as last_arrival_at,
          ${map.jobName ? `max(${map.jobName}) as sample_job_name,` : `null::text as sample_job_name,`}
          ${map.sourceFile ? `max(${map.sourceFile}) as sample_source_file` : `null::text as sample_source_file`}
        from public.print_accounting_rows
        ${where}
        group by (${arrivalExpr})::date, ${map.printerName}
        order by (${arrivalExpr})::date desc, ${map.printerName} asc
      `;

      const [totalsRes, dailyRes] = await Promise.all([
        client.query(totalsSql, values),
        client.query(dailySql, values),
      ]);

      const totals = totalsRes.rows[0] || {};

      return {
        ok: true,
        basis: map.receptionAt ? "reception_at_fallback_ready_at" : "ready_at",
        filters: {
          from: query.from || null,
          to: query.to || null,
          printer: query.printer || "all",
          result: query.result || "all",
        },
        totals: {
          totalJobs: totals.total_jobs || 0,
          doneJobs: totals.done_jobs || 0,
          abortedJobs: totals.aborted_jobs || 0,
          deletedJobs: totals.deleted_jobs || 0,
          uniqueJobs: totals.unique_jobs || 0,
          firstArrivalAt: totals.first_arrival_at || null,
          lastArrivalAt: totals.last_arrival_at || null,
        },
        days: (dailyRes.rows || []).map((row) => ({
          arrivalDate: row.arrival_date,
          printerName: row.printer_name,
          totalJobs: row.total_jobs || 0,
          doneJobs: row.done_jobs || 0,
          abortedJobs: row.aborted_jobs || 0,
          deletedJobs: row.deleted_jobs || 0,
          uniqueJobs: row.unique_jobs || 0,
          firstArrivalAt: row.first_arrival_at || null,
          lastArrivalAt: row.last_arrival_at || null,
          sampleJobName: row.sample_job_name || null,
          sampleSourceFile: row.sample_source_file || null,
        })),
        generatedAt: new Date().toISOString(),
      };
    });

    return resp(200, body);
  } catch (e) {
    return resp(500, { ok: false, error: String(e?.message || e) });
  }
}
