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

function buildLogicalJobExpr(map, arrivalExpr) {
  const candidates = [];

  if (map.jobId) candidates.push(`${map.jobId}::text`);
  if (map.documentId) candidates.push(`${map.documentId}::text`);
  if (map.jobName) candidates.push(`${map.jobName}::text`);

  candidates.push(`coalesce(${arrivalExpr}::text, '')`);
  return `coalesce(${candidates.join(", ")})`;
}

function buildSourcePriorityExpr(map) {
  if (!map.sourceFile) return "0";
  return `
    case
      when lower(${map.sourceFile}) like '%.csv' then 2
      when lower(${map.sourceFile}) like '%.acl' then 1
      else 0
    end
  `;
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
        documentId: pickOptional(cols, ["document_id", "documentid", "documentId"]),
        jobName: pickOptional(cols, ["job_name", "jobname", "jobName"]),
        sourceFile: pickOptional(cols, ["source_file", "sourcefile", "sourceFile"]),
        importedAt: pickOptional(cols, ["imported_at", "importedat", "importedAt"]),
      };

      const arrivalExpr = map.receptionAt
        ? `coalesce(${map.receptionAt}, ${map.readyAt})`
        : map.readyAt;
      const logicalJobExpr = buildLogicalJobExpr(map, arrivalExpr);
      const sourcePriorityExpr = buildSourcePriorityExpr(map);

      const values = [];
      const where = buildFilters(query, map, values, arrivalExpr);
      const baseSql = `
        with ranked as (
          select
            ${arrivalExpr} as arrival_at,
            ${map.printerName} as printer_name,
            ${map.result} as result,
            ${logicalJobExpr} as logical_job_key,
            ${map.jobName ? `${map.jobName} as job_name,` : `null::text as job_name,`}
            ${map.sourceFile ? `${map.sourceFile} as source_file,` : `null::text as source_file,`}
            row_number() over (
              partition by
                ${map.printerName},
                ${logicalJobExpr},
                lower(${map.result}),
                ${arrivalExpr}
              order by
                ${sourcePriorityExpr} desc,
                ${map.importedAt ? `${map.importedAt} desc nulls last,` : ``}
                ${arrivalExpr} desc nulls last
            ) as source_rn
          from public.print_accounting_rows
          ${where}
        )
      `;

      const totalsSql = `
        ${baseSql}
        select
          count(*)::int as total_jobs,
          count(*) filter (where lower(result) = 'done')::int as done_jobs,
          count(*) filter (where lower(result) in ('abrt', 'aborted'))::int as aborted_jobs,
          count(*) filter (where lower(result) = 'deleted')::int as deleted_jobs,
          count(distinct logical_job_key)::int as unique_jobs,
          min(arrival_at) as first_arrival_at,
          max(arrival_at) as last_arrival_at
        from ranked
        where source_rn = 1
      `;

      const dailySql = `
        ${baseSql}
        select
          arrival_at::date as arrival_date,
          printer_name,
          count(*)::int as total_jobs,
          count(*) filter (where lower(result) = 'done')::int as done_jobs,
          count(*) filter (where lower(result) in ('abrt', 'aborted'))::int as aborted_jobs,
          count(*) filter (where lower(result) = 'deleted')::int as deleted_jobs,
          count(distinct logical_job_key)::int as unique_jobs,
          min(arrival_at) as first_arrival_at,
          max(arrival_at) as last_arrival_at,
          max(job_name) as sample_job_name,
          max(source_file) as sample_source_file
        from ranked
        where source_rn = 1
        group by arrival_at::date, printer_name
        order by arrival_at::date desc, printer_name asc
      `;

      const [totalsRes, dailyRes] = await Promise.all([
        client.query(totalsSql, values),
        client.query(dailySql, values),
      ]);

      const totals = totalsRes.rows[0] || {};

      return {
        ok: true,
        basis: map.receptionAt ? "reception_at_fallback_ready_at" : "ready_at",
        dedupe: "logical_job_prefer_csv_over_acl",
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
