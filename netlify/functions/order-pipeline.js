'use strict';

const {
  checkRateLimit,
  json,
  requirePostPurchaseAccess,
  withClient,
} = require('./_lib/db');
const {
  getOrderPipelineDetail,
  getOrderPipelineStats,
  listOrderPipeline,
  listPipelineMonths,
} = require('./_lib/order-pipeline');

function cleanString(value) {
  return value == null ? '' : String(value).trim();
}

function parseIncludeStats(value) {
  const raw = cleanString(value || 'global').toLowerCase();
  if (!raw || raw === 'none' || raw === '0' || raw === 'false') {
    return { global: false, scope: false, value: 'none' };
  }
  const parts = new Set(raw.split(',').map((part) => part.trim()).filter(Boolean));
  return {
    global: parts.has('global') || parts.has('all') || parts.has('true') || parts.has('1'),
    scope: parts.has('scope') || parts.has('all'),
    value: raw,
  };
}

function summarizeFilters(query, includeStats) {
  const search = cleanString(query.q || query.search);
  return {
    includeStats: includeStats.value,
    limit: cleanString(query.limit) || '50',
    offset: cleanString(query.offset) || '0',
    datePreset: cleanString(query.datePreset) || 'this_month',
    hasFrom: Boolean(cleanString(query.from)),
    hasTo: Boolean(cleanString(query.to)),
    status: cleanString(query.status) || 'all',
    reprint: cleanString(query.reprint) || 'all',
    month: cleanString(query.month) || '',
    hasSearch: Boolean(search),
    searchLength: search.length,
  };
}

function cleanApiError(error) {
  const message = error && error.message ? error.message : 'order-pipeline failed';
  if (/connect|timeout|database|neon|ECONN|ENOTFOUND/i.test(message)) {
    return 'Database/API unavailable. Try refresh later.';
  }
  return 'Order pipeline could not be loaded.';
}

exports.handler = async function handler(event) {
  const requestStarted = Date.now();
  const timings = {
    totalMs: 0,
    dbConnectMs: null,
    rowsMs: null,
    globalStatsMs: null,
    globalStatsCacheHit: false,
    scopeStatsMs: null,
    monthsMs: null,
  };
  let query = {};
  let includeStats = parseIncludeStats('global');

  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    checkRateLimit(event, { name: 'order-pipeline', maxRequests: 60, windowMs: 60 * 1000 });
    requirePostPurchaseAccess(event);

    if (event.httpMethod !== 'GET') {
      return json(405, { ok: false, error: 'Method not allowed' }, { allow: 'GET,OPTIONS' });
    }

    query = event.queryStringParameters || {};
    includeStats = parseIncludeStats(query.includeStats);
    const body = await withClient(async (client) => {
      if (query.detail === '1' || query.detail === 'true' || query.id || query.orderNumber) {
        const row = await getOrderPipelineDetail(client, {
          id: query.id,
          orderNumber: query.orderNumber,
        });
        return { ok: true, row };
      }

      const filters = {
        limit: query.limit,
        offset: query.offset,
        month: query.month,
        search: query.search,
        q: query.q,
        datePreset: query.datePreset,
        from: query.from,
        to: query.to,
        status: query.status,
        reprint: query.reprint,
      };
      const page = await listOrderPipeline(client, { ...filters, timings });
      const stats = includeStats.global || includeStats.scope
        ? await getOrderPipelineStats(client, {
          ...filters,
          includeGlobal: includeStats.global,
          includeScope: includeStats.scope,
          timings,
        })
        : null;
      let months = [];
      if (query.includeMonths === '1') {
        const monthsStarted = Date.now();
        months = await listPipelineMonths(client);
        timings.monthsMs = Date.now() - monthsStarted;
      }
      return {
        ok: true,
        rows: page.rows,
        page: {
          limit: page.limit,
          offset: page.offset,
          hasMore: page.hasMore,
          nextOffset: page.nextOffset,
        },
        stats,
        months,
        limit: page.limit,
        offset: page.offset,
        hasMore: page.hasMore,
        nextOffset: page.nextOffset,
      };
    }, {
      onTiming: (name, value) => {
        timings[name] = value;
      },
    });
    timings.totalMs = Date.now() - requestStarted;
    console.log('order-pipeline timing', {
      ...timings,
      filters: summarizeFilters(query, includeStats),
    });
    return json(200, body);
  } catch (error) {
    timings.totalMs = Date.now() - requestStarted;
    console.warn('order-pipeline timing failed', {
      ...timings,
      filters: summarizeFilters(query, includeStats),
    });
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
