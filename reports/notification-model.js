(function (global) {
  const root = global.PrintGuardReports || (global.PrintGuardReports = {});

  const EVENT_TYPES = {
    STOCK_MOVEMENT_CREATED: 'stock.movement.created',
    STOCK_RECEIPT_CREATED: 'stock.receipt.created',
    STOCK_ISSUE_CREATED: 'stock.issue.created',
    STOCK_STOCKTAKE_CREATED: 'stock.stocktake.created',
    COLORADO_RECORD_CREATED: 'colorado.record.created',
    STOCK_ALERT_ZERO: 'stock.alert.zero',
    STOCK_ALERT_CRITICAL: 'stock.alert.critical',
  };

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

  function getMovementLabel(type) {
    const labels = {
      receipt: 'Prijem skladu',
      issue: 'Vydej skladu',
      stocktake: 'Inventura skladu',
    };

    return labels[String(type || '').trim().toLowerCase()] || 'Pohyb skladu';
  }

  function getMovementEventType(type) {
    const normalized = String(type || '').trim().toLowerCase();

    if (normalized === 'receipt') return EVENT_TYPES.STOCK_RECEIPT_CREATED;
    if (normalized === 'issue') return EVENT_TYPES.STOCK_ISSUE_CREATED;
    if (normalized === 'stocktake') return EVENT_TYPES.STOCK_STOCKTAKE_CREATED;

    return EVENT_TYPES.STOCK_MOVEMENT_CREATED;
  }

  function createEvent(input) {
    if (!input || typeof input !== 'object') {
      return null;
    }

    const type = normalizeText(input.type);
    const category = normalizeText(input.category).toLowerCase();
    const title = normalizeText(input.title);
    const body = normalizeText(input.body);
    const url = normalizeText(input.url) || '/';
    const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
      ? input.metadata
      : {};
    const dedupeKey = normalizeText(input.dedupeKey) || null;

    if (!type || !category || !title || !body) {
      return null;
    }

    return {
      type,
      category,
      title,
      body,
      url,
      metadata,
      dedupeKey,
    };
  }

  function buildStockMovementCreatedEvent(move, item) {
    if (!move || !move.articleNumber) {
      return null;
    }

    const itemName = normalizeText(item && item.name) || normalizeText(move.articleNumber);
    const articleNumber = normalizeText(move.articleNumber);
    const unit = normalizeText(item && item.unit) || 'ks';
    const qty = Number(move.qty);
    const qtyLabel = Number.isFinite(qty) ? `${qty} ${unit}` : unit;

    return createEvent({
      type: getMovementEventType(move.movType),
      category: 'stock',
      title: getMovementLabel(move.movType),
      body: `${itemName} (${articleNumber}) · ${qtyLabel}`,
      url: '/?screen=stock-log',
      metadata: {
        articleNumber,
        itemName,
        movType: normalizeText(move.movType).toLowerCase() || null,
        qty: Number.isFinite(qty) ? qty : null,
        unit,
        deviceId: normalizeText(move.deviceId) || null,
        timestamp: normalizeText(move.timestamp) || null,
      },
    });
  }

  function buildColoradoRecordCreatedEvent(record, machineLabel) {
    if (!record || !record.machineId) {
      return null;
    }

    const label = normalizeText(machineLabel) || normalizeText(record.machineId) || 'Colorado';
    const timestamp = formatTimestamp(record.timestamp);
    const suffix = timestamp ? ` · ${timestamp}` : '';

    return createEvent({
      type: EVENT_TYPES.COLORADO_RECORD_CREATED,
      category: 'colorado',
      title: 'Colorado zaznam ulozen',
      body: `${label}${suffix}`,
      url: '/?mode=colorado&screen=co-history',
      metadata: {
        machineId: normalizeText(record.machineId) || null,
        machineLabel: label,
        timestamp: normalizeText(record.timestamp) || null,
      },
    });
  }

  function buildStockZeroAlertEvent(input) {
    if (!input || !input.articleNumber) {
      return null;
    }

    const articleNumber = normalizeText(input.articleNumber);
    const itemName = normalizeText(input.itemName) || articleNumber || 'Polozka';
    const unit = normalizeText(input.unit) || 'ks';
    const onHand = Number(input.onHand);
    const daysLeft = Number(input.daysLeft);
    const status = normalizeText(input.status);

    return createEvent({
      type: EVENT_TYPES.STOCK_ALERT_ZERO,
      category: 'stock',
      title: 'Nulovy stav skladu',
      body: `${itemName} (${articleNumber}) je na nule.`,
      url: '/?screen=stock-alerts',
      dedupeKey: `stock:zero:${articleNumber}`,
      metadata: {
        articleNumber,
        itemName,
        status,
        onHand: Number.isFinite(onHand) ? onHand : null,
        unit,
        daysLeft: Number.isFinite(daysLeft) ? daysLeft : null,
      },
    });
  }

  function buildStockCriticalAlertEvent(input) {
    if (!input || !input.articleNumber) {
      return null;
    }

    const articleNumber = normalizeText(input.articleNumber);
    const itemName = normalizeText(input.itemName) || articleNumber || 'Polozka';
    const unit = normalizeText(input.unit) || 'ks';
    const onHand = Number(input.onHand);
    const daysLeft = Number(input.daysLeft);
    const status = normalizeText(input.status);
    const onHandLabel = Number.isFinite(onHand) ? onHand : 0;

    return createEvent({
      type: EVENT_TYPES.STOCK_ALERT_CRITICAL,
      category: 'stock',
      title: 'Kriticky stav skladu',
      body: `${itemName} (${articleNumber}) je kriticky nizko: ${onHandLabel} ${unit}.`,
      url: '/?screen=stock-alerts',
      dedupeKey: `stock:critical:${articleNumber}`,
      metadata: {
        articleNumber,
        itemName,
        status,
        onHand: Number.isFinite(onHand) ? onHand : null,
        unit,
        daysLeft: Number.isFinite(daysLeft) ? daysLeft : null,
      },
    });
  }

  const api = {
    EVENT_TYPES,
    createEvent,
    buildStockMovementCreatedEvent,
    buildColoradoRecordCreatedEvent,
    buildStockZeroAlertEvent,
    buildStockCriticalAlertEvent,
  };

  root.notificationModel = api;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
