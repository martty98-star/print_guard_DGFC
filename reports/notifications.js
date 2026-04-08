(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});
  const stockApi = root.stock || (
    typeof module !== 'undefined' && module.exports
      ? require('./stock.js')
      : null
  );

  function buildStockNotificationCandidate(item, movements, config, nowInput) {
    if (!stockApi || typeof stockApi.buildStockSummary !== 'function') {
      return null;
    }

    const summary = stockApi.buildStockSummary(item, movements, config, nowInput);
    const name = item.name || item.articleNumber || 'Položka';
    const articleNumber = String(item.articleNumber || '').trim();
    const unit = item.unit || 'ks';

    if (!articleNumber) {
      return null;
    }

    if (summary.onHand <= 0) {
      return {
        eventKey: `stock:zero:${articleNumber}`,
        category: 'stock',
        eventType: 'stock_zero',
        articleNumber,
        itemName: name,
        status: summary.status,
        onHand: summary.onHand,
        unit,
        daysLeft: summary.daysLeft,
        title: 'Nulový stav skladu',
        body: `${name} (${articleNumber}) je na nule.`,
        url: '/?screen=stock-alerts',
      };
    }

    if (summary.status === 'crit') {
      return {
        eventKey: `stock:critical:${articleNumber}`,
        category: 'stock',
        eventType: 'stock_critical',
        articleNumber,
        itemName: name,
        status: summary.status,
        onHand: summary.onHand,
        unit,
        daysLeft: summary.daysLeft,
        title: 'Kritický stav skladu',
        body: `${name} (${articleNumber}) je kriticky nízko: ${summary.onHand} ${unit}.`,
        url: '/?screen=stock-alerts',
      };
    }

    return null;
  }

  function buildStockNotificationCandidates(items, movements, config, nowInput) {
    return (items || [])
      .filter(item => item && item.isActive !== false)
      .map(item => buildStockNotificationCandidate(item, movements, config, nowInput))
      .filter(Boolean);
  }

  function buildNotificationCandidates(context) {
    return {
      stock: buildStockNotificationCandidates(
        context?.items,
        context?.movements,
        context?.config,
        context?.now
      ),
    };
  }

  const api = {
    buildNotificationCandidates,
    buildStockNotificationCandidates,
  };

  root.notifications = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
