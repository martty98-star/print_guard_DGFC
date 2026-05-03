/* PrintGuard — Web Push bridge helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardPushBridge(global) {
  function getPushEndpointSuffix(endpoint) {
    return typeof endpoint === 'string' && endpoint.length > 24
      ? endpoint.slice(-24)
      : (typeof endpoint === 'string' ? endpoint : '');
  }

  global.PrintGuardPushBridge = {
    getPushEndpointSuffix,
  };
})(typeof window !== 'undefined' ? window : globalThis);
