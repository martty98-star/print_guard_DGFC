'use strict';

(() => {
  function readJsonResponse(res, fallbackMessage) {
    return res.text().then((text) => {
      let payload = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = {};
        }
      }
      if (!res.ok || payload.ok === false) {
        const error = new Error(payload.error || fallbackMessage || `Request failed (${res.status})`);
        error.status = res.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    });
  }

  function buildUrl(path, params) {
    const query = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const suffix = query.toString();
    return path + (suffix ? `?${suffix}` : '');
  }

  function loadMonthlyReport(options) {
    return options.fetchImpl(buildUrl('/.netlify/functions/report-monthly', { month: options.month }), {
      headers: options.headers || {},
      cache: 'no-store',
    }).then((res) => readJsonResponse(res, 'Monthly report load failed'));
  }

  function loadEodReport(options) {
    return options.fetchImpl(buildUrl('/.netlify/functions/report-eod', { date: options.date }), {
      headers: options.headers || {},
      cache: 'no-store',
    }).then((res) => readJsonResponse(res, 'EOD report load failed'));
  }

  window.PrintGuardManagementReportingApi = {
    loadEodReport,
    loadMonthlyReport,
  };
})();
