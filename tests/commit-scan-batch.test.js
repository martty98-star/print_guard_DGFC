'use strict';

const assert = require('assert');
const { _private: ScanCommit } = require('../netlify/functions/commit-scan-batch');

function normalizeSql(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function makeClient(seed = {}) {
  const state = {
    processedOrders: (seed.processedOrders || []).map((row) => ({ ...row })),
    reprintRequests: (seed.reprintRequests || []).map((row) => ({ ...row })),
    scans: (seed.scans || []).map((row) => ({ ...row })),
    printedUpdates: [],
    reprintUpdates: [],
    scanMatchUpdates: [],
    batches: (seed.batches || []).map((row) => ({ ...row })),
  };

  return {
    state,
    async query(sql, params = []) {
      const text = normalizeSql(sql);

      if (text === 'begin' || text === 'commit' || text === 'rollback' || text.startsWith('savepoint ') || text.startsWith('release savepoint ') || text.startsWith('rollback to savepoint ')) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes('from public.print_scan_commit_batches') && text.includes('where batch_id = $1')) {
        const batch = state.batches.find((row) => row.batch_id === params[0]);
        return { rows: batch ? [{ ...batch }] : [], rowCount: batch ? 1 : 0 };
      }

      if (text.startsWith('insert into public.print_scan_commit_batches')) {
        if (!state.batches.some((row) => row.batch_id === params[0])) {
          state.batches.push({
            batch_id: params[0],
            committed_at: params[1],
            committed_by: params[2] || null,
            station: params[3] || null,
            scan_count: 0,
            matched_count: 0,
            unmatched_count: 0,
            duplicate_count: 0,
            error_count: 0,
            source: 'browser_local_queue',
            status: text.includes("'received'") ? 'received' : text.includes("'processing'") ? 'processing' : 'committed',
            retry_count: 0,
            started_at: params[12] || new Date().toISOString(),
            updated_at: new Date().toISOString(),
            diagnostics: {},
          });
          return { rows: [{ ...state.batches[state.batches.length - 1] }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      if (text.startsWith('update public.print_scan_commit_batches') && text.includes('status = $2') && text.includes('diagnostics') && !text.includes('scan_count = $3')) {
        const batch = state.batches.find((row) => row.batch_id === params[0]);
        if (batch) {
          batch.status = params[1];
          batch.diagnostics = { ...(batch.diagnostics || {}), ...JSON.parse(params[2] || '{}') };
          batch.updated_at = new Date().toISOString();
        }
        return { rows: [], rowCount: batch ? 1 : 0 };
      }

      if (text.startsWith('update public.print_scan_commit_batches') && text.includes("status = 'processing'")) {
        const batch = state.batches.find((row) => row.batch_id === params[0]);
        if (batch) {
          batch.status = 'processing';
          batch.retry_count = Number(batch.retry_count || 0) + 1;
          batch.finished_at = null;
          batch.failed_phase = null;
          batch.error_message = null;
          batch.committed_by = params[1] || batch.committed_by || null;
          batch.station = params[2] || batch.station || null;
          batch.diagnostics = { ...(batch.diagnostics || {}), ...JSON.parse(params[3] || '{}') };
        }
        return { rows: batch ? [{ ...batch }] : [], rowCount: batch ? 1 : 0 };
      }

      if (text.startsWith('update public.print_scan_commit_batches') && text.includes('scan_count = $3')) {
        const batch = state.batches.find((row) => row.batch_id === params[0]);
        if (batch) {
          batch.status = params[1];
          batch.scan_count = params[2];
          batch.matched_count = params[3];
          batch.unmatched_count = params[4];
          batch.duplicate_count = params[5];
          batch.error_count = params[6];
          batch.diagnostics = JSON.parse(params[7] || '{}');
          batch.failed_phase = params[8] || null;
          batch.error_message = params[9] || null;
          batch.finished_at = new Date().toISOString();
          batch.updated_at = batch.finished_at;
        }
        return { rows: [], rowCount: batch ? 1 : 0 };
      }

      if (text.startsWith('update public.print_scan_commit_batches') && text.includes("status = 'failed'")) {
        const batch = state.batches.find((row) => row.batch_id === params[0]);
        if (batch) {
          batch.status = 'failed';
          batch.diagnostics = JSON.parse(params[1] || '{}');
          batch.failed_phase = params[2] || null;
          batch.error_message = params[3] || null;
          batch.finished_at = new Date().toISOString();
        }
        return { rows: [], rowCount: batch ? 1 : 0 };
      }

      if (text.includes('count(*)::int as scan_count') && text.includes('from public.print_job_label_scans') && text.includes('where commit_batch_id = $1')) {
        const rows = state.scans.filter((scan) => scan.commit_batch_id === params[0]);
        const countStatus = (status) => rows.filter((scan) => scan.match_status === status).length;
        const finalized = rows.filter((scan) => ['matched', 'unmatched', 'ambiguous', 'error'].includes(scan.match_status)).length;
        return {
          rows: [{
            scan_count: rows.length,
            matched_count: countStatus('matched'),
            unmatched_count: countStatus('unmatched'),
            ambiguous_count: countStatus('ambiguous'),
            error_count: countStatus('error'),
            finalized_count: finalized,
            pending_count: countStatus('pending'),
          }],
          rowCount: 1,
        };
      }

      if (text.includes('from public.print_job_label_scans') && text.includes('where scan_id = any')) {
        const ids = new Set(params[0] || []);
        const rows = state.scans.filter((scan) => ids.has(scan.scan_id)).map((scan) => ({ ...scan }));
        return { rows, rowCount: rows.length };
      }

      if (text.startsWith('insert into public.print_job_label_scans')) {
        const scan = {
          scan_id: params[0],
          scanned_at: params[1],
          barcode: params[2],
          raw_barcode: params[3],
          order_number: params[4],
          order_type: params[5],
          is_reprint: params[6],
          reprint_kind: params[7],
          station: params[8],
          operator: params[9],
          source: params[10],
          commit_batch_id: params[11],
          committed_at: params[12],
          committed_by: params[13],
          match_status: 'pending',
        };
        if (state.scans.some((row) => row.scan_id === scan.scan_id)) {
          return { rows: [], rowCount: 0 };
        }
        state.scans.push(scan);
        return { rows: [{ scan_id: scan.scan_id }], rowCount: 1 };
      }

      if (text.startsWith('update public.print_job_label_scans')) {
        const scan = state.scans.find((row) => row.scan_id === params[0]);
        if (scan) {
          scan.match_status = params[1];
          scan.match_reason = params[2];
          scan.matched_processed_order_id = params[3];
          scan.matched_order_name = params[4];
        }
        state.scanMatchUpdates.push({ scanId: params[0], status: params[1], reason: params[2], processedOrderId: params[3], orderName: params[4] });
        return { rows: [], rowCount: scan ? 1 : 0 };
      }

      if (text.includes('from public.processed_print_orders') && text.includes('order_name = any')) {
        const candidates = new Set(params[0] || []);
        const rows = state.processedOrders
          .filter((row) => !row.ignored && candidates.has(row.order_name))
          .sort((a, b) => {
            const timeDiff = Date.parse(b.queued_date_time || 0) - Date.parse(a.queued_date_time || 0);
            return timeDiff || Number(b.id) - Number(a.id);
          })
          .map((row) => ({
            id: row.id,
            order_name: row.order_name,
            order_type: row.order_type,
            status: row.status || null,
            queued_date_time: row.queued_date_time || null,
          }));
        return { rows, rowCount: rows.length };
      }

      if (text.includes('from public.processed_order_reprint_requests r') && text.includes('join public.processed_print_orders p')) {
        const candidates = new Set(params[0] || []);
        const statuses = new Set((params[1] || []).map((value) => String(value).toLowerCase()));
        const rows = state.reprintRequests
          .filter((request) => statuses.has(String(request.status || '').toLowerCase()))
          .map((request) => {
            const order = state.processedOrders.find((row) => Number(row.id) === Number(request.order_id));
            return { request, order };
          })
          .filter(({ request, order }) => order && !order.ignored && (candidates.has(request.order_name) || candidates.has(order.order_name)))
          .sort((a, b) => {
            const dateDiff = Date.parse(b.request.requested_at || 0) - Date.parse(a.request.requested_at || 0);
            return dateDiff || Number(b.request.id) - Number(a.request.id);
          })
          .slice(0, 1)
          .map(({ request, order }) => ({
            id: request.id,
            order_id: request.order_id,
            order_name: request.order_name,
            print_file_path: request.print_file_path || null,
            status: request.status,
            processed_order_name: order.order_name,
          }));
        return { rows, rowCount: rows.length };
      }

      if (text.startsWith('update public.processed_print_orders')) {
        const order = state.processedOrders.find((row) => Number(row.id) === Number(params[0]));
        if (!order) return { rows: [], rowCount: 0 };
        order.physically_printed_scan_id = params[4];
        order.physically_printed_batch_id = params[5];
        state.printedUpdates.push({
          processedOrderId: params[0],
          scannedAt: params[1],
          scanId: params[4],
          batchId: params[5],
        });
        return { rows: [], rowCount: 1 };
      }

      if (text.startsWith('update public.processed_order_reprint_requests')) {
        const statuses = new Set((params[9] || []).map((value) => String(value).toLowerCase()));
        const request = state.reprintRequests.find((row) => Number(row.id) === Number(params[0]) && statuses.has(String(row.status || '').toLowerCase()));
        if (!request) return { rows: [], rowCount: 0 };
        request.status = 'done';
        request.confirmed_at = request.confirmed_at || params[1];
        request.confirmed_by = request.confirmed_by || params[2] || null;
        request.order_type = params[3] || null;
        request.reprint_kind = params[4] || null;
        request.scan_barcode = params[5] || null;
        request.scan_raw_barcode = params[6] || null;
        request.completed_scan_id = params[7] || null;
        request.completed_batch_id = params[8] || null;
        state.reprintUpdates.push({ ...request });
        return {
          rows: [{
            id: request.id,
            order_id: request.order_id,
            order_name: request.order_name,
            print_file_path: request.print_file_path || null,
            status: request.status,
            confirmed_at: request.confirmed_at,
            confirmed_by: request.confirmed_by,
          }],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

function scanRow(scanId, barcode) {
  return {
    scanId,
    barcode,
    rawBarcode: barcode,
    scannedAt: '2026-06-05T10:00:00.000Z',
    operator: 'tester',
    station: 'station-1',
  };
}

async function run() {
  {
    const client = makeClient({
      processedOrders: [{ id: 1, order_name: '26967599', order_type: 'S' }],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, {
      batchId: 'browser-scan-batch-test-1',
      scans: [scanRow('normal-1', '26967599')],
    });
    assert.strictEqual(summary.batchId, 'browser-scan-batch-test-1');
    assert.strictEqual(summary.printedScans, 1);
    assert.strictEqual(summary.reprintCompletedScans, 0);
    assert.strictEqual(client.state.printedUpdates.length, 1);
    assert.strictEqual(client.state.printedUpdates[0].batchId, 'browser-scan-batch-test-1');
    assert.strictEqual(client.state.batches[0].batch_id, 'browser-scan-batch-test-1');
    assert.strictEqual(client.state.batches[0].status, 'matched');
    assert.strictEqual(client.state.batches[0].matched_count, 1);
    assert.strictEqual(client.state.reprintUpdates.length, 0);
  }

  {
    const client = makeClient({
      processedOrders: [
        {
          id: 17055,
          order_name: 'PS4776845',
          order_type: 'S',
          status: 'Opened',
          queued_date_time: '2026-06-08T04:35:22.364Z',
        },
        {
          id: 17314,
          order_name: 'PS4776845',
          order_type: 'RS',
          status: 'Opened',
          queued_date_time: '2026-06-08T12:43:38.348Z',
        },
      ],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, { scans: [scanRow('ps-normal-1', 'PS4776845')] });
    assert.strictEqual(summary.printedScans, 1);
    assert.strictEqual(summary.matchedCount, 1);
    assert.strictEqual(summary.ambiguousCount, 0);
    assert.strictEqual(client.state.printedUpdates.length, 1);
    assert.strictEqual(client.state.printedUpdates[0].processedOrderId, 17055);
    assert.strictEqual(client.state.scans[0].match_status, 'matched');
    assert.strictEqual(client.state.scans[0].matched_processed_order_id, 17055);
  }

  {
    const client = makeClient({
      processedOrders: [
        {
          id: 200,
          order_name: '26967599',
          order_type: 'C',
          queued_date_time: '2026-06-08T04:35:22.364Z',
        },
        {
          id: 201,
          order_name: '26967599',
          order_type: 'RC',
          queued_date_time: '2026-06-08T12:43:38.348Z',
        },
      ],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, { scans: [scanRow('numeric-normal-1', '26967599')] });
    assert.strictEqual(summary.printedScans, 1);
    assert.strictEqual(summary.matchedCount, 1);
    assert.strictEqual(summary.ambiguousCount, 0);
    assert.strictEqual(client.state.printedUpdates[0].processedOrderId, 200);
    assert.strictEqual(client.state.scans[0].matched_processed_order_id, 200);
  }

  {
    const client = makeClient({
      processedOrders: [{ id: 1, order_name: '26967599', order_type: 'C' }],
      reprintRequests: [{ id: 10, order_id: 1, order_name: '26967599', status: 'pending', requested_at: '2026-06-05T09:00:00.000Z' }],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, { scans: [scanRow('rc-1', '26967599RC')] });
    assert.strictEqual(summary.printedScans, 0);
    assert.strictEqual(summary.reprintCompletedScans, 1);
    assert.strictEqual(client.state.printedUpdates.length, 0);
    assert.strictEqual(client.state.reprintUpdates.length, 1);
    assert.strictEqual(client.state.reprintRequests[0].status, 'done');
    assert.strictEqual(client.state.reprintRequests[0].order_type, 'RC');
    assert.strictEqual(client.state.reprintRequests[0].reprint_kind, 'combi');
    assert.strictEqual(client.state.reprintRequests[0].scan_raw_barcode, '26967599RC');
  }

  {
    const client = makeClient({
      processedOrders: [{ id: 1, order_name: '26967599', order_type: 'S' }],
      reprintRequests: [{ id: 11, order_id: 1, order_name: '26967599', status: 'pending', requested_at: '2026-06-05T09:00:00.000Z' }],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, { scans: [scanRow('rs-1', '26967599RS')] });
    assert.strictEqual(summary.printedScans, 0);
    assert.strictEqual(summary.reprintCompletedScans, 1);
    assert.strictEqual(client.state.printedUpdates.length, 0);
    assert.strictEqual(client.state.reprintRequests[0].status, 'done');
    assert.strictEqual(client.state.reprintRequests[0].order_type, 'RS');
    assert.strictEqual(client.state.reprintRequests[0].reprint_kind, 'single');
  }

  {
    const client = makeClient({
      processedOrders: [{ id: 1, order_name: '26967599', order_type: 'C' }],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, { scans: [scanRow('rc-missing-1', '26967599RC')] });
    assert.strictEqual(summary.printedScans, 0);
    assert.strictEqual(summary.reprintCompletedScans, 0);
    assert.strictEqual(summary.reprintUnmatchedCount, 1);
    assert.strictEqual(summary.warnings.some((warning) => String(warning.warning || '').includes('pending reprint request')), true);
    assert.strictEqual(client.state.printedUpdates.length, 0);
    assert.strictEqual(client.state.reprintUpdates.length, 0);
    assert.strictEqual(client.state.scans[0].match_status, 'unmatched');
  }

  {
    const client = makeClient({ processedOrders: [] });
    const summary = await ScanCommit.commitBrowserScanBatch(client, { scans: [scanRow('missing-normal-1', 'PS9999999')] });
    assert.strictEqual(summary.printedScans, 0);
    assert.strictEqual(summary.matchedCount, 0);
    assert.strictEqual(summary.unmatchedCount, 1);
    assert.strictEqual(summary.matchDiagnostics.length, 1);
    assert.strictEqual(summary.matchDiagnostics[0].reason_code, 'no_processed_order_candidate');
    assert.deepStrictEqual(summary.matchDiagnostics[0].candidate_debug.attempted_keys, ['PS9999999', '9999999']);
    assert.strictEqual(summary.matchDiagnostics[0].candidate_debug.db_candidate_count, 0);
    assert.strictEqual(client.state.scans[0].match_status, 'unmatched');
  }

  {
    const client = makeClient({
      processedOrders: [{ id: 300, order_name: 'PS4777000', order_type: 'S' }],
    });
    const scan = scanRow('retry-normal-1', 'PS4777000');
    const firstSummary = await ScanCommit.commitBrowserScanBatch(client, { batchId: 'browser-scan-batch-retry', scans: [scan] });
    assert.strictEqual(firstSummary.matchedCount, 1);
    assert.strictEqual(firstSummary.newScansCommitted, 1);

    const retrySummary = await ScanCommit.commitBrowserScanBatch(client, { batchId: 'browser-scan-batch-retry', scans: [scan] });
    assert.strictEqual(retrySummary.newScansCommitted, 0);
    assert.strictEqual(retrySummary.retryMode, 'already_committed_duplicate');
    assert.strictEqual(retrySummary.status, 'already_completed');
    assert.strictEqual(retrySummary.matchedCount, 1);
    assert.strictEqual(retrySummary.unmatchedCount, 0);
    assert.strictEqual(retrySummary.ambiguousCount, 0);
    assert.strictEqual(retrySummary.duplicateCount, 0);
    assert.deepStrictEqual(retrySummary.matchDiagnostics, []);
  }

  {
    const client = makeClient({
      processedOrders: [{ id: 300, order_name: 'PS4777000', order_type: 'S' }],
      batches: [{
        batch_id: 'browser-scan-batch-processing',
        status: 'processing',
        scan_count: 0,
        matched_count: 0,
        unmatched_count: 0,
        duplicate_count: 0,
        error_count: 0,
        retry_count: 0,
        started_at: '2026-06-05T10:00:00.000Z',
        updated_at: '2026-06-05T10:00:05.000Z',
      }],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, {
      batchId: 'browser-scan-batch-processing',
      scans: [scanRow('processing-scan-1', 'PS4777000')],
    });
    assert.strictEqual(summary.status, 'processing');
    assert.strictEqual(summary.retryMode, 'same_batch_processing');
    assert.strictEqual(client.state.scans.length, 0);
    assert.strictEqual(client.state.printedUpdates.length, 0);
  }

  {
    const client = makeClient({
      batches: [{
        batch_id: 'browser-scan-batch-failed',
        status: 'failed',
        scan_count: 1,
        matched_count: 0,
        unmatched_count: 0,
        duplicate_count: 0,
        error_count: 1,
        retry_count: 1,
        started_at: '2026-06-05T10:00:00.000Z',
        finished_at: '2026-06-05T10:00:10.000Z',
        updated_at: '2026-06-05T10:00:10.000Z',
        failed_phase: 'matching',
        error_message: 'forced test failure',
      }],
    });
    const status = await ScanCommit.getBatchStatus(client, 'browser-scan-batch-failed');
    assert.strictEqual(status.status, 'failed');
    assert.strictEqual(status.failedPhase, 'matching');
    assert.strictEqual(status.errorMessage, 'forced test failure');
    assert.strictEqual(status.durationMs, 10000);
  }

  {
    const client = makeClient({
      processedOrders: [{ id: 301, order_name: 'PS4777001', order_type: 'S' }],
      batches: [{
        batch_id: 'browser-scan-batch-partial',
        status: 'partial_failed',
        scan_count: 1,
        matched_count: 0,
        unmatched_count: 0,
        duplicate_count: 0,
        error_count: 0,
        retry_count: 0,
      }],
      scans: [{
        scan_id: 'partial-scan-1',
        scanned_at: '2026-06-05T10:00:00.000Z',
        barcode: 'PS4777001',
        raw_barcode: 'PS4777001',
        order_number: 'PS4777001',
        order_type: 'S',
        is_reprint: false,
        reprint_kind: null,
        station: 'station-1',
        operator: 'tester',
        source: 'job_label_scan',
        commit_batch_id: 'browser-scan-batch-partial',
        committed_at: '2026-06-05T10:00:00.000Z',
        committed_by: 'tester',
        match_status: 'pending',
      }],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, {
      batchId: 'browser-scan-batch-partial',
      scans: [scanRow('partial-scan-1', 'PS4777001')],
    });
    assert.strictEqual(summary.retryMode, 'partial_recovery');
    assert.strictEqual(summary.insertedScanRows, 0);
    assert.strictEqual(summary.existingSameBatchRows, 1);
    assert.strictEqual(summary.rowsEligibleForMatching, 1);
    assert.strictEqual(summary.matchedCount, 1);
    assert.strictEqual(summary.orderUpdateCount, 1);
    assert.strictEqual(client.state.scans.length, 1);
    assert.strictEqual(client.state.scans[0].match_status, 'matched');
    assert.strictEqual(client.state.processedOrders[0].physically_printed_batch_id, 'browser-scan-batch-partial');
  }

  {
    const client = makeClient({
      processedOrders: [
        { id: 401, order_name: 'PS4777101', order_type: 'S' },
        { id: 402, order_name: 'PS4777102', order_type: 'S' },
      ],
    });
    const scans = [
      scanRow('dupe-request-1', 'PS4777101'),
      scanRow('dupe-request-1', 'PS4777101'),
      scanRow('dupe-request-2', 'PS4777102'),
    ];
    const summary = await ScanCommit.commitBrowserScanBatch(client, { batchId: 'browser-scan-batch-dupe-request', scans });
    assert.strictEqual(summary.duplicateCount, 1);
    assert.strictEqual(summary.insertedScanRows, 2);
    assert.strictEqual(summary.matchedCount, 2);
    assert.strictEqual(client.state.printedUpdates.length, 2);
  }

  {
    const client = makeClient({
      processedOrders: [{ id: 501, order_name: 'PS4777201', order_type: 'S' }],
    });
    const summary = await ScanCommit.commitBrowserScanBatch(client, {
      batchId: 'browser-scan-batch-one-bad',
      scans: [scanRow('good-mixed-1', 'PS4777201'), scanRow('bad-mixed-1', 'PS0000000')],
    });
    assert.strictEqual(summary.matchedCount, 1);
    assert.strictEqual(summary.unmatchedCount, 1);
    assert.strictEqual(summary.commitOk, true);
    assert.strictEqual(client.state.printedUpdates.length, 1);
  }

  {
    const client = makeClient({ processedOrders: [] });
    const summary = await ScanCommit.commitBrowserScanBatch(client, {
      batchId: 'browser-scan-batch-zero-match',
      scans: [scanRow('zero-match-1', 'PS0000001')],
    });
    assert.strictEqual(summary.newScansCommitted, 1);
    assert.strictEqual(summary.matchedCount, 0);
    assert.strictEqual(summary.commitOk, false);
    assert.strictEqual(summary.warnings.some((warning) => warning.reasonCode === 'zero_match_commit'), true);
  }
}

run().then(() => {
  console.log('commit scan batch tests passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
