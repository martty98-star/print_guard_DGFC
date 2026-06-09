'use strict';

(function attachScanCaptureApi(global) {
  async function readJsonResponse(response, fallbackMessage) {
    const text = await response.text().catch(() => '');
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (_) {
        payload = {};
      }
    }
    if (!response.ok || payload.ok === false) {
      const message = payload.error || fallbackMessage || `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function makeTimeoutError(message) {
    const error = new Error(message || 'Request timed out');
    error.isTimeout = true;
    return error;
  }

  async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
    if (!timeoutMs || !global.AbortController) {
      return (options.fetchImpl || fetch)(url, options);
    }
    const fetchImpl = options.fetchImpl || fetch;
    const controller = new AbortController();
    const timer = global.setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw makeTimeoutError('Scan batch commit timed out');
      }
      throw error;
    } finally {
      global.clearTimeout(timer);
    }
  }

  async function commitScanBatch(options = {}) {
    const response = await fetchWithTimeout('/.netlify/functions/commit-scan-batch', {
      method: 'POST',
      headers: options.headers || { 'content-type': 'application/json' },
      cache: 'no-store',
      fetchImpl: options.fetchImpl || fetch,
      body: JSON.stringify({
        batchId: options.batchId || '',
        scans: options.scans || [],
        committedBy: options.committedBy || '',
        operator: options.operator || '',
        station: options.station || '',
      }),
    }, options.timeoutMs == null ? 25000 : options.timeoutMs);
    return readJsonResponse(response, 'Scan batch commit failed');
  }

  async function getScanBatchStatus(options = {}) {
    const batchId = String(options.batchId || '').trim();
    const params = new URLSearchParams({ batchId });
    const response = await (options.fetchImpl || fetch)(`/.netlify/functions/commit-scan-batch?${params.toString()}`, {
      method: 'GET',
      headers: options.headers || {},
      cache: 'no-store',
    });
    return readJsonResponse(response, 'Scan batch status failed');
  }

  global.PrintGuardScanCaptureApi = {
    commitScanBatch,
    getScanBatchStatus,
    readJsonResponse,
  };
})(window);
