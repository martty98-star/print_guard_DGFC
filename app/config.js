/* PrintGuard — app config + localStorage helper (loaded before app.js) */
'use strict';

(function attachPrintGuardAppConfig(global) {
  const APP_VERSION = 'printguard-7.0.5';

  function ls(k, v) {
    if (v !== undefined) { localStorage.setItem(k, String(v)); return v; }
    return localStorage.getItem(k);
  }

  function normalizeTheme(value) {
    return value === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(value) {
    const theme = normalizeTheme(value);
    if (global.document && global.document.documentElement) {
      global.document.documentElement.dataset.theme = theme;
    }
    const metaTheme = global.document && global.document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? '#171512' : '#f5f2ed');
    return theme;
  }

  const cfg = {
    get theme() { return normalizeTheme(ls('pg_theme') || 'light'); },
    set theme(v) { ls('pg_theme', applyTheme(v)); },
    get weeksN()      { return parseInt(ls('pg_weeks')   || '8', 10); },
    set weeksN(v)     { ls('pg_weeks', v); },
    get rollingN()    { return parseInt(ls('pg_rolling') || '8', 10); },
    set rollingN(v)   { ls('pg_rolling', v); },
    get inkCost()     { return parseFloat(ls('pg_ink_cost')   || '0'); },
    set inkCost(v)    { ls('pg_ink_cost', v); },
    get mediaCost()   { return parseFloat(ls('pg_media_cost') || '0'); },
    set mediaCost(v)  { ls('pg_media_cost', v); },
    get costCurrency() {
      const stored = String(ls('pg_cost_currency') || '').toUpperCase();
      if (stored === 'CZK' || stored === 'SEK') return stored;
      const lang =
        (typeof global !== 'undefined' && global.I18N && global.I18N.currentLang) ||
        (typeof global !== 'undefined' && global.I18N && global.I18N.defaultLang) ||
        (typeof document !== 'undefined' && document.documentElement.lang) ||
        'cs';
      return lang === 'en' ? 'SEK' : 'CZK';
    },
    set costCurrency(v) {
      const norm = String(v || '').toUpperCase();
      ls('pg_cost_currency', norm === 'CZK' ? 'CZK' : 'SEK');
    },
    get deviceId() {
      let id = ls('pg_device_id');
      if (!id) { id = 'pg-' + Math.random().toString(36).slice(2, 10); ls('pg_device_id', id); }
      return id;
    },
    get userName() { return ls('pg_user_name') || ''; },
    set userName(v) { ls('pg_user_name', v); },
    get role() { return ls('pg_role') || 'operator'; },
    set role(v) { ls('pg_role', v); },
    get adminPin() { return sessionStorage.getItem('pg_admin_pin') || ''; },
    set adminPin(v) {
      const value = String(v || '').trim();
      if (value) sessionStorage.setItem('pg_admin_pin', value);
      else sessionStorage.removeItem('pg_admin_pin');
    },
    get postPurchasePin() { return sessionStorage.getItem('pg_postpurchase_pin') || ''; },
    set postPurchasePin(v) {
      const value = String(v || '').trim();
      if (value) sessionStorage.setItem('pg_postpurchase_pin', value);
      else sessionStorage.removeItem('pg_postpurchase_pin');
    },
  };

  global.PrintGuardAppConfig = {
    APP_VERSION,
    applyTheme,
    cfg,
    ls,
  };

  applyTheme(cfg.theme);
})(typeof window !== 'undefined' ? window : globalThis);
