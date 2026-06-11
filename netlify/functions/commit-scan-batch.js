'use strict';

const crypto = require('crypto');
const {
  checkRateLimit,
  json,
  parseRequestBody,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const {
  ensureProcessedPrintOrderTables,
} = require('./_lib/processed-print-orders');
const { parseBarcode } = require('./_lib/scan-barcode');

const ACTIVE_REPRINT_STATUSES = ['pending', 'active', 'requested', 'open'];

function safeText(value, maxLen = 120) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLen);
}

function cleanBarcode(value) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, 200);
}

function toIsoDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function makeBatchId(date = new Date()) {
  const stamp = date
    .toISOString()
    .replace(/[-:.TZ]/g, '')
    .slice(0, 14);
  return `browser-scan-batch-${stamp}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function structuredLog(event, details = {}) {
  console.log(
    JSON.stringify({
      component: 'scan-commit',
      event,
      at: nowIso(),
      ...details,
    }),
  );
}

function createObservedClient(client, context) {
  const dbQueries = {};
  return {
    ...client,
    get state() {
      return client.state;
    },
    getDbTimings() {
      return dbQueries;
    },
    async query(sql, params) {
      const phase = context.phase || 'unknown';
      const startedMs = Date.now();
      try {
        const result = await client.query(sql, params);
        const durationMs = Date.now() - startedMs;
        const bucket = dbQueries[phase] || {
          count: 0,
          totalMs: 0,
          maxMs: 0,
        };
        bucket.count += 1;
        bucket.totalMs += durationMs;
        bucket.maxMs = Math.max(bucket.maxMs, durationMs);
        dbQueries[phase] = bucket;
        if (durationMs >= 500) {
          structuredLog('slow-db-query', {
            batchId: context.batchId,
            phase,
            durationMs,
          });
        }
        return result;
      } catch (error) {
        const durationMs = Date.now() - startedMs;
        const bucket = dbQueries[phase] || {
          count: 0,
          totalMs: 0,
          maxMs: 0,
          errors: 0,
        };
        bucket.count += 1;
        bucket.totalMs += durationMs;
        bucket.maxMs = Math.max(bucket.maxMs, durationMs);
        bucket.errors = Number(bucket.errors || 0) + 1;
        dbQueries[phase] = bucket;
        structuredLog('db-query-error', {
          batchId: context.batchId,
          phase,
          durationMs,
          message: error && error.message,
        });
        throw error;
      }
    },
  };
}

function normalizeBatchId(value) {
  const batchId = safeText(value, 180);
  if (!batchId) return '';
  return /^[A-Za-z0-9._:-]+$/.test(batchId) ? batchId : '';
}

function normalizeScan(row) {
  if (!row || typeof row !== 'object') {
    return { scan: null, error: 'scan row is not an object' };
  }
  const scanId = safeText(row.scanId || row.scan_id, 180);
  const scannedAt = toIsoDate(row.scannedAt || row.scanned_at);
  const parsedBarcode = parseBarcode(
    row.barcode || row.orderNumber || row.order_number,
  );
  const barcode = cleanBarcode(parsedBarcode.barcode);
  if (!scanId) return { scan: null, error: 'scanId is missing' };
  if (!scannedAt)
    return { scan: null, error: 'scannedAt is missing or invalid' };
  if (!parsedBarcode.ok) return { scan: null, error: parsedBarcode.error };
  if (!barcode) return { scan: null, error: 'barcode is missing' };
  return {
    scan: {
      scanId,
      scannedAt,
      barcode,
      rawBarcode: String(
        row.rawBarcode ||
          row.raw_barcode ||
          parsedBarcode.rawBarcode ||
          barcode,
      ).slice(0, 200),
      orderNumber: cleanBarcode(parsedBarcode.poNumber),
      orderType: parsedBarcode.orderType,
      isReprint: parsedBarcode.isReprint,
      reprintKind: parsedBarcode.reprintKind,
      station: safeText(row.station, 100),
      operator: safeText(row.operator, 100),
      source: safeText(row.source, 80) || 'job_label_scan',
    },
    error: null,
  };
}

async function ensureScanCommitSchema(client) {
  await ensureProcessedPrintOrderTables(client);
  await client.query(`
    create table if not exists public.print_scan_commit_batches (
      batch_id text primary key,
      committed_at timestamptz not null default now(),
      committed_by text,
      station text,
      scan_count integer not null default 0,
      matched_count integer not null default 0,
      unmatched_count integer not null default 0,
      duplicate_count integer not null default 0,
      error_count integer not null default 0,
      source text not null default 'operator_commit',
      status text not null default 'committed',
      retry_count integer not null default 0,
      updated_at timestamptz not null default now(),
      started_at timestamptz,
      finished_at timestamptz,
      failed_phase text,
      error_message text,
      diagnostics jsonb not null default '{}'::jsonb
    )
  `);
  await client.query(
    `alter table public.print_scan_commit_batches add column if not exists status text not null default 'committed'`,
  );
  await client.query(
    `alter table public.print_scan_commit_batches add column if not exists retry_count integer not null default 0`,
  );
  await client.query(
    `alter table public.print_scan_commit_batches add column if not exists updated_at timestamptz not null default now()`,
  );
  await client.query(
    `alter table public.print_scan_commit_batches add column if not exists started_at timestamptz`,
  );
  await client.query(
    `alter table public.print_scan_commit_batches add column if not exists finished_at timestamptz`,
  );
  await client.query(
    `alter table public.print_scan_commit_batches add column if not exists failed_phase text`,
  );
  await client.query(
    `alter table public.print_scan_commit_batches add column if not exists error_message text`,
  );
  await client.query(
    `alter table public.print_scan_commit_batches add column if not exists diagnostics jsonb not null default '{}'::jsonb`,
  );
  await client.query(`
    create table if not exists public.print_job_label_scans (
      scan_id text primary key,
      scanned_at timestamptz not null,
      barcode text not null,
      raw_barcode text,
      order_number text,
      station text,
      operator text,
      source text not null default 'job_label_scan',
      commit_batch_id text,
      committed_at timestamptz,
      committed_by text,
      matched_processed_order_id bigint,
      matched_order_name text,
      match_status text not null default 'pending',
      match_reason text,
      ingested_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      constraint print_job_label_scans_match_status_chk
        check (match_status in ('pending', 'matched', 'unmatched', 'ambiguous', 'error'))
    )
  `);
  await client.query(
    'create index if not exists print_job_label_scans_order_number_idx on public.print_job_label_scans (order_number)',
  );
  await client.query(
    'create index if not exists print_job_label_scans_scanned_at_desc_idx on public.print_job_label_scans (scanned_at desc)',
  );
  await client.query(
    'create index if not exists print_job_label_scans_match_status_idx on public.print_job_label_scans (match_status)',
  );
  await client.query(
    'create index if not exists print_job_label_scans_commit_batch_id_idx on public.print_job_label_scans (commit_batch_id)',
  );
  await client.query(
    'create index if not exists print_job_label_scans_batch_status_idx on public.print_job_label_scans (commit_batch_id, match_status)',
  );
  await client.query(
    'alter table public.processed_print_orders add column if not exists physically_printed_at timestamptz',
  );
  await client.query(
    'alter table public.processed_print_orders add column if not exists physically_printed_by text',
  );
  await client.query(
    'alter table public.processed_print_orders add column if not exists physically_printed_station text',
  );
  await client.query(
    'alter table public.processed_print_orders add column if not exists physically_printed_scan_id text',
  );
  await client.query(
    'alter table public.processed_print_orders add column if not exists physically_printed_batch_id text',
  );
  await client.query(`
    create index if not exists processed_print_orders_active_order_name_queued_idx
      on public.processed_print_orders (order_name, queued_date_time desc nulls last, id desc)
      where order_name is not null
        and coalesce(ignored, false) = false
  `);
  await client.query(
    'alter table public.print_job_label_scans add column if not exists order_type text',
  );
  await client.query(
    'alter table public.print_job_label_scans add column if not exists is_reprint boolean not null default false',
  );
  await client.query(
    'alter table public.print_job_label_scans add column if not exists reprint_kind text',
  );
  await client.query(
    'alter table public.processed_order_reprint_requests add column if not exists order_type text',
  );
  await client.query(
    'alter table public.processed_order_reprint_requests add column if not exists reprint_kind text',
  );
  await client.query(
    'alter table public.processed_order_reprint_requests add column if not exists scan_barcode text',
  );
  await client.query(
    'alter table public.processed_order_reprint_requests add column if not exists scan_raw_barcode text',
  );
  await client.query(
    'alter table public.processed_order_reprint_requests add column if not exists completed_scan_id text',
  );
  await client.query(
    'alter table public.processed_order_reprint_requests add column if not exists completed_batch_id text',
  );
  await client.query(
    'create index if not exists processed_reprint_scan_status_idx on public.processed_order_reprint_requests (status, order_name, requested_at desc, id desc)',
  );
}

async function fetchExistingScanIds(client, scanIds) {
  if (!scanIds.length) return new Set();
  const result = await client.query(
    `
      select scan_id
      from public.print_job_label_scans
      where scan_id = any($1::text[])
    `,
    [scanIds],
  );
  return new Set(result.rows.map((row) => String(row.scan_id)));
}

async function fetchExistingScansById(client, scanIds) {
  if (!scanIds.length) return new Map();
  const result = await client.query(
    `
      select
        scan_id,
        scanned_at,
        barcode,
        raw_barcode,
        order_number,
        order_type,
        is_reprint,
        reprint_kind,
        station,
        operator,
        source,
        commit_batch_id,
        committed_at,
        committed_by,
        matched_processed_order_id,
        matched_order_name,
        match_status,
        match_reason
      from public.print_job_label_scans
      where scan_id = any($1::text[])
    `,
    [scanIds],
  );
  return new Map(result.rows.map((row) => [String(row.scan_id), row]));
}

function rowTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseDiagnostics(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}

function clientBatchStatus(rawStatus) {
  const status = String(rawStatus || '')
    .trim()
    .toLowerCase();
  if (status === 'committed') return 'already_completed';
  if (status === 'partial_failed') return 'partial';
  return status || 'unknown';
}

function isCompletedBatchStatus(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  return normalized === 'committed' || normalized === 'matched';
}

function isActiveBatchStatus(status) {
  const normalized = String(status || '')
    .trim()
    .toLowerCase();
  return (
    normalized === 'received' ||
    normalized === 'processing' ||
    normalized === 'matching'
  );
}

async function isBatchActuallyComplete(client, batchId) {
  const aggregate = await aggregateBatchRows(client, batchId);
  const scanCount = Number(aggregate.scan_count || 0);
  const pendingCount = Number(aggregate.pending_count || 0);
  const finalizedCount = Number(aggregate.finalized_count || 0);
  return scanCount > 0 && pendingCount === 0 && finalizedCount === scanCount;
}

function formatBatchStatus(row) {
  if (!row) return null;
  const startedAt = rowTimestamp(row.started_at || row.committed_at);
  const finishedAt = rowTimestamp(row.finished_at);
  const lastUpdatedAt = rowTimestamp(row.updated_at);
  const startMs = startedAt ? Date.parse(startedAt) : NaN;
  const endMs = finishedAt
    ? Date.parse(finishedAt)
    : lastUpdatedAt
      ? Date.parse(lastUpdatedAt)
      : NaN;
  const durationMs =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs >= startMs
      ? endMs - startMs
      : null;
  const diagnostics = parseDiagnostics(row.diagnostics);
  return {
    ok: true,
    batchId: String(row.batch_id || ''),
    status: clientBatchStatus(row.status),
    rawStatus: String(row.status || ''),
    scanCount: Number(row.scan_count || 0),
    matchedCount: Number(row.matched_count || 0),
    unmatchedCount: Number(row.unmatched_count || 0),
    duplicateCount: Number(row.duplicate_count || 0),
    errorCount: Number(row.error_count || 0),
    retryCount: Number(row.retry_count || 0),
    currentPhase: diagnostics.phase || String(row.status || ''),
    phaseUpdatedAt: diagnostics.phaseUpdatedAt || null,
    phaseDurationMs: diagnostics.phaseDurationMs ?? null,
    failedPhase: row.failed_phase || diagnostics.failedPhase || null,
    errorMessage: row.error_message || diagnostics.errorMessage || null,
    startedAt,
    finishedAt,
    durationMs,
    lastUpdatedAt,
    performance: diagnostics.performance || null,
    diagnostics,
  };
}

async function fetchBatchScanStatusSummary(client, batchId) {
  const result = await client.query(
    `
      select scan_id, match_status
      from public.print_job_label_scans
      where commit_batch_id = $1
    `,
    [batchId],
  );
  const summary = {
    finalizedScanIds: [],
    processedScanIds: [],
    errorScanIds: [],
    pendingScanIds: [],
  };
  for (const row of result.rows || []) {
    const scanId = String(row.scan_id || '');
    if (!scanId) continue;
    const status = String(row.match_status || '')
      .trim()
      .toLowerCase();
    if (status === 'pending') {
      summary.pendingScanIds.push(scanId);
      continue;
    }
    if (status === 'error') {
      summary.errorScanIds.push(scanId);
      continue;
    }
    summary.finalizedScanIds.push(scanId);
    summary.processedScanIds.push(scanId);
  }
  return summary;
}

async function fetchBatchRow(client, batchId) {
  const result = await client.query(
    `
      select
        batch_id,
        committed_at,
        committed_by,
        station,
        scan_count,
        matched_count,
        unmatched_count,
        duplicate_count,
        error_count,
        source,
        status,
        retry_count,
        updated_at,
        started_at,
        finished_at,
        failed_phase,
        error_message,
        diagnostics
      from public.print_scan_commit_batches
      where batch_id = $1
    `,
    [batchId],
  );
  return result.rows[0] || null;
}

async function getBatchStatus(client, batchId) {
  await ensureScanCommitSchema(client);
  const normalizedBatchId = normalizeBatchId(batchId);
  if (!normalizedBatchId) {
    const error = new Error('Invalid batchId');
    error.statusCode = 400;
    throw error;
  }
  const status = formatBatchStatus(
    await fetchBatchRow(client, normalizedBatchId),
  );
  if (!status) return null;
  const scanStatus = await fetchBatchScanStatusSummary(
    client,
    normalizedBatchId,
  );
  return {
    ...status,
    ...scanStatus,
    diagnostics: {
      ...(status.diagnostics || {}),
      finalizedScanIds: scanStatus.finalizedScanIds,
      processedScanIds: scanStatus.processedScanIds,
      errorScanIds: scanStatus.errorScanIds,
      pendingScanIds: scanStatus.pendingScanIds,
    },
  };
}

async function updateBatchPhase(client, batchId, status, diagnostics = {}) {
  const phaseStartedMs = diagnostics.phaseStartedMs || Date.now();
  const phaseDurationMs =
    diagnostics.phaseDurationMs == null
      ? Date.now() - phaseStartedMs
      : diagnostics.phaseDurationMs;
  const payload = {
    ...diagnostics,
    phase: status,
    phaseUpdatedAt: nowIso(),
    phaseDurationMs,
  };
  await client.query(
    `
      update public.print_scan_commit_batches
      set status = $2,
          diagnostics = coalesce(diagnostics, '{}'::jsonb) || $3::jsonb,
          updated_at = now()
      where batch_id = $1
    `,
    [batchId, status, JSON.stringify(payload)],
  );
  structuredLog('phase', {
    batchId,
    status,
    phaseDurationMs,
    ...diagnostics,
  });
}

function scanFromDbRow(row) {
  return {
    scanId: String(row.scan_id || ''),
    scannedAt:
      row.scanned_at instanceof Date
        ? row.scanned_at.toISOString()
        : toIsoDate(row.scanned_at),
    barcode: cleanBarcode(row.barcode),
    rawBarcode: String(row.raw_barcode || row.barcode || '').slice(0, 200),
    orderNumber: cleanBarcode(row.order_number),
    orderType: normalizeOrderType(row.order_type) || null,
    isReprint: Boolean(row.is_reprint),
    reprintKind: row.reprint_kind || null,
    station: safeText(row.station, 100),
    operator: safeText(row.operator, 100),
    source: safeText(row.source, 80) || 'job_label_scan',
    matchStatus: safeText(row.match_status, 30) || 'pending',
    matchedProcessedOrderId: row.matched_processed_order_id || null,
    matchedOrderName: row.matched_order_name || null,
  };
}

async function prepareBatchForCommit(
  client,
  batchId,
  committedAt,
  committedBy,
  station,
) {
  const inserted = await client.query(
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
        source,
        status,
        retry_count,
        started_at,
        updated_at,
        diagnostics
      )
      values ($1, $2, nullif($3, ''), nullif($4, ''), 0, 0, 0, 0, 0, 'browser_local_queue', 'received', 0, now(), now(), $5::jsonb)
      on conflict (batch_id) do nothing
      returning *
    `,
    [
      batchId,
      committedAt,
      committedBy,
      station,
      JSON.stringify({ phase: 'received', phaseUpdatedAt: committedAt }),
    ],
  );
  if (inserted.rowCount) {
    await updateBatchPhase(client, batchId, 'processing', {
      retryMode: 'fresh',
    });
    return { action: 'start', batch: inserted.rows[0], retryMode: 'fresh' };
  }

  const batch = await fetchBatchRow(client, batchId);
  if (!batch) {
    const error = new Error('Batch row could not be created');
    error.statusCode = 500;
    throw error;
  }
  if (isCompletedBatchStatus(batch.status)) {
    const complete = await isBatchActuallyComplete(client, batchId);
    if (complete) {
      return {
        action: 'already_completed',
        batch,
        retryMode: 'already_committed_duplicate',
      };
    }
  }
  if (isActiveBatchStatus(batch.status)) {
    return { action: 'processing', batch, retryMode: 'same_batch_processing' };
  }

  const retryMode =
    Number(batch.scan_count || 0) > 0 || Number(batch.error_count || 0) > 0
      ? 'partial_recovery'
      : 'same_batch_retry';
  const updated = await client.query(
    `
      update public.print_scan_commit_batches
      set status = 'processing',
          retry_count = retry_count + 1,
          started_at = coalesce(started_at, now()),
          finished_at = null,
          failed_phase = null,
          error_message = null,
          diagnostics = coalesce(diagnostics, '{}'::jsonb) || $4::jsonb,
          updated_at = now(),
          committed_by = coalesce(nullif($2, ''), committed_by),
          station = coalesce(nullif($3, ''), station)
      where batch_id = $1
        and status not in ('received', 'processing', 'matching')
      returning *
    `,
    [
      batchId,
      committedBy,
      station,
      JSON.stringify({
        phase: 'processing',
        retryMode,
        phaseUpdatedAt: new Date().toISOString(),
      }),
    ],
  );
  if (!updated.rowCount) {
    const current = await fetchBatchRow(client, batchId);
    if (isCompletedBatchStatus(current?.status)) {
      const complete = await isBatchActuallyComplete(client, batchId);
      if (complete) {
        return {
          action: 'already_completed',
          batch: current,
          retryMode: 'already_committed_duplicate',
        };
      }
    }
    return {
      action: 'processing',
      batch: current,
      retryMode: 'same_batch_processing',
    };
  }
  structuredLog('phase', {
    batchId,
    status: 'processing',
    retryMode,
    phaseDurationMs: 0,
  });
  return { action: 'start', batch: updated.rows[0], retryMode };
}

async function aggregateBatchRows(client, batchId) {
  const result = await client.query(
    `
      select
        count(*)::int as scan_count,
        count(*) filter (where match_status = 'matched')::int as matched_count,
        count(*) filter (where match_status = 'unmatched')::int as unmatched_count,
        count(*) filter (where match_status = 'ambiguous')::int as ambiguous_count,
        count(*) filter (where match_status = 'error')::int as error_count,
        count(*) filter (where match_status in ('matched', 'unmatched', 'ambiguous', 'error'))::int as finalized_count,
        count(*) filter (where match_status = 'pending')::int as pending_count
      from public.print_job_label_scans
      where commit_batch_id = $1
    `,
    [batchId],
  );
  return (
    result.rows[0] || {
      scan_count: 0,
      matched_count: 0,
      unmatched_count: 0,
      ambiguous_count: 0,
      error_count: 0,
      finalized_count: 0,
      pending_count: 0,
    }
  );
}

async function finalizeBatch(client, batchId, summary, diagnostics) {
  const aggregate = await aggregateBatchRows(client, batchId);
  const unmatchedTotal =
    Number(aggregate.unmatched_count || 0) +
    Number(aggregate.ambiguous_count || 0);
  const errorTotal = Math.max(
    Number(aggregate.error_count || 0),
    Number(summary.errorCount || 0),
  );
  const matchedTotal = Number(aggregate.matched_count || 0);
  const finalStatus =
    errorTotal > 0 || unmatchedTotal > 0 || matchedTotal === 0
      ? 'partial'
      : 'matched';
  await client.query(
    `
      update public.print_scan_commit_batches
      set status = $2,
          scan_count = $3,
          matched_count = $4,
          unmatched_count = $5,
          duplicate_count = $6,
          error_count = $7,
          diagnostics = $8::jsonb,
          failed_phase = $9,
          error_message = $10,
          finished_at = now(),
          updated_at = now()
      where batch_id = $1
    `,
    [
      batchId,
      finalStatus,
      Number(aggregate.scan_count || 0),
      matchedTotal,
      unmatchedTotal,
      summary.duplicateCount,
      errorTotal,
      JSON.stringify(diagnostics || {}),
      errorTotal > 0 ? diagnostics?.failedPhase || 'matching' : null,
      errorTotal > 0
        ? diagnostics?.errorMessage ||
          (summary.errors[0] && summary.errors[0].error) ||
          null
        : null,
    ],
  );
  structuredLog('phase', {
    batchId,
    status: finalStatus,
    matchedTotal,
    unmatchedTotal,
    errorTotal,
  });
  return aggregate;
}

async function updateBatchDiagnostics(client, batchId, diagnostics) {
  await client.query(
    `
      update public.print_scan_commit_batches
      set diagnostics = coalesce(diagnostics, '{}'::jsonb) || $2::jsonb,
          updated_at = now()
      where batch_id = $1
    `,
    [batchId, JSON.stringify(diagnostics || {})],
  );
}

function orderCandidatesForScan(scan) {
  const candidates = [
    cleanBarcode(scan.orderNumber),
    cleanBarcode(scan.barcode),
  ].filter(Boolean);
  for (const candidate of [...candidates]) {
    const psMatch = candidate.match(/^PS(\d+)$/i);
    if (psMatch) candidates.push(psMatch[1]);
  }
  return Array.from(new Set(candidates));
}

function normalizeOrderType(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase();
  return ['S', 'C', 'R', 'RS', 'RC'].includes(normalized) ? normalized : '';
}

function isReprintOrderType(value) {
  return normalizeOrderType(value).startsWith('R');
}

function candidateTimestamp(row) {
  const value = row && row.queued_date_time;
  const time =
    value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function sortProcessedOrderCandidates(rows) {
  return [...rows].sort((left, right) => {
    const timeDiff = candidateTimestamp(right) - candidateTimestamp(left);
    if (timeDiff) return timeDiff;
    return Number(right.id || 0) - Number(left.id || 0);
  });
}

function summarizeProcessedOrderCandidate(row) {
  return {
    id: row.id,
    orderName: row.order_name,
    orderType: row.order_type || null,
    status: row.status || null,
    queuedDateTime:
      row.queued_date_time instanceof Date
        ? row.queued_date_time.toISOString()
        : String(row.queued_date_time || ''),
  };
}

function makeCandidateDebug(candidates, rows) {
  return {
    attempted_keys: candidates,
    db_candidate_count: rows.length,
    candidates: rows.map(summarizeProcessedOrderCandidate),
  };
}

function matchDiagnostic(scan, match) {
  return {
    scanId: scan.scanId,
    barcode: scan.barcode,
    normalizedBarcode: scan.barcode,
    orderNumber: scan.orderNumber,
    orderType: scan.orderType || null,
    isReprint: Boolean(scan.isReprint),
    status: match.status,
    reason_code: match.reasonCode || null,
    reason: match.reason || '',
    candidate_debug: match.candidateDebug || {
      attempted_keys: orderCandidatesForScan(scan),
      db_candidate_count: 0,
      candidates: [],
    },
  };
}

function chooseSingleCandidateByPriority(candidates, rows, predicate) {
  for (const candidate of candidates) {
    const matchingRows = rows
      .filter((row) => row.order_name === candidate)
      .filter(predicate);
    if (matchingRows.length === 1) {
      return { row: matchingRows[0], candidate, ambiguousRows: [] };
    }
    if (matchingRows.length > 1) {
      return { row: null, candidate, ambiguousRows: matchingRows };
    }
  }
  return { row: null, candidate: '', ambiguousRows: [] };
}

function buildProcessedOrderMatch(scan, candidates, rows) {
  const candidateDebug = makeCandidateDebug(candidates, rows);
  if (!candidates.length) {
    return {
      status: 'unmatched',
      reasonCode: 'no_scan_candidate',
      reason: 'scan has no orderNumber or barcode candidate',
      candidateDebug,
    };
  }
  if (!rows.length) {
    return {
      status: 'unmatched',
      reasonCode: 'no_processed_order_candidate',
      reason: `no processed_print_orders.order_name match for ${candidates.join(', ')}`,
      candidateDebug,
    };
  }

  const scannedOrderType = normalizeOrderType(scan.orderType);
  if (scannedOrderType) {
    const typedChoice = chooseSingleCandidateByPriority(
      candidates,
      rows,
      (row) => normalizeOrderType(row.order_type) === scannedOrderType,
    );
    if (typedChoice.row) {
      return {
        status: 'matched',
        processedOrderId: typedChoice.row.id,
        orderName: typedChoice.row.order_name,
        reasonCode: 'exact_order_type_match',
        reason: `exact order_name and order_type ${scannedOrderType} match`,
        candidateDebug,
      };
    }
    if (typedChoice.ambiguousRows.length) {
      return {
        status: 'ambiguous',
        reasonCode: 'multiple_order_type_candidates',
        reason: `multiple processed_print_orders.order_name and order_type ${scannedOrderType} matches for ${typedChoice.candidate}`,
        candidateDebug,
      };
    }
    return {
      status: 'unmatched',
      reasonCode: 'no_order_type_candidate',
      reason: `no processed_print_orders.order_type ${scannedOrderType} match for ${candidates.join(', ')}`,
      candidateDebug,
    };
  }

  if (!scan.isReprint) {
    const normalChoice = chooseSingleCandidateByPriority(
      candidates,
      rows,
      (row) => !isReprintOrderType(row.order_type),
    );
    if (normalChoice.row) {
      return {
        status: 'matched',
        processedOrderId: normalChoice.row.id,
        orderName: normalChoice.row.order_name,
        reasonCode: 'normal_scan_non_reprint_match',
        reason: 'normal scan matched the non-reprint processed order',
        candidateDebug,
      };
    }
    if (normalChoice.ambiguousRows.length) {
      return {
        status: 'ambiguous',
        reasonCode: 'multiple_non_reprint_candidates',
        reason: `multiple non-reprint processed_print_orders.order_name matches for ${normalChoice.candidate}`,
        candidateDebug,
      };
    }
    return {
      status: 'unmatched',
      reasonCode: 'only_reprint_candidates',
      reason: `only reprint processed_print_orders.order_name matches for normal scan ${candidates.join(', ')}`,
      candidateDebug,
    };
  }

  if (rows.length === 1) {
    return {
      status: 'matched',
      processedOrderId: rows[0].id,
      orderName: rows[0].order_name,
      reasonCode: 'exact_order_name_match',
      reason: 'exact order_name match',
      candidateDebug,
    };
  }
  return {
    status: 'ambiguous',
    reasonCode: 'multiple_order_name_candidates',
    reason: `multiple processed_print_orders.order_name matches for ${candidates.join(', ')}`,
    candidateDebug,
  };
}

async function fetchProcessedOrderCandidateRows(client, candidates) {
  const keys = Array.from(
    new Set((candidates || []).map(cleanBarcode).filter(Boolean)),
  );
  if (!keys.length) return [];
  const result = await client.query(
    `
      select id, order_name, order_type, status, queued_date_time
      from public.processed_print_orders
      where coalesce(ignored, false) = false
        and order_name = any($1::text[])
      order by queued_date_time desc nulls last, id desc
    `,
    [keys],
  );
  const unique = new Map();
  result.rows.forEach((row) => unique.set(String(row.id), row));
  return sortProcessedOrderCandidates(Array.from(unique.values()));
}

async function fetchProcessedOrderCandidateLookup(client, scans) {
  const keys = new Set();
  (scans || []).forEach((scan) => {
    if (!scan || scan.isReprint) return;
    orderCandidatesForScan(scan).forEach((candidate) => keys.add(candidate));
  });
  const rows = await fetchProcessedOrderCandidateRows(client, Array.from(keys));
  const lookup = new Map();
  rows.forEach((row) => {
    const key = String(row.order_name || '');
    if (!key) return;
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key).push(row);
  });
  return lookup;
}

function candidateRowsFromLookup(candidates, lookup) {
  const unique = new Map();
  for (const candidate of candidates) {
    const rows = lookup && lookup.get(candidate) ? lookup.get(candidate) : [];
    rows.forEach((row) => unique.set(String(row.id), row));
  }
  return sortProcessedOrderCandidates(Array.from(unique.values()));
}

async function findProcessedOrderMatch(client, scan, candidateLookup = null) {
  const candidates = orderCandidatesForScan(scan);
  const rows = candidateLookup
    ? candidateRowsFromLookup(candidates, candidateLookup)
    : await fetchProcessedOrderCandidateRows(client, candidates);
  return buildProcessedOrderMatch(scan, candidates, rows);
}

async function findPendingReprintRequestMatch(client, scan) {
  const candidates = orderCandidatesForScan(scan);
  if (!candidates.length) {
    return {
      status: 'unmatched',
      reasonCode: 'no_reprint_scan_candidate',
      reason: 'reprint scan has no orderNumber candidate',
      candidateDebug: {
        attempted_keys: candidates,
        db_candidate_count: 0,
        candidates: [],
      },
    };
  }
  const result = await client.query(
    `
      select
        r.id,
        r.order_id,
        r.order_name,
        r.print_file_path,
        r.status,
        p.order_name as processed_order_name
      from public.processed_order_reprint_requests r
      join public.processed_print_orders p on p.id = r.order_id
      where lower(coalesce(r.status, '')) = any($2::text[])
        and coalesce(p.ignored, false) = false
        and (
          r.order_name = any($1::text[])
          or p.order_name = any($1::text[])
        )
      order by r.requested_at desc nulls last, r.id desc
      limit 1
    `,
    [candidates, ACTIVE_REPRINT_STATUSES],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      status: 'unmatched',
      reasonCode: 'no_pending_reprint_request',
      reason: `reprint scan has no pending reprint request for ${candidates.join(', ')}`,
      candidateDebug: {
        attempted_keys: candidates,
        db_candidate_count: 0,
        candidates: [],
      },
    };
  }
  return {
    status: 'matched',
    processedOrderId: row.order_id,
    orderName: row.processed_order_name || row.order_name,
    reprintRequestId: row.id,
    printFilePath: row.print_file_path || '',
    reasonCode: 'pending_reprint_request_match',
    reason: `pending reprint request ${row.id} matched`,
    candidateDebug: {
      attempted_keys: candidates,
      db_candidate_count: 1,
      candidates: [
        {
          id: row.order_id,
          orderName: row.processed_order_name || row.order_name,
          orderType: null,
          status: row.status || null,
          reprintRequestId: row.id,
        },
      ],
    },
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
        order_type,
        is_reprint,
        reprint_kind,
        station,
        operator,
        source,
        commit_batch_id,
        committed_at,
        committed_by,
        match_status
      )
      values ($1, $2, $3, $4, $5, $6, $7::boolean, $8, $9, $10, $11, $12, $13, nullif($14, ''), 'pending')
      on conflict (scan_id) do nothing
      returning scan_id
    `,
    [
      scan.scanId,
      scan.scannedAt,
      scan.barcode,
      scan.rawBarcode,
      scan.orderNumber,
      scan.orderType || null,
      Boolean(scan.isReprint),
      scan.reprintKind || null,
      scan.station || null,
      scan.operator || null,
      scan.source || 'job_label_scan',
      batchId,
      committedAt,
      committedBy || '',
    ],
  );
  return result.rowCount === 1;
}

async function insertScans(client, scans, batchId, committedAt, committedBy) {
  if (!scans.length) return new Set();
  const result = await client.query(
    `
      insert into public.print_job_label_scans (
        scan_id,
        scanned_at,
        barcode,
        raw_barcode,
        order_number,
        order_type,
        is_reprint,
        reprint_kind,
        station,
        operator,
        source,
        commit_batch_id,
        committed_at,
        committed_by,
        match_status
      )
      select
        scan_id,
        scanned_at::timestamptz,
        barcode,
        raw_barcode,
        order_number,
        nullif(order_type, ''),
        is_reprint,
        nullif(reprint_kind, ''),
        nullif(station, ''),
        nullif(operator_name, ''),
        source,
        $13,
        $14::timestamptz,
        nullif($15, ''),
        'pending'
      from unnest(
        $1::text[],
        $2::text[],
        $3::text[],
        $4::text[],
        $5::text[],
        $6::text[],
        $7::boolean[],
        $8::text[],
        $9::text[],
        $10::text[],
        $11::text[],
        $12::text[]
      ) as rows(
        scan_id,
        scanned_at,
        barcode,
        raw_barcode,
        order_number,
        order_type,
        is_reprint,
        reprint_kind,
        station,
        operator_name,
        source,
        committed_by_from_scan
      )
      on conflict (scan_id) do nothing
      returning scan_id
    `,
    [
      scans.map((scan) => scan.scanId),
      scans.map((scan) => scan.scannedAt),
      scans.map((scan) => scan.barcode),
      scans.map((scan) => scan.rawBarcode),
      scans.map((scan) => scan.orderNumber),
      scans.map((scan) => scan.orderType || ''),
      scans.map((scan) => Boolean(scan.isReprint)),
      scans.map((scan) => scan.reprintKind || ''),
      scans.map((scan) => scan.station || ''),
      scans.map((scan) => scan.operator || ''),
      scans.map((scan) => scan.source || 'job_label_scan'),
      scans.map((scan) => committedBy || scan.operator || ''),
      batchId,
      committedAt,
      committedBy || '',
    ],
  );
  return new Set((result.rows || []).map((row) => String(row.scan_id || '')));
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
    ],
  );
}

async function updateScanMatches(client, updates) {
  const rows = (updates || []).filter((item) => item?.scan?.scanId);
  if (!rows.length) return;
  await client.query(
    `
      update public.print_job_label_scans s
      set match_status = rows.match_status,
          match_reason = nullif(rows.match_reason, ''),
          matched_processed_order_id = rows.processed_order_id,
          matched_order_name = rows.order_name,
          updated_at = now()
      from unnest(
        $1::text[],
        $2::text[],
        $3::text[],
        $4::bigint[],
        $5::text[]
      ) as rows(
        scan_id,
        match_status,
        match_reason,
        processed_order_id,
        order_name
      )
      where s.scan_id = rows.scan_id
    `,
    [
      rows.map(({ scan }) => scan.scanId),
      rows.map(({ match }) => match.status),
      rows.map(({ match }) => match.reason || ''),
      rows.map(({ match }) => match.processedOrderId || null),
      rows.map(({ match }) => match.orderName || null),
    ],
  );
}

async function markProcessedOrderPhysicallyPrinted(
  client,
  scan,
  match,
  batchId,
  committedBy,
  fallbackStation,
) {
  const result = await client.query(
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
    ],
  );
  return result.rowCount;
}

async function markProcessedOrdersPhysicallyPrintedBulk(
  client,
  updates,
  batchId,
  committedBy,
  fallbackStation,
) {
  const rows = (updates || []).filter(
    (item) => item?.scan?.scanId && item?.match?.processedOrderId,
  );
  if (!rows.length) return new Set();
  const result = await client.query(
    `
      update public.processed_print_orders p
      set physically_printed_at = rows.scanned_at::timestamptz,
          physically_printed_by = nullif(rows.printed_by, ''),
          physically_printed_station = nullif(rows.station, ''),
          physically_printed_scan_id = rows.scan_id,
          physically_printed_batch_id = $7,
          updated_at = now()
      from unnest(
        $1::bigint[],
        $2::text[],
        $3::text[],
        $4::text[],
        $5::text[],
        $6::text[]
      ) as rows(
        processed_order_id,
        scanned_at,
        printed_by,
        station,
        scan_id,
        order_name
      )
      where p.id = rows.processed_order_id
      returning p.id
    `,
    [
      rows.map(({ match }) => match.processedOrderId),
      rows.map(({ scan }) => scan.scannedAt),
      rows.map(({ scan }) => committedBy || scan.operator || ''),
      rows.map(({ scan }) => scan.station || fallbackStation || ''),
      rows.map(({ scan }) => scan.scanId),
      rows.map(({ match }) => match.orderName || ''),
      batchId,
    ],
  );
  return new Set((result.rows || []).map((row) => Number(row.id)));
}

async function completeReprintRequestFromScan(
  client,
  scan,
  match,
  batchId,
  committedBy,
) {
  const result = await client.query(
    `
      update public.processed_order_reprint_requests
      set status = 'done',
          confirmed_at = coalesce(confirmed_at, $2::timestamptz),
          confirmed_by = coalesce(confirmed_by, nullif($3::text, '')),
          order_type = nullif($4::text, ''),
          reprint_kind = nullif($5::text, ''),
          scan_barcode = nullif($6::text, ''),
          scan_raw_barcode = nullif($7::text, ''),
          completed_scan_id = nullif($8::text, ''),
          completed_batch_id = nullif($9::text, '')
      where id = $1
        and lower(coalesce(status, '')) = any($10::text[])
      returning id, order_id, order_name, print_file_path, status, confirmed_at, confirmed_by
    `,
    [
      match.reprintRequestId,
      scan.scannedAt,
      committedBy || scan.operator || '',
      scan.orderType || '',
      scan.reprintKind || '',
      scan.barcode || '',
      scan.rawBarcode || scan.barcode || '',
      scan.scanId,
      batchId,
      ACTIVE_REPRINT_STATUSES,
    ],
  );
  const row = result.rows[0];
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    orderName: row.order_name,
    printFilePath: row.print_file_path,
    status: row.status,
    confirmedAt:
      row.confirmed_at instanceof Date
        ? row.confirmed_at.toISOString()
        : String(row.confirmed_at || ''),
    confirmedBy: row.confirmed_by,
  };
}

async function commitBrowserScanBatch(client, input) {
  await ensureScanCommitSchema(client);
  const startedMs = Date.now();
  const committedAt = new Date().toISOString();
  const committedBy = safeText(input.committedBy || input.operator, 100);
  const station = safeText(input.station, 100);
  const batchId =
    normalizeBatchId(input.batchId || input.batch_id) ||
    makeBatchId(new Date(committedAt));
  const observedContext = {
    batchId,
    phase: 'init',
  };
  const observedClient = createObservedClient(client, observedContext);
  client = observedClient;
  const rawScans = Array.isArray(input.scans) ? input.scans : [];
  const performance = {};
  const summary = {
    ok: true,
    batchId,
    totalScansRead: rawScans.length,
    newScansCommitted: 0,
    matchedCount: 0,
    unmatchedCount: 0,
    ambiguousCount: 0,
    duplicateCount: 0,
    printedScans: 0,
    reprintScans: 0,
    reprintCompletedScans: 0,
    reprintUnmatchedCount: 0,
    skippedAlreadyCommitted: 0,
    errorCount: 0,
    committedScanIds: [],
    processedScanIds: [],
    duplicateScanIds: [],
    errorScanIds: [],
    matchDiagnostics: [],
    warnings: [],
    errors: [],
    commitOk: true,
    status: 'processing',
    retryMode: 'fresh',
    batchStatusBefore: null,
    batchStatusAfter: null,
    insertedScanRows: 0,
    existingSameBatchRows: 0,
    finalizedRows: 0,
    rowsEligibleForMatching: 0,
    orderUpdateCount: 0,
    failedPhase: null,
    errorMessage: null,
    performance,
  };
  structuredLog('request-received', {
    batchId,
    scanCount: rawScans.length,
    startedAt: committedAt,
    committedBy,
    station,
  });
  observedContext.phase = 'normalize';
  const normalizeStartMs = Date.now();
  const scansById = new Map();
  rawScans.forEach((row, index) => {
    const normalized = normalizeScan(row);
    if (!normalized.scan) {
      summary.errorCount += 1;
      summary.errors.push({ index, error: normalized.error });
      return;
    }
    if (scansById.has(normalized.scan.scanId)) {
      summary.duplicateCount += 1;
      summary.duplicateScanIds.push(normalized.scan.scanId);
      return;
    }
    scansById.set(normalized.scan.scanId, normalized.scan);
  });
  const scans = Array.from(scansById.values());
  performance.normalizeMs = Date.now() - normalizeStartMs;
  structuredLog('phase', {
    batchId,
    status: 'normalized',
    scanCount: rawScans.length,
    normalizedScanCount: scans.length,
    duplicateCount: summary.duplicateCount,
    errorCount: summary.errorCount,
    phaseDurationMs: performance.normalizeMs,
  });

  observedContext.phase = 'prepare_batch';
  const prepareStartMs = Date.now();
  const preparedBatch = await prepareBatchForCommit(
    client,
    batchId,
    committedAt,
    committedBy,
    station,
  );
  performance.prepareBatchMs = Date.now() - prepareStartMs;
  structuredLog('phase', {
    batchId,
    status: 'prepare_batch',
    action: preparedBatch.action,
    retryMode: preparedBatch.retryMode,
    phaseDurationMs: performance.prepareBatchMs,
  });
  summary.retryMode = preparedBatch.retryMode;
  summary.batchStatusBefore = preparedBatch.batch
    ? String(preparedBatch.batch.status || '')
    : null;

  if (preparedBatch.action === 'already_completed') {
    const status = formatBatchStatus(preparedBatch.batch);
    performance.totalDurationMs = Date.now() - startedMs;
    performance.dbQueries = client.getDbTimings
      ? client.getDbTimings()
      : undefined;
    structuredLog('request-finished', {
      batchId,
      status: 'already_completed',
      scanCount: rawScans.length,
      matchedCount: status.matchedCount,
      unmatchedCount: status.unmatchedCount,
      duplicateCount: status.duplicateCount,
      errorCount: status.errorCount,
      performance,
    });
    return {
      ...summary,
      ...status,
      ok: true,
      commitOk: true,
      status: 'already_completed',
      retryMode: 'already_committed_duplicate',
      batchStatusAfter: status.rawStatus || 'matched',
      newScansCommitted: 0,
      matchedCount: status.matchedCount,
      unmatchedCount: status.unmatchedCount,
      duplicateCount: status.duplicateCount,
      errorCount: status.errorCount,
      performance,
      message: 'Batch was already completed.',
    };
  }

  if (preparedBatch.action === 'processing') {
    const status = formatBatchStatus(preparedBatch.batch);
    performance.totalDurationMs = Date.now() - startedMs;
    performance.dbQueries = client.getDbTimings
      ? client.getDbTimings()
      : undefined;
    structuredLog('request-finished', {
      batchId,
      status: status.status === 'received' ? 'processing' : status.status,
      activeBackend: true,
      scanCount: rawScans.length,
      performance,
    });
    return {
      ...summary,
      ...status,
      ok: true,
      commitOk: null,
      status: status.status === 'received' ? 'processing' : status.status,
      retryMode: preparedBatch.retryMode,
      batchStatusAfter: status.rawStatus || status.status,
      performance,
      message: 'Batch is still processing.',
    };
  }

  observedContext.phase = 'matching_phase_update';
  await updateBatchPhase(client, batchId, 'matching', {
    retryMode: summary.retryMode,
  });
  observedContext.phase = 'transaction_begin';
  await client.query('begin');
  let failedPhase = 'begin';
  try {
    failedPhase = 'existing_scan_lookup';
    observedContext.phase = failedPhase;
    const existingLookupStartMs = Date.now();
    const requestScanIds = scans.map((scan) => scan.scanId);
    const existingById = await fetchExistingScansById(client, requestScanIds);
    performance.existingScanLookupMs = Date.now() - existingLookupStartMs;
    structuredLog('phase', {
      batchId,
      status: failedPhase,
      scanCount: requestScanIds.length,
      existingCount: existingById.size,
      phaseDurationMs: performance.existingScanLookupMs,
    });

    failedPhase = 'insert_scan_rows';
    observedContext.phase = failedPhase;
    const insertStartMs = Date.now();
    const scansToInsert = [];
    for (const scan of scans) {
      const existing = existingById.get(scan.scanId);
      if (!existing) {
        scansToInsert.push(scan);
        continue;
      }
      if (String(existing.commit_batch_id || '') === batchId) {
        summary.existingSameBatchRows += 1;
        continue;
      }
      summary.duplicateCount += 1;
      summary.skippedAlreadyCommitted += 1;
      summary.duplicateScanIds.push(scan.scanId);
    }

    if (scansToInsert.length) {
      const insertedScanIds = await insertScans(
        client,
        scansToInsert,
        batchId,
        committedAt,
        committedBy,
      );
      for (const scan of scansToInsert) {
        if (insertedScanIds.has(scan.scanId)) {
          summary.newScansCommitted += 1;
          summary.insertedScanRows += 1;
          summary.committedScanIds.push(scan.scanId);
          continue;
        }
        const racedRows = await fetchExistingScansById(client, [scan.scanId]);
        const raced = racedRows.get(scan.scanId);
        if (raced && String(raced.commit_batch_id || '') === batchId) {
          summary.existingSameBatchRows += 1;
        } else {
          summary.duplicateCount += 1;
          summary.skippedAlreadyCommitted += 1;
          summary.duplicateScanIds.push(scan.scanId);
        }
      }
    }
    performance.insertScanRowsMs = Date.now() - insertStartMs;
    structuredLog('phase', {
      batchId,
      status: failedPhase,
      insertedScanRows: summary.insertedScanRows,
      existingSameBatchRows: summary.existingSameBatchRows,
      duplicateCount: summary.duplicateCount,
      phaseDurationMs: performance.insertScanRowsMs,
    });

    failedPhase = 'same_batch_scan_lookup';
    observedContext.phase = failedPhase;
    const sameBatchLookupStartMs = Date.now();
    const sameBatchRowsById = await fetchExistingScansById(
      client,
      requestScanIds,
    );
    const sameBatchScans = [];
    for (const scan of scans) {
      const row = sameBatchRowsById.get(scan.scanId);
      if (!row || String(row.commit_batch_id || '') !== batchId) continue;
      const existingScan = scanFromDbRow(row);
      const requested = scansById.get(scan.scanId) || {};
      sameBatchScans.push({ ...requested, ...existingScan });
    }
    const eligibleScans = sameBatchScans.filter(
      (scan) => scan.matchStatus === 'pending' || scan.matchStatus === 'error',
    );
    summary.finalizedRows = sameBatchScans.length - eligibleScans.length;
    summary.rowsEligibleForMatching = eligibleScans.length;
    performance.sameBatchScanLookupMs = Date.now() - sameBatchLookupStartMs;
    structuredLog('phase', {
      batchId,
      status: failedPhase,
      sameBatchRows: sameBatchScans.length,
      finalizedRows: summary.finalizedRows,
      rowsEligibleForMatching: summary.rowsEligibleForMatching,
      phaseDurationMs: performance.sameBatchScanLookupMs,
    });

    failedPhase = 'candidate_lookup';
    observedContext.phase = failedPhase;
    const candidateLookupStartMs = Date.now();
    const processedOrderCandidateLookup =
      await fetchProcessedOrderCandidateLookup(client, eligibleScans);
    performance.candidateLookupMs = Date.now() - candidateLookupStartMs;
    structuredLog('phase', {
      batchId,
      status: failedPhase,
      rowsEligibleForMatching: summary.rowsEligibleForMatching,
      candidateKeyCount: processedOrderCandidateLookup.size,
      phaseDurationMs: performance.candidateLookupMs,
    });

    failedPhase = 'matching';
    observedContext.phase = failedPhase;
    const matchingStartMs = Date.now();
    const normalScans = eligibleScans.filter((scan) => !scan.isReprint);
    const reprintScans = eligibleScans.filter((scan) => scan.isReprint);
    const normalMatchedUpdates = [];
    const normalScanMatchUpdates = [];
    const duplicateProcessedOrderIds = new Set();
    const seenProcessedOrderIds = new Set();
    for (const scan of normalScans) {
      const match = await findProcessedOrderMatch(
        client,
        scan,
        processedOrderCandidateLookup,
      );
      if (match.status !== 'matched') {
        normalScanMatchUpdates.push({ scan, match });
        if (match.status === 'ambiguous') {
          summary.ambiguousCount += 1;
        } else {
          summary.unmatchedCount += 1;
        }
        summary.processedScanIds.push(scan.scanId);
        summary.matchDiagnostics.push(matchDiagnostic(scan, match));
        continue;
      }
      const processedOrderId = Number(match.processedOrderId);
      if (seenProcessedOrderIds.has(processedOrderId)) {
        duplicateProcessedOrderIds.add(processedOrderId);
      }
      seenProcessedOrderIds.add(processedOrderId);
      normalMatchedUpdates.push({ scan, match });
    }
    const bulkMatchedUpdates = normalMatchedUpdates.filter(
      ({ match }) => !duplicateProcessedOrderIds.has(Number(match.processedOrderId)),
    );
    const perScanMatchedUpdates = normalMatchedUpdates.filter(({ match }) =>
      duplicateProcessedOrderIds.has(Number(match.processedOrderId)),
    );
    const updatedProcessedOrderIds = await markProcessedOrdersPhysicallyPrintedBulk(
      client,
      bulkMatchedUpdates,
      batchId,
      committedBy,
      station,
    );
    for (const { scan, match } of bulkMatchedUpdates) {
      if (updatedProcessedOrderIds.has(Number(match.processedOrderId))) {
        normalScanMatchUpdates.push({ scan, match });
        summary.matchedCount += 1;
        summary.printedScans += 1;
        summary.orderUpdateCount += 1;
        summary.processedScanIds.push(scan.scanId);
        continue;
      }
      const failedUpdate = {
        status: 'error',
        reasonCode: 'processed_order_update_failed',
        reason: `processed order ${match.processedOrderId} was not updated`,
        processedOrderId: match.processedOrderId,
        orderName: match.orderName,
        candidateDebug: match.candidateDebug,
      };
      normalScanMatchUpdates.push({ scan, match: failedUpdate });
      summary.errorCount += 1;
      summary.errorScanIds.push(scan.scanId);
      summary.errors.push({
        scanId: scan.scanId,
        barcode: scan.barcode,
        error: failedUpdate.reason,
      });
    }
    for (let index = 0; index < perScanMatchedUpdates.length; index += 1) {
      const { scan, match } = perScanMatchedUpdates[index];
      const savepoint = `browser_scan_commit_normal_${index}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        const updated = await markProcessedOrderPhysicallyPrinted(
          client,
          scan,
          match,
          batchId,
          committedBy,
          station,
        );
        if (updated > 0) {
          normalScanMatchUpdates.push({ scan, match });
          summary.matchedCount += 1;
          summary.printedScans += 1;
          summary.orderUpdateCount += updated;
          summary.processedScanIds.push(scan.scanId);
        } else {
          const failedUpdate = {
            status: 'error',
            reasonCode: 'processed_order_update_failed',
            reason: `processed order ${match.processedOrderId} was not updated`,
            processedOrderId: match.processedOrderId,
            orderName: match.orderName,
            candidateDebug: match.candidateDebug,
          };
          normalScanMatchUpdates.push({ scan, match: failedUpdate });
          summary.errorCount += 1;
          summary.errorScanIds.push(scan.scanId);
          summary.errors.push({
            scanId: scan.scanId,
            barcode: scan.barcode,
            error: failedUpdate.reason,
          });
        }
        await client.query(`release savepoint ${savepoint}`);
      } catch (error) {
        await client.query(`rollback to savepoint ${savepoint}`);
        await client.query(`release savepoint ${savepoint}`);
        const failedUpdate = {
          status: 'error',
          reason: error.message || String(error),
          processedOrderId: null,
          orderName: null,
        };
        normalScanMatchUpdates.push({ scan, match: failedUpdate });
        summary.errorCount += 1;
        summary.errorScanIds.push(scan.scanId);
        summary.errors.push({
          scanId: scan.scanId,
          barcode: scan.barcode,
          error: error.message || String(error),
        });
      }
    }
    await updateScanMatches(client, normalScanMatchUpdates);
    for (let index = 0; index < reprintScans.length; index += 1) {
      const scan = reprintScans[index];
      if (index > 0 && index % 25 === 0) {
        structuredLog('matching-progress', {
          batchId,
          processed: normalScans.length + index,
          total: eligibleScans.length,
          matchedCount: summary.matchedCount,
          unmatchedCount: summary.unmatchedCount,
          duplicateCount: summary.duplicateCount,
          errorCount: summary.errorCount,
          elapsedMs: Date.now() - matchingStartMs,
        });
      }
      const savepoint = `browser_scan_commit_${index}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        if (scan.isReprint) {
          summary.reprintScans += 1;
          const match = await findPendingReprintRequestMatch(client, scan);
          if (match.status === 'matched') {
            const completed = await completeReprintRequestFromScan(
              client,
              scan,
              match,
              batchId,
              committedBy,
            );
            if (completed) {
              await updateScanMatch(client, scan, match);
              summary.matchedCount += 1;
              summary.reprintCompletedScans += 1;
              summary.orderUpdateCount += 1;
              summary.processedScanIds.push(scan.scanId);
            } else {
              const staleMatch = {
                status: 'unmatched',
                reasonCode: 'reprint_request_already_completed',
                reason: `pending reprint request ${match.reprintRequestId} was already completed`,
                processedOrderId: match.processedOrderId,
                orderName: match.orderName,
                candidateDebug: match.candidateDebug,
              };
              await updateScanMatch(client, scan, staleMatch);
              summary.unmatchedCount += 1;
              summary.reprintUnmatchedCount += 1;
              summary.processedScanIds.push(scan.scanId);
              summary.matchDiagnostics.push(matchDiagnostic(scan, staleMatch));
              summary.warnings.push({
                scanId: scan.scanId,
                barcode: scan.barcode,
                warning: staleMatch.reason,
              });
            }
          } else {
            await updateScanMatch(client, scan, match);
            summary.unmatchedCount += 1;
            summary.reprintUnmatchedCount += 1;
            summary.processedScanIds.push(scan.scanId);
            summary.matchDiagnostics.push(matchDiagnostic(scan, match));
            summary.warnings.push({
              scanId: scan.scanId,
              barcode: scan.barcode,
              warning: match.reason,
            });
          }
        }
        await client.query(`release savepoint ${savepoint}`);
      } catch (error) {
        await client.query(`rollback to savepoint ${savepoint}`);
        await client.query(`release savepoint ${savepoint}`);
        await updateScanMatch(client, scan, {
          status: 'error',
          reason: error.message || String(error),
          processedOrderId: null,
          orderName: null,
        }).catch(() => {});
        summary.errorCount += 1;
        summary.errorScanIds.push(scan.scanId);
        summary.errors.push({
          scanId: scan.scanId,
          barcode: scan.barcode,
          error: error.message || String(error),
        });
      }
    }
    performance.matchingMs = Date.now() - matchingStartMs;
    structuredLog('phase', {
      batchId,
      status: failedPhase,
      rowsEligibleForMatching: summary.rowsEligibleForMatching,
      matchedCount: summary.matchedCount,
      unmatchedCount: summary.unmatchedCount,
      ambiguousCount: summary.ambiguousCount,
      errorCount: summary.errorCount,
      orderUpdateCount: summary.orderUpdateCount,
      phaseDurationMs: performance.matchingMs,
    });
    failedPhase = 'finalize';
    observedContext.phase = failedPhase;
    const finalizeStartMs = Date.now();
    performance.dbQueries = client.getDbTimings
      ? client.getDbTimings()
      : undefined;
    const aggregate = await finalizeBatch(client, batchId, summary, {
      retryMode: summary.retryMode,
      batchStatusBefore: summary.batchStatusBefore,
      insertedScanRows: summary.insertedScanRows,
      existingSameBatchRows: summary.existingSameBatchRows,
      finalizedRows: summary.finalizedRows,
      rowsEligibleForMatching: summary.rowsEligibleForMatching,
      orderUpdateCount: summary.orderUpdateCount,
      performance,
      warnings: summary.warnings,
      errors: summary.errors,
      failedPhase: summary.errors.length ? 'matching' : null,
      errorMessage: summary.errors[0] ? summary.errors[0].error : null,
    });
    performance.finalizeMs = Date.now() - finalizeStartMs;
    performance.totalDurationMs = Date.now() - startedMs;
    performance.dbQueries = client.getDbTimings
      ? client.getDbTimings()
      : undefined;
    observedContext.phase = 'finalize_diagnostics';
    await updateBatchDiagnostics(client, batchId, {
      performance,
      finishedAt: nowIso(),
    });
    summary.batchStatusAfter =
      summary.errorCount > 0 ||
      Number(aggregate.error_count || 0) > 0 ||
      Number(aggregate.unmatched_count || 0) > 0 ||
      Number(aggregate.ambiguous_count || 0) > 0 ||
      Number(aggregate.matched_count || 0) === 0
        ? 'partial'
        : 'matched';
    summary.status = summary.batchStatusAfter;
    summary.matchedCount = Number(aggregate.matched_count || 0);
    summary.unmatchedCount = Number(aggregate.unmatched_count || 0);
    summary.ambiguousCount = Number(aggregate.ambiguous_count || 0);
    summary.errorCount = Math.max(
      summary.errorCount,
      Number(aggregate.error_count || 0),
    );
    const anyCommittedOrProcessed =
      summary.newScansCommitted > 0 || summary.rowsEligibleForMatching > 0;
    summary.commitOk = summary.matchedCount > 0 || !anyCommittedOrProcessed;
    if (!summary.commitOk) {
      summary.warnings.push({
        reasonCode: 'zero_match_commit',
        warning:
          'Scans were committed or retried, but no processed order was matched or updated.',
      });
    }
    await client.query('commit');
    structuredLog('request-finished', {
      batchId,
      status: summary.status,
      finishedAt: nowIso(),
      scanCount: rawScans.length,
      matchedCount: summary.matchedCount,
      unmatchedCount: summary.unmatchedCount,
      duplicateCount: summary.duplicateCount,
      errorCount: summary.errorCount,
      performance,
    });
    return summary;
  } catch (error) {
    performance.totalDurationMs = Date.now() - startedMs;
    performance.dbQueries = client.getDbTimings
      ? client.getDbTimings()
      : undefined;
    await client.query('rollback').catch(() => {});
    await client
      .query(
        `
        update public.print_scan_commit_batches
        set status = 'failed',
            diagnostics = $2::jsonb,
            failed_phase = $3,
            error_message = $4,
            finished_at = now(),
            updated_at = now()
        where batch_id = $1
      `,
        [
          batchId,
          JSON.stringify({
            error: error.message || String(error),
            retryMode: summary.retryMode,
            failedPhase,
            performance: {
              ...performance,
            },
          }),
          failedPhase,
          error.message || String(error),
        ],
      )
      .catch(() => {});
    structuredLog('request-failed', {
      batchId,
      scanCount: rawScans.length,
      failedPhase,
      message: error.message || String(error),
      performance,
    });
    throw error;
  }
}

exports.handler = async function handler(event) {
  const requestStartedMs = Date.now();
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }
  try {
    requirePostPurchaseAccess(event);
    if (event.httpMethod === 'GET') {
      checkRateLimit(event, {
        name: 'scan-batch-status',
        maxRequests: 80,
        windowMs: 60 * 1000,
      });
      const batchId =
        event.queryStringParameters && event.queryStringParameters.batchId;
      const body = await withClient(async (client) => {
        const status = await getBatchStatus(client, batchId);
        if (!status) {
          const error = new Error('Batch not found');
          error.statusCode = 404;
          throw error;
        }
        return status;
      });
      structuredLog('status-response', {
        batchId: body.batchId,
        status: body.status,
        rawStatus: body.rawStatus,
        currentPhase: body.currentPhase,
        scanCount: body.scanCount,
        matchedCount: body.matchedCount,
        unmatchedCount: body.unmatchedCount,
        duplicateCount: body.duplicateCount,
        errorCount: body.errorCount,
        requestDurationMs: Date.now() - requestStartedMs,
      });
      return json(200, body);
    }
    checkRateLimit(event, {
      name: 'commit-scan-batch',
      maxRequests: 20,
      windowMs: 60 * 1000,
    });
    const input = parseRequestBody(event);
    const body = await withClient((client) =>
      commitBrowserScanBatch(client, input),
    );
    structuredLog('http-response', {
      batchId: body.batchId,
      status: body.status,
      scanCount: body.totalScansRead,
      matchedCount: body.matchedCount,
      unmatchedCount: body.unmatchedCount,
      duplicateCount: body.duplicateCount,
      errorCount: body.errorCount,
      requestDurationMs: Date.now() - requestStartedMs,
      backendDurationMs: body.performance && body.performance.totalDurationMs,
    });
    return json(200, body);
  } catch (error) {
    const statusCode = error && error.statusCode ? error.statusCode : 500;
    const message =
      error && error.message ? error.message : 'commit-scan-batch failed';
    structuredLog('http-error', {
      statusCode,
      message,
      requestDurationMs: Date.now() - requestStartedMs,
    });
    return json(statusCode, { ok: false, error: message });
  }
};

exports._private = {
  commitBrowserScanBatch,
  completeReprintRequestFromScan,
  fetchProcessedOrderCandidateLookup,
  fetchProcessedOrderCandidateRows,
  formatBatchStatus,
  getBatchStatus,
  findPendingReprintRequestMatch,
  findProcessedOrderMatch,
  normalizeScan,
  orderCandidatesForScan,
};
