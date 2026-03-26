/* ============================================================
   PrintGuard — app.js
   Správa skladu (příjem/výdej/inventura) + Colorado audit
   Vanilla JS · IndexedDB · Offline PWA
   ============================================================ */
'use strict';

const APP_VERSION = 'printguard-2.0.0';
const DB_NAME     = 'printguard-db';
const DB_VERSION  = 2;
const ST_ITEMS    = 'items';
const ST_MOVES    = 'movements';
const ST_CORECS   = 'co_records';
const ST_SETTINGS = 'settings';

// ── Config ─────────────────────────────────────────────────
const cfg = {
  get weeksN()      { return parseInt(ls('pg_weeks')   || '8', 10); },
  set weeksN(v)     { ls('pg_weeks', v); },
  get rollingN()    { return parseInt(ls('pg_rolling') || '8', 10); },
  set rollingN(v)   { ls('pg_rolling', v); },
  get inkCost()     { return parseFloat(ls('pg_ink_cost')   || '0'); },
  set inkCost(v)    { ls('pg_ink_cost', v); },
  get mediaCost()   { return parseFloat(ls('pg_media_cost') || '0'); },
  set mediaCost(v)  { ls('pg_media_cost', v); },
  get deviceId() {
    let id = ls('pg_device_id');
    if (!id) { id = 'pg-' + Math.random().toString(36).slice(2, 10); ls('pg_device_id', id); }
    return id;
  },
  get role() { return ls('pg_role') || 'operator'; },          // operator | admin
  set role(v) { ls('pg_role', v); },
  get adminPin() { return ls('pg_admin_pin') || '2026'; },    // default PIN (změň si)
  set adminPin(v) { ls('pg_admin_pin', v); },
};
function ls(k, v) {
  if (v !== undefined) { localStorage.setItem(k, String(v)); return v; }
  return localStorage.getItem(k);
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
  printLogLoading:  false,
  printLogLoaded:   false,
  printLogViewMode: 'raw',
  printLogGroupFilter: 'all',
  printLogExpandedGroups: {},
  syncRunning:      false,
  syncIntervalId:   null,
};

// ── IndexedDB ──────────────────────────────────────────────
let db;

function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(ST_ITEMS))
        d.createObjectStore(ST_ITEMS, { keyPath: 'articleNumber' });
      if (!d.objectStoreNames.contains(ST_MOVES)) {
        const m = d.createObjectStore(ST_MOVES, { keyPath: 'id' });
        m.createIndex('byArticle', 'articleNumber', { unique: false });
      }
      if (!d.objectStoreNames.contains(ST_CORECS)) {
        const c = d.createObjectStore(ST_CORECS, { keyPath: 'id' });
        c.createIndex('byMachine', 'machineId', { unique: false });
      }
      if (!d.objectStoreNames.contains(ST_SETTINGS))
        d.createObjectStore(ST_SETTINGS, { keyPath: 'key' });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbAll(store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = e => res(e.target.result || []);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbPut(store, obj) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}
function idbDelete(store, key) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}
function idbClear(store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror   = e => rej(e.target.error);
  });
}
function genId(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ── Settings IDB persistence ───────────────────────────────
async function saveSettingsToIDB() {
  await idbPut(ST_SETTINGS, {
    key:        'config',
    weeksN:     cfg.weeksN,
    rollingN:   cfg.rollingN,
    inkCost:    cfg.inkCost,
    mediaCost:  cfg.mediaCost,
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
  const moves = getMovements(item.articleNumber);

  // Find the latest stocktake as baseline
  let baseline = 0, baselineIdx = -1;
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].movType === 'stocktake') { baseline = moves[i].qty; baselineIdx = i; break; }
  }

  // Compute current on-hand from baseline onwards
  let onHand = baseline;
  const relevantMoves = baselineIdx >= 0 ? moves.slice(baselineIdx + 1) : moves;
  for (const m of relevantMoves) {
    if (m.movType === 'receipt')  onHand += m.qty;
    if (m.movType === 'issue')    onHand -= m.qty;
    if (m.movType === 'stocktake') onHand = m.qty;
  }
  onHand = Math.max(0, onHand);

  // Weekly consumption: sum issues in last N weeks
  const N = cfg.weeksN;
  const cutoff = new Date(Date.now() - N * 7 * 86400 * 1000);
  const recentIssues = S.movements
    .filter(m => m.articleNumber === item.articleNumber && m.movType === 'issue' && new Date(m.timestamp) >= cutoff);
  const totalIssued = recentIssues.reduce((s, m) => s + m.qty, 0);
  const avgWeekly   = totalIssued / N;

  const daysLeft = avgWeekly > 0 ? (onHand / avgWeekly) * 7 : (onHand > 0 ? 999 : 0);

  const leadTime = item.leadTimeDays || 0;
  const safety   = item.safetyDays   || 7;
  const minQty   = item.minQty       || 0;

  let status;
  if (minQty > 0) {
    status = onHand <= 0 ? 'crit' : onHand <= minQty ? 'crit' : onHand <= minQty * 2 ? 'warn' : 'ok';
  } else {
    status = onHand <= 0 || daysLeft <= 7 ? 'crit'
           : daysLeft <= (leadTime + safety)    ? 'warn'
           : 'ok';
  }

  return { onHand, avgWeekly, daysLeft: Math.round(daysLeft), status, moveCount: moves.length };
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
  el('alerts-nav-label').textContent = alertCount > 0 ? `Upozornění (${alertCount})` : 'Upozornění';

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
    const statusLbl = { ok: 'OK', warn: 'Varování', crit: 'Kritické' }[m.status];
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
          <span class="metric-mini-lbl">Na skladě</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val ${dClass}">${fmtDays(m.daysLeft)}</span>
          <span class="metric-mini-lbl">Zásoba na</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val">${m.avgWeekly > 0 ? fmtN(m.avgWeekly, 1) : '—'}</span>
          <span class="metric-mini-lbl">Týd. spotřeba</span>
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
  const statusLbl = { ok: 'OK', warn: 'Varování', crit: 'Kritické' }[m.status];

  el('detail-content').innerHTML = `
    <div class="detail-hero">
      <span class="badge ${m.status}" style="display:inline-block;margin-bottom:12px">${statusLbl}</span>
      <div>
        <span class="detail-big">${fmtN(m.onHand, 0)}</span>
        <span class="detail-unit">${esc(item.unit || 'ks')}</span>
      </div>
      <div class="detail-metrics-grid">
        <div class="dm-item"><span class="dm-val">${fmtDays(m.daysLeft)}</span><span class="dm-lbl">Zásoba na</span></div>
        <div class="dm-item"><span class="dm-val">${m.avgWeekly > 0 ? fmtN(m.avgWeekly, 1) : '—'}</span><span class="dm-lbl">Týd. spotřeba</span></div>
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
          <thead><tr><th>Datum</th><th>Typ</th><th>Množství</th><th>Stav po</th><th>Poznámka</th><th></th></tr></thead>
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
    const typeLabel = { receipt: '↑ Příjem', issue: '↓ Výdej', stocktake: '= Inventura' }[m.movType] || m.movType;
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
  const typeLabel = { receipt: '↑ Příjem', issue: '↓ Výdej', stocktake: '= Inventura' };
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
    <thead><tr><th>Datum</th><th>Typ</th><th>Změna</th><th>Stav po</th><th>Poznámka</th></tr></thead>
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
    await idbDelete(ST_MOVES, id);
    S.movements = S.movements.filter(m => m.id !== id);
    renderStockOverview();
    renderAlerts();
    renderStockLog();
    if (S.detailArticle) openStockDetail(S.detailArticle);
    showToast('Pohyb smazán');
  });
}

// ── Alerts ────────────────────────────────────────────────
function renderAlerts() {
  const alertItems = S.items
    .filter(it => it.isActive !== false && computeStock(it).status !== 'ok')
    .sort((a, b) => computeStock(a).daysLeft - computeStock(b).daysLeft);

  const list = el('alerts-list');
  if (!alertItems.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">✓</div><p>Žádná upozornění — vše v pořádku.</p></div>`;
    return;
  }
  list.innerHTML = alertItems.map(it => {
    const m = computeStock(it);
    const lbl = m.status === 'crit' ? 'Kritické' : 'Varování';
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
          <span class="metric-mini-lbl">Na skladě</span>
        </div>
        <div class="metric-mini">
          <span class="metric-mini-val ${m.status === 'crit' ? 'crit-c' : 'warn-c'}">${fmtDays(m.daysLeft)}</span>
          <span class="metric-mini-lbl">Zásoba na</span>
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
      resultsEl.innerHTML = matches.map(it => {
        const m = computeStock(it);
        return `<div class="dropdown-item" data-a="${esc(it.articleNumber)}">
          <span class="di-name">${esc(it.name || it.articleNumber)}</span>
          <span class="di-code">${esc(it.articleNumber)} · ${esc(it.unit || 'ks')}</span>
          <span class="di-stock">Na skladě: ${fmtN(m.onHand, 0)} ${esc(it.unit || 'ks')}</span>
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
  const statusLbl = { ok: 'OK ✓', warn: '⚠ Varování', crit: '🔴 Kritické' }[nm.status];
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
    await idbPut(ST_MOVES, move);
    S.movements.push(move);
    S.movements.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const typeLabel = { receipt: 'Příjem', issue: 'Výdej', stocktake: 'Inventura' }[S.movType];
    showToast(`${typeLabel} uložen`, 'success');
    el('mov-qty').value  = '';
    el('mov-note').value = '';
    clearMovItem();
    renderStockOverview();
    renderAlerts();
    navigate('stock-overview');
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
            <div class="mgmt-meta">${esc(it.articleNumber)} · ${esc(it.unit || 'ks')} · Na skladě: ${fmtN(m.onHand, 0)}</div>
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
    await idbDelete(ST_ITEMS, articleNumber);
    const toDelete = S.movements.filter(m => m.articleNumber === articleNumber);
    for (const m of toDelete) await idbDelete(ST_MOVES, m.id);
    S.items     = S.items.filter(it => it.articleNumber !== articleNumber);
    S.movements = S.movements.filter(m  => m.articleNumber !== articleNumber);
    renderItemsMgmt();
    renderStockOverview();
    renderAlerts();
    showToast('Položka smazána');
  });
}

// ══════════════════════════════════════════════════════════
//  COLORADO MODULE
// ══════════════════════════════════════════════════════════

const MACHINES = [
  { id: 'colorado1', label: 'Colorado 1' },
  { id: 'colorado2', label: 'Colorado 2' },
];

function getCoRecs(machineId) {
  return S.coRecords.filter(r => r.machineId === machineId)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

function computeCoIntervals(machineId) {
  const recs = getCoRecs(machineId);
  return recs.slice(1).map((cur, i) => {
    const prev = recs[i];
    const ms   = new Date(cur.timestamp) - new Date(prev.timestamp);
    const days = Math.max(ms / 86400000, 0.0001);
    const inkUsed   = Math.max(0, cur.inkTotalLiters - prev.inkTotalLiters);
    const mediaUsed = Math.max(0, cur.mediaTotalM2   - prev.mediaTotalM2);
    const inkPerM2  = mediaUsed > 0 ? inkUsed / mediaUsed : null;
    const inkCost   = inkUsed   * cfg.inkCost;
    const mediaCost = mediaUsed * cfg.mediaCost;
    const totalCost = inkCost + mediaCost;
    const costPerM2 = mediaUsed > 0 ? totalCost / mediaUsed : null;
    return {
      from: prev.timestamp, to: cur.timestamp, days, machineId,
      inkTotalTo: cur.inkTotalLiters, mediaTotalTo: cur.mediaTotalM2,
      inkUsed, mediaUsed,
      inkPerDay: inkUsed / days, mediaPerDay: mediaUsed / days,
      inkPerM2, inkCost, mediaCost, totalCost, costPerM2,
      recordId: cur.id,
    };
  });
}

function computeCoStats(machineId) {
  const ivs = computeCoIntervals(machineId);
  const N   = cfg.rollingN;
  const recent = ivs.slice(-N);
  if (!recent.length) return null;

  const avg = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
  const avgInkDay   = avg(recent.map(r => r.inkPerDay));
  const avgMediaDay = avg(recent.map(r => r.mediaPerDay));
  const validPM2    = recent.filter(r => r.inkPerM2 !== null);
  const avgInkPM2   = validPM2.length ? avg(validPM2.map(r => r.inkPerM2)) : null;
  const hasCosts    = cfg.inkCost > 0 || cfg.mediaCost > 0;
  const validCost   = recent.filter(r => r.costPerM2 !== null);
  const avgCostPM2  = hasCosts && validCost.length ? avg(validCost.map(r => r.costPerM2)) : null;

  const recs = getCoRecs(machineId);
  return {
    machineId, recordCount: recs.length, intervalCount: ivs.length,
    avgInkDay, avgInkMonth: avgInkDay * 30,
    avgMediaDay, avgMediaMonth: avgMediaDay * 30,
    avgInkPM2, avgCostPM2, hasCosts,
    last: recs[recs.length - 1],
  };
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
    wrap.innerHTML = `<div class="mc-header">
      <span class="mc-label">${esc(label)}</span>
      <span class="mc-badge">${recs.length} záznam${recs.length === 1 ? '' : 'ů'}</span>
    </div>
    <div class="mc-empty">
      Potřeba alespoň 2 záznamy pro výpočet spotřeby.
      ${recs.length === 1 ? `<br>Poslední: <strong>${fmtDT(recs[0].timestamp)}</strong> · Ink: ${fmtN(recs[0].inkTotalLiters, 2)} L · Médium: ${fmtN(recs[0].mediaTotalM2, 1)} m²` : ''}
    </div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="mc-header">
      <span class="mc-label">${esc(label)}</span>
      <span class="mc-badge">${s.recordCount} záznamů · ${s.intervalCount} intervalů</span>
    </div>
    <div class="metrics-grid">
      <div class="metric-block ink-bg">
        <span class="metric-big">${fmtN(s.avgInkDay, 3)}</span>
        <span class="metric-unit">L / den</span>
        <span class="metric-desc">Průměrná spotřeba inkoustu</span>
      </div>
      <div class="metric-block ink-bg">
        <span class="metric-big">${fmtN(s.avgInkMonth, 2)}</span>
        <span class="metric-unit">L / měsíc</span>
        <span class="metric-desc">Odhad měsíční spotřeby</span>
      </div>
      <div class="metric-block">
        <span class="metric-big">${fmtN(s.avgMediaDay, 1)}</span>
        <span class="metric-unit">m² / den</span>
        <span class="metric-desc">Průměrná spotřeba média</span>
      </div>
      <div class="metric-block">
        <span class="metric-big">${fmtN(s.avgMediaMonth, 0)}</span>
        <span class="metric-unit">m² / měsíc</span>
        <span class="metric-desc">Odhad měsíční spotřeby</span>
      </div>
      <div class="metric-block ink-bg">
        <span class="metric-big">${s.avgInkPM2 !== null ? fmtN(s.avgInkPM2, 4) : '—'}</span>
        <span class="metric-unit">L / m²</span>
        <span class="metric-desc">Spotřeba inkoustu na m²</span>
      </div>
      ${s.hasCosts && s.avgCostPM2 !== null ? `<div class="metric-block cost-bg">
        <span class="metric-big">${fmtN(s.avgCostPM2, 2)}</span>
        <span class="metric-unit">Kč / m²</span>
        <span class="metric-desc">Průměrný náklad na m²</span>
      </div>` : ''}
    </div>
    <div class="mc-last">
      Poslední záznam: <strong>${fmtDT(s.last.timestamp)}</strong> ·
      Ink celkem: <strong>${fmtN(s.last.inkTotalLiters, 2)} L</strong> ·
      Médium celkem: <strong>${fmtN(s.last.mediaTotalM2, 1)} m²</strong>
    </div>`;
}

function renderCombinedCard() {
  const wrap   = el('card-combined');
  if (!wrap) return;
  const valid  = MACHINES.map(m => computeCoStats(m.id)).filter(s => s && s.intervalCount > 0);
  if (!valid.length) {
    wrap.innerHTML = `<div class="mc-header"><span class="mc-label">Celkem — obě tiskárny</span></div><div class="mc-empty">Data nejsou k dispozici.</div>`;
    return;
  }
  const sum = (fn) => valid.reduce((s, v) => s + fn(v), 0);
  const inkMonth   = sum(v => v.avgInkMonth);
  const mediaMonth = sum(v => v.avgMediaMonth);
  const hasCosts   = cfg.inkCost > 0 || cfg.mediaCost > 0;
  const costMonth  = hasCosts ? inkMonth * cfg.inkCost + mediaMonth * cfg.mediaCost : null;

  wrap.innerHTML = `
    <div class="mc-header">
      <span class="mc-label">Celkem — obě tiskárny</span>
      <span class="mc-badge">kombinovaný přehled</span>
    </div>
    <div class="metrics-grid">
      <div class="metric-block ink-bg">
        <span class="metric-big">${fmtN(sum(v => v.avgInkDay), 3)}</span>
        <span class="metric-unit">L / den</span>
        <span class="metric-desc">Inkoust celkem</span>
      </div>
      <div class="metric-block ink-bg">
        <span class="metric-big">${fmtN(inkMonth, 2)}</span>
        <span class="metric-unit">L / měsíc</span>
        <span class="metric-desc">Inkoust celkem / měsíc</span>
      </div>
      <div class="metric-block">
        <span class="metric-big">${fmtN(sum(v => v.avgMediaDay), 1)}</span>
        <span class="metric-unit">m² / den</span>
        <span class="metric-desc">Médium celkem</span>
      </div>
      <div class="metric-block">
        <span class="metric-big">${fmtN(mediaMonth, 0)}</span>
        <span class="metric-unit">m² / měsíc</span>
        <span class="metric-desc">Médium celkem / měsíc</span>
      </div>
      ${hasCosts && costMonth !== null ? `<div class="metric-block cost-bg">
        <span class="metric-big">${fmtN(costMonth, 0)}</span>
        <span class="metric-unit">Kč / měsíc</span>
        <span class="metric-desc">Odhadované celkové náklady</span>
      </div>` : ''}
    </div>`;
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
    showToast('Záznam Colorado uložen', 'success');
    el('co-ink').value        = '';
    el('co-media').value      = '';
    el('co-note').value       = '';
    el('co-timestamp').value  = toLocalDT(new Date().toISOString());
    el('co-preview').classList.add('hidden');
    renderCoDashboard();
    renderCoHistory();
    navigate('co-dashboard');
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
      <td class="num delta">${iv ? '+' + fmtN(iv.inkUsed, 3) : '—'}</td>
      <td class="num delta">${iv ? '+' + fmtN(iv.mediaUsed, 1) : '—'}</td>
      <td class="num">${iv && iv.inkPerM2 !== null ? fmtN(iv.inkPerM2, 4) : '—'}</td>
      ${hasCosts ? `<td class="num">${iv && iv.costPerM2 !== null ? fmtN(iv.costPerM2, 2) : '—'}</td>` : ''}
      <td class="note-td">${esc(rec.note || '—')}</td>
      <td><button class="btn-del admin-only" data-id="${esc(rec.id)}" title="Smazat (jen admin)">✕</button></td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Datum a čas</th>
      <th>Ink celkem (L)</th>
      <th>Médium celkem (m²)</th>
      <th>Δ Ink (L)</th>
      <th>Δ Médium (m²)</th>
      <th>L / m²</th>
      ${hasCosts ? '<th>Kč / m²</th>' : ''}
      <th>Poznámka</th>
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
    await idbDelete(ST_CORECS, id);
    S.coRecords = S.coRecords.filter(r => r.id !== id);
    renderCoDashboard();
    renderCoHistory();
    showToast('Záznam smazán');
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

function getPrintLogParams() {
  const params = new URLSearchParams();
  if (S.printLogDateFrom) params.set('from', S.printLogDateFrom);
  if (S.printLogDateTo)   params.set('to', S.printLogDateTo);
  if (S.printLogPrinter !== 'all') params.set('printer', S.printLogPrinter);
  if (S.printLogResult !== 'all')  params.set('result', S.printLogResult);
  params.set('limit', String(PRINT_LOG_PAGE_SIZE));
  params.set('offset', String(S.printLogOffset));
  return params;
}

async function fetchPrintLogSummary() {
  const res = await fetch('/.netlify/functions/print-log-summary?' + getPrintLogParams().toString(), { cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Print log summary failed');
  return j;
}

async function fetchPrintLogRows() {
  const res = await fetch('/.netlify/functions/print-log-rows?' + getPrintLogParams().toString(), { cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Print log rows failed');
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
    all: 'Všechny skupiny průběhu',
    open_issue: 'Pouze otevřené problémy',
    resolved_after_retry: 'Pouze vyřešené opakováním',
    multiple_attempts: 'Pouze vícenásobné pokusy',
    first_pass: 'Pouze úspěch napoprvé',
  })[filter] || 'Všechny skupiny průběhu';
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
    case 'success_first_try': return 'Dokončeno napoprvé';
    case 'resolved_after_retry': return attempts > 2 ? `${attempts} pokusů před úspěchem` : 'Vyřešeno po opakování';
    case 'open_issue': return 'Stále nevyřešeno';
    case 'deleted_only': return 'Pouze smazané pokusy';
    case 'aborted_only': return 'Pouze přerušené pokusy';
    case 'multiple_attempts_success': return `${attempts} úspěšných pokusů v záznamu`;
    default: return 'Smíšený průběh úlohy';
  }
}

function printLifecycleBadgeLabel(status) {
  return ({
    success_first_try: 'Napoprvé',
    resolved_after_retry: 'Vyřešeno opakováním',
    open_issue: 'Otevřený problém',
    deleted_only: 'Jen smazáno',
    aborted_only: 'Jen přerušeno',
    multiple_attempts_success: 'Více úspěchů',
    unresolved: 'Nevyřešeno',
  })[status] || status;
}

function printLifecycleFinalResult(group) {
  const latest = group.attempts[group.attempts.length - 1];
  const norm = normalizePrintLogResult(latest?.result);
  if (norm === 'done') return 'Hotovo';
  if (norm === 'deleted') return 'Smazáno';
  if (norm === 'abrt') return 'Abrt';
  return latest?.result || '—';
}

function buildPrintLifecycleGroups(rows) {
  const sorted = [...rows].sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));
  const groups = [];
  const buckets = new Map();

  for (const row of sorted) {
    const jobKey = normalizePrintLogText(row.jobName);
    const sourceKey = normalizePrintLogSourceFile(row.sourceFile);
    const baseKey = [
      row.printerName || '',
      normalizePrintLogText(row.mediaType),
      sourceKey || jobKey,
      jobKey || sourceKey || 'unknown'
    ].join('||');

    const readyMs = new Date(row.readyAt).getTime();
    const bucket = buckets.get(baseKey) || [];
    let group = bucket[bucket.length - 1];
    if (!group || !Number.isFinite(readyMs) || !Number.isFinite(group.lastReadyMs) || (readyMs - group.lastReadyMs) > PRINT_LOG_LIFECYCLE_GAP_MS) {
      group = {
        id: `${baseKey}__${readyMs || Date.now()}__${groups.length}`,
        baseKey,
        attempts: [],
        firstReadyMs: readyMs,
        lastReadyMs: readyMs,
        printerName: row.printerName || '',
        mediaType: row.mediaType || '',
        sourceFile: row.sourceFile || '',
        jobName: row.jobName || '',
      };
      groups.push(group);
      bucket.push(group);
      buckets.set(baseKey, bucket);
    }

    group.attempts.push(row);
    group.lastReadyMs = readyMs;
    group.jobName = group.jobName || row.jobName || '';
    group.sourceFile = group.sourceFile || row.sourceFile || '';
  }

  return groups.map(group => {
    const attempts = group.attempts.sort((a, b) => new Date(a.readyAt) - new Date(b.readyAt));
    const latest = attempts[attempts.length - 1] || {};
    const successfulAttempts = attempts.filter(a => normalizePrintLogResult(a.result) === 'done');
    const lifecycleStatus = derivePrintLifecycleStatus(attempts);
    const finalArea = successfulAttempts.length ? successfulAttempts[successfulAttempts.length - 1].printedAreaM2 : latest.printedAreaM2;
    return {
      id: group.id,
      attempts,
      attemptCount: attempts.length,
      latestReadyAt: latest.readyAt || null,
      printerName: latest.printerName || group.printerName,
      jobName: latest.jobName || group.jobName,
      mediaType: latest.mediaType || group.mediaType,
      sourceFile: latest.sourceFile || group.sourceFile,
      lifecycleStatus,
      finalResult: printLifecycleFinalResult({ attempts }),
      finalPrintedAreaM2: finalArea == null ? null : Number(finalArea),
      totalPrintedAreaM2: attempts.reduce((sum, a) => sum + (Number(a.printedAreaM2) || 0), 0),
      mediaLengthM: attempts.reduce((sum, a) => sum + (Number(a.mediaLengthM) || 0), 0),
      totalDurationSec: attempts.reduce((sum, a) => sum + (Number(a.durationSec) || 0), 0),
      explanation: '',
      isSuccessful: normalizePrintLogResult(latest.result) === 'done',
    };
  }).map(group => ({ ...group, explanation: printLifecycleExplanation(group) }))
    .sort((a, b) => new Date(b.latestReadyAt) - new Date(a.latestReadyAt));
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
  const groups = getPrintLogLifecycleGroups();
  const successful = groups.filter(g => g.isSuccessful);
  const firstPass = groups.filter(g => g.lifecycleStatus === 'success_first_try');
  const resolvedRetries = groups.filter(g => g.lifecycleStatus === 'resolved_after_retry');
  const unresolved = groups.filter(g => ['open_issue', 'deleted_only', 'aborted_only', 'unresolved'].includes(g.lifecycleStatus));
  const avgAttempts = groups.length ? groups.reduce((sum, g) => sum + g.attemptCount, 0) / groups.length : 0;
  const avgAttemptsSuccess = successful.length ? successful.reduce((sum, g) => sum + g.attemptCount, 0) / successful.length : 0;
  return {
    totalGroups: groups.length,
    firstPassCount: firstPass.length,
    firstPassRate: groups.length ? (firstPass.length / groups.length) * 100 : 0,
    resolvedAfterRetryCount: resolvedRetries.length,
    unresolvedCount: unresolved.length,
    avgAttempts,
    avgAttemptsSuccess,
  };
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
  elSet('print-log-status', 'Načítám…');
  const wrap = el('print-log-table-wrap');
  if (wrap && !S.printLogRows.length) {
    wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Načítám tiskový log…</p></div>`;
  }

  try {
    const [summary, rows] = await Promise.all([fetchPrintLogSummary(), fetchPrintLogRows()]);
    S.printLogSummary = summary.summary || null;
    const newRows = Array.isArray(rows.rows) ? rows.rows.map(normalizePrintLogRow) : [];
    S.printLogRows = [...S.printLogRows, ...newRows];
    S.printLogOffset += newRows.length;
    S.printLogHasMore = Boolean(rows.hasMore);
    S.printLogLoaded = true;
    renderPrintLog();
    elSet('print-log-status', summary.generatedAt ? `Aktualizováno ${fmtDT(summary.generatedAt)}` : 'Data ze serveru');
  } catch (err) {
    if (wrap) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>Nepodařilo se načíst tiskový log.</p><div class="table-empty-note">${esc(err.message || err)}</div></div>`;
    }
    elSet('print-log-status', 'Chyba načítání');
    showToast('Tiskový log: ' + (err.message || err), 'error');
  } finally {
    S.printLogLoading = false;
  }
}

function renderPrintLog() {
  renderPrintLogSummary();
  renderPrintLogComparison();
  renderPrintLogRows();
}

function renderPrintLogSummary() {
  const summary = S.printLogSummary || {};
  const lifecycle = getPrintLogLifecycleMetrics();
  elSet('pl-done-jobs', fmtInt(summary.doneJobs));
  elSet('pl-aborted-jobs', fmtInt(summary.abortedJobs));
  elSet('pl-deleted-jobs', fmtInt(summary.deletedJobs));
  elSet('pl-printed-area', fmtMeasure(summary.printedAreaM2, 'm²', 2));
  elSet('pl-media-length', fmtMeasure(summary.mediaLengthM, 'm', 2));
  elSet('pl-duration', fmtDuration(summary.totalDurationSec));
  elSet('pl-sla-total', fmtInt(lifecycle.totalGroups));
  elSet('pl-sla-first-pass', fmtInt(lifecycle.firstPassCount));
  elSet('pl-sla-first-rate', `${fmtN(lifecycle.firstPassRate, 1)} %`);
  elSet('pl-sla-resolved', fmtInt(lifecycle.resolvedAfterRetryCount));
  elSet('pl-sla-open', fmtInt(lifecycle.unresolvedCount));
  elSet('pl-sla-attempts', fmtN(lifecycle.avgAttempts, 2));
  elSet('pl-sla-attempts-success', fmtN(lifecycle.avgAttemptsSuccess, 2));
  elSet('pl-compare-range', printLogRangeLabel());
}

function renderPrintLogComparison() {
  const compare = S.printLogSummary?.byPrinter || {};
  const printers = Object.keys(compare);
  const grid = el('pl-compare-grid');
  if (!grid) return;
  grid.innerHTML = printers.map(name => {
    const rec = compare[name] || {};
    const displayName = mapPrinterName(name);
    return `<div class="metric-block">
      <span class="metric-big">${fmtInt(rec.doneJobs || 0)}</span>
      <span class="metric-unit">${esc(displayName)}</span>
      <span class="metric-desc">Hotovo · ${fmtMeasure(rec.printedAreaM2 || 0, 'm²', 2)} · ${fmtMeasure(rec.mediaLengthM || 0, 'm', 2)}</span>
    </div>`;
  }).join('');
}

function renderPrintLogRows() {
  const wrap = el('print-log-table-wrap');
  const foot = el('print-log-footnote');
  if (!wrap) return;
  if (S.printLogViewMode === 'grouped') return renderPrintLifecycleGroups(wrap, foot);
  if (!S.printLogRows.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné tiskové úlohy neodpovídají filtru.</p></div>`;
    if (foot) foot.textContent = '0 řádků';
    return;
  }

  const rows = S.printLogRows.map(row => `<tr>
    <td>${fmtDT(row.readyAt)}</td>
    <td>${esc(mapPrinterName(row.printerName))}</td>
    <td>${esc(row.jobName || '—')}</td>
    <td><span class="result-badge ${printResultClass(row.result)}">${esc(printResultLabel(row.result))}</span></td>
    <td>${esc(row.mediaType || '—')}</td>
    <td class="num">${fmtMeasure(row.printedAreaM2, 'm²', 2)}</td>
    <td class="num">${fmtDurationSeconds(row.durationSec)}</td>
  </tr>`).join('');

  const loadMoreBtn = S.printLogHasMore ? `<div class="print-log-load-more-wrap"><button id="pl-load-more" class="print-log-load-more">Načíst další záznamy</button></div>` : '';

  wrap.innerHTML = `<table class="data-table">
    <thead><tr>
      <th>Čas připravení</th>
      <th>Tiskárna</th>
      <th>Úloha</th>
      <th>Výsledek</th>
      <th>Médium</th>
      <th>Tištěná plocha</th>
      <th>Doba tisku</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${loadMoreBtn}`;

  if (foot) foot.textContent = `Celkem ${S.printLogRows.length} řádků`;
}

function renderPrintLifecycleGroups(wrap, foot) {
  const groups = getFilteredLifecycleGroups();
  if (!groups.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🧩</div><p>Žádné skupiny průběhu neodpovídají filtru.</p></div>`;
    if (foot) foot.textContent = lifecycleFilterLabel(S.printLogGroupFilter);
    return;
  }

  const rows = groups.map(group => {
    const expanded = !!S.printLogExpandedGroups[group.id];
    const detailRows = group.attempts.map(attempt => `<tr>
      <td>${fmtDT(attempt.readyAt)}</td>
      <td><span class="result-badge ${printResultClass(attempt.result)}">${esc(printResultLabel(attempt.result))}</span></td>
      <td class="num">${fmtDurationSeconds(attempt.durationSec)}</td>
      <td class="num">${fmtMeasure(attempt.printedAreaM2, 'm²', 2)}</td>
      <td>${esc(attempt.mediaType || '—')}</td>
    </tr>`).join('');
    return `<tbody class="pl-group-body ${expanded ? 'expanded' : ''}">
      <tr class="pl-group-row" data-group-id="${esc(group.id)}">
        <td>${fmtDT(group.latestReadyAt)}</td>
        <td>${esc(mapPrinterName(group.printerName))}</td>
        <td>${esc(group.jobName || '—')}<div class="pl-subline">${esc(group.explanation)}</div></td>
        <td><span class="result-badge lifecycle ${group.lifecycleStatus}">${esc(printLifecycleBadgeLabel(group.lifecycleStatus))}</span></td>
        <td class="num">${fmtInt(group.attemptCount)}</td>
        <td>${esc(group.finalResult)}</td>
        <td class="num">${fmtMeasure(group.finalPrintedAreaM2, 'm²', 2)}</td>
        <td>${esc(group.mediaType || '—')}</td>
      </tr>
      <tr class="pl-group-detail-row ${expanded ? '' : 'hidden'}">
        <td colspan="8">
          <div class="pl-group-detail">
            <div class="pl-detail-head">
              <strong>${esc(group.explanation)}</strong>
              <span>${group.attemptCount} pokusů · ${fmtDuration(group.totalDurationSec)} · ${fmtMeasure(group.totalPrintedAreaM2, 'm²', 2)}</span>
            </div>
            <table class="data-table pl-detail-table">
              <thead><tr><th>Čas</th><th>Výsledek</th><th>Doba</th><th>Tištěná plocha</th><th>Médium</th></tr></thead>
              <tbody>${detailRows}</tbody>
            </table>
          </div>
        </td>
      </tr>
    </tbody>`;
  }).join('');

  const loadMoreBtn = S.printLogHasMore ? `<div class="print-log-load-more-wrap"><button id="pl-load-more" class="print-log-load-more">Načíst další záznamy</button></div>` : '';
    wrap.innerHTML = `<table class="data-table pl-group-table">
      <thead><tr><th>Poslední pokus</th><th>Tiskárna</th><th>Úloha</th><th>Stav</th><th>Pokusy</th><th>Finální výsledek</th><th>Finální plocha</th><th>Médium</th></tr></thead>
      ${rows}
    </table>${loadMoreBtn}`;

  if (foot) foot.textContent = `${groups.length} skupin průběhu · ${lifecycleFilterLabel(S.printLogGroupFilter)}${S.printLogHasMore ? ' · z načtených dat' : ''}`;
}

function printLogRangeLabel() {
  if (S.printLogDateFrom || S.printLogDateTo) {
    return `${S.printLogDateFrom || '…'} → ${S.printLogDateTo || '…'}`;
  }
  return 'celé dostupné období';
}

function printResultClass(result) {
  const norm = String(result || '').toLowerCase();
  if (norm === 'done') return 'done';
  if (norm === 'abrt' || norm === 'aborted') return 'abrt';
  if (norm === 'deleted') return 'deleted';
  return '';
}

function printResultLabel(result) {
  const norm = String(result || '').trim().toLowerCase();
  if (norm === 'done') return 'Hotovo';
  if (norm === 'abrt' || norm === 'aborted') return 'Přerušeno';
  if (norm === 'deleted') return 'Smazáno';
  return result || '—';
}

function fmtInt(n) {
  if (n === null || n === undefined || isNaN(n)) return '0';
  return String(Math.round(Number(n)));
}

function fmtMeasure(n, unit, dec = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return `${Number(n).toFixed(dec)} ${unit}`;
}

function fmtDuration(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

function fmtDurationSeconds(totalSec) {
  const sec = Math.max(0, Number(totalSec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// ══════════════════════════════════════════════════════════
//  SETTINGS + EXPORT / IMPORT
// ══════════════════════════════════════════════════════════

function loadSettingsUI() {
  el('cfg-weeks').value      = cfg.weeksN;
  el('cfg-n').value          = cfg.rollingN;
  el('cfg-ink-cost').value   = cfg.inkCost   || '';
  el('cfg-media-cost').value = cfg.mediaCost || '';
  el('device-id-display').textContent  = cfg.deviceId;
  el('app-version-display').textContent = APP_VERSION;
}

function setupSettings() {
  el('save-settings-btn').addEventListener('click', async () => {
    cfg.weeksN    = parseInt(el('cfg-weeks').value, 10)      || 8;
    cfg.rollingN  = parseInt(el('cfg-n').value,     10)      || 8;
    cfg.inkCost   = parseFloat(el('cfg-ink-cost').value)   || 0;
    cfg.mediaCost = parseFloat(el('cfg-media-cost').value) || 0;
    await saveSettingsToIDB();
    renderStockOverview();
    renderCoDashboard();
    renderCoHistory();
    showToast('Nastavení uloženo', 'success');
  });

  el('export-csv-intervals').addEventListener('click', exportCSVIntervals);
  el('export-csv-raw-co').addEventListener('click',    exportCSVRawCo);
  el('export-csv-stock').addEventListener('click',     exportCSVStock);
  el('export-csv-stock-levels').addEventListener('click', exportCSVStockLevels);
  el('export-json').addEventListener('click',          exportJSON);
  el('import-json-btn').addEventListener('click', ()  => el('import-json-input').click());
  el('import-json-input').addEventListener('change',   handleImportJSON);

  el('clear-all-btn').addEventListener('click', () => {
    showConfirm('Smazat VŠECHNA lokální data? Tato akce je nevratná.', async () => {
      await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS), idbClear(ST_SETTINGS)]);
      S.items = []; S.movements = []; S.coRecords = [];
      renderStockOverview(); renderAlerts(); renderItemsMgmt();
      renderCoDashboard(); renderCoHistory();
      showToast('Data smazána');
    });
  });
}

// ── CSV helpers ──────────────────────────────────────────
function csvEsc(v) {
  const s = String(v === null || v === undefined ? '' : v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r'))
    return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function csvRow(arr) { return arr.map(csvEsc).join(','); }
function fmtFileDT() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
}

function exportCSVIntervals() {
  const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
  const header = ['timestamp_from','timestamp_to','days_elapsed','machine',
    'ink_total_l_to','media_total_m2_to','ink_used_l','media_used_m2',
    'ink_per_m2','ink_cost','media_cost','total_cost','cost_per_m2'];
  const rows = [csvRow(header)];
  MACHINES.forEach(({ id }) => {
    computeCoIntervals(id).forEach(iv => {
      rows.push(csvRow([
        iv.from, iv.to, fmtN(iv.days,2), id,
        fmtN(iv.inkTotalTo,3), fmtN(iv.mediaTotalTo,1),
        fmtN(iv.inkUsed,3), fmtN(iv.mediaUsed,1),
        iv.inkPerM2 !== null ? fmtN(iv.inkPerM2,6) : '',
        hasCosts ? fmtN(iv.inkCost,2) : '',
        hasCosts ? fmtN(iv.mediaCost,2) : '',
        hasCosts ? fmtN(iv.totalCost,2) : '',
        iv.costPerM2 !== null ? fmtN(iv.costPerM2,4) : '',
      ]));
    });
  });
  dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `co_intervals_${fmtFileDT()}.csv`);
}

function exportCSVRawCo() {
  const header = ['id','machine','timestamp','ink_total_l','media_total_m2','note','created_at'];
  const rows = [csvRow(header)];
  [...S.coRecords].sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp)).forEach(r => {
    rows.push(csvRow([r.id, r.machineId, r.timestamp, r.inkTotalLiters, r.mediaTotalM2, r.note||'', r.createdAt||'']));
  });
  dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `co_raw_${fmtFileDT()}.csv`);
}

function exportCSVStock() {
  const header = ['timestamp','article_number','name','movement_type','qty','unit','stock_after','note'];
  const rows = [csvRow(header)];
  // replay per item to get stock_after
  const itemMap = {};
  S.items.forEach(it => { itemMap[it.articleNumber] = it; });
  const byArticle = {};
  S.movements.forEach(m => {
    if (!byArticle[m.articleNumber]) byArticle[m.articleNumber] = [];
    byArticle[m.articleNumber].push(m);
  });
  // build sorted output
  [...S.movements].sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp)).forEach(m => {
    const it = itemMap[m.articleNumber] || {};
    const artMoves = (byArticle[m.articleNumber] || []).sort((a,b) => new Date(a.timestamp)-new Date(b.timestamp));
    let running = 0;
    for (const mm of artMoves) {
      if (mm.movType === 'stocktake') running = mm.qty;
      else if (mm.movType === 'receipt') running += mm.qty;
      else if (mm.movType === 'issue') running = Math.max(0, running - mm.qty);
      if (mm.id === m.id) break;
    }
    rows.push(csvRow([m.timestamp, m.articleNumber, it.name||'', m.movType, m.qty, it.unit||'ks', running, m.note||'']));
  });
  dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `stock_movements_${fmtFileDT()}.csv`);
}

function exportCSVStockLevels() {
  const exported_at = new Date().toISOString();
  const header = ['exported_at','article_number','name','category','unit','on_hand',
    'avg_weekly_issue','days_left','status','min_qty','lead_time_days','safety_days'];
  const rows = [csvRow(header)];
  S.items.filter(it => it.isActive !== false).forEach(it => {
    const m = computeStock(it);
    rows.push(csvRow([
      exported_at, it.articleNumber, it.name||'', it.category||'', it.unit||'ks',
      fmtN(m.onHand,0), m.avgWeekly > 0 ? fmtN(m.avgWeekly,3) : '0',
      m.daysLeft >= 999 ? '' : m.daysLeft, m.status,
      it.minQty||0, it.leadTimeDays||0, it.safetyDays||0,
    ]));
  });
  dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `stock_levels_${fmtFileDT()}.csv`);
}

async function exportJSON() {
  const data = {
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    items:      S.items,
    movements:  S.movements,
    coRecords:  S.coRecords,
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

  showConfirm(`Importovat ${items.length} položek, ${movements.length} pohybů, ${coRecords.length} CO záznamů? Existující data budou přepsána.`, async () => {
    await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS)]);
    for (const it of items) await idbPut(ST_ITEMS, it);
    for (const m  of movements) await idbPut(ST_MOVES, m);
    for (const r  of coRecords) await idbPut(ST_CORECS, r);
    await loadAll();
    showToast(`Import hotov: ${items.length} pol., ${movements.length} poh.`, 'success');
  });
}

function dlBlob(content, type, filename) {
  const blob = new Blob(['\ufeff' + content], { type });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
}

// ── Date range helper ────────────────────────────────────
function dateRangeFilter(timestamp, from, to) {
  if (!from && !to) return true;
  const t = new Date(timestamp);
  if (from && t < new Date(from + 'T00:00:00')) return false;
  if (to   && t > new Date(to   + 'T23:59:59')) return false;
  return true;
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
  const itemMap = {};
  S.items.forEach(it => { itemMap[it.articleNumber] = it; });

  // replay running stock per article
  const runningMap = {};
  const enriched = S.movements.map(m => {
    const r = runningMap[m.articleNumber] ?? 0;
    let after;
    if (m.movType === 'stocktake') after = m.qty;
    else if (m.movType === 'receipt') after = r + m.qty;
    else after = Math.max(0, r - m.qty);
    runningMap[m.articleNumber] = after;
    return { ...m, stockAfter: after, itemName: itemMap[m.articleNumber]?.name || m.articleNumber, unit: itemMap[m.articleNumber]?.unit || 'ks' };
  });

  // filter
  const q = S.logSearch.toLowerCase();
  const filtered = enriched.filter(m => {
    const matchType = S.logFilter === 'all' || m.movType === S.logFilter;
    const matchQ = !q
      || m.articleNumber.toLowerCase().includes(q)
      || m.itemName.toLowerCase().includes(q)
      || (m.note || '').toLowerCase().includes(q);
    const matchDate = dateRangeFilter(m.timestamp, S.logDateFrom, S.logDateTo);
    return matchType && matchQ && matchDate;
  });

  const wrap = el('stock-log-wrap');
  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné pohyby neodpovídají filtru.</p></div>`;
    return;
  }

  const typeLabel = { receipt: '↑ Příjem', issue: '↓ Výdej', stocktake: '= Inventura' };
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
      <th>Datum</th><th>Položka</th><th>Typ</th><th>Změna</th><th>Stav po</th><th>Poznámka</th><th></th>
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
  const itemMap = {};
  S.items.forEach(it => { itemMap[it.articleNumber] = it; });
  const runningMap = {};
  const header = ['timestamp','article_number','name','category','unit','movement_type','qty','stock_after','note'];
  const rows = [csvRow(header)];
  S.movements.forEach(m => {
    const it = itemMap[m.articleNumber] || {};
    const r = runningMap[m.articleNumber] ?? 0;
    let after;
    if (m.movType === 'stocktake') after = m.qty;
    else if (m.movType === 'receipt') after = r + m.qty;
    else after = Math.max(0, r - m.qty);
    runningMap[m.articleNumber] = after;
    rows.push(csvRow([
      m.timestamp, m.articleNumber, it.name||'', it.category||'', it.unit||'ks',
      m.movType, m.qty, after, m.note||''
    ]));
  });
  dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `pohyby_skladu_${fmtFileDT()}.csv`);
}

// ══════════════════════════════════════════════════════════
//  NAVIGATION + MODE
// ══════════════════════════════════════════════════════════

function navigate(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el('screen-' + screenId)?.classList.add('active');

  // vždycky přepni active podle data-screen (napříč oběma navy)
  document.querySelectorAll('#stock-nav .nav-item, #colorado-nav .nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.screen === screenId)
  );

  if (screenId === 'stock-alerts')  renderAlerts();
  if (screenId === 'stock-items')   renderItemsMgmt();
  if (screenId === 'stock-log')     renderStockLog();
  if (screenId === 'co-history')    renderCoHistory();
  if (screenId === 'print-log')     loadPrintLog();
  if (screenId === 'settings')      loadSettingsUI();

  window.scrollTo(0, 0);
  applyRoleUI(); // ✅ IMPORTANT
}

function setMode(mode) {
  S.mode = mode;
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.mode === mode));
  el('stock-nav').classList.toggle('hidden', mode !== 'stock');
  el('colorado-nav').classList.toggle('hidden', mode !== 'colorado');
  navigate(mode === 'stock' ? 'stock-overview' : 'co-dashboard');
}

// ══════════════════════════════════════════════════════════
//  UTILITIES
// ══════════════════════════════════════════════════════════

function isAdmin() { return cfg.role === 'admin'; }

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
        savedAt:   new Date().toISOString(),
      }],
    })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud push failed');
  return j;
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

    const dropped = badItems.length + badMoves.length + badCo.length;
    if (!silent) {
      showToast(
        `Sync OK · items:${pushRes?.upserted?.items ?? 0} · moves:${pushRes?.upserted?.movements ?? 0} · co:${pushRes?.upserted?.coRecords ?? 0}` +
        (dropped ? ` · zahoz.:${dropped}` : ''),
        dropped ? 'warn' : 'success'
      );
    }
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
  if (navigator.onLine) {
    runSync({ silent: true });
  }

  window.addEventListener('online', () => {
    updateOfflineBanner();
    runSync({ silent: true });
  });

  if (S.syncIntervalId) clearInterval(S.syncIntervalId);
  S.syncIntervalId = setInterval(() => {
    if (!navigator.onLine || document.visibilityState !== 'visible') return;
    runSync({ silent: true });
  }, 5 * 60 * 1000);
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

function el(id)   { return document.getElementById(id); }
function elSet(id, v) { const e = el(id); if (e) e.textContent = String(v); }
function esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtN(n, dec = 1) {
  if (n === null || n === undefined || isNaN(n)) return '—';
  return Number(n).toFixed(dec);
}
function fmtDays(d) {
  if (d >= 999) return '∞';
  if (d <= 0)   return '0 dní';
  if (d < 14)   return `${Math.round(d)} dní`;
  if (d < 60)   return `${Math.round(d / 7)} týdnů`;
  return `${Math.round(d / 30)} měs.`;
}
function fmtDT(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('cs-CZ', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}
function toLocalDT(iso) {
  const d = new Date(iso);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
function toISOfromDT(v) { return v ? new Date(v).toISOString() : new Date().toISOString(); }
function ds() { return new Date().toISOString().slice(0, 10); }

let toastTimer;
function showToast(msg, type = '') {
  const t = el('toast');
  if (!t) return;
  t.classList.remove('hidden');
  t.textContent = msg;
  t.className   = 'toast' + (type ? ' ' + type : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}

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
  db = await openDB();

  // Mode toggle
  document.querySelectorAll('.mode-btn').forEach(b =>
    b.addEventListener('click', () => setMode(b.dataset.mode)));

  // Bottom navs
  document.querySelectorAll('#stock-nav .nav-item, #colorado-nav .nav-item').forEach(b =>
    b.addEventListener('click', () => navigate(b.dataset.screen)));

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
  setupSettings();

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
    if (pin !== cfg.adminPin) { showToast('Špatný PIN', 'error'); return; }
    cfg.role = 'admin';
    if (el('admin-pin')) el('admin-pin').value = '';
    applyRoleUI();
    showToast('Admin režim odemčen', 'success');
  });

  el('admin-lock-btn')?.addEventListener('click', () => {
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

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('[SW]', e));
  }

  // URL params
  const p = new URLSearchParams(location.search);
  if (p.get('mode'))   setMode(p.get('mode'));
  if (p.get('screen')) navigate(p.get('screen'));
  applyRoleUI();
}

function updateOfflineBanner() {
  el('offline-banner')?.classList.toggle('hidden', navigator.onLine);
}

document.addEventListener('DOMContentLoaded', init);
