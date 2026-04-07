(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});

  function sortByTimestampAsc(rows) {
    return [...rows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  }

  function normalizeMovType(value) {
    return String(value || '').trim().toLowerCase();
  }

  function dateRangeFilter(timestamp, from, to) {
    if (!from && !to) return true;
    const value = new Date(timestamp);
    if (!Number.isFinite(value.getTime())) return false;
    if (from && value < new Date(`${from}T00:00:00`)) return false;
    if (to && value > new Date(`${to}T23:59:59`)) return false;
    return true;
  }

  function getMovementsForItem(movements, articleNumber) {
    return sortByTimestampAsc((movements || []).filter(move => move.articleNumber === articleNumber));
  }

  function buildStockSummary(item, movements, config, nowInput) {
    const now = nowInput ? new Date(nowInput) : new Date();
    const weeksN = Math.max(1, Number(config?.weeksN) || 1);
    const itemMoves = getMovementsForItem(movements, item.articleNumber);

    let baseline = 0;
    let baselineIndex = -1;
    for (let index = itemMoves.length - 1; index >= 0; index -= 1) {
      if (normalizeMovType(itemMoves[index].movType) === 'stocktake') {
        baseline = Number(itemMoves[index].qty) || 0;
        baselineIndex = index;
        break;
      }
    }

    let onHand = baseline;
    const relevantMoves = baselineIndex >= 0 ? itemMoves.slice(baselineIndex + 1) : itemMoves;
    relevantMoves.forEach(move => {
      const qty = Number(move.qty) || 0;
      const type = normalizeMovType(move.movType);
      if (type === 'receipt') onHand += qty;
      if (type === 'issue') onHand -= qty;
      if (type === 'stocktake') onHand = qty;
    });
    onHand = Math.max(0, onHand);

    const cutoff = new Date(now.getTime() - weeksN * 7 * 86400 * 1000);
    const recentIssues = (movements || []).filter(move =>
      move.articleNumber === item.articleNumber &&
      normalizeMovType(move.movType) === 'issue' &&
      new Date(move.timestamp) >= cutoff
    );
    const totalIssued = recentIssues.reduce((sum, move) => sum + (Number(move.qty) || 0), 0);
    const avgWeekly = totalIssued / weeksN;
    const daysLeft = avgWeekly > 0 ? (onHand / avgWeekly) * 7 : (onHand > 0 ? 999 : 0);

    const leadTime = Number(item.leadTimeDays) || 0;
    const safety = Number(item.safetyDays) || 7;
    const minQty = Number(item.minQty) || 0;

    let status;
    if (minQty > 0) {
      status = onHand <= 0 ? 'crit' : onHand <= minQty ? 'crit' : onHand <= minQty * 2 ? 'warn' : 'ok';
    } else {
      status = onHand <= 0 || daysLeft <= 7 ? 'crit'
        : daysLeft <= (leadTime + safety) ? 'warn'
        : 'ok';
    }

    return {
      articleNumber: item.articleNumber,
      onHand,
      avgWeekly,
      daysLeft: Math.round(daysLeft),
      status,
      moveCount: itemMoves.length,
    };
  }

  function buildStockMovementLedger(items, movements) {
    const itemMap = {};
    (items || []).forEach(item => {
      itemMap[item.articleNumber] = item;
    });

    const runningMap = {};
    return sortByTimestampAsc(movements || []).map(move => {
      const current = runningMap[move.articleNumber] ?? 0;
      const qty = Number(move.qty) || 0;
      const type = normalizeMovType(move.movType);
      let after;
      if (type === 'stocktake') after = qty;
      else if (type === 'receipt') after = current + qty;
      else after = Math.max(0, current - qty);
      runningMap[move.articleNumber] = after;

      const item = itemMap[move.articleNumber] || {};
      return {
        ...move,
        stockAfter: after,
        itemName: item.name || move.articleNumber,
        category: item.category || '',
        unit: item.unit || 'ks',
      };
    });
  }

  function buildStockLevels(items, movements, config, exportedAt) {
    return (items || [])
      .filter(item => item.isActive !== false)
      .map(item => {
        const summary = buildStockSummary(item, movements, config);
        return {
          exportedAt,
          articleNumber: item.articleNumber,
          name: item.name || '',
          category: item.category || '',
          unit: item.unit || 'ks',
          onHand: summary.onHand,
          avgWeeklyIssue: summary.avgWeekly,
          daysLeft: summary.daysLeft >= 999 ? null : summary.daysLeft,
          status: summary.status,
          minQty: Number(item.minQty) || 0,
          leadTimeDays: Number(item.leadTimeDays) || 0,
          safetyDays: Number(item.safetyDays) || 0,
        };
      });
  }

  function buildStockLogRows(items, movements, filters) {
    const filter = filters || {};
    const search = String(filter.search || '').trim().toLowerCase();
    return buildStockMovementLedger(items, movements).filter(row => {
      const typeMatch = !filter.movType || filter.movType === 'all' || normalizeMovType(row.movType) === normalizeMovType(filter.movType);
      const searchMatch = !search ||
        String(row.articleNumber || '').toLowerCase().includes(search) ||
        String(row.itemName || '').toLowerCase().includes(search) ||
        String(row.note || '').toLowerCase().includes(search);
      const dateMatch = dateRangeFilter(row.timestamp, filter.from, filter.to);
      return typeMatch && searchMatch && dateMatch;
    });
  }

  const api = {
    getMovementsForItem,
    buildStockSummary,
    buildStockMovementLedger,
    buildStockLevels,
    buildStockLogRows,
  };

  root.stock = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
