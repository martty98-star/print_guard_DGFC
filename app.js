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

  StockFeature.bindStockDetailControls(item);

  navigate('stock-detail');
}

function buildMovementRows(item, moves) {
  return StockUI.buildMovementRows({
    esc,
    fmtDT,
    fmtN,
    item,
    movementLabel,
    moves,
  });
}

/**
 * Build a "stock level over time" table (derived from movement ledger).
 * Shows running on-hand after every movement, most recent first.
 */
function buildStockHistoryTable(item, moves) {
  return StockFeature.renderStockHistory(item, moves);
}

// Admin-gated verze pro Historie pohybů
async function deleteMovementAdmin(id) {
  if (!isAdmin()) { showToast('Mazání pohybů — jen admin', 'error'); return; }
  showConfirm('Smazat tento pohyb skladu? (Admin)', async () => {
    try {
      await StockStore.deleteMovementRemote(id, stockApiAdapter());
      await StockStore.deleteMovementLocal(stockDbAdapter(), id);
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
  return StockFeature.renderStockAlerts();
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
    await StockStore.putMovement(stockDbAdapter(), move);
    S.movements.push(move);
    setSyncDirtyReason('stock');
    S.movements.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const typeLabel = movementLabel(S.movType);
    showToast(`${typeLabel} — ${i18n('msg.save-success')}`, 'success');
    el('mov-qty').value  = '';
    el('mov-note').value = '';
    StockFeature.clearMovementForm();
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

  await StockStore.putItem(stockDbAdapter(), item);
  const idx = S.items.findIndex(it => it.articleNumber === article);
  if (idx >= 0) S.items[idx] = item; else S.items.push(item);
  setSyncDirtyReason('stock');

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
      await StockStore.deleteItem(stockDbAdapter(), articleNumber);
      await StockStore.deleteMovementsForArticle(stockDbAdapter(), S.movements, articleNumber);
      S.items     = S.items.filter(it => it.articleNumber !== articleNumber);
      S.movements = S.movements.filter(m  => m.articleNumber !== articleNumber);
      setSyncDirtyReason('stock');
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
    setSyncDirtyReason('colorado');
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
  const rows = StockStore.replayStockMovements(S.items, S.movements, Reports);
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
  showConfirm('Smazat tento pohyb skladu?', async () => {
    try {
      await StockStore.deleteMovementRemote(id, stockApiAdapter());
      await StockStore.deleteMovementLocal(stockDbAdapter(), id);
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
  el('fab-co-entry').addEventListener('click',  () => navigate('co-entry'));

  // Topbar
  el('nav-settings').addEventListener('click', () => navigate('settings'));

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
  document.querySelectorAll('.hist-tab').forEach(b =>
    b.addEventListener('click', () => { S.coHistMachine = b.dataset.machine; renderCoHistory(); }));

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
    if (S.postPurchaseLoaded && window.PrintGuardPostPurchaseUI && typeof window.PrintGuardPostPurchaseUI.renderPostPurchaseOrders === 'function') {
      window.PrintGuardPostPurchaseUI.renderPostPurchaseOrders();
    } else {
      loadPostPurchaseOrders(true);
    }
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
    if (!pin) { showToast(window.I18N ? window.I18N.t('processed.pin.enter') : 'Enter Processed Orders PIN', 'error'); return; }
    cfg.postPurchasePin = pin;
    if (el('postpurchase-pin')) el('postpurchase-pin').value = '';
    S.postPurchaseLoaded = false;
    showToast(window.I18N ? window.I18N.t('processed.toast.unlocked') : 'Processed orders unlocked', 'success');
    loadPostPurchaseOrders(true);
  });
  el('postpurchase-lock-btn')?.addEventListener('click', () => {
    cfg.postPurchasePin = '';
    S.postPurchaseLoaded = false;
    S.postPurchaseOrders = [];
    renderPostPurchaseAccessRequired();
    showToast(window.I18N ? window.I18N.t('processed.toast.locked') : 'Processed orders locked', 'success');
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
