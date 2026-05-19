'use strict';

(() => {
  function t(key) {
    return window.I18N && typeof window.I18N.t === 'function' ? window.I18N.t(key) : key;
  }

  async function readJsonResponse(res, fallbackMessage) {
    const text = await res.text().catch(() => '');
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
  }

  function buildDailyReportUrl(date) {
    const params = new URLSearchParams();
    if (date) params.set('date', date);
    const suffix = params.toString();
    return '/.netlify/functions/daily-production-report' + (suffix ? `?${suffix}` : '');
  }

  async function loadDailyReport(options) {
    const res = await options.fetchImpl(buildDailyReportUrl(options.date), {
      headers: options.headers || {},
      cache: 'no-store',
    });
    return readJsonResponse(res, t('daily-report.error.load'));
  }

  window.PrintGuardDailyReportApi = {
    buildDailyReportUrl,
    loadDailyReport,
  };
})();
