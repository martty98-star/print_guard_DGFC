/* ============================================================
   PrintGuard — app.js
   Správa skladu (příjem/výdej/inventura) + Colorado audit
   Vanilla JS · IndexedDB · Offline PWA
   ============================================================ */
'use strict';

const PrintGuardAppConfig = typeof window !== 'undefined' && window.PrintGuardAppConfig;
if (!PrintGuardAppConfig) throw new Error('Missing PrintGuardAppConfig');
const { APP_VERSION, cfg, ls } = PrintGuardAppConfig;

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

const PrintGuardPushBridge = typeof window !== 'undefined' && window.PrintGuardPushBridge;
if (!PrintGuardPushBridge) throw new Error('Missing PrintGuardPushBridge');
const { getPushEndpointSuffix } = PrintGuardPushBridge;

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
const PrintLogUI = (typeof window !== 'undefined' && window.PrintGuardPrintLogUI) || null;
if (!PrintLogUI) throw new Error('Missing PrintGuardPrintLogUI');
const ChecklistUI = (typeof window !== 'undefined' && window.PrintGuardChecklistUI) || null;
if (!ChecklistUI) throw new Error('Missing PrintGuardChecklistUI');
const PostPurchaseUI = (typeof window !== 'undefined' && window.PrintGuardPostPurchaseUI) || null;
if (!PostPurchaseUI) throw new Error('Missing PrintGuardPostPurchaseUI');
const {
  ds,
  esc,
  fmtDays,
  fmtDT,
  fmtDuration,
  fmtDurationSeconds,
  fmtInt,
  fmtMeasure,
  fmtN,
  genId,
  getNullableNumber,
  toISOfromDT,
  toLocalDT,
} = CoreUtils;
const {
  el,
  elSet,
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
  csvEsc,
  csvRow,
  dlBlob,
  fmtExportDateTime,
  fmtFileDT,
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

function appFetch(url, options) {
  if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
    return window.fetch(url, options);
  }
  return fetch(url, options);
}

function getCostUnitPerMonth() {
  return `${cfg.costCurrency} / ${i18n('unit.month-word')}`;
}

function loadSettingsUI() {
  return loadSettingsUIScreen({ APP_VERSION, cfg, el });
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
  elSet('postpurchase-status', 'Operator PIN required');
  const wrap = el('postpurchase-orders-wrap');
  if (wrap) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>Processed Orders PIN is required.</p><div class="table-empty-note">Enter the operator PIN above and unlock the orders table.</div></div>`;
  }
}

function requirePostPurchasePinForScreen() {
  if (cfg.postPurchasePin || cfg.adminPin) return true;
  renderPostPurchaseAccessRequired();
  showToast('Processed Orders PIN is required.', 'error');
  return false;
}

function showPendingUpdateToast() {
  if (sessionStorage.getItem('pg_sw_updated') === '1') {
    sessionStorage.removeItem('pg_sw_updated');
    const message = `Nová verze aplikace byla načtena (${APP_VERSION})`;
    showToast(message, 'success');
    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification('PrintGuard update', {
          body: message,
          icon: '/icons/icon-192.png',
        });
      } catch (_) {}
    }
  }
}

function setupAppUpdateChecks() {
  if (!('serviceWorker' in navigator)) {
    return;
  }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    sessionStorage.setItem('pg_sw_updated', '1');
    window.location.reload();
  });

  const requestUpdate = () => {
    navigator.serviceWorker.getRegistration().then((registration) => {
      if (registration) {
        registration.update().catch(() => {});
      }
    }).catch(() => {});
  };

  window.addEventListener('focus', requestUpdate);
  window.addEventListener('online', requestUpdate);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      requestUpdate();
    }
  });

  requestUpdate();
}

function printLogRangeLabel() {
  return printLogRangeLabelUI(S, i18n);
}

function printResultClass(result) {
  return printResultClassUI(result);
}

function printResultLabel(result) {
  return printResultLabelUI(result, i18n);
}

function getPrintLogTodayQueueBasisLabel(basis) {
  return getPrintLogTodayQueueBasisLabelUI(basis);
}

function renderPrintLogSummary() {
  return renderPrintLogSummaryUI({
    S,
    elSet,
    fmtDuration,
    fmtInt,
    fmtMeasure,
    fmtN,
    formatPrintLogInkBreakdown,
    getPrintLogInkChannels,
    getPrintLogLifecycleMetrics,
    getPrintLogSummaryInk,
    hasPrintLogInkBreakdown,
    printLogRangeLabel,
  });
}

function renderPrintLogComparison() {
  return renderPrintLogComparisonUI({
    S,
    el,
    esc,
    fmtInt,
    fmtMeasure,
    formatPrintLogInkBreakdown,
    getNullableNumber,
    getPrintLogInkChannels,
    getPrintLogMachineId,
    getPrintLogPeriodInkRatio,
    i18n,
    mapPrinterName,
  });
}

function renderPrintLogTodayQueue() {
  return renderPrintLogTodayQueueUI({
    S,
    ds,
    el,
    esc,
    fmtInt,
    getPrintLogTodayQueueBasisLabel,
    mapPrinterName,
  });
}

function renderChecklistScreen(force = false) {
  return ChecklistUI.renderChecklistScreen(force);
}

function statusLabel(status) {
  const map = {
    ok: i18n('status.ok'),
    warn: i18n('status.warn'),
    crit: i18n('status.crit'),
  };
  return map[status] || status;
}

function movementLabel(type) {
  const map = {
    receipt: i18n('mov.receipt'),
    issue: i18n('mov.issue'),
    stocktake: i18n('mov.stocktake'),
  };
  return map[type] || type;
}

// ── App state ──────────────────────────────────────────────
const S = {
  items:       [],     // catalog
  movements:   [],     // sorted by timestamp asc
  coRecords:   [],     // sorted by timestamp asc
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
  postPurchaseMonth: '',
  postPurchaseDatePreset: 'this_month',
  postPurchaseDateFrom: '',
  postPurchaseDateTo: '',
  postPurchaseReprint: 'all',
  syncRunning:      false,
  syncIntervalId:   null,
};

const SYNC_MIN_INTERVAL_MS = 30 * 60 * 1000;
const SYNC_ONLINE_RETRY_DELAY_MS = 15 * 1000;

function getLastCloudSyncMs() {
  const value = Number(ls('pg_last_cloud_sync_ms') || 0);
  return Number.isFinite(value) ? value : 0;
}

function markCloudSyncComplete() {
  ls('pg_last_cloud_sync_ms', String(Date.now()));
}

function shouldRunBackgroundSync() {
  return (
    navigator.onLine &&
    document.visibilityState === 'visible' &&
    Date.now() - getLastCloudSyncMs() >= SYNC_MIN_INTERVAL_MS
  );
}

// ── Settings IDB persistence ───────────────────────────────
async function saveSettingsToIDB() {
  await idbPut(ST_SETTINGS, {
    key:        'config',
    weeksN:     cfg.weeksN,
    rollingN:   cfg.rollingN,
    inkCost:    cfg.inkCost,
    mediaCost:  cfg.mediaCost,
    costCurrency: cfg.costCurrency,
    savedAt:    new Date().toISOString(),
  });
}

async function loadSettingsFromIDB() {
  const all = await idbAll(ST_SETTINGS);
  const rec = all.find(r => r.key === 'config');
  if (!rec) return;
  if (rec.weeksN   != null) cfg.weeksN   = rec.weeksN;
  if (rec.rollingN != null) cfg.rollingN = rec.rollingN;
  if (rec.inkCost  != null) cfg.inkCost  = rec.inkCost;
  if (rec.mediaCost!= null) cfg.mediaCost= rec.mediaCost;
  if (rec.costCurrency != null) cfg.costCurrency = rec.costCurrency;
}

// ── Load all data ──────────────────────────────────────────
async function loadAll() {
  S.items     = await idbAll(ST_ITEMS);
  S.movements = (await idbAll(ST_MOVES)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  S.coRecords = (await idbAll(ST_CORECS)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
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
  return S.movements.filter(m => m.articleNumber === articleNumber);
}

/**
 * Compute current on-hand and weekly consumption for an item.
 * Logic:
 *   - stocktake sets an absolute level; movements before first stocktake are ignored
 *   - receipt adds, issue subtracts from running total
 *   - weeklyConsumption = sum of issues in last N weeks / N
 */
function computeStock(item) {
  return Reports.stock.buildStockSummary(item, S.movements, { weeksN: cfg.weeksN }, new Date());
}

// ══════════════════════════════════════════════════════════
//  STOCK — OVERVIEW
// ══════════════════════════════════════════════════════════

function renderStockOverview() {
  const q   = S.stockSearch.toLowerCase();
  const all = S.items.filter(it => it.isActive !== false);

  let ok = 0, warn = 0, crit = 0;
  all.forEach(it => {
    const s = computeStock(it).status;
    if (s === 'ok') ok++; else if (s === 'warn') warn++; else crit++;
  });
  elSet('count-ok',   ok);
  elSet('count-warn', warn);
  elSet('count-crit', crit);

  const alertCount = warn + crit;
  const alertsLabel = i18n('nav.alerts');
  el('alerts-nav-label').textContent = alertCount > 0 ? `${alertsLabel} (${alertCount})` : alertsLabel;

  const filtered = all.filter(it => {
    const m = computeStock(it);
    const matchStatus = S.stockFilter === 'all' || m.status === S.stockFilter;
    const matchSearch = !q
      || (it.name          || '').toLowerCase().includes(q)
      || (it.articleNumber || '').toLowerCase().includes(q)
      || (it.category      || '').toLowerCase().includes(q);
    return matchStatus && matchSearch;
  });

  const list = el('stock-list');
  const lblOnHand = i18n('stock.metric.onhand');
  const lblCoverage = i18n('stock.metric.coverage');
  const lblWeekly = i18n('stock.metric.weekly');
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">📦</div>
      <p>${all.length ? 'Žádné položky neodpovídají filtru.' : 'Žádné položky.\nPřidejte je v záložce Položky nebo importujte JSON.'}</p>
    </div>`;
    return;
  }

  list.innerHTML = filtered.map(it => {
    const m = computeStock(it);
    const dClass = m.status === 'crit' ? 'crit-c' : m.status === 'warn' ? 'warn-c' : '';
    const statusLbl = statusLabel(m.status);
    return `<div class="item-card ${m.status}" data-article="${esc(it.articleNumber)}" role="button" tabindex="0">
      <div class="item-card-top">
        <div>
          <div class="item-card-name">${esc(it.name || it.articleNumber)}</div>
          <div class="item-card-code">${esc(it.articleNumber)}${it.category ? ' · ' + esc(it.category) : ''}</div>
        </div>
        <span class="badge ${m.status}">${statusLbl}</span>
      </div>
      <div class="item-card-metrics">
        <div class="metric-mini">
          <span class="metric-mini-val">${fmtN(m.onHand, 0)} <small>${esc(it.unit || 'ks')}</small></span>
          <span class="metric-mini-lbl">${lblOnHand}</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val ${dClass}">${fmtDays(m.daysLeft)}</span>
          <span class="metric-mini-lbl">${lblCoverage}</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val">${m.avgWeekly > 0 ? fmtN(m.avgWeekly, 1) : '—'}</span>
          <span class="metric-mini-lbl">${lblWeekly}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('.item-card').forEach(c => {
    c.addEventListener('click',   () => openStockDetail(c.dataset.article));
    c.addEventListener('keydown', e => { if (e.key === 'Enter') openStockDetail(c.dataset.article); });
  });
}

// ── Stock Detail ───────────────────────────────────────────
function openStockDetail(articleNumber) {
  const item = S.items.find(it => it.articleNumber === articleNumber);
  if (!item) return;
  S.detailArticle = articleNumber;
  el('detail-title').textContent = item.name || articleNumber;

  const m     = computeStock(item);
  const moves = getMovements(articleNumber);
  const statusLbl = statusLabel(m.status);
  const lblCoverage = i18n('stock.metric.coverage');
  const lblWeekly = i18n('stock.metric.weekly');

  el('detail-content').innerHTML = `
    <div class="detail-hero">
      <span class="badge ${m.status}" style="display:inline-block;margin-bottom:12px">${statusLbl}</span>
      <div>
        <span class="detail-big">${fmtN(m.onHand, 0)}</span>
        <span class="detail-unit">${esc(item.unit || 'ks')}</span>
      </div>
      <div class="detail-metrics-grid">
        <div class="dm-item"><span class="dm-val">${fmtDays(m.daysLeft)}</span><span class="dm-lbl">${lblCoverage}</span></div>
        <div class="dm-item"><span class="dm-val">${m.avgWeekly > 0 ? fmtN(m.avgWeekly, 1) : '—'}</span><span class="dm-lbl">${lblWeekly}</span></div>
        <div class="dm-item"><span class="dm-val">${item.leadTimeDays || '—'}</span><span class="dm-lbl">Dod. lhůta (dny)</span></div>
      </div>
    </div>

    <div class="detail-section">
      <div class="detail-section-title">Parametry položky</div>
      <div class="param-row"><span>Číslo artiklu</span><code>${esc(articleNumber)}</code></div>
      ${item.category    ? `<div class="param-row"><span>Kategorie</span><span>${esc(item.category)}</span></div>` : ''}
      ${item.supplier    ? `<div class="param-row"><span>Dodavatel</span><span>${esc(item.supplier)}</span></div>` : ''}
      ${item.MOQ         ? `<div class="param-row"><span>MOQ</span><span>${item.MOQ}</span></div>` : ''}
      ${item.leadTimeDays? `<div class="param-row"><span>Dodací lhůta</span><span>${item.leadTimeDays} dní</span></div>` : ''}
      ${item.safetyDays  ? `<div class="param-row"><span>Bezp. zásoba</span><span>${item.safetyDays} dní</span></div>` : ''}
      ${item.minQty      ? `<div class="param-row"><span>Min. množství</span><span>${item.minQty} ${esc(item.unit || 'ks')}</span></div>` : ''}
      ${item.orderUrl    ? `<div class="param-row admin-only"><span>Odkaz na objednávku</span><a href="${esc(item.orderUrl)}" target="_blank" rel="noopener" class="order-link">🛒 Objednat</a></div>` : ''}
    </div>

    <div class="detail-section">
      <div class="detail-section-head">
        <div class="detail-tabs">
          <button class="detail-tab active" data-tab="movements">Pohyby</button>
          <button class="detail-tab" data-tab="history">Stav skladu</button>
        </div>
        <button class="btn-sm" id="detail-add-mov-btn">+ Nový pohyb</button>
      </div>
        <div class="detail-tab-pane table-wrap" data-pane="movements" style="margin-top:10px">
        ${moves.length ? `<table class="data-table">
          <thead><tr><th>${i18n('table.date')}</th><th>${i18n('table.type')}</th><th>${i18n('table.qty')}</th><th>${i18n('table.after')}</th><th>${i18n('table.note')}</th><th></th></tr></thead>
          <tbody>${buildMovementRows(item, moves)}</tbody>
        </table>` : '<div class="empty-state" style="padding:18px 0"><p>Žádné pohyby. Přidejte příjem nebo inventuru.</p></div>'}
      </div>
      <div class="detail-tab-pane table-wrap hidden" data-pane="history" style="margin-top:10px">
        ${buildStockHistoryTable(item, moves)}
      </div>
    </div>`;

  el('detail-add-mov-btn')?.addEventListener('click', () => {
    S.movItem = item;
    prefillMovItem(item);
    navigate('stock-movement');
  });

  // Detail tabs (Pohyby / Stav skladu) — querySelector uvnitř detail-content, ne getElementById
  const dc = el('detail-content');
  dc.querySelectorAll('.detail-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      dc.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const which = tab.dataset.tab;
      dc.querySelector('.detail-tab-pane[data-pane="movements"]')?.classList.toggle('hidden', which !== 'movements');
      dc.querySelector('.detail-tab-pane[data-pane="history"]')?.classList.toggle('hidden', which !== 'history');
    });
  });

  el('detail-content').querySelectorAll('.btn-del').forEach(btn => {
    btn.addEventListener('click', () => deleteMovement(btn.dataset.id));
  });

  navigate('stock-detail');
}

function buildMovementRows(item, moves) {
  // replay to show running stock after each move
  let running = 0;
  const rows = [];
  for (const m of moves) {
    if (m.movType === 'stocktake') running = m.qty;
    else if (m.movType === 'receipt') running += m.qty;
    else if (m.movType === 'issue')   running = Math.max(0, running - m.qty);
    rows.push({ m, after: running });
  }
  return [...rows].reverse().slice(0, 50).map(({ m, after }) => {
    const typeLabel = ({
      receipt: `↑ ${movementLabel('receipt')}`,
      issue: `↓ ${movementLabel('issue')}`,
      stocktake: `= ${movementLabel('stocktake')}`,
    })[m.movType] || movementLabel(m.movType);
    const typeClass = { receipt: 'receipt-c', issue: 'issue-c', stocktake: 'stocktake-c' }[m.movType] || '';
    const qtySign   = m.movType === 'issue' ? `−${fmtN(m.qty, 0)}` : m.movType === 'receipt' ? `+${fmtN(m.qty, 0)}` : `=${fmtN(m.qty, 0)}`;
    return `<tr>
      <td>${fmtDT(m.timestamp)}</td>
      <td class="${typeClass}">${typeLabel}</td>
      <td class="num ${typeClass}">${qtySign} ${esc(item.unit || 'ks')}</td>
      <td class="num">${fmtN(after, 0)} ${esc(item.unit || 'ks')}</td>
      <td class="note-td">${esc(m.note || '—')}</td>
      <td><button class="btn-del" data-id="${esc(m.id)}" title="Smazat">✕</button></td>
    </tr>`;
  }).join('');
}

/**
 * Build a "stock level over time" table (derived from movement ledger).
 * Shows running on-hand after every movement, most recent first.
 */
function buildStockHistoryTable(item, moves) {
  if (!moves.length) {
    return '<div class="empty-state" style="padding:18px 0"><p>Žádné pohyby — history není k dispozici.</p></div>';
  }
  // replay from beginning
  let running = 0;
  const rows = [];
  for (const m of moves) {
    let delta;
    if (m.movType === 'stocktake') { delta = m.qty - running; running = m.qty; }
    else if (m.movType === 'receipt') { delta = m.qty; running += m.qty; }
    else if (m.movType === 'issue') { delta = -m.qty; running = Math.max(0, running - m.qty); }
    else { delta = 0; }
    rows.push({ m, after: running, delta });
  }
  const typeLabel = {
    receipt: `↑ ${movementLabel('receipt')}`,
    issue: `↓ ${movementLabel('issue')}`,
    stocktake: `= ${movementLabel('stocktake')}`,
  };
  const typeClass = { receipt: 'receipt-c', issue: 'issue-c', stocktake: 'stocktake-c' };
  const html = [...rows].reverse().slice(0, 100).map(({ m, after, delta }) => {
    const sign = delta > 0 ? `+${fmtN(delta,0)}` : delta < 0 ? `${fmtN(delta,0)}` : `=${fmtN(m.qty,0)}`;
    const dClass = delta > 0 ? 'receipt-c' : delta < 0 ? 'issue-c' : 'stocktake-c';
    return `<tr>
      <td>${fmtDT(m.timestamp)}</td>
      <td class="${typeClass[m.movType]||''}">${typeLabel[m.movType]||m.movType}</td>
      <td class="num ${dClass}">${sign} ${esc(item.unit||'ks')}</td>
      <td class="num"><strong>${fmtN(after,0)}</strong> ${esc(item.unit||'ks')}</td>
      <td class="note-td">${esc(m.note||'—')}</td>
    </tr>`;
  }).join('');
  return `<table class="data-table">
    <thead><tr><th>${i18n('table.date')}</th><th>${i18n('table.type')}</th><th>${i18n('table.change')}</th><th>${i18n('table.after')}</th><th>${i18n('table.note')}</th></tr></thead>
    <tbody>${html}</tbody>
  </table>`;
}

async function deleteMovement(id) {
  showConfirm('Smazat tento pohyb skladu?', async () => {
    await idbDelete(ST_MOVES, id);
    S.movements = S.movements.filter(m => m.id !== id);
    renderStockOverview();
    renderAlerts();
    if (S.detailArticle) openStockDetail(S.detailArticle);
    showToast('Pohyb smazán');
  });
}

// Admin-gated verze pro Historie pohybů
async function deleteMovementAdmin(id) {
  if (!isAdmin()) { showToast('Mazání pohybů — jen admin', 'error'); return; }
  showConfirm('Smazat tento pohyb skladu? (Admin)', async () => {
    try {
      const res = await fetch('/.netlify/functions/delete-stock-movement', {
        method: 'DELETE',
        headers: adminJsonHeaders(),
        cache: 'no-store',
        body: JSON.stringify({ id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud delete failed');
      await idbDelete(ST_MOVES, id);
      S.movements = S.movements.filter(m => m.id !== id);
      renderStockOverview();
      renderAlerts();
      renderStockLog();
      if (S.detailArticle) openStockDetail(S.detailArticle);
      showToast('Pohyb smazán');
    } catch (err) {
      showToast(`Mazání selhalo: ${adminErrorMessage(err)}`, 'error');
    }
  });
}

// ── Alerts ────────────────────────────────────────────────
function renderAlerts() {
  const alertItems = S.items
    .filter(it => it.isActive !== false && computeStock(it).status !== 'ok')
    .sort((a, b) => computeStock(a).daysLeft - computeStock(b).daysLeft);

  const list = el('alerts-list');
  const lblOnHand = i18n('stock.metric.onhand');
  const lblCoverage = i18n('stock.metric.coverage');
  if (!alertItems.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✓</div><p>${i18n('msg.no-alerts')}</p></div>`;
    return;
  }
  list.innerHTML = alertItems.map(it => {
    const m = computeStock(it);
    const lbl = statusLabel(m.status);
    return `<div class="item-card ${m.status}" data-article="${esc(it.articleNumber)}" role="button" tabindex="0">
      <div class="item-card-top">
        <div>
          <div class="item-card-name">${esc(it.name || it.articleNumber)}</div>
          <div class="item-card-code">${esc(it.articleNumber)}</div>
        </div>
        <span class="badge ${m.status}">${lbl}</span>
      </div>
      <div class="item-card-metrics">
        <div class="metric-mini">
          <span class="metric-mini-val">${fmtN(m.onHand, 0)} <small>${esc(it.unit || 'ks')}</small></span>
          <span class="metric-mini-lbl">${lblOnHand}</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val ${m.status === 'crit' ? 'crit-c' : 'warn-c'}">${fmtDays(m.daysLeft)}</span>
          <span class="metric-mini-lbl">${lblCoverage}</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val">${it.leadTimeDays || '—'}</span>
          <span class="metric-mini-lbl">Dod. lhůta</span>
        </div>
      </div>
    </div>`;
  }).join('');
  list.querySelectorAll('.item-card').forEach(c => {
    c.addEventListener('click', () => openStockDetail(c.dataset.article));
  });
}

// ══════════════════════════════════════════════════════════
//  STOCK — MOVEMENT ENTRY (příjem / výdej / inventura)
// ══════════════════════════════════════════════════════════

function setupMovementEntry() {
  // Type buttons
  document.querySelectorAll('.mov-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mov-type-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      S.movType = btn.dataset.type;
      updateMovQtyLabel();
      updateMovPreview();
    });
  });

  // Item search
  const searchEl  = el('mov-item-search');
  const resultsEl = el('mov-item-results');

  searchEl.addEventListener('input', () => {
    const q = searchEl.value.toLowerCase();
    if (!q) { resultsEl.classList.add('hidden'); return; }
    const matches = S.items
      .filter(it => it.isActive !== false)
      .filter(it =>
        (it.articleNumber || '').toLowerCase().includes(q) ||
        (it.name          || '').toLowerCase().includes(q) ||
        (it.category      || '').toLowerCase().includes(q)
      ).slice(0, 8);

    if (!matches.length) {
      resultsEl.innerHTML = '<div class="dropdown-item"><span class="di-name">Nic nenalezeno</span></div>';
    } else {
      const lblOnHand = i18n('stock.metric.onhand');
      resultsEl.innerHTML = matches.map(it => {
        const m = computeStock(it);
        return `<div class="dropdown-item" data-a="${esc(it.articleNumber)}">
          <span class="di-name">${esc(it.name || it.articleNumber)}</span>
          <span class="di-code">${esc(it.articleNumber)} · ${esc(it.unit || 'ks')}</span>
          <span class="di-stock">${lblOnHand}: ${fmtN(m.onHand, 0)} ${esc(it.unit || 'ks')}</span>
        </div>`;
      }).join('');
    }
    resultsEl.classList.remove('hidden');
    resultsEl.querySelectorAll('[data-a]').forEach(d => {
      d.addEventListener('click', () => {
        const item = S.items.find(it => it.articleNumber === d.dataset.a);
        if (item) selectMovItem(item);
      });
    });
  });

  document.addEventListener('click', e => {
    if (!resultsEl.contains(e.target) && e.target !== searchEl)
      resultsEl.classList.add('hidden');
  });

  el('mov-minus').addEventListener('click', () => {
    const v = parseFloat(el('mov-qty').value || '0');
    if (v > 0) { el('mov-qty').value = Math.max(0, v - 1); updateMovPreview(); }
  });
  el('mov-plus').addEventListener('click', () => {
    el('mov-qty').value = parseFloat(el('mov-qty').value || '0') + 1;
    updateMovPreview();
  });
  el('mov-qty').addEventListener('input', updateMovPreview);
  el('mov-save-btn').addEventListener('click', saveMovement);
}

function prefillMovItem(item) {
  const chip = el('mov-item-selected');
  chip.classList.remove('hidden');
  chip.innerHTML = `
    <div>
      <div class="sc-name">${esc(item.name || item.articleNumber)}</div>
      <div class="sc-code">${esc(item.articleNumber)}</div>
    </div>
    <button class="sc-clear" id="mov-sc-clear">✕</button>`;
  el('mov-sc-clear').addEventListener('click', clearMovItem);
  el('mov-item-search').value = '';
  el('mov-unit-hint').textContent = 'Jednotka: ' + (item.unit || 'ks');
  el('mov-save-btn').disabled = false;
  updateMovQtyLabel();
  updateMovPreview();
}

function selectMovItem(item) {
  S.movItem = item;
  el('mov-item-results').classList.add('hidden');
  prefillMovItem(item);
}

function clearMovItem() {
  S.movItem = null;
  el('mov-item-selected').classList.add('hidden');
  el('mov-preview').classList.add('hidden');
  el('mov-save-btn').disabled = true;
  el('mov-unit-hint').textContent = '';
}

function updateMovQtyLabel() {
  const labels = { receipt: 'Přijímaný počet kusů *', issue: 'Vydávaný počet kusů *', stocktake: 'Aktuální stav na skladě (nová hodnota) *' };
  el('mov-qty-label').textContent = labels[S.movType] || 'Množství *';
}

function updateMovPreview() {
  if (!S.movItem) return;
  const qty = parseFloat(el('mov-qty').value) || 0;
  const cur = computeStock(S.movItem).onHand;
  let after;
  if (S.movType === 'receipt')   after = cur + qty;
  else if (S.movType === 'issue') after = Math.max(0, cur - qty);
  else                             after = qty; // stocktake

  const unit = S.movItem.unit || 'ks';

  // simulate
  const fakeMove = { articleNumber: S.movItem.articleNumber, movType: S.movType, qty, timestamp: new Date().toISOString(), id: '__tmp__' };
  const fakeMoves = [...S.movements, fakeMove];
  const origMoves = S.movements;
  S.movements = fakeMoves;
  const nm = computeStock(S.movItem);
  S.movements = origMoves;

  el('mov-prev-current').textContent = `${fmtN(cur, 0)} ${unit}`;
  el('mov-prev-after').textContent   = `${fmtN(after, 0)} ${unit}`;
  const statusLbl = ({
    ok: `${statusLabel('ok')} ✓`,
    warn: `⚠ ${statusLabel('warn')}`,
    crit: `🔴 ${statusLabel('crit')}`,
  })[nm.status] || statusLabel(nm.status);
  const statusEl  = el('mov-prev-status');
  statusEl.textContent = statusLbl;
  statusEl.style.color = { ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)' }[nm.status];
  el('mov-preview').classList.remove('hidden');
}

async function saveMovement() {
  if (!S.movItem) { showToast('Vyberte položku', 'error'); return; }
  const qty = parseFloat(el('mov-qty').value);
  if (isNaN(qty) || qty < 0) { showToast('Zadejte platné množství', 'error'); return; }

  const move = {
    id:            genId('mov'),
    articleNumber: S.movItem.articleNumber,
    movType:       S.movType,
    qty,
    note:          el('mov-note').value.trim() || undefined,
    timestamp:     new Date().toISOString(),
    deviceId:      cfg.deviceId,
  };

  el('mov-save-btn').disabled = true;
  try {
    const notifyItem = S.movItem;
    await idbPut(ST_MOVES, move);
    S.movements.push(move);
    S.movements.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const typeLabel = movementLabel(S.movType);
    showToast(`${typeLabel} — ${i18n('msg.save-success')}`, 'success');
    el('mov-qty').value  = '';
    el('mov-note').value = '';
    clearMovItem();
    renderStockOverview();
    renderAlerts();
    navigate('stock-overview');
    runNotificationDispatch(
      Reports.notificationDispatch?.emitStockMovementCreated?.(move, notifyItem),
      'stock movement event'
    );
  } catch (err) {
    showToast('Chyba: ' + err.message, 'error');
  } finally {
    el('mov-save-btn').disabled = false;
  }
}

// ══════════════════════════════════════════════════════════
//  ITEMS MANAGEMENT (přidat / upravit / smazat položku)
// ══════════════════════════════════════════════════════════

function renderItemsMgmt() {
  const list = el('items-mgmt-list');
  const lblOnHand = i18n('stock.metric.onhand');
  if (!S.items.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné položky.\nKlikněte + Přidat položku nebo importujte JSON.</p></div>`;
    return;
  }
  const byCategory = {};
  S.items.forEach(it => {
    const cat = it.category || 'Ostatní';
    if (!byCategory[cat]) byCategory[cat] = [];
    byCategory[cat].push(it);
  });

  list.innerHTML = Object.entries(byCategory).sort(([a], [b]) => a.localeCompare(b)).map(([cat, items]) => `
    <div style="margin-bottom:6px">
      <div style="font-size:.6rem;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint);padding:10px 0 6px">${esc(cat)}</div>
      ${items.map(it => {
        const m = computeStock(it);
        return `<div class="mgmt-card" style="margin-bottom:5px">
          <div class="mgmt-info">
            <div class="mgmt-name">${esc(it.name || it.articleNumber)}</div>
            <div class="mgmt-meta">${esc(it.articleNumber)} · ${esc(it.unit || 'ks')} · ${lblOnHand}: ${fmtN(m.onHand, 0)}</div>
          </div>
          <div class="mgmt-actions">
            ${it.orderUrl ? `<a href="${esc(it.orderUrl)}" target="_blank" rel="noopener" class="btn-icon-sm admin-only" title="Objednat">🛒</a>` : ''}
            <button class="btn-icon-sm" data-edit="${esc(it.articleNumber)}" title="Upravit">✎</button>
            <button class="btn-icon-sm danger" data-del="${esc(it.articleNumber)}" title="Smazat">✕</button>
          </div>
        </div>`;
      }).join('')}
    </div>`).join('');

  list.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => openItemModal(b.dataset.edit)));
  list.querySelectorAll('[data-del]').forEach(b  => b.addEventListener('click', () => deleteItem(b.dataset.del)));
}

function openItemModal(articleNumber) {
  // ADMIN GUARD
  if (!isAdmin()) { showToast('Jen admin může spravovat položky', 'error'); return; }

  S.editingItem = articleNumber
    ? (S.items.find(it => it.articleNumber === articleNumber) || null)
    : null;

  el('item-modal-title').textContent = S.editingItem ? 'Upravit položku' : 'Nová položka';
  const it = S.editingItem || {};
  el('im-name').value     = it.name        || '';
  el('im-article').value  = it.articleNumber || '';
  el('im-unit').value     = it.unit        || '';
  el('im-category').value = it.category    || '';
  el('im-supplier').value = it.supplier    || '';
  el('im-moq').value      = it.MOQ         || '';
  el('im-lead').value     = it.leadTimeDays || '';
  el('im-safety').value   = it.safetyDays  || '';
  el('im-minqty').value   = it.minQty      || '';
  el('im-url').value      = it.orderUrl    || '';
  el('im-article').readOnly = !!S.editingItem;
  el('item-modal').classList.remove('hidden');
  el('im-name').focus();
}

async function saveItemModal() {
  // ADMIN GUARD
  if (!isAdmin()) { showToast('Jen admin může spravovat položky', 'error'); return; }

  const name    = el('im-name').value.trim();
  const article = el('im-article').value.trim().toUpperCase().replace(/\s+/g, '-');
  if (!name)    { showToast('Zadejte název', 'error'); return; }
  if (!article) { showToast('Zadejte číslo artiklu', 'error'); return; }
  if (!S.editingItem && S.items.find(it => it.articleNumber === article)) {
    showToast('Artikl s tímto číslem již existuje', 'error'); return;
  }

  const item = {
    articleNumber: article,
    name,
    unit:         el('im-unit').value.trim()     || 'ks',
    category:     el('im-category').value.trim() || '',
    supplier:     el('im-supplier').value.trim() || '',
    MOQ:          parseInt(el('im-moq').value)   || 1,
    leadTimeDays: parseInt(el('im-lead').value)  || 7,
    safetyDays:   parseInt(el('im-safety').value)|| 7,
    minQty:       parseFloat(el('im-minqty').value) || 0,
    orderUrl:     el('im-url').value.trim() || undefined,
    isActive: true,
  };

  await idbPut(ST_ITEMS, item);
  const idx = S.items.findIndex(it => it.articleNumber === article);
  if (idx >= 0) S.items[idx] = item; else S.items.push(item);

  el('item-modal').classList.add('hidden');
  renderItemsMgmt();
  renderStockOverview();
  showToast(S.editingItem ? 'Položka upravena' : 'Položka přidána', 'success');
}

async function deleteItem(articleNumber) {
  // ADMIN GUARD
  if (!isAdmin()) { showToast('Jen admin může spravovat položky', 'error'); return; }

  showConfirm(`Smazat položku "${articleNumber}" včetně všech pohybů?`, async () => {
    try {
      await cloudDelete('item', articleNumber);
      await idbDelete(ST_ITEMS, articleNumber);
      const toDelete = S.movements.filter(m => m.articleNumber === articleNumber);
      for (const m of toDelete) await idbDelete(ST_MOVES, m.id);
      S.items     = S.items.filter(it => it.articleNumber !== articleNumber);
      S.movements = S.movements.filter(m  => m.articleNumber !== articleNumber);
      renderItemsMgmt();
      renderStockOverview();
      renderAlerts();
      showToast('Položka smazána');
    } catch (err) {
      showToast(`Mazání selhalo: ${adminErrorMessage(err)}`, 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════
//  COLORADO MODULE
// ══════════════════════════════════════════════════════════

const MACHINES = [
  { id: 'colorado1', label: 'Colorado 1' },
  { id: 'colorado2', label: 'Colorado 2' },
];

const CO_FORMATS = [
  { key: '21x30', widthCm: 21, heightCm: 30 },
  { key: '30x40', widthCm: 30, heightCm: 40 },
  { key: '40x50', widthCm: 40, heightCm: 50 },
  { key: '50x50', widthCm: 50, heightCm: 50 },
  { key: '50x70', widthCm: 50, heightCm: 70 },
  { key: '70x100', widthCm: 70, heightCm: 100 },
];

function getLatestCoRecord(machineId) {
  const recs = getCoRecs(machineId);
  return recs.length ? recs[recs.length - 1] : null;
}

function getCombinedCoLifetimeInkBasis() {
  const intervals = MACHINES
    .flatMap(({ id }) => computeCoIntervals(id))
    .filter(iv => Number(iv.mediaUsed) > 0 && Number(iv.inkUsed) >= 0);

  if (!intervals.length) return null;

  const inkUsed = intervals.reduce((sum, iv) => sum + (Number(iv.inkUsed) || 0), 0);
  const mediaUsed = intervals.reduce((sum, iv) => sum + (Number(iv.mediaUsed) || 0), 0);
  if (!(mediaUsed > 0)) return null;

  return {
    source: 'combined_lifetime',
    intervalCount: intervals.length,
    inkUsed,
    mediaUsed,
    inkPerM2: inkUsed / mediaUsed,
  };
}

function getColoradoFormatEstimates() {
  const basis = getCombinedCoLifetimeInkBasis();
  if (!basis) return { basis: null, rows: [] };

  const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
  return {
    basis,
    rows: CO_FORMATS.map(format => {
      const areaM2 = (format.widthCm / 100) * (format.heightCm / 100);
      const inkL = areaM2 * basis.inkPerM2;
      const cost = hasCosts ? (inkL * cfg.inkCost) + (areaM2 * cfg.mediaCost) : null;
      return {
        label: format.key,
        areaM2,
        inkL,
        inkMl: inkL * 1000,
        cost,
      };
    }),
  };
}

function getCoRecs(machineId) {
  return S.coRecords.filter(r => r.machineId === machineId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function computeCoIntervals(machineId) {
  return Reports.colorado.buildColoradoIntervals(getCoRecs(machineId), {
    inkCost: cfg.inkCost,
    mediaCost: cfg.mediaCost,
  });
}

function computeCoStats(machineId) {
  return Reports.colorado.buildColoradoStats(getCoRecs(machineId), {
    rollingN: cfg.rollingN,
    inkCost: cfg.inkCost,
    mediaCost: cfg.mediaCost,
  });
}

function renderCoDashboard() {
  MACHINES.forEach(({ id, label }) => renderMachineCard(id, label));
  renderCombinedCard();
}

function renderMachineCard(machineId, label) {
  const wrap = el('card-' + machineId);
  if (!wrap) return;
  const recs = getCoRecs(machineId);
  const s    = computeCoStats(machineId);

  if (!s || recs.length < 2) {
    const lastLine = recs.length === 1
      ? `<br>${i18n('colorado.card.need-two.last')}: <strong>${fmtDT(recs[0].timestamp)}</strong> · ${i18n('colorado.card.ink-total')} <strong>${fmtN(recs[0].inkTotalLiters, 2)} L</strong> · ${i18n('colorado.card.media-total')} <strong>${fmtN(recs[0].mediaTotalM2, 1)} m²</strong>`
      : '';
    wrap.innerHTML = `<div class="mc-header">
      <span class="mc-label">${esc(label)}</span>
      <span class="mc-badge">${recs.length} ${recs.length === 1 ? i18n('colorado.card.record.one') : i18n('colorado.card.record.other')}</span>
    </div>
    <div class="mc-empty">
      ${i18n('colorado.card.need-two')}
      ${lastLine}
    </div>`;
    return;
  }

  const recordWord = s.recordCount === 1 ? i18n('colorado.card.record.one') : i18n('colorado.card.record.other');
  const intervalWord = s.intervalCount === 1 ? i18n('colorado.card.interval.one') : i18n('colorado.card.interval.other');

  wrap.innerHTML = `
    <div class="mc-header">
      <span class="mc-label">${esc(label)}</span>
      <span class="mc-badge">${s.recordCount} ${recordWord} · ${s.intervalCount} ${intervalWord}</span>
    </div>
    <div class="metrics-grid">
      <div class="metric-block">
        <span class="metric-big">${fmtN(s.avgMediaDay, 1)}</span>
        <span class="metric-unit">${i18n('unit.m2-per-day')}</span>
        <span class="metric-desc">${i18n('colorado.card.metrics.media-day')}</span>
      </div>
      <div class="metric-block">
        <span class="metric-big">${fmtN(s.avgMediaMonth, 0)}</span>
        <span class="metric-unit">${i18n('unit.m2-per-month')}</span>
        <span class="metric-desc">${i18n('colorado.card.metrics.media-month')}</span>
      </div>
      <div class="metric-block ink-bg">
        <span class="metric-big">${fmtN(s.avgInkDay, 3)}</span>
        <span class="metric-unit">${i18n('unit.l-per-day')}</span>
        <span class="metric-desc">${i18n('colorado.card.metrics.ink-day')}</span>
      </div>
      <div class="metric-block ink-bg">
        <span class="metric-big">${fmtN(s.avgInkMonth, 2)}</span>
        <span class="metric-unit">${i18n('unit.l-per-month')}</span>
        <span class="metric-desc">${i18n('colorado.card.metrics.ink-month')}</span>
      </div>
      <div class="metric-block ink-bg">
        <span class="metric-big">${s.avgInkPM2 !== null ? fmtN(s.avgInkPM2, 4) : '—'}</span>
        <span class="metric-unit">${i18n('unit.l-per-m2')}</span>
        <span class="metric-desc">${i18n('colorado.card.metrics.ink-per-m2')}</span>
      </div>
      ${s.hasCosts && s.avgCostPM2 !== null ? `<div class="metric-block cost-bg">
        <span class="metric-big">${fmtN(s.avgCostPM2, 2)}</span>
        <span class="metric-unit">${getCostUnitPerM2()}</span>
        <span class="metric-desc">${i18n('colorado.card.metrics.cost-per-m2')}</span>
      </div>` : ''}
    </div>
    <div class="mc-last">
      ${i18n('colorado.card.last')} <strong>${fmtDT(s.last.timestamp)}</strong> ·
      ${i18n('colorado.card.ink-total')} <strong>${fmtN(s.last.inkTotalLiters, 2)} L</strong> ·
      ${i18n('colorado.card.media-total')} <strong>${fmtN(s.last.mediaTotalM2, 1)} m²</strong>
    </div>`;
}

function renderCombinedCard() {
  const wrap   = el('card-combined');
  if (!wrap) return;
  const valid  = MACHINES.map(m => computeCoStats(m.id)).filter(s => s && s.intervalCount > 0);
  if (!valid.length) {
    wrap.innerHTML = `<div class="mc-header"><span class="mc-label">${i18n('colorado.card.combined.title')}</span><button class="btn-sm" id="co-lifetime-export-btn">${i18n('colorado.export.lifetime-combined')}</button></div><div class="mc-empty">${i18n('colorado.card.no-data')}</div>`;
    el('co-lifetime-export-btn')?.addEventListener('click', exportCSVCombinedLifetimeCo);
    return;
  }
  const sum = (fn) => valid.reduce((s, v) => s + fn(v), 0);
  const inkMonth   = sum(v => v.avgInkMonth);
  const mediaMonth = sum(v => v.avgMediaMonth);
  const hasCosts   = cfg.inkCost > 0 || cfg.mediaCost > 0;
  const costMonth  = hasCosts ? inkMonth * cfg.inkCost + mediaMonth * cfg.mediaCost : null;
  const formatEstimates = getColoradoFormatEstimates();
  const formatTable = formatEstimates.rows.length ? `
    <div class="mc-last">
      ${i18n('colorado.card.formats.note')}
      <strong>${fmtN(formatEstimates.basis.inkPerM2, 4)} L / m²</strong> ·
      ${i18n('colorado.card.formats.intervals')}
      <strong>${fmtInt(formatEstimates.basis.intervalCount)}</strong>
    </div>
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>${i18n('colorado.card.formats.table.format')}</th>
            <th>${i18n('colorado.card.formats.table.area')}</th>
            <th>${i18n('colorado.card.formats.table.ink')}</th>
            ${hasCosts ? `<th>${i18n('colorado.card.formats.table.cost')}</th>` : ''}
          </tr>
        </thead>
        <tbody>
          ${formatEstimates.rows.map(row => `<tr>
            <td>${esc(row.label)}</td>
            <td class="num">${fmtMeasure(row.areaM2, 'm²', 3)}</td>
            <td class="num">${fmtN(row.inkMl, 1)} ml</td>
            ${hasCosts ? `<td class="num">${row.cost === null ? '—' : `${fmtN(row.cost, 2)} ${esc(cfg.costCurrency)}`}</td>` : ''}
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  ` : '';

  wrap.innerHTML = `
    <div class="mc-header">
      <span class="mc-label">${i18n('colorado.card.combined.title')}</span>
      <span class="mc-badge">${i18n('colorado.card.combined.badge')}</span>
      <button class="btn-sm" id="co-lifetime-export-btn">${i18n('colorado.export.lifetime-combined')}</button>
    </div>
    <div class="metrics-grid">
      <div class="metric-block">
        <span class="metric-big">${fmtN(sum(v => v.avgMediaDay), 1)}</span>
        <span class="metric-unit">${i18n('unit.m2-per-day')}</span>
        <span class="metric-desc">${i18n('colorado.card.combined.media-total')}</span>
      </div>
      <div class="metric-block">
        <span class="metric-big">${fmtN(mediaMonth, 0)}</span>
        <span class="metric-unit">${i18n('unit.m2-per-month')}</span>
        <span class="metric-desc">${i18n('colorado.card.combined.media-month')}</span>
      </div>
      <div class="metric-block ink-bg">
        <span class="metric-big">${fmtN(sum(v => v.avgInkDay), 3)}</span>
        <span class="metric-unit">${i18n('unit.l-per-day')}</span>
        <span class="metric-desc">${i18n('colorado.card.combined.ink-total')}</span>
      </div>
      <div class="metric-block ink-bg">
        <span class="metric-big">${fmtN(inkMonth, 2)}</span>
        <span class="metric-unit">${i18n('unit.l-per-month')}</span>
        <span class="metric-desc">${i18n('colorado.card.combined.ink-month')}</span>
      </div>
      ${hasCosts && costMonth !== null ? `<div class="metric-block cost-bg">
        <span class="metric-big">${fmtN(costMonth, 0)}</span>
        <span class="metric-unit">${getCostUnitPerMonth()}</span>
        <span class="metric-desc">${i18n('colorado.card.combined.cost-month')}</span>
      </div>` : ''}
    </div>
    ${formatTable}`;
  el('co-lifetime-export-btn')?.addEventListener('click', exportCSVCombinedLifetimeCo);
}

// ── Colorado Entry ─────────────────────────────────────────
function setupCoEntry() {
  document.querySelectorAll('.machine-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.machine-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      updateCoPreview();
    });
  });
  el('co-ink').addEventListener('input', updateCoPreview);
  el('co-media').addEventListener('input', updateCoPreview);
  el('co-timestamp').value = toLocalDT(new Date().toISOString());
  el('co-save-btn').addEventListener('click', saveCoEntry);
}

function getSelectedMachine() {
  return document.querySelector('.machine-btn.active')?.dataset.machine || null;
}

function updateCoPreview() {
  const machineId = getSelectedMachine();
  const inkVal    = parseFloat(el('co-ink').value);
  const mediaVal  = parseFloat(el('co-media').value);
  if (!machineId || isNaN(inkVal) || isNaN(mediaVal)) {
    el('co-preview').classList.add('hidden'); return;
  }
  const recs = getCoRecs(machineId);
  const last = recs[recs.length - 1];
  if (!last) { el('co-preview').classList.remove('hidden'); return; }

  const inkUsed   = Math.max(0, inkVal   - last.inkTotalLiters);
  const mediaUsed = Math.max(0, mediaVal - last.mediaTotalM2);
  const ts    = new Date(toISOfromDT(el('co-timestamp').value));
  const days  = Math.max((ts - new Date(last.timestamp)) / 86400000, 0.0001);
  const ratio = mediaUsed > 0 ? inkUsed / mediaUsed : null;

  el('co-prev-ink').textContent   = `+${fmtN(inkUsed, 3)} L`;
  el('co-prev-media').textContent = `+${fmtN(mediaUsed, 1)} m²`;
  el('co-prev-ratio').textContent = ratio !== null ? `${fmtN(ratio, 4)} L/m²` : '—';
  el('co-prev-days').textContent  = `${fmtN(days, 1)} dní`;
  el('co-preview').classList.remove('hidden');
}

async function saveCoEntry() {
  const machineId = getSelectedMachine();
  if (!machineId) { showToast('Vyberte tiskárnu', 'error'); return; }
  const inkVal   = parseFloat(el('co-ink').value);
  const mediaVal = parseFloat(el('co-media').value);
  if (isNaN(inkVal)   || inkVal   < 0) { showToast('Zadejte platnou hodnotu inkoustu', 'error'); return; }
  if (isNaN(mediaVal) || mediaVal < 0) { showToast('Zadejte platnou hodnotu média', 'error'); return; }

  const rec = {
    id: genId('co'),
    machineId,
    timestamp:       toISOfromDT(el('co-timestamp').value) || new Date().toISOString(),
    inkTotalLiters:  inkVal,
    mediaTotalM2:    mediaVal,
    note:            el('co-note').value.trim() || undefined,
    createdAt:       new Date().toISOString(),
  };

  el('co-save-btn').disabled = true;
  try {
    await idbPut(ST_CORECS, rec);
    S.coRecords.push(rec);
    S.coRecords.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const machineLabel = MACHINES.find(machine => machine.id === machineId)?.label || machineId;
    showToast('Záznam Colorado uložen', 'success');
    el('co-ink').value        = '';
    el('co-media').value      = '';
    el('co-note').value       = '';
    el('co-timestamp').value  = toLocalDT(new Date().toISOString());
    el('co-preview').classList.add('hidden');
    renderCoDashboard();
    renderCoHistory();
    navigate('co-dashboard');
    runNotificationDispatch(
      Reports.notificationDispatch?.emitColoradoRecordCreated?.(rec, machineLabel),
      'colorado record event'
    );
  } catch (err) {
    showToast('Chyba: ' + err.message, 'error');
  } finally {
    el('co-save-btn').disabled = false;
  }
}

// ── Colorado History ───────────────────────────────────────
function renderCoHistory() {
  const machineId = S.coHistMachine;
  document.querySelectorAll('.hist-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.machine === machineId));

  const recs = getCoRecs(machineId);
  const ivs  = computeCoIntervals(machineId);
  const ivByRec = {};
  ivs.forEach(iv => { ivByRec[iv.recordId] = iv; });

  const wrap = el('co-history-wrap');
  if (!recs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné záznamy.</p></div>`;
    return;
  }

  const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
  const filteredRecs = recs.filter(rec => dateRangeFilter(rec.timestamp, S.coDateFrom, S.coDateTo));

  if (!filteredRecs.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné záznamy v daném období.</p></div>`;
    return;
  }

  const rows = [...filteredRecs].reverse().map(rec => {
    const iv = ivByRec[rec.id];
    return `<tr>
      <td>${fmtDT(rec.timestamp)}</td>
      <td class="num">${fmtN(rec.inkTotalLiters, 3)}</td>
      <td class="num">${fmtN(rec.mediaTotalM2, 1)}</td>
      <td class="num delta">${iv ? '+' + fmtN(iv.mediaUsed, 1) : '—'}</td>
      <td class="num delta">${iv ? '+' + fmtN(iv.inkUsed, 3) : '—'}</td>
      <td class="num">${iv && iv.inkPerM2 !== null ? fmtN(iv.inkPerM2, 4) : '—'}</td>
      ${hasCosts ? `<td class="num">${iv && iv.costPerM2 !== null ? fmtN(iv.costPerM2, 2) : '—'}</td>` : ''}
      <td class="note-td">${esc(rec.note || '—')}</td>
      <td><button class="btn-del admin-only" data-id="${esc(rec.id)}" title="Smazat (jen admin)">✕</button></td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>${i18n('colorado.table.datetime')}</th>
      <th>${i18n('colorado.table.ink-total')}</th>
      <th>${i18n('colorado.table.media-total')}</th>
      <th>${i18n('colorado.table.media-delta')}</th>
      <th>${i18n('colorado.table.ink-delta')}</th>
      <th>${i18n('unit.l-per-m2')}</th>
      ${hasCosts ? `<th>${getCostUnitPerM2()}</th>` : ''}
      <th>${i18n('table.note')}</th>
      <th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  wrap.querySelectorAll('.btn-del').forEach(btn =>
    btn.addEventListener('click', () => deleteCoRecord(btn.dataset.id)));
}

async function deleteCoRecord(id) {
  if (!isAdmin()) { showToast('Mazání záznamů Colorado — jen admin', 'error'); return; }
  showConfirm('Smazat tento záznam Colorado? (Admin)', async () => {
    try {
      await cloudDelete('coRecord', id);
      await idbDelete(ST_CORECS, id);
      S.coRecords = S.coRecords.filter(r => r.id !== id);
      renderCoDashboard();
      renderCoHistory();
      showToast('Záznam smazán');
    } catch (err) {
      showToast(`Mazání selhalo: ${adminErrorMessage(err)}`, 'error');
    }
  });
}

// ══════════════════════════════════════════════════════════
//  PRINT LOG MODULE
// ══════════════════════════════════════════════════════════

const PRINT_LOG_PAGE_SIZE = 50;
const PRINT_LOG_LIFECYCLE_GAP_MS = 2 * 60 * 60 * 1000;

function mapPrinterName(name) {
  if (!name) return '—';
  if (name.includes('91')) return 'Colorado A';
  if (name.includes('92')) return 'Colorado B';
  return name;
}

function getPrintLogParams(overrides = {}) {
  const params = new URLSearchParams();
  if (S.printLogDateFrom) params.set('from', S.printLogDateFrom);
  if (S.printLogDateTo)   params.set('to', S.printLogDateTo);
  if (S.printLogPrinter !== 'all') params.set('printer', S.printLogPrinter);
  if (S.printLogResult !== 'all')  params.set('result', S.printLogResult);
  params.set('limit', String(overrides.limit ?? PRINT_LOG_PAGE_SIZE));
  params.set('offset', String(overrides.offset ?? S.printLogOffset));
  return params;
}

async function fetchPrintLogSummary() {
  const res = await fetch('/.netlify/functions/print-log-summary?' + getPrintLogParams().toString(), { cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Print log summary failed');
  return j;
}

async function fetchPrintLogRows(overrides = {}) {
  const res = await fetch('/.netlify/functions/print-log-rows?' + getPrintLogParams(overrides).toString(), { cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Print log rows failed');
  return j;
}

function getPrintLogTodayQueueParams() {
  const params = new URLSearchParams();
  const today = ds();
  params.set('from', today);
  params.set('to', today);
  if (S.printLogPrinter !== 'all') params.set('printer', S.printLogPrinter);
  if (S.printLogResult !== 'all')  params.set('result', S.printLogResult);
  return params;
}

async function fetchPrintLogTodayQueue() {
  const res = await fetch('/.netlify/functions/print-log-arrivals?' + getPrintLogTodayQueueParams().toString(), { cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Print log arrivals failed');
  return j;
}

function normalizePrintLogRow(row) {
  const sourceFile = row?.sourceFile ?? row?.source_file ?? '';
  return {
    ...row,
    sourceFile: sourceFile || '',
    source_file: sourceFile || '',
  };
}

function printLogJobLabel(row) {
  const parts = [];
  if (row?.jobName) parts.push(row.jobName);
  return parts.join(' · ') || '—';
}

function getPrintLogMachineId(printerName) {
  const name = String(printerName || '');
  if (name.includes('91')) return 'colorado1';
  if (name.includes('92')) return 'colorado2';
  return null;
}

function getPrintLogEstimateInterval(row) {
  const machineId = getPrintLogMachineId(row?.printerName);
  const readyMs = new Date(row?.readyAt).getTime();
  if (!machineId || !Number.isFinite(readyMs)) return null;
  return computeCoIntervals(machineId).find(iv => {
    const fromMs = new Date(iv.from).getTime();
    const toMs = new Date(iv.to).getTime();
    return Number.isFinite(fromMs) && Number.isFinite(toMs) && readyMs > fromMs && readyMs <= toMs;
  }) || null;
}

function getPrintLogInkEstimate(row) {
  const interval = getPrintLogEstimateInterval(row);
  const areaM2 = Number(row?.printedAreaM2);
  if (!interval || !Number.isFinite(areaM2) || areaM2 <= 0 || interval.inkPerM2 === null) {
    return { estimatedInkL: null, estimatedInkPerM2: interval?.inkPerM2 ?? null };
  }
  return {
    estimatedInkL: areaM2 * interval.inkPerM2,
    estimatedInkPerM2: interval.inkPerM2,
  };
}

function getPrintLogPeriodInkRatio(machineId) {
  const fromMs = S.printLogDateFrom ? new Date(`${S.printLogDateFrom}T00:00:00`).getTime() : null;
  const toMs = S.printLogDateTo ? new Date(`${S.printLogDateTo}T23:59:59.999`).getTime() : null;
  const intervals = computeCoIntervals(machineId).filter(iv => {
    const from = new Date(iv.from).getTime();
    const to = new Date(iv.to).getTime();
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    if (fromMs !== null && to < fromMs) return false;
    if (toMs !== null && from > toMs) return false;
    return true;
  });
  const inkUsed = intervals.reduce((sum, iv) => sum + (Number(iv.inkUsed) || 0), 0);
  const mediaUsed = intervals.reduce((sum, iv) => sum + (Number(iv.mediaUsed) || 0), 0);
  return mediaUsed > 0 ? inkUsed / mediaUsed : null;
}

function getPrintLogSummaryEstimatedInk(summary) {
  const byPrinter = summary?.byPrinter || {};
  let total = 0;
  let hasEstimate = false;
  Object.entries(byPrinter).forEach(([printerName, rec]) => {
    const machineId = getPrintLogMachineId(printerName);
    if (!machineId) return;
    const ratio = getPrintLogPeriodInkRatio(machineId);
    const areaM2 = Number(rec?.printedAreaM2);
    if (!Number.isFinite(areaM2) || areaM2 <= 0 || ratio === null) return;
    total += areaM2 * ratio;
    hasEstimate = true;
  });
  return hasEstimate ? total : null;
}

function getPrintLogDirectInk(row) {
  const channels = getPrintLogInkChannels(row);
  const total = getNullableNumber(row?.inkTotalL);
  if (total !== null) return { inkL: total, source: 'direct', channels };

  const sum = Object.values(channels).reduce((acc, value) => acc + (value || 0), 0);
  const hasChannels = Object.values(channels).some(value => value !== null);
  return {
    inkL: hasChannels ? sum : null,
    source: hasChannels ? 'direct' : null,
    channels,
  };
}

function getPrintLogInkChannels(row) {
  return {
    cyan: getNullableNumber(row?.inkCyanL),
    magenta: getNullableNumber(row?.inkMagentaL),
    yellow: getNullableNumber(row?.inkYellowL),
    black: getNullableNumber(row?.inkBlackL),
    white: getNullableNumber(row?.inkWhiteL),
  };
}

function getPrintLogInkDisplay(row) {
  const direct = getPrintLogDirectInk(row);
  if (direct.inkL !== null) return direct;
  const estimate = getPrintLogInkEstimate(row);
  return {
    inkL: estimate.estimatedInkL,
    source: estimate.estimatedInkL === null ? null : 'estimated',
    channels: null,
    estimatedInkPerM2: estimate.estimatedInkPerM2,
  };
}

function getPrintLogSummaryInk(summary) {
  const direct = getNullableNumber(summary?.inkTotalL);
  if (summary?.inkDataAvailable && direct !== null) {
    return { inkL: direct, source: 'direct' };
  }
  const estimated = getPrintLogSummaryEstimatedInk(summary);
  return {
    inkL: estimated,
    source: estimated === null ? null : 'estimated',
  };
}

const PRINT_LOG_INK_WARN_L_PER_M2 = 0.05;

function logPrintLogInkDiagnostics() {
  const summary = S.printLogSummary || null;
  if (!summary) return;

  const displayInk = getPrintLogSummaryInk(summary);
  const totalAreaM2 = getNullableNumber(summary.printedAreaM2);
  const litersPerM2 = displayInk.inkL !== null && totalAreaM2 && totalAreaM2 > 0
    ? displayInk.inkL / totalAreaM2
    : null;

  const sampleRows = (S.printLogRows || [])
    .map(row => {
      const direct = getPrintLogDirectInk(row);
      const display = getPrintLogInkDisplay(row);
      return {
        readyAt: row.readyAt || '',
        printerName: row.printerName || '',
        jobName: row.jobName || '',
        sourceFile: row.sourceFile || '',
        result: row.result || '',
        printedAreaM2: getNullableNumber(row.printedAreaM2),
        inkSource: display.source || '',
        inkCyanL: direct.channels?.cyan,
        inkMagentaL: direct.channels?.magenta,
        inkYellowL: direct.channels?.yellow,
        inkBlackL: direct.channels?.black,
        inkWhiteL: direct.channels?.white,
        finalInkL: display.inkL,
      };
    })
    .filter(row => row.finalInkL !== null)
    .slice(0, 10);

  console.groupCollapsed('[Print Log] Ink diagnostics');
  console.log('overview', {
    source: displayInk.source || null,
    totalInkL: displayInk.inkL,
    printedAreaM2: totalAreaM2,
    litersPerM2,
    loadedRows: (S.printLogRows || []).length,
  });
  if (sampleRows.length) console.table(sampleRows);
  console.groupEnd();

  if (litersPerM2 !== null && litersPerM2 > PRINT_LOG_INK_WARN_L_PER_M2) {
    console.warn('[Print Log] Suspicious ink intensity detected', {
      litersPerM2,
      threshold: PRINT_LOG_INK_WARN_L_PER_M2,
      totalInkL: displayInk.inkL,
      printedAreaM2: totalAreaM2,
      source: displayInk.source || null,
    });
  }
}

function formatPrintLogInkBreakdown(channels) {
  if (!channels) return '';
  const parts = [];
  if (channels.cyan !== null) parts.push(`C ${fmtN(channels.cyan, 3)}`);
  if (channels.magenta !== null) parts.push(`M ${fmtN(channels.magenta, 3)}`);
  if (channels.yellow !== null) parts.push(`Y ${fmtN(channels.yellow, 3)}`);
  if (channels.black !== null) parts.push(`K ${fmtN(channels.black, 3)}`);
  if (channels.white !== null && channels.white > 0) parts.push(`W ${fmtN(channels.white, 3)}`);
  return parts.join(' · ');
}

function hasPrintLogInkBreakdown(channels) {
  if (!channels) return false;
  return Object.values(channels).some(value => value !== null && value > 0);
}

function normalizePrintLogText(v) {
  return String(v || '')
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,6}$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizePrintLogSourceFile(v) {
  const raw = String(v || '').trim();
  if (!raw) return '';
  const last = raw.split(/[\\/]/).pop() || raw;
  return normalizePrintLogText(last);
}

function normalizePrintLogResult(result) {
  const norm = String(result || '').trim().toLowerCase();
  if (norm === 'done') return 'done';
  if (norm === 'deleted') return 'deleted';
  if (norm === 'abrt' || norm === 'aborted') return 'abrt';
  return norm || 'unknown';
}

function lifecycleFilterLabel(filter) {
  return ({
    all: i18n('print.lifecycle.all'),
    open_issue: i18n('print.lifecycle.open'),
    resolved_after_retry: i18n('print.lifecycle.resolved'),
    multiple_attempts: i18n('print.lifecycle.multi'),
    first_pass: i18n('print.lifecycle.first'),
  })[filter] || i18n('print.lifecycle.all');
}

function derivePrintLifecycleStatus(attempts) {
  const results = attempts.map(a => normalizePrintLogResult(a.result));
  const doneIdx = results.reduce((acc, result, idx) => result === 'done' ? idx : acc, -1);
  const hasDone = doneIdx >= 0;
  const failBeforeDone = hasDone && results.slice(0, doneIdx).some(r => r === 'deleted' || r === 'abrt');
  const doneCount = results.filter(r => r === 'done').length;
  const deletedCount = results.filter(r => r === 'deleted').length;
  const abrtCount = results.filter(r => r === 'abrt').length;

  if (hasDone && failBeforeDone) {
    if (attempts.length >= 3) return 'resolved_after_retry';
    return 'resolved_after_retry';
  }
  if (hasDone && doneCount === 1 && attempts.length === 1) return 'success_first_try';
  if (hasDone && doneCount > 1 && !results.some(r => r === 'deleted' || r === 'abrt')) return 'multiple_attempts_success';
  if (hasDone && doneCount >= 1 && attempts.length > 1 && !failBeforeDone) return 'multiple_attempts_success';
  if (!hasDone && deletedCount === attempts.length && attempts.length) return 'deleted_only';
  if (!hasDone && abrtCount === attempts.length && attempts.length) return 'aborted_only';
  if (!hasDone && (deletedCount > 0 || abrtCount > 0)) return 'open_issue';
  return 'unresolved';
}

function printLifecycleExplanation(group) {
  const attempts = group.attemptCount || 0;
  switch (group.lifecycleStatus) {
    case 'success_first_try': return i18n('print.lifecycle.expl.success_first_try');
    case 'resolved_after_retry': return attempts > 2
      ? `${attempts} ${i18n('print.lifecycle.attempts.before-success')}`
      : i18n('print.lifecycle.expl.resolved_after_retry');
    case 'open_issue': return i18n('print.lifecycle.expl.open_issue');
    case 'deleted_only': return i18n('print.lifecycle.expl.deleted_only');
    case 'aborted_only': return i18n('print.lifecycle.expl.aborted_only');
    case 'multiple_attempts_success': return `${attempts} ${i18n('print.lifecycle.expl.multiple_attempts_success')}`;
    default: return i18n('print.lifecycle.expl.unresolved');
  }
}

function printLifecycleBadgeLabel(status) {
  return ({
    success_first_try: i18n('print.lifecycle.badge.success_first_try'),
    resolved_after_retry: i18n('print.lifecycle.badge.resolved_after_retry'),
    open_issue: i18n('print.lifecycle.badge.open_issue'),
    deleted_only: i18n('print.lifecycle.badge.deleted_only'),
    aborted_only: i18n('print.lifecycle.badge.aborted_only'),
    multiple_attempts_success: i18n('print.lifecycle.badge.multiple_attempts_success'),
    unresolved: i18n('print.lifecycle.badge.unresolved'),
  })[status] || status;
}

function printLifecycleFinalResult(group) {
  const latest = group.attempts[group.attempts.length - 1];
  const norm = normalizePrintLogResult(latest?.result);
  if (norm === 'done') return i18n('print.result.done');
  if (norm === 'deleted') return i18n('print.result.deleted');
  if (norm === 'abrt') return i18n('print.result.abrt');
  return latest?.result || '—';
}

function buildPrintLifecycleGroups(rows) {
  return Reports.printLog.buildPrintLifecycleGroups(rows, {
    gapMs: PRINT_LOG_LIFECYCLE_GAP_MS,
  }).map(group => ({
    ...group,
    finalResult: printResultLabel(group.finalResultCode),
    explanation: printLifecycleExplanation(group),
  }));
}

function getPrintLogLifecycleGroups() {
  return buildPrintLifecycleGroups(S.printLogRows || []);
}

function getFilteredLifecycleGroups() {
  const groups = getPrintLogLifecycleGroups();
  if (S.printLogGroupFilter === 'all') return groups;
  if (S.printLogGroupFilter === 'open_issue') return groups.filter(g => ['open_issue', 'deleted_only', 'aborted_only', 'unresolved'].includes(g.lifecycleStatus));
  if (S.printLogGroupFilter === 'resolved_after_retry') return groups.filter(g => g.lifecycleStatus === 'resolved_after_retry');
  if (S.printLogGroupFilter === 'multiple_attempts') return groups.filter(g => g.attemptCount > 1 || g.lifecycleStatus === 'multiple_attempts_success');
  if (S.printLogGroupFilter === 'first_pass') return groups.filter(g => g.lifecycleStatus === 'success_first_try');
  return groups;
}

function getPrintLogLifecycleMetrics() {
  return Reports.printLog.buildPrintErrorSummary(getPrintLogLifecycleGroups());
}

async function loadPrintLog(force = false) {
  if (S.printLogLoading) return;
  if (S.printLogLoaded && !force && !S.printLogHasMore) return;

  if (force) {
    S.printLogRows = [];
    S.printLogOffset = 0;
    S.printLogHasMore = true;
    S.printLogExpandedGroups = {};
  }

  S.printLogLoading = true;
  elSet('print-log-status', i18n('print.status.loading'));
  const wrap = el('print-log-table-wrap');
  if (wrap && !S.printLogRows.length) {
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${i18n('loading.print-log')}</p></div>`;
  }

  try {
    const [summaryRes, rowsRes, todayQueueRes] = await Promise.allSettled([
      fetchPrintLogSummary(),
      fetchPrintLogRows(),
      fetchPrintLogTodayQueue(),
    ]);

    if (summaryRes.status !== 'fulfilled') throw summaryRes.reason;
    if (rowsRes.status !== 'fulfilled') throw rowsRes.reason;

    const summary = summaryRes.value;
    const rows = rowsRes.value;
    S.printLogSummary = summary.summary || null;
    S.printLogTodayQueue = todayQueueRes.status === 'fulfilled' ? (todayQueueRes.value || null) : null;
    const newRows = Array.isArray(rows.rows) ? rows.rows.map(normalizePrintLogRow) : [];
    S.printLogRows = [...S.printLogRows, ...newRows];
    S.printLogOffset += newRows.length;
    S.printLogHasMore = Boolean(rows.hasMore);
    S.printLogLoaded = true;
    renderPrintLog();
    logPrintLogInkDiagnostics();
    const statusTxt = summary.generatedAt
      ? `${i18n('print.status.updated')} ${fmtDT(summary.generatedAt)}`
      : i18n('print.status.default');
    elSet('print-log-status', statusTxt);
  } catch (err) {
    if (wrap) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>${i18n('print.error.load')}</p><div class="table-empty-note">${esc(err.message || err)}</div></div>`;
    }
    elSet('print-log-status', i18n('print.status.error'));
    showToast(i18n('print.toast.prefix') + (err.message || err), 'error');
  } finally {
    S.printLogLoading = false;
  }
}

function renderPrintLog() {
  renderPrintLogSummary();
  renderPrintLogComparison();
  renderPrintLogTodayQueue();
  renderPrintLogRows();
}

function renderPrintLogRows() {
  const wrap = el('print-log-table-wrap');
  const foot = el('print-log-footnote');
  if (!wrap) return;
  if (S.printLogViewMode === 'grouped') return renderPrintLifecycleGroups(wrap, foot);
  if (!S.printLogRows.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>${i18n('print.empty.jobs')}</p></div>`;
    if (foot) foot.textContent = `${i18n('print.foot.total.prefix')} 0 ${i18n('print.foot.total.suffix')}`;
    return;
  }

  const thReady = i18n('table.ready');
  const thMachine = i18n('table.machine');
  const thJob = i18n('table.job');
  const thResult = i18n('table.result');
  const thMedia = i18n('table.media');
  const thArea = i18n('table.printed-area');
  const thInk = i18n('print.stats.ink');
  const thDuration = i18n('table.duration');
  const rows = S.printLogRows.map(row => {
    const ink = getPrintLogInkDisplay(row);
    const breakdown = ink.source === 'direct' ? formatPrintLogInkBreakdown(ink.channels) : '';
    return `<tr>
    <td>${fmtDT(row.readyAt)}</td>
    <td>${esc(mapPrinterName(row.printerName))}</td>
    <td>${esc(printLogJobLabel(row))}</td>
    <td><span class="result-badge ${printResultClass(row.result)}">${esc(printResultLabel(row.result))}</span></td>
    <td>${esc(row.mediaType || '—')}</td>
    <td class="num">${fmtMeasure(row.printedAreaM2, 'm²', 2)}</td>
    <td class="num">${ink.inkL === null ? '—' : fmtMeasure(ink.inkL, 'L', 3)}${breakdown ? `<div style="font-size:.72rem;color:var(--text-faint);white-space:nowrap">${esc(breakdown)}</div>` : ''}</td>
    <td class="num">${fmtDurationSeconds(row.durationSec)}</td>
  </tr>`;
  }).join('');

  const loadMoreBtn = S.printLogHasMore
    ? `<div class="print-log-load-more-wrap"><button id="pl-load-more" class="print-log-load-more">${i18n('print.load-more')}</button></div>`
    : '';

  wrap.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>${thReady}</th>
      <th>${thMachine}</th>
      <th>${thJob}</th>
      <th>${thResult}</th>
      <th>${thMedia}</th>
      <th>${thArea}</th>
      <th>${thInk}</th>
      <th>${thDuration}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${loadMoreBtn}`;

  if (foot) foot.textContent = `${i18n('print.foot.total.prefix')} ${S.printLogRows.length} ${i18n('print.foot.total.suffix')}`;
}

function renderPrintLifecycleGroups(wrap, foot) {
  const groups = getFilteredLifecycleGroups();
  if (!groups.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🧩</div><p>${i18n('print.empty.groups')}</p></div>`;
    if (foot) foot.textContent = lifecycleFilterLabel(S.printLogGroupFilter);
    return;
  }

  const rows = groups.map(group => {
    const expanded = !!S.printLogExpandedGroups[group.id];
    const detailRows = group.attempts.map(attempt => {
      const ink = getPrintLogInkDisplay(attempt);
      const breakdown = ink.source === 'direct' ? formatPrintLogInkBreakdown(ink.channels) : '';
      return `<tr>
      <td>${fmtDT(attempt.readyAt)}</td>
      <td><span class="result-badge ${printResultClass(attempt.result)}">${esc(printResultLabel(attempt.result))}</span></td>
      <td class="num">${fmtDurationSeconds(attempt.durationSec)}</td>
      <td class="num">${fmtMeasure(attempt.printedAreaM2, 'm²', 2)}</td>
      <td class="num">${ink.inkL === null ? '—' : fmtMeasure(ink.inkL, 'L', 3)}${breakdown ? `<div style="font-size:.72rem;color:var(--text-faint);white-space:nowrap">${esc(breakdown)}</div>` : ''}</td>
      <td>${esc(attempt.mediaType || '—')}</td>
    </tr>`;
    }).join('');
    const totalInk = group.attempts.reduce((sum, attempt) => {
      const ink = getPrintLogInkDisplay(attempt);
      return sum + (ink.inkL || 0);
    }, 0);
    return `<tbody class="pl-group-body ${expanded ? 'expanded' : ''}">
      <tr class="pl-group-row" data-group-id="${esc(group.id)}">
        <td>${fmtDT(group.latestReadyAt)}</td>
        <td>${esc(mapPrinterName(group.printerName))}</td>
        <td>${esc(printLogJobLabel(group))}<div class="pl-subline">${esc(group.explanation)}</div></td>
        <td><span class="result-badge lifecycle ${group.lifecycleStatus}">${esc(printLifecycleBadgeLabel(group.lifecycleStatus))}</span></td>
        <td class="num">${fmtInt(group.attemptCount)}</td>
        <td>${esc(group.finalResult)}</td>
        <td class="num">${fmtMeasure(group.finalPrintedAreaM2, 'm²', 2)}</td>
        <td class="num">${totalInk > 0 ? fmtMeasure(totalInk, 'L', 3) : '—'}</td>
        <td>${esc(group.mediaType || '—')}</td>
      </tr>
      <tr class="pl-group-detail-row ${expanded ? '' : 'hidden'}">
        <td colspan="9">
          <div class="pl-group-detail">
            <div class="pl-detail-head">
              <strong>${esc(group.explanation)}</strong>
              <span>${group.attemptCount} ${i18n('table.attempts').toLowerCase()} · ${fmtDuration(group.totalDurationSec)} · ${fmtMeasure(group.totalPrintedAreaM2, 'm²', 2)}</span>
            </div>
            <table class="data-table pl-detail-table">
              <thead><tr><th>${i18n('table.ready')}</th><th>${i18n('table.result')}</th><th>${i18n('table.duration')}</th><th>${i18n('table.printed-area')}</th><th>${i18n('print.stats.ink')}</th><th>${i18n('table.media')}</th></tr></thead>
              <tbody>${detailRows}</tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>`;
  }).join('');

  const loadMoreBtn = S.printLogHasMore
    ? `<div class="print-log-load-more-wrap"><button id="pl-load-more" class="print-log-load-more">${i18n('print.load-more')}</button></div>`
    : '';
  wrap.innerHTML = `<table class="data-table pl-group-table">
      <thead><tr><th>${i18n('table.last-attempt')}</th><th>${i18n('table.machine')}</th><th>${i18n('table.job')}</th><th>Source file</th><th>${i18n('table.status')}</th><th>${i18n('table.attempts')}</th><th>${i18n('table.final-result')}</th><th>${i18n('table.final-area')}</th><th>${i18n('print.stats.ink')}</th><th>${i18n('table.media')}</th></tr></thead>
      ${rows}
    </table>${loadMoreBtn}`;

  if (foot) foot.textContent = `${groups.length} ${i18n('print.lifecycle.summary')} · ${lifecycleFilterLabel(S.printLogGroupFilter)}${S.printLogHasMore ? ' · ' + i18n('print.range.partial') : ''}`;
}




// ══════════════════════════════════════════════════════════
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

function getCurrentMonthExportRange() {
  return Reports.date.getCurrentMonthExportRange(new Date());
}

function exportCSVIntervals() {
  const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
  const rows = Reports.colorado.buildColoradoIntervalRows(S.coRecords, {
    inkCost: cfg.inkCost,
    mediaCost: cfg.mediaCost,
  }, MACHINES);
  const csv = Reports.csv.rowsToCsv(rows, [
    { key: 'timestamp_from', header: 'timestamp_from', value: row => fmtExportDateTime(row.timestampFrom) },
    { key: 'timestamp_to', header: 'timestamp_to', value: row => fmtExportDateTime(row.timestampTo) },
    { key: 'days_elapsed', header: 'days_elapsed', value: row => fmtN(row.daysElapsed, 2) },
    { key: 'machine', header: 'machine', value: row => row.machine },
    { key: 'ink_total_l_to', header: 'ink_total_l_to', value: row => fmtN(row.inkTotalLTo, 3) },
    { key: 'media_total_m2_to', header: 'media_total_m2_to', value: row => fmtN(row.mediaTotalM2To, 1) },
    { key: 'ink_used_l', header: 'ink_used_l', value: row => fmtN(row.inkUsedL, 3) },
    { key: 'media_used_m2', header: 'media_used_m2', value: row => fmtN(row.mediaUsedM2, 1) },
    { key: 'ink_per_m2', header: 'ink_per_m2', value: row => row.inkPerM2 !== null ? fmtN(row.inkPerM2, 6) : '' },
    { key: 'ink_cost', header: 'ink_cost', value: row => hasCosts ? fmtN(row.inkCost, 2) : '' },
    { key: 'media_cost', header: 'media_cost', value: row => hasCosts ? fmtN(row.mediaCost, 2) : '' },
    { key: 'total_cost', header: 'total_cost', value: row => hasCosts ? fmtN(row.totalCost, 2) : '' },
    { key: 'cost_per_m2', header: 'cost_per_m2', value: row => row.costPerM2 !== null ? fmtN(row.costPerM2, 4) : '' },
  ]);
  dlBlob(csv, 'text/csv;charset=utf-8', `co_intervals_${fmtFileDT()}.csv`);
}

function exportCSVCurrentMonthCo() {
  const range = getCurrentMonthExportRange();
  const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
  const rows = Reports.colorado.buildColoradoMonthlySummary(S.coRecords, {
    inkCost: cfg.inkCost,
    mediaCost: cfg.mediaCost,
  }, range, MACHINES);

  if (!rows.length) {
    showToast(i18n('colorado.export.monthly.none'), 'error');
    return;
  }
  const csv = Reports.csv.rowsToCsv(rows, [
    { key: 'row_type', header: 'row_type', value: row => row.rowType },
    { key: 'report_month_from', header: 'report_month_from', value: row => row.reportMonthFrom },
    { key: 'report_month_to', header: 'report_month_to', value: row => row.reportMonthTo },
    { key: 'machine', header: 'machine', value: row => row.machine },
    { key: 'timestamp_from', header: 'timestamp_from', value: row => fmtExportDateTime(row.timestampFrom) },
    { key: 'timestamp_to', header: 'timestamp_to', value: row => fmtExportDateTime(row.timestampTo) },
    { key: 'days_elapsed', header: 'days_elapsed', value: row => row.daysElapsed == null ? '' : fmtN(row.daysElapsed, 2) },
    { key: 'ink_total_l_to', header: 'ink_total_l_to', value: row => row.inkTotalLTo == null ? '' : fmtN(row.inkTotalLTo, 3) },
    { key: 'media_total_m2_to', header: 'media_total_m2_to', value: row => row.mediaTotalM2To == null ? '' : fmtN(row.mediaTotalM2To, 1) },
    { key: 'ink_used_l', header: 'ink_used_l', value: row => row.inkUsedL == null ? '' : fmtN(row.inkUsedL, 3) },
    { key: 'media_used_m2', header: 'media_used_m2', value: row => row.mediaUsedM2 == null ? '' : fmtN(row.mediaUsedM2, 1) },
    { key: 'ink_per_m2', header: 'ink_per_m2', value: row => row.inkPerM2 !== null && row.inkPerM2 !== undefined ? fmtN(row.inkPerM2, 6) : '' },
    { key: 'ink_cost', header: 'ink_cost', value: row => hasCosts && row.inkCost != null ? fmtN(row.inkCost, 2) : '' },
    { key: 'media_cost', header: 'media_cost', value: row => hasCosts && row.mediaCost != null ? fmtN(row.mediaCost, 2) : '' },
    { key: 'total_cost', header: 'total_cost', value: row => hasCosts && row.totalCost != null ? fmtN(row.totalCost, 2) : '' },
    { key: 'cost_per_m2', header: 'cost_per_m2', value: row => row.costPerM2 !== null && row.costPerM2 !== undefined ? fmtN(row.costPerM2, 4) : '' },
  ]);
  dlBlob(csv, 'text/csv;charset=utf-8', `co_monthly_${range.fileMonth}_${fmtFileDT()}.csv`);
  showToast(i18n('colorado.export.monthly.done'), 'success');
}

function exportCSVCombinedLifetimeCo() {
  const rows = Reports.colorado.buildColoradoLifetimeSummary(S.coRecords, MACHINES);
  if (!rows.length) {
    showToast(i18n('colorado.export.lifetime-combined.none'), 'error');
    return;
  }
  const csv = Reports.csv.rowsToCsv(rows, [
    { key: 'row_type', header: 'row_type', value: row => row.rowType },
    { key: 'printer_id', header: 'printer_id', value: row => row.printerId },
    { key: 'printer_label', header: 'printer_label', value: row => row.printerLabel },
    { key: 'lifetime_printed_area_m2', header: 'lifetime_printed_area_m2', value: () => '' },
    { key: 'lifetime_media_usage_m2', header: 'lifetime_media_usage_m2', value: row => row.lifetimeMediaUsageM2 == null ? '' : fmtN(row.lifetimeMediaUsageM2, 1) },
    { key: 'lifetime_ink_usage_total_l', header: 'lifetime_ink_usage_total_l', value: row => row.lifetimeInkUsageTotalL == null ? '' : fmtN(row.lifetimeInkUsageTotalL, 3) },
    { key: 'lifetime_ink_cyan_l', header: 'lifetime_ink_cyan_l', value: () => '' },
    { key: 'lifetime_ink_magenta_l', header: 'lifetime_ink_magenta_l', value: () => '' },
    { key: 'lifetime_ink_yellow_l', header: 'lifetime_ink_yellow_l', value: () => '' },
    { key: 'lifetime_ink_black_l', header: 'lifetime_ink_black_l', value: () => '' },
    { key: 'lifetime_ink_white_l', header: 'lifetime_ink_white_l', value: () => '' },
    { key: 'last_updated_timestamp', header: 'last_updated_timestamp', value: row => fmtExportDateTime(row.lastUpdatedTimestamp) },
  ]);
  dlBlob(csv, 'text/csv;charset=utf-8', `co_lifetime_combined_${fmtFileDT()}.csv`);
  showToast(i18n('colorado.export.lifetime-combined.done'), 'success');
}

function exportCSVRawCo() {
  const header = ['id','machine','timestamp','ink_total_l','media_total_m2','note','created_at'];
  const rows = [csvRow(header)];
  [...S.coRecords].sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp)).forEach(r => {
    rows.push(csvRow([
      r.id,
      r.machineId,
      fmtExportDateTime(r.timestamp),
      r.inkTotalLiters,
      r.mediaTotalM2,
      r.note||'',
      fmtExportDateTime(r.createdAt)
    ]));
  });
  dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `co_raw_${fmtFileDT()}.csv`);
}

function exportCSVStock() {
  const rows = Reports.stock.buildStockMovementLedger(S.items, S.movements);
  const csv = Reports.csv.rowsToCsv(rows, [
    { key: 'timestamp', header: 'timestamp', value: row => fmtExportDateTime(row.timestamp) },
    { key: 'article_number', header: 'article_number', value: row => row.articleNumber },
    { key: 'name', header: 'name', value: row => row.itemName || '' },
    { key: 'movement_type', header: 'movement_type', value: row => row.movType },
    { key: 'qty', header: 'qty', value: row => row.qty },
    { key: 'unit', header: 'unit', value: row => row.unit || 'ks' },
    { key: 'stock_after', header: 'stock_after', value: row => row.stockAfter },
    { key: 'note', header: 'note', value: row => row.note || '' },
  ]);
  dlBlob(csv, 'text/csv;charset=utf-8', `stock_movements_${fmtFileDT()}.csv`);
}

function exportCSVStockLevels() {
  const exported_at = fmtExportDateTime(new Date().toISOString());
  const rows = Reports.stock.buildStockLevels(S.items, S.movements, {
    weeksN: cfg.weeksN,
  }, exported_at);
  const csv = Reports.csv.rowsToCsv(rows, [
    { key: 'exported_at', header: 'exported_at', value: row => row.exportedAt },
    { key: 'article_number', header: 'article_number', value: row => row.articleNumber },
    { key: 'name', header: 'name', value: row => row.name || '' },
    { key: 'category', header: 'category', value: row => row.category || '' },
    { key: 'unit', header: 'unit', value: row => row.unit || 'ks' },
    { key: 'on_hand', header: 'on_hand', value: row => fmtN(row.onHand, 0) },
    { key: 'avg_weekly_issue', header: 'avg_weekly_issue', value: row => row.avgWeeklyIssue > 0 ? fmtN(row.avgWeeklyIssue, 3) : '0' },
    { key: 'days_left', header: 'days_left', value: row => row.daysLeft == null ? '' : row.daysLeft },
    { key: 'status', header: 'status', value: row => row.status },
    { key: 'min_qty', header: 'min_qty', value: row => row.minQty },
    { key: 'lead_time_days', header: 'lead_time_days', value: row => row.leadTimeDays },
    { key: 'safety_days', header: 'safety_days', value: row => row.safetyDays },
  ]);
  dlBlob(csv, 'text/csv;charset=utf-8', `stock_levels_${fmtFileDT()}.csv`);
}

async function exportCSVPrintLog() {
  try {
    const header = [
      'ready_at',
      'printer',
      'job_name',
      'result',
      'media_type',
      'printed_area_m2',
      'ink_total_l',
      'ink_source',
      'ink_cyan_l',
      'ink_magenta_l',
      'ink_yellow_l',
      'ink_black_l',
      'ink_white_l',
      'derived_ink_l_per_m2',
      'estimate_interval_from',
      'estimate_interval_to',
      'duration_sec'
    ];
    const rows = [csvRow(header)];
    const allRows = [];
    let offset = 0;

    while (true) {
      const batch = await fetchPrintLogRows({ limit: 200, offset });
      const normalized = Array.isArray(batch.rows) ? batch.rows.map(normalizePrintLogRow) : [];
      allRows.push(...normalized);
      if (!batch.hasMore || !normalized.length) break;
      offset += normalized.length;
    }

    allRows.forEach(row => {
      const interval = getPrintLogEstimateInterval(row);
      const ink = getPrintLogInkDisplay(row);
      const direct = getPrintLogDirectInk(row);
      rows.push(csvRow([
        fmtExportDateTime(row.readyAt),
        mapPrinterName(row.printerName),
        row.jobName || '',
        printResultLabel(row.result),
        row.mediaType || '',
        Number.isFinite(Number(row.printedAreaM2)) ? fmtN(row.printedAreaM2, 2) : '',
        ink.inkL === null ? '' : fmtN(ink.inkL, 3),
        ink.source === 'direct' ? 'direct_print_accounting_rows' : ink.source === 'estimated' ? 'derived_from_lifetime_interval_ratio' : '',
        direct.channels?.cyan === null || direct.channels?.cyan === undefined ? '' : fmtN(direct.channels.cyan, 3),
        direct.channels?.magenta === null || direct.channels?.magenta === undefined ? '' : fmtN(direct.channels.magenta, 3),
        direct.channels?.yellow === null || direct.channels?.yellow === undefined ? '' : fmtN(direct.channels.yellow, 3),
        direct.channels?.black === null || direct.channels?.black === undefined ? '' : fmtN(direct.channels.black, 3),
        direct.channels?.white === null || direct.channels?.white === undefined ? '' : fmtN(direct.channels.white, 3),
        ink.source === 'estimated' && ink.estimatedInkPerM2 !== null ? fmtN(ink.estimatedInkPerM2, 6) : '',
        fmtExportDateTime(interval?.from),
        fmtExportDateTime(interval?.to),
        Number.isFinite(Number(row.durationSec)) ? fmtN(row.durationSec, 0) : '',
      ]));
    });

    dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `print_log_estimated_ink_${fmtFileDT()}.csv`);
    showToast(`Export hotov: ${allRows.length} záznamů`, 'success');
  } catch (err) {
    showToast(`Export selhal: ${err.message || err}`, 'error');
  }
}

async function exportJSON() {
  const data = {
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    items:      S.items,
    movements:  S.movements,
    coRecords:  S.coRecords,
    settings: [{
      key: 'config',
      weeksN: cfg.weeksN,
      rollingN: cfg.rollingN,
      inkCost: cfg.inkCost,
      mediaCost: cfg.mediaCost,
      costCurrency: cfg.costCurrency,
      savedAt: new Date().toISOString(),
    }],
  };
  dlBlob(JSON.stringify(data, null, 2), 'application/json', `printguard_backup_${fmtFileDT()}.json`);
}

async function handleImportJSON(e) {
  const file = e.target.files?.[0];
  if (!file) return;
  e.target.value = '';
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch { showToast('Neplatný JSON soubor', 'error'); return; }

  // support old StockGuard snapshot format
  let items = [];
  let movements = [];
  let coRecords = [];
  let settings = [];
  const hasSettingsPayload = Array.isArray(data.settings);

  if (Array.isArray(data.items)) {
    items = data.items.filter(it => it?.articleNumber);
  }
  if (Array.isArray(data.movements)) {
    movements = data.movements.filter(m => m?.id && m?.articleNumber);
  }
  // StockGuard snapshots: data.snapshots[]
  if (Array.isArray(data.snapshots)) {
    data.snapshots.forEach(snap => {
      const articleNumber = snap.articleNumber || snap.article_number || snap.code;
      if (!articleNumber) return;
      movements.push({
        id: genId('imp'),
        articleNumber: String(articleNumber).trim().toUpperCase().replace(/\s+/g,'–'),
        movType: 'stocktake',
        qty: parseFloat(snap.qty ?? snap.quantity ?? snap.onHand ?? 0),
        timestamp: snap.timestamp || snap.date || new Date().toISOString(),
        note: 'Import StockGuard',
        deviceId: cfg.deviceId,
      });
    });
  }
  if (Array.isArray(data.coRecords)) {
    coRecords = data.coRecords.filter(r => r?.id && r?.machineId);
  }
  if (hasSettingsPayload) {
    settings = data.settings.filter(s => s?.key);
  }

  showConfirm(`Importovat ${items.length} položek, ${movements.length} pohybů, ${coRecords.length} CO záznamů? Existující data budou přepsána.`, async () => {
    const clears = [idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS)];
    if (hasSettingsPayload) clears.push(idbClear(ST_SETTINGS));
    await Promise.all(clears);
    for (const it of items) await idbPut(ST_ITEMS, it);
    for (const m  of movements) await idbPut(ST_MOVES, m);
    for (const r  of coRecords) await idbPut(ST_CORECS, r);
    for (const s  of settings) await idbPut(ST_SETTINGS, s);
    await loadAll();
    showToast(`Import hotov: ${items.length} pol., ${movements.length} poh.`, 'success');
  });
}


// ── Date range helper ────────────────────────────────────
function dateRangeFilter(timestamp, from, to) {
  return Reports.date.dateRangeFilter(timestamp, from, to);
}
function applyPreset(range, target) {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  const fmt = d => `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  const todayStr = fmt(now);
  let fromStr = '';
  if (range === 'month') {
    fromStr = `${now.getFullYear()}-${p(now.getMonth()+1)}-01`;
  } else if (range === 'year') {
    fromStr = `${now.getFullYear()}-01-01`;
  } else {
    const d = new Date(now); d.setDate(d.getDate() - parseInt(range));
    fromStr = fmt(d);
  }
  if (target === 'log') {
    S.logDateFrom = fromStr; S.logDateTo = todayStr;
    el('stock-log-from').value = fromStr;
    el('stock-log-to').value   = todayStr;
    renderStockLog();
  } else if (target === 'co') {
    S.coDateFrom = fromStr; S.coDateTo = todayStr;
    el('co-hist-from').value = fromStr;
    el('co-hist-to').value   = todayStr;
    renderCoHistory();
  } else {
    S.printLogDateFrom = fromStr; S.printLogDateTo = todayStr;
    el('print-log-from').value = fromStr;
    el('print-log-to').value   = todayStr;
    S.printLogLoaded = false;
    loadPrintLog(true);
  }
}

// ══════════════════════════════════════════════════════════
//  STOCK — LOG (všechny pohyby, reportová obrazovka)
// ══════════════════════════════════════════════════════════

function renderStockLog() {
  const filtered = Reports.stock.buildStockLogRows(S.items, S.movements, {
    movType: S.logFilter,
    search: S.logSearch,
    from: S.logDateFrom,
    to: S.logDateTo,
  });

  const wrap = el('stock-log-wrap');
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné pohyby neodpovídají filtru.</p></div>`;
    return;
  }

  const typeLabel = {
    receipt: `↑ ${movementLabel('receipt')}`,
    issue: `↓ ${movementLabel('issue')}`,
    stocktake: `= ${movementLabel('stocktake')}`,
  };
  const typeClass = { receipt: 'receipt-c', issue: 'issue-c', stocktake: 'stocktake-c' };

  const rows = [...filtered].reverse().map(m => {
    const sign = m.movType === 'issue' ? `−${fmtN(m.qty,0)}` : m.movType === 'receipt' ? `+${fmtN(m.qty,0)}` : `=${fmtN(m.qty,0)}`;
    const dClass = m.movType === 'receipt' ? 'receipt-c' : m.movType === 'issue' ? 'issue-c' : 'stocktake-c';
    return `<tr>
      <td>${fmtDT(m.timestamp)}</td>
      <td class="log-item-name" data-article="${esc(m.articleNumber)}" style="cursor:pointer">${esc(m.itemName)}<br><span style="font-size:.6rem;color:var(--text-faint);letter-spacing:.05em">${esc(m.articleNumber)}</span></td>
      <td class="${typeClass[m.movType]||''}">${typeLabel[m.movType]||m.movType}</td>
      <td class="num ${dClass}">${sign} <small>${esc(m.unit)}</small></td>
      <td class="num"><strong>${fmtN(m.stockAfter,0)}</strong> <small>${esc(m.unit)}</small></td>
      <td class="note-td">${esc(m.note||'—')}</td>
      <td><button class="btn-del admin-only" data-id="${esc(m.id)}" title="Smazat (jen admin)">✕</button></td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>${i18n('table.date')}</th><th>${i18n('table.item')}</th><th>${i18n('table.type')}</th><th>${i18n('table.change')}</th><th>${i18n('table.after')}</th><th>${i18n('table.note')}</th><th></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;

  wrap.querySelectorAll('.log-item-name[data-article]').forEach(td =>
    td.addEventListener('click', () => openStockDetail(td.dataset.article))
  );
  wrap.querySelectorAll('.btn-del[data-id]').forEach(btn =>
    btn.addEventListener('click', () => deleteMovementAdmin(btn.dataset.id))
  );
}

function exportCSVStockLog() {
  const rows = Reports.stock.buildStockMovementLedger(S.items, S.movements);
  const csv = Reports.csv.rowsToCsv(rows, [
    { key: 'timestamp', header: 'timestamp', value: row => fmtExportDateTime(row.timestamp) },
    { key: 'article_number', header: 'article_number', value: row => row.articleNumber },
    { key: 'name', header: 'name', value: row => row.itemName || '' },
    { key: 'category', header: 'category', value: row => row.category || '' },
    { key: 'unit', header: 'unit', value: row => row.unit || 'ks' },
    { key: 'movement_type', header: 'movement_type', value: row => row.movType },
    { key: 'qty', header: 'qty', value: row => row.qty },
    { key: 'stock_after', header: 'stock_after', value: row => row.stockAfter },
    { key: 'note', header: 'note', value: row => row.note || '' },
  ]);
  dlBlob(csv, 'text/csv;charset=utf-8', `pohyby_skladu_${fmtFileDT()}.csv`);
}

// ══════════════════════════════════════════════════════════
//  NAVIGATION + MODE
// ══════════════════════════════════════════════════════════

const LAST_SCREEN_KEY = 'pg_last_screen';
const DEFAULT_SCREEN = 'stock-overview';

function isValidScreen(screenId) {
  return Boolean(screenId && el('screen-' + screenId));
}

function getInitialScreen() {
  const params = new URLSearchParams(window.location.search);
  const urlScreen = params.get('screen');
  if (isValidScreen(urlScreen)) return urlScreen;

  const storedScreen = ls(LAST_SCREEN_KEY);
  if (isValidScreen(storedScreen)) return storedScreen;

  return isValidScreen('home') ? 'home' : DEFAULT_SCREEN;
}

function getModeForScreen(screenId) {
  return ['co-dashboard', 'co-entry', 'co-history', 'print-log', 'postpurchase-orders'].includes(screenId)
    ? 'colorado'
    : 'stock';
}

function applyModeUI(mode) {
  S.mode = mode === 'colorado' ? 'colorado' : 'stock';
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === S.mode));
  el('stock-nav')?.classList.toggle('hidden', S.mode !== 'stock');
  el('colorado-nav')?.classList.toggle('hidden', S.mode !== 'colorado');
}

function persistScreenRoute(screenId, options = {}) {
  if (!isValidScreen(screenId)) return;
  ls(LAST_SCREEN_KEY, screenId);

  const params = new URLSearchParams(window.location.search);
  if (params.get('screen') === screenId && !options.replace) return;
  params.set('screen', screenId);
  const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash || ''}`;
  const state = { screen: screenId };
  if (options.replace) window.history.replaceState(state, '', nextUrl);
  else window.history.pushState(state, '', nextUrl);
}

function navigate(screenId, options = {}) {
  if (!isValidScreen(screenId)) screenId = DEFAULT_SCREEN;
  applyModeUI(getModeForScreen(screenId));

  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el('screen-' + screenId)?.classList.add('active');

  // vždycky přepni active podle data-screen (napříč oběma navy)
  document.querySelectorAll('#stock-nav .nav-item, #colorado-nav .nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === screenId)
  );

  if (screenId === 'stock-alerts')  renderAlerts();
  if (screenId === 'checklist')     renderChecklistScreen();
  if (screenId === 'stock-items')   renderItemsMgmt();
  if (screenId === 'stock-log')     renderStockLog();
  if (screenId === 'co-history')    renderCoHistory();
  if (screenId === 'print-log')     loadPrintLog();
  if (screenId === 'postpurchase-orders') loadPostPurchaseOrders();
  if (screenId === 'settings')      loadSettingsUI();

  persistScreenRoute(screenId, options);
  window.scrollTo(0, 0);
  applyRoleUI(); // ✅ IMPORTANT
}

function setMode(mode) {
  applyModeUI(mode);
  navigate(mode === 'stock' ? 'stock-overview' : 'co-dashboard');
}

// ══════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════

function isAdmin() { return cfg.role === 'admin' && Boolean(cfg.adminPin); }

async function cloudPull() {
  const res = await fetch('/.netlify/functions/sync', { method: 'GET', cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud pull failed');
  return j;
}

async function cloudPush() {
  const res = await fetch('/.netlify/functions/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      items:     S.items,
      movements: S.movements,
      coRecords: S.coRecords,
      settings:  [{
        key: 'config',
        weeksN:    cfg.weeksN,
        rollingN:  cfg.rollingN,
        inkCost:   cfg.inkCost,
        mediaCost: cfg.mediaCost,
        costCurrency: cfg.costCurrency,
        savedAt:   new Date().toISOString(),
      }],
    })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud push failed');
  return j;
}

async function cloudDelete(kind, key) {
  const params = new URLSearchParams({
    kind: String(kind || ''),
    key: String(key || ''),
  });
  const res = await fetch(`/.netlify/functions/sync?${params.toString()}`, {
    method: 'DELETE',
    headers: adminHeaders(),
    cache: 'no-store',
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud delete failed');
  return j;
}

async function deleteMovement(id) {
  showConfirm('Smazat tento pohyb skladu?', async () => {
    try {
      const res = await fetch('/.netlify/functions/delete-stock-movement', {
        method: 'DELETE',
        headers: adminJsonHeaders(),
        cache: 'no-store',
        body: JSON.stringify({ id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud delete failed');
      await idbDelete(ST_MOVES, id);
      S.movements = S.movements.filter(m => m.id !== id);
      renderStockOverview();
      renderAlerts();
      if (S.detailArticle) openStockDetail(S.detailArticle);
      showToast('Pohyb smazán');
    } catch (err) {
      showToast(`Mazání selhalo: ${adminErrorMessage(err)}`, 'error');
    }
  });
}

async function runSync(options = {}) {
  const { silent = false } = options;
  const btn = el('sync-btn');
  if (S.syncRunning) return false;
  if (!navigator.onLine) {
    if (!silent) showToast('Jsi offline — sync nejde.', 'error');
    return false;
  }

  S.syncRunning = true;
  btn?.classList.add('syncing');

  try {
    if (!silent) showToast('Sync…');

    await loadAll();

    const badLocalItem = (S.items || []).find(it => !it?.articleNumber);
    if (badLocalItem) {
      console.warn('[SYNC] Local item missing articleNumber:', badLocalItem);
      if (!silent) showToast('Lokální data: některé položky nemají articleNumber.', 'error');
      return false;
    }
    const badLocalMove = (S.movements || []).find(m => !m?.id);
    if (badLocalMove) {
      console.warn('[SYNC] Local movement missing id:', badLocalMove);
      if (!silent) showToast('Lokální data: některé pohyby nemají id.', 'error');
      return false;
    }
    const badLocalCo = (S.coRecords || []).find(r => !r?.id);
    if (badLocalCo) {
      console.warn('[SYNC] Local coRecord missing id:', badLocalCo);
      if (!silent) showToast('Lokální data: některé Colorado záznamy nemají id.', 'error');
      return false;
    }

    const pushRes = await cloudPush();
    const remote = await cloudPull();

    const rawItems    = Array.isArray(remote?.items)     ? remote.items     : [];
    const rawMoves    = Array.isArray(remote?.movements) ? remote.movements : [];
    const rawCo       = Array.isArray(remote?.coRecords) ? remote.coRecords : [];
    const rawSettings = Array.isArray(remote?.settings)  ? remote.settings  : [];

    const goodItems = [];
    const badItems  = [];
    for (const it of rawItems) {
      const articleNumber =
        it?.articleNumber ??
        it?.ArticleNumber ??
        it?.article ??
        it?.code ??
        null;

      if (!articleNumber || String(articleNumber).trim() === '') {
        badItems.push(it);
        continue;
      }

      const fixed = { ...it, articleNumber: String(articleNumber).trim().toUpperCase().replace(/\s+/g, '-') };
      goodItems.push(fixed);
    }

    const goodMoves = [];
    const badMoves  = [];
    for (const m of rawMoves) {
      const id = m?.id ?? null;
      const articleNumber = m?.articleNumber ?? m?.ArticleNumber ?? null;
      if (!id || String(id).trim() === '' || !articleNumber || String(articleNumber).trim() === '') {
        badMoves.push(m);
        continue;
      }
      goodMoves.push({
        ...m,
        id: String(id).trim(),
        articleNumber: String(articleNumber).trim().toUpperCase().replace(/\s+/g, '-')
      });
    }

    const goodCo = [];
    const badCo  = [];
    for (const r of rawCo) {
      const id = r?.id ?? null;
      const machineId = r?.machineId ?? null;
      if (!id || String(id).trim() === '' || !machineId || String(machineId).trim() === '') {
        badCo.push(r);
        continue;
      }
      goodCo.push({ ...r, id: String(id).trim(), machineId: String(machineId).trim() });
    }

    if (badItems.length || badMoves.length || badCo.length) {
      console.warn('[SYNC] Dropping invalid remote records:', {
        badItems, badMoves, badCo
      });
    }

    await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS), idbClear(ST_SETTINGS)]);

    for (const it of goodItems) await idbPut(ST_ITEMS, it);
    for (const m  of goodMoves) await idbPut(ST_MOVES, m);
    for (const r  of goodCo)    await idbPut(ST_CORECS, r);
    for (const s of rawSettings) {
      if (s?.key) await idbPut(ST_SETTINGS, s);
    }

    await loadAll();

    await sendStockNotifications({ silent: true, trigger: 'sync' });

    const dropped = badItems.length + badMoves.length + badCo.length;
    if (!silent) {
      showToast(
        `Sync OK · items:${pushRes?.upserted?.items ?? 0} · moves:${pushRes?.upserted?.movements ?? 0} · co:${pushRes?.upserted?.coRecords ?? 0}` +
        (dropped ? ` · zahoz.:${dropped}` : ''),
        dropped ? 'warn' : 'success'
      );
    }
    markCloudSyncComplete();
    return true;
  } catch (e) {
    console.error('[SYNC] Error:', e);
    if (!silent) showToast('Sync chyba: ' + (e?.message || e), 'error');
    return false;
  } finally {
    S.syncRunning = false;
    applyRoleUI();
    setTimeout(() => btn?.classList.remove('syncing'), 500);
  }
}

function setupBackgroundSync() {
  window.addEventListener('online', () => {
    updateOfflineBanner();
    window.setTimeout(() => {
      if (shouldRunBackgroundSync()) runSync({ silent: true });
    }, SYNC_ONLINE_RETRY_DELAY_MS);
  });

  document.addEventListener('visibilitychange', () => {
    if (shouldRunBackgroundSync()) runSync({ silent: true });
  });

  if (S.syncIntervalId) clearInterval(S.syncIntervalId);
  S.syncIntervalId = setInterval(() => {
    if (shouldRunBackgroundSync()) runSync({ silent: true });
  }, SYNC_MIN_INTERVAL_MS);
}

function applyRoleUI() {
  const admin = isAdmin();

  // schovej/ukaž stock "Položky" v bottom nav
  const itemsBtn = document.querySelector('#stock-nav .nav-item[data-screen="stock-items"]');
  if (itemsBtn) itemsBtn.style.display = admin ? '' : 'none';

  // schovej/ukaž tlačítko "+ Přidat položku" na obrazovce stock-items
  const addBtn = el('add-item-btn');
  if (addBtn) addBtn.style.display = admin ? '' : 'none';

  // všechny .admin-only elementy (✕ mazání, 🛒 objednat, …)
  document.querySelectorAll('.admin-only').forEach(node => {
    node.style.display = admin ? '' : 'none';
  });

  // když nejsi admin a někdo se tam dostane přes URL param, vrať ho pryč
  if (!admin) {
    const itemsScreen = el('screen-stock-items');
    if (itemsScreen?.classList.contains('active')) navigate('stock-overview');
  }
}


async function enablePushNotifications() {
  try {
    if (!('serviceWorker' in navigator)) {
      showToast('Service Worker není podporován.', 'error');
      return;
    }

    if (!('PushManager' in window) || !('Notification' in window)) {
      showToast('Push notifikace nejsou podporovány.', 'error');
      return;
    }

    const vapidPublicKey = typeof window.VAPID_PUBLIC_KEY === 'string'
      ? window.VAPID_PUBLIC_KEY.trim()
      : '';

    if (!vapidPublicKey) {
      showToast('Chybí VAPID public key.', 'error');
      return;
    }

    console.log('[Push] VAPID_PUBLIC_KEY presence', {
      exists: Boolean(window.VAPID_PUBLIC_KEY),
      length: vapidPublicKey.length,
    });

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Push notifikace nebyly povoleny.', 'error');
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    const deviceName = getPushDeviceName();

    console.log('[Push] subscribe start', {
      deviceName,
      hasExistingSubscription: Boolean(subscription),
      endpointSuffix: getPushEndpointSuffix(
        subscription && typeof subscription.endpoint === 'string' ? subscription.endpoint : ''
      ),
    });

    if (subscription) {
      const existingPayload = buildPushSubscriptionPayload(subscription);

      if (existingPayload) {
        console.log('[Push] reusing existing subscription', {
          deviceName,
          endpointSuffix: getPushEndpointSuffix(existingPayload.endpoint),
        });
        await persistPushSubscription(existingPayload);
        showToast('Push notifikace byly povoleny.', 'success');
        return;
      }

      try {
        console.warn('[Push] unsubscribing stale subscription', {
          deviceName,
          endpointSuffix: getPushEndpointSuffix(subscription.endpoint),
        });
        await subscription.unsubscribe();
      } catch (error) {
        console.warn('[Push] failed to unsubscribe stale subscription', error);
      }

      subscription = null;
    }

    if (!subscription) {
      const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);

      if (applicationServerKey.length !== 65) {
        throw new Error('VAPID public key has invalid length.');
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });

      console.log('[Push] created new subscription', {
        deviceName,
        endpointSuffix: getPushEndpointSuffix(subscription.endpoint),
      });
    }

    const payload = buildPushSubscriptionPayload(subscription);
    if (!payload) {
      throw new Error('Neplatná push subscription.');
    }

    await persistPushSubscription(payload);
    showToast('Push notifikace byly povoleny.', 'success');
  } catch (error) {
    console.error('[Push] enable failed', error);
    showToast('Zapnutí push notifikací selhalo.', 'error');
  }
}

async function sendStockNotifications(options = {}) {
  const { silent = false, trigger = 'manual' } = options;

  if (!Reports.notificationDispatch || typeof Reports.notificationDispatch.evaluateStockAlerts !== 'function') {
    if (!silent) showToast('Chybí notification dispatch modul.', 'error');
    return null;
  }

  try {
    const result = await Reports.notificationDispatch.evaluateStockAlerts({
      weeksN: cfg.weeksN,
      trigger,
    });

    if (!silent) {
      showToast(
        `Stock notifikace: nové ${result.sentAlerts || 0}, beze změny ${result.skippedAlerts || 0}.`,
        'success'
      );
    }

    return result;
  } catch (error) {
    console.error('[Push] stock notifications failed', error);
    if (!silent) {
      showToast(error?.message || 'Odeslání stock notifikací selhalo.', 'error');
    }
    return null;
  }
}

window.enablePushNotifications = enablePushNotifications;

function showConfirm(text, onOk) {
  el('confirm-text').textContent = text;
  el('confirm-modal').classList.remove('hidden');
  const close = () => el('confirm-modal').classList.add('hidden');
  el('confirm-ok').onclick     = () => { close(); onOk(); };
  el('confirm-cancel').onclick = close;
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════

async function init() {
  if (window.I18N && typeof window.I18N.init === 'function') {
    window.I18N.init();
  }
  setDb(await openDB());

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
  el('fab-movement').addEventListener('click',  () => navigate('stock-movement'));
  el('fab-co-entry').addEventListener('click',  () => navigate('co-entry'));

  // Topbar
  el('nav-settings').addEventListener('click', () => navigate('settings'));

// ✅ SYNC (cloud push + pull + overwrite local)
// ✅ SYNC (cloud push + pull + overwrite local) — HARDENED
el('sync-btn').addEventListener('click', async () => {
  await runSync();
});

  // Stock search + filter
  el('stock-search').addEventListener('input', e => {
    S.stockSearch = e.target.value; renderStockOverview();
  });
  document.querySelectorAll('.pill').forEach(p =>
    p.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(pp => pp.classList.remove('active'));
      p.classList.add('active');
      S.stockFilter = p.dataset.filter;
      renderStockOverview();
    }));
  document.querySelectorAll('.stat-chip').forEach(chip =>
    chip.addEventListener('click', () => {
      const f = chip.dataset.filter;
      document.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p.dataset.filter === f));
      S.stockFilter = f;
      renderStockOverview();
    }));

  // Item modal
  el('add-item-btn').addEventListener('click',      () => openItemModal(null));
  el('item-modal-close').addEventListener('click',  () => el('item-modal').classList.add('hidden'));
  el('item-modal-cancel').addEventListener('click', () => el('item-modal').classList.add('hidden'));
  el('item-modal-save').addEventListener('click',   saveItemModal);

  // Colorado history tabs
  document.querySelectorAll('.hist-tab').forEach(b =>
    b.addEventListener('click', () => { S.coHistMachine = b.dataset.machine; renderCoHistory(); }));

  setupMovementEntry();
  setupCoEntry();
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

  const langSelect = el('lang-select');
  if (langSelect) {
    langSelect.value = (window.I18N && window.I18N.currentLang) || (window.I18N && window.I18N.defaultLang) || 'cs';
    langSelect.addEventListener('change', e => {
      if (window.I18N && typeof window.I18N.setLang === 'function') {
        window.I18N.setLang(e.target.value);
      }
    });
  }

  // Stock log search + filter
  el('stock-log-search').addEventListener('input', e => {
    S.logSearch = e.target.value; renderStockLog();
  });
  document.querySelectorAll('[data-logfilter]').forEach(p =>
    p.addEventListener('click', () => {
      document.querySelectorAll('[data-logfilter]').forEach(pp => pp.classList.remove('active'));
      p.classList.add('active');
      S.logFilter = p.dataset.logfilter;
      renderStockLog();
    }));
  el('stock-log-export-btn').addEventListener('click', exportCSVStockLog);

  // Stock log date range
  el('stock-log-from').addEventListener('change', e => { S.logDateFrom = e.target.value; renderStockLog(); });
  el('stock-log-to').addEventListener('change',   e => { S.logDateTo   = e.target.value; renderStockLog(); });
  el('stock-log-clear-dates').addEventListener('click', () => {
    S.logDateFrom = ''; S.logDateTo = '';
    el('stock-log-from').value = ''; el('stock-log-to').value = '';
    renderStockLog();
  });

  // Colorado history date range
  el('co-hist-from').addEventListener('change', e => { S.coDateFrom = e.target.value; renderCoHistory(); });
  el('co-hist-to').addEventListener('change',   e => { S.coDateTo   = e.target.value; renderCoHistory(); });
  el('co-hist-clear-dates').addEventListener('click', () => {
    S.coDateFrom = ''; S.coDateTo = '';
    el('co-hist-from').value = ''; el('co-hist-to').value = '';
    renderCoHistory();
  });
  el('co-history-export-btn').addEventListener('click', exportCSVRawCo);
  el('co-month-export-btn').addEventListener('click', exportCSVCurrentMonthCo);

  // Print log filters
  el('print-log-from').addEventListener('change', e => { S.printLogDateFrom = e.target.value; loadPrintLog(true); });
  el('print-log-to').addEventListener('change',   e => { S.printLogDateTo   = e.target.value; loadPrintLog(true); });
  el('print-log-view-mode').addEventListener('change', e => {
    S.printLogViewMode = e.target.value || 'raw';
    const isGrouped = S.printLogViewMode === 'grouped';
    el('print-log-group-filter-wrap')?.classList.toggle('hidden', !isGrouped);
    elSet('print-log-table-title', isGrouped ? 'Řešení problémů / SLA' : 'Poslední tiskové aktivity');
    renderPrintLogRows();
  });
  el('print-log-printer').addEventListener('change', e => { S.printLogPrinter = e.target.value; loadPrintLog(true); });
  el('print-log-result').addEventListener('change',  e => { S.printLogResult  = e.target.value; loadPrintLog(true); });
  el('print-log-group-filter').addEventListener('change', e => {
    S.printLogGroupFilter = e.target.value || 'all';
    renderPrintLogRows();
  });
  el('print-log-clear-dates').addEventListener('click', () => {
    S.printLogDateFrom = ''; S.printLogDateTo = '';
    el('print-log-from').value = ''; el('print-log-to').value = '';
    loadPrintLog(true);
  });
  el('print-log-refresh-btn').addEventListener('click', () => {
    loadPrintLog(true);
  });
  el('print-log-export-btn').addEventListener('click', exportCSVPrintLog);
  el('postpurchase-refresh-btn')?.addEventListener('click', () => {
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-search')?.addEventListener('input', e => {
    S.postPurchaseSearch = e.target.value || '';
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-date-preset')?.addEventListener('change', e => {
    S.postPurchaseDatePreset = e.target.value || 'this_month';
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-date-from')?.addEventListener('change', e => {
    S.postPurchaseDateFrom = e.target.value || '';
    if (S.postPurchaseDateFrom || S.postPurchaseDateTo) S.postPurchaseDatePreset = 'custom';
    if (el('postpurchase-date-preset')) el('postpurchase-date-preset').value = S.postPurchaseDatePreset;
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-date-to')?.addEventListener('change', e => {
    S.postPurchaseDateTo = e.target.value || '';
    if (S.postPurchaseDateFrom || S.postPurchaseDateTo) S.postPurchaseDatePreset = 'custom';
    if (el('postpurchase-date-preset')) el('postpurchase-date-preset').value = S.postPurchaseDatePreset;
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-reprint-filter')?.addEventListener('change', e => {
    S.postPurchaseReprint = e.target.value || 'all';
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-clear-filters')?.addEventListener('click', () => {
    S.postPurchaseSearch = '';
    S.postPurchaseMonth = '';
    S.postPurchaseDatePreset = 'this_month';
    S.postPurchaseDateFrom = '';
    S.postPurchaseDateTo = '';
    S.postPurchaseReprint = 'all';
    if (el('postpurchase-search')) el('postpurchase-search').value = '';
    if (el('postpurchase-date-preset')) el('postpurchase-date-preset').value = 'this_month';
    if (el('postpurchase-date-from')) el('postpurchase-date-from').value = '';
    if (el('postpurchase-date-to')) el('postpurchase-date-to').value = '';
    if (el('postpurchase-reprint-filter')) el('postpurchase-reprint-filter').value = 'all';
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-unlock-btn')?.addEventListener('click', () => {
    const pin = (el('postpurchase-pin')?.value || '').trim();
    if (!pin) { showToast('Enter Processed Orders PIN', 'error'); return; }
    cfg.postPurchasePin = pin;
    if (el('postpurchase-pin')) el('postpurchase-pin').value = '';
    S.postPurchaseLoaded = false;
    showToast('Processed orders unlocked', 'success');
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-lock-btn')?.addEventListener('click', () => {
    cfg.postPurchasePin = '';
    S.postPurchaseLoaded = false;
    S.postPurchaseOrders = [];
    renderPostPurchaseAccessRequired();
    showToast('Processed orders locked', 'success');
  });
  el('postpurchase-sync-btn')?.addEventListener('click', () => {
    syncPostPurchaseOrdersManual();
  });
  document.addEventListener('click', e => {
    const groupRow = e.target?.closest?.('.pl-group-row[data-group-id]');
    if (groupRow) {
      const id = groupRow.dataset.groupId;
      S.printLogExpandedGroups[id] = !S.printLogExpandedGroups[id];
      renderPrintLogRows();
      return;
    }
    if (e.target?.id === 'pl-load-more') {
      loadPrintLog(false);
    }
  });

  // Preset buttons (společné pro obě obrazovky)
  document.querySelectorAll('.dr-preset').forEach(btn =>
    btn.addEventListener('click', () => applyPreset(btn.dataset.range, btn.dataset.target)));

  // ✅ Admin unlock/lock listenery musí být až po DOM ready (tady)
  el('admin-unlock-btn')?.addEventListener('click', () => {
    const pin = (el('admin-pin')?.value || '').trim();
    if (!pin) { showToast('Zadejte PIN', 'error'); return; }
    cfg.adminPin = pin;
    cfg.role = 'admin';
    if (el('admin-pin')) el('admin-pin').value = '';
    applyRoleUI();
    showToast('Admin režim odemčen', 'success');
  });

  el('admin-lock-btn')?.addEventListener('click', () => {
    cfg.adminPin = '';
    cfg.role = 'operator';
    applyRoleUI();
    showToast('Operator režim aktivní', 'success');
  });

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

function updateOfflineBanner() {
  el('offline-banner')?.classList.toggle('hidden', navigator.onLine);
}

document.addEventListener('DOMContentLoaded', init);
