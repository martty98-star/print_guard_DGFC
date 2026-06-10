(function attachStockFeature(global) {
  'use strict';

  const StockDomain = global.PrintGuardStockDomain;
  const StockUI = global.PrintGuardStockUI;
  const StockController = global.PrintGuardStockController;
  const StockStore = global.StockStore;

  if (!StockDomain) throw new Error('Missing PrintGuardStockDomain');
  if (!StockUI) throw new Error('Missing PrintGuardStockUI');
  if (!StockController) throw new Error('Missing PrintGuardStockController');
  if (!StockStore) throw new Error('Missing StockStore');

  let ctx = null;
  let controller = null;

  function requireContext() {
    if (!ctx) throw new Error('StockFeature is not initialized');
    return ctx;
  }

  function initStockFeature(deps) {
    ctx = deps || {};
    controller = StockController.initStockController({
      S: ctx.S,
      computeStock,
      deleteMovement: ctx.deleteMovement,
      el: ctx.el,
      esc: ctx.esc,
      exportCSVStockLog: ctx.exportCSVStockLog,
      fmtN: ctx.fmtN,
      i18n: ctx.i18n,
      navigate: ctx.navigate,
      openItemModal: ctx.openItemModal,
      renderStockLog: ctx.renderStockLog,
      renderStockOverview,
      saveItemModal: ctx.saveItemModal,
      saveMovement: ctx.saveMovement,
      statusLabel: ctx.statusLabel,
    });
    return controller;
  }

  function computeStock(item) {
    const deps = requireContext();
    return StockDomain.computeStockSummary(
      item,
      deps.S.movements,
      deps.cfg,
      deps.Reports.stock,
      new Date(),
    );
  }

  function getMovements(articleNumber) {
    const deps = requireContext();
    return StockDomain.getMovementsForArticle(deps.S.movements, articleNumber);
  }

  function renderStockOverview() {
    const deps = requireContext();
    return StockUI.renderStockOverview({
      S: deps.S,
      computeStock,
      el: deps.el,
      elSet: deps.elSet,
      esc: deps.esc,
      fmtDays: deps.fmtDays,
      fmtN: deps.fmtN,
      i18n: deps.i18n,
      onOpenStockDetail: deps.openStockDetail,
      statusLabel: deps.statusLabel,
    });
  }

  function renderStockAlerts() {
    const deps = requireContext();
    return StockUI.renderAlerts({
      S: deps.S,
      computeStock,
      el: deps.el,
      esc: deps.esc,
      fmtDays: deps.fmtDays,
      fmtN: deps.fmtN,
      i18n: deps.i18n,
      onOpenStockDetail: deps.openStockDetail,
      statusLabel: deps.statusLabel,
    });
  }

  function renderStockHistory(item, moves) {
    const deps = requireContext();
    return StockUI.buildStockHistoryTable({
      esc: deps.esc,
      fmtDT: deps.fmtDT,
      fmtN: deps.fmtN,
      i18n: deps.i18n,
      item,
      movementLabel: deps.movementLabel,
      moves,
    });
  }

  function bindStockDetailControls(item) {
    if (controller) controller.bindStockDetailControls(item);
  }

  function clearMovementForm() {
    if (controller) controller.clearMovItem();
  }

  global.StockFeature = {
    initStockFeature,
    computeStock,
    getMovements,
    renderStockOverview,
    renderStockAlerts,
    renderStockHistory,
    bindStockDetailControls,
    clearMovementForm,
  };
})(window);
