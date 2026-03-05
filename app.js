/* ============================================================
   PrintGuard — app.js
   Správa skladu (příjem/výdej/inventura) + Colorado audit
   Vanilla JS · IndexedDB · Offline PWA
   ============================================================ */
'use strict';

const APP_VERSION = 'printguard-2.0.0';
const DB_NAME     = 'printguard-db';
const DB_VERSION  = 1;
const ST_ITEMS    = 'items';
const ST_MOVES    = 'movements';   // stock movements (receipt/issue/stocktake)
const ST_CORECS   = 'co_records';  // colorado lifetime counter records

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
  editingItem:   null,   // null=new, or item object when editing
  movType:       'issue', // current selected movement type
  movItem:       null,   // currently selected item for movement
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

// ── Load all data ──────────────────────────────────────────
async function loadAll() {
  S.items     = await idbAll(ST_ITEMS);
  S.movements = (await idbAll(ST_MOVES)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  S.coRecords = (await idbAll(ST_CORECS)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

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
    </div>

    <div class="detail-section">
      <div class="detail-section-head">
        <div class="detail-section-title">Historie pohybů</div>
        <button class="btn-sm" id="detail-add-mov-btn">+ Nový pohyb</button>
      </div>
      <div class="table-wrap" style="margin-top:10px">
        ${moves.length ? `<table class="data-table">
          <thead><tr><th>Datum</th><th>Typ</th><th>Množství</th><th>Stav po</th><th>Poznámka</th><th></th></tr></thead>
          <tbody>${buildMovementRows(item, moves)}</tbody>
        </table>` : '<div class="empty-state" style="padding:18px 0"><p>Žádné pohyby. Přidejte příjem nebo inventuru.</p></div>'}
      </div>
    </div>`;

  el('detail-add-mov-btn')?.addEventListener('click', () => {
    S.movItem = item;
    prefillMovItem(item);
    navigate('stock-movement');
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
  const rows = [...recs].reverse().slice(0, 50).map(rec => {
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
      <td><button class="btn-del" data-id="${esc(rec.id)}" title="Smazat">✕</button></td>
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
  showConfirm('Smazat tento záznam Colorado?', async () => {
    await idbDelete(ST_CORECS, id);
    S.coRecords = S.coRecords.filter(r => r.id !== id);
    renderCoDashboard();
    renderCoHistory();
    showToast('Záznam smazán');
  });
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
  el('save-settings-btn').addEventListener('click', () => {
    cfg.weeksN    = parseInt(el('cfg-weeks').value, 10)      || 8;
    cfg.rollingN  = parseInt(el('cfg-n').value,     10)      || 8;
    cfg.inkCost   = parseFloat(el('cfg-ink-cost').value)   || 0;
    cfg.mediaCost = parseFloat(el('cfg-media-cost').value) || 0;
    renderStockOverview();
    renderCoDashboard();
    renderCoHistory();
    showToast('Nastavení uloženo', 'success');
  });

  el('export-csv-intervals').addEventListener('click', exportCSVIntervals);
  el('export-csv-raw-co').addEventListener('click',    exportCSVRawCo);
  el('export-csv-stock').addEventListener('click',     exportCSVStock);
  el('export-csv-stock-levels')?.addEventListener('click', exportCSVStockLevels);
  el('export-json').addEventListener('click',          exportJSON);
  el('import-json-btn').addEventListener('click', ()  => el('import-json-input').click());
  el('import-json-input').addEventListener('change',   handleImportJSON);

  el('clear-all-btn').addEventListener('click', () => {
    showConfirm('Smazat VŠECHNA lokální data? Tato akce je nevratná.', async () => {
      await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS)]);
      S.items = []; S.movements = []; S.coRecords = [];
      renderStockOverview(); renderAlerts(); renderItemsMgmt();
      renderCoDashboard(); renderCoHistory();
      showToast('Data smazána');
    });
  });
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  // Excel-friendly CSV escaping: quote if contains comma, quote, or newline
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportCSVIntervals() { /* beze změny */ }
function exportCSVRawCo()    { /* beze změny */ }
function exportCSVStock()    { /* beze změny */ }
async function exportJSON()  { /* beze změny */ }
async function handleImportJSON(e) { /* beze změny */ }
function dlBlob(content, type, filename) { /* beze změny */ }

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
  if (screenId === 'co-history')    renderCoHistory();
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

function normalizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const articleNumber = String(raw.articleNumber || '').trim().toUpperCase();
  if (!articleNumber) return null;
  return { ...raw, articleNumber };
}

function normalizeMovement(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  const articleNumber = String(raw.articleNumber || '').trim().toUpperCase();
  return { ...raw, id, articleNumber };
}

function normalizeCoRecord(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id || '').trim();
  if (!id) return null;
  return { ...raw, id };
}

function sanitizeSyncPayload(payload = {}) {
  const items = (Array.isArray(payload.items) ? payload.items : []).map(normalizeItem).filter(Boolean);
  const movements = (Array.isArray(payload.movements) ? payload.movements : []).map(normalizeMovement).filter(Boolean);
  const coRecords = (Array.isArray(payload.coRecords) ? payload.coRecords : []).map(normalizeCoRecord).filter(Boolean);
  return {
    items,
    movements,
    coRecords,
    dropped: {
      items: (Array.isArray(payload.items) ? payload.items.length : 0) - items.length,
      movements: (Array.isArray(payload.movements) ? payload.movements.length : 0) - movements.length,
      coRecords: (Array.isArray(payload.coRecords) ? payload.coRecords.length : 0) - coRecords.length,
    }
  };
}

async function cloudPull() {
  const res = await fetch('/.netlify/functions/sync', { method: 'GET', cache: 'no-store' });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud pull failed');
  return j;
}

async function cloudPush() {
  const clean = sanitizeSyncPayload({
    items: S.items,
    movements: S.movements,
    coRecords: S.coRecords,
  });

  const res = await fetch('/.netlify/functions/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify({
      items: clean.items,
      movements: clean.movements,
      coRecords: clean.coRecords
    })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud push failed');
  return { ...j, dropped: clean.dropped };
}

function applyRoleUI() {
  // schovej/ukaž stock "Položky" v bottom nav
  const itemsBtn = document.querySelector('#stock-nav .nav-item[data-screen="stock-items"]');
  if (itemsBtn) itemsBtn.style.display = isAdmin() ? '' : 'none';

  // schovej/ukaž tlačítko "+ Přidat položku" na obrazovce stock-items
  const addBtn = el('add-item-btn');
  if (addBtn) addBtn.style.display = isAdmin() ? '' : 'none';

  // když nejsi admin a někdo se tam dostane přes URL param, vrať ho pryč
  if (!isAdmin()) {
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
  const btn = el('sync-btn');
  if (!btn) return;

  btn.classList.add('syncing');

  try {
    if (!navigator.onLine) {
      showToast('Jsi offline — sync nejde.', 'error');
      return;
    }

    showToast('Sync…');

    // 1) načti lokál (IndexedDB -> S.*)
    await loadAll();

      // 2) rychlá validace: items musí mít articleNumber
      const bad = (S.items || []).find(it => !it?.articleNumber);
      if (bad) {
        showToast('Některým položkám chybí číslo artiklu (articleNumber).', 'error');
        return;
      }

    // 3) push lokál -> cloud
    const pushRes = await cloudPush();

      // 4) pull cloud -> lokál (cloud je truth pro MVP)
      const remote = await cloudPull();

      // 5) přepiš lokální DB cloudem
      await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS)]);
      for (const it of (remote.items || []))      await idbPut(ST_ITEMS, it);
      for (const m  of (remote.movements || []))  await idbPut(ST_MOVES, m);
      for (const r  of (remote.coRecords || []))  await idbPut(ST_CORECS, r);

    // 7) reload + UI
    await loadAll();

      showToast(
        `Sync OK · items:${pushRes?.upserted?.items ?? 0} · moves:${pushRes?.upserted?.movements ?? 0} · co:${pushRes?.upserted?.coRecords ?? 0}`,
        'success'
      );
    } catch (e) {
      showToast('Sync chyba: ' + (e?.message || e), 'error');
    } finally {
      applyRoleUI();
      setTimeout(() => btn.classList.remove('syncing'), 500);
    }
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
