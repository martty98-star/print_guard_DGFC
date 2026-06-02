'use strict';

(function attachScanCaptureUI(global) {
  const LS_OPERATOR = 'pg_scan_capture_operator';
  const LS_STATION = 'pg_scan_capture_station';
  const LS_QUEUE_FALLBACK = 'pg_scan_capture_local_queue';
  const DB_NAME = 'printguard-scan-capture-local';
  const DB_VERSION = 1;
  const STORE_SCANS = 'scans';
  const DEFAULT_STATION = 'SCAN-STATION-01';
  const Api = global.PrintGuardScanCaptureApi;
  const Auth = global.PrintGuardAuth;

  const state = {
    bound: false,
    loading: false,
    lastBarcode: '',
    queue: [],
    commitResult: null,
    dbPromise: null,
    useLocalStorageFallback: false,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtInt(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString('cs-CZ') : '0';
  }

  function fmtDateTime(value) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  function getInputValue(id) {
    return String(el(id)?.value || '').trim();
  }

  function makeScanId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return `browser-${global.crypto.randomUUID()}`;
    }
    return `browser-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function setStatus(message, tone = '') {
    const node = el('scan-capture-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', tone === 'error');
    node.classList.toggle('is-ok', tone === 'ok');
  }

  function openQueueDB() {
    if (state.dbPromise) return state.dbPromise;
    if (!global.indexedDB) {
      state.useLocalStorageFallback = true;
      state.dbPromise = Promise.resolve(null);
      return state.dbPromise;
    }
    state.dbPromise = new Promise((resolve, reject) => {
      const request = global.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_SCANS)) {
          const store = db.createObjectStore(STORE_SCANS, { keyPath: 'scanId' });
          store.createIndex('commitStatus', 'commitStatus', { unique: false });
          store.createIndex('scannedAt', 'scannedAt', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    }).catch(() => {
      state.useLocalStorageFallback = true;
      return null;
    });
    return state.dbPromise;
  }

  function readFallbackQueue() {
    try {
      const rows = JSON.parse(global.localStorage.getItem(LS_QUEUE_FALLBACK) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch (_) {
      return [];
    }
  }

  function writeFallbackQueue(rows) {
    try {
      global.localStorage.setItem(LS_QUEUE_FALLBACK, JSON.stringify(rows || []));
    } catch (_) {}
  }

  async function queueAll() {
    const db = await openQueueDB();
    if (!db) {
      return readFallbackQueue().sort((a, b) => String(b.scannedAt || '').localeCompare(String(a.scannedAt || '')));
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCANS, 'readonly');
      const request = tx.objectStore(STORE_SCANS).getAll();
      request.onsuccess = () => {
        const rows = Array.isArray(request.result) ? request.result : [];
        resolve(rows.sort((a, b) => String(b.scannedAt || '').localeCompare(String(a.scannedAt || ''))));
      };
      request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
    });
  }

  async function queuePut(scan) {
    const db = await openQueueDB();
    if (!db) {
      const rows = readFallbackQueue().filter((row) => row.scanId !== scan.scanId);
      rows.push(scan);
      writeFallbackQueue(rows);
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCANS, 'readwrite');
      tx.objectStore(STORE_SCANS).put(scan);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    });
  }

  async function queueDelete(scanId) {
    if (!scanId) return;
    const db = await openQueueDB();
    if (!db) {
      writeFallbackQueue(readFallbackQueue().filter((row) => row.scanId !== scanId));
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCANS, 'readwrite');
      tx.objectStore(STORE_SCANS).delete(scanId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB delete failed'));
    });
  }

  async function queueDeleteMany(scanIds) {
    const ids = Array.from(new Set((scanIds || []).filter(Boolean)));
    if (!ids.length) return;
    const db = await openQueueDB();
    if (!db) {
      const idSet = new Set(ids);
      writeFallbackQueue(readFallbackQueue().filter((row) => !idSet.has(row.scanId)));
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCANS, 'readwrite');
      const store = tx.objectStore(STORE_SCANS);
      ids.forEach((scanId) => store.delete(scanId));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB batch delete failed'));
    });
  }

  function pendingScans() {
    return state.queue.filter((scan) => String(scan.commitStatus || 'pending') === 'pending');
  }

  function renderKpis() {
    const pending = pendingScans();
    const latest = state.lastBarcode || (pending[0] && (pending[0].barcode || pending[0].orderNumber)) || '—';
    const committed = state.commitResult ? Number(state.commitResult.newScansCommitted || 0) : 0;
    const map = {
      'scan-kpi-pending': fmtInt(pending.length),
      'scan-kpi-last': latest,
      'scan-kpi-read': fmtInt(state.queue.length),
      'scan-kpi-committed': fmtInt(committed),
    };
    Object.entries(map).forEach(([id, value]) => {
      const node = el(id);
      if (node) node.textContent = value;
    });
  }

  function renderRecent() {
    const wrap = el('scan-recent-list');
    if (!wrap) return;
    const rows = pendingScans();
    if (!rows.length) {
      wrap.innerHTML = '<div class="empty-state">Lokální fronta je prázdná.</div>';
      return;
    }
    wrap.innerHTML = rows.slice(0, 50).map((scan) => `
      <div class="scan-recent-row">
        <div>
          <strong>${esc(scan.barcode || scan.orderNumber || scan.rawBarcode || '—')}</strong>
          <span>${esc(scan.operator || '—')} · ${esc(scan.station || '—')} · ${esc(fmtDateTime(scan.scannedAt))}</span>
        </div>
        <button class="btn-sm scan-delete-btn" type="button" data-scan-id="${esc(scan.scanId)}">Smazat</button>
      </div>
    `).join('');
  }

  function renderCommitResult() {
    const wrap = el('scan-commit-result');
    if (!wrap) return;
    const result = state.commitResult;
    if (!result) {
      wrap.innerHTML = '<div class="hint">Souhrn se zobrazí po kliknutí na Odeslat do PrintGuardu.</div>';
      return;
    }
    const skipped = Number(result.duplicateCount || 0) + Number(result.skippedAlreadyCommitted || 0);
    const cells = [
      ['Přečteno', result.totalScansRead],
      ['Commitnuto', result.newScansCommitted],
      ['Spárováno', result.matchedCount],
      ['Nespárováno', Number(result.unmatchedCount || 0) + Number(result.ambiguousCount || 0)],
      ['Duplicity / přeskočeno', skipped],
      ['Chyby', result.errorCount],
    ];
    wrap.innerHTML = `
      <div class="scan-result-grid">
        ${cells.map(([label, value]) => `
          <div class="metric-block">
            <span class="metric-big">${esc(fmtInt(value))}</span>
            <span class="metric-unit">${esc(label)}</span>
          </div>
        `).join('')}
      </div>
      <div class="header-meta">Batch ${esc(result.batchId || '—')}</div>
    `;
  }

  function renderAll() {
    renderKpis();
    renderRecent();
    renderCommitResult();
  }

  async function refreshScanCapture() {
    state.queue = await queueAll();
    renderAll();
    const fallback = state.useLocalStorageFallback ? ' · localStorage fallback' : '';
    setStatus(`Lokální scan fronta připravena${fallback}`, 'ok');
  }

  async function submitScan() {
    const input = el('scan-barcode-input');
    const barcode = String(input?.value || '').trim();
    if (!barcode) {
      input?.focus();
      return;
    }
    const operator = getInputValue('scan-operator-input');
    const station = getInputValue('scan-station-input') || DEFAULT_STATION;
    const scan = {
      scanId: makeScanId(),
      scannedAt: new Date().toISOString(),
      barcode,
      rawBarcode: barcode,
      orderNumber: barcode,
      operator,
      station,
      source: 'job_label_scan',
      commitStatus: 'pending',
    };
    try {
      await queuePut(scan);
      state.lastBarcode = barcode;
      state.commitResult = null;
      if (input) input.value = '';
      await refreshScanCapture();
      setStatus('Scan uložen do lokální browser fronty.', 'ok');
      input?.focus();
    } catch (error) {
      setStatus(`Scan se nepodařilo uložit lokálně: ${error.message || error}`, 'error');
      input?.focus();
    }
  }

  function scanCommitHeaders() {
    const pin = getInputValue('scan-postpurchase-pin');
    if (pin) {
      return {
        'content-type': 'application/json',
        'x-postpurchase-pin': pin,
        'x-admin-pin': pin,
      };
    }
    if (Auth && typeof Auth.postPurchaseJsonHeaders === 'function') {
      return Auth.postPurchaseJsonHeaders();
    }
    return { 'content-type': 'application/json' };
  }

  async function commitScans() {
    const scans = pendingScans();
    if (!scans.length) {
      setStatus('Lokální fronta je prázdná.', 'ok');
      return;
    }
    const operator = getInputValue('scan-operator-input');
    const station = getInputValue('scan-station-input') || DEFAULT_STATION;
    const button = el('scan-commit-btn');
    if (button) button.disabled = true;
    try {
      setStatus('Odesílám lokální scan batch do PrintGuardu…');
      state.commitResult = await Api.commitScanBatch({
        fetchImpl: global.fetch.bind(global),
        headers: scanCommitHeaders(),
        scans,
        committedBy: operator,
        operator,
        station,
      });
      const removeIds = new Set([
        ...(state.commitResult.committedScanIds || []),
        ...(state.commitResult.duplicateScanIds || []),
      ]);
      (state.commitResult.errorScanIds || []).forEach((scanId) => removeIds.delete(scanId));
      if (removeIds.size) await queueDeleteMany(Array.from(removeIds));
      await refreshScanCapture();
      renderCommitResult();
      setStatus('Commit hotový. Spárované objednávky jsou označené jako Dotisknuto.', 'ok');
    } catch (error) {
      setStatus(`Commit selhal: ${error.message || error}`, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function deleteScan(target) {
    const scanId = target?.dataset?.scanId || '';
    if (!scanId) return;
    try {
      await queueDelete(scanId);
      await refreshScanCapture();
      setStatus('Scan smazán z lokální fronty.', 'ok');
    } catch (error) {
      setStatus(`Scan nejde smazat: ${error.message || error}`, 'error');
    }
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    const operator = el('scan-operator-input');
    const station = el('scan-station-input');
    try {
      if (operator) operator.value = global.localStorage.getItem(LS_OPERATOR) || '';
      if (station) station.value = global.localStorage.getItem(LS_STATION) || DEFAULT_STATION;
    } catch (_) {
      if (station) station.value = DEFAULT_STATION;
    }
    operator?.addEventListener('change', () => {
      try { global.localStorage.setItem(LS_OPERATOR, operator.value.trim()); } catch (_) {}
    });
    station?.addEventListener('change', () => {
      try { global.localStorage.setItem(LS_STATION, station.value.trim() || DEFAULT_STATION); } catch (_) {}
    });
    el('scan-refresh-btn')?.addEventListener('click', refreshScanCapture);
    el('scan-submit-btn')?.addEventListener('click', submitScan);
    el('scan-commit-btn')?.addEventListener('click', commitScans);
    el('scan-barcode-input')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submitScan();
      }
    });
    el('scan-recent-list')?.addEventListener('click', (event) => {
      const button = event.target && event.target.closest('.scan-delete-btn');
      if (button) deleteScan(button);
    });
  }

  function loadScanCaptureScreen() {
    if (!Api) {
      setStatus('Chybí PrintGuardScanCaptureApi.', 'error');
      return;
    }
    bindOnce();
    refreshScanCapture();
    setTimeout(() => el('scan-barcode-input')?.focus(), 0);
  }

  global.PrintGuardScanCaptureUI = { loadScanCaptureScreen, refreshScanCapture };
})(window);
