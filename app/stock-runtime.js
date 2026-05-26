/* PrintGuard - stock runtime composition (loaded before app.js) */
'use strict';

(function attachPrintGuardStockRuntime(global) {
  function createStockRuntime(deps) {
    const {
      Reports,
      S,
      StockActions,
      StockFeature,
      StockLogModule,
      StockStore,
      StockUI,
      adminErrorMessage,
      cloudDelete,
      cfg,
      deleteMovementRemote,
      dlBlob,
      el,
      esc,
      fmtDT,
      fmtDays,
      fmtExportDateTime,
      fmtFileDT,
      fmtN,
      genId,
      i18n,
      isAdmin,
      movementLabel,
      navigate,
      runNotificationDispatch,
      setSyncDirtyReason,
      showConfirm,
      showToast,
      statusLabel,
      stockApiAdapter,
      stockDbAdapter,
    } = deps;

    let stockActions = null;
    let stockLogApi = null;

    function getMovements(articleNumber) {
      return StockFeature.getMovements(articleNumber);
    }

    function computeStock(item) {
      return StockFeature.computeStock(item);
    }

    function renderStockOverview() {
      return StockFeature.renderStockOverview();
    }

    function requireStockActions() {
      if (!stockActions) throw new Error('Stock actions are not initialized');
      return stockActions;
    }

    function openStockDetail(articleNumber) {
      return requireStockActions().openStockDetail(articleNumber);
    }

    async function deleteMovementAdmin(id) {
      return requireStockActions().deleteMovementAdmin(id);
    }

    function renderAlerts() {
      return StockFeature.renderStockAlerts();
    }

    async function saveMovement() {
      return requireStockActions().saveMovement();
    }

    function renderItemsMgmt() {
      return requireStockActions().renderItemsMgmt();
    }

    function openItemModal(articleNumber) {
      return requireStockActions().openItemModal(articleNumber);
    }

    async function saveItemModal() {
      return requireStockActions().saveItemModal();
    }

    async function deleteItem(articleNumber) {
      return requireStockActions().deleteItem(articleNumber);
    }

    function requireStockLog() {
      if (!stockLogApi) throw new Error('Stock log is not initialized');
      return stockLogApi;
    }

    function renderStockLog() {
      return requireStockLog().renderStockLog();
    }

    function exportCSVStockLog() {
      return requireStockLog().exportCSVStockLog();
    }

    async function deleteMovement(id) {
      return requireStockActions().deleteMovement(id);
    }

    function initRuntime() {
      stockActions = StockActions.createStockActions({
        S,
        StockFeature,
        StockStore,
        StockUI,
        Reports,
        adminErrorMessage,
        cfg,
        cloudDelete,
        el,
        esc,
        fmtDT,
        fmtDays,
        fmtN,
        genId,
        i18n,
        isAdmin,
        movementLabel,
        navigate,
        renderAlerts,
        renderStockLog,
        renderStockOverview,
        runNotificationDispatch,
        setSyncDirtyReason,
        showConfirm,
        showToast,
        statusLabel,
        stockApiAdapter,
        stockDbAdapter,
      });

      stockLogApi = StockLogModule.createStockLog({
        Reports,
        S,
        StockStore,
        deleteMovementAdmin,
        dlBlob,
        el,
        esc,
        fmtDT,
        fmtExportDateTime,
        fmtFileDT,
        fmtN,
        i18n,
        movementLabel,
        openStockDetail,
      });
    }

    function initFeature() {
      StockFeature.initStockFeature({
        S,
        Reports,
        cfg,
        computeStock,
        deleteMovement,
        el,
        elSet: deps.elSet,
        esc,
        exportCSVStockLog,
        fmtDT,
        fmtDays,
        fmtN,
        i18n,
        movementLabel,
        navigate,
        openStockDetail,
        openItemModal,
        renderStockLog,
        renderStockOverview,
        saveItemModal,
        saveMovement,
        statusLabel,
      });
    }

    return {
      computeStock,
      deleteItem,
      deleteMovement,
      deleteMovementAdmin,
      exportCSVStockLog,
      getMovements,
      initFeature,
      initRuntime,
      openItemModal,
      openStockDetail,
      renderAlerts,
      renderItemsMgmt,
      renderStockLog,
      renderStockOverview,
      saveItemModal,
      saveMovement,
    };
  }

  global.PrintGuardStockRuntime = {
    createStockRuntime,
  };
})(window);
