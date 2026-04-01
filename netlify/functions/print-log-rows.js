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
  const q = await client.query(`select * from public.${tableName} limit 0`);
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

      const map = {
        readyAt:       pick(cols, ["ready_at", "readyat", "ready_at_utc", "readyAt"], "readyAt"),
        printerName:   pick(cols, ["printer_name", "printername", "printer", "printerName"], "printerName"),
        jobName:       pick(cols, ["job_name", "jobname", "job", "jobName", "title"], "jobName"),
        result:        pick(cols, ["result", "status", "print_result"], "result"),
        mediaType:     pick(cols, ["media_type", "mediatype", "media", "mediaType", "medium"], "mediaType"),
        printedAreaM2: pick(cols, ["printed_area_m2", "printedaream2", "printed_area", "printedAreaM2", "area_m2"], "printedAreaM2"),
        mediaLengthM:  pick(cols, ["media_length_m", "medialengthm", "media_length", "mediaLengthM", "length_m"], "mediaLengthM"),
        durationSec:   pick(cols, ["duration_sec", "durationsec", "duration", "durationSec", "duration_seconds"], "durationSec"),
        sourceFile:    pickOptional(cols, ["source_file", "sourcefile", "source", "sourceFile", "file_name", "filename"]),
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
      const limit = Math.min(
        Math.max(parseInt(event.queryStringParameters?.limit || "50", 10) || 50, 1),
        200
      );
      const offset = Math.max(
        parseInt(event.queryStringParameters?.offset || "0", 10) || 0,
        0
      );
      values.push(limit + 1);
      const limitParam = values.length;
      values.push(offset);
      const offsetParam = values.length;

      const sourceFileSelect = map.sourceFile
        ? `${map.sourceFile} as "sourceFile"`
        : `null as "sourceFile"`;

      const sql = `
        select
          ${map.readyAt}       as "readyAt",
          ${map.printerName}   as "printerName",
          ${map.jobName}       as "jobName",
          ${map.result}        as "result",
          ${map.mediaType}     as "mediaType",
          ${map.printedAreaM2} as "printedAreaM2",
          ${map.mediaLengthM}  as "mediaLengthM",
          ${map.durationSec}   as "durationSec",
          ${sourceFileSelect},
          ${inkTotalExpr} as "inkTotalL",
          ${inkCyanExpr || "null"} as "inkCyanL",
          ${inkMagentaExpr || "null"} as "inkMagentaL",
          ${inkYellowExpr || "null"} as "inkYellowL",
          ${inkBlackExpr || "null"} as "inkBlackL",
          ${inkWhiteExpr || "null"} as "inkWhiteL"
        from public.v_print_log_rows
        ${where}
        order by ${map.readyAt} desc
        limit $${limitParam}
        offset $${offsetParam}`;

      const rowsRes = await client.query(sql, values);
      const fetchedRows = rowsRes.rows || [];
      const hasMore = fetchedRows.length > limit;
      const visibleRows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;

      return {
        ok: true,
        rows: visibleRows.map(row => ({
          readyAt: row.readyAt,
          printerName: row.printerName,
          jobName: row.jobName,
          result: row.result,
          mediaType: row.mediaType,
          printedAreaM2: row.printedAreaM2 == null ? null : Number(row.printedAreaM2),
          mediaLengthM: row.mediaLengthM == null ? null : Number(row.mediaLengthM),
          durationSec: row.durationSec == null ? null : Number(row.durationSec),
          inkTotalL: row.inkTotalL == null ? null : Number(row.inkTotalL),
          inkCyanL: row.inkCyanL == null ? null : Number(row.inkCyanL),
          inkMagentaL: row.inkMagentaL == null ? null : Number(row.inkMagentaL),
          inkYellowL: row.inkYellowL == null ? null : Number(row.inkYellowL),
          inkBlackL: row.inkBlackL == null ? null : Number(row.inkBlackL),
          inkWhiteL: row.inkWhiteL == null ? null : Number(row.inkWhiteL),
          sourceFile: row.sourceFile ?? null,
          source_file: row.sourceFile ?? null,
        })),
        limit,
        offset,
        hasMore,
      };
    });

    return resp(200, body);
  } catch (e) {
    return resp(500, { ok: false, error: String(e?.message || e) });
  }
}
