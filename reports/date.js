(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});

  function dateRangeFilter(timestamp, from, to) {
    if (!from && !to) return true;
    const value = new Date(timestamp);
    if (!Number.isFinite(value.getTime())) return false;
    if (from && value < new Date(`${from}T00:00:00`)) return false;
    if (to && value > new Date(`${to}T23:59:59`)) return false;
    return true;
  }

  function getCurrentMonthExportRange(nowInput) {
    const now = nowInput ? new Date(nowInput) : new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    const pad = (n) => String(n).padStart(2, '0');
    return {
      fromMs: from.getTime(),
      toMs: to.getTime(),
      fromIso: from.toISOString(),
      toIso: to.toISOString(),
      fromDate: `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`,
      toDate: `${to.getFullYear()}-${pad(to.getMonth() + 1)}-${pad(to.getDate())}`,
      fileMonth: `${from.getFullYear()}-${pad(from.getMonth() + 1)}`,
    };
  }

  const api = {
    dateRangeFilter,
    getCurrentMonthExportRange,
  };

  root.date = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
