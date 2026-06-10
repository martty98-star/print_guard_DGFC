'use strict';

(function attachPrintGuardOperatorQueueMode(global) {
  const queues = new Map();
  const DEFAULT_SUCCESS_MS = 1000;
  const DEFAULT_REFRESH_MS = 25000;

  function now() {
    return Date.now();
  }

  function isDebugEnabled() {
    try {
      return (
        global.localStorage?.pg_debug_queue === '1' ||
        global.localStorage?.pg_debug_orders === '1'
      );
    } catch (_) {
      return false;
    }
  }

  function log(screenKey, action, details) {
    if (!isDebugEnabled()) return;
    console.log('[operator-queue]', {
      screenKey,
      action,
      ...(details || {}),
    });
  }

  function ensureQueue(screenKey) {
    const key = screenKey || 'default';
    if (!queues.has(key)) {
      queues.set(key, {
        screenKey: key,
        filters: null,
        search: '',
        sort: '',
        visibleLimit: null,
        loadedPages: [],
        scrollY: 0,
        expandedRowIds: new Set(),
        activeRowId: null,
        pendingRowIds: new Set(),
        completedRowIds: new Set(),
        failedRowIds: new Set(),
        suppressForegroundRefreshUntil: 0,
        lastUserActionAt: 0,
        queueSnapshotOrder: [],
        rowPatches: new Map(),
        rowTimers: new Map(),
        refreshTimer: null,
        dataChangedHeavily: false,
        liveMode: false,
        workQueueMode: true,
      });
    }
    return queues.get(key);
  }

  function normalizeId(rowId) {
    return rowId == null ? '' : String(rowId);
  }

  function toArray(value) {
    if (!value) return [];
    if (value instanceof Set) return Array.from(value);
    if (Array.isArray(value)) return value;
    return [];
  }

  function getScrollPosition() {
    return {
      x: global.scrollX || 0,
      y: global.scrollY || 0,
    };
  }

  function restoreScroll(position) {
    if (!position) return;
    global.requestAnimationFrame(() => {
      global.scrollTo(position.x || 0, position.y || 0);
    });
  }

  function captureQueueUiState(screenKey, details = {}) {
    const queue = ensureQueue(screenKey);
    const position = getScrollPosition();
    queue.filters = details.filters || queue.filters;
    queue.search =
      details.search == null ? queue.search : String(details.search || '');
    queue.sort = details.sort == null ? queue.sort : String(details.sort || '');
    queue.visibleLimit =
      details.visibleLimit == null ? queue.visibleLimit : details.visibleLimit;
    queue.loadedPages = toArray(details.loadedPages);
    queue.scrollY = position.y;
    queue.expandedRowIds = new Set(toArray(details.expandedRowIds));
    queue.activeRowId = normalizeId(details.activeRowId || queue.activeRowId);
    queue.queueSnapshotOrder = toArray(details.queueSnapshotOrder).map(String);
    log(screenKey, 'capture', {
      scrollY: queue.scrollY,
      visibleLimit: queue.visibleLimit,
      rows: queue.queueSnapshotOrder.length,
    });
    return {
      ...queue,
      scrollX: position.x,
      scrollY: position.y,
      expandedRowIds: new Set(queue.expandedRowIds),
      pendingRowIds: new Set(queue.pendingRowIds),
      completedRowIds: new Set(queue.completedRowIds),
      failedRowIds: new Set(queue.failedRowIds),
      queueSnapshotOrder: queue.queueSnapshotOrder.slice(),
    };
  }

  function restoreQueueUiState(screenKey, snapshot) {
    const queue = ensureQueue(screenKey);
    const source = snapshot || queue;
    queue.scrollY = source.scrollY || 0;
    if (source.visibleLimit != null) queue.visibleLimit = source.visibleLimit;
    if (source.expandedRowIds) {
      queue.expandedRowIds = new Set(toArray(source.expandedRowIds));
    }
    restoreScroll({
      x: source.scrollX || 0,
      y: source.scrollY || 0,
    });
    log(screenKey, 'restore', {
      scrollY: source.scrollY || 0,
      visibleLimit: queue.visibleLimit,
    });
  }

  function preserveScrollDuringRender(callback, screenKey) {
    const snapshot = captureQueueUiState(screenKey);
    const result = callback();
    restoreQueueUiState(screenKey, snapshot);
    return result;
  }

  function patchQueueRow(screenKey, rowId, patch) {
    const id = normalizeId(rowId);
    if (!id) return null;
    const queue = ensureQueue(screenKey);
    const next = {
      ...(queue.rowPatches.get(id) || {}),
      ...(patch || {}),
      updatedAt: now(),
    };
    queue.rowPatches.set(id, next);
    log(screenKey, 'patch-row', { rowId: id, patch: next });
    return next;
  }

  function getQueueRowPatch(screenKey, rowId) {
    const id = normalizeId(rowId);
    if (!id) return null;
    return ensureQueue(screenKey).rowPatches.get(id) || null;
  }

  function clearQueueRowPatch(screenKey, rowId) {
    const id = normalizeId(rowId);
    if (!id) return;
    ensureQueue(screenKey).rowPatches.delete(id);
  }

  function markQueueRowPending(screenKey, rowId, patch = {}) {
    const id = normalizeId(rowId);
    if (!id) return null;
    const queue = ensureQueue(screenKey);
    if (queue.pendingRowIds.has(id)) return getQueueRowPatch(screenKey, id);
    queue.pendingRowIds.add(id);
    queue.completedRowIds.delete(id);
    queue.failedRowIds.delete(id);
    queue.activeRowId = id;
    queue.lastUserActionAt = now();
    queue.suppressForegroundRefreshUntil = queue.lastUserActionAt + 30000;
    return patchQueueRow(screenKey, id, {
      queueState: 'pending',
      message: 'Zpracovávám...',
      ...patch,
    });
  }

  function markQueueRowDone(screenKey, rowId, patch = {}) {
    const id = normalizeId(rowId);
    if (!id) return null;
    const queue = ensureQueue(screenKey);
    queue.pendingRowIds.delete(id);
    queue.failedRowIds.delete(id);
    queue.completedRowIds.add(id);
    queue.lastUserActionAt = now();
    return patchQueueRow(screenKey, id, {
      queueState: 'done',
      message: 'Hotovo',
      ...patch,
    });
  }

  function markQueueRowFailed(screenKey, rowId, patch = {}) {
    const id = normalizeId(rowId);
    if (!id) return null;
    const queue = ensureQueue(screenKey);
    queue.pendingRowIds.delete(id);
    queue.completedRowIds.delete(id);
    queue.failedRowIds.add(id);
    return patchQueueRow(screenKey, id, {
      queueState: 'failed',
      ...patch,
    });
  }

  function isQueueRowLocked(screenKey, rowId) {
    const id = normalizeId(rowId);
    return Boolean(id && ensureQueue(screenKey).pendingRowIds.has(id));
  }

  function clearQueueRowTimer(screenKey, rowId) {
    const id = normalizeId(rowId);
    if (!id) return;
    const queue = ensureQueue(screenKey);
    const timer = queue.rowTimers.get(id);
    if (timer) global.clearTimeout(timer);
    queue.rowTimers.delete(id);
  }

  function removeQueueRowLocally(screenKey, rowId, options = {}) {
    const id = normalizeId(rowId);
    const rows = Array.isArray(options.rows) ? options.rows : [];
    if (!id || !rows.length || typeof options.getRowId !== 'function') {
      return rows;
    }
    const before = rows.length;
    const nextRows = rows.filter(
      (row) => normalizeId(options.getRowId(row)) !== id,
    );
    if (nextRows.length === before) return rows;
    const queue = ensureQueue(screenKey);
    queue.pendingRowIds.delete(id);
    queue.failedRowIds.delete(id);
    queue.completedRowIds.add(id);
    queue.expandedRowIds.delete(id);
    clearQueueRowPatch(screenKey, id);
    log(screenKey, 'remove-row', {
      rowId: id,
      beforeRows: before,
      afterRows: nextRows.length,
    });
    return nextRows;
  }

  function scheduleRowRemoval(screenKey, rowId, callback, delayMs = 700) {
    const id = normalizeId(rowId);
    if (!id || typeof callback !== 'function') return;
    clearQueueRowTimer(screenKey, id);
    patchQueueRow(screenKey, id, { queueState: 'removing' });
    const queue = ensureQueue(screenKey);
    const timer = global.setTimeout(() => {
      queue.rowTimers.delete(id);
      callback();
    }, delayMs);
    queue.rowTimers.set(id, timer);
  }

  function scheduleNonDisruptiveRefresh(screenKey, callback, options = {}) {
    const queue = ensureQueue(screenKey);
    const delayMs = Number(options.delayMs || DEFAULT_REFRESH_MS);
    if (queue.refreshTimer) global.clearTimeout(queue.refreshTimer);
    log(screenKey, 'refresh-scheduled', { delayMs });
    queue.refreshTimer = global.setTimeout(() => {
      queue.refreshTimer = null;
      if (typeof callback !== 'function') return;
      log(screenKey, 'refresh-start');
      callback({
        preserveLoadedDepth: true,
        preserveScroll: true,
        nonDisruptive: true,
      });
    }, delayMs);
  }

  function isForegroundRefreshSuppressed(screenKey) {
    const queue = ensureQueue(screenKey);
    return queue.workQueueMode && now() < queue.suppressForegroundRefreshUntil;
  }

  function mergeRowsBySnapshot(screenKey, currentRows, incomingRows, getRowId) {
    if (
      !Array.isArray(currentRows) ||
      !Array.isArray(incomingRows) ||
      typeof getRowId !== 'function'
    ) {
      return incomingRows;
    }
    const queue = ensureQueue(screenKey);
    const incomingById = new Map(
      incomingRows.map((row) => [normalizeId(getRowId(row)), row]),
    );
    const merged = [];
    const seen = new Set();
    currentRows.forEach((row) => {
      const id = normalizeId(getRowId(row));
      if (!id) return;
      const patch = getQueueRowPatch(screenKey, id);
      const nextRow = incomingById.get(id) || row;
      if (patch && patch.queueState) {
        merged.push({ ...nextRow, __queueState: patch });
      } else {
        merged.push(nextRow);
      }
      seen.add(id);
    });
    if (!isForegroundRefreshSuppressed(screenKey)) {
      incomingRows.forEach((row) => {
        const id = normalizeId(getRowId(row));
        if (id && !seen.has(id)) merged.push(row);
      });
    } else if (incomingRows.length > currentRows.length + 10) {
      queue.dataChangedHeavily = true;
    }
    return merged;
  }

  global.PrintGuardOperatorQueueMode = {
    captureQueueUiState,
    clearQueueRowPatch,
    DEFAULT_SUCCESS_MS,
    ensureQueue,
    getQueueRowPatch,
    isForegroundRefreshSuppressed,
    isQueueRowLocked,
    markQueueRowDone,
    markQueueRowFailed,
    markQueueRowPending,
    mergeRowsBySnapshot,
    patchQueueRow,
    preserveScrollDuringRender,
    removeQueueRowLocally,
    restoreQueueUiState,
    scheduleNonDisruptiveRefresh,
    scheduleRowRemoval,
  };
})(window);
