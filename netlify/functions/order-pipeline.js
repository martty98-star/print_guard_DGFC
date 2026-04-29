'use strict';

const {
  checkRateLimit,
  json,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const {
  listOrderPipeline,
  listPipelineMonths,
} = require('./_lib/order-pipeline');

function cleanApiError(error) {
  const message = error && error.message ? error.message : 'order-pipeline failed';
  if (/connect|timeout|database|neon|ECONN|ENOTFOUND/i.test(message)) {
    return 'Database/API unavailable. Try refresh later.';
  }
  return 'Order pipeline could not be loaded.';
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    checkRateLimit(event, { name: 'order-pipeline', maxRequests: 60, windowMs: 60 * 1000 });
    requirePostPurchaseAccess(event);

    if (event.httpMethod !== 'GET') {
      return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,OPTIONS' });
    }

    const query = event.queryStringParameters || {};
    const body = await withClient(async (client) => {
      const rows = await listOrderPipeline(client, {
        limit: query.limit,
        month: query.month,
        search: query.search,
        q: query.q,
        datePreset: query.datePreset,
        from: query.from,
        to: query.to,
        reprint: query.reprint,
      });
      const months = await listPipelineMonths(client);
      return { ok: true, rows, months };
    });
    return json(200, body);
  } catch (error) {
    if (error && (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 429)) {
      return json(error.statusCode, { ok: false, error: error.message || 'Request failed' });
    }
    console.error('order-pipeline failed', {
      message: error && error.message,
      code: error && error.code,
      detail: error && error.detail,
      hint: error && error.hint,
      stack: error && error.stack,
    });
    return json(500, {
      ok: false,
      error: cleanApiError(error),
    });
  }
};
