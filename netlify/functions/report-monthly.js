'use strict';

const {
  checkRateLimit,
  json,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const {
  loadMonthlyReport,
} = require('./_lib/management-reporting');

function cleanApiError(error) {
  const message = error && error.message ? error.message : 'report-monthly failed';
  if (/connect|timeout|database|neon|ECONN|ENOTFOUND/i.test(message)) {
    return 'Database unavailable. Try refresh later.';
  }
  return 'Monthly management report could not be generated.';
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, {});

  try {
    checkRateLimit(event, { name: 'report-monthly', maxRequests: 30, windowMs: 60 * 1000 });
    requirePostPurchaseAccess(event);

    if (event.httpMethod !== 'GET') {
      return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,OPTIONS' });
    }

    const query = event.queryStringParameters || {};
    const body = await withClient((client) => loadMonthlyReport(client, {
      month: query.month,
    }));
    return json(200, body);
  } catch (error) {
    if (error && [400, 401, 403, 429].includes(error.statusCode)) {
      return json(error.statusCode, { ok: false, error: error.message || 'Request failed' });
    }
    console.error('report-monthly failed', {
      message: error && error.message,
      code: error && error.code,
      detail: error && error.detail,
      hint: error && error.hint,
      stack: error && error.stack,
    });
    return json(500, { ok: false, error: cleanApiError(error) });
  }
};
