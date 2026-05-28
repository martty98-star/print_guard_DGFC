'use strict';

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { Pool } = require('pg');

let pool = null;

function safeText(value, maxLen = 100) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function cleanBarcode(value) {
  return String(value == null ? '' : value).trim().slice(0, 200);
}

function cleanRawBarcode(value) {
  return String(value == null ? '' : value).slice(0, 200);
}

function getConnectionString() {
  return String(
    process.env.NEON_DATABASE_URL ||
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    ''
  ).trim();
}

function getPool() {
  const connectionString = getConnectionString();
  if (!connectionString) {
    const error = new Error('Missing NEON_DATABASE_URL');
    error.statusCode = 503;
    throw error;
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30_000,
    });
  }
  return pool;
}

function makeBatchId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `scan-batch-${stamp}-${crypto.randomUUID()}`;
}

function legacyScanId(row) {
  const basis = [
    row && (row.scannedAt || row.scanned_at),
    row && (row.barcode || row.orderNumber || row.order_number),
    row && (row.rawBarcode || row.raw_barcode),
    row && (row.station || ''),
    row && (row.operator || ''),
    row && (row.source || 'job_label_scan'),
  ].join('\x1f');
  return `legacy-${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 40)}`;
}

function toIsoDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function normalizeScanRow(row, sourceFile, lineNumber) {
  if (!row || typeof row !== 'object') {
    return { scan: null, error: 'scan row is not an object' };
  }

  const scannedAt = toIsoDate(row.scannedAt || row.scanned_at);
  const barcode = cleanBarcode(row.barcode || row.orderNumber || row.order_number);
  if (!scannedAt) return { scan: null, error: 'scannedAt is missing or invalid' };
  if (!barcode) return { scan: null, error: 'barcode is missing' };

  const explicitScanId = safeText(row.scanId || row.scan_id, 180);
  const scanId = explicitScanId || legacyScanId(row);
  const orderNumber = cleanBarcode(row.orderNumber || row.order_number || barcode);
  const rawBarcode = cleanRawBarcode(row.rawBarcode || row.raw_barcode || barcode);

  return {
    scan: {
      scanId,
      scannedAt,
      barcode,
      rawBarcode: rawBarcode || barcode,
      orderNumber,
      station: safeText(row.station, 100),
      operator: safeText(row.operator, 100),
      source: safeText(row.source, 80) || 'job_label_scan',
      sourceFile,
      lineNumber,
      legacyScanId: !explicitScanId,
    },
    error: null,
  };
}

function isDeleteMarker(row) {
  return Boolean(row && (
    row.action === 'scan_deleted' ||
    row.type === 'scan_deleted' ||
    row.source === 'job_label_scan_delete'
  ));
}

function deleteMarkerTarget(row) {
  return safeText(row && (row.targetScanId || row.target_scan_id), 180);
}

function isScanJsonlFile(fileName) {
  return /^job-label-scans-\d{4}-\d{2}-\d{2}\.jsonl$/i.test(fileName) ||
    /^failed-scans-\d{4}-\d{2}-\d{2}\.jsonl$/i.test(fileName);
}

async function listJsonlFiles(dir) {
  if (!dir) return [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && isScanJsonlFile(entry.name))
      .map((entry) => path.join(dir, entry.name))
      .sort();
  } catch (error) {
    if (error && error.code === 'ENOENT') return [];
    throw error;
  }
}

function distinctDirs(inputDir, fallbackDir) {
  const dirs = [];
  const seen = new Set();
  [inputDir, fallbackDir].forEach((dir) => {
    const value = String(dir || '').trim();
    if (!value) return;
    const resolved = path.resolve(value).toLowerCase();
    if (seen.has(resolved)) return;
    seen.add(resolved);
    dirs.push(value);
  });
  return dirs;
}

async function readScanFiles(options) {
  const dirs = distinctDirs(options.inputDir, options.fallbackDir);
  const filesNested = await Promise.all(dirs.map((dir) => listJsonlFiles(dir)));
  const files = filesNested.flat();
  const byScanId = new Map();
  const cancelledScanIds = new Set();
  const errors = [];
  const summary = {
    filesRead: 0,
    totalLinesRead: 0,
    invalidJsonLines: 0,
    invalidScanLines: 0,
    duplicateLines: 0,
    cancelLines: 0,
    legacyScanIdCount: 0,
  };

  for (const filePath of files) {
    let text = '';
    try {
      text = await fs.readFile(filePath, 'utf8');
    } catch (error) {
      errors.push({ file: filePath, error: error.message || String(error) });
      continue;
    }
    summary.filesRead += 1;
    const lines = text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      if (!line.trim()) continue;
      summary.totalLinesRead += 1;
      let parsed = null;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        summary.invalidJsonLines += 1;
        errors.push({ file: filePath, line: index + 1, error: 'invalid JSON' });
        continue;
      }

      if (isDeleteMarker(parsed)) {
        const targetScanId = deleteMarkerTarget(parsed);
        if (targetScanId) {
          cancelledScanIds.add(targetScanId);
          summary.cancelLines += 1;
        }
        continue;
      }

      const normalized = normalizeScanRow(parsed, filePath, index + 1);
      if (!normalized.scan) {
        summary.invalidScanLines += 1;
        errors.push({ file: filePath, line: index + 1, error: normalized.error });
        continue;
      }
      if (byScanId.has(normalized.scan.scanId)) {
        summary.duplicateLines += 1;
        continue;
      }
      if (normalized.scan.legacyScanId) summary.legacyScanIdCount += 1;
      byScanId.set(normalized.scan.scanId, normalized.scan);
    }
  }

  cancelledScanIds.forEach((scanId) => byScanId.delete(scanId));

  const scans = Array.from(byScanId.values()).sort((a, b) => {
    const byTime = new Date(a.scannedAt).getTime() - new Date(b.scannedAt).getTime();
    if (byTime) return byTime;
    return a.scanId.localeCompare(b.scanId);
  });

  return {
    ...summary,
    scans,
    errors,
  };
}

async function fetchExistingScanIds(client, scanIds) {
  if (!scanIds.length) return new Set();
  const result = await client.query(
    `
      select scan_id
      from public.print_job_label_scans
      where scan_id = any($1::text[])
    `,
    [scanIds]
  );
  return new Set(result.rows.map((row) => String(row.scan_id)));
}

function orderCandidatesForScan(scan) {
  return Array.from(new Set([
    cleanBarcode(scan.orderNumber),
    cleanBarcode(scan.barcode),
  ].filter(Boolean)));
}

async function findProcessedOrderMatch(client, scan) {
  const candidates = orderCandidatesForScan(scan);
  if (!candidates.length) {
    return { status: 'unmatched', reason: 'scan has no orderNumber or barcode candidate' };
  }

  const result = await client.query(
    `
      select id, order_name
      from public.processed_print_orders
      where coalesce(ignored, false) = false
        and order_name = any($1::text[])
      order by queued_date_time desc nulls last, id desc
      limit 5
    `,
    [candidates]
  );
  const unique = new Map();
  result.rows.forEach((row) => unique.set(String(row.id), row));
  const rows = Array.from(unique.values());

  if (rows.length === 1) {
    return {
      status: 'matched',
      processedOrderId: rows[0].id,
      orderName: rows[0].order_name,
      reason: 'exact order_name match',
    };
  }
  if (!rows.length) {
    return {
      status: 'unmatched',
      reason: `no processed_print_orders.order_name match for ${candidates.join(', ')}`,
    };
  }
  return {
    status: 'ambiguous',
    reason: `multiple processed_print_orders.order_name matches for ${candidates.join(', ')}`,
  };
}

async function insertScan(client, scan, batchId, committedAt, committedBy) {
  const result = await client.query(
    `
      insert into public.print_job_label_scans (
        scan_id,
        scanned_at,
        barcode,
        raw_barcode,
        order_number,
        station,
        operator,
        source,
        commit_batch_id,
        committed_at,
        committed_by,
        match_status
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, nullif($11, ''), 'pending')
      on conflict (scan_id) do nothing
      returning scan_id
    `,
    [
      scan.scanId,
      scan.scannedAt,
      scan.barcode,
      scan.rawBarcode,
      scan.orderNumber,
      scan.station || null,
      scan.operator || null,
      scan.source || 'job_label_scan',
      batchId,
      committedAt,
      committedBy || '',
    ]
  );
  return result.rowCount === 1;
}

async function updateScanMatch(client, scan, match) {
  await client.query(
    `
      update public.print_job_label_scans
      set match_status = $2,
          match_reason = nullif($3, ''),
          matched_processed_order_id = $4,
          matched_order_name = $5,
          updated_at = now()
      where scan_id = $1
    `,
    [
      scan.scanId,
      match.status,
      match.reason || '',
      match.processedOrderId || null,
      match.orderName || null,
    ]
  );
}

async function markProcessedOrderPhysicallyPrinted(client, scan, match, batchId, committedBy, fallbackStation) {
  await client.query(
    `
      update public.processed_print_orders
      set physically_printed_at = $2,
          physically_printed_by = nullif($3, ''),
          physically_printed_station = nullif($4, ''),
          physically_printed_scan_id = $5,
          physically_printed_batch_id = $6,
          updated_at = now()
      where id = $1
    `,
    [
      match.processedOrderId,
      scan.scannedAt,
      committedBy || scan.operator || '',
      scan.station || fallbackStation || '',
      scan.scanId,
      batchId,
    ]
  );
}

async function getPendingScans(options) {
  const read = await readScanFiles(options);
  const client = await getPool().connect();
  try {
    const scanIds = read.scans.map((scan) => scan.scanId);
    const existing = await fetchExistingScanIds(client, scanIds);
    const pending = read.scans.filter((scan) => !existing.has(scan.scanId));
    const latestPending = pending.length ? pending[pending.length - 1] : null;
    const latestScan = read.scans.length ? read.scans[read.scans.length - 1] : null;
    return {
      ok: true,
      filesRead: read.filesRead,
      totalLinesRead: read.totalLinesRead,
      totalScansRead: read.scans.length,
      pendingCount: pending.length,
      committedCount: read.scans.length - pending.length,
      duplicateLines: read.duplicateLines,
      invalidJsonLines: read.invalidJsonLines,
      invalidScanLines: read.invalidScanLines,
      cancelLines: read.cancelLines,
      errorCount: read.errors.length,
      latestPendingScan: latestPending,
      latestScan,
      errors: read.errors.slice(0, 10),
    };
  } finally {
    client.release();
  }
}

async function commitScans(options) {
  const read = await readScanFiles(options);
  const committedAt = new Date().toISOString();
  const committedBy = safeText(options.committedBy || options.operator, 100);
  const station = safeText(options.station, 100);
  const batchId = makeBatchId(new Date(committedAt));
  const client = await getPool().connect();
  const summary = {
    ok: true,
    batchId,
    filesRead: read.filesRead,
    totalLinesRead: read.totalLinesRead,
    totalScansRead: read.scans.length,
    newScansCommitted: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    ambiguousCount: 0,
    duplicateCount: read.duplicateLines,
    errorCount: read.invalidJsonLines + read.invalidScanLines,
    invalidJsonLines: read.invalidJsonLines,
    invalidScanLines: read.invalidScanLines,
    cancelLines: read.cancelLines,
    legacyScanIdCount: read.legacyScanIdCount,
    errors: read.errors.slice(0, 20),
  };

  try {
    if (read.errors.length && options.logger && typeof options.logger.warn === 'function') {
      options.logger.warn('[scan-capture] scan commit input errors', {
        count: read.errors.length,
        errors: read.errors.slice(0, 10),
      });
    }

    await client.query('begin');
    const scanIds = read.scans.map((scan) => scan.scanId);
    const existing = await fetchExistingScanIds(client, scanIds);
    summary.duplicateCount += existing.size;
    const pendingScans = read.scans.filter((scan) => !existing.has(scan.scanId));

    for (let index = 0; index < pendingScans.length; index += 1) {
      const scan = pendingScans[index];
      const savepoint = `scan_commit_${index}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        const inserted = await insertScan(client, scan, batchId, committedAt, committedBy || scan.operator || '');
        if (!inserted) {
          summary.duplicateCount += 1;
          await client.query(`release savepoint ${savepoint}`);
          continue;
        }

        summary.newScansCommitted += 1;
        const match = await findProcessedOrderMatch(client, scan);
        await updateScanMatch(client, scan, match);
        if (match.status === 'matched') {
          await markProcessedOrderPhysicallyPrinted(client, scan, match, batchId, committedBy, station);
          summary.matchedCount += 1;
        } else if (match.status === 'ambiguous') {
          summary.ambiguousCount += 1;
        } else {
          summary.unmatchedCount += 1;
        }
        await client.query(`release savepoint ${savepoint}`);
      } catch (error) {
        await client.query(`rollback to savepoint ${savepoint}`);
        await client.query(`release savepoint ${savepoint}`);
        summary.errorCount += 1;
        summary.errors.push({
          scanId: scan.scanId,
          barcode: scan.barcode,
          error: error.message || String(error),
        });
        if (options.logger && typeof options.logger.error === 'function') {
          options.logger.error('[scan-capture] scan commit row failed', {
            scanId: scan.scanId,
            barcode: scan.barcode,
            error: error.message || String(error),
          });
        }
      }
    }

    await client.query(
      `
        insert into public.print_scan_commit_batches (
          batch_id,
          committed_at,
          committed_by,
          station,
          scan_count,
          matched_count,
          unmatched_count,
          duplicate_count,
          error_count,
          source
        )
        values ($1, $2, nullif($3, ''), nullif($4, ''), $5, $6, $7, $8, $9, 'operator_commit')
      `,
      [
        batchId,
        committedAt,
        committedBy,
        station,
        summary.newScansCommitted,
        summary.matchedCount,
        summary.unmatchedCount + summary.ambiguousCount,
        summary.duplicateCount,
        summary.errorCount,
      ]
    );

    await client.query('commit');
    return summary;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  commitScans,
  getPendingScans,
  readScanFiles,
};
