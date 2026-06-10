'use strict';

(() => {
  const Api = window.PrintGuardOrderPipelineApi;
  const Filters = window.PrintGuardOrderPipelineFilters;
  const Render = window.PrintGuardOrderPipelineRender;
  const ReprintModal = window.PrintGuardReprintModal;
  const ReprintXml = window.PrintGuardReprintXml;
  const PdfOpen = window.PrintGuardPdfOpen;
  const Queue = window.PrintGuardOperatorQueueMode;
  const SCREEN_KEY = 'postpurchase-orders';

  function t(key) {
    return window.I18N && typeof window.I18N.t === 'function'
      ? window.I18N.t(key)
      : key;
  }

  if (
    !Api ||
    !Filters ||
    !Render ||
    !ReprintModal ||
    !ReprintXml ||
    !PdfOpen ||
    !Queue
  ) {
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
    rowRemovalTimers: new Map(),
    expandedOrderIds: new Set(),
    orderDetailCacheById: new Map(),
    activeOrderId: null,
    controlsBound: false,
  };

  function initPostPurchaseUI(deps) {
    Object.assign(state, deps || {});
    if (!state.S || !state.cfg || !state.el || !state.elSet) {
      throw new Error('Missing Processed Print Orders UI dependencies');
    }
    if (!(state.reprintPendingKeys instanceof Set))
      state.reprintPendingKeys = new Set();
    if (!(state.reprintHistoryByKey instanceof Map))
      state.reprintHistoryByKey = new Map();
    if (!(state.reprintActionStateByKey instanceof Map))
      state.reprintActionStateByKey = new Map();
    if (!(state.reprintStateTimers instanceof Map))
      state.reprintStateTimers = new Map();
    if (!(state.rowRemovalTimers instanceof Map))
      state.rowRemovalTimers = new Map();
    if (!(state.expandedOrderIds instanceof Set))
      state.expandedOrderIds = new Set();
    if (!(state.orderDetailCacheById instanceof Map))
      state.orderDetailCacheById = new Map();
  }

  function cleanApiError(error) {
    if (typeof state.postPurchaseErrorMessage === 'function') {
      return state.postPurchaseErrorMessage(error);
    }
    return error && error.message
      ? error.message
      : t('processed.error.database');
  }

  function updateMonthFilter(months) {
    const select = state.el('postpurchase-month-filter');
    if (!select) return;
    const current = state.S.postPurchaseMonth || '';
    const options = [
      `<option value="">${t('processed.month.all')}</option>`,
    ].concat(
      (months || []).map(
        (month) =>
          `<option value="${state.esc(month)}">${state.esc(month)}</option>`,
      ),
    );
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
          (state.S.postPurchaseDatePreset || 'this_month') !== 'this_month',
      );
    }
    document
      .querySelectorAll('[data-postpurchase-status]')
      .forEach((button) => {
        const active =
          (button.dataset.postpurchaseStatus || 'all') ===
          (state.S.postPurchaseStatus || 'all');
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
      physically_printed: 'processed.quick.printed-out',
      printed_out: 'processed.quick.printed-out',
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
    if (filters.status && filters.status !== 'all')
      return getQuickFilterLabel(filters.status);
    if (filters.reprint && filters.reprint !== 'all')
      return getReprintFilterLabel(filters.reprint);
    if (filters.month)
      return `${t('processed.filters.month')}: ${filters.month}`;
    if ((filters.datePreset || 'this_month') !== 'this_month')
      return (
        t(
          `processed.date.${String(filters.datePreset || '').replace(/_/g, '-')}`,
        ) || String(filters.datePreset || '')
      );
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

  function getOrderStateId(rowOrId) {
    if (rowOrId && typeof rowOrId === 'object') {
      return String(rowOrId.processedOrderId || rowOrId.id || '').trim();
    }
    return String(rowOrId || '').trim();
  }

  function rememberDetailedOrder(row) {
    const orderId = getOrderStateId(row);
    if (!orderId || !row || !row.hasDetail) return;
    state.expandedOrderIds.add(orderId);
    state.activeOrderId = orderId;
    state.orderDetailCacheById.set(orderId, { ...row });
  }

  function mergeCachedDetails(rows) {
    return (Array.isArray(rows) ? rows : []).map((row) => {
      const orderId = getOrderStateId(row);
      if (!orderId || !state.expandedOrderIds.has(orderId)) return row;
      const cached = state.orderDetailCacheById.get(orderId);
      if (!cached) return row;
      return {
        ...row,
        ...cached,
        ...row,
        hasDetail: true,
        printFiles: cached.printFiles || row.printFiles,
        reprintRecords: row.reprintRecords || cached.reprintRecords,
      };
    });
  }

  function captureQueueState() {
    return Queue.captureQueueUiState(SCREEN_KEY, {
      filters: Filters.getFiltersFromState(state.S),
      search: state.S.postPurchaseSearch,
      sort: '',
      visibleLimit: Math.max(
        Number(state.S.postPurchaseOffset || 0),
        (state.S.postPurchaseOrders || []).length,
        Number(state.S.postPurchaseLimit || 50),
      ),
      loadedPages: [
        {
          offset: 0,
          limit: Math.max(
            Number(state.S.postPurchaseOffset || 0),
            (state.S.postPurchaseOrders || []).length,
          ),
        },
      ],
      expandedRowIds: state.expandedOrderIds,
      activeRowId: state.activeOrderId,
      queueSnapshotOrder: (state.S.postPurchaseOrders || []).map(
        getOrderStateId,
      ),
    });
  }

  function captureScrollPosition(options = {}) {
    if (!options.preserveScroll) return null;
    return captureQueueState();
  }

  function restoreScrollPosition(position) {
    if (!position) return;
    Queue.restoreQueueUiState(SCREEN_KEY, position);
  }

  function renderQueuePreserved() {
    return Queue.preserveScrollDuringRender(
      () => renderPostPurchaseOrders(),
      SCREEN_KEY,
    );
  }

  function debugOrdersUi(action, details = {}) {
    try {
      if (window.localStorage?.pg_debug_orders !== '1') return;
    } catch {
      return;
    }
    console.log('[orders-ui]', {
      action,
      visibleRows: (state.S.postPurchaseOrders || []).length,
      offset: state.S.postPurchaseOffset,
      scrollY: window.scrollY || 0,
      ...details,
    });
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
          if (!entry.confirmedAt)
            entry.confirmedAt = request.confirmedAt || new Date().toISOString();
          if (!entry.confirmedBy && request.confirmedBy)
            entry.confirmedBy = request.confirmedBy;
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
      current.reprintBacklog = Math.max(
        0,
        Number(current.reprintBacklog || 0) - 1,
      );
      current.needsAttention = Math.max(
        0,
        Number(current.needsAttention || 0) - 1,
      );
    }
  }

  function schedulePostPurchaseRefresh(delayMs = 1200, options = {}) {
    debugOrdersUi('background-refresh-scheduled', {
      delayMs,
      preserveLoadedDepth: options.preserveLoadedDepth !== false,
    });
    Queue.scheduleNonDisruptiveRefresh(
      SCREEN_KEY,
      (refreshOptions) => {
        debugOrdersUi('background-refresh-start');
        loadPostPurchaseOrders(true, {
          ...refreshOptions,
          ...options,
        });
      },
      { delayMs },
    );
  }

  function getOperatorName() {
    return (state.cfg && state.cfg.userName) || '';
  }

  function getRenderOptions() {
    return {
      esc: state.esc,
      isAdmin: Boolean(
        state.cfg && state.cfg.role === 'admin' && state.cfg.adminPin,
      ),
      reprintActionStateByKey: state.reprintActionStateByKey,
      reprintHistoryByKey: state.reprintHistoryByKey,
      reprintPendingKeys: state.reprintPendingKeys,
      stats: state.S.postPurchaseStats,
      toPdfHref: PdfOpen.buildPdfProxyUrl,
    };
  }

  function getVisibleOrders() {
    return state.S.postPurchaseOrders || [];
  }

  function isAlreadyDoneError(error) {
    const text = [
      error && error.message,
      error && error.payload && error.payload.error,
      error && error.payload && error.payload.code,
      error && error.payload && error.payload.status,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return (
      error &&
      (error.status === 404 || error.status === 409 || error.status === 410) &&
      /already|done|resolved|completed|hotovo|nenalezen|not found/.test(text)
    );
  }

  function removeReprintHistoryRequest(requestId) {
    const id = String(requestId || '');
    if (!id) return null;
    let touchedOrderId = null;
    const nextHistory = new Map();
    state.reprintHistoryByKey.forEach((entries, key) => {
      const nextEntries = (Array.isArray(entries) ? entries : []).filter(
        (entry) => {
          const keep = String(entry && entry.id) !== id;
          if (!keep) touchedOrderId = entry.orderId;
          return keep;
        },
      );
      if (nextEntries.length) nextHistory.set(key, nextEntries);
      else state.reprintPendingKeys.delete(key);
    });
    state.reprintHistoryByKey = nextHistory;
    return touchedOrderId;
  }

  function findReprintHistoryRequest(requestId) {
    const id = String(requestId || '');
    if (!id) return null;
    for (const entries of state.reprintHistoryByKey.values()) {
      const found = (Array.isArray(entries) ? entries : []).find(
        (entry) => String(entry && entry.id) === id,
      );
      if (found) return found;
    }
    return null;
  }

  function shouldRemoveAfterReprintCleared() {
    return (
      state.S.postPurchaseStatus === 'reprint_pending' ||
      state.S.postPurchaseReprint === 'pending'
    );
  }

  function applySuccessfulOrderAction(orderId, message, options = {}) {
    const id = getOrderStateId(orderId);
    if (!id) return;
    Queue.markQueueRowDone(SCREEN_KEY, id, { message });
    renderQueuePreserved();
    if (options.remove !== false) scheduleLocalOrderRemoval(id, 700);
    schedulePostPurchaseRefresh(25000);
  }

  function setPostPurchaseQuickFilter(status) {
    state.S.postPurchaseStatus = status || 'all';
    state.S.postPurchaseReprint = 'all';
    if (state.el('postpurchase-reprint-filter'))
      state.el('postpurchase-reprint-filter').value = 'all';
    document
      .querySelectorAll('[data-postpurchase-status]')
      .forEach((button) => {
        const active =
          (button.dataset.postpurchaseStatus || 'all') ===
          state.S.postPurchaseStatus;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    loadPostPurchaseOrders(true);
  }

  function resetPostPurchaseFilters() {
    if (state.S.postPurchaseSearchTimer)
      clearTimeout(state.S.postPurchaseSearchTimer);
    state.S.postPurchaseSearchTimer = null;
    state.S.postPurchaseSearch = '';
    state.S.postPurchaseMonth = '';
    state.S.postPurchaseDatePreset = 'this_month';
    state.S.postPurchaseDateFrom = '';
    state.S.postPurchaseDateTo = '';
    state.S.postPurchaseStatus = 'all';
    state.S.postPurchaseReprint = 'all';
    if (state.el('postpurchase-search'))
      state.el('postpurchase-search').value = '';
    if (state.el('postpurchase-date-preset'))
      state.el('postpurchase-date-preset').value = 'this_month';
    if (state.el('postpurchase-month-filter'))
      state.el('postpurchase-month-filter').value = '';
    if (state.el('postpurchase-date-from'))
      state.el('postpurchase-date-from').value = '';
    if (state.el('postpurchase-date-to'))
      state.el('postpurchase-date-to').value = '';
    if (state.el('postpurchase-reprint-filter'))
      state.el('postpurchase-reprint-filter').value = 'all';
    document
      .querySelectorAll('[data-postpurchase-status]')
      .forEach((button) => {
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
    state.el('postpurchase-search')?.addEventListener('input', (e) => {
      state.S.postPurchaseSearch = e.target.value || '';
      if (state.S.postPurchaseSearchTimer)
        clearTimeout(state.S.postPurchaseSearchTimer);
      if (state.S.postPurchaseLoaded)
        state.elSet('postpurchase-status', t('processed.status.searching'));
      state.S.postPurchaseSearchTimer = setTimeout(() => {
        loadPostPurchaseOrders(true);
      }, 300);
    });
    state.el('postpurchase-date-preset')?.addEventListener('change', (e) => {
      state.S.postPurchaseDatePreset = e.target.value || 'this_month';
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-month-filter')?.addEventListener('change', (e) => {
      state.S.postPurchaseMonth = e.target.value || '';
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-date-from')?.addEventListener('change', (e) => {
      state.S.postPurchaseDateFrom = e.target.value || '';
      if (state.S.postPurchaseDateFrom || state.S.postPurchaseDateTo)
        state.S.postPurchaseDatePreset = 'custom';
      if (state.el('postpurchase-date-preset'))
        state.el('postpurchase-date-preset').value =
          state.S.postPurchaseDatePreset;
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-date-to')?.addEventListener('change', (e) => {
      state.S.postPurchaseDateTo = e.target.value || '';
      if (state.S.postPurchaseDateFrom || state.S.postPurchaseDateTo)
        state.S.postPurchaseDatePreset = 'custom';
      if (state.el('postpurchase-date-preset'))
        state.el('postpurchase-date-preset').value =
          state.S.postPurchaseDatePreset;
      loadPostPurchaseOrders(true);
    });
    state.el('postpurchase-reprint-filter')?.addEventListener('change', (e) => {
      state.S.postPurchaseReprint = e.target.value || 'all';
      loadPostPurchaseOrders(true);
    });
    document
      .querySelectorAll('[data-postpurchase-status]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          setPostPurchaseQuickFilter(
            button.dataset.postpurchaseStatus || 'all',
          );
        });
      });
    state
      .el('postpurchase-clear-filters')
      ?.addEventListener('click', resetPostPurchaseFilters);
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
        filters.to,
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

  function buildRefreshFilters(append, options = {}) {
    const filters = buildOrderPipelineFilters(append);
    if (!append && options.preserveLoadedDepth) {
      const loadedCount = (state.S.postPurchaseOrders || []).length;
      const baseLimit = Number(state.S.postPurchaseLimit || 50);
      filters.limit = String(Math.max(loadedCount, baseLimit, 1));
      filters.offset = '0';
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
      const printFile = files.find(
        (file) => (file.printFilePath || '') === printFilePath,
      );
      if (printFile) return { row, printFile };
    }
    return { row: null, printFile: null };
  }

  function removeOrderLocally(orderId, options = {}) {
    const id = getOrderStateId(orderId);
    if (!id) return;
    const rows = state.S.postPurchaseOrders || [];
    const beforeRows = rows.length;
    const nextRows = Queue.removeQueueRowLocally(SCREEN_KEY, id, {
      rows,
      getRowId: getOrderStateId,
    });
    if (nextRows.length === beforeRows) return;
    const scrollPosition = captureQueueState();
    state.S.postPurchaseOrders = nextRows;
    state.S.postPurchaseOffset = Math.max(
      0,
      Number(state.S.postPurchaseOffset || beforeRows) - 1,
    );
    state.expandedOrderIds.delete(id);
    state.orderDetailCacheById.delete(id);
    if (state.activeOrderId === id) state.activeOrderId = null;
    debugOrdersUi('local-row-remove', {
      orderId: id,
      beforeRows,
      afterRows: nextRows.length,
      beforeScrollY: scrollPosition.y,
    });
    renderQueuePreserved();
    if (options.preserveScroll !== false) restoreScrollPosition(scrollPosition);
  }

  function scheduleLocalOrderRemoval(orderId, delayMs = 700) {
    const id = getOrderStateId(orderId);
    if (!id) return;
    Queue.scheduleRowRemoval(
      SCREEN_KEY,
      id,
      () => {
        removeOrderLocally(id, { preserveScroll: true });
      },
      delayMs,
    );
  }

  function storeReprintHistory(requests) {
    state.reprintHistoryByKey = new Map();
    (Array.isArray(requests) ? requests : []).forEach((request) => {
      const key = Render.getReprintKey(request.orderId, request.printFilePath);
      if (!state.reprintHistoryByKey.has(key))
        state.reprintHistoryByKey.set(key, []);
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
    const rowId = getOrderStateId(payload.orderId);
    const key = Render.getReprintKey(payload.orderId, payload.printFilePath);
    if (Queue.isQueueRowLocked(SCREEN_KEY, rowId)) return null;
    Queue.markQueueRowPending(SCREEN_KEY, rowId, {
      message: t('processed.action.reprint-pending-text'),
    });
    setReprintActionState(key, {
      state: 'pending',
      message: t('processed.action.reprint-pending-text'),
    });
    renderQueuePreserved();
    try {
      const selected = findOrderAndPrintFile(
        payload.orderId,
        payload.printFilePath,
      );
      const result = await Api.createReprintRequest({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseJsonHeaders(),
        payload: {
          ...payload,
          requestedBy: payload.operatorName,
          workstationId: state.cfg && state.cfg.deviceId,
        },
      });
      state.reprintPendingKeys.add(key);
      setReprintActionState(key, {
        state: 'pending',
        message: t('processed.action.reprint-pending-text'),
      });
      const downloadOrderName =
        payload.orderName ||
        (selected.row &&
          (selected.row.externalOrderId ||
            selected.row.customerOrderId ||
            selected.row.orderName)) ||
        payload.orderId;
      if (selected.row) {
        rememberDetailedOrder(selected.row);
        const xml = ReprintXml.generateReprintXml(
          selected.row,
          selected.printFile,
        );
        ReprintXml.downloadXml(xml, downloadOrderName);
      }
      state.showToast(t('processed.toast.reprint-created'), 'success');
      Queue.markQueueRowDone(SCREEN_KEY, rowId, {
        message: t('processed.action.reprint-pending-text'),
      });
      renderQueuePreserved();
      schedulePostPurchaseRefresh(25000);
      return result;
    } catch (error) {
      console.error('Reprint request failed', error);
      Queue.markQueueRowFailed(SCREEN_KEY, rowId, {
        message:
          error && error.message
            ? error.message
            : t('processed.toast.reprint-create-failed'),
      });
      setReprintActionState(key, {
        state: 'error',
        message:
          error && error.message
            ? error.message
            : t('processed.toast.reprint-create-failed'),
      });
      renderQueuePreserved();
      state.showToast(t('processed.toast.reprint-create-failed'), 'error');
      throw error;
    }
  }

  async function resolveReprintRequest(payload) {
    const key = Render.getReprintKey(payload.orderId, payload.printFilePath);
    const orderId = getOrderStateId(payload.orderId);
    const currentState = state.reprintActionStateByKey.get(key);
    if (
      (currentState && currentState.state === 'resolving') ||
      Queue.isQueueRowLocked(SCREEN_KEY, orderId)
    ) {
      return null;
    }
    Queue.markQueueRowPending(SCREEN_KEY, orderId, {
      message: t('processed.action.reprint-resolving-text'),
    });
    debugOrdersUi('manual-reprint-resolve-start', {
      orderId,
      beforeVisibleRows: (state.S.postPurchaseOrders || []).length,
      beforeOffset: state.S.postPurchaseOffset,
      beforeScrollY: window.scrollY || 0,
    });
    setReprintActionState(key, {
      state: 'resolving',
      message: t('processed.action.reprint-resolving-text'),
    });
    renderQueuePreserved();
    try {
      const result = await Api.resolveReprintRequest({
        fetchImpl: state.fetchImpl,
        headers: state.postPurchaseJsonHeaders(),
        payload: {
          ...payload,
          confirmedBy: getOperatorName(),
        },
      });
      markReprintHistoryDone(result.request);
      adjustStatsAfterReprintResolve();
      state.showToast(t('processed.toast.reprint-done'), 'success');
      setReprintActionState(
        key,
        {
          state: 'resolved',
          message: t('processed.action.reprint-resolved-text'),
        },
        { clearAfterMs: 25000 },
      );
      Queue.markQueueRowDone(SCREEN_KEY, orderId, {
        message: t('processed.action.reprint-resolved-text'),
      });
      renderQueuePreserved();
      scheduleLocalOrderRemoval(orderId, 700);
      schedulePostPurchaseRefresh(25000);
      debugOrdersUi('manual-reprint-resolve-success', {
        orderId,
        foregroundRefresh: false,
      });
      return result;
    } catch (error) {
      if (isAlreadyDoneError(error)) {
        markReprintHistoryDone({
          orderId,
          printFilePath: payload.printFilePath,
          status: 'done',
          confirmedAt: new Date().toISOString(),
        });
        adjustStatsAfterReprintResolve();
        state.showToast('Už hotovo', 'success');
        setReprintActionState(
          key,
          {
            state: 'resolved',
            message: 'Už hotovo',
          },
          { clearAfterMs: 25000 },
        );
        Queue.markQueueRowDone(SCREEN_KEY, orderId, { message: 'Už hotovo' });
        renderQueuePreserved();
        scheduleLocalOrderRemoval(orderId, 700);
        schedulePostPurchaseRefresh(25000);
        return { ok: true, alreadyDone: true };
      }
      console.error('Resolve reprint request failed', error);
      Queue.markQueueRowFailed(SCREEN_KEY, orderId, {
        message:
          error && error.message
            ? error.message
            : t('processed.toast.reprint-resolve-failed'),
      });
      setReprintActionState(key, {
        state: 'error',
        message:
          error && error.message
            ? error.message
            : t('processed.toast.reprint-resolve-failed'),
      });
      renderQueuePreserved();
      state.showToast(
        error && error.message
          ? error.message
          : t('processed.toast.reprint-resolve-failed'),
        'error',
      );
      debugOrdersUi('manual-reprint-resolve-error', {
        orderId,
        message: error && error.message,
      });
      throw error;
    }
  }

  async function deleteReprintRequest(payload) {
    const admin = payload && payload.admin;
    const confirmed = window.confirm(
      admin
        ? t('processed.confirm.delete-reprint')
        : t('processed.confirm.cancel-reprint'),
    );
    if (!confirmed) return;
    const historyEntry = findReprintHistoryRequest(payload.id);
    const rowId = historyEntry && getOrderStateId(historyEntry.orderId);
    if (rowId && Queue.isQueueRowLocked(SCREEN_KEY, rowId)) return;
    if (rowId)
      Queue.markQueueRowPending(SCREEN_KEY, rowId, {
        message: t('processed.action.reprint-resolving-text'),
      });
    try {
      await Api.deleteReprintRequest({
        fetchImpl: state.fetchImpl,
        headers:
          admin && typeof state.adminJsonHeaders === 'function'
            ? state.adminJsonHeaders()
            : state.postPurchaseJsonHeaders(),
        payload: {
          id: payload.id,
          action: admin ? 'delete_reprint' : 'cancel_reprint',
        },
      });
      state.showToast(
        admin
          ? t('processed.toast.reprint-deleted')
          : t('processed.toast.reprint-cancelled'),
        'success',
      );
      removeReprintHistoryRequest(payload.id);
      if (rowId) {
        Queue.markQueueRowDone(SCREEN_KEY, rowId, {
          message: admin
            ? t('processed.toast.reprint-deleted')
            : t('processed.toast.reprint-cancelled'),
        });
        if (shouldRemoveAfterReprintCleared()) {
          scheduleLocalOrderRemoval(rowId, 700);
        } else {
          renderQueuePreserved();
        }
      } else {
        renderQueuePreserved();
      }
      schedulePostPurchaseRefresh(25000);
    } catch (error) {
      console.error('Delete reprint request failed', error);
      if (rowId)
        Queue.markQueueRowFailed(SCREEN_KEY, rowId, {
          message:
            error && error.message
              ? error.message
              : t('processed.toast.reprint-delete-failed'),
        });
      renderQueuePreserved();
      state.showToast(
        error && error.message
          ? error.message
          : t('processed.toast.reprint-delete-failed'),
        'error',
      );
      throw error;
    }
  }

  async function loadOrderDetail(orderId, orderNumber) {
    const rows = state.S.postPurchaseOrders || [];
    const index = rows.findIndex((row) => {
      const sameId =
        orderId && String(getProcessedOrderId(row) || '') === String(orderId);
      const sameOrder =
        orderNumber && String(row.orderName || '') === String(orderNumber);
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
        rememberDetailedOrder(rows[index]);
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
    const scrollPosition = captureScrollPosition(options);
    if (state.S.postPurchaseLoading) {
      if (append) return;
      if (state.S.postPurchaseAbortController)
        state.S.postPurchaseAbortController.abort();
    }
    if (state.S.postPurchaseLoaded && !force && !append) {
      renderPostPurchaseOrders();
      return;
    }
    if (!state.requirePostPurchasePinForScreen()) return;

    const resetOffset = !append && !options.preserveLoadedDepth;
    if (resetOffset) state.S.postPurchaseOffset = 0;
    const controller =
      !append && typeof AbortController !== 'undefined'
        ? new AbortController()
        : null;
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
        filters: buildRefreshFilters(append, options),
        signal: controller ? controller.signal : undefined,
      });
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      const mergedRows = mergeCachedDetails(rows);
      state.S.postPurchaseOrders = append
        ? (state.S.postPurchaseOrders || []).concat(rows)
        : options.nonDisruptive
          ? Queue.mergeRowsBySnapshot(
              SCREEN_KEY,
              state.S.postPurchaseOrders || [],
              mergedRows,
              getOrderStateId,
            )
          : mergedRows;
      state.S.postPurchaseOffset =
        options.preserveLoadedDepth || options.nonDisruptive
          ? state.S.postPurchaseOrders.length
          : Number(payload.page?.nextOffset ?? payload.nextOffset) ||
            state.S.postPurchaseOrders.length;
      state.S.postPurchaseHasMore = Boolean(
        payload.page?.hasMore ?? payload.hasMore,
      );
      if (payload.stats) state.S.postPurchaseStats = payload.stats;
      await loadVisibleReprintHistory();
      state.S.postPurchaseLoaded = true;
      updateMonthFilter(payload.months || []);
      updateFilterControls();
      renderQueuePreserved();
      if (Queue.ensureQueue(SCREEN_KEY).dataChangedHeavily) {
        state.elSet(
          'postpurchase-status',
          'Data aktualizována · obnovit seznam',
        );
      }
      restoreScrollPosition(scrollPosition);
    } catch (error) {
      if (error && error.name === 'AbortError') return;
      console.error('Order pipeline load failed', error);
      const message = cleanApiError(error);
      if (wrap && !(state.S.postPurchaseOrders || []).length) {
        wrap.innerHTML = Render.renderError(message, state.esc);
        wrap
          .querySelector('[data-pp-retry="true"]')
          ?.addEventListener('click', () => loadPostPurchaseOrders(true));
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
    const orderId = getOrderStateId(payload && payload.processedOrderId);
    const confirmed = window.confirm(
      action === 'delete_order'
        ? t('processed.confirm.delete-order')
        : t('processed.confirm.cancel-order'),
    );
    if (!confirmed) return;
    if (Queue.isQueueRowLocked(SCREEN_KEY, orderId)) return;
    Queue.markQueueRowPending(SCREEN_KEY, orderId, {
      message: t('processed.action.reprint-resolving-text'),
    });
    renderQueuePreserved();
    try {
      await Api.updateOrderAdminStatus({
        fetchImpl: state.fetchImpl,
        headers: state.adminJsonHeaders(),
        payload,
      });
      state.showToast(
        action === 'delete_order'
          ? t('processed.toast.order-deleted')
          : t('processed.toast.order-cancelled'),
        'success',
      );
      applySuccessfulOrderAction(
        orderId,
        action === 'delete_order'
          ? t('processed.toast.order-deleted')
          : t('processed.toast.order-cancelled'),
      );
    } catch (error) {
      console.error('Admin order action failed', error);
      if (isAlreadyDoneError(error)) {
        state.showToast('Už hotovo', 'success');
        applySuccessfulOrderAction(orderId, 'Už hotovo');
        return;
      }
      Queue.markQueueRowFailed(SCREEN_KEY, orderId, {
        message:
          error && error.message
            ? error.message
            : t('processed.toast.order-action-failed'),
      });
      renderQueuePreserved();
      state.showToast(
        error && error.message
          ? error.message
          : t('processed.toast.order-action-failed'),
        'error',
      );
      throw error;
    }
  }

  function renderPostPurchaseOrders() {
    const wrap = state.el('postpurchase-orders-wrap');
    if (!wrap) return;
    const rows = getVisibleOrders();
    const searchActive = Boolean((state.S.postPurchaseSearch || '').trim());
    const activeFilterLabel = getActiveFilterLabel(
      Filters.getFiltersFromState(state.S),
    );
    wrap.innerHTML =
      Render.renderOrders(rows, getRenderOptions()) +
      (state.S.postPurchaseHasMore
        ? `<div class="pp-load-more-wrap"><button class="btn-sm" type="button" data-pp-load-more="true">${t('processed.button.load-more')}</button></div>`
        : '');
    bindProcessedOrderActions(wrap);
    state.elSet(
      'postpurchase-status',
      searchActive
        ? `${rows.length} ${t('processed.status.search-results')}${activeFilterLabel ? ` · ${activeFilterLabel}` : ''}`
        : `${rows.length} ${t('processed.status.rows')}${activeFilterLabel ? ` · ${activeFilterLabel}` : ''}`,
    );
    if (typeof state.applyRoleUI === 'function') state.applyRoleUI();
  }

  function bindPdfOpenDelegation(wrap) {
    if (!wrap || wrap.dataset.pdfOpenBound === '1') return;
    wrap.dataset.pdfOpenBound = '1';
    wrap.addEventListener(
      'click',
      (event) => {
        const target =
          event.target && typeof event.target.closest === 'function'
            ? event.target
            : event.target && event.target.parentElement;
        const button =
          target && typeof target.closest === 'function'
            ? target.closest('[data-open-pdf-url]')
            : null;
        if (!button || !wrap.contains(button)) return;

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (button.disabled) return;
        PdfOpen.openPdfUrl({
          url: button.dataset.openPdfUrl || '',
          showToast: state.showToast,
        });
      },
      true,
    );
  }

  function bindProcessedOrderActions(wrap) {
    bindPdfOpenDelegation(wrap);
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
    wrap
      .querySelectorAll(
        '[data-load-order-detail-id], [data-load-order-detail-number]',
      )
      .forEach((button) => {
        button.addEventListener('click', () => {
          button.disabled = true;
          button.textContent = t('processed.status.loading');
          loadOrderDetail(
            button.dataset.loadOrderDetailId,
            button.dataset.loadOrderDetailNumber,
          ).finally(() => {
            button.disabled = false;
          });
        });
      });
    wrap
      .querySelector('[data-pp-load-more="true"]')
      ?.addEventListener('click', (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = t('processed.status.loading');
        loadPostPurchaseOrders(true, { append: true }).finally(() => {
          button.disabled = false;
        });
      });
    wrap.querySelectorAll('[data-reprint-order-id]').forEach((button) => {
      button.addEventListener('click', () => {
        ReprintModal.open(
          {
            orderId: button.dataset.reprintOrderId,
            orderName: button.dataset.reprintOrderName,
            operatorName: getOperatorName(),
            printFilePath: button.dataset.printFilePath || '',
            printFileLabel: button.dataset.printFileLabel,
          },
          {
            esc: state.esc,
            fileNameFromPath: Render.fileNameFromPath,
            onSubmit: createReprintRequest,
          },
        );
      });
    });
    wrap
      .querySelectorAll('[data-resolve-reprint-order-id]')
      .forEach((button) => {
        button.addEventListener('click', () => {
          resolveReprintRequest({
            orderId: button.dataset.resolveReprintOrderId,
            printFilePath: button.dataset.resolvePrintFilePath || '',
          });
        });
      });
    wrap
      .querySelectorAll('[data-delete-reprint-request-id]')
      .forEach((button) => {
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
