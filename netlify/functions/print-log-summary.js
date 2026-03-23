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
  const conn = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL;
  if (!conn) throw new Error("Missing NETLIFY_DATABASE_URL");
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
  const q = await client.query(
    `select column_name
       from information_schema.columns
      where table_schema = 'public'
        and table_name = $1`,
    [tableName]
  );
  return new Set(q.rows.map(r => r.column_name));
}

function pick(cols, candidates, label) {
  for (const name of candidates) {
    if (cols.has(name)) return name;
  }
  throw new Error(`Missing ${label} column in v_print_log_rows`);
}

function buildFilters(query, map, values) {
  const where = [];

  if (query.from) {
    values.push(`${query.from}T00:00:00.000Z`);
    where.push(`${map.readyAt} >= $${values.length}`);
  }

  if (query.to) {
    values.push(`${query.to}T23:59:59.999Z`);
    where.push(`${map.readyAt} <= $${values.length}`);
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
    const body = await withClient(async client => {
      const cols = await getColumns(client, "v_print_log_rows");

      const map = {
        readyAt: pick(cols, ["ready_at", "readyat"], "readyAt"),
        printerName: pick(cols, ["printer_name", "printername"], "printerName"),
        result: pick(cols, ["result"], "result"),
        printedAreaM2: pick(cols, ["printed_area_m2", "printedaream2"], "printedAreaM2"),
        mediaLengthM: pick(cols, ["media_length_m", "medialengthm"], "mediaLengthM"),
        durationSec: pick(cols, ["duration_sec", "durationsec"], "durationSec"),
      };

      const values = [];
      const where = buildFilters(event.queryStringParameters || {}, map, values);

      const totalsSql = `
        select
          count(*) filter (where lower(${map.result}) = 'done')::int as done_jobs,
          count(*) filter (where lower(${map.result}) in ('abrt', 'aborted'))::int as aborted_jobs,
          count(*) filter (where lower(${map.result}) = 'deleted')::int as deleted_jobs,
          coalesce(sum(${map.printedAreaM2}), 0)::float8 as printed_area_m2,
          coalesce(sum(${map.mediaLengthM}), 0)::float8 as media_length_m,
          coalesce(sum(${map.durationSec}), 0)::float8 as total_duration_sec
        from public.v_print_log_rows
        ${where}`;

      const byPrinterSql = `
        select
          ${map.printerName} as printer_name,
          count(*) filter (where lower(${map.result}) = 'done')::int as done_jobs,
          coalesce(sum(${map.printedAreaM2}), 0)::float8 as printed_area_m2,
          coalesce(sum(${map.mediaLengthM}), 0)::float8 as media_length_m
        from public.v_print_log_rows
        ${where}
        group by ${map.printerName}`;

      const [totalsRes, printersRes] = await Promise.all([
        client.query(totalsSql, values),
        client.query(byPrinterSql, values),
      ]);

      const totals = totalsRes.rows[0] || {};
      const byPrinter = {};

      for (const row of printersRes.rows) {
        byPrinter[row.printer_name] = {
          doneJobs: row.done_jobs || 0,
          printedAreaM2: Number(row.printed_area_m2 || 0),
          mediaLengthM: Number(row.media_length_m || 0),
        };
      }

      return {
        ok: true,
        summary: {
          doneJobs: totals.done_jobs || 0,
          abortedJobs: totals.aborted_jobs || 0,
          deletedJobs: totals.deleted_jobs || 0,
          printedAreaM2: Number(totals.printed_area_m2 || 0),
          mediaLengthM: Number(totals.media_length_m || 0),
          totalDurationSec: Number(totals.total_duration_sec || 0),
          byPrinter,
        },
        generatedAt: new Date().toISOString(),
      };
    });

    return resp(200, body);
  } catch (e) {
    return resp(500, { ok: false, error: String(e?.message || e) });
  }
}
