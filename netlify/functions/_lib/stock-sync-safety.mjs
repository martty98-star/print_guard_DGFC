const VALID_ENTITIES = new Set(['item', 'movement']);
const VALID_ACTIONS = new Set(['upsert', 'delete']);

export const STOCK_ACTION_QUEUE_KEY = 'pg_stock_action_queue_v1';

export function toIsoOrNull(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function normalizeArticleNumber(value) {
  const normalized = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '-');
  return normalized || '';
}

export function normalizeStockAction(rawAction, context = {}) {
  const input = rawAction && typeof rawAction === 'object' ? rawAction : {};
  const payload =
    input.payload && typeof input.payload === 'object'
      ? { ...input.payload }
      : {};
  const entity = String(input.entity || input.kind || '').trim();
  const action = String(input.action || input.op || '').trim();

  if (!VALID_ENTITIES.has(entity)) {
    return { ok: false, error: 'invalid_entity', rawAction: input };
  }
  if (!VALID_ACTIONS.has(action)) {
    return { ok: false, error: 'invalid_action', rawAction: input };
  }

  const key =
    entity === 'item'
      ? normalizeArticleNumber(
          input.key || input.articleNumber || payload.articleNumber,
        )
      : String(input.key || input.id || payload.id || '').trim();
  if (!key) {
    return { ok: false, error: 'missing_key', rawAction: input };
  }

  if (entity === 'item' && payload.articleNumber) {
    payload.articleNumber = normalizeArticleNumber(payload.articleNumber);
  }
  if (entity === 'movement' && payload.articleNumber) {
    payload.articleNumber = normalizeArticleNumber(payload.articleNumber);
  }

  const updatedAt = toIsoOrNull(
    input.updatedAt ||
      payload.updatedAt ||
      payload.updated_at ||
      payload.timestamp,
  );
  if (!updatedAt) {
    return { ok: false, error: 'missing_updated_at', rawAction: input };
  }

  payload.updatedAt = payload.updatedAt || updatedAt;
  if (action === 'delete') {
    payload.deletedAt = payload.deletedAt || updatedAt;
  }

  return {
    ok: true,
    action: {
      action,
      actionId: String(
        input.actionId ||
          input.idempotencyKey ||
          `${entity}:${key}:${updatedAt}:${action}`,
      ),
      clientId: String(input.clientId || context.clientId || ''),
      entity,
      key,
      operator: String(input.operator || context.operator || ''),
      payload,
      source: String(input.source || context.source || 'unknown'),
      updatedAt,
    },
  };
}

export function compareStockUpsert(options = {}) {
  const incomingUpdatedAt = toIsoOrNull(options.incomingUpdatedAt);
  const existingUpdatedAt = toIsoOrNull(options.existingUpdatedAt);
  const existingDeletedAt = toIsoOrNull(options.existingDeletedAt);
  const tombstoneDeletedAt = toIsoOrNull(options.tombstoneDeletedAt);

  if (!incomingUpdatedAt) {
    return { accepted: false, reason: 'missing_incoming_updated_at' };
  }

  const incomingMs = Date.parse(incomingUpdatedAt);
  if (existingDeletedAt) {
    return { accepted: false, reason: 'existing_record_deleted' };
  }

  if (tombstoneDeletedAt && incomingMs <= Date.parse(tombstoneDeletedAt)) {
    return { accepted: false, reason: 'deleted_tombstone_newer_or_equal' };
  }

  if (existingUpdatedAt && incomingMs <= Date.parse(existingUpdatedAt)) {
    return { accepted: false, reason: 'existing_record_newer_or_equal' };
  }

  return { accepted: true, reason: 'incoming_record_newer' };
}

export function compareStockDelete(options = {}) {
  const incomingUpdatedAt = toIsoOrNull(options.incomingUpdatedAt);
  const existingUpdatedAt = toIsoOrNull(options.existingUpdatedAt);
  const existingDeletedAt = toIsoOrNull(options.existingDeletedAt);
  const tombstoneDeletedAt = toIsoOrNull(options.tombstoneDeletedAt);

  if (!incomingUpdatedAt) {
    return { accepted: false, reason: 'missing_incoming_updated_at' };
  }

  const incomingMs = Date.parse(incomingUpdatedAt);
  const knownDeleteAt = existingDeletedAt || tombstoneDeletedAt;
  if (knownDeleteAt && incomingMs <= Date.parse(knownDeleteAt)) {
    return { accepted: false, reason: 'delete_already_newer_or_equal' };
  }

  if (existingUpdatedAt && incomingMs < Date.parse(existingUpdatedAt)) {
    return { accepted: false, reason: 'existing_record_newer' };
  }

  return { accepted: true, reason: 'delete_record_newer_or_equal' };
}
