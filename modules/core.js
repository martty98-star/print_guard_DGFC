export function createCore() {
  const APP_VERSION = 'printguard-2.0.0';
  const DB_NAME = 'printguard-db';
  const DB_VERSION = 2;
  const ST_ITEMS = 'items';
  const ST_MOVES = 'movements';
  const ST_CORECS = 'co_records';
  const ST_SETTINGS = 'settings';

  const cfg = {
    get weeksN() { return parseInt(ls('pg_weeks') || '8', 10); },
    set weeksN(v) { ls('pg_weeks', v); },
    get rollingN() { return parseInt(ls('pg_rolling') || '8', 10); },
    set rollingN(v) { ls('pg_rolling', v); },
    get inkCost() { return parseFloat(ls('pg_ink_cost') || '0'); },
    set inkCost(v) { ls('pg_ink_cost', v); },
    get mediaCost() { return parseFloat(ls('pg_media_cost') || '0'); },
    set mediaCost(v) { ls('pg_media_cost', v); },
    get deviceId() {
      let id = ls('pg_device_id');
      if (!id) {
        id = 'pg-' + Math.random().toString(36).slice(2, 10);
        ls('pg_device_id', id);
      }
      return id;
    },
    get role() { return ls('pg_role') || 'operator'; },
    set role(v) { ls('pg_role', v); },
    get adminPin() { return ls('pg_admin_pin') || '2026'; },
    set adminPin(v) { ls('pg_admin_pin', v); },
  };

  function ls(k, v) {
    if (v !== undefined) {
      localStorage.setItem(k, String(v));
      return v;
    }
    return localStorage.getItem(k);
  }

  const S = {
    items: [],
    movements: [],
    coRecords: [],
    mode: 'stock',
    stockFilter: 'all',
    stockSearch: '',
    detailArticle: null,
    coHistMachine: 'colorado1',
    editingItem: null,
    movType: 'issue',
    movItem: null,
    logFilter: 'all',
    logSearch: '',
    logDateFrom: '',
    logDateTo: '',
    coDateFrom: '',
    coDateTo: '',
    printLogDateFrom: '',
    printLogDateTo: '',
    printLogPrinter: 'all',
    printLogResult: 'all',
    printLogRows: [],
    printLogOffset: 0,
    printLogHasMore: true,
    printLogSummary: null,
    printLogLoading: false,
    printLogLoaded: false,
    printLogViewMode: 'raw',
    printLogGroupFilter: 'all',
    printLogExpandedGroups: {},
    syncRunning: false,
    syncIntervalId: null,
  };

  let db;
  let modules = {};
  let toastTimer;

  function setModules(nextModules) {
    modules = nextModules || {};
  }

  function openDB() {
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(ST_ITEMS)) {
          d.createObjectStore(ST_ITEMS, { keyPath: 'articleNumber' });
        }
        if (!d.objectStoreNames.contains(ST_MOVES)) {
          const m = d.createObjectStore(ST_MOVES, { keyPath: 'id' });
          m.createIndex('byArticle', 'articleNumber', { unique: false });
        }
        if (!d.objectStoreNames.contains(ST_CORECS)) {
          const c = d.createObjectStore(ST_CORECS, { keyPath: 'id' });
          c.createIndex('byMachine', 'machineId', { unique: false });
        }
        if (!d.objectStoreNames.contains(ST_SETTINGS)) {
          d.createObjectStore(ST_SETTINGS, { keyPath: 'key' });
        }
      };
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => rej(e.target.error);
    });
  }

  function idbAll(store) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = e => res(e.target.result || []);
      req.onerror = e => rej(e.target.error);
    });
  }

  function idbPut(store, obj) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
      req.onsuccess = e => res(e.target.result);
      req.onerror = e => rej(e.target.error);
    });
  }

  function idbDelete(store, key) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      req.onsuccess = () => res();
      req.onerror = e => rej(e.target.error);
    });
  }

  function idbClear(store) {
    return new Promise((res, rej) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).clear();
      req.onsuccess = () => res();
      req.onerror = e => rej(e.target.error);
    });
  }

  function genId(prefix = 'id') {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  async function saveSettingsToIDB() {
    await idbPut(ST_SETTINGS, {
      key: 'config',
      weeksN: cfg.weeksN,
      rollingN: cfg.rollingN,
      inkCost: cfg.inkCost,
      mediaCost: cfg.mediaCost,
      savedAt: new Date().toISOString(),
    });
  }

  async function loadSettingsFromIDB() {
    const all = await idbAll(ST_SETTINGS);
    const rec = all.find(r => r.key === 'config');
    if (!rec) return;
    if (rec.weeksN != null) cfg.weeksN = rec.weeksN;
    if (rec.rollingN != null) cfg.rollingN = rec.rollingN;
    if (rec.inkCost != null) cfg.inkCost = rec.inkCost;
    if (rec.mediaCost != null) cfg.mediaCost = rec.mediaCost;
  }

  async function loadAll() {
    S.items = await idbAll(ST_ITEMS);
    S.movements = (await idbAll(ST_MOVES)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    S.coRecords = (await idbAll(ST_CORECS)).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    await loadSettingsFromIDB();

    const ts = new Date().toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' });
    elSet('stock-last-update', ts);
    elSet('co-last-update', ts);

    modules.stock?.renderStockOverview?.();
    modules.stock?.renderAlerts?.();
    modules.stock?.renderItemsMgmt?.();
    modules.colorado?.renderCoDashboard?.();
    modules.colorado?.renderCoHistory?.();
  }

  function loadSettingsUI() {
    el('cfg-weeks').value = cfg.weeksN;
    el('cfg-n').value = cfg.rollingN;
    el('cfg-ink-cost').value = cfg.inkCost || '';
    el('cfg-media-cost').value = cfg.mediaCost || '';
    el('device-id-display').textContent = cfg.deviceId;
    el('app-version-display').textContent = APP_VERSION;
  }

  function setupSettings() {
    el('save-settings-btn').addEventListener('click', async () => {
      cfg.weeksN = parseInt(el('cfg-weeks').value, 10) || 8;
      cfg.rollingN = parseInt(el('cfg-n').value, 10) || 8;
      cfg.inkCost = parseFloat(el('cfg-ink-cost').value) || 0;
      cfg.mediaCost = parseFloat(el('cfg-media-cost').value) || 0;
      await saveSettingsToIDB();
      modules.stock?.renderStockOverview?.();
      modules.colorado?.renderCoDashboard?.();
      modules.colorado?.renderCoHistory?.();
      showToast('Nastavení uloženo', 'success');
    });

    el('export-csv-intervals').addEventListener('click', exportCSVIntervals);
    el('export-csv-raw-co').addEventListener('click', exportCSVRawCo);
    el('export-csv-stock').addEventListener('click', exportCSVStock);
    el('export-csv-stock-levels').addEventListener('click', exportCSVStockLevels);
    el('export-json').addEventListener('click', exportJSON);
    el('import-json-btn').addEventListener('click', () => el('import-json-input').click());
    el('import-json-input').addEventListener('change', handleImportJSON);

    el('clear-all-btn').addEventListener('click', () => {
      showConfirm('Smazat VŠECHNA lokální data? Tato akce je nevratná.', async () => {
        await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS), idbClear(ST_SETTINGS)]);
        S.items = [];
        S.movements = [];
        S.coRecords = [];
        modules.stock?.renderStockOverview?.();
        modules.stock?.renderAlerts?.();
        modules.stock?.renderItemsMgmt?.();
        modules.colorado?.renderCoDashboard?.();
        modules.colorado?.renderCoHistory?.();
        showToast('Data smazána');
      });
    });
  }

  function csvEsc(v) {
    const s = String(v === null || v === undefined ? '' : v);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function csvRow(arr) {
    return arr.map(csvEsc).join(',');
  }

  function fmtFileDT() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}`;
  }

  function exportCSVIntervals() {
    const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
    const header = ['timestamp_from', 'timestamp_to', 'days_elapsed', 'machine', 'ink_total_l_to', 'media_total_m2_to', 'ink_used_l', 'media_used_m2', 'ink_per_m2', 'ink_cost', 'media_cost', 'total_cost', 'cost_per_m2'];
    const rows = [csvRow(header)];
    modules.colorado?.MACHINES?.forEach(({ id }) => {
      modules.colorado?.computeCoIntervals?.(id).forEach(iv => {
        rows.push(csvRow([
          iv.from,
          iv.to,
          fmtN(iv.days, 2),
          id,
          fmtN(iv.inkTotalTo, 3),
          fmtN(iv.mediaTotalTo, 1),
          fmtN(iv.inkUsed, 3),
          fmtN(iv.mediaUsed, 1),
          iv.inkPerM2 !== null ? fmtN(iv.inkPerM2, 6) : '',
          hasCosts ? fmtN(iv.inkCost, 2) : '',
          hasCosts ? fmtN(iv.mediaCost, 2) : '',
          hasCosts ? fmtN(iv.totalCost, 2) : '',
          iv.costPerM2 !== null ? fmtN(iv.costPerM2, 4) : '',
        ]));
      });
    });
    dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `co_intervals_${fmtFileDT()}.csv`);
  }

  function exportCSVRawCo() {
    const header = ['id', 'machine', 'timestamp', 'ink_total_l', 'media_total_m2', 'note', 'created_at'];
    const rows = [csvRow(header)];
    [...S.coRecords].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).forEach(r => {
      rows.push(csvRow([r.id, r.machineId, r.timestamp, r.inkTotalLiters, r.mediaTotalM2, r.note || '', r.createdAt || '']));
    });
    dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `co_raw_${fmtFileDT()}.csv`);
  }

  function exportCSVStock() {
    const header = ['timestamp', 'article_number', 'name', 'movement_type', 'qty', 'unit', 'stock_after', 'note'];
    const rows = [csvRow(header)];
    const itemMap = {};
    S.items.forEach(it => { itemMap[it.articleNumber] = it; });
    const byArticle = {};
    S.movements.forEach(m => {
      if (!byArticle[m.articleNumber]) byArticle[m.articleNumber] = [];
      byArticle[m.articleNumber].push(m);
    });
    [...S.movements].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp)).forEach(m => {
      const it = itemMap[m.articleNumber] || {};
      const artMoves = (byArticle[m.articleNumber] || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      let running = 0;
      for (const mm of artMoves) {
        if (mm.movType === 'stocktake') running = mm.qty;
        else if (mm.movType === 'receipt') running += mm.qty;
        else if (mm.movType === 'issue') running = Math.max(0, running - mm.qty);
        if (mm.id === m.id) break;
      }
      rows.push(csvRow([m.timestamp, m.articleNumber, it.name || '', m.movType, m.qty, it.unit || 'ks', running, m.note || '']));
    });
    dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `stock_movements_${fmtFileDT()}.csv`);
  }

  function exportCSVStockLevels() {
    const exportedAt = new Date().toISOString();
    const header = ['exported_at', 'article_number', 'name', 'category', 'unit', 'on_hand', 'avg_weekly_issue', 'days_left', 'status', 'min_qty', 'lead_time_days', 'safety_days'];
    const rows = [csvRow(header)];
    S.items.filter(it => it.isActive !== false).forEach(it => {
      const m = modules.stock?.computeStock?.(it);
      rows.push(csvRow([
        exportedAt,
        it.articleNumber,
        it.name || '',
        it.category || '',
        it.unit || 'ks',
        fmtN(m.onHand, 0),
        m.avgWeekly > 0 ? fmtN(m.avgWeekly, 3) : '0',
        m.daysLeft >= 999 ? '' : m.daysLeft,
        m.status,
        it.minQty || 0,
        it.leadTimeDays || 0,
        it.safetyDays || 0,
      ]));
    });
    dlBlob(rows.join('\r\n'), 'text/csv;charset=utf-8', `stock_levels_${fmtFileDT()}.csv`);
  }

  async function exportJSON() {
    const data = {
      exportedAt: new Date().toISOString(),
      appVersion: APP_VERSION,
      items: S.items,
      movements: S.movements,
      coRecords: S.coRecords,
    };
    dlBlob(JSON.stringify(data, null, 2), 'application/json', `printguard_backup_${fmtFileDT()}.json`);
  }

  async function handleImportJSON(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      showToast('Neplatný JSON soubor', 'error');
      return;
    }

    let items = [];
    let movements = [];
    let coRecords = [];

    if (Array.isArray(data.items)) {
      items = data.items.filter(it => it?.articleNumber);
    }
    if (Array.isArray(data.movements)) {
      movements = data.movements.filter(m => m?.id && m?.articleNumber);
    }
    if (Array.isArray(data.snapshots)) {
      data.snapshots.forEach(snap => {
        const articleNumber = snap.articleNumber || snap.article_number || snap.code;
        if (!articleNumber) return;
        movements.push({
          id: genId('imp'),
          articleNumber: String(articleNumber).trim().toUpperCase().replace(/\s+/g, '-'),
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

    showConfirm(`Importovat ${items.length} položek, ${movements.length} pohybu, ${coRecords.length} CO záznamu? Existující data budou prepsána.`, async () => {
      await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS)]);
      for (const it of items) await idbPut(ST_ITEMS, it);
      for (const m of movements) await idbPut(ST_MOVES, m);
      for (const r of coRecords) await idbPut(ST_CORECS, r);
      await loadAll();
      showToast(`Import hotov: ${items.length} pol., ${movements.length} poh.`, 'success');
    });
  }

  function dlBlob(content, type, filename) {
    const blob = new Blob(['\ufeff' + content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 500);
  }

  function dateRangeFilter(timestamp, from, to) {
    if (!from && !to) return true;
    const t = new Date(timestamp);
    if (from && t < new Date(from + 'T00:00:00')) return false;
    if (to && t > new Date(to + 'T23:59:59')) return false;
    return true;
  }

  function applyPreset(range, target) {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const todayStr = fmt(now);
    let fromStr = '';
    if (range === 'month') {
      fromStr = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
    } else if (range === 'year') {
      fromStr = `${now.getFullYear()}-01-01`;
    } else {
      const d = new Date(now);
      d.setDate(d.getDate() - parseInt(range, 10));
      fromStr = fmt(d);
    }

    if (target === 'log') {
      S.logDateFrom = fromStr;
      S.logDateTo = todayStr;
      el('stock-log-from').value = fromStr;
      el('stock-log-to').value = todayStr;
      modules.stock?.renderStockLog?.();
    } else if (target === 'co') {
      S.coDateFrom = fromStr;
      S.coDateTo = todayStr;
      el('co-hist-from').value = fromStr;
      el('co-hist-to').value = todayStr;
      modules.colorado?.renderCoHistory?.();
    } else {
      S.printLogDateFrom = fromStr;
      S.printLogDateTo = todayStr;
      el('print-log-from').value = fromStr;
      el('print-log-to').value = todayStr;
      S.printLogLoaded = false;
      modules.printLog?.loadPrintLog?.(true);
    }
  }

  function navigate(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    el('screen-' + screenId)?.classList.add('active');

    document.querySelectorAll('#stock-nav .nav-item, #colorado-nav .nav-item').forEach(b =>
      b.classList.toggle('active', b.dataset.screen === screenId)
    );

    if (screenId === 'stock-alerts') modules.stock?.renderAlerts?.();
    if (screenId === 'stock-items') modules.stock?.renderItemsMgmt?.();
    if (screenId === 'stock-log') modules.stock?.renderStockLog?.();
    if (screenId === 'co-history') modules.colorado?.renderCoHistory?.();
    if (screenId === 'print-log') modules.printLog?.loadPrintLog?.();
    if (screenId === 'settings') loadSettingsUI();

    window.scrollTo(0, 0);
    applyRoleUI();
  }

  function setMode(mode) {
    S.mode = mode;
    document.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.mode === mode)
    );
    el('stock-nav').classList.toggle('hidden', mode !== 'stock');
    el('colorado-nav').classList.toggle('hidden', mode !== 'colorado');
    navigate(mode === 'stock' ? 'stock-overview' : 'co-dashboard');
  }

  function isAdmin() {
    return cfg.role === 'admin';
  }

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
        items: S.items,
        movements: S.movements,
        coRecords: S.coRecords,
        settings: [{
          key: 'config',
          weeksN: cfg.weeksN,
          rollingN: cfg.rollingN,
          inkCost: cfg.inkCost,
          mediaCost: cfg.mediaCost,
          savedAt: new Date().toISOString(),
        }],
      }),
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
        if (!silent) showToast('Lokální data: nekteré položky nemají articleNumber.', 'error');
        return false;
      }
      const badLocalMove = (S.movements || []).find(m => !m?.id);
      if (badLocalMove) {
        console.warn('[SYNC] Local movement missing id:', badLocalMove);
        if (!silent) showToast('Lokální data: nekteré pohyby nemají id.', 'error');
        return false;
      }
      const badLocalCo = (S.coRecords || []).find(r => !r?.id);
      if (badLocalCo) {
        console.warn('[SYNC] Local coRecord missing id:', badLocalCo);
        if (!silent) showToast('Lokální data: nekteré Colorado záznamy nemají id.', 'error');
        return false;
      }

      const pushRes = await cloudPush();
      const remote = await cloudPull();

      const rawItems = Array.isArray(remote?.items) ? remote.items : [];
      const rawMoves = Array.isArray(remote?.movements) ? remote.movements : [];
      const rawCo = Array.isArray(remote?.coRecords) ? remote.coRecords : [];
      const rawSettings = Array.isArray(remote?.settings) ? remote.settings : [];

      const goodItems = [];
      const badItems = [];
      for (const it of rawItems) {
        const articleNumber = it?.articleNumber ?? it?.ArticleNumber ?? it?.article ?? it?.code ?? null;
        if (!articleNumber || String(articleNumber).trim() === '') {
          badItems.push(it);
          continue;
        }
        const fixed = { ...it, articleNumber: String(articleNumber).trim().toUpperCase().replace(/\s+/g, '-') };
        goodItems.push(fixed);
      }

      const goodMoves = [];
      const badMoves = [];
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
          articleNumber: String(articleNumber).trim().toUpperCase().replace(/\s+/g, '-'),
        });
      }

      const goodCo = [];
      const badCo = [];
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
        console.warn('[SYNC] Dropping invalid remote records:', { badItems, badMoves, badCo });
      }

      await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS), idbClear(ST_SETTINGS)]);

      for (const it of goodItems) await idbPut(ST_ITEMS, it);
      for (const m of goodMoves) await idbPut(ST_MOVES, m);
      for (const r of goodCo) await idbPut(ST_CORECS, r);
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
    const itemsBtn = document.querySelector('#stock-nav .nav-item[data-screen="stock-items"]');
    if (itemsBtn) itemsBtn.style.display = admin ? '' : 'none';

    const addBtn = el('add-item-btn');
    if (addBtn) addBtn.style.display = admin ? '' : 'none';

    document.querySelectorAll('.admin-only').forEach(node => {
      node.style.display = admin ? '' : 'none';
    });

    if (!admin) {
      const itemsScreen = el('screen-stock-items');
      if (itemsScreen?.classList.contains('active')) navigate('stock-overview');
    }
  }

  function el(id) {
    return document.getElementById(id);
  }

  function elSet(id, v) {
    const e = el(id);
    if (e) e.textContent = String(v);
  }

  function esc(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fmtN(n, dec = 1) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toFixed(dec);
  }

  function fmtDays(d) {
    if (d >= 999) return '8';
    if (d <= 0) return '0 dní';
    if (d < 14) return `${Math.round(d)} dní`;
    if (d < 60) return `${Math.round(d / 7)} týdnu`;
    return `${Math.round(d / 30)} mes.`;
  }

  function fmtDT(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function toLocalDT(iso) {
    const d = new Date(iso);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function toISOfromDT(v) {
    return v ? new Date(v).toISOString() : new Date().toISOString();
  }

  function ds() {
    return new Date().toISOString().slice(0, 10);
  }

  function showToast(msg, type = '') {
    const t = el('toast');
    if (!t) return;
    t.classList.remove('hidden');
    t.textContent = msg;
    t.className = 'toast' + (type ? ' ' + type : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
  }

  function showConfirm(text, onOk) {
    el('confirm-text').textContent = text;
    el('confirm-modal').classList.remove('hidden');
    const close = () => el('confirm-modal').classList.add('hidden');
    el('confirm-ok').onclick = () => {
      close();
      onOk();
    };
    el('confirm-cancel').onclick = close;
  }

  function updateOfflineBanner() {
    el('offline-banner')?.classList.toggle('hidden', navigator.onLine);
  }

  return {
    APP_VERSION,
    DB_NAME,
    DB_VERSION,
    ST_ITEMS,
    ST_MOVES,
    ST_CORECS,
    ST_SETTINGS,
    cfg,
    S,
    setModules,
    openDB,
    idbAll,
    idbPut,
    idbDelete,
    idbClear,
    genId,
    saveSettingsToIDB,
    loadSettingsFromIDB,
    loadAll,
    loadSettingsUI,
    setupSettings,
    exportCSVIntervals,
    exportCSVRawCo,
    exportCSVStock,
    exportCSVStockLevels,
    exportJSON,
    handleImportJSON,
    dlBlob,
    csvEsc,
    csvRow,
    fmtFileDT,
    dateRangeFilter,
    applyPreset,
    navigate,
    setMode,
    isAdmin,
    cloudPull,
    cloudPush,
    runSync,
    setupBackgroundSync,
    applyRoleUI,
    el,
    elSet,
    esc,
    fmtN,
    fmtDays,
    fmtDT,
    toLocalDT,
    toISOfromDT,
    ds,
    showToast,
    showConfirm,
    updateOfflineBanner,
  };
}