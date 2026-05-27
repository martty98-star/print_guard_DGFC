'use strict';

(() => {
  const Api = window.PrintGuardOrderPipelineApi;
  const Filters = window.PrintGuardOrderPipelineFilters;
  const Render = window.PrintGuardOrderPipelineRender;
  const ReprintModal = window.PrintGuardReprintModal;
  const ReprintXml = window.PrintGuardReprintXml;
  const PdfOpen = window.PrintGuardPdfOpen;

  function t(key) {
    return window.I18N && typeof window.I18N.t === 'function' ? window.I18N.t(key) : key;
  }

  if (!Api || !Filters || !Render || !ReprintModal || !ReprintXml || !PdfOpen) {
    throw new Error('Missing Processed Print Orders modules');
  }

  const state = {
    S: null,
    cfg: null,
    el: null,
    elSet: null,
    esc: null,
    showToast: null,
    applyRoleUI: null,
    adminJsonHeaders: null,
    postPurchaseHeaders: null,
    postPurchaseJsonHeaders: null,
    postPurchaseErrorMessage: null,
    requirePostPurchasePinForScreen: null,
    renderPostPurchaseAccessRequired: null,
    fetchImpl: null,
    reprintPendingKeys: new Set(),
    reprintHistoryByKey: new Map(),
    reprintActionStateByKey: new Map(),
    reprintStateTimers: new Map(),
    reprintRefreshTimer: null,
    controlsBound: false,
  };

  function initPostPurchaseUI(deps) {
    Object.assign(state, deps || {});
    if (!state.S || !state.cfg || !state.el || !state.elSet) {
      throw new Error('Missing Processed Print Orders UI dependencies');
    }
    if (!(state.reprintPendingKeys instanceof Set)) state.reprintPendingKeys = new Set();
    if (!(state.reprintHistoryByKey instanceof Map)) state.reprintHistoryByKey = new Map();
    if (!(state.reprintActionStateByKey instanceof Map)) state.reprintActionStateByKey = new Map();
    if (!(state.reprintStateTimers instanceof Map)) state.reprintStateTimers = new Map();
  }

  function cleanApiError(error) {
    if (typeof state.postPurchaseErrorMessage === 'function') {
      return state.postPurchaseErrorMessage(error);
    }
    return error && error.message ? error.message : t('processed.error.database');
  }

  function updateMonthFilter(months) {
    const select = state.el('postpurchase-month-filter');
    if (!select) return;
    const current = state.S.postPurchaseMonth || '';
    const options = [`<option value="">${t('processed.month.all')}</option>`]
      .concat((months || []).map(month => `<option value="${state.esc(month)}">${state.esc(month)}</option>`));
    select.innerHTML = options.join('');
    select.value = current;
  }

  function updateFilterControls() {
    const preset = state.el('postpurchase-date-preset');
    const month = state.el('postpurchase-month-filter');
    const from = state.el('postpurchase-date-from');
    const to = state.el('postpurchase-date-to');
    const reprint = state.el('postpurchase-reprint-filter');
    const advanced = document.querySelector('.pp-filter-advanced');
    if (preset) preset.value = state.S.postPurchaseDatePreset || 'this_month';
    if (month) month.value = state.S.postPurchaseMonth || '';
    if (from) from.value = state.S.postPurchaseDateFrom || '';
    if (to) to.value = state.S.postPurchaseDateTo || '';
    if (reprint) reprint.value = state.S.postPurchaseReprint || 'all';
    if (advanced) {
      advanced.open = Boolean(
        (state.S.postPurchaseReprint || 'all') !== 'all' ||
        Boolean(state.S.postPurchaseMonth) ||
        Boolean(state.S.postPurchaseDateFrom) ||
        Boolean(state.S.postPurchaseDateTo) ||
        (state.S.postPurchaseDatePreset || 'this_month') !== 'this_month'
      );
    }
    document.querySelectorAll('[data-postpurchase-status]').forEach((button) => {
      const active = (button.dataset.postpurchaseStatus || 'all') === (state.S.postPurchaseStatus || 'all');
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function getQuickFilterLabel(status) {
    const normalized = String(status || 'all');
    const labels = {
      all: 'processed.quick.all',
      needs_attention: 'processed.quick.attention',
      received_only: 'processed.quick.unprocessed',
      reprint_pending: 'processed.quick.reprint-backlog',
      no_api_match: 'processed.quick.no-api-match',
    };
    return t(labels[normalized] || labels.all);
  }

  function getReprintFilterLabel(reprint) {
    const normalized = String(reprint || 'all');
    const labels = {
      all: 'processed.reprint.all',
      has_reprint: 'processed.reprint.has',
      pending: 'processed.reprint.pending',
      completed: 'processed.reprint.completed',
      none: 'processed.reprint.none',
    };
    return t(labels[normalized] || labels.all);
  }

  function getActiveFilterLabel(filters) {
    if (!filters) return '';
    if (filters.status && filters.status !== 'all') return getQuickFilterLabel(filters.status);
    if (filters.reprint && filters.reprint !== 'all') return getReprintFilterLabel(filters.reprint);
    if (filters.month) return `${t('processed.filters.month')}: ${filters.month}`;
    if ((filters.datePreset || 'this_month') !== 'this_month') return t(`processed.date.${String(filters.datePreset || '').replace(/_/g, '-')}`) || String(filters.datePreset || '');
    return '';
  }

  function setReprintActionState(key, nextState, options = {}) {
    if (!key) return;
    const current = state.reprintActionStateByKey.get(key) || {};
    const value = {
      ...current,
      ...nextState,
      updatedAt: Date.now(),
    };
    state.reprintActionStateByKey.set(key, value);
    if (options.clearAfterMs != null) {
      const existingTimer = state.reprintStateTimers.get(key);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        state.reprintActionStateByKey.delete(key);
        state.reprintStateTimers.delete(key);
        renderPostPurchaseOrders();
      }, options.clearAfterMs);
      state.reprintStateTimers.set(key, timer);
    }
  }

  function clearReprintActionState(key) {
    if (!key) return;
    const existingTimer = state.reprintStateTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);
    state.reprintStateTimers.delete(key);
    state.reprintActionStateByKey.delete(key);
  }

  function markReprintHistoryDone(request) {
    if (!request) return;
    const key = Render.getReprintKey(request.orderId, request.printFilePath);
    const history = state.reprintHistoryByKey.get(key);
    if (Array.isArray(history)) {
      history.forEach((entry) => {
        if (entry && String(entry.status || '').toLowerCase() === 'pending') {
          entry.status = request.status || 'done';
          if (!entry.confirmedAt) entry.confirmedAt = request.confirmedAt || new Date().toISOString();
        }
      });
      state.reprintHistoryByKey.set(key, history);
    }
    state.reprintPendingKeys.delete(key);
  }

  function adjustStatsAfterReprintResolve() {
    const stats = state.S.postPurchaseStats;
    if (!stats) return;
    for (const bucket of ['global', 'scope']) {
      const current = stats[bucket];
      if (!current) continue;
      current.reprintBacklog = Math.max(0, Number(current.reprintBacklog || 0) - 1);
      current.needsAttention = Math.max(0, Number(current.needsAttention || 0) - 1);
    }
  }

  function schedulePostPurchaseRefresh(delayMs = 1200) {
    if (state.reprintRefreshTimer) clearTimeout(state.reprintRefreshTimer);
    state.reprintRefreshTimer = setTimeout(() => {
      state.reprintRefreshTimer = null;
      loadPostPurchaseOrders(true);
    }, delayMs);
  }

  function getOperatorName() {
    return (state.cfg && state.cfg.userName) || '';
  }

  function getRenderOptions() {
    return {
      esc: state.esc,
      isAdmin: Boolean(state.cfg && state.cfg.role === 'admin' && state.cfg.adminPin),
      reprintActionStateByKey: state.reprintActionStateByKey,
      reprintHistoryByKey: state.reprintHistoryByKey,
      reprintPendingKeys: state.reprintPendingKeys,
      stats: state.S.postPurchaseStats,
      toFileHref: PdfOpen.uncToFileHref,
    };
  }

  function getVisibleOrders() {
    return state.S.postPurchaseOrders || [];
  }

  function setPostPurchaseQuickFilter(status) {
    state.S.postPurchaseStatus = status || 'all';
    state.S.postPurchaseReprint = 'all';
    if (state.el('postpurchase-reprint-filter')) state.el('postpurchase-reprint-filter').value = 'all';
    document.querySelectorAll('[data-postpurchase-status]').forEach((button) => {
      const active = (button.dataset.postpurchaseStatus || 'all') === state.S.postPurchaseStatus;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    loadPostPurchaseOrders(true);
  }

  function resetPostPurchaseFilters() {
    if (state.S.postPurchaseSearchTimer) clearTimeout(state.S.postPurchaseSearchTimer);
    state.S.postPurchaseSearchTimer = null;
    state.S.postPurchaseSearch = '';
    state.S.postPurchaseMonth = '';
    state.S.postPurchaseDatePreset = 'this_month';
    state.S.postPurchaseDateFrom = '';
    state.S.postPurchaseDateTo = '';
    state.S.postPurchaseStatus = 'all';
    state.S.postPurchaseReprint = 'all';
    if (state.el('postpurchase-search')) state.el('postpurchase-search').value = '';
    if (state.el('postpurchase-date-preset')) state.el('postpurchase-date-preset').value = 'this_month';
    if (state.el('postpurchase-month-filter')) state.el('postpurchase-month-filter').value = '';
    if (state.el('postpurchase-date-from')) state.el('postpurchase-date-from').value = '';
    if (state.el('postpurchase-date-to')) state.el('postpurchase-date-to').value = '';
    if (state.el('postpurchase-reprint-filter')) state.el('postpurchase-reprint-filter').value = 'all';
    document.querySelectorAll('[data-postpurchase-status]').forEach((button) => {
      const active = (button.dataset.postpurchaseStatus || 'all') === 'all';
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    loadPostPurchaseOrders(true);
  }

  function bindPostPurchaseControls() {
    if (state.controlsBound) return;
    state.controlsBound = true;

    state.el('postpurchase-refresh-btn')?.addEventListener('click', () => {
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-search')?.addEventListener('input', e => {
      state.S.postPurchaseSearch = e.target.value || '';
      if (state.S.postPurchaseSearchTimer) clearTimeout(state.S.postPurchaseSearchTimer);
      if (state.S.postPurchaseLoaded) state.elSet('postpurchase-status', t('processed.status.searching'));
      state.S.postPurchaseSearchTimer = setTimeout(() => {
        loadPostPurchaseOrders(true);
      }, 300);
    });
    state.el('postpurchase-date-preset')?.addEventListener('change', e => {
      state.S.postPurchaseDatePreset = e.target.value || 'this_month';
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-month-filter')?.addEventListener('change', e => {
      state.S.postPurchaseMonth = e.target.value || '';
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-date-from')?.addEventListener('change', e => {
      state.S.postPurchaseDateFrom = e.target.value || '';
      if (state.S.postPurchaseDateFrom || state.S.postPurchaseDateTo) state.S.postPurchaseDatePreset = 'custom';
      if (state.el('postpurchase-date-preset')) state.el('postpurchase-date-preset').value = state.S.postPurchaseDatePreset;
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-date-to')?.addEventListener('change', e => {
      state.S.postPurchaseDateTo = e.target.value || '';
      if (state.S.postPurchaseDateFrom || state.S.postPurchaseDateTo) state.S.postPurchaseDatePreset = 'custom';
      if (state.el('postpurchase-date-preset')) state.el('postpurchase-date-preset').value = state.S.postPurchaseDatePreset;
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-reprint-filter')?.addEventListener('change', e => {
      state.S.postPurchaseReprint = e.target.value || 'all';
      loadPostPurchaseOrders(true);
    });
    document.querySelectorAll('[data-postpurchase-status]').forEach((button) => {
      button.addEventListener('click', () => {
        setPostPurchaseQuickFilter(button.dataset.postpurchaseStatus || 'all');
      });
    });
    state.el('postpurchase-clear-filters')?.addEventListener('click', resetPostPurchaseFilters);
    state.el('postpurchase-unlock-btn')?.addEventListener('click', () => {
      const pin = (state.el('postpurchase-pin')?.value || '').trim();
      if (!pin) {
        state.showToast(t('processed.pin.enter'), 'error');
        return;
      }
      state.cfg.postPurchasePin = pin;
      if (state.el('postpurchase-pin')) state.el('postpurchase-pin').value = '';
      state.S.postPurchaseLoaded = false;
      state.showToast(t('processed.toast.unlocked'), 'success');
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-lock-btn')?.addEventListener('click', () => {
      state.cfg.postPurchasePin = '';
      state.S.postPurchaseLoaded = false;
      state.S.postPurchaseOrders = [];
      state.renderPostPurchaseAccessRequired();
      state.showToast(t('processed.toast.locked'), 'success');
    });
    state.el('postpurchase-sync-btn')?.addEventListener('click', () => {
      syncPostPurchaseOrdersManual();
    });
  }

  function hasScopedStatsFilter(filters) {
    return Boolean(
      (filters.q || '').trim() ||
      filters.status !== 'all' ||
      filters.reprint !== 'all' ||
      filters.month ||
      filters.datePreset !== 'this_month' ||
      filters.from ||
      filters.to
    );
  }

  function buildOrderPipelineFilters(append) {
    const filters = Filters.getFiltersFromState(state.S);
    if (append) {
      filters.includeStats = 'none';
    } else if (hasScopedStatsFilter(filters)) {
      filters.includeStats = 'global,scope';
    } else {
      filters.includeStats = 'global';
    }
    return filters;
  }

  function getProcessedOrderId(row) {
    return row && (row.processedOrderId || row.id);
  }

  function findOrderAndPrintFile(orderId, printFilePath) {
    const rows = state.S.postPurchaseOrders || [];
    const id = String(orderId || '');
    for (const row of rows) {
      if (String(getProcessedOrderId(row) || '') !== id) continue;
      if (!printFilePath) return { row, printFile: null };
      const files = Array.isArray(row.printFiles) ? row.printFiles : [];
      const printFile = files.find((file) => (file.printFilePath || '') === printFilePath);
      if (printFile) return { row, printFile };
    }
    return { row: null, printFile: null };
  }

  function storeReprintHistory(requests) {
    state.reprintHistoryByKey = new Map();
    (Array.isArray(requests) ? requests : []).forEach((request) => {
      const key = Render.getReprintKey(request.orderId, request.printFilePath);
      if (!state.reprintHistoryByKey.has(key)) state.reprintHistoryByKey.set(key, []);
      state.reprintHistoryByKey.get(key).push(request);
    });
  }

  async function loadVisibleReprintHistory() {
    const orderIds = (state.S.postPurchaseOrders || [])
      .filter((row) => row && row.hasDetail)
      .map(getProcessedOrderId)
      .filter(Boolean);
    if (!orderIds.length) {
      storeReprintHistory([]);
      return;
    }
    try {
      const payload = await Api.loadReprintHistory({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseHeaders(),
        orderIds,
      });
      storeReprintHistory(payload.requests || []);
    } catch (error) {
      console.error('Reprint history load failed', error);
      storeReprintHistory([]);
    }
  }

  async function createReprintRequest(payload) {
    try {
      const selected = findOrderAndPrintFile(payload.orderId, payload.printFilePath);
      const result = await Api.createReprintRequest({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseJsonHeaders(),
        payload: {
          ...payload,
          requestedBy: payload.operatorName,
          workstationId: state.cfg && state.cfg.deviceId,
        },
      });
      state.reprintPendingKeys.add(Render.getReprintKey(payload.orderId, payload.printFilePath));
      const downloadOrderName = payload.orderName || (selected.row && (selected.row.externalOrderId || selected.row.customerOrderId || selected.row.orderName)) || payload.orderId;
      if (selected.row) {
        const xml = ReprintXml.generateReprintXml(selected.row, selected.printFile);
        ReprintXml.downloadXml(xml, downloadOrderName);
      }
      state.showToast(t('processed.toast.reprint-created'), 'success');
      state.S.postPurchaseLoaded = false;
      await loadPostPurchaseOrders(true);
      return result;
    } catch (error) {
      console.error('Reprint request failed', error);
      state.showToast(t('processed.toast.reprint-create-failed'), 'error');
      throw error;
    }
  }

  async function resolveReprintRequest(payload) {
    const key = Render.getReprintKey(payload.orderId, payload.printFilePath);
    setReprintActionState(key, {
      state: 'resolving',
      message: t('processed.action.reprint-resolving-text'),
    });
    renderPostPurchaseOrders();
    try {
      const result = await Api.resolveReprintRequest({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseJsonHeaders(),
        payload,
      });
      markReprintHistoryDone(result.request);
      adjustStatsAfterReprintResolve();
      state.showToast(t('processed.toast.reprint-done'), 'success');
      setReprintActionState(key, {
        state: 'resolved',
        message: t('processed.action.reprint-resolved-text'),
      }, { clearAfterMs: 2500 });
      renderPostPurchaseOrders();
      schedulePostPurchaseRefresh(1200);
      return result;
    } catch (error) {
      console.error('Resolve reprint request failed', error);
      setReprintActionState(key, {
        state: 'error',
        message: error && error.message ? error.message : t('processed.toast.reprint-resolve-failed'),
      });
      renderPostPurchaseOrders();
      state.showToast(error && error.message ? error.message : t('processed.toast.reprint-resolve-failed'), 'error');
      throw error;
    }
  }

  async function deleteReprintRequest(payload) {
    const admin = payload && payload.admin;
    const confirmed = window.confirm(admin
      ? t('processed.confirm.delete-reprint')
      : t('processed.confirm.cancel-reprint'));
    if (!confirmed) return;
    try {
      await Api.deleteReprintRequest({
        fetchImpl: state.fetchImpl,
        headers: admin && typeof state.adminJsonHeaders === 'function'
          ? state.adminJsonHeaders()
          : state.postPurchaseJsonHeaders(),
        payload: {
          id: payload.id,
          action: admin ? 'delete_reprint' : 'cancel_reprint',
        },
      });
      state.showToast(admin ? t('processed.toast.reprint-deleted') : t('processed.toast.reprint-cancelled'), 'success');
      state.S.postPurchaseLoaded = false;
      await loadPostPurchaseOrders(true);
    } catch (error) {
      console.error('Delete reprint request failed', error);
      state.showToast(error && error.message ? error.message : t('processed.toast.reprint-delete-failed'), 'error');
      throw error;
    }
  }

  async function loadOrderDetail(orderId, orderNumber) {
    const rows = state.S.postPurchaseOrders || [];
    const index = rows.findIndex((row) => {
      const sameId = orderId && String(getProcessedOrderId(row) || '') === String(orderId);
      const sameOrder = orderNumber && String(row.orderName || '') === String(orderNumber);
      return sameId || sameOrder;
    });
    if (index < 0) return;

    try {
      const payload = await Api.loadOrderPipelineDetail({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseHeaders(),
        id: orderId,
        orderNumber,
      });
      if (payload.row) {
        rows[index] = { ...rows[index], ...payload.row, hasDetail: true };
        state.S.postPurchaseOrders = rows;
        await loadVisibleReprintHistory();
        renderPostPurchaseOrders();
      }
    } catch (error) {
      console.error('Order pipeline detail load failed', error);
      state.showToast(cleanApiError(error), 'error');
    }
  }

  async function loadPostPurchaseOrders(force = false, options = {}) {
    const append = Boolean(options.append);
    if (state.S.postPurchaseLoading) {
      if (append) return;
      if (state.S.postPurchaseAbortController) state.S.postPurchaseAbortController.abort();
    }
    if (state.S.postPurchaseLoaded && !force && !append) {
      renderPostPurchaseOrders();
      return;
    }
    if (!state.requirePostPurchasePinForScreen()) return;

    if (!append) state.S.postPurchaseOffset = 0;
    const controller = !append && typeof AbortController !== 'undefined' ? new AbortController() : null;
    if (controller) state.S.postPurchaseAbortController = controller;
    state.S.postPurchaseLoading = true;
    state.elSet('postpurchase-status', t('processed.status.loading'));
    const wrap = state.el('postpurchase-orders-wrap');
    if (wrap && !(state.S.postPurchaseOrders || []).length) {
      wrap.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${t('processed.loading')}</p></div>`;
    }

    try {
      const payload = await Api.loadOrderPipeline({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseHeaders(),
        filters: buildOrderPipelineFilters(append),
        signal: controller ? controller.signal : undefined,
      });
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      state.S.postPurchaseOrders = append ? (state.S.postPurchaseOrders || []).concat(rows) : rows;
      state.S.postPurchaseOffset = Number(payload.page?.nextOffset ?? payload.nextOffset) || state.S.postPurchaseOrders.length;
      state.S.postPurchaseHasMore = Boolean(payload.page?.hasMore ?? payload.hasMore);
      if (payload.stats) state.S.postPurchaseStats = payload.stats;
      await loadVisibleReprintHistory();
      state.S.postPurchaseLoaded = true;
      updateMonthFilter(payload.months || []);
      updateFilterControls();
      renderPostPurchaseOrders();
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      console.error('Order pipeline load failed', error);
      const message = cleanApiError(error);
      if (wrap && !(state.S.postPurchaseOrders || []).length) {
        wrap.innerHTML = Render.renderError(message, state.esc);
        wrap.querySelector('[data-pp-retry="true"]')?.addEventListener('click', () => loadPostPurchaseOrders(true));
      } else {
        renderPostPurchaseOrders();
      }
      state.elSet('postpurchase-status', t('processed.status.load-failed'));
      state.showToast(message, 'error');
    } finally {
      if (!controller || state.S.postPurchaseAbortController === controller) {
        state.S.postPurchaseLoading = false;
        if (controller) state.S.postPurchaseAbortController = null;
      }
    }
  }

  async function updateOrderAdminStatus(payload) {
    const action = payload && payload.action;
    const confirmed = window.confirm(action === 'delete_order'
      ? t('processed.confirm.delete-order')
      : t('processed.confirm.cancel-order'));
    if (!confirmed) return;
    try {
      await Api.updateOrderAdminStatus({
        fetchImpl: state.fetchImpl,
        headers: state.adminJsonHeaders(),
        payload,
      });
      state.showToast(action === 'delete_order'
        ? t('processed.toast.order-deleted')
        : t('processed.toast.order-cancelled'), 'success');
      state.S.postPurchaseLoaded = false;
      await loadPostPurchaseOrders(true);
    } catch (error) {
      console.error('Admin order action failed', error);
      state.showToast(error && error.message ? error.message : t('processed.toast.order-action-failed'), 'error');
      throw error;
    }
  }

  function renderPostPurchaseOrders() {
    const wrap = state.el('postpurchase-orders-wrap');
    if (!wrap) return;
    const rows = getVisibleOrders();
    const searchActive = Boolean((state.S.postPurchaseSearch || '').trim());
    const activeFilterLabel = getActiveFilterLabel(Filters.getFiltersFromState(state.S));
    wrap.innerHTML = Render.renderOrders(rows, getRenderOptions())
      + (state.S.postPurchaseHasMore
        ? `<div class="pp-load-more-wrap"><button class="btn-sm" type="button" data-pp-load-more="true">${t('processed.button.load-more')}</button></div>`
        : '');
    bindProcessedOrderActions(wrap);
    state.elSet('postpurchase-status', searchActive
      ? `${rows.length} ${t('processed.status.search-results')}${activeFilterLabel ? ` · ${activeFilterLabel}` : ''}`
      : `${rows.length} ${t('processed.status.rows')}${activeFilterLabel ? ` · ${activeFilterLabel}` : ''}`);
    if (typeof state.applyRoleUI === 'function') state.applyRoleUI();
  }

  function bindProcessedOrderActions(wrap) {
    wrap.querySelectorAll('[data-copy-path]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await PdfOpen.copyText(button.dataset.copyPath || '');
          state.showToast(t('processed.toast.path-copied'), 'success');
        } catch (error) {
          console.error('Copy path failed', error);
          state.showToast(t('processed.toast.copy-failed'), 'error');
        }
      });
    });
    wrap.querySelectorAll('[data-load-order-detail-id], [data-load-order-detail-number]').forEach((button) => {
      button.addEventListener('click', () => {
        button.disabled = true;
        button.textContent = t('processed.status.loading');
        loadOrderDetail(button.dataset.loadOrderDetailId, button.dataset.loadOrderDetailNumber).finally(() => {
          button.disabled = false;
        });
      });
    });
    wrap.querySelector('[data-pp-load-more="true"]')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = t('processed.status.loading');
      loadPostPurchaseOrders(true, { append: true }).finally(() => {
        button.disabled = false;
      });
    });
    wrap.querySelectorAll('[data-open-pdf-path]').forEach((button) => {
      button.addEventListener('click', () => {
        PdfOpen.openPdfPath({
          path: button.dataset.openPdfPath || '',
          fileHref: button.dataset.openPdfHref || '',
          fetchImpl: state.fetchImpl,
          showToast: state.showToast,
        });
      });
    });
    wrap.querySelectorAll('[data-reprint-order-id]').forEach((button) => {
      button.addEventListener('click', () => {
        ReprintModal.open({
          orderId: button.dataset.reprintOrderId,
          orderName: button.dataset.reprintOrderName,
          operatorName: getOperatorName(),
          printFilePath: button.dataset.printFilePath || '',
          printFileLabel: button.dataset.printFileLabel,
        }, {
          esc: state.esc,
          fileNameFromPath: Render.fileNameFromPath,
          onSubmit: createReprintRequest,
        });
      });
    });
    wrap.querySelectorAll('[data-resolve-reprint-order-id]').forEach((button) => {
      button.addEventListener('click', () => {
        resolveReprintRequest({
          orderId: button.dataset.resolveReprintOrderId,
          printFilePath: button.dataset.resolvePrintFilePath || '',
        });
      });
    });
    wrap.querySelectorAll('[data-delete-reprint-request-id]').forEach((button) => {
      button.addEventListener('click', () => {
        button.disabled = true;
        deleteReprintRequest({
          id: button.dataset.deleteReprintRequestId,
          admin: button.dataset.deleteReprintAdmin === 'true',
        }).catch(() => {
          button.disabled = false;
        });
      });
    });
    wrap.querySelectorAll('[data-admin-order-action]').forEach((button) => {
      button.addEventListener('click', () => {
        button.disabled = true;
        updateOrderAdminStatus({
          action: button.dataset.adminOrderAction,
          processedOrderId: button.dataset.adminOrderProcessedId,
          externalOrderId: button.dataset.adminOrderExternalId,
          orderNumber: button.dataset.adminOrderNumber,
        }).catch(() => {
          button.disabled = false;
        });
      });
    });
  }

  async function syncPostPurchaseOrdersManual() {
    state.showToast(t('processed.toast.sync-server-task'), 'error');
  }

  window.PrintGuardPostPurchaseUI = {
    bindPostPurchaseControls,
    initPostPurchaseUI,
    loadPostPurchaseOrders,
    renderPostPurchaseOrders,
    syncPostPurchaseOrdersManual,
  };
})();
