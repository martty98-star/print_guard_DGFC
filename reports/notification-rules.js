(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});
  const stockApi = root.stock || (
    typeof module !== 'undefined' && module.exports
      ? require('./stock.js')
      : null
  );
  const notificationModel = root.notificationModel || (
    typeof module !== 'undefined' && module.exports
      ? require('./notification-model.js')
      : null
  );

  function buildStockNotificationCandidate(item, movements, config, nowInput) {
    if (!stockApi || typeof stockApi.buildStockSummary !== 'function' || !notificationModel) {
      return null;
    }

    const summary = stockApi.buildStockSummary(item, movements, config, nowInput);
    const articleNumber = String(item && item.articleNumber || '').trim();
    const itemName = item && (item.name || item.articleNumber) || 'Polozka';
    const unit = item && item.unit || 'ks';

    if (!articleNumber) {
      return null;
    }

    if (summary.onHand <= 0) {
      return notificationModel.buildStockZeroAlertEvent({
        articleNumber,
        itemName,
        status: summary.status,
        onHand: summary.onHand,
        unit,
        daysLeft: summary.daysLeft,
      });
    }

    if (summary.status === 'crit') {
      return notificationModel.buildStockCriticalAlertEvent({
        articleNumber,
        itemName,
        status: summary.status,
        onHand: summary.onHand,
        unit,
        daysLeft: summary.daysLeft,
      });
    }

    return null;
  }

  function buildStockNotificationCandidates(items, movements, config, nowInput) {
    return (items || [])
      .filter((item) => item && item.isActive !== false)
      .map((item) => buildStockNotificationCandidate(item, movements, config, nowInput))
      .filter(Boolean);
  }

  function buildNotificationCandidates(context) {
    return {
      stock: buildStockNotificationCandidates(
        context && context.items,
        context && context.movements,
        context && context.config,
        context && context.now
      ),
    };
  }

  const api = {
    buildNotificationCandidates,
    buildStockNotificationCandidates,
  };

  root.notificationRules = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
