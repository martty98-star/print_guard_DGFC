/* PrintGuard — shared date filter helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardDateFilters(global) {
  function createDateFilters(deps) {
    const { Reports, S, el, loadPrintLog, renderCoHistory, renderStockLog } =
      deps;

    function dateRangeFilter(timestamp, from, to) {
      return Reports.date.dateRangeFilter(timestamp, from, to);
    }

    function applyPreset(range, target) {
      const now = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const fmt = (d) =>
        `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
      const todayStr = fmt(now);
      let fromStr = '';
      if (range === 'month') {
        fromStr = `${now.getFullYear()}-${p(now.getMonth() + 1)}-01`;
      } else if (range === 'year') {
        fromStr = `${now.getFullYear()}-01-01`;
      } else {
        const d = new Date(now);
        d.setDate(d.getDate() - parseInt(range, 10));
        fromStr = fmt(d);
      }
      if (target === 'log') {
        S.logDateFrom = fromStr;
        S.logDateTo = todayStr;
        el('stock-log-from').value = fromStr;
        el('stock-log-to').value = todayStr;
        renderStockLog();
      } else if (target === 'co') {
        S.coDateFrom = fromStr;
        S.coDateTo = todayStr;
        el('co-hist-from').value = fromStr;
        el('co-hist-to').value = todayStr;
        renderCoHistory();
      } else {
        S.printLogDateFrom = fromStr;
        S.printLogDateTo = todayStr;
        el('print-log-from').value = fromStr;
        el('print-log-to').value = todayStr;
        S.printLogLoaded = false;
        loadPrintLog(true);
      }
    }

    return { applyPreset, dateRangeFilter };
  }

  global.PrintGuardDateFilters = { createDateFilters };
})(window);
