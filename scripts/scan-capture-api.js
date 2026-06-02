'use strict';

(function attachScanCaptureApi(global) {
  const LS_API_BASE = 'pg_scan_capture_api_base';
  const DEFAULT_REMOTE_BASE = 'http://10.25.0.15:17910';

  function trimSlash(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function sameOriginCanServeScanApi() {
    const loc = global.location;
    return Boolean(loc && (
      loc.hostname === 'printguard-scan.dgfc.local' ||
      loc.port === '17910'
    ));
  }

  function defaultBase() {
    if (sameOriginCanServeScanApi()) return '';
    return DEFAULT_REMOTE_BASE;
  }

  function getConfiguredBase() {
    const explicit = trimSlash(global.SCAN_CAPTURE_API_BASE);
    if (explicit) return explicit;
    try {
      const stored = trimSlash(global.localStorage && global.localStorage.getItem(LS_API_BASE));
      if (stored) return stored;
    } catch (_) {}
    return defaultBase();
  }

  function setConfiguredBase(value) {
    const cleaned = trimSlash(value);
    try {
      if (cleaned) global.localStorage.setItem(LS_API_BASE, cleaned);
      else global.localStorage.removeItem(LS_API_BASE);
    } catch (_) {}
    return getConfiguredBase();
  }

  function urlFor(path) {
    const base = getConfiguredBase();
    const cleanPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
    return base ? `${base}${cleanPath}` : cleanPath;
  }

  async function request(path, options = {}) {
    const response = await fetch(urlFor(path), {
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
    });
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch (_) {
        data = { ok: false, error: text };
      }
    }
    if (!response.ok) {
      const message = data && (data.error || data.message) ? (data.error || data.message) : `HTTP ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data || { ok: true };
  }

  function jsonPost(path, payload) {
    return request(path, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  }

  function recent(count = 20) {
    return request(`/recent?count=${encodeURIComponent(count)}`);
  }

  global.PrintGuardScanCaptureApi = {
    DEFAULT_REMOTE_BASE,
    getConfiguredBase,
    setConfiguredBase,
    health: () => request('/health'),
    recent,
    pending: () => request('/pending-scans'),
    scan: (payload) => jsonPost('/scan', payload),
    commit: (payload) => jsonPost('/commit-scans', payload),
    deleteScan: (payload) => request('/scan', {
      method: 'DELETE',
      body: JSON.stringify(payload || {}),
      headers: { 'Content-Type': 'application/json' },
    }),
  };
})(window);
