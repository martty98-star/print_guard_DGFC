'use strict';

const { json, parseRequestBody, requireAdminPin, withClient } = require('./_lib/db');
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
    log: console.log,
  };
}

function parseUpdateOptions(event) {
  const body = parseRequestBody(event);
  return {
    externalOrderId: body.externalOrderId ?? body.external_order_id,
    stage: body.stage,
    completed: body.completed,
    completedAt: body.completedAt ?? body.completed_at,
  };
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    if (event.httpMethod === 'GET') {
      const body = await withClient(async (client) => {
        const rows = await listPrintOrdersReceived(client, parseListOptions(event));
        return { ok: true, rows };
      });
      return json(200, body);
    }

    if (event.httpMethod === 'POST') {
      requireAdminPin(event);

      const body = await withClient(async (client) => {
        const result = await syncPostPurchaseOrders(client, parseSyncOptions(event));
        return { ok: true, ...result };
      });
      return json(200, body);
    }

    if (event.httpMethod === 'PUT') {
      const body = await withClient(async (client) => {
        const row = await updatePrintOrderLifecycleStatus(client, parseUpdateOptions(event));
        return { ok: true, row };
      });
      return json(200, body);
    }

    return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,POST,PUT,OPTIONS' });
  } catch (error) {
    console.error('postpurchase-orders failed', error);
    if (error && (error.statusCode === 400 || error.statusCode === 403 || error.statusCode === 404)) {
      return json(error.statusCode, { ok: false, error: error.message || 'Request failed' });
    }
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : 'postpurchase-orders failed',
    });
  }
};
