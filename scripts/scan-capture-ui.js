'use strict';

(function attachScanCaptureUI(global) {
  const LS_OPERATOR = 'pg_scan_capture_operator';
  const LS_STATION = 'pg_scan_capture_station';
  const LS_QUEUE_FALLBACK = 'pg_scan_capture_local_queue';
  const DB_NAME = 'printguard-scan-capture-local';
  const DB_VERSION = 1;
  const STORE_SCANS = 'scans';
  const DEFAULT_STATION = 'SCAN-STATION-01';
  const STATUS_POLL_INTERVAL_MS = 2000;
  const STATUS_POLL_TIMEOUT_MS = 120000;
  const Api = global.PrintGuardScanCaptureApi;
  const Auth = global.PrintGuardAuth;

  const state = {
    bound: false,
    loading: false,
    lastBarcode: '',
    queue: [],
    commitResult: null,
    activeBatchId: '',
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

  function t(key) {
    return global.I18N && typeof global.I18N.t === 'function' ? global.I18N.t(key) : key;
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

  function makeBatchId() {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return `browser-scan-batch-${stamp}-${global.crypto.randomUUID()}`;
    }
    return `browser-scan-batch-${stamp}-${Math.random().toString(16).slice(2)}`;
  }

  function getScanBatchId(scan) {
    return String(scan && (scan.batchId || scan.batch_id) || '').trim();
  }

  function setStatus(message, tone = '') {
    const node = el('scan-capture-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', tone === 'error');
    node.classList.toggle('is-ok', tone === 'ok');
  }

  function isBatchActiveStatus(status) {
    return ['received', 'processing', 'matching'].includes(String(status || '').toLowerCase());
  }

  function isBatchSuccessStatus(status) {
    return ['matched', 'already_completed', 'committed'].includes(String(status || '').toLowerCase());
  }

  function isRecoverableCommitError(error) {
    return Boolean(error && (error.isTimeout || error.status >= 500 || !error.status));
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

  async function queuePutMany(scans) {
    const rowsToSave = Array.isArray(scans) ? scans.filter((scan) => scan && scan.scanId) : [];
    if (!rowsToSave.length) return;
    const db = await openQueueDB();
    if (!db) {
      const byId = new Map(readFallbackQueue().map((row) => [row.scanId, row]));
      rowsToSave.forEach((scan) => byId.set(scan.scanId, scan));
      writeFallbackQueue(Array.from(byId.values()));
      return;
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCANS, 'readwrite');
      const store = tx.objectStore(STORE_SCANS);
      rowsToSave.forEach((scan) => store.put(scan));
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB batch write failed'));
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

  async function ensurePendingBatchId(scans) {
    const pending = Array.isArray(scans) ? scans : [];
    const batchId = pending.map(getScanBatchId).find(Boolean) || makeBatchId();
    const updatedById = new Map();
    const updatedScans = pending.map((scan) => {
      if (getScanBatchId(scan) === batchId) return scan;
      const updated = { ...scan, batchId };
      updatedById.set(updated.scanId, updated);
      return updated;
    });
    if (updatedById.size) {
      await queuePutMany(Array.from(updatedById.values()));
      state.queue = state.queue.map((scan) => updatedById.get(scan.scanId) || scan);
    }
    return { batchId, scans: updatedScans };
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
      wrap.innerHTML = `<div class="empty-state">${esc(t('scan.queue.empty'))}</div>`;
      return;
    }
    wrap.innerHTML = rows.slice(0, 50).map((scan) => `
      <div class="scan-recent-row">
        <div>
          <strong>${esc(scan.barcode || scan.orderNumber || scan.rawBarcode || '—')}</strong>
          <span>${esc(scan.operator || '—')} · ${esc(scan.station || '—')} · ${esc(fmtDateTime(scan.scannedAt))}</span>
        </div>
        <button class="btn-sm scan-delete-btn" type="button" data-scan-id="${esc(scan.scanId)}">${esc(t('scan.delete'))}</button>
      </div>
    `).join('');
  }

  function renderCommitResult() {
    const wrap = el('scan-commit-result');
    if (!wrap) return;
    const result = state.commitResult;
    if (!result) {
      wrap.innerHTML = `<div class="hint">${esc(t('scan.commit.summary-empty'))}</div>`;
      return;
    }
    const skipped = Number(result.duplicateCount || 0) + Number(result.skippedAlreadyCommitted || 0);
    const committed = Number(result.newScansCommitted || 0);
    const matched = Number(result.matchedCount || 0);
    const orderUpdates = Number(result.orderUpdateCount || 0);
    const cells = [
      [t('scan.summary.read'), result.totalScansRead],
      [t('scan.summary.committed'), result.newScansCommitted],
      [t('scan.summary.matched'), result.matchedCount],
      [t('scan.summary.unmatched'), Number(result.unmatchedCount || 0) + Number(result.ambiguousCount || 0)],
      [t('scan.summary.skipped'), skipped],
      [t('scan.summary.errors'), result.errorCount],
    ];
    const phaseRows = [
      ['Status', result.status || '—'],
      ['Fáze chyby', result.failedPhase || '—'],
      ['Chyba', result.errorMessage || '—'],
      ['Začátek', result.startedAt ? fmtDateTime(result.startedAt) : '—'],
      ['Konec', result.finishedAt ? fmtDateTime(result.finishedAt) : '—'],
      ['Trvání', result.durationMs == null ? '—' : `${fmtInt(result.durationMs)} ms`],
    ];
    const zeroMatchCommit = committed > 0 && matched === 0;
    const retrySkippedWithoutUpdate = skipped > 0
      && committed === 0
      && matched === 0
      && orderUpdates === 0
      && result.retryMode
      && result.retryMode !== 'fresh';
    const warningText = result.commitOk === false || zeroMatchCommit
      ? 'Scany byly zapsány, ale žádná objednávka nebyla spárována.'
      : retrySkippedWithoutUpdate
        ? 'Retry našel již zapsané scany, ale objednávky nebyly aktualizované.'
        : '';
    wrap.innerHTML = `
      <div class="scan-result-grid">
        ${cells.map(([label, value]) => `
          <div class="metric-block">
            <span class="metric-big">${esc(fmtInt(value))}</span>
            <span class="metric-unit">${esc(label)}</span>
          </div>
        `).join('')}
      </div>
      <div class="header-meta">Batch ${esc(result.batchId || '—')} · ${esc(result.retryMode || 'fresh')} · ${esc(result.status || 'unknown')}</div>
      <div class="header-meta">
        ${phaseRows.map(([label, value]) => `${esc(label)}: ${esc(value)}`).join(' · ')}
      </div>
      ${warningText ? `<div class="hint is-error">${esc(warningText)}</div>` : ''}
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
    setStatus(`${t('scan.status.local-ready')}${fallback}`, 'ok');
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
      setStatus(t('scan.status.saved-local'), 'ok');
      input?.focus();
    } catch (error) {
      setStatus(`${t('scan.status.save-failed')}: ${error.message || error}`, 'error');
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

  async function fetchBatchStatus(batchId) {
    try {
      return await Api.getScanBatchStatus({
        fetchImpl: global.fetch.bind(global),
        headers: scanCommitHeaders(),
        batchId,
      });
    } catch (error) {
      if (error && error.status === 404) return null;
      throw error;
    }
  }

  function batchScanIds(batchId) {
    return state.queue
      .filter((scan) => getScanBatchId(scan) === batchId)
      .map((scan) => scan.scanId)
      .filter(Boolean);
  }

  async function clearBatchQueueAfterConfirmedStatus(batchId) {
    const ids = batchScanIds(batchId);
    if (ids.length) await queueDeleteMany(ids);
    await refreshScanCapture();
    renderCommitResult();
  }

  function mergeCommitResult(result) {
    state.commitResult = {
      ...(state.commitResult || {}),
      ...(result || {}),
    };
    renderCommitResult();
  }

  async function applyBatchStatus(statusResult) {
    if (!statusResult) return false;
    mergeCommitResult(statusResult);
    if (isBatchSuccessStatus(statusResult.status)) {
      await clearBatchQueueAfterConfirmedStatus(statusResult.batchId);
      setStatus('Hotovo. Batch byl serverem potvrzen.', 'ok');
      return true;
    }
    if (isBatchActiveStatus(statusResult.status)) {
      setStatus('Batch se stále zpracovává...', '');
      return false;
    }
    if (statusResult.status === 'failed') {
      const detail = statusResult.errorMessage || statusResult.failedPhase || 'neznámá chyba';
      setStatus(`Chyba batch: ${detail}`, 'error');
      return false;
    }
    if (statusResult.status === 'partial') {
      const detail = statusResult.errorMessage || statusResult.failedPhase || 'část scanů nebyla spárována';
      setStatus(`Batch skončil částečně: ${detail}`, 'error');
      return false;
    }
    return false;
  }

  async function pollBatchStatus(batchId, options = {}) {
    const timeoutMs = options.timeoutMs || STATUS_POLL_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    let latest = null;
    while (Date.now() <= deadline) {
      latest = await fetchBatchStatus(batchId);
      if (latest) {
        const done = await applyBatchStatus(latest);
        if (done || latest.status === 'failed' || latest.status === 'partial') return latest;
      }
      await new Promise((resolve) => global.setTimeout(resolve, STATUS_POLL_INTERVAL_MS));
    }
    setStatus('Server stále zpracovává batch. Fronta zůstává lokálně uložená.', 'error');
    return latest;
  }

  async function checkCurrentBatchStatus() {
    const pending = pendingScans();
    if (!pending.length) {
      setStatus(t('scan.queue.empty'), 'ok');
      return;
    }
    const { batchId } = await ensurePendingBatchId(pending);
    state.activeBatchId = batchId;
    setStatus('Kontroluji stav batch...');
    const statusResult = await fetchBatchStatus(batchId);
    if (!statusResult) {
      setStatus(`Batch ${batchId} zatím server neeviduje.`, 'error');
      return;
    }
    await applyBatchStatus(statusResult);
  }

  async function copyDebugInfo() {
    const debug = {
      activeBatchId: state.activeBatchId,
      commitResult: state.commitResult,
      pendingCount: pendingScans().length,
      queueCount: state.queue.length,
      fallbackStorage: state.useLocalStorageFallback,
      userAgent: global.navigator?.userAgent || '',
      copiedAt: new Date().toISOString(),
    };
    const text = JSON.stringify(debug, null, 2);
    try {
      await global.navigator.clipboard.writeText(text);
      setStatus('Debug info zkopírováno.', 'ok');
    } catch (_) {
      console.log('[scan-capture] debug info', debug);
      setStatus('Debug info je vypsané v konzoli.', 'ok');
    }
  }

  async function commitScans() {
    if (state.loading) return;
    state.loading = true;
    const button = el('scan-commit-btn');
    if (button) button.disabled = true;
    try {
      const pending = pendingScans();
      if (!pending.length) {
        setStatus(t('scan.queue.empty'), 'ok');
        return;
      }
      const { batchId, scans } = await ensurePendingBatchId(pending);
      state.activeBatchId = batchId;
      const operator = getInputValue('scan-operator-input');
      const station = getInputValue('scan-station-input') || DEFAULT_STATION;
      setStatus('Odesláno. Kontroluji stav batch...');
      const currentStatus = await fetchBatchStatus(batchId);
      if (currentStatus && isBatchActiveStatus(currentStatus.status)) {
        await applyBatchStatus(currentStatus);
        await pollBatchStatus(batchId);
        return;
      }
      if (currentStatus && isBatchSuccessStatus(currentStatus.status)) {
        await applyBatchStatus(currentStatus);
        return;
      }
      if (currentStatus && currentStatus.status === 'partial') {
        setStatus('Předchozí batch je partial. Zkouším reprocess unfinished rows...');
      } else if (currentStatus && currentStatus.status === 'failed') {
        setStatus('Předchozí batch skončil chybou. Zkouším retry...');
      } else {
        setStatus(t('scan.status.committing'));
      }
      state.commitResult = await Api.commitScanBatch({
        fetchImpl: global.fetch.bind(global),
        headers: scanCommitHeaders(),
        batchId,
        scans,
        committedBy: operator,
        operator,
        station,
      });
      if (isBatchActiveStatus(state.commitResult.status)) {
        await applyBatchStatus(state.commitResult);
        await pollBatchStatus(batchId);
        return;
      }
      if (isBatchSuccessStatus(state.commitResult.status)) {
        await applyBatchStatus(state.commitResult);
        return;
      }
      const removeIds = new Set([
        ...(state.commitResult.committedScanIds || []),
        ...(state.commitResult.processedScanIds || []),
        ...(state.commitResult.duplicateScanIds || []),
      ]);
      (state.commitResult.errorScanIds || []).forEach((scanId) => removeIds.delete(scanId));
      if (removeIds.size) await queueDeleteMany(Array.from(removeIds));
      await refreshScanCapture();
      renderCommitResult();
      const committed = Number(state.commitResult.newScansCommitted || 0);
      const matched = Number(state.commitResult.matchedCount || 0);
      const orderUpdates = Number(state.commitResult.orderUpdateCount || 0);
      if (state.commitResult.commitOk === false || (committed > 0 && matched === 0)) {
        setStatus('Scany byly zapsány, ale žádná objednávka nebyla spárována.', 'error');
      } else if (matched === 0 && orderUpdates === 0 && state.commitResult.retryMode && state.commitResult.retryMode !== 'fresh') {
        setStatus('Retry našel již zapsané scany, ale objednávky nebyly aktualizované.', 'error');
      } else {
        setStatus(t('scan.status.commit-done'), 'ok');
      }
    } catch (error) {
      if (state.activeBatchId && isRecoverableCommitError(error)) {
        console.warn('[scan-capture] commit request did not finish; polling status', error);
        setStatus('Server neodpověděl včas. Kontroluji stav batch...');
        try {
          await pollBatchStatus(state.activeBatchId);
          return;
        } catch (statusError) {
          setStatus(`Kontrola batch selhala: ${statusError.message || statusError}`, 'error');
          return;
        }
      }
      setStatus(`${t('scan.status.commit-failed')}: ${error.message || error}`, 'error');
    } finally {
      state.loading = false;
      if (button) button.disabled = false;
    }
  }

  async function deleteScan(target) {
    const scanId = target?.dataset?.scanId || '';
    if (!scanId) return;
    try {
      await queueDelete(scanId);
      await refreshScanCapture();
      setStatus(t('scan.status.deleted'), 'ok');
    } catch (error) {
      setStatus(`${t('scan.status.delete-failed')}: ${error.message || error}`, 'error');
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
    el('scan-check-status-btn')?.addEventListener('click', checkCurrentBatchStatus);
    el('scan-copy-debug-btn')?.addEventListener('click', copyDebugInfo);
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
    global.addEventListener('i18n:changed', () => {
      const screen = el('screen-scan-capture');
      if (!screen || !screen.classList.contains('active')) return;
      renderAll();
      setStatus(t('scan.status.local-ready'), 'ok');
    });
  }

  function loadScanCaptureScreen() {
    if (!Api) {
      setStatus(t('scan.status.missing-api'), 'error');
      return;
    }
    bindOnce();
    refreshScanCapture();
    setTimeout(() => el('scan-barcode-input')?.focus(), 0);
  }

  global.PrintGuardScanCaptureUI = { loadScanCaptureScreen, refreshScanCapture };
})(window);
