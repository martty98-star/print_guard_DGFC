'use strict';

const {
  checkRateLimit,
  getHeader,
  json,
  parseRequestBody,
  requireAdminAccess,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const {
  listPrintOrdersReceived,
  syncPostPurchaseOrders,
  updatePrintOrderLifecycleStatus,
} = require('./_lib/postpurchase-orders');

function parseListOptions(event) {
  const query = event && event.queryStringParameters ? event.queryStringParameters : {};
  return {
    limit: Number(query.limit) || 200,
    offset: Number(query.offset) || 0,
  };
}

function parseSyncOptions(event) {
  const query = event && event.queryStringParameters ? event.queryStringParameters : {};
  const body = parseRequestBody(event);
  return {
    fromId: body.fromId ?? query.fromId,
    updatedFrom: body.updatedFrom ?? query.updatedFrom,
    createdFrom: body.createdFrom ?? query.createdFrom,
    limit: body.limit ?? query.limit ?? 100,
    supplierSystemCode: body.supplierSystemCode ?? query.supplierSystemCode,
  };
}

function parseUpdateOptions(event) {
  const body = parseRequestBody(event);
  const options = {
    externalOrderId: body.externalOrderId ?? body.external_order_id,
    stage: body.stage,
    completed: body.completed,
    completedAt: body.completedAt ?? body.completed_at,
  };
  if (Object.prototype.hasOwnProperty.call(body, 'reprintNeeded') || Object.prototype.hasOwnProperty.call(body, 'reprint_needed')) {
    options.reprintNeeded = body.reprintNeeded ?? body.reprint_needed;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'issueReason') || Object.prototype.hasOwnProperty.call(body, 'issue_reason')) {
    options.issueReason = body.issueReason ?? body.issue_reason;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'note') || Object.prototype.hasOwnProperty.call(body, 'issue_note')) {
    options.note = body.note ?? body.issue_note;
  }
  return options;
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    checkRateLimit(event, { name: 'postpurchase-orders', maxRequests: 30, windowMs: 60 * 1000 });

    if (event.httpMethod === 'GET') {
      requirePostPurchaseAccess(event);

      const body = await withClient(async (client) => {
        const rows = await listPrintOrdersReceived(client, parseListOptions(event));
        return { ok: true, rows };
      });
      return json(200, body);
    }

    if (event.httpMethod === 'POST') {
      requireAdminAccess(event);
      if (getHeader(event, 'x-internal-sync').toLowerCase() !== 'true') {
        return json(403, { ok: false, error: 'Internal sync header required' });
      }

      const body = await withClient(async (client) => {
        const result = await syncPostPurchaseOrders(client, parseSyncOptions(event));
        return { ok: true, ...result };
      });
      return json(200, body);
    }

    if (event.httpMethod === 'PUT') {
      requirePostPurchaseAccess(event);

      const body = await withClient(async (client) => {
        const row = await updatePrintOrderLifecycleStatus(client, parseUpdateOptions(event));
        return { ok: true, row };
      });
      return json(200, body);
    }

    return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,POST,PUT,OPTIONS' });
  } catch (error) {
    if (error && (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 404 || error.statusCode === 429)) {
      return json(error.statusCode, { ok: false, error: error.message || 'Request failed' });
    }
    console.error('postpurchase-orders failed', error);
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : 'postpurchase-orders failed',
    });
  }
};
