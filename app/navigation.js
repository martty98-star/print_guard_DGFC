/* PrintGuard — screen routing and mode helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardNavigation(global) {
  const LAST_SCREEN_KEY = 'pg_last_screen';
  const DEFAULT_SCREEN = 'stock-overview';

  function createNavigation(deps) {
    const {
      applyRoleUI, el, loadManagementReporting, loadPostPurchaseOrders, loadPrintLog, loadScanCaptureScreen, loadSettingsUI,
      ls, renderAlerts, renderChecklistScreen, renderCoHistory, renderItemsMgmt,
      renderStockLog, state,
    } = deps;

    function isValidScreen(screenId) {
      return Boolean(screenId && el('screen-' + screenId));
    }

    function getInitialScreen() {
      const params = new URLSearchParams(global.location.search);
      const urlScreen = params.get('screen');
      if (isValidScreen(urlScreen)) return urlScreen;
      const storedScreen = ls(LAST_SCREEN_KEY);
      if (isValidScreen(storedScreen)) return storedScreen;
      return isValidScreen('home') ? 'home' : DEFAULT_SCREEN;
    }

    function getModeForScreen(screenId) {
      return ['co-dashboard', 'co-entry', 'co-history', 'print-log', 'postpurchase-orders', 'scan-capture', 'management-reporting'].includes(screenId)
        ? 'colorado'
        : 'stock';
    }

    function applyModeUI(mode) {
      state.mode = mode === 'colorado' ? 'colorado' : 'stock';
      document.querySelectorAll('.mode-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.mode === state.mode));
      el('stock-nav')?.classList.toggle('hidden', state.mode !== 'stock');
      el('colorado-nav')?.classList.toggle('hidden', state.mode !== 'colorado');
    }

    function persistScreenRoute(screenId, options = {}) {
      if (!isValidScreen(screenId)) return;
      ls(LAST_SCREEN_KEY, screenId);
      const params = new URLSearchParams(global.location.search);
      if (params.get('screen') === screenId && !options.replace) return;
      params.set('screen', screenId);
      const nextUrl = `${global.location.pathname}?${params.toString()}${global.location.hash || ''}`;
      const routeState = { screen: screenId };
      if (options.replace) global.history.replaceState(routeState, '', nextUrl);
      else global.history.pushState(routeState, '', nextUrl);
    }

    function navigate(screenId, options = {}) {
      if (!isValidScreen(screenId)) screenId = DEFAULT_SCREEN;
      applyModeUI(getModeForScreen(screenId));
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      el('screen-' + screenId)?.classList.add('active');
      document.querySelectorAll('#stock-nav .nav-item, #colorado-nav .nav-item').forEach(b =>
        b.classList.toggle('active', b.dataset.screen === screenId)
      );
      if (screenId === 'stock-alerts') renderAlerts();
      if (screenId === 'checklist') renderChecklistScreen();
      if (screenId === 'stock-items') renderItemsMgmt();
      if (screenId === 'stock-log') renderStockLog();
      if (screenId === 'co-history') renderCoHistory();
      if (screenId === 'print-log') loadPrintLog();
      if (screenId === 'postpurchase-orders') loadPostPurchaseOrders();
      if (screenId === 'scan-capture' && typeof loadScanCaptureScreen === 'function') loadScanCaptureScreen();
      if (screenId === 'management-reporting' && typeof loadManagementReporting === 'function') loadManagementReporting();
      if (screenId === 'settings') loadSettingsUI();
      persistScreenRoute(screenId, options);
      global.scrollTo(0, 0);
      applyRoleUI();
    }

    function setMode(mode) {
      applyModeUI(mode);
      navigate(mode === 'stock' ? 'stock-overview' : 'co-dashboard');
    }

    function updateOfflineBanner() {
      el('offline-banner')?.classList.toggle('hidden', navigator.onLine);
    }

    return { getInitialScreen, navigate, setMode, updateOfflineBanner };
  }

  global.PrintGuardNavigation = { createNavigation };
})(window);
