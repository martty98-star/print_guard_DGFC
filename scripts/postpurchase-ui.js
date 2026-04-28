'use strict';

(() => {
  const state = {
    S: null,
    cfg: null,
    el: null,
    elSet: null,
    esc: null,
    showToast: null,
    applyRoleUI: null,
    postPurchaseHeaders: null,
    postPurchaseJsonHeaders: null,
    postPurchaseErrorMessage: null,
    requirePostPurchasePinForScreen: null,
    renderPostPurchaseAccessRequired: null,
    fetchImpl: null,
  };

  function initPostPurchaseUI(deps) {
    Object.assign(state, deps || {});
    if (!state.S || !state.cfg || !state.el || !state.elSet) {
      throw new Error('Missing Processed Print Orders UI dependencies');
    }
  }

  function cleanApiError(error) {
    if (typeof state.postPurchaseErrorMessage === 'function') {
      return state.postPurchaseErrorMessage(error);
    }
    return error && error.message ? error.message : 'Database/API unavailable. Try refresh later.';
  }

  async function readJsonResponse(res, fallbackMessage) {
    const text = await res.text().catch(() => '');
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch (error) {
        payload = {};
      }
    }
    if (!res.ok || payload.ok === false) {
      const message = payload.error || fallbackMessage || `Request failed (${res.status})`;
      const error = new Error(res.status >= 500 ? 'Database/API unavailable. Try refresh later.' : message);
      error.status = res.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function formatTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    return `${dd}.${mm}. ${hh}:${min}`;
  }

  function fileNameFromPath(value) {
    const raw = String(value || '');
    return raw.split(/[\\/]/).filter(Boolean).pop() || raw;
  }

  function uncToFileHref(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (!raw.startsWith('\\\\')) return raw;
    return 'file://///' + raw.replace(/^\\\\/, '').replace(/\\/g, '/');
  }

  function getPageSizes(row) {
    const values = (Array.isArray(row && row.printFiles) ? row.printFiles : [])
      .map(file => file.pageSize)
      .filter(Boolean);
    return Array.from(new Set(values)).join(', ') || '-';
  }

  function updateMonthFilter(months) {
    const select = state.el('postpurchase-month-filter');
    if (!select) return;
    const current = state.S.postPurchaseMonth || '';
    const options = ['<option value="">All months</option>']
      .concat((months || []).map(month => `<option value="${state.esc(month)}">${state.esc(month)}</option>`));
    select.innerHTML = options.join('');
    select.value = current;
  }

  function buildProcessedOrdersUrl() {
    const params = new URLSearchParams();
    params.set('limit', '500');
    if (state.S.postPurchaseSearch) params.set('search', state.S.postPurchaseSearch);
    if (state.S.postPurchaseMonth) params.set('month', state.S.postPurchaseMonth);
    return '/.netlify/functions/processed-print-orders?' + params.toString();
  }

  async function loadPostPurchaseOrders(force = false) {
    if (state.S.postPurchaseLoading) return;
    if (state.S.postPurchaseLoaded && !force) {
      renderPostPurchaseOrders();
      return;
    }
    if (!state.requirePostPurchasePinForScreen()) return;

    state.S.postPurchaseLoading = true;
    state.elSet('postpurchase-status', 'Loading...');
    const wrap = state.el('postpurchase-orders-wrap');
    if (wrap && !(state.S.postPurchaseOrders || []).length) {
      wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading processed orders...</p></div>`;
    }

    try {
      const res = await state.fetchImpl(buildProcessedOrdersUrl(), {
        headers: state.postPurchaseHeaders(),
        cache: 'no-store',
      });
      const payload = await readJsonResponse(res, 'Failed to load processed orders');
      state.S.postPurchaseOrders = Array.isArray(payload.rows) ? payload.rows : [];
      state.S.postPurchaseLoaded = true;
      updateMonthFilter(payload.months || []);
      renderPostPurchaseOrders();
      state.elSet('postpurchase-status', `${state.S.postPurchaseOrders.length} processed orders`);
    } catch (error) {
      console.error('Processed Print Orders load failed', error);
      const message = cleanApiError(error);
      if (wrap && !(state.S.postPurchaseOrders || []).length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠</div><p>Processed orders could not be loaded.</p><div class="table-empty-note">${state.esc(message)}</div><button class="btn-sm" type="button" data-pp-retry="true">Refresh</button></div>`;
        wrap.querySelector('[data-pp-retry="true"]')?.addEventListener('click', () => loadPostPurchaseOrders(true));
      } else {
        renderPostPurchaseOrders();
      }
      state.elSet('postpurchase-status', 'Load failed');
      state.showToast(message, 'error');
    } finally {
      state.S.postPurchaseLoading = false;
    }
  }

  function normalizePrintFiles(row) {
    const files = Array.isArray(row && row.printFiles) ? row.printFiles : [];
    return files;
  }

  function renderPdfFiles(row) {
    const files = normalizePrintFiles(row);
    if (!files.length) return '<div class="pp-file-block"><span class="pp-file-name">-</span></div>';
    return files.map((file, index) => {
      const path = file.printFilePath || '';
      const label = fileNameFromPath(path) || `PDF ${index + 1}`;
      const href = uncToFileHref(path);
      return `<div class="pp-file-block">
        <div class="pp-file-title">${state.esc(label)}</div>
        <div class="pp-file-path">${state.esc(path || '-')}</div>
        <div class="pp-file-actions">
          <button class="btn-sm" type="button" data-open-pdf-path="${state.esc(path)}" data-open-pdf-href="${state.esc(href)}">Open PDF</button>
          <button class="btn-sm" type="button" data-copy-path="${state.esc(path)}">Copy path</button>
          <button class="btn-sm" type="button" data-reprint-order-id="${state.esc(row.id)}" data-print-file-path="${state.esc(path)}">Reprint request</button>
        </div>
      </div>`;
    }).join('');
  }

  function renderPostPurchaseOrders() {
    const wrap = state.el('postpurchase-orders-wrap');
    if (!wrap) return;

    const rows = state.S.postPurchaseOrders || [];
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">-</div><p>No processed orders found.</p></div>`;
      return;
    }

    wrap.innerHTML = `<div class="pp-processed-list">${rows.map((row) => `
      <article class="pp-processed-card">
        <div class="pp-processed-head">
          <div>
            <div class="pp-order-main">${state.esc(row.orderName || '-')}</div>
            <div class="pp-order-sub">${state.esc(row.xmlFileName || '')}</div>
          </div>
          <div class="pp-processed-time">${state.esc(formatTime(row.queuedDateTime || row.updatedAt || row.importedAt))}</div>
        </div>
        <div class="pp-processed-meta">
          <span><strong>Workflow:</strong> ${state.esc(row.workflowName || row.printerName || '-')}</span>
          <span><strong>Type:</strong> ${state.esc(row.orderType || '-')}</span>
          <span><strong>Size:</strong> ${state.esc(getPageSizes(row))}</span>
        </div>
        <div class="pp-pdf-section">
          <div class="pp-section-label">PDF</div>
          ${renderPdfFiles(row)}
        </div>
        <div class="pp-xml-source">
          <span>${state.esc(fileNameFromPath(row.sourceXmlPath || ''))}</span>
          <button class="btn-sm" type="button" data-copy-path="${state.esc(row.sourceXmlPath || '')}">Copy XML path</button>
        </div>
      </article>
    `).join('')}</div>`;

    bindProcessedOrderActions(wrap);
    if (typeof state.applyRoleUI === 'function') state.applyRoleUI();
  }

  async function copyText(value) {
    const text = String(value || '');
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
  }

  async function openPdfPath(pathValue, fileHref) {
    const pdfPath = String(pathValue || '').trim();
    if (!pdfPath) return;

    const helperUrls = [
      'http://127.0.0.1:17891/open-pdf',
      'http://localhost:17891/open-pdf',
    ];

    for (const url of helperUrls) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: pdfPath }),
        });
        if (response.ok) {
          state.showToast('PDF open request sent', 'success');
          return;
        }
      } catch (error) {
        console.debug('PDF helper unavailable', url, error);
      }
    }

    try {
      window.open(fileHref || uncToFileHref(pdfPath), '_blank', 'noreferrer');
    } catch (error) {
      console.debug('Direct PDF open blocked', error);
    }
    await copyText(pdfPath);
    state.showToast('PDF path copied. Browser blocked direct open.', 'error');
  }

  function getActor() {
    return (state.cfg && state.cfg.userName) || (state.cfg && state.cfg.role) || 'operator';
  }

  async function createReprintRequest(orderId, printFilePath) {
    try {
      const res = await state.fetchImpl('/.netlify/functions/processed-print-orders', {
        method: 'POST',
        headers: state.postPurchaseJsonHeaders(),
        cache: 'no-store',
        body: JSON.stringify({
          action: 'reprint',
          orderId,
          printFilePath,
          requestedBy: getActor(),
          workstationId: state.cfg && state.cfg.deviceId,
        }),
      });
      await readJsonResponse(res, 'Failed to create reprint request');
      state.showToast('Reprint request created', 'success');
    } catch (error) {
      console.error('Reprint request failed', error);
      state.showToast(cleanApiError(error), 'error');
    }
  }

  function bindProcessedOrderActions(wrap) {
    wrap.querySelectorAll('[data-copy-path]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await copyText(button.dataset.copyPath || '');
          state.showToast('Path copied', 'success');
        } catch (error) {
          console.error('Copy path failed', error);
          state.showToast('Copy failed', 'error');
        }
      });
    });
    wrap.querySelectorAll('[data-open-pdf-path]').forEach((button) => {
      button.addEventListener('click', () => {
        openPdfPath(button.dataset.openPdfPath || '', button.dataset.openPdfHref || '');
      });
    });
    wrap.querySelectorAll('[data-reprint-order-id]').forEach((button) => {
      button.addEventListener('click', () => {
        createReprintRequest(button.dataset.reprintOrderId, button.dataset.printFilePath || '');
      });
    });
  }

  async function syncPostPurchaseOrdersManual() {
    state.showToast('Processed XML sync runs on the workstation/server task.', 'error');
  }

  window.PrintGuardPostPurchaseUI = {
    initPostPurchaseUI,
    loadPostPurchaseOrders,
    renderPostPurchaseOrders,
    syncPostPurchaseOrdersManual,
  };
})();
