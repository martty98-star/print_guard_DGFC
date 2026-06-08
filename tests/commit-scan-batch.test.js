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
    scans: [],
    printedUpdates: [],
    reprintUpdates: [],
    scanMatchUpdates: [],
    batches: [],
  };

  return {
    state,
    async query(sql, params = []) {
      const text = normalizeSql(sql);

      if (text === 'begin' || text === 'commit' || text === 'rollback' || text.startsWith('savepoint ') || text.startsWith('release savepoint ') || text.startsWith('rollback to savepoint ')) {
        return { rows: [], rowCount: 0 };
      }

      if (text.includes('from public.print_job_label_scans') && text.includes('where scan_id = any')) {
        const ids = new Set(params[0] || []);
        return { rows: state.scans.filter((scan) => ids.has(scan.scan_id)).map((scan) => ({ scan_id: scan.scan_id })), rowCount: 0 };
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

      if (text.includes('select id, order_name, order_type') && text.includes('from public.processed_print_orders')) {
        const candidates = new Set(params[0] || []);
        const rows = state.processedOrders
          .filter((row) => !row.ignored && candidates.has(row.order_name))
          .sort((a, b) => Number(b.id) - Number(a.id))
          .slice(0, 5)
          .map((row) => ({ id: row.id, order_name: row.order_name, order_type: row.order_type }));
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

      if (text.startsWith('insert into public.print_scan_commit_batches')) {
        state.batches.push({ params });
        return { rows: [], rowCount: 1 };
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
    assert.strictEqual(client.state.batches[0].params[0], 'browser-scan-batch-test-1');
    assert.strictEqual(client.state.reprintUpdates.length, 0);
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
    assert.strictEqual(summary.warnings.length, 1);
    assert.strictEqual(client.state.printedUpdates.length, 0);
    assert.strictEqual(client.state.reprintUpdates.length, 0);
    assert.strictEqual(client.state.scans[0].match_status, 'unmatched');
  }
}

run().then(() => {
  console.log('commit scan batch tests passed');
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
