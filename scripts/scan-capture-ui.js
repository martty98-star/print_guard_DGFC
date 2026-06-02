'use strict';

(function attachScanCaptureUI(global) {
  const LS_OPERATOR = 'pg_scan_capture_operator';
  const LS_STATION = 'pg_scan_capture_station';
  const DEFAULT_STATION = 'SCAN-STATION-01';
  const Api = global.PrintGuardScanCaptureApi;

  const state = {
    bound: false,
    loading: false,
    lastBarcode: '',
    pending: null,
    recent: [],
    commitResult: null,
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

  function setStatus(message, tone = '') {
    const node = el('scan-capture-status');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('is-error', tone === 'error');
    node.classList.toggle('is-ok', tone === 'ok');
  }

  function renderKpis() {
    const pending = state.pending || {};
    const pendingCount = pending.pendingCount != null ? pending.pendingCount : state.recent.length;
    const latest = state.lastBarcode || (pending.latestScan && (pending.latestScan.barcode || pending.latestScan.orderNumber)) || '—';
    const totalRead = pending.totalScansRead != null ? pending.totalScansRead : state.recent.length;
    const committed = pending.committedCount != null ? pending.committedCount : 0;

    const map = {
      'scan-kpi-pending': fmtInt(pendingCount),
      'scan-kpi-last': latest,
      'scan-kpi-read': fmtInt(totalRead),
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
    if (!state.recent.length) {
      wrap.innerHTML = '<div class="empty-state">Zatím žádné scany.</div>';
      return;
    }
    wrap.innerHTML = state.recent.map((scan) => {
      const barcode = scan.barcode || scan.orderNumber || scan.rawBarcode || '—';
      const scanId = scan.scanId || scan.scan_id || '';
      return `
        <div class="scan-recent-row">
          <div>
            <strong>${esc(barcode)}</strong>
            <span>${esc(scan.operator || '—')} · ${esc(scan.station || '—')} · ${esc(fmtDateTime(scan.scannedAt || scan.scanned_at))}</span>
          </div>
          <button class="btn-sm scan-delete-btn" type="button" data-scan-id="${esc(scanId)}" data-scanned-at="${esc(scan.scannedAt || scan.scanned_at || '')}">Smazat</button>
        </div>
      `;
    }).join('');
  }

  function renderCommitResult() {
    const wrap = el('scan-commit-result');
    if (!wrap) return;
    const result = state.commitResult;
    if (!result) {
      wrap.innerHTML = '<div class="hint">Souhrn se zobrazí po kliknutí na Hotovo / Odeslat do PrintGuardu.</div>';
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
    if (!Api || state.loading) return;
    state.loading = true;
    setStatus('Načítám scan backend…');
    try {
      const [pending, recent] = await Promise.all([
        Api.pending(),
        Api.recent(25),
      ]);
      state.pending = pending || {};
      state.recent = Array.isArray(recent && recent.scans) ? recent.scans : [];
      renderAll();
      setStatus(`Scan backend OK · ${Api.getConfiguredBase() || 'same origin'}`, 'ok');
    } catch (error) {
      setStatus(`Scan backend není dostupný: ${error.message || error}`, 'error');
      renderAll();
    } finally {
      state.loading = false;
    }
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
    try {
      setStatus('Ukládám scan do NAS JSONL queue…');
      const result = await Api.scan({
        barcode,
        rawBarcode: barcode,
        orderNumber: barcode,
        operator,
        station,
        source: 'main_printguard_scan_tab',
      });
      state.lastBarcode = barcode;
      state.commitResult = null;
      if (input) input.value = '';
      if (result && result.fallback) {
        setStatus('Scan uložen do fallback queue. NAS cestu zkontroluj později.', 'error');
      } else {
        setStatus('Scan uložen do NAS JSONL queue.', 'ok');
      }
      await refreshScanCapture();
      input?.focus();
    } catch (error) {
      setStatus(`Scan se nepodařilo uložit: ${error.message || error}`, 'error');
      input?.focus();
    }
  }

  async function commitScans() {
    const operator = getInputValue('scan-operator-input');
    const station = getInputValue('scan-station-input') || DEFAULT_STATION;
    const button = el('scan-commit-btn');
    if (button) button.disabled = true;
    try {
      setStatus('Commituji pending scany do PrintGuardu…');
      state.commitResult = await Api.commit({
        committedBy: operator,
        operator,
        station,
      });
      renderCommitResult();
      setStatus('Commit hotový. Spárované objednávky jsou označené jako Dotisknuto.', 'ok');
      await refreshScanCapture();
    } catch (error) {
      setStatus(`Commit selhal: ${error.message || error}`, 'error');
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function deleteScan(target) {
    const scanId = target?.dataset?.scanId || '';
    const scannedAt = target?.dataset?.scannedAt || '';
    if (!scanId && !scannedAt) return;
    try {
      setStatus('Mažu scan z pending queue…');
      await Api.deleteScan({ scanId, scannedAt });
      await refreshScanCapture();
      setStatus('Scan smazán z pending queue.', 'ok');
    } catch (error) {
      setStatus(`Scan nejde smazat: ${error.message || error}`, 'error');
    }
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    const apiBase = el('scan-api-base-input');
    const operator = el('scan-operator-input');
    const station = el('scan-station-input');
    if (apiBase) apiBase.value = Api ? Api.getConfiguredBase() : '';
    try {
      if (operator) operator.value = global.localStorage.getItem(LS_OPERATOR) || '';
      if (station) station.value = global.localStorage.getItem(LS_STATION) || DEFAULT_STATION;
    } catch (_) {
      if (station) station.value = DEFAULT_STATION;
    }

    apiBase?.addEventListener('change', () => {
      Api.setConfiguredBase(apiBase.value);
      apiBase.value = Api.getConfiguredBase();
      refreshScanCapture();
    });
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
    renderAll();
    refreshScanCapture();
    setTimeout(() => el('scan-barcode-input')?.focus(), 0);
  }

  global.PrintGuardScanCaptureUI = { loadScanCaptureScreen, refreshScanCapture };
})(window);
