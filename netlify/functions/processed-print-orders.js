'use strict';

const {
  checkRateLimit,
  json,
  parseRequestBody,
  requireAdminAccess,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const {
  createReprintRequest,
  deleteReprintRequest,
  listProcessedOrderMonths,
  listProcessedPrintOrders,
  listReprintRequests,
  resolveReprintRequest,
  updateProcessedPrintOrderAdminStatus,
} = require('./_lib/processed-print-orders');
const { updatePrintOrderAdminStatus } = require('./_lib/postpurchase-orders');

function cleanApiError(error) {
  const message =
    error && error.message ? error.message : 'processed-print-orders failed';
  if (/connect|timeout|database|neon|ECONN|ENOTFOUND/i.test(message)) {
    return 'Database/API unavailable. Try refresh later.';
  }
  return message;
}

exports.handler = async function handler(event) {
  const started = Date.now();
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    checkRateLimit(event, {
      name: 'processed-print-orders',
      maxRequests: 60,
      windowMs: 60 * 1000,
    });
    requirePostPurchaseAccess(event);

    if (event.httpMethod === 'GET') {
      const query = event.queryStringParameters || {};
      let rowCount = 0;
      let mode = 'list';
      const body = await withClient(async (client) => {
        if (query.reprintHistoryOrderIds) {
          mode = 'reprint-history';
          const orderIds = String(query.reprintHistoryOrderIds || '')
            .split(',')
            .map((value) => value.trim())
            .filter(Boolean);
          const requests = await listReprintRequests(client, orderIds);
          rowCount = requests.length;
          return { ok: true, requests };
        }

        const rows = await listProcessedPrintOrders(client, {
          limit: query.limit,
          month: query.month,
          search: query.search,
        });
        const months = await listProcessedOrderMonths(client);
        rowCount = rows.length;
        return { ok: true, rows, months };
      });
      console.log('processed-print-orders timing', {
        endpoint: 'processed-print-orders',
        method: 'GET',
        mode,
        rowCount,
        duration_ms: Date.now() - started,
        filters: {
          limit: query.limit || '500',
          hasMonth: Boolean(query.month),
          hasSearch: Boolean(query.search),
          searchLength: String(query.search || '').length,
        },
      });
      return json(200, body);
    }

    if (event.httpMethod === 'POST') {
      const bodyInput = parseRequestBody(event);
      const action = String(bodyInput.action || '')
        .trim()
        .toLowerCase();
      if (
        action !== 'reprint' &&
        action !== 'resolve_reprint' &&
        action !== 'mark_reprinted' &&
        action !== 'cancel_reprint' &&
        action !== 'delete_reprint' &&
        action !== 'cancel_order' &&
        action !== 'delete_order'
      ) {
        return json(400, { ok: false, error: 'Unsupported action' });
      }

      if (action === 'cancel_order' || action === 'delete_order') {
        requireAdminAccess(event);
        const adminAction = action === 'cancel_order' ? 'cancelled' : 'deleted';
        const body = await withClient(async (client) => {
          const processedOrderId =
            bodyInput.processedOrderId ||
            bodyInput.processed_order_id ||
            bodyInput.orderId ||
            bodyInput.order_id;
          const externalOrderId =
            bodyInput.externalOrderId || bodyInput.external_order_id;
          const orderNumber =
            bodyInput.orderNumber ||
            bodyInput.order_number ||
            bodyInput.orderName ||
            bodyInput.order_name;
          const results = {};
          if (processedOrderId || orderNumber) {
            try {
              results.processedOrder =
                await updateProcessedPrintOrderAdminStatus(client, {
                  id: processedOrderId,
                  orderName: orderNumber,
                  action: adminAction,
                  note: bodyInput.note,
                });
            } catch (error) {
              if (!externalOrderId || error.statusCode !== 404) throw error;
            }
          }
          if (externalOrderId || orderNumber) {
            try {
              results.receivedOrder = await updatePrintOrderAdminStatus(
                client,
                {
                  externalOrderId,
                  orderNumber,
                  action: adminAction,
                  note: bodyInput.note,
                },
              );
            } catch (error) {
              if (!processedOrderId || error.statusCode !== 404) throw error;
            }
          }
          if (!results.processedOrder && !results.receivedOrder) {
            const error = new Error('Order not found');
            error.statusCode = 404;
            throw error;
          }
          return { ok: true, action: adminAction, ...results };
        });
        console.log('processed-print-orders timing', {
          endpoint: 'processed-print-orders',
          method: 'POST',
          action,
          rowCount: 1,
          duration_ms: Date.now() - started,
        });
        return json(200, body);
      }

      if (action === 'delete_reprint') {
        requireAdminAccess(event);
        const body = await withClient(async (client) => {
          const request = await deleteReprintRequest(client, {
            id: bodyInput.id || bodyInput.requestId || bodyInput.request_id,
          });
          return { ok: true, request };
        });
        console.log('processed-print-orders timing', {
          endpoint: 'processed-print-orders',
          method: 'POST',
          action,
          rowCount: 1,
          duration_ms: Date.now() - started,
        });
        return json(200, body);
      }

      if (action === 'cancel_reprint') {
        const body = await withClient(async (client) => {
          const request = await deleteReprintRequest(client, {
            id: bodyInput.id || bodyInput.requestId || bodyInput.request_id,
            onlyPending: true,
          });
          return { ok: true, request };
        });
        console.log('processed-print-orders timing', {
          endpoint: 'processed-print-orders',
          method: 'POST',
          action,
          rowCount: 1,
          duration_ms: Date.now() - started,
        });
        return json(200, body);
      }

      if (action === 'resolve_reprint' || action === 'mark_reprinted') {
        const body = await withClient(async (client) => {
          const request = await resolveReprintRequest(client, {
            orderId: bodyInput.orderId || bodyInput.order_id,
            printFilePath: bodyInput.printFilePath || bodyInput.print_file_path,
            confirmedBy: bodyInput.confirmedBy || bodyInput.confirmed_by,
          });
          return { ok: true, request };
        });
        console.log('processed-print-orders timing', {
          endpoint: 'processed-print-orders',
          method: 'POST',
          action,
          rowCount: 1,
          duration_ms: Date.now() - started,
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
      console.log('processed-print-orders timing', {
        endpoint: 'processed-print-orders',
        method: 'POST',
        action,
        rowCount: 1,
        duration_ms: Date.now() - started,
      });
      return json(200, body);
    }

    return json(
      405,
      { ok: false, error: 'Method not allowed' },
      { allow: 'GET,POST,OPTIONS' },
    );
  } catch (error) {
    if (
      error &&
      (error.statusCode === 400 ||
        error.statusCode === 401 ||
        error.statusCode === 403 ||
        error.statusCode === 404 ||
        error.statusCode === 429)
    ) {
      return json(error.statusCode, {
        ok: false,
        error: error.message || 'Request failed',
      });
    }
    console.error('processed-print-orders failed', error);
    return json(500, {
      ok: false,
      error: cleanApiError(error),
    });
  }
};
