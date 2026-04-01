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

// FIX: Use LIMIT 0 query against the view itself instead of information_schema.
// information_schema.columns often returns no rows for views when the DB role
// lacks explicit SELECT grants — reading result.fields[] always works.
async function getColumns(client, tableName) {
  const q = await client.query(
    `select * from public.${tableName} limit 0`
  );
  return new Set(q.fields.map(f => f.name));
}

function pick(cols, candidates, label) {
  for (const name of candidates) {
    if (cols.has(name)) return name;
  }
  throw new Error(
    `Missing ${label} column in v_print_log_rows. ` +
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

function litersExpr(litersColumn, milliLitersColumn) {
  if (litersColumn) return `${litersColumn}`;
  if (milliLitersColumn) return `(${milliLitersColumn} / 1000.0)`;
  return null;
}

function sumExpr(parts) {
  const present = parts.filter(Boolean);
  if (!present.length) return null;
  return present.map(part => `coalesce(${part}, 0)`).join(' + ');
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

      // FIX: map now covers the same extended candidate list as print-log-rows.js
      // to stay consistent and avoid divergence between the two functions.
      const map = {
        readyAt:       pick(cols, ["ready_at", "readyat", "ready_at_utc", "readyAt"], "readyAt"),
        printerName:   pick(cols, ["printer_name", "printername", "printer", "printerName"], "printerName"),
        result:        pick(cols, ["result", "status", "print_result"], "result"),
        printedAreaM2: pick(cols, ["printed_area_m2", "printedaream2", "printed_area", "printedAreaM2", "area_m2"], "printedAreaM2"),
        mediaLengthM:  pick(cols, ["media_length_m", "medialengthm", "media_length", "mediaLengthM", "length_m"], "mediaLengthM"),
        durationSec:   pick(cols, ["duration_sec", "durationsec", "duration", "durationSec", "duration_seconds"], "durationSec"),
        inkTotalL:     pickOptional(cols, ["ink_total_l", "ink_total_liters", "inkTotalL", "total_ink_l"]),
        inkTotalMl:    pickOptional(cols, ["ink_total_ml", "ink_total", "inkTotalMl", "total_ink_ml"]),
        inkCyanL:      pickOptional(cols, ["ink_cyan_l", "inkCyanL"]),
        inkCyan:       pickOptional(cols, ["ink_cyan", "inkcyan"]),
        inkMagentaL:   pickOptional(cols, ["ink_magenta_l", "inkMagentaL"]),
        inkMagenta:    pickOptional(cols, ["ink_magenta", "inkmagenta"]),
        inkYellowL:    pickOptional(cols, ["ink_yellow_l", "inkYellowL"]),
        inkYellow:     pickOptional(cols, ["ink_yellow", "inkyellow"]),
        inkBlackL:     pickOptional(cols, ["ink_black_l", "inkBlackL"]),
        inkBlack:      pickOptional(cols, ["ink_black", "inkblack"]),
        inkWhiteL:     pickOptional(cols, ["ink_white_l", "inkWhiteL"]),
        inkWhite:      pickOptional(cols, ["ink_white", "inkwhite"]),
      };

      const inkCyanExpr = litersExpr(map.inkCyanL, map.inkCyan);
      const inkMagentaExpr = litersExpr(map.inkMagentaL, map.inkMagenta);
      const inkYellowExpr = litersExpr(map.inkYellowL, map.inkYellow);
      const inkBlackExpr = litersExpr(map.inkBlackL, map.inkBlack);
      const inkWhiteExpr = litersExpr(map.inkWhiteL, map.inkWhite);
      const inkTotalExpr =
        litersExpr(map.inkTotalL, map.inkTotalMl) ||
        sumExpr([inkCyanExpr, inkMagentaExpr, inkYellowExpr, inkBlackExpr, inkWhiteExpr]) ||
        "null";

      const values = [];
      const where = buildFilters(event.queryStringParameters || {}, map, values);

      const totalsSql = `
        select
          count(*) filter (where lower(${map.result}) = 'done')::int          as done_jobs,
          count(*) filter (where lower(${map.result}) in ('abrt','aborted'))::int as aborted_jobs,
          count(*) filter (where lower(${map.result}) = 'deleted')::int       as deleted_jobs,
          coalesce(sum(${map.printedAreaM2}), 0)::float8                      as printed_area_m2,
          coalesce(sum(${map.mediaLengthM}), 0)::float8                       as media_length_m,
          coalesce(sum(${inkTotalExpr}), 0)::float8                           as ink_total_l,
          coalesce(sum(${map.durationSec}), 0)::float8                        as total_duration_sec
        from public.v_print_log_rows
        ${where}`;

      const byPrinterSql = `
        select
          ${map.printerName}                                                        as printer_name,
          count(*) filter (where lower(${map.result}) = 'done')::int               as done_jobs,
          coalesce(sum(${map.printedAreaM2}), 0)::float8                           as printed_area_m2,
          coalesce(sum(${map.mediaLengthM}), 0)::float8                            as media_length_m,
          coalesce(sum(${inkTotalExpr}), 0)::float8                                as ink_total_l
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
          doneJobs:     row.done_jobs || 0,
          printedAreaM2: Number(row.printed_area_m2 || 0),
          mediaLengthM:  Number(row.media_length_m  || 0),
          inkTotalL:     Number(row.ink_total_l || 0),
        };
      }

      return {
        ok: true,
        summary: {
          doneJobs:         totals.done_jobs         || 0,
          abortedJobs:      totals.aborted_jobs      || 0,
          deletedJobs:      totals.deleted_jobs      || 0,
          printedAreaM2:    Number(totals.printed_area_m2    || 0),
          mediaLengthM:     Number(totals.media_length_m     || 0),
          inkTotalL:        Number(totals.ink_total_l        || 0),
          inkDataAvailable: inkTotalExpr !== "null",
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
