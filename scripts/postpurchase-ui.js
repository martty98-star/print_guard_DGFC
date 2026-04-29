'use strict';

(() => {
  const REPRINT_REASONS = [
    'Printer dots / contamination',
    'Cutter oil contamination',
    'Incorrect cut / not cut through',
    'Wrong media',
    'Color issue',
    'Damaged during handling',
    'Missing print',
    'Other',
  ];
  const MISSING_PROCESSED_THRESHOLD_MINUTES = 30;

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
    reprintSubmitting: false,
    reprintPendingKeys: new Set(),
    reprintDialog: null,
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

  function isToday(date) {
    const now = new Date();
    return date.getFullYear() === now.getFullYear()
      && date.getMonth() === now.getMonth()
      && date.getDate() === now.getDate();
  }

  function formatPipelineDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const hh = String(date.getHours()).padStart(2, '0');
    const min = String(date.getMinutes()).padStart(2, '0');
    if (isToday(date)) return `${hh}:${min}`;
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}.${mm}.${yyyy} ${hh}:${min}`;
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

  function updateFilterControls() {
    const preset = state.el('postpurchase-date-preset');
    const from = state.el('postpurchase-date-from');
    const to = state.el('postpurchase-date-to');
    const reprint = state.el('postpurchase-reprint-filter');
    if (preset) preset.value = state.S.postPurchaseDatePreset || 'this_month';
    if (from) from.value = state.S.postPurchaseDateFrom || '';
    if (to) to.value = state.S.postPurchaseDateTo || '';
    if (reprint) reprint.value = state.S.postPurchaseReprint || 'all';
  }

  function buildProcessedOrdersUrl() {
    const params = new URLSearchParams();
    params.set('limit', '500');
    params.set('datePreset', state.S.postPurchaseDatePreset || 'this_month');
    params.set('reprint', state.S.postPurchaseReprint || 'all');
    if (state.S.postPurchaseSearch) params.set('q', state.S.postPurchaseSearch);
    if (state.S.postPurchaseMonth) params.set('month', state.S.postPurchaseMonth);
    if ((state.S.postPurchaseDatePreset || '') === 'custom') {
      if (state.S.postPurchaseDateFrom) params.set('from', state.S.postPurchaseDateFrom);
      if (state.S.postPurchaseDateTo) params.set('to', state.S.postPurchaseDateTo);
    }
    return '/.netlify/functions/order-pipeline?' + params.toString();
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
      const payload = await readJsonResponse(res, 'Failed to load order pipeline');
      state.S.postPurchaseOrders = Array.isArray(payload.rows) ? payload.rows : [];
      state.S.postPurchaseLoaded = true;
      updateMonthFilter(payload.months || []);
      updateFilterControls();
      renderPostPurchaseOrders();
      state.elSet('postpurchase-status', `${state.S.postPurchaseOrders.length} pipeline orders`);
    } catch (error) {
      console.error('Order pipeline load failed', error);
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

  function getPipelineAgeMinutes(row) {
    const value = row && (row.receivedAt || row.apiSeenAt);
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? (Date.now() - time) / 60000 : 0;
  }

  function isMissingProcessedXml(row) {
    return row && row.pipelineStatus === 'received_only' && getPipelineAgeMinutes(row) >= MISSING_PROCESSED_THRESHOLD_MINUTES;
  }

  function renderPipelineBadges(row) {
    const badges = [];
    if (row.receivedAt || row.apiSeenAt || row.externalOrderId) {
      badges.push('<span class="pp-pipeline-badge received">RECEIVED</span>');
    }
    if (row.processedOrderId || row.queuedDateTime || row.processedAt) {
      badges.push('<span class="pp-pipeline-badge processed">PROCESSED</span>');
    }
    if (Array.isArray(row.printFiles) && row.printFiles.length) {
      badges.push('<span class="pp-pipeline-badge pdf">PDF</span>');
    }
    if (row.reprintPending || row.pipelineStatus === 'reprint_pending') {
      badges.push('<span class="pp-pipeline-badge reprint">REPRINT PENDING</span>');
    } else if (row.reprintRequestCount > 0) {
      badges.push('<span class="pp-pipeline-badge reprint">REPRINT REQUESTED</span>');
    }
    if (isMissingProcessedXml(row)) {
      badges.push('<span class="pp-pipeline-badge missing">Missing processed XML</span>');
    }
    if (row.pipelineStatus === 'processed_without_received') {
      badges.push('<span class="pp-pipeline-badge orphan">NO API MATCH</span>');
    }
    return badges.join('');
  }

  function renderPdfFiles(row) {
    const files = normalizePrintFiles(row);
    if (!files.length) return '<div class="pp-file-block"><span class="pp-file-name">-</span></div>';
    return files.map((file, index) => {
      const path = file.printFilePath || '';
      const label = fileNameFromPath(path) || `PDF ${index + 1}`;
      const href = uncToFileHref(path);
      const orderId = row.processedOrderId || row.id;
      const pendingKey = getReprintKey(orderId, path);
      const pending = row.reprintPending || state.reprintPendingKeys.has(pendingKey);
      const reprintDisabled = !orderId || !path;
      return `<div class="pp-file-block">
        <div class="pp-file-title">${state.esc(label)}</div>
        <div class="pp-file-path">${state.esc(path || '-')}</div>
        <div class="pp-file-actions">
          <button class="btn-sm" type="button" data-open-pdf-path="${state.esc(path)}" data-open-pdf-href="${state.esc(href)}">Open PDF</button>
          <button class="btn-sm" type="button" data-copy-path="${state.esc(path)}">Copy path</button>
          <button class="btn-sm" type="button" data-reprint-order-id="${state.esc(orderId || '')}" data-reprint-order-name="${state.esc(row.orderName || '')}" data-print-file-path="${state.esc(path)}" data-print-file-label="${state.esc(label)}" ${reprintDisabled ? 'disabled' : ''}>${pending ? 'Reprint pending' : 'Reprint request'}</button>
        </div>
      </div>`;
    }).join('');
  }

  function getReprintKey(orderId, printFilePath) {
    return `${orderId || ''}::${printFilePath || ''}`;
  }

  function renderPostPurchaseOrders() {
    const wrap = state.el('postpurchase-orders-wrap');
    if (!wrap) return;

    const rows = state.S.postPurchaseOrders || [];
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">-</div><p>No orders match the current filters.</p></div>`;
      return;
    }

    wrap.innerHTML = `<div class="pp-processed-list">${rows.map((row) => `
      <article class="pp-processed-card">
        <div class="pp-processed-head">
          <div>
            <div class="pp-order-main">${state.esc(row.orderName || '-')}</div>
            <div class="pp-order-sub">${state.esc([row.externalOrderId, row.customerOrderId, row.xmlFileName].filter(Boolean).join(' · '))}</div>
          </div>
          <div class="pp-processed-time">
            <div>SubmitTool processed: ${state.esc(formatPipelineDateTime(row.processedAt || row.queuedDateTime))}</div>
            <div>Received at: ${state.esc(formatPipelineDateTime(row.receivedAt || row.apiSeenAt))}</div>
          </div>
        </div>
        <div class="pp-pipeline-badges">${renderPipelineBadges(row)}</div>
        ${isMissingProcessedXml(row) ? `<div class="pp-missing-warning">Missing processed XML after ${MISSING_PROCESSED_THRESHOLD_MINUTES} minutes.</div>` : ''}
        <div class="pp-processed-meta">
          <span><strong>Workflow:</strong> ${state.esc(row.workflowName || row.printerName || '-')}</span>
          <span><strong>Type:</strong> ${state.esc(row.orderType || '-')}</span>
          <span><strong>Size:</strong> ${state.esc(getPageSizes(row))}</span>
        </div>
        <div class="pp-pdf-section">
          <div class="pp-section-label">PDF</div>
          ${renderPdfFiles(row)}
        </div>
        ${row.sourceXmlPath ? `<div class="pp-xml-source">
          <span>${state.esc(fileNameFromPath(row.sourceXmlPath || ''))}</span>
          <button class="btn-sm" type="button" data-copy-path="${state.esc(row.sourceXmlPath || '')}">Copy XML path</button>
        </div>` : ''}
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

  async function createReprintRequest(payload) {
    try {
      const res = await state.fetchImpl('/.netlify/functions/processed-print-orders', {
        method: 'POST',
        headers: state.postPurchaseJsonHeaders(),
        cache: 'no-store',
        body: JSON.stringify({
          action: 'reprint',
          orderId: payload.orderId,
          printFilePath: payload.printFilePath,
          reason: payload.reason,
          note: payload.note,
          requestedBy: getActor(),
          workstationId: state.cfg && state.cfg.deviceId,
        }),
      });
      const result = await readJsonResponse(res, 'Failed to create reprint request');
      state.reprintPendingKeys.add(getReprintKey(payload.orderId, payload.printFilePath));
      state.showToast(result && result.alreadyPending ? 'Reprint request already pending' : 'Reprint request created', 'success');
      renderPostPurchaseOrders();
      return result;
    } catch (error) {
      console.error('Reprint request failed', error);
      state.showToast('Reprint request could not be created', 'error');
      throw error;
    }
  }

  function closeReprintDialog() {
    const dialog = document.getElementById('pp-reprint-dialog');
    if (dialog) dialog.remove();
    state.reprintDialog = null;
    state.reprintSubmitting = false;
  }

  function openReprintDialog(input) {
    closeReprintDialog();
    state.reprintDialog = {
      orderId: input.orderId,
      orderName: input.orderName || input.orderId,
      printFilePath: input.printFilePath,
      printFileLabel: input.printFileLabel || fileNameFromPath(input.printFilePath),
    };

    const reasonOptions = REPRINT_REASONS.map((reason) =>
      `<label class="pp-reprint-reason"><input type="radio" name="pp-reprint-reason" value="${state.esc(reason)}"> <span>${state.esc(reason)}</span></label>`
    ).join('');

    const host = document.createElement('div');
    host.id = 'pp-reprint-dialog';
    host.className = 'pp-modal-backdrop';
    host.innerHTML = `<div class="pp-modal" role="dialog" aria-modal="true" aria-labelledby="pp-reprint-title">
      <div class="pp-modal-head">
        <h2 id="pp-reprint-title">Request reprint</h2>
        <button class="btn-sm" type="button" data-reprint-cancel="true">Cancel</button>
      </div>
      <div class="pp-modal-body">
        <div class="pp-modal-field"><span>Order</span><strong>${state.esc(state.reprintDialog.orderName || '-')}</strong></div>
        <div class="pp-modal-field"><span>PDF</span><strong>${state.esc(state.reprintDialog.printFileLabel || '-')}</strong><small>${state.esc(state.reprintDialog.printFilePath || '')}</small></div>
        <div class="pp-reprint-reasons">${reasonOptions}</div>
        <textarea id="pp-reprint-note" class="pp-reprint-note" placeholder="Add details if needed"></textarea>
        <div class="pp-reprint-error" id="pp-reprint-error"></div>
      </div>
      <div class="pp-modal-actions">
        <button class="btn-sm" type="button" data-reprint-cancel="true">Cancel</button>
        <button class="btn-sm" type="button" id="pp-reprint-create">Create request</button>
      </div>
    </div>`;
    document.body.appendChild(host);
    host.querySelectorAll('[data-reprint-cancel]').forEach((button) => {
      button.addEventListener('click', closeReprintDialog);
    });
    host.addEventListener('click', (event) => {
      if (event.target === host) closeReprintDialog();
    });
    host.querySelector('#pp-reprint-create')?.addEventListener('click', submitReprintDialog);
  }

  async function submitReprintDialog() {
    if (state.reprintSubmitting || !state.reprintDialog) return;
    const dialog = document.getElementById('pp-reprint-dialog');
    const errorNode = dialog && dialog.querySelector('#pp-reprint-error');
    const createButton = dialog && dialog.querySelector('#pp-reprint-create');
    const selected = dialog && dialog.querySelector('input[name="pp-reprint-reason"]:checked');
    const reason = selected ? selected.value : '';
    const note = String((dialog && dialog.querySelector('#pp-reprint-note')?.value) || '').trim();

    if (!reason) {
      if (errorNode) errorNode.textContent = 'Reason is required.';
      return;
    }
    if (reason === 'Other' && !note) {
      if (errorNode) errorNode.textContent = 'Note is required for Other.';
      return;
    }

    state.reprintSubmitting = true;
    if (createButton) createButton.disabled = true;
    if (errorNode) errorNode.textContent = '';

    try {
      await createReprintRequest({
        ...state.reprintDialog,
        reason,
        note,
      });
      closeReprintDialog();
    } catch (error) {
      if (errorNode) errorNode.textContent = 'Reprint request could not be created.';
      if (createButton) createButton.disabled = false;
      state.reprintSubmitting = false;
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
        openReprintDialog({
          orderId: button.dataset.reprintOrderId,
          orderName: button.dataset.reprintOrderName,
          printFilePath: button.dataset.printFilePath || '',
          printFileLabel: button.dataset.printFileLabel,
        });
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
