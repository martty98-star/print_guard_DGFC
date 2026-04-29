'use strict';

(() => {
  const Filters = window.PrintGuardOrderPipelineFilters;
  if (!Filters) throw new Error('Missing PrintGuardOrderPipelineFilters');

  async function readJsonResponse(res, fallbackMessage) {
    const text = await res.text().catch(() => '');
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = {};
      }
    }
    if (!res.ok || payload.ok === false) {
      const message = payload.error || fallbackMessage || `Request failed (${res.status})`;
      const error = new Error(res.status >= 500 ? 'Database/API unavailable. Try refresh later.' : message);
      error.status = res.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function buildOrderPipelineUrl(filters) {
    return '/.netlify/functions/order-pipeline?' + Filters.toQueryParams(filters).toString();
  }

  async function loadOrderPipeline(options) {
    const fetchImpl = options.fetchImpl;
    const res = await fetchImpl(buildOrderPipelineUrl(options.filters || {}), {
      headers: options.headers || {},
      cache: 'no-store',
    });
    return readJsonResponse(res, 'Failed to load order pipeline');
  }

  async function createReprintRequest(options) {
    const payload = options.payload || {};
    const res = await options.fetchImpl('/.netlify/functions/processed-print-orders', {
      method: 'POST',
      headers: options.headers || {},
      cache: 'no-store',
      body: JSON.stringify({
        action: 'reprint',
        orderId: payload.orderId,
        printFilePath: payload.printFilePath,
        reason: payload.reason,
        note: payload.note,
        requestedBy: payload.requestedBy,
        workstationId: payload.workstationId,
      }),
    });
    return readJsonResponse(res, 'Failed to create reprint request');
  }

  async function resolveReprintRequest(options) {
    const payload = options.payload || {};
    const res = await options.fetchImpl('/.netlify/functions/processed-print-orders', {
      method: 'POST',
      headers: options.headers || {},
      cache: 'no-store',
      body: JSON.stringify({
        action: 'resolve_reprint',
        orderId: payload.orderId,
        printFilePath: payload.printFilePath,
      }),
    });
    return readJsonResponse(res, 'Failed to resolve reprint request');
  }

  window.PrintGuardOrderPipelineApi = {
    buildOrderPipelineUrl,
    createReprintRequest,
    loadOrderPipeline,
    readJsonResponse,
    resolveReprintRequest,
  };
})();
