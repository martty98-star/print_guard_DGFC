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
  const client = new Client({ connectionString: conn, ssl: { rejectUnauthorized: false } });
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
  if (query.printer && query.printer !== 'all') {
    values.push(query.printer);
    where.push(`${map.printerName} = $${values.length}`);
  }
  if (query.result && query.result !== 'all') {
    values.push(query.result);
    where.push(`${map.result} = $${values.length}`);
  }
  return where.length ? `where ${where.join(' and ')}` : '';
}

export async function handler(event) {
  if (event.httpMethod !== "GET") return resp(405, { ok: false, error: "Method not allowed" });

  try {
    const body = await withClient(async client => {
      const cols = await getColumns(client, 'v_print_log_rows');
      const map = {
        readyAt: pick(cols, ['ready_at', 'readyat'], 'readyAt'),
        printerName: pick(cols, ['printer_name', 'printername'], 'printerName'),
        jobName: pick(cols, ['job_name', 'jobname'], 'jobName'),
        result: pick(cols, ['result'], 'result'),
        mediaType: pick(cols, ['media_type', 'mediatype'], 'mediaType'),
        printedArea: pick(cols, ['printed_area', 'printedarea'], 'printedArea'),
        durationSec: pick(cols, ['duration_sec', 'durationsec'], 'durationSec'),
        sourceFile: pick(cols, ['source_file', 'sourcefile'], 'sourceFile'),
      };

      const values = [];
      const where = buildFilters(event.queryStringParameters || {}, map, values);
      const limit = Math.min(Math.max(parseInt(event.queryStringParameters?.limit || '50', 10) || 50, 1), 200);
      const offset = Math.max(parseInt(event.queryStringParameters?.offset || '0', 10) || 0, 0);
      values.push(limit + 1);
      values.push(offset);

      const sql = `
        select
          ${map.readyAt} as "readyAt",
          ${map.printerName} as "printerName",
          ${map.jobName} as "jobName",
          ${map.result} as "result",
          ${map.mediaType} as "mediaType",
          ${map.printedArea} as "printedArea",
          ${map.durationSec} as "durationSec",
          ${map.sourceFile} as "sourceFile"
        from public.v_print_log_rows
        ${where}
        order by ${map.readyAt} desc
        limit $${values.length - 1}
        offset $${values.length}`;

      const rowsRes = await client.query(sql, values);
      const rows = rowsRes.rows.slice(0, limit);
      return {
        ok: true,
        rows,
        limit,
        offset,
        hasMore: rowsRes.rows.length > limit,
      };
    });

    return resp(200, body);
  } catch (e) {
    return resp(500, { ok: false, error: String(e?.message || e) });
  }
}
