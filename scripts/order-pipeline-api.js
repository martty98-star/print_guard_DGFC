'use strict';

(() => {
  const Filters = window.PrintGuardOrderPipelineFilters;
  if (!Filters) throw new Error('Missing PrintGuardOrderPipelineFilters');

  function t(key) {
    return window.I18N && typeof window.I18N.t === 'function' ? window.I18N.t(key) : key;
  }

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
      const message = payload.error || fallbackMessage || `${t('processed.error.request-failed')} (${res.status})`;
      const error = new Error(res.status >= 500 ? t('processed.error.database') : message);
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
    return readJsonResponse(res, t('processed.error.pipeline-load'));
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
    return readJsonResponse(res, t('processed.toast.reprint-create-failed'));
  }

  async function loadReprintHistory(options) {
    const orderIds = Array.from(new Set((options.orderIds || []).filter(Boolean)));
    if (!orderIds.length) return { ok: true, requests: [] };
    const params = new URLSearchParams({ reprintHistoryOrderIds: orderIds.join(',') });
    const res = await options.fetchImpl('/.netlify/functions/processed-print-orders?' + params.toString(), {
      headers: options.headers || {},
      cache: 'no-store',
    });
    return readJsonResponse(res, t('processed.error.reprint-history'));
  }

  async function resolveReprintRequest(options) {
    const payload = options.payload || {};
    const res = await options.fetchImpl('/.netlify/functions/processed-print-orders', {
      method: 'POST',
      headers: options.headers || {},
      cache: 'no-store',
      body: JSON.stringify({
        action: 'mark_reprinted',
        orderId: payload.orderId,
        printFilePath: payload.printFilePath,
      }),
    });
    return readJsonResponse(res, t('processed.toast.reprint-resolve-failed'));
  }

  async function deleteReprintRequest(options) {
    const payload = options.payload || {};
    const res = await options.fetchImpl('/.netlify/functions/processed-print-orders', {
      method: 'POST',
      headers: options.headers || {},
      cache: 'no-store',
      body: JSON.stringify({
        action: payload.action || 'delete_reprint',
        id: payload.id,
      }),
    });
    return readJsonResponse(res, t('processed.toast.reprint-delete-failed'));
  }

  window.PrintGuardOrderPipelineApi = {
    buildOrderPipelineUrl,
    createReprintRequest,
    deleteReprintRequest,
    loadReprintHistory,
    loadOrderPipeline,
    readJsonResponse,
    resolveReprintRequest,
  };
})();
