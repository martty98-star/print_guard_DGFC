(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function formatTimestamp(value) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) {
      return '';
    }

    return date.toLocaleString('cs-CZ', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  function getMovementTypeLabel(type) {
    const labels = {
      receipt: 'Příjem skladu',
      issue: 'Výdej skladu',
      stocktake: 'Inventura skladu',
    };

    return labels[String(type || '').trim().toLowerCase()] || 'Pohyb skladu';
  }

  function buildStockMovementNotification(move, item) {
    if (!move || !move.articleNumber) {
      return null;
    }

    const itemName = normalizeText(item?.name) || move.articleNumber;
    const articleNumber = normalizeText(move.articleNumber);
    const unit = normalizeText(item?.unit) || 'ks';
    const qty = Number(move.qty);
    const qtyLabel = Number.isFinite(qty) ? `${qty} ${unit}` : unit;

    return {
      type: 'stock_movement_created',
      category: 'stock',
      title: getMovementTypeLabel(move.movType),
      body: `${itemName} (${articleNumber}) · ${qtyLabel}`,
      url: '/?screen=stock-log',
    };
  }

  function buildColoradoRecordNotification(record, machineLabel) {
    if (!record || !record.machineId) {
      return null;
    }

    const label = normalizeText(machineLabel) || normalizeText(record.machineId) || 'Colorado';
    const timestamp = formatTimestamp(record.timestamp);
    const suffix = timestamp ? ` · ${timestamp}` : '';

    return {
      type: 'colorado_record_created',
      category: 'colorado',
      title: 'Colorado záznam uložen',
      body: `${label}${suffix}`,
      url: '/?mode=colorado&screen=co-history',
    };
  }

  async function sendAppNotificationEvent(event) {
    if (!event || typeof fetch !== 'function') {
      return null;
    }

    const res = await fetch('/.netlify/functions/send-app-notification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });

    let result = null;
    try { result = await res.json(); } catch (_) {}

    if (!res.ok || !result?.ok) {
      throw new Error(result?.error || 'Odeslání app notifikace selhalo.');
    }

    return result;
  }

  const api = {
    buildStockMovementNotification,
    buildColoradoRecordNotification,
    sendAppNotificationEvent,
  };

  root.notificationEvents = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
