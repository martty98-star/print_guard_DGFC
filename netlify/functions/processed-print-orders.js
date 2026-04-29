'use strict';

const {
  checkRateLimit,
  json,
  parseRequestBody,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const {
  createReprintRequest,
  listProcessedOrderMonths,
  listProcessedPrintOrders,
  listReprintRequests,
  resolveReprintRequest,
} = require('./_lib/processed-print-orders');

function cleanApiError(error) {
  const message = error && error.message ? error.message : 'processed-print-orders failed';
  if (/connect|timeout|database|neon|ECONN|ENOTFOUND/i.test(message)) {
    return 'Database/API unavailable. Try refresh later.';
  }
  return message;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    checkRateLimit(event, { name: 'processed-print-orders', maxRequests: 60, windowMs: 60 * 1000 });
    requirePostPurchaseAccess(event);

    if (event.httpMethod === 'GET') {
      const query = event.queryStringParameters || {};
      const body = await withClient(async (client) => {
        if (query.reprintHistoryOrderIds) {
          const orderIds = String(query.reprintHistoryOrderIds || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
          const requests = await listReprintRequests(client, orderIds);
          return { ok: true, requests };
        }

        const rows = await listProcessedPrintOrders(client, {
          limit: query.limit,
          month: query.month,
          search: query.search,
        });
        const months = await listProcessedOrderMonths(client);
        return { ok: true, rows, months };
      });
      return json(200, body);
    }

    if (event.httpMethod === 'POST') {
      const bodyInput = parseRequestBody(event);
      const action = String(bodyInput.action || '').trim().toLowerCase();
      if (action !== 'reprint' && action !== 'resolve_reprint' && action !== 'mark_reprinted') {
        return json(400, { ok: false, error: 'Unsupported action' });
      }

      if (action === 'resolve_reprint' || action === 'mark_reprinted') {
        const body = await withClient(async (client) => {
          const request = await resolveReprintRequest(client, {
            orderId: bodyInput.orderId || bodyInput.order_id,
            printFilePath: bodyInput.printFilePath || bodyInput.print_file_path,
          });
          return { ok: true, request };
        });
        return json(200, body);
      }

      const body = await withClient(async (client) => {
        const request = await createReprintRequest(client, {
          orderId: bodyInput.orderId || bodyInput.order_id,
          printFilePath: bodyInput.printFilePath || bodyInput.print_file_path,
          reason: bodyInput.reason,
          requestedBy: bodyInput.requestedBy || bodyInput.requested_by,
          workstationId: bodyInput.workstationId || bodyInput.workstation_id,
          note: bodyInput.note,
        });
        return { ok: true, request };
      });
      return json(200, body);
    }

    return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,POST,OPTIONS' });
  } catch (error) {
    if (error && (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 404 || error.statusCode === 429)) {
      return json(error.statusCode, { ok: false, error: error.message || 'Request failed' });
    }
    console.error('processed-print-orders failed', error);
    return json(500, {
      ok: false,
      error: cleanApiError(error),
    });
  }
};
