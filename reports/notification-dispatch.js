(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});

  function getNotificationModel() {
    if (root.notificationModel) {
      return root.notificationModel;
    }

    if (typeof module !== 'undefined' && module.exports) {
      return require('./notification-model.js');
    }

    return null;
  }

  async function postJson(url, payload) {
    if (typeof fetch !== 'function') {
      return null;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    let result = null;
    try { result = await res.json(); } catch (_) {}

    if (!res.ok || !result || !result.ok) {
      throw new Error((result && result.error) || 'Notification request failed.');
    }

    return result;
  }

  function dispatchNotificationEvent(event) {
    if (!event) {
      return Promise.resolve(null);
    }

    return postJson('/.netlify/functions/send-app-notification', event);
  }

  function emitStockMovementCreated(move, item) {
    const model = getNotificationModel();
    const event = model && typeof model.buildStockMovementCreatedEvent === 'function'
      ? model.buildStockMovementCreatedEvent(move, item)
      : null;

    return dispatchNotificationEvent(event);
  }

  function emitColoradoRecordCreated(record, machineLabel) {
    const model = getNotificationModel();
    const event = model && typeof model.buildColoradoRecordCreatedEvent === 'function'
      ? model.buildColoradoRecordCreatedEvent(record, machineLabel)
      : null;

    return dispatchNotificationEvent(event);
  }

  function evaluateStockAlerts(options) {
    return postJson('/.netlify/functions/send-stock-alerts', options || {});
  }

  const api = {
    dispatchNotificationEvent,
    emitStockMovementCreated,
    emitColoradoRecordCreated,
    evaluateStockAlerts,
  };

  root.notificationDispatch = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
