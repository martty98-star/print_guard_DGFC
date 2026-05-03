/* PrintGuard - fetch + auth header helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardAuth(global) {
  const AppConfig = global.PrintGuardAppConfig;
  if (!AppConfig) throw new Error('Missing PrintGuardAppConfig');
  const { cfg } = AppConfig;

  function appFetch(url, options) {
    if (typeof global.fetch === 'function') {
      return global.fetch(url, options);
    }
    return fetch(url, options);
  }

  function getAdminPinForRequest() {
    const pin = String(cfg.adminPin || '').trim();
    if (!pin) {
      throw new Error('Admin PIN is required for this action.');
    }
    return pin;
  }

  function adminHeaders(extra = {}) {
    return {
      ...extra,
      'x-admin-pin': getAdminPinForRequest(),
    };
  }

  function adminJsonHeaders(extra = {}) {
    return adminHeaders({
      'content-type': 'application/json',
      ...extra,
    });
  }

  function adminErrorMessage(error) {
    const message = error && error.message ? error.message : String(error || '');
    return message === 'Unauthorized' ? 'Invalid or expired admin PIN.' : message;
  }

  function getPostPurchasePinForRequest() {
    const pin = String(cfg.postPurchasePin || cfg.adminPin || '').trim();
    if (!pin) {
      throw new Error('Processed Orders PIN is required for this action.');
    }
    return pin;
  }

  function postPurchaseHeaders(extra = {}) {
    if (cfg.postPurchasePin) {
      return {
        ...extra,
        'x-postpurchase-pin': getPostPurchasePinForRequest(),
      };
    }
    return adminHeaders(extra);
  }

  function postPurchaseJsonHeaders(extra = {}) {
    return postPurchaseHeaders({
      'content-type': 'application/json',
      ...extra,
    });
  }

  function postPurchaseErrorMessage(error) {
    const message = error && error.message ? error.message : String(error || '');
    if (message === 'Unauthorized') return 'Invalid or expired Processed Orders PIN.';
    if (/illegal invocation/i.test(message) || /failed to fetch/i.test(message) || /networkerror/i.test(message)) {
      return 'Database/API unavailable. Try refresh later.';
    }
    return message;
  }

  global.PrintGuardAuth = {
    adminErrorMessage,
    adminHeaders,
    adminJsonHeaders,
    appFetch,
    getAdminPinForRequest,
    getPostPurchasePinForRequest,
    postPurchaseErrorMessage,
    postPurchaseHeaders,
    postPurchaseJsonHeaders,
  };
})(typeof window !== 'undefined' ? window : globalThis);
