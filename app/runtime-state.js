/* PrintGuard - runtime state and reload orchestration (loaded before app.js) */
'use strict';

(function attachPrintGuardRuntimeState(global) {
  function createInitialState() {
    return {
      items: [],
      movements: [],
      coRecords: [],
      coloradoRolls: {},
      coloradoRollEvents: {},
      coloradoRollAccountingStatus: {},
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
      printLogTodayQueue: null,
      printLogLoading: false,
      printLogLoaded: false,
      printLogViewMode: 'raw',
      printLogGroupFilter: 'all',
      printLogExpandedGroups: {},
      postPurchaseOrders: [],
      postPurchaseLoading: false,
      postPurchaseLoaded: false,
      postPurchaseFilter: 'open',
      postPurchaseSearch: '',
      postPurchaseSearchTimer: null,
      postPurchaseAbortController: null,
      postPurchaseStatus: 'all',
      postPurchaseLimit: '50',
      postPurchaseOffset: 0,
      postPurchaseHasMore: false,
      postPurchaseStats: null,
      postPurchaseMonth: '',
      postPurchaseDatePreset: 'this_month',
      postPurchaseDateFrom: '',
      postPurchaseDateTo: '',
      postPurchaseReprint: 'all',
      syncRunning: false,
      syncIntervalId: null,
    };
  }

  function normalizeCoRecord(record) {
    if (!record || typeof record !== 'object') return record;
    return {
      ...record,
      updatedAt:
        record.updatedAt ||
        record.updated_at ||
        record.createdAt ||
        record.timestamp ||
        null,
    };
  }

  function createRuntimeState(deps) {
    const {
      StockStore,
      ST_CORECS,
      ST_ITEMS,
      ST_MOVES,
      adminJsonHeaders,
      cfg,
      elSet,
      fetchImpl,
      idbAll,
      idbDelete,
      idbPut,
      loadSettingsFromIDB,
    } = deps;

    const state = createInitialState();

    function stockDbAdapter() {
      return {
        ST_ITEMS,
        ST_MOVES,
        idbAll,
        idbPut,
        idbDelete,
      };
    }

    function stockApiAdapter() {
      return {
        adminJsonHeaders,
        clientId: cfg?.deviceId || '',
        fetchImpl,
        operator: cfg?.userName || '',
      };
    }

    async function loadAll(renderers) {
      state.items = await StockStore.getAllItems(stockDbAdapter());
      state.movements = (
        await StockStore.getAllMovements(stockDbAdapter())
      ).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      state.coRecords = (await idbAll(ST_CORECS))
        .map(normalizeCoRecord)
        .filter((record) => record && !record.deletedAt)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      await loadSettingsFromIDB();

      const ts = new Date().toLocaleTimeString('cs-CZ', {
        hour: '2-digit',
        minute: '2-digit',
      });
      elSet('stock-last-update', ts);
      elSet('co-last-update', ts);

      renderers.renderStockOverview();
      renderers.renderAlerts();
      renderers.renderItemsMgmt();
      renderers.renderCoDashboard();
      renderers.renderCoHistory();
    }

    return {
      loadAll,
      state,
      stockApiAdapter,
      stockDbAdapter,
    };
  }

  global.PrintGuardRuntimeState = {
    createRuntimeState,
  };
})(window);
