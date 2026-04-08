const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;

  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key]) continue;

    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function preloadEnv() {
  const candidates = [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), ".env.local"),
    path.resolve("C:/PrintGuard/.env"),
    path.resolve("C:/PrintGuard/.env.local"),
    path.resolve("C:/PrintGuard/print_guard_DGFC/.env"),
    path.resolve("C:/PrintGuard/print_guard_DGFC/.env.local"),
    path.resolve(__dirname, ".env"),
    path.resolve(__dirname, ".env.local"),
  ];

  for (const candidate of candidates) loadEnvFile(candidate);
}

preloadEnv();

const DATABASE_URL =
  process.env.NEON_DATABASE_URL ||
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  null;

if (!DATABASE_URL) {
  console.error(
    "Missing database connection string. Tried NEON_DATABASE_URL, DATABASE_URL, NETLIFY_DATABASE_URL."
  );
  process.exit(1);
}

// Accounting data live outside the repo in C:\PrintGuard\ColoradoAccounting.
// The script itself may run either from the repo checkout or from a deployed copy,
// so the data root must not depend on __dirname.
const ROOT = process.env.COLORADO_ACCOUNTING_ROOT
  ? path.resolve(process.env.COLORADO_ACCOUNTING_ROOT)
  : path.resolve("C:/PrintGuard/ColoradoAccounting");

const PRINTERS = ["Colorado-91", "Colorado-92"];

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
}

function getJsonFiles() {
  const files = [];

  for (const printer of PRINTERS) {
    const normalizedDir = path.join(ROOT, printer, "normalized");

    if (!fs.existsSync(normalizedDir)) {
      log(`Skipping missing folder: ${normalizedDir}`);
      continue;
    }

    const dirFiles = fs
      .readdirSync(normalizedDir)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => ({
        printer,
        fullPath: path.join(normalizedDir, f),
        fileName: f,
      }));

    files.push(...dirFiles);
  }

  return files.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

function getAclJsonFiles() {
  const files = [];

  for (const printer of PRINTERS) {
    const normalizedDir = path.join(ROOT, printer, "normalized-acl");

    if (!fs.existsSync(normalizedDir)) {
      log(`Skipping missing ACL folder: ${normalizedDir}`);
      continue;
    }

    const dirFiles = fs
      .readdirSync(normalizedDir)
      .filter((f) => f.toLowerCase().endsWith(".json"))
      .map((f) => ({
        printer,
        fullPath: path.join(normalizedDir, f),
        fileName: f,
      }));

    files.push(...dirFiles);
  }

  return files.sort((a, b) => a.fullPath.localeCompare(b.fullPath));
}

function toNullableTimestamp(value) {
  return value || null;
}

function toNullableDate(value) {
  return value || null;
}

function toNullableInt(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function toNullableBool(value) {
  if (value === null || value === undefined) return false;
  return Boolean(value);
}

function mapRow(row) {
  return {
    imported_at: toNullableTimestamp(row.importedAt),
    printer_name: row.printerName,
    printer_ip: row.printerIp || null,
    serial_prefix: row.serialPrefix || null,
    source_file: row.sourceFile,
    source_date: toNullableDate(row.sourceDate),
    row_type: row.rowType || null,
    document_id: row.documentId || null,
    job_id: toNullableInt(row.jobId),
    job_type: row.jobType || null,
    job_name: row.jobName || null,
    print_mode: row.printMode || null,
    start_at: toNullableTimestamp(row.startAt),
    ready_at: toNullableTimestamp(row.readyAt),
    reception_at: toNullableTimestamp(row.receptionAt),
    active_time_sec: toNullableInt(row.activeTimeSec),
    idle_time_sec: toNullableInt(row.idleTimeSec),
    duration_sec: toNullableInt(row.durationSec),
    result: row.result || null,
    is_printed: toNullableBool(row.isPrinted),
    is_deleted: toNullableBool(row.isDeleted),
    is_aborted: toNullableBool(row.isAborted),
    finished_sets: toNullableInt(row.finishedSets),
    copies_requested: toNullableInt(row.copiesRequested),
    media_type_id: row.mediaTypeId || null,
    media_type: row.mediaType || null,
    media_width: toNullableInt(row.mediaWidth),
    media_length_used: toNullableInt(row.mediaLengthUsed),
    printed_area: toNullableInt(row.printedArea),
    ink_cyan: toNullableInt(row.inkCyan),
    ink_magenta: toNullableInt(row.inkMagenta),
    ink_yellow: toNullableInt(row.inkYellow),
    ink_black: toNullableInt(row.inkBlack),
    ink_white: toNullableInt(row.inkWhite),
    number_of_layers: toNullableInt(row.numberOfLayers),
    layer_structure: row.layerStructure || null,
    dedupe_key: row.dedupeKey,
    raw_row_json: row.rawRow || null,
  };
}

function mapAclRow(row) {
  return {
    imported_at: toNullableTimestamp(row.importedAt),
    printer_name: row.printerName || null,
    printer_ip: row.printerIp || null,
    serial_prefix: row.serialPrefix || null,
    source_file: row.sourceFile || null,
    source_date: toNullableDate(row.sourceDate),
    row_type: row.rowType || "acl_file",
    content_hash: row.contentHash || null,
    file_size_bytes: toNullableInt(row.fileSizeBytes),
    line_count: toNullableInt(row.lineCount),
    non_empty_line_count: toNullableInt(row.nonEmptyLineCount),
    parsed_fields_json: row.parsedFields || null,
    raw_lines_json: Array.isArray(row.rawLines) ? row.rawLines : null,
    raw_text: typeof row.rawText === "string" ? row.rawText : null,
    dedupe_key: row.dedupeKey || null,
    raw_row_json: row,
  };
}

function sanitizeJsonText(raw, fileName) {
  if (typeof raw !== "string") {
    throw new Error(`File is not readable as text: ${fileName}`);
  }

  raw = raw.replace(/^\uFEFF/, "").trim();

  const firstObjectStart = raw.indexOf("{");
  const lastObjectEnd = raw.lastIndexOf("}");
  const firstArrayStart = raw.indexOf("[");
  const lastArrayEnd = raw.lastIndexOf("]");
  const firstChar = raw[0];

  if (firstChar === "{") {
    if (
      firstObjectStart !== -1 &&
      lastObjectEnd !== -1 &&
      lastObjectEnd > firstObjectStart
    ) {
      return raw.slice(firstObjectStart, lastObjectEnd + 1).trim();
    }

    throw new Error(`No valid JSON object bounds found in ${fileName}`);
  }

  if (firstChar === "[") {
    if (
      firstArrayStart !== -1 &&
      lastArrayEnd !== -1 &&
      lastArrayEnd > firstArrayStart
    ) {
      return raw.slice(firstArrayStart, lastArrayEnd + 1).trim();
    }

    throw new Error(`No valid JSON array bounds found in ${fileName}`);
  }

  // Legacy fallback for files with log noise before the JSON payload.
  if (
    firstObjectStart !== -1 &&
    (firstArrayStart === -1 || firstObjectStart < firstArrayStart) &&
    lastObjectEnd !== -1 &&
    lastObjectEnd > firstObjectStart
  ) {
    return raw.slice(firstObjectStart, lastObjectEnd + 1).trim();
  }

  if (
    firstArrayStart !== -1 &&
    lastArrayEnd !== -1 &&
    lastArrayEnd > firstArrayStart
  ) {
    return raw.slice(firstArrayStart, lastArrayEnd + 1).trim();
  }

  throw new Error(`No valid JSON array/object bounds found in ${fileName}`);
}

function parseJsonArrayFromFile(fullPath, fileName) {
  const rawFile = fs.readFileSync(fullPath, "utf8");
  const sanitized = sanitizeJsonText(rawFile, fileName);

  let parsed;

  try {
    parsed = JSON.parse(sanitized);
  } catch (err) {
    throw new Error(
      `JSON parse failed in ${fileName}: ${err.message}. Preview: ${JSON.stringify(
        sanitized.slice(0, 120)
      )}`
    );
  }

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (typeof parsed === "object" && parsed !== null) {
    return [parsed];
  }

  throw new Error(`Unsupported JSON structure in ${fileName}`);
}

const UPSERT_SQL = `
insert into print_accounting_rows (
    imported_at,
    printer_name,
    printer_ip,
    serial_prefix,
    source_file,
    source_date,
    row_type,
    document_id,
    job_id,
    job_type,
    job_name,
    print_mode,
    start_at,
    ready_at,
    reception_at,
    active_time_sec,
    idle_time_sec,
    duration_sec,
    result,
    is_printed,
    is_deleted,
    is_aborted,
    finished_sets,
    copies_requested,
    media_type_id,
    media_type,
    media_width,
    media_length_used,
    printed_area,
    ink_cyan,
    ink_magenta,
    ink_yellow,
    ink_black,
    ink_white,
    number_of_layers,
    layer_structure,
    dedupe_key,
    raw_row_json,
    updated_at
) values (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
    $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
    $31,$32,$33,$34,$35,$36,$37,$38, now()
)
on conflict (dedupe_key)
do update set
    imported_at = excluded.imported_at,
    printer_name = excluded.printer_name,
    printer_ip = excluded.printer_ip,
    serial_prefix = excluded.serial_prefix,
    source_file = excluded.source_file,
    source_date = excluded.source_date,
    row_type = excluded.row_type,
    document_id = excluded.document_id,
    job_id = excluded.job_id,
    job_type = excluded.job_type,
    job_name = excluded.job_name,
    print_mode = excluded.print_mode,
    start_at = excluded.start_at,
    ready_at = excluded.ready_at,
    reception_at = excluded.reception_at,
    active_time_sec = excluded.active_time_sec,
    idle_time_sec = excluded.idle_time_sec,
    duration_sec = excluded.duration_sec,
    result = excluded.result,
    is_printed = excluded.is_printed,
    is_deleted = excluded.is_deleted,
    is_aborted = excluded.is_aborted,
    finished_sets = excluded.finished_sets,
    copies_requested = excluded.copies_requested,
    media_type_id = excluded.media_type_id,
    media_type = excluded.media_type,
    media_width = excluded.media_width,
    media_length_used = excluded.media_length_used,
    printed_area = excluded.printed_area,
    ink_cyan = excluded.ink_cyan,
    ink_magenta = excluded.ink_magenta,
    ink_yellow = excluded.ink_yellow,
    ink_black = excluded.ink_black,
    ink_white = excluded.ink_white,
    number_of_layers = excluded.number_of_layers,
    layer_structure = excluded.layer_structure,
    raw_row_json = excluded.raw_row_json,
    updated_at = now();
`;

const ENSURE_ACL_TABLE_SQL = `
create table if not exists print_accounting_acl_files (
    dedupe_key text primary key,
    imported_at timestamptz null,
    printer_name text not null,
    printer_ip text null,
    serial_prefix text null,
    source_file text not null,
    source_date date null,
    row_type text not null,
    content_hash text null,
    file_size_bytes integer null,
    line_count integer null,
    non_empty_line_count integer null,
    parsed_fields_json jsonb null,
    raw_lines_json jsonb null,
    raw_text text null,
    raw_row_json jsonb null,
    updated_at timestamptz not null default now()
);
`;

const UPSERT_ACL_SQL = `
insert into print_accounting_acl_files (
    dedupe_key,
    imported_at,
    printer_name,
    printer_ip,
    serial_prefix,
    source_file,
    source_date,
    row_type,
    content_hash,
    file_size_bytes,
    line_count,
    non_empty_line_count,
    parsed_fields_json,
    raw_lines_json,
    raw_text,
    raw_row_json,
    updated_at
) values (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
    $11,$12,$13::jsonb,$14::jsonb,$15,$16::jsonb, now()
)
on conflict (dedupe_key)
do update set
    imported_at = excluded.imported_at,
    printer_name = excluded.printer_name,
    printer_ip = excluded.printer_ip,
    serial_prefix = excluded.serial_prefix,
    source_file = excluded.source_file,
    source_date = excluded.source_date,
    row_type = excluded.row_type,
    content_hash = excluded.content_hash,
    file_size_bytes = excluded.file_size_bytes,
    line_count = excluded.line_count,
    non_empty_line_count = excluded.non_empty_line_count,
    parsed_fields_json = excluded.parsed_fields_json,
    raw_lines_json = excluded.raw_lines_json,
    raw_text = excluded.raw_text,
    raw_row_json = excluded.raw_row_json,
    updated_at = now();
`;

async function upsertRow(client, row) {
  const mapped = mapRow(row);

  const values = [
    mapped.imported_at,
    mapped.printer_name,
    mapped.printer_ip,
    mapped.serial_prefix,
    mapped.source_file,
    mapped.source_date,
    mapped.row_type,
    mapped.document_id,
    mapped.job_id,
    mapped.job_type,
    mapped.job_name,
    mapped.print_mode,
    mapped.start_at,
    mapped.ready_at,
    mapped.reception_at,
    mapped.active_time_sec,
    mapped.idle_time_sec,
    mapped.duration_sec,
    mapped.result,
    mapped.is_printed,
    mapped.is_deleted,
    mapped.is_aborted,
    mapped.finished_sets,
    mapped.copies_requested,
    mapped.media_type_id,
    mapped.media_type,
    mapped.media_width,
    mapped.media_length_used,
    mapped.printed_area,
    mapped.ink_cyan,
    mapped.ink_magenta,
    mapped.ink_yellow,
    mapped.ink_black,
    mapped.ink_white,
    mapped.number_of_layers,
    mapped.layer_structure,
    mapped.dedupe_key,
    mapped.raw_row_json ? JSON.stringify(mapped.raw_row_json) : null,
  ];

  await client.query(UPSERT_SQL, values);
}

async function ensureAclTable(client) {
  await client.query(ENSURE_ACL_TABLE_SQL);
}

async function upsertAclRow(client, row) {
  const mapped = mapAclRow(row);

  const values = [
    mapped.dedupe_key,
    mapped.imported_at,
    mapped.printer_name,
    mapped.printer_ip,
    mapped.serial_prefix,
    mapped.source_file,
    mapped.source_date,
    mapped.row_type,
    mapped.content_hash,
    mapped.file_size_bytes,
    mapped.line_count,
    mapped.non_empty_line_count,
    mapped.parsed_fields_json ? JSON.stringify(mapped.parsed_fields_json) : null,
    mapped.raw_lines_json ? JSON.stringify(mapped.raw_lines_json) : null,
    mapped.raw_text,
    mapped.raw_row_json ? JSON.stringify(mapped.raw_row_json) : null,
  ];

  await client.query(UPSERT_ACL_SQL, values);
}

async function main() {
  log(`ROOT = ${ROOT}`);

  const client = new Client({
    connectionString: DATABASE_URL,
    ssl: {
      rejectUnauthorized: false,
    },
  });

  await client.connect();
  log("Connected to Neon.");
  await ensureAclTable(client);

  const jsonFiles = getJsonFiles();
  const aclJsonFiles = getAclJsonFiles();
  log(`Found JSON files: ${jsonFiles.length}`);
  log(`Found ACL JSON files: ${aclJsonFiles.length}`);

  let totalFiles = 0;
  let totalRows = 0;
  let skippedFiles = 0;
  let totalAclFiles = 0;
  let totalAclRows = 0;
  let totalAclPrintRows = 0;
  let skippedAclFiles = 0;

  for (const file of jsonFiles) {
    totalFiles += 1;
    log(`Processing file: ${file.fullPath}`);

    let rows;
    try {
      rows = parseJsonArrayFromFile(file.fullPath, file.fileName);
    } catch (err) {
      log(`SKIPPING FILE: ${file.fileName}`);
      log(err.message);
      skippedFiles += 1;
      continue;
    }

    let fileRowsProcessed = 0;

    for (const row of rows) {
      if (!row || !row.dedupeKey) {
        log(`Skipping row without dedupeKey in ${file.fileName}`);
        continue;
      }

      await upsertRow(client, row);
      totalRows += 1;
      fileRowsProcessed += 1;
    }

    log(`Done file: ${file.fileName}, rows processed: ${fileRowsProcessed}`);
  }

  for (const file of aclJsonFiles) {
    totalAclFiles += 1;
    log(`Processing ACL file: ${file.fullPath}`);

    let rows;
    try {
      rows = parseJsonArrayFromFile(file.fullPath, file.fileName);
    } catch (err) {
      log(`SKIPPING ACL FILE: ${file.fileName}`);
      log(err.message);
      skippedAclFiles += 1;
      continue;
    }

    let fileRowsProcessed = 0;

    for (const row of rows) {
      if (!row || !row.dedupeKey || !row.sourceFile || !row.printerName) {
        log(`Skipping ACL row without required identifiers in ${file.fileName}`);
        continue;
      }

      if (row.rowType === "print") {
        await upsertRow(client, row);
        totalAclPrintRows += 1;
      } else {
        await upsertAclRow(client, row);
        totalAclRows += 1;
      }

      fileRowsProcessed += 1;
    }

    log(`Done ACL file: ${file.fileName}, rows processed: ${fileRowsProcessed}`);
  }

  log(
    `Finished. Files scanned: ${totalFiles}, files skipped: ${skippedFiles}, rows processed: ${totalRows}`
  );
  log(
    `Finished ACL. Files scanned: ${totalAclFiles}, files skipped: ${skippedAclFiles}, metadata rows processed: ${totalAclRows}, print rows processed: ${totalAclPrintRows}`
  );

  await client.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
