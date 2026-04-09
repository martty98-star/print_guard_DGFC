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
  const conn =
    process.env.NETLIFY_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.NEON_DATABASE_URL;
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

// FIX: Use LIMIT 0 query against the view itself instead of information_schema.
// information_schema.columns often returns no rows for views when the DB role
// lacks explicit SELECT grants — reading result.fields[] always works.
async function getColumns(client, tableName) {
  const q = await client.query(
    `select * from public.${tableName} limit 0`
  );
  return new Set(q.fields.map(f => f.name));
}

async function getColumnsSafe(client, tableName) {
  try {
    return await getColumns(client, tableName);
  } catch {
    return null;
  }
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

function microLitersExpr(rawUnitsColumn) {
  if (!rawUnitsColumn) return null;
  return `(${rawUnitsColumn} / 1000000.0)`;
}

function sumExpr(parts) {
  const present = parts.filter(Boolean);
  if (!present.length) return null;
  return present.map(part => `coalesce(${part}, 0)`).join(' + ');
}

function buildInkExpressions(map) {
  const inkCyanExpr = litersExpr(map.inkCyanL, map.inkCyan);
  const inkMagentaExpr = litersExpr(map.inkMagentaL, map.inkMagenta);
  const inkYellowExpr = litersExpr(map.inkYellowL, map.inkYellow);
  const inkBlackExpr = litersExpr(map.inkBlackL, map.inkBlack);
  const inkWhiteExpr = litersExpr(map.inkWhiteL, map.inkWhite);
  const inkTotalExpr =
    litersExpr(map.inkTotalL, map.inkTotalMl) ||
    sumExpr([inkCyanExpr, inkMagentaExpr, inkYellowExpr, inkBlackExpr, inkWhiteExpr]) ||
    "null";

  return {
    inkCyanExpr,
    inkMagentaExpr,
    inkYellowExpr,
    inkBlackExpr,
    inkWhiteExpr,
    inkTotalExpr,
  };
}

function buildInkPresenceExpr(inkExprs) {
  const candidates = [
    inkExprs?.inkTotalExpr,
    inkExprs?.inkCyanExpr,
    inkExprs?.inkMagentaExpr,
    inkExprs?.inkYellowExpr,
    inkExprs?.inkBlackExpr,
    inkExprs?.inkWhiteExpr,
  ].filter(expr => expr && expr !== "null");

  if (!candidates.length) return "0";
  return `case when ${candidates.map(expr => `${expr} is not null`).join(" or ")} then 1 else 0 end`;
}

function buildInkChannelPresenceExpr(inkExprs) {
  const candidates = [
    inkExprs?.inkCyanExpr,
    inkExprs?.inkMagentaExpr,
    inkExprs?.inkYellowExpr,
    inkExprs?.inkBlackExpr,
    inkExprs?.inkWhiteExpr,
  ].filter(expr => expr && expr !== "null");

  if (!candidates.length) return "0";
  return `case when ${candidates.map(expr => `${expr} is not null`).join(" or ")} then 1 else 0 end`;
}

function buildAccountingInkExpressions(map) {
  // print_accounting_rows stores raw CSV channel counters as printer micro-liter units.
  const inkCyanExpr = map.inkCyanL ? `${map.inkCyanL}` : microLitersExpr(map.inkCyan);
  const inkMagentaExpr = map.inkMagentaL ? `${map.inkMagentaL}` : microLitersExpr(map.inkMagenta);
  const inkYellowExpr = map.inkYellowL ? `${map.inkYellowL}` : microLitersExpr(map.inkYellow);
  const inkBlackExpr = map.inkBlackL ? `${map.inkBlackL}` : microLitersExpr(map.inkBlack);
  const inkWhiteExpr = map.inkWhiteL ? `${map.inkWhiteL}` : microLitersExpr(map.inkWhite);
  const inkTotalExpr =
    litersExpr(map.inkTotalL, map.inkTotalMl) ||
    sumExpr([inkCyanExpr, inkMagentaExpr, inkYellowExpr, inkBlackExpr, inkWhiteExpr]) ||
    "null";

  return {
    inkCyanExpr,
    inkMagentaExpr,
    inkYellowExpr,
    inkBlackExpr,
    inkWhiteExpr,
    inkTotalExpr,
  };
}

function coalesceExpr(primaryExpr, fallbackExpr) {
  if (!primaryExpr) return fallbackExpr;
  if (!fallbackExpr || fallbackExpr === "null") return primaryExpr;
  return `coalesce(${primaryExpr}, ${fallbackExpr})`;
}

function buildAccountingInkJoin(query, viewMap, accountingCols, values) {
  if (!accountingCols) return null;

  const accountingMap = {
    readyAt:       pick(accountingCols, ["ready_at", "readyat", "ready_at_utc", "readyAt"], "accounting.readyAt"),
    printerName:   pick(accountingCols, ["printer_name", "printername", "printer", "printerName"], "accounting.printerName"),
    result:        pick(accountingCols, ["result", "status", "print_result"], "accounting.result"),
    jobId:         pickOptional(accountingCols, ["job_id", "jobid", "jobId"]),
    rowType:       pickOptional(accountingCols, ["row_type", "rowtype", "rowType"]),
    inkTotalL:     pickOptional(accountingCols, ["ink_total_l", "ink_total_liters", "inkTotalL", "total_ink_l"]),
    inkTotalMl:    pickOptional(accountingCols, ["ink_total_ml", "ink_total", "inkTotalMl", "total_ink_ml"]),
    inkCyanL:      pickOptional(accountingCols, ["ink_cyan_l", "inkCyanL"]),
    inkCyan:       pickOptional(accountingCols, ["ink_cyan", "inkcyan"]),
    inkMagentaL:   pickOptional(accountingCols, ["ink_magenta_l", "inkMagentaL"]),
    inkMagenta:    pickOptional(accountingCols, ["ink_magenta", "inkmagenta"]),
    inkYellowL:    pickOptional(accountingCols, ["ink_yellow_l", "inkYellowL"]),
    inkYellow:     pickOptional(accountingCols, ["ink_yellow", "inkyellow"]),
    inkBlackL:     pickOptional(accountingCols, ["ink_black_l", "inkBlackL"]),
    inkBlack:      pickOptional(accountingCols, ["ink_black", "inkblack"]),
    inkWhiteL:     pickOptional(accountingCols, ["ink_white_l", "inkWhiteL"]),
    inkWhite:      pickOptional(accountingCols, ["ink_white", "inkwhite"]),
  };

  const inkExprs = buildAccountingInkExpressions(accountingMap);
  if (inkExprs.inkTotalExpr === "null") return null;

  const accountingWhere = buildFilters(query, accountingMap, values);
  const selectParts = [
    `${accountingMap.readyAt} as "_readyAt"`,
    `${accountingMap.printerName} as "_printerName"`,
    `${accountingMap.result} as "_result"`,
  ];
  const groupByParts = [
    accountingMap.readyAt,
    accountingMap.printerName,
    accountingMap.result,
  ];
  const joinParts = [
    `a."_readyAt" = ${viewMap.readyAt}`,
    `a."_printerName" = ${viewMap.printerName}`,
    `a."_result" is not distinct from ${viewMap.result}`,
  ];

  if (viewMap.jobId && accountingMap.jobId) {
    selectParts.push(`${accountingMap.jobId} as "_jobId"`);
    groupByParts.push(accountingMap.jobId);
    joinParts.push(`a."_jobId" is not distinct from ${viewMap.jobId}`);
  }

  if (viewMap.rowType && accountingMap.rowType) {
    selectParts.push(`${accountingMap.rowType} as "_rowType"`);
    groupByParts.push(accountingMap.rowType);
    joinParts.push(`a."_rowType" is not distinct from ${viewMap.rowType}`);
  }

  selectParts.push(
    `coalesce(sum(${inkExprs.inkTotalExpr}), 0)::float8 as ink_total_l`,
    `coalesce(sum(${inkExprs.inkCyanExpr || "0::float8"}), 0)::float8 as ink_cyan_l`,
    `coalesce(sum(${inkExprs.inkMagentaExpr || "0::float8"}), 0)::float8 as ink_magenta_l`,
    `coalesce(sum(${inkExprs.inkYellowExpr || "0::float8"}), 0)::float8 as ink_yellow_l`,
    `coalesce(sum(${inkExprs.inkBlackExpr || "0::float8"}), 0)::float8 as ink_black_l`,
    `coalesce(sum(${inkExprs.inkWhiteExpr || "0::float8"}), 0)::float8 as ink_white_l`
  );

  return {
    sql: `
      left join (
        select
          ${selectParts.join(",\n          ")}
        from public.print_accounting_rows
        ${accountingWhere}
        group by ${groupByParts.join(", ")}
      ) a on ${joinParts.join(" and ")}
    `,
    inkTotalExpr: `a.ink_total_l`,
    inkCyanExpr: `a.ink_cyan_l`,
    inkMagentaExpr: `a.ink_magenta_l`,
    inkYellowExpr: `a.ink_yellow_l`,
    inkBlackExpr: `a.ink_black_l`,
    inkWhiteExpr: `a.ink_white_l`,
  };
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

function buildSourceFilters(query, values, { readyExpr, printerExpr, resultExpr, rowTypeExpr, onlyPrintRows }) {
  const where = [];

  if (onlyPrintRows && rowTypeExpr) {
    values.push("print");
    where.push(`${rowTypeExpr} = $${values.length}`);
  }

  if (query.from) {
    values.push(`${query.from}T00:00:00.000Z`);
    where.push(`${readyExpr} >= $${values.length}`);
  }

  if (query.to) {
    values.push(`${query.to}T23:59:59.999Z`);
    where.push(`${readyExpr} <= $${values.length}`);
  }

  if (query.printer && query.printer !== "all") {
    values.push(query.printer);
    where.push(`${printerExpr} = $${values.length}`);
  }

  if (query.result && query.result !== "all") {
    values.push(query.result);
    where.push(`${resultExpr} = $${values.length}`);
  }

  return where.length ? `where ${where.join(" and ")}` : "";
}

function squareMetersExpr(squareMetersColumn, rawMm2Column) {
  if (squareMetersColumn) return `${squareMetersColumn}`;
  if (rawMm2Column) return `(${rawMm2Column} / 1000000.0)`;
  return "null";
}

function metersExpr(metersColumn, rawMmColumn) {
  if (metersColumn) return `${metersColumn}`;
  // Colorado accounting raw media_length_used is stored in 1e-5 meters.
  if (rawMmColumn) return `(${rawMmColumn} / 100000.0)`;
  return "null";
}

function buildDurationValueExpr(durationExpr, activeTimeExpr) {
  const candidates = [];

  if (activeTimeExpr && activeTimeExpr !== "null") {
    candidates.push(`case when ${activeTimeExpr} >= 0 and ${activeTimeExpr} <= 86400 then ${activeTimeExpr} end`);
  }
  if (durationExpr && durationExpr !== "null") {
    candidates.push(`case when ${durationExpr} >= 0 and ${durationExpr} <= 86400 then ${durationExpr} end`);
  }

  if (!candidates.length) return "null";
  return `coalesce(${candidates.join(", ")})`;
}

function buildLogicalJobExpr(map, readyExpr) {
  const candidates = [];
  if (map.jobId) candidates.push(`${map.jobId}::text`);
  if (map.documentId) candidates.push(`${map.documentId}::text`);
  if (map.jobName) candidates.push(`${map.jobName}::text`);
  candidates.push(`coalesce(${readyExpr}::text, '')`);
  return `coalesce(${candidates.join(", ")})`;
}

function buildSourcePriorityExpr(sourceFileExpr, preferredRank) {
  if (preferredRank) return `${preferredRank}`;
  if (!sourceFileExpr) return "0";
  return `
    case
      when lower(coalesce(${sourceFileExpr}::text, '')) like '%.csv' then 2
      when lower(coalesce(${sourceFileExpr}::text, '')) like '%.acl' then 1
      else 0
    end
  `;
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return resp(405, { ok: false, error: "Method not allowed" });
  }

  try {
    const body = await withClient(async client => {
      const cols = await getColumns(client, "v_print_log_rows");
      const accountingCols = await getColumnsSafe(client, "print_accounting_rows");

      const map = {
        readyAt:       pick(cols, ["ready_at", "readyat", "ready_at_utc", "readyAt"], "readyAt"),
        printerName:   pick(cols, ["printer_name", "printername", "printer", "printerName"], "printerName"),
        jobName:       pickOptional(cols, ["job_name", "jobname", "job", "jobName", "title"]),
        result:        pick(cols, ["result", "status", "print_result"], "result"),
        jobId:         pickOptional(cols, ["job_id", "jobid", "jobId"]),
        documentId:    pickOptional(cols, ["document_id", "documentid", "documentId"]),
        rowType:       pickOptional(cols, ["row_type", "rowtype", "rowType"]),
        sourceFile:    pickOptional(cols, ["source_file", "sourcefile", "source", "sourceFile", "file_name", "filename"]),
        printedAreaM2: pick(cols, ["printed_area_m2", "printedaream2", "printed_area", "printedAreaM2", "area_m2"], "printedAreaM2"),
        mediaLengthM:  pick(cols, ["media_length_m", "medialengthm", "media_length", "mediaLengthM", "length_m"], "mediaLengthM"),
        durationSec:   pick(cols, ["duration_sec", "durationsec", "duration", "durationSec", "duration_seconds"], "durationSec"),
        activeTimeSec: pickOptional(cols, ["active_time_sec", "activetime_sec", "activeTimeSec", "active_seconds"]),
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

      const query = event.queryStringParameters || {};
      const values = [];

      let accountingMap = null;
      if (accountingCols) {
        try {
          accountingMap = {
            readyAt:         pick(accountingCols, ["ready_at", "readyat", "ready_at_utc", "readyAt"], "accounting.readyAt"),
            printerName:     pick(accountingCols, ["printer_name", "printername", "printer", "printerName"], "accounting.printerName"),
            jobName:         pickOptional(accountingCols, ["job_name", "jobname", "job", "jobName", "title"]),
            result:          pick(accountingCols, ["result", "status", "print_result"], "accounting.result"),
            jobId:           pickOptional(accountingCols, ["job_id", "jobid", "jobId"]),
            documentId:      pickOptional(accountingCols, ["document_id", "documentid", "documentId"]),
            rowType:         pickOptional(accountingCols, ["row_type", "rowtype", "rowType"]),
            sourceFile:      pickOptional(accountingCols, ["source_file", "sourcefile", "sourceFile"]),
            printedAreaM2:   pickOptional(accountingCols, ["printed_area_m2", "printedaream2", "printed_area_metric", "printedAreaM2"]),
            printedAreaRaw:  pickOptional(accountingCols, ["printed_area", "printedarea"]),
            mediaLengthM:    pickOptional(accountingCols, ["media_length_m", "medialengthm", "media_length_metric", "mediaLengthM"]),
            mediaLengthRaw:  pickOptional(accountingCols, ["media_length_used", "medialengthused"]),
            durationSec:     pickOptional(accountingCols, ["duration_sec", "durationsec", "duration", "durationSec", "duration_seconds"]),
            activeTimeSec:   pickOptional(accountingCols, ["active_time_sec", "activetime_sec", "activeTimeSec", "active_seconds"]),
            importedAt:      pickOptional(accountingCols, ["imported_at", "importedat", "importedAt"]),
            inkTotalL:       pickOptional(accountingCols, ["ink_total_l", "ink_total_liters", "inkTotalL", "total_ink_l"]),
            inkTotalMl:      pickOptional(accountingCols, ["ink_total_ml", "ink_total", "inkTotalMl", "total_ink_ml"]),
            inkCyanL:        pickOptional(accountingCols, ["ink_cyan_l", "inkCyanL"]),
            inkCyan:         pickOptional(accountingCols, ["ink_cyan", "inkcyan"]),
            inkMagentaL:     pickOptional(accountingCols, ["ink_magenta_l", "inkMagentaL"]),
            inkMagenta:      pickOptional(accountingCols, ["ink_magenta", "inkmagenta"]),
            inkYellowL:      pickOptional(accountingCols, ["ink_yellow_l", "inkYellowL"]),
            inkYellow:       pickOptional(accountingCols, ["ink_yellow", "inkyellow"]),
            inkBlackL:       pickOptional(accountingCols, ["ink_black_l", "inkBlackL"]),
            inkBlack:        pickOptional(accountingCols, ["ink_black", "inkblack"]),
            inkWhiteL:       pickOptional(accountingCols, ["ink_white_l", "inkWhiteL"]),
            inkWhite:        pickOptional(accountingCols, ["ink_white", "inkwhite"]),
          };
        } catch {
          accountingMap = null;
        }
      }

      const viewWhere = buildSourceFilters(query, values, {
        readyExpr: map.readyAt,
        printerExpr: map.printerName,
        resultExpr: map.result,
        rowTypeExpr: map.rowType,
        onlyPrintRows: false,
      });
      const accountingWhere = accountingMap
        ? buildSourceFilters(query, values, {
            readyExpr: accountingMap.readyAt,
            printerExpr: accountingMap.printerName,
            resultExpr: accountingMap.result,
            rowTypeExpr: accountingMap.rowType,
            onlyPrintRows: true,
          })
        : "where false";

      const viewInk = buildInkExpressions(map);
      const viewHasInkExpr = buildInkPresenceExpr(viewInk);
      const viewHasInkChannelsExpr = buildInkChannelPresenceExpr(viewInk);
      const viewSourceFileExpr = map.sourceFile ? `${map.sourceFile}` : "null::text";
      const viewLogicalJobExpr = buildLogicalJobExpr(map, map.readyAt);

      const accountingInk = accountingMap
        ? buildAccountingInkExpressions(accountingMap)
        : null;
      const accountingHasInkExpr = buildInkPresenceExpr(accountingInk);
      const accountingHasInkChannelsExpr = buildInkChannelPresenceExpr(accountingInk);
      const accountingSourceFileExpr = accountingMap?.sourceFile ? `${accountingMap.sourceFile}` : "null::text";
      const accountingLogicalJobExpr = accountingMap
        ? buildLogicalJobExpr(accountingMap, accountingMap.readyAt)
        : "null::text";
      const accountingAreaExpr = accountingMap
        ? squareMetersExpr(accountingMap.printedAreaM2, accountingMap.printedAreaRaw)
        : "null";
      const accountingLengthExpr = accountingMap
        ? metersExpr(accountingMap.mediaLengthM, accountingMap.mediaLengthRaw)
        : "null";
      const viewDurationExpr = buildDurationValueExpr(
        map.durationSec ? `${map.durationSec}` : "null",
        map.activeTimeSec ? `${map.activeTimeSec}` : "null"
      );
      const accountingDurationExpr = buildDurationValueExpr(
        accountingMap?.durationSec ? `${accountingMap.durationSec}` : "null",
        accountingMap?.activeTimeSec ? `${accountingMap.activeTimeSec}` : "null"
      );

      const mergedSql = `
        with merged_rows as (
          select
            ${map.readyAt} as ready_at,
            ${map.printerName} as printer_name,
            ${map.result} as result,
            ${map.printedAreaM2}::float8 as printed_area_m2,
            ${map.mediaLengthM}::float8 as media_length_m,
            ${viewDurationExpr}::float8 as duration_sec,
            ${viewInk.inkTotalExpr === "null" ? "null" : `${viewInk.inkTotalExpr}`}::float8 as ink_total_l,
            ${(viewInk.inkCyanExpr || "null")}::float8 as ink_cyan_l,
            ${(viewInk.inkMagentaExpr || "null")}::float8 as ink_magenta_l,
            ${(viewInk.inkYellowExpr || "null")}::float8 as ink_yellow_l,
            ${(viewInk.inkBlackExpr || "null")}::float8 as ink_black_l,
            ${(viewInk.inkWhiteExpr || "null")}::float8 as ink_white_l,
            ${viewHasInkExpr} as has_ink_data,
            ${viewHasInkChannelsExpr} as has_ink_channels,
            ${viewLogicalJobExpr} as logical_job_key,
            3 as source_rank,
            null::timestamptz as imported_at
          from public.v_print_log_rows
          ${viewWhere}
          ${accountingMap ? `
          union all
          select
            ${accountingMap.readyAt} as ready_at,
            ${accountingMap.printerName} as printer_name,
            ${accountingMap.result} as result,
            ${accountingAreaExpr}::float8 as printed_area_m2,
            ${accountingLengthExpr}::float8 as media_length_m,
            ${accountingDurationExpr}::float8 as duration_sec,
            ${accountingInk?.inkTotalExpr === "null" ? "null" : `${accountingInk?.inkTotalExpr || "null"}`}::float8 as ink_total_l,
            ${(accountingInk?.inkCyanExpr || "null")}::float8 as ink_cyan_l,
            ${(accountingInk?.inkMagentaExpr || "null")}::float8 as ink_magenta_l,
            ${(accountingInk?.inkYellowExpr || "null")}::float8 as ink_yellow_l,
            ${(accountingInk?.inkBlackExpr || "null")}::float8 as ink_black_l,
            ${(accountingInk?.inkWhiteExpr || "null")}::float8 as ink_white_l,
            ${accountingHasInkExpr} as has_ink_data,
            ${accountingHasInkChannelsExpr} as has_ink_channels,
            ${accountingLogicalJobExpr} as logical_job_key,
            ${buildSourcePriorityExpr(accountingSourceFileExpr)} as source_rank,
            ${accountingMap.importedAt ? `${accountingMap.importedAt}` : "null::timestamptz"} as imported_at
          from public.print_accounting_rows
          ${accountingWhere}` : ""}
        ),
        ranked as (
          select
            *,
            row_number() over (
              partition by printer_name, logical_job_key, lower(result), ready_at
              order by has_ink_channels desc, has_ink_data desc, source_rank desc, imported_at desc nulls last, ready_at desc nulls last
            ) as source_rn
          from merged_rows
        )
      `;

      const totalsSql = `
        ${mergedSql}
        select
          count(*) filter (where lower(result) = 'done')::int          as done_jobs,
          count(*) filter (where lower(result) in ('abrt','aborted'))::int as aborted_jobs,
          count(*) filter (where lower(result) = 'deleted')::int       as deleted_jobs,
          coalesce(sum(printed_area_m2), 0)::float8                    as printed_area_m2,
          coalesce(sum(media_length_m), 0)::float8                     as media_length_m,
          coalesce(sum(ink_total_l), 0)::float8                        as ink_total_l,
          coalesce(sum(ink_cyan_l), 0)::float8                         as ink_cyan_l,
          coalesce(sum(ink_magenta_l), 0)::float8                      as ink_magenta_l,
          coalesce(sum(ink_yellow_l), 0)::float8                       as ink_yellow_l,
          coalesce(sum(ink_black_l), 0)::float8                        as ink_black_l,
          coalesce(sum(ink_white_l), 0)::float8                        as ink_white_l,
          coalesce(sum(duration_sec), 0)::float8                       as total_duration_sec
        from ranked
        where source_rn = 1`;

      const byPrinterSql = `
        ${mergedSql}
        select
          printer_name,
          count(*) filter (where lower(result) = 'done')::int               as done_jobs,
          coalesce(sum(printed_area_m2), 0)::float8                         as printed_area_m2,
          coalesce(sum(media_length_m), 0)::float8                          as media_length_m,
          coalesce(sum(ink_total_l), 0)::float8                             as ink_total_l,
          coalesce(sum(ink_cyan_l), 0)::float8                              as ink_cyan_l,
          coalesce(sum(ink_magenta_l), 0)::float8                           as ink_magenta_l,
          coalesce(sum(ink_yellow_l), 0)::float8                            as ink_yellow_l,
          coalesce(sum(ink_black_l), 0)::float8                             as ink_black_l,
          coalesce(sum(ink_white_l), 0)::float8                             as ink_white_l
        from ranked
        where source_rn = 1
        group by printer_name`;

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
          inkCyanL:      Number(row.ink_cyan_l || 0),
          inkMagentaL:   Number(row.ink_magenta_l || 0),
          inkYellowL:    Number(row.ink_yellow_l || 0),
          inkBlackL:     Number(row.ink_black_l || 0),
          inkWhiteL:     Number(row.ink_white_l || 0),
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
          inkCyanL:         Number(totals.ink_cyan_l         || 0),
          inkMagentaL:      Number(totals.ink_magenta_l      || 0),
          inkYellowL:       Number(totals.ink_yellow_l       || 0),
          inkBlackL:        Number(totals.ink_black_l        || 0),
          inkWhiteL:        Number(totals.ink_white_l        || 0),
          inkDataAvailable: true,
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
