/* ============================================================
   PrintGuard — app.js
   Správa skladu (příjem/výdej/inventura) + Colorado audit
   Vanilla JS · IndexedDB · Offline PWA
   ============================================================ */
'use strict';

const PrintGuardAppConfig = typeof window !== 'undefined' && window.PrintGuardAppConfig;
if (!PrintGuardAppConfig) throw new Error('Missing PrintGuardAppConfig');
const { APP_VERSION, cfg, ls } = PrintGuardAppConfig;

const PrintGuardAuth = typeof window !== 'undefined' && window.PrintGuardAuth;
if (!PrintGuardAuth) throw new Error('Missing PrintGuardAuth');
const {
  adminErrorMessage,
  adminHeaders,
  adminJsonHeaders,
  appFetch,
  postPurchaseErrorMessage,
  postPurchaseHeaders,
  postPurchaseJsonHeaders,
} = PrintGuardAuth;

const PrintGuardAppDB = typeof window !== 'undefined' && window.PrintGuardAppDB;
if (!PrintGuardAppDB) throw new Error('Missing PrintGuardAppDB');
const {
  ST_ITEMS,
  ST_MOVES,
  ST_CORECS,
  ST_SETTINGS,
  setDb,
  openDB,
  idbAll,
  idbPut,
  idbDelete,
  idbClear,
} = PrintGuardAppDB;

const PrintGuardSettingsStore = typeof window !== 'undefined' && window.PrintGuardSettingsStore;
if (!PrintGuardSettingsStore) throw new Error('Missing PrintGuardSettingsStore');
const {
  loadSettingsFromIDB,
  saveSettingsToIDB,
} = PrintGuardSettingsStore;

const PrintGuardPushBridge = typeof window !== 'undefined' && window.PrintGuardPushBridge;
if (!PrintGuardPushBridge) throw new Error('Missing PrintGuardPushBridge');
const { getPushEndpointSuffix } = PrintGuardPushBridge;

const PrintGuardUtils = typeof window !== 'undefined' && window.PrintGuardUtils;
if (!PrintGuardUtils) throw new Error('Missing PrintGuardUtils');
const {
  el,
  elSet,
  esc,
  fmtN,
  fmtDays,
  fmtDT,
  toLocalDT,
  toISOfromDT,
  ds,
  csvEsc,
  csvRow,
  fmtFileDT,
  dlBlob,
} = PrintGuardUtils;

const PrintGuardAppUpdates = typeof window !== 'undefined' && window.PrintGuardAppUpdates;
if (!PrintGuardAppUpdates) throw new Error('Missing PrintGuardAppUpdates');
const {
  showPendingUpdateToast,
  setupAppUpdateChecks,
} = PrintGuardAppUpdates;

const PrintGuardAdminAuth = typeof window !== 'undefined' && window.PrintGuardAdminAuth;
if (!PrintGuardAdminAuth) throw new Error('Missing PrintGuardAdminAuth');
const PrintGuardNavigation = typeof window !== 'undefined' && window.PrintGuardNavigation;
if (!PrintGuardNavigation) throw new Error('Missing PrintGuardNavigation');
const PrintGuardAccess = typeof window !== 'undefined' && window.PrintGuardAccess;
if (!PrintGuardAccess) throw new Error('Missing PrintGuardAccess');
const PrintGuardSettingsRuntime = typeof window !== 'undefined' && window.PrintGuardSettingsRuntime;
if (!PrintGuardSettingsRuntime) throw new Error('Missing PrintGuardSettingsRuntime');
const PrintGuardRuntimeUI = typeof window !== 'undefined' && window.PrintGuardRuntimeUI;
if (!PrintGuardRuntimeUI) throw new Error('Missing PrintGuardRuntimeUI');
const PrintGuardRuntimeState = typeof window !== 'undefined' && window.PrintGuardRuntimeState;
if (!PrintGuardRuntimeState) throw new Error('Missing PrintGuardRuntimeState');
const PrintGuardColoradoRuntime = typeof window !== 'undefined' && window.PrintGuardColoradoRuntime;
if (!PrintGuardColoradoRuntime) throw new Error('Missing PrintGuardColoradoRuntime');
const PrintGuardPostPurchaseRuntime = typeof window !== 'undefined' && window.PrintGuardPostPurchaseRuntime;
if (!PrintGuardPostPurchaseRuntime) throw new Error('Missing PrintGuardPostPurchaseRuntime');
const PrintGuardStockRuntime = typeof window !== 'undefined' && window.PrintGuardStockRuntime;
if (!PrintGuardStockRuntime) throw new Error('Missing PrintGuardStockRuntime');
const PrintGuardShell = typeof window !== 'undefined' && window.PrintGuardShell;
if (!PrintGuardShell) throw new Error('Missing PrintGuardShell');
const PrintGuardPrintLogRuntime = typeof window !== 'undefined' && window.PrintGuardPrintLogRuntime;
if (!PrintGuardPrintLogRuntime) throw new Error('Missing PrintGuardPrintLogRuntime');
const PrintGuardReporting = typeof window !== 'undefined' && window.PrintGuardReporting;
if (!PrintGuardReporting) throw new Error('Missing PrintGuardReporting');
const PrintGuardDateFilters = typeof window !== 'undefined' && window.PrintGuardDateFilters;
if (!PrintGuardDateFilters) throw new Error('Missing PrintGuardDateFilters');
const PrintGuardPush = typeof window !== 'undefined' && window.PrintGuardPush;
if (!PrintGuardPush) throw new Error('Missing PrintGuardPush');
const PrintGuardSync = typeof window !== 'undefined' && window.PrintGuardSync;
if (!PrintGuardSync) throw new Error('Missing PrintGuardSync');

function i18n(key) {
  if (typeof window !== 'undefined' && window.I18N && typeof window.I18N.t === 'function') {
    return window.I18N.t(key);
  }
  return key;
}

const Reports = (typeof window !== 'undefined' && window.PrintGuardReports) || {};
const CoreUtils = (typeof window !== 'undefined' && window.PrintGuardCoreUtils) || null;
if (!CoreUtils) throw new Error('Missing PrintGuardCoreUtils');
const DomUtils = (typeof window !== 'undefined' && window.PrintGuardDomUtils) || null;
if (!DomUtils) throw new Error('Missing PrintGuardDomUtils');
const PushUtils = (typeof window !== 'undefined' && window.PrintGuardPushUtils) || null;
if (!PushUtils) throw new Error('Missing PrintGuardPushUtils');
const ExportUtils = (typeof window !== 'undefined' && window.PrintGuardExportUtils) || null;
if (!ExportUtils) throw new Error('Missing PrintGuardExportUtils');
const StockUI = (typeof window !== 'undefined' && window.PrintGuardStockUI) || null;
if (!StockUI) throw new Error('Missing PrintGuardStockUI');
const StockStore = (typeof window !== 'undefined' && window.StockStore) || null;
if (!StockStore) throw new Error('Missing StockStore');
const StockFeature = (typeof window !== 'undefined' && window.StockFeature) || null;
if (!StockFeature) throw new Error('Missing StockFeature');
const StockActions = (typeof window !== 'undefined' && window.PrintGuardStockActions) || null;
if (!StockActions) throw new Error('Missing PrintGuardStockActions');
const StockLogModule = (typeof window !== 'undefined' && window.PrintGuardStockLog) || null;
if (!StockLogModule) throw new Error('Missing PrintGuardStockLog');
const ChecklistUI = (typeof window !== 'undefined' && window.PrintGuardChecklistUI) || null;
if (!ChecklistUI) throw new Error('Missing PrintGuardChecklistUI');
const {
  fmtDuration,
  fmtDurationSeconds,
  fmtInt,
  fmtMeasure,
  genId,
  getNullableNumber,
} = CoreUtils;
const {
  showConfirm,
  showToast,
} = DomUtils;
const {
  buildPushSubscriptionPayload,
  getPushDeviceName,
  persistPushSubscription,
  runNotificationDispatch,
  urlBase64ToUint8Array,
} = PushUtils;
const runtimeUiApi = PrintGuardRuntimeUI.createRuntimeUI({
  cfg,
  t: i18n,
});
const {
  getCostUnitPerM2,
  getCostUnitPerMonth,
} = runtimeUiApi;
const accessApi = PrintGuardAccess.createAccessGuards({
  cfg,
  el,
  elSet,
  showToast,
  t: i18n,
});
const {
  renderPostPurchaseAccessRequired,
  requireAdminPinForScreen,
  requirePostPurchasePinForScreen,
} = accessApi;
const {
  fmtExportDateTime,
} = ExportUtils;

function renderChecklistScreen(force = false) {
  return ChecklistUI.renderChecklistScreen(force);
}

function statusLabel(status) {
  return StockUI.statusLabel(status, i18n);
}

function movementLabel(type) {
  return StockUI.movementLabel(type, i18n);
}

const runtimeStateApi = PrintGuardRuntimeState.createRuntimeState({
  StockStore,
  ST_CORECS,
  ST_ITEMS,
  ST_MOVES,
  adminJsonHeaders,
  elSet,
  fetchImpl: fetch,
  idbAll,
  idbDelete,
  idbPut,
  loadSettingsFromIDB,
});
const { state: S, stockApiAdapter, stockDbAdapter } = runtimeStateApi;

async function loadAll() {
  return runtimeStateApi.loadAll({
    renderAlerts,
    renderCoDashboard,
    renderCoHistory,
    renderItemsMgmt,
    renderStockOverview,
  });
}

// ══════════════════════════════════════════════════════════
//  STOCK — COMPUTATION
// ══════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  COLORADO MODULE
// ══════════════════════════════════════════════════════════

const coloradoRuntimeApi = PrintGuardColoradoRuntime.createColoradoRuntime({
  S,
  ST_CORECS,
  Reports,
  cfg,
  ls,
  el,
  elSet,
  esc,
  fmtDT,
  fmtN,
  genId,
  getNullableNumber,
  idbPut,
  i18n,
  navigate: (...args) => navigationApi.navigate(...args),
  runNotificationDispatch: (...args) => runNotificationDispatch(...args),
  runSync: (...args) => runSync(...args),
  setSyncDirtyReason: (...args) => setSyncDirtyReason(...args),
  showConfirm,
  showToast,
  toISOfromDT,
  toLocalDT,
  dateRangeFilter: (...args) => dateFilters.dateRangeFilter(...args),
  isAdmin: () => isAdmin(),
  adminErrorMessage,
  getCostUnitPerM2,
  getCostUnitPerMonth,
  exportCSVCombinedLifetimeCo: (...args) => exportCSVCombinedLifetimeCo(...args),
});
const {
  MACHINES,
  loadColoradoRollStates,
  loadColoradoRollEvents,
  renderColoradoRollTracker,
  closeColoradoRollModal,
  closeColoradoRollSheet,
  openColoradoRollSheet,
  openColoradoRollModal,
  saveColoradoRollModal,
  undoColoradoRollLoad,
  resetColoradoRollState,
  promptColoradoRollReset,
  getCoRecs,
  computeCoIntervals,
  computeCoStats,
  getCombinedCoLifetimeInkBasis,
  getColoradoFormatEstimates,
  renderCoDashboard,
  setupCoEntry,
  bindColoradoHistoryControls,
  getSelectedMachine,
  updateCoPreview,
  renderCoHistory,
  deleteCoRecord,
} = coloradoRuntimeApi;

//  SETTINGS + EXPORT / IMPORT
// ══════════════════════════════════════════════════════════


// ── CSV helpers ──────────────────────────────────────────

const printLogApi = PrintGuardPrintLogRuntime.createPrintLogRuntime({
  Reports,
  S,
  computeCoIntervals,
  ds,
  el,
  elSet,
  esc,
  fmtDT,
  fmtDuration,
  fmtDurationSeconds,
  fmtInt,
  fmtMeasure,
  fmtN,
  getNullableNumber,
  i18n,
  showToast,
});
const {
  bindPrintLogControls,
  fetchPrintLogRows,
  getPrintLogDirectInk,
  getPrintLogEstimateInterval,
  getPrintLogInkDisplay,
  loadPrintLog,
  mapPrinterName,
  normalizePrintLogRow,
  printResultLabel,
  renderPrintLog,
  renderPrintLogRows,
} = printLogApi;

const pushApi = PrintGuardPush.createPush({
  Reports,
  buildPushSubscriptionPayload,
  cfg,
  getPushDeviceName,
  getPushEndpointSuffix,
  persistPushSubscription,
  showToast,
  urlBase64ToUint8Array,
});
const {
  enablePushNotifications,
  sendStockNotifications,
} = pushApi;

const syncApi = PrintGuardSync.createSync({
  S,
  ST_CORECS,
  ST_ITEMS,
  ST_MOVES,
  ST_SETTINGS,
  StockStore,
  adminHeaders,
  applyRoleUI: (...args) => applyRoleUI(...args),
  cfg,
  el,
  idbClear,
  idbAll,
  idbPut,
  loadAll,
  ls,
  sendStockNotifications,
  showToast,
  stockDbAdapter,
  updateOfflineBanner: (...args) => updateOfflineBanner(...args),
});
const {
  cloudDelete,
  cloudPull,
  cloudPush,
  getLastCloudSyncMs,
  getSyncDirtyReasons,
  runSync,
  setSyncDirtyReason,
  setupBackgroundSync,
} = syncApi;

const reportingApi = PrintGuardReporting.createReporting({
  APP_VERSION,
  MACHINES,
  Reports,
  S,
  ST_CORECS,
  ST_ITEMS,
  ST_MOVES,
  ST_SETTINGS,
  cfg,
  csvRow,
  dlBlob,
  fetchPrintLogRows,
  fmtExportDateTime,
  fmtFileDT,
  fmtN,
  genId,
  getPrintLogDirectInk,
  getPrintLogEstimateInterval,
  getPrintLogInkDisplay,
  i18n,
  idbClear,
  idbPut,
  loadAll,
  mapPrinterName,
  normalizePrintLogRow,
  printResultLabel,
  setSyncDirtyReason,
  showConfirm,
  showToast,
  StockStore,
  stockDbAdapter,
});
const {
  exportCSVCombinedLifetimeCo,
  exportCSVCurrentMonthCo,
  exportCSVIntervals,
  exportCSVPrintLog,
  exportCSVRawCo,
  exportCSVStock,
  exportCSVStockLevels,
  exportJSON,
  handleImportJSON,
} = reportingApi;

let dateFilters;

// ══════════════════════════════════════════════════════════
//  NAVIGATION + ADMIN AUTH
// ══════════════════════════════════════════════════════════

let navigationApi;
const adminAuth = PrintGuardAdminAuth.createAdminAuth({
  cfg,
  el,
  navigate: (...args) => navigationApi.navigate(...args),
  showToast,
});
const {
  applyRoleUI,
  isAdmin,
  setupAdminAuthHandlers,
} = adminAuth;

const stockRuntimeApi = PrintGuardStockRuntime.createStockRuntime({
  S,
  StockActions,
  StockFeature,
  StockLogModule,
  StockStore,
  StockUI,
  Reports,
  adminErrorMessage,
  cfg,
  cloudDelete,
  dlBlob,
  el,
  elSet,
  esc,
  fmtDT,
  fmtDays,
  fmtExportDateTime,
  fmtFileDT,
  fmtN,
  genId,
  i18n,
  isAdmin,
  movementLabel,
  navigate: (...args) => navigationApi.navigate(...args),
  runNotificationDispatch,
  setSyncDirtyReason,
  showConfirm,
  showToast,
  statusLabel,
  stockApiAdapter,
  stockDbAdapter,
});
const {
  computeStock,
  deleteItem,
  deleteMovement,
  deleteMovementAdmin,
  exportCSVStockLog,
  getMovements,
  initFeature: initStockFeature,
  initRuntime: initStockRuntime,
  openItemModal,
  openStockDetail,
  renderAlerts,
  renderItemsMgmt,
  renderStockLog,
  renderStockOverview,
  saveItemModal,
  saveMovement,
} = stockRuntimeApi;
initStockRuntime();

const settingsRuntimeApi = PrintGuardSettingsRuntime.createSettingsRuntime({
  APP_VERSION,
  ST_CORECS,
  ST_ITEMS,
  ST_MOVES,
  ST_SETTINGS,
  S,
  cfg,
  el,
  enablePushNotifications,
  exportCSVIntervals,
  exportCSVRawCo,
  exportCSVStock,
  exportCSVStockLevels,
  exportJSON,
  fetchImpl: appFetch,
  handleImportJSON,
  i18n,
  idbClear,
  renderAlerts,
  renderCoDashboard,
  renderCoHistory,
  renderItemsMgmt,
  renderStockOverview,
  saveSettingsToIDB,
  sendStockNotifications,
  showConfirm,
  showToast,
});
const {
  initRuntime: initSettingsRuntime,
  loadSettingsUI,
} = settingsRuntimeApi;

const postPurchaseRuntimeApi = PrintGuardPostPurchaseRuntime.createPostPurchaseRuntime({
  S,
  adminJsonHeaders,
  applyRoleUI,
  cfg,
  el,
  elSet,
  esc,
  fetchImpl: appFetch,
  fmtDT,
  postPurchaseErrorMessage,
  postPurchaseHeaders,
  postPurchaseJsonHeaders,
  renderPostPurchaseAccessRequired,
  requirePostPurchasePinForScreen,
  showToast,
});
const {
  bindControls: bindPostPurchaseControls,
  initRuntime: initPostPurchaseRuntime,
  loadPostPurchaseOrders,
  renderPostPurchaseOrders,
  syncPostPurchaseOrdersManual,
} = postPurchaseRuntimeApi;

dateFilters = PrintGuardDateFilters.createDateFilters({
  Reports,
  S,
  el,
  loadPrintLog,
  renderCoHistory,
  renderStockLog,
});
const {
  applyPreset,
  dateRangeFilter,
} = dateFilters;

navigationApi = PrintGuardNavigation.createNavigation({
  applyRoleUI,
  el,
  loadPostPurchaseOrders,
  loadPrintLog,
  loadSettingsUI,
  ls,
  renderAlerts,
  renderChecklistScreen,
  renderCoHistory,
  renderItemsMgmt,
  renderStockLog,
  state: S,
});
const {
  getInitialScreen,
  navigate,
  setMode,
  updateOfflineBanner,
} = navigationApi;

const shellApi = PrintGuardShell.createShell({
  applyPreset,
  closeColoradoRollModal,
  closeColoradoRollSheet,
  el,
  getInitialScreen,
  loadColoradoRollEvents,
  loadColoradoRollStates,
  navigate,
  openColoradoRollSheet,
  renderColoradoRollTracker,
  runSync,
  saveColoradoRollModal,
  setMode,
  state: S,
  updateOfflineBanner,
});
const { bindShellControls } = shellApi;

// ══════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════

window.enablePushNotifications = enablePushNotifications;

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

async function init() {
  if (window.I18N && typeof window.I18N.init === 'function') {
    window.I18N.init();
  }
  setDb(await openDB());
  S.coloradoRolls = loadColoradoRollStates();
  S.coloradoRollEvents = loadColoradoRollEvents();
  bindShellControls();

  initStockFeature();

  // Colorado history tabs
  setupCoEntry();
  bindColoradoHistoryControls({
    exportCSVCurrentMonthCo,
    exportCSVRawCo,
  });
  ChecklistUI.initChecklistUI({
    applyRoleUI,
    adminErrorMessage,
    adminHeaders,
    cfg,
    el,
    fetchImpl: appFetch,
    i18n,
    showConfirm,
    showToast,
  });
  initSettingsRuntime();
  initPostPurchaseRuntime();
  bindPostPurchaseControls();

  bindPrintLogControls({
    exportCSVPrintLog,
  });

  setupAdminAuthHandlers();

  await loadAll();
  applyRoleUI(); // ✅ IMPORTANT
  setupBackgroundSync();
  showPendingUpdateToast();

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .then((registration) => {
        registration.update().catch(() => {});
      })
      .catch(e => console.warn('[SW]', e));
    setupAppUpdateChecks();
  }

  navigate(getInitialScreen(), { replace: true });
  applyRoleUI();
}

window.addEventListener('i18n:changed', () => {
  const costCurrencySelect = el('cfg-cost-currency');
  if (costCurrencySelect && !ls('pg_cost_currency')) {
    costCurrencySelect.value = cfg.costCurrency;
  }
  try { renderStockOverview(); } catch (_) {}
  try { renderAlerts(); } catch (_) {}
  try { renderItemsMgmt(); } catch (_) {}
  try { renderStockLog(); } catch (_) {}
  try { renderCoDashboard(); } catch (_) {}
  try { renderCoHistory(); } catch (_) {}
  try { renderPrintLogRows(); } catch (_) {}
  try { renderPostPurchaseOrders(); } catch (_) {}
  try { renderChecklistScreen(false); } catch (_) {}
});

document.addEventListener('DOMContentLoaded', init);
