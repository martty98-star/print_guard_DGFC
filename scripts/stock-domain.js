(function attachPrintGuardStockDomain(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
    return;
  }
  root.PrintGuardStockDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createStockDomainModule() {
  'use strict';

  function statusLabel(status, i18n) {
    const map = {
      ok: i18n('status.ok'),
      warn: i18n('status.warn'),
      crit: i18n('status.crit'),
    };
    return map[status] || status;
  }

  function movementLabel(type, i18n) {
    const map = {
      receipt: i18n('mov.receipt'),
      issue: i18n('mov.issue'),
      stocktake: i18n('mov.stocktake'),
    };
    return map[type] || type;
  }

  function getActiveStockItems(items) {
    return (items || []).filter(item => item.isActive !== false);
  }

  function getMovementsForArticle(movements, articleNumber) {
    return (movements || []).filter(move => move.articleNumber === articleNumber);
  }

  function computeStockSummary(item, movements, config, stockReports, now) {
    return stockReports.buildStockSummary(item, movements, { weeksN: config.weeksN }, now || new Date());
  }

  function getStockStatusCounts(items, computeStock) {
    const counts = { ok: 0, warn: 0, crit: 0 };
    getActiveStockItems(items).forEach(item => {
      const status = computeStock(item).status;
      if (status === 'ok') counts.ok += 1;
      else if (status === 'warn') counts.warn += 1;
      else counts.crit += 1;
    });
    return counts;
  }

  function matchesStockSearch(item, query) {
    const q = String(query || '').toLowerCase();
    if (!q) return true;
    return (item.name || '').toLowerCase().includes(q)
      || (item.articleNumber || '').toLowerCase().includes(q)
      || (item.category || '').toLowerCase().includes(q);
  }

  function filterStockOverviewItems(items, options) {
    const opts = options || {};
    const filter = opts.stockFilter || 'all';
    const computeStock = opts.computeStock;
    return getActiveStockItems(items).filter(item => {
      const stock = computeStock(item);
      const matchStatus = filter === 'all' || stock.status === filter;
      return matchStatus && matchesStockSearch(item, opts.stockSearch);
    });
  }

  function getAlertStockItems(items, computeStock) {
    return getActiveStockItems(items)
      .filter(item => computeStock(item).status !== 'ok')
      .sort((a, b) => computeStock(a).daysLeft - computeStock(b).daysLeft);
  }

  function getMovementTypeClass(movType) {
    return { receipt: 'receipt-c', issue: 'issue-c', stocktake: 'stocktake-c' }[movType] || '';
  }

  function getMovementQuantitySign(move, formatNumber) {
    if (move.movType === 'issue') return `−${formatNumber(move.qty, 0)}`;
    if (move.movType === 'receipt') return `+${formatNumber(move.qty, 0)}`;
    return `=${formatNumber(move.qty, 0)}`;
  }

  function buildMovementReplayRows(moves) {
    let running = 0;
    const rows = [];
    for (const move of moves || []) {
      if (move.movType === 'stocktake') running = move.qty;
      else if (move.movType === 'receipt') running += move.qty;
      else if (move.movType === 'issue') running = Math.max(0, running - move.qty);
      rows.push({ move, after: running });
    }
    return rows;
  }

  function buildStockHistoryRows(moves) {
    let running = 0;
    const rows = [];
    for (const move of moves || []) {
      let delta;
      if (move.movType === 'stocktake') {
        delta = move.qty - running;
        running = move.qty;
      } else if (move.movType === 'receipt') {
        delta = move.qty;
        running += move.qty;
      } else if (move.movType === 'issue') {
        delta = -move.qty;
        running = Math.max(0, running - move.qty);
      } else {
        delta = 0;
      }
      rows.push({ move, after: running, delta });
    }
    return rows;
  }

  function getStockHistoryDeltaClass(delta) {
    if (delta > 0) return 'receipt-c';
    if (delta < 0) return 'issue-c';
    return 'stocktake-c';
  }

  function formatStockHistoryDelta(delta, move, formatNumber) {
    if (delta > 0) return `+${formatNumber(delta, 0)}`;
    if (delta < 0) return `${formatNumber(delta, 0)}`;
    return `=${formatNumber(move.qty, 0)}`;
  }

  return {
    buildMovementReplayRows,
    buildStockHistoryRows,
    filterStockOverviewItems,
    formatStockHistoryDelta,
    computeStockSummary,
    getActiveStockItems,
    getAlertStockItems,
    getMovementsForArticle,
    getMovementQuantitySign,
    getMovementTypeClass,
    getStockHistoryDeltaClass,
    getStockStatusCounts,
    matchesStockSearch,
    movementLabel,
    statusLabel,
  };
});
