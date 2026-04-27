'use strict';

const { json, parseRequestBody, requireAdminPin, withClient } = require('./_lib/db');
const {
  listPrintOrdersReceived,
  syncPostPurchaseOrders,
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

    return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,POST,OPTIONS' });
  } catch (error) {
    console.error('postpurchase-orders failed', error);
    if (error && error.statusCode === 403) {
      return json(403, { ok: false, error: error.message || 'Forbidden' });
    }
    return json(500, {
      ok: false,
      error: error && error.message ? error.message : 'postpurchase-orders failed',
    });
  }
};
