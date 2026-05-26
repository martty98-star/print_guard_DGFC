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
const PrintGuardPrintLog = typeof window !== 'undefined' && window.PrintGuardPrintLog;
if (!PrintGuardPrintLog) throw new Error('Missing PrintGuardPrintLog');
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
const SettingsUI = (typeof window !== 'undefined' && window.PrintGuardSettingsUI) || null;
if (!SettingsUI) throw new Error('Missing PrintGuardSettingsUI');
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
const PrintLogUI = (typeof window !== 'undefined' && window.PrintGuardPrintLogUI) || null;
if (!PrintLogUI) throw new Error('Missing PrintGuardPrintLogUI');
const ChecklistUI = (typeof window !== 'undefined' && window.PrintGuardChecklistUI) || null;
if (!ChecklistUI) throw new Error('Missing PrintGuardChecklistUI');
const PostPurchaseUI = (typeof window !== 'undefined' && window.PrintGuardPostPurchaseUI) || null;
if (!PostPurchaseUI) throw new Error('Missing PrintGuardPostPurchaseUI');
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
const {
  loadSettingsUI: loadSettingsUIScreen,
  setupSettings: setupSettingsUI,
} = SettingsUI;
const {
  fmtExportDateTime,
} = ExportUtils;
const {
  getPrintLogTodayQueueBasisLabel: getPrintLogTodayQueueBasisLabelUI,
  printLogRangeLabel: printLogRangeLabelUI,
  printResultClass: printResultClassUI,
  printResultLabel: printResultLabelUI,
  renderPrintLogComparison: renderPrintLogComparisonUI,
  renderPrintLogSummary: renderPrintLogSummaryUI,
  renderPrintLogTodayQueue: renderPrintLogTodayQueueUI,
} = PrintLogUI;

function getCostUnitPerM2() {
  return `${cfg.costCurrency} / m²`;
}

function getCostUnitPerMonth() {
  return `${cfg.costCurrency} / ${i18n('unit.month-word')}`;
}

function loadSettingsUI() {
  return loadSettingsUIScreen({ APP_VERSION, cfg, el });
}

function requireAdminPinForScreen(statusId, wrapId) {
  if (cfg.adminPin) return true;

  if (statusId) elSet(statusId, 'Admin PIN required');
  const wrap = wrapId ? el(wrapId) : null;
  if (wrap) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>Admin PIN is required for this action.</p><div class="table-empty-note">Open Settings, enter the admin PIN, and unlock admin mode.</div></div>`;
  }
  showToast('Admin PIN is required for this action.', 'error');
  return false;
}

function renderPostPurchaseAccessRequired() {
  const t = window.I18N && typeof window.I18N.t === 'function' ? window.I18N.t.bind(window.I18N) : (key) => key;
  elSet('postpurchase-status', t('processed.status.pin-required'));
  const wrap = el('postpurchase-orders-wrap');
  if (wrap) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>${t('processed.pin.required')}</p><div class="table-empty-note">${t('processed.pin.required-note')}</div></div>`;
  }
}

function requirePostPurchasePinForScreen() {
  if (cfg.postPurchasePin || cfg.adminPin) return true;
  renderPostPurchaseAccessRequired();
  showToast(window.I18N ? window.I18N.t('processed.pin.required') : 'Processed Orders PIN is required.', 'error');
  return false;
}

function renderChecklistScreen(force = false) {
  return ChecklistUI.renderChecklistScreen(force);
}

function statusLabel(status) {
  return StockUI.statusLabel(status, i18n);
}

function movementLabel(type) {
  return StockUI.movementLabel(type, i18n);
}

// ── App state ──────────────────────────────────────────────
const S = {
  items:       [],     // catalog
  movements:   [],     // sorted by timestamp asc
  coRecords:   [],     // sorted by timestamp asc
  coloradoRolls: {},
  coloradoRollEvents: {},
  mode:        'stock',
  stockFilter: 'all',
  stockSearch: '',
  detailArticle: null,
  coHistMachine: 'colorado1',
  editingItem:   null,
  movType:       'issue',
  movItem:       null,
  logFilter:     'all',
  logSearch:     '',
  logDateFrom:   '',
  logDateTo:     '',
  coDateFrom:    '',
  coDateTo:      '',
  printLogDateFrom: '',
  printLogDateTo:   '',
  printLogPrinter:  'all',
  printLogResult:   'all',
  printLogRows:     [],
  printLogOffset:   0,
  printLogHasMore:  true,
  printLogSummary:  null,
  printLogTodayQueue: null,
  printLogLoading:  false,
  printLogLoaded:   false,
  printLogViewMode: 'raw',
  printLogGroupFilter: 'all',
  printLogExpandedGroups: {},
  postPurchaseOrders: [],
  postPurchaseLoading: false,
  postPurchaseLoaded: false,
  postPurchaseFilter: 'open',
  postPurchaseSearch: '',
  postPurchaseSearchTimer: null,
  postPurchaseAbortController: null,
  postPurchaseStatus: 'all',
  postPurchaseLimit: '50',
  postPurchaseOffset: 0,
  postPurchaseHasMore: false,
  postPurchaseStats: null,
  postPurchaseMonth: '',
  postPurchaseDatePreset: 'this_month',
  postPurchaseDateFrom: '',
  postPurchaseDateTo: '',
  postPurchaseReprint: 'all',
  syncRunning:      false,
  syncIntervalId:   null,
};

function stockDbAdapter() {
  return {
    ST_ITEMS,
    ST_MOVES,
    idbAll,
    idbPut,
    idbDelete,
  };
}

function stockApiAdapter() {
  return {
    adminJsonHeaders,
    fetchImpl: fetch,
  };
}

// ── Settings IDB persistence ───────────────────────────────
// ── Load all data ──────────────────────────────────────────
async function loadAll() {
  S.items     = await StockStore.getAllItems(stockDbAdapter());
  S.movements = (await StockStore.getAllMovements(stockDbAdapter())).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  S.coRecords = (await idbAll(ST_CORECS))
    .map(record => record && typeof record === 'object'
      ? {
          ...record,
          updatedAt: record.updatedAt || record.updated_at || record.createdAt || record.timestamp || null,
        }
      : record)
    .filter(record => record && !record.deletedAt)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  await loadSettingsFromIDB();

  const ts = new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
  elSet('stock-last-update', ts);
  elSet('co-last-update', ts);

  renderStockOverview();
  renderAlerts();
  renderItemsMgmt();
  renderCoDashboard();
  renderCoHistory();
}

// ══════════════════════════════════════════════════════════
//  STOCK — COMPUTATION
// ══════════════════════════════════════════════════════════

/** Get movements for one article, sorted asc */
function getMovements(articleNumber) {
  return StockFeature.getMovements(articleNumber);
}

/**
 * Compute current on-hand and weekly consumption for an item.
 * Logic:
 *   - stocktake sets an absolute level; movements before first stocktake are ignored
 *   - receipt adds, issue subtracts from running total
 *   - weeklyConsumption = sum of issues in last N weeks / N
 */
function computeStock(item) {
  return StockFeature.computeStock(item);
}

// ══════════════════════════════════════════════════════════
//  STOCK — OVERVIEW
// ══════════════════════════════════════════════════════════

function renderStockOverview() {
  return StockFeature.renderStockOverview();
}

// ── Stock Detail ───────────────────────────────────────────
let stockActions = null;

function requireStockActions() {
  if (!stockActions) throw new Error('Stock actions are not initialized');
  return stockActions;
}

function openStockDetail(articleNumber) {
  return requireStockActions().openStockDetail(articleNumber);
}

// Admin-gated verze pro Historie pohybů
async function deleteMovementAdmin(id) {
  return requireStockActions().deleteMovementAdmin(id);
}

// ── Alerts ────────────────────────────────────────────────
function renderAlerts() {
  return StockFeature.renderStockAlerts();
}

async function saveMovement() {
  return requireStockActions().saveMovement();
}

// ══════════════════════════════════════════════════════════
//  ITEMS MANAGEMENT (přidat / upravit / smazat položku)
// ══════════════════════════════════════════════════════════

function renderItemsMgmt() {
  return requireStockActions().renderItemsMgmt();
}

function openItemModal(articleNumber) {
  return requireStockActions().openItemModal(articleNumber);
}

async function saveItemModal() {
  return requireStockActions().saveItemModal();
}

async function deleteItem(articleNumber) {
  return requireStockActions().deleteItem(articleNumber);
}

// ══════════════════════════════════════════════════════════
//  COLORADO MODULE
// ══════════════════════════════════════════════════════════

const Colorado = PrintGuardColoradoController.createColoradoController({
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

const MACHINES = Colorado.MACHINES;

function loadColoradoRollStates() { return Colorado.loadColoradoRollStates(); }
function loadColoradoRollEvents() { return Colorado.loadColoradoRollEvents(); }
function renderColoradoRollTracker() { return Colorado.renderColoradoRollTracker(); }
function closeColoradoRollModal() { return Colorado.closeColoradoRollModal(); }
function closeColoradoRollSheet() { return Colorado.closeColoradoRollSheet(); }
function openColoradoRollSheet(machineId) { return Colorado.openColoradoRollSheet(machineId); }
function openColoradoRollModal(machineId) { return Colorado.openColoradoRollModal(machineId); }
async function saveColoradoRollModal() { return Colorado.saveColoradoRollModal(); }
function undoColoradoRollLoad(machineId) { return Colorado.undoColoradoRollLoad(machineId); }
function resetColoradoRollState(machineId) { return Colorado.resetColoradoRollState(machineId); }
function promptColoradoRollReset(machineId) { return Colorado.promptColoradoRollReset(machineId); }
function getCoRecs(machineId) { return Colorado.getCoRecs(machineId); }
function computeCoIntervals(machineId) { return Colorado.computeCoIntervals(machineId); }
function computeCoStats(machineId) { return Colorado.computeCoStats(machineId); }
function getCombinedCoLifetimeInkBasis() { return Colorado.getCombinedCoLifetimeInkBasis(); }
function getColoradoFormatEstimates() { return Colorado.getColoradoFormatEstimates(); }
function renderCoDashboard() { return Colorado.renderCoDashboard(); }
function setupCoEntry() { return Colorado.setupCoEntry(); }
function bindColoradoHistoryControls(options) { return Colorado.bindColoradoHistoryControls(options); }
function getSelectedMachine() { return Colorado.getSelectedMachine(); }
function updateCoPreview() { return Colorado.updateCoPreview(); }
function renderCoHistory() { return Colorado.renderCoHistory(); }
async function deleteCoRecord(id) { return Colorado.deleteCoRecord(id); }

//  SETTINGS + EXPORT / IMPORT
// ══════════════════════════════════════════════════════════


// ── CSV helpers ──────────────────────────────────────────

async function loadPostPurchaseOrders(force = false) {
  return PostPurchaseUI.loadPostPurchaseOrders(force);
}

function renderPostPurchaseOrders() {
  return PostPurchaseUI.renderPostPurchaseOrders();
}

async function syncPostPurchaseOrdersManual() {
  return PostPurchaseUI.syncPostPurchaseOrdersManual();
}

const printLogApi = PrintGuardPrintLog.createPrintLog({
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
  printLogRangeLabelUI,
  printResultClassUI,
  printResultLabelUI,
  getPrintLogTodayQueueBasisLabelUI,
  renderPrintLogComparisonUI,
  renderPrintLogSummaryUI,
  renderPrintLogTodayQueueUI,
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

const dateFilters = PrintGuardDateFilters.createDateFilters({
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

let stockLogApi = null;

function requireStockLog() {
  if (!stockLogApi) throw new Error('Stock log is not initialized');
  return stockLogApi;
}

// ══════════════════════════════════════════════════════════
//  STOCK — LOG (všechny pohyby, reportová obrazovka)
// ══════════════════════════════════════════════════════════

function renderStockLog() {
  return requireStockLog().renderStockLog();
}

function exportCSVStockLog() {
  return requireStockLog().exportCSVStockLog();
}

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

stockActions = StockActions.createStockActions({
  S,
  StockFeature,
  StockStore,
  StockUI,
  Reports,
  adminErrorMessage,
  cfg,
  cloudDelete,
  el,
  esc,
  fmtDT,
  fmtDays,
  fmtN,
  genId,
  i18n,
  isAdmin,
  movementLabel,
  navigate: (...args) => navigationApi.navigate(...args),
  renderAlerts,
  renderStockLog,
  renderStockOverview,
  runNotificationDispatch,
  setSyncDirtyReason,
  showConfirm,
  showToast,
  statusLabel,
  stockApiAdapter,
  stockDbAdapter,
});
stockLogApi = StockLogModule.createStockLog({
  Reports,
  S,
  StockStore,
  deleteMovementAdmin,
  dlBlob,
  el,
  esc,
  fmtDT,
  fmtExportDateTime,
  fmtFileDT,
  fmtN,
  i18n,
  movementLabel,
  openStockDetail,
});

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

// ══════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════

// Canonical movement deletion. This preserves the previously effective hoisted implementation.
async function deleteMovement(id) {
  return requireStockActions().deleteMovement(id);
}

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

  // Mode toggle
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  // Bottom navs
  document.querySelectorAll('#stock-nav .nav-item, #colorado-nav .nav-item').forEach(b =>
    b.addEventListener('click', () => navigate(b.dataset.screen)));

  window.addEventListener('popstate', () => {
    navigate(getInitialScreen(), { replace: true });
  });

  // Back buttons
  document.querySelectorAll('.back-btn').forEach(b =>
    b.addEventListener('click', () => navigate(b.dataset.screen || 'stock-overview')));

  // FABs
  el('fab-co-entry').addEventListener('click',  () => navigate('co-entry'));

  // Topbar
  el('nav-settings').addEventListener('click', () => navigate('settings'));
  el('roll-modal-save')?.addEventListener('click', () => saveColoradoRollModal());
  document.querySelectorAll('[data-roll-cancel]').forEach(button =>
    button.addEventListener('click', closeColoradoRollModal));
  el('roll-modal')?.addEventListener('click', event => {
    if (event.target === el('roll-modal')) closeColoradoRollModal();
  });
  el('roll-mobile-toggle')?.addEventListener('click', () => openColoradoRollSheet());
  document.querySelectorAll('[data-roll-sheet-cancel]').forEach(button =>
    button.addEventListener('click', closeColoradoRollSheet));
  el('roll-sheet')?.addEventListener('click', event => {
    if (event.target === el('roll-sheet')) closeColoradoRollSheet();
  });
  window.addEventListener('storage', event => {
    if (event.key !== 'pg_colorado_roll_state_v1') return;
    S.coloradoRolls = loadColoradoRollStates();
    S.coloradoRollEvents = loadColoradoRollEvents();
    renderColoradoRollTracker();
  });

// ✅ SYNC (cloud push + pull + overwrite local)
// ✅ SYNC (cloud push + pull + overwrite local) — HARDENED
el('sync-btn').addEventListener('click', async () => {
  await runSync();
});

  StockFeature.initStockFeature({
    S,
    Reports,
    cfg,
    computeStock,
    deleteMovement,
    el,
    elSet,
    esc,
    exportCSVStockLog,
    fmtDT,
    fmtDays,
    fmtN,
    i18n,
    movementLabel,
    navigate,
    openStockDetail,
    openItemModal,
    renderStockLog,
    renderStockOverview,
    saveItemModal,
    saveMovement,
    statusLabel,
  });

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
  setupSettingsUI({
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
  PostPurchaseUI.initPostPurchaseUI({
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
  PostPurchaseUI.bindPostPurchaseControls();

  const langSelect = el('lang-select');
  if (langSelect) {
    langSelect.value = (window.I18N && window.I18N.currentLang) || (window.I18N && window.I18N.defaultLang) || 'cs';
    langSelect.addEventListener('change', e => {
      if (window.I18N && typeof window.I18N.setLang === 'function') {
        window.I18N.setLang(e.target.value);
      }
    });
  }

  bindPrintLogControls({
    exportCSVPrintLog,
  });

  // Preset buttons (společné pro obě obrazovky)
  document.querySelectorAll('.dr-preset').forEach(btn =>
    btn.addEventListener('click', () => applyPreset(btn.dataset.range, btn.dataset.target)));

  setupAdminAuthHandlers();

  window.addEventListener('online',  updateOfflineBanner);
  window.addEventListener('offline', updateOfflineBanner);
  updateOfflineBanner();

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
