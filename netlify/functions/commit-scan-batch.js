'use strict';

const crypto = require('crypto');
const {
  checkRateLimit,
  json,
  parseRequestBody,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const { ensureProcessedPrintOrderTables } = require('./_lib/processed-print-orders');
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
  return String(value == null ? '' : value).trim().slice(0, 200);
}

function toIsoDate(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '';
  return date.toISOString();
}

function makeBatchId(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  return `browser-scan-batch-${stamp}-${crypto.randomUUID()}`;
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
  const parsedBarcode = parseBarcode(row.barcode || row.orderNumber || row.order_number);
  const barcode = cleanBarcode(parsedBarcode.barcode);
  if (!scanId) return { scan: null, error: 'scanId is missing' };
  if (!scannedAt) return { scan: null, error: 'scannedAt is missing or invalid' };
  if (!parsedBarcode.ok) return { scan: null, error: parsedBarcode.error };
  if (!barcode) return { scan: null, error: 'barcode is missing' };
  return {
    scan: {
      scanId,
      scannedAt,
      barcode,
      rawBarcode: String(row.rawBarcode || row.raw_barcode || parsedBarcode.rawBarcode || barcode).slice(0, 200),
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
      source text not null default 'operator_commit'
    )
  `);
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
  await client.query('create index if not exists print_job_label_scans_order_number_idx on public.print_job_label_scans (order_number)');
  await client.query('create index if not exists print_job_label_scans_scanned_at_desc_idx on public.print_job_label_scans (scanned_at desc)');
  await client.query('create index if not exists print_job_label_scans_match_status_idx on public.print_job_label_scans (match_status)');
  await client.query('create index if not exists print_job_label_scans_commit_batch_id_idx on public.print_job_label_scans (commit_batch_id)');
  await client.query('alter table public.processed_print_orders add column if not exists physically_printed_at timestamptz');
  await client.query('alter table public.processed_print_orders add column if not exists physically_printed_by text');
  await client.query('alter table public.processed_print_orders add column if not exists physically_printed_station text');
  await client.query('alter table public.processed_print_orders add column if not exists physically_printed_scan_id text');
  await client.query('alter table public.processed_print_orders add column if not exists physically_printed_batch_id text');
  await client.query(`
    create index if not exists processed_print_orders_active_order_name_queued_idx
      on public.processed_print_orders (order_name, queued_date_time desc nulls last, id desc)
      where order_name is not null
        and coalesce(ignored, false) = false
  `);
  await client.query('alter table public.print_job_label_scans add column if not exists order_type text');
  await client.query('alter table public.print_job_label_scans add column if not exists is_reprint boolean not null default false');
  await client.query('alter table public.print_job_label_scans add column if not exists reprint_kind text');
  await client.query('alter table public.processed_order_reprint_requests add column if not exists order_type text');
  await client.query('alter table public.processed_order_reprint_requests add column if not exists reprint_kind text');
  await client.query('alter table public.processed_order_reprint_requests add column if not exists scan_barcode text');
  await client.query('alter table public.processed_order_reprint_requests add column if not exists scan_raw_barcode text');
  await client.query('alter table public.processed_order_reprint_requests add column if not exists completed_scan_id text');
  await client.query('alter table public.processed_order_reprint_requests add column if not exists completed_batch_id text');
  await client.query('create index if not exists processed_reprint_scan_status_idx on public.processed_order_reprint_requests (status, order_name, requested_at desc, id desc)');
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
  const normalized = String(value || '').trim().toUpperCase();
  return ['S', 'C', 'R', 'RS', 'RC'].includes(normalized) ? normalized : '';
}

function isReprintOrderType(value) {
  return normalizeOrderType(value).startsWith('R');
}

function candidateTimestamp(row) {
  const value = row && row.queued_date_time;
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value || ''));
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
    queuedDateTime: row.queued_date_time instanceof Date
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
    const matchingRows = rows.filter((row) => row.order_name === candidate).filter(predicate);
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
      (row) => normalizeOrderType(row.order_type) === scannedOrderType
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
      (row) => !isReprintOrderType(row.order_type)
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
  const keys = Array.from(new Set((candidates || []).map(cleanBarcode).filter(Boolean)));
  if (!keys.length) return [];
  const result = await client.query(
    `
      select id, order_name, order_type, status, queued_date_time
      from public.processed_print_orders
      where coalesce(ignored, false) = false
        and order_name = any($1::text[])
      order by queued_date_time desc nulls last, id desc
    `,
    [keys]
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
    [candidates, ACTIVE_REPRINT_STATUSES]
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
      candidates: [{
        id: row.order_id,
        orderName: row.processed_order_name || row.order_name,
        orderType: null,
        status: row.status || null,
        reprintRequestId: row.id,
      }],
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

async function completeReprintRequestFromScan(client, scan, match, batchId, committedBy) {
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
    ]
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
    confirmedAt: row.confirmed_at instanceof Date ? row.confirmed_at.toISOString() : String(row.confirmed_at || ''),
    confirmedBy: row.confirmed_by,
  };
}

async function commitBrowserScanBatch(client, input) {
  await ensureScanCommitSchema(client);
  const committedAt = new Date().toISOString();
  const committedBy = safeText(input.committedBy || input.operator, 100);
  const station = safeText(input.station, 100);
  const batchId = normalizeBatchId(input.batchId || input.batch_id) || makeBatchId(new Date(committedAt));
  const rawScans = Array.isArray(input.scans) ? input.scans : [];
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
    duplicateScanIds: [],
    errorScanIds: [],
    matchDiagnostics: [],
    warnings: [],
    errors: [],
  };
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
  const existing = await fetchExistingScanIds(client, scans.map((scan) => scan.scanId));
  existing.forEach((scanId) => {
    summary.duplicateCount += 1;
    summary.skippedAlreadyCommitted += 1;
    summary.duplicateScanIds.push(scanId);
  });
  const pendingScans = scans.filter((scan) => !existing.has(scan.scanId));

  await client.query('begin');
  try {
    const processedOrderCandidateLookup = await fetchProcessedOrderCandidateLookup(client, pendingScans);
    for (let index = 0; index < pendingScans.length; index += 1) {
      const scan = pendingScans[index];
      const savepoint = `browser_scan_commit_${index}`;
      await client.query(`savepoint ${savepoint}`);
      try {
        const inserted = await insertScan(client, scan, batchId, committedAt, committedBy || scan.operator || '');
        if (!inserted) {
          summary.duplicateCount += 1;
          summary.duplicateScanIds.push(scan.scanId);
          await client.query(`release savepoint ${savepoint}`);
          continue;
        }
        summary.newScansCommitted += 1;
        summary.committedScanIds.push(scan.scanId);
        if (scan.isReprint) {
          summary.reprintScans += 1;
          const match = await findPendingReprintRequestMatch(client, scan);
          if (match.status === 'matched') {
            const completed = await completeReprintRequestFromScan(client, scan, match, batchId, committedBy);
            if (completed) {
              await updateScanMatch(client, scan, match);
              summary.matchedCount += 1;
              summary.reprintCompletedScans += 1;
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
              summary.matchDiagnostics.push(matchDiagnostic(scan, staleMatch));
              summary.warnings.push({ scanId: scan.scanId, barcode: scan.barcode, warning: staleMatch.reason });
            }
          } else {
            await updateScanMatch(client, scan, match);
            summary.unmatchedCount += 1;
            summary.reprintUnmatchedCount += 1;
            summary.matchDiagnostics.push(matchDiagnostic(scan, match));
            summary.warnings.push({ scanId: scan.scanId, barcode: scan.barcode, warning: match.reason });
          }
        } else {
          const match = await findProcessedOrderMatch(client, scan, processedOrderCandidateLookup);
          await updateScanMatch(client, scan, match);
          if (match.status === 'matched') {
            await markProcessedOrderPhysicallyPrinted(client, scan, match, batchId, committedBy, station);
            summary.matchedCount += 1;
            summary.printedScans += 1;
          } else if (match.status === 'ambiguous') {
            summary.ambiguousCount += 1;
            summary.matchDiagnostics.push(matchDiagnostic(scan, match));
          } else {
            summary.unmatchedCount += 1;
            summary.matchDiagnostics.push(matchDiagnostic(scan, match));
          }
        }
        await client.query(`release savepoint ${savepoint}`);
      } catch (error) {
        await client.query(`rollback to savepoint ${savepoint}`);
        await client.query(`release savepoint ${savepoint}`);
        summary.errorCount += 1;
        summary.errorScanIds.push(scan.scanId);
        summary.errors.push({
          scanId: scan.scanId,
          barcode: scan.barcode,
          error: error.message || String(error),
        });
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
        values ($1, $2, nullif($3, ''), nullif($4, ''), $5, $6, $7, $8, $9, 'browser_local_queue')
        on conflict (batch_id) do nothing
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
  }
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }
  if (event.httpMethod !== 'POST') {
    return json(405, { ok: false, error: 'Method not allowed' });
  }
  try {
    checkRateLimit(event, { name: 'commit-scan-batch', maxRequests: 20, windowMs: 60 * 1000 });
    requirePostPurchaseAccess(event);
    const input = parseRequestBody(event);
    const body = await withClient((client) => commitBrowserScanBatch(client, input));
    return json(200, body);
  } catch (error) {
    const statusCode = error && error.statusCode ? error.statusCode : 500;
    const message = error && error.message ? error.message : 'commit-scan-batch failed';
    return json(statusCode, { ok: false, error: message });
  }
};

exports._private = {
  commitBrowserScanBatch,
  completeReprintRequestFromScan,
  fetchProcessedOrderCandidateLookup,
  fetchProcessedOrderCandidateRows,
  findPendingReprintRequestMatch,
  findProcessedOrderMatch,
  normalizeScan,
  orderCandidatesForScan,
};
