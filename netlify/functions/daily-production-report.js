'use strict';

const {
  checkRateLimit,
  json,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const {
  buildDailyProductionReport,
} = require('./_lib/daily-production-report');

function cleanApiError(error) {
  const message = error && error.message ? error.message : 'daily-production-report failed';
  if (/connect|timeout|database|neon|ECONN|ENOTFOUND/i.test(message)) {
    return 'Database/API unavailable. Try refresh later.';
  }
  return 'Daily production report could not be generated.';
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    checkRateLimit(event, { name: 'daily-production-report', maxRequests: 30, windowMs: 60 * 1000 });
    requirePostPurchaseAccess(event);

    if (event.httpMethod !== 'GET') {
      return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,OPTIONS' });
    }

    const query = event.queryStringParameters || {};
    const body = await withClient((client) => buildDailyProductionReport(client, {
      date: query.date,
    }));
    return json(200, body);
  } catch (error) {
    if (error && (error.statusCode === 400 || error.statusCode === 401 || error.statusCode === 403 || error.statusCode === 429)) {
      return json(error.statusCode, { ok: false, error: error.message || 'Request failed' });
    }
    console.error('daily-production-report failed', {
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
