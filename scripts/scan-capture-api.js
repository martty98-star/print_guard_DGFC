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

  async function commitScanBatch(options = {}) {
    const response = await (options.fetchImpl || fetch)('/.netlify/functions/commit-scan-batch', {
      method: 'POST',
      headers: options.headers || { 'content-type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({
        batchId: options.batchId || '',
        scans: options.scans || [],
        committedBy: options.committedBy || '',
        operator: options.operator || '',
        station: options.station || '',
      }),
    });
    return readJsonResponse(response, 'Scan batch commit failed');
  }

  global.PrintGuardScanCaptureApi = {
    commitScanBatch,
    readJsonResponse,
  };
})(window);
