// netlify/functions/sync.js
import pg from "pg";
import crypto from "crypto";
import {
  compareStockDelete,
  compareStockUpsert,
  normalizeArticleNumber,
  normalizeStockAction,
  toIsoOrNull,
} from "./_lib/stock-sync-safety.mjs";
const { Client } = pg;

const rateLimitBuckets = new Map();
let syncSchemaReady = false;
let syncSchemaReadyPromise = null;

function getAdminApiKey() {
  const value = process.env.ADMIN_API_KEY || "";
  const key = typeof value === "string" ? value.trim() : "";
  if (!key) throw new Error("ADMIN_API_KEY is not configured");
  return key;
}

function getAdminPin() {
  const value = process.env.ADMIN_PIN || "";
  const pin = typeof value === "string" ? value.trim() : "";
  if (!pin) throw new Error("ADMIN_PIN is not configured");
  return pin;
}

function getHeader(event, name) {
  if (!event || !event.headers) return "";
  const lower = String(name || "").toLowerCase();
  for (const [key, value] of Object.entries(event.headers)) {
    if (String(key).toLowerCase() === lower) {
      return typeof value === "string" ? value.trim() : "";
    }
  }
  return "";
}

function resp(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getRequestIdentity(event) {
  return getHeader(event, "x-forwarded-for").split(",")[0].trim() ||
    getHeader(event, "client-ip") ||
    "unknown";
}

function checkRateLimit(event, name, maxRequests = 30, windowMs = 60 * 1000) {
  const now = Date.now();
  const identity = getRequestIdentity(event);
  const key = `${name}:${identity}`;
  const bucket = rateLimitBuckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > maxRequests) {
    const error = new Error("Too many requests");
    error.statusCode = 429;
    throw error;
  }
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function checkAdminApiKey(event) {
  const providedKey = getHeader(event, "x-api-key");
  if (!providedKey) return false;
  return timingSafeEqualString(providedKey, getAdminApiKey());
}

function checkAdminPin(event) {
  const providedPin = getHeader(event, "x-admin-pin");
  if (!providedPin) return false;
  return timingSafeEqualString(providedPin, getAdminPin());
}

function requireAdminAccess(event) {
  if (checkAdminApiKey(event) || checkAdminPin(event)) return;
  {
    const error = new Error("Unauthorized");
    error.statusCode = 401;
    throw error;
  }
}

function chunkArray(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function getSyncContext(event, payload = {}) {
  return {
    clientId: String(payload.clientId || getHeader(event, "x-printguard-client-id") || ""),
    operator: String(payload.operator || getHeader(event, "x-printguard-operator") || ""),
    requestId: crypto.randomUUID(),
    source: String(payload.source || getHeader(event, "x-printguard-sync-source") || "sync_api"),
  };
}

function mapStockData(row) {
  const data = row && row.data && typeof row.data === "object" ? { ...row.data } : {};
  const updatedAt = toIsoOrNull(data.updatedAt || data.updated_at || row?.updated_at);
  return updatedAt ? { ...data, updatedAt } : data;
}

async function ensureStockSyncSchema(client) {
  await client.query(`
    create table if not exists public.pg_items (
      article_number text primary key,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      deleted_at timestamptz null,
      sync_source text null,
      sync_client_id text null,
      sync_operator text null
    )
  `);
  await client.query(`
    create table if not exists public.pg_movements (
      id text primary key,
      article_number text not null,
      timestamp timestamptz not null,
      data jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now(),
      deleted_at timestamptz null,
      sync_source text null,
      sync_client_id text null,
      sync_operator text null
    )
  `);
  await client.query(`alter table public.pg_items add column if not exists deleted_at timestamptz null`);
  await client.query(`alter table public.pg_items add column if not exists sync_source text null`);
  await client.query(`alter table public.pg_items add column if not exists sync_client_id text null`);
  await client.query(`alter table public.pg_items add column if not exists sync_operator text null`);
  await client.query(`alter table public.pg_movements add column if not exists deleted_at timestamptz null`);
  await client.query(`alter table public.pg_movements add column if not exists sync_source text null`);
  await client.query(`alter table public.pg_movements add column if not exists sync_client_id text null`);
  await client.query(`alter table public.pg_movements add column if not exists sync_operator text null`);
  await client.query(`
    create table if not exists public.pg_stock_tombstones (
      entity text not null,
      key text not null,
      deleted_at timestamptz not null default now(),
      source text null,
      client_id text null,
      operator text null,
      payload jsonb null,
      created_at timestamptz not null default now(),
      primary key (entity, key)
    )
  `);
  await client.query(`
    create table if not exists public.pg_stock_write_audit (
      id bigserial primary key,
      entity text not null,
      stock_item_id text null,
      movement_id text null,
      action text not null,
      source text null,
      client_id text null,
      operator text null,
      request_id text null,
      incoming_updated_at timestamptz null,
      accepted boolean not null default false,
      reason text null,
      before_payload jsonb null,
      after_payload jsonb null,
      created_at timestamptz not null default now()
    )
  `);
  await client.query(`
    create index if not exists pg_items_active_idx
      on public.pg_items(article_number)
      where deleted_at is null
  `);
  await client.query(`
    create index if not exists pg_movements_active_article_idx
      on public.pg_movements(article_number, timestamp)
      where deleted_at is null
  `);
}

async function ensureSyncTables(client) {
  if (syncSchemaReady) return;
  if (syncSchemaReadyPromise) {
    await syncSchemaReadyPromise;
    return;
  }
  syncSchemaReadyPromise = (async () => {
    await ensureStockSyncSchema(client);
    await client.query(`
      create table if not exists public.pg_colorado_roll_states (
        machine_id text primary key,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create table if not exists public.pg_colorado_roll_events (
        id text primary key,
        machine_id text not null,
        event_type text not null,
        timestamp timestamptz not null,
        data jsonb not null,
        updated_at timestamptz not null default now()
      )
    `);
    await client.query(`
      create index if not exists pg_colorado_roll_events_machine_time_idx
        on public.pg_colorado_roll_events(machine_id, timestamp desc)
    `);
    syncSchemaReady = true;
  })();
  try {
    await syncSchemaReadyPromise;
  } finally {
    syncSchemaReadyPromise = null;
  }
}

async function auditStockWrite(client, entry) {
  await client.query(
    `
      insert into public.pg_stock_write_audit (
        entity,
        stock_item_id,
        movement_id,
        action,
        source,
        client_id,
        operator,
        request_id,
        incoming_updated_at,
        accepted,
        reason,
        before_payload,
        after_payload
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11, $12::jsonb, $13::jsonb)
    `,
    [
      entry.entity,
      entry.entity === "item" ? entry.key : null,
      entry.entity === "movement" ? entry.key : null,
      entry.action,
      entry.source || null,
      entry.clientId || null,
      entry.operator || null,
      entry.requestId || null,
      entry.incomingUpdatedAt || null,
      Boolean(entry.accepted),
      entry.reason || null,
      entry.beforePayload ? JSON.stringify(entry.beforePayload) : null,
      entry.afterPayload ? JSON.stringify(entry.afterPayload) : null,
    ]
  );
}

async function getStockRow(client, entity, key) {
  if (entity === "item") {
    const result = await client.query(
      `select data, updated_at, deleted_at from public.pg_items where article_number = $1`,
      [key]
    );
    return result.rows[0] || null;
  }
  const result = await client.query(
    `select data, updated_at, deleted_at, article_number from public.pg_movements where id = $1`,
    [key]
  );
  return result.rows[0] || null;
}

async function getStockTombstone(client, entity, key) {
  const result = await client.query(
    `select deleted_at, payload from public.pg_stock_tombstones where entity = $1 and key = $2`,
    [entity, key]
  );
  return result.rows[0] || null;
}

async function rejectLegacyStockPayload(client, entity, rows, context) {
  const valid = (Array.isArray(rows) ? rows : []).filter((row) =>
    entity === "item" ? row?.articleNumber : row?.id
  );
  for (const row of valid) {
    const key = entity === "item" ? normalizeArticleNumber(row.articleNumber) : String(row.id || "").trim();
    await auditStockWrite(client, {
      entity,
      key,
      action: "legacy_full_snapshot_rejected",
      source: "legacy_full_snapshot",
      clientId: context.clientId,
      operator: context.operator,
      requestId: context.requestId,
      incomingUpdatedAt: toIsoOrNull(row.updatedAt || row.updated_at || row.timestamp),
      accepted: false,
      reason: "full_local_stock_snapshot_is_not_authoritative",
      beforePayload: null,
      afterPayload: row,
    });
  }
  if (valid.length) {
    console.warn("[stock-sync] rejected legacy full stock snapshot", {
      entity,
      count: valid.length,
      clientId: context.clientId || null,
      operator: context.operator || null,
      requestId: context.requestId,
    });
  }
  return valid.length;
}

async function writeStockTombstone(client, action, existingPayload = null) {
  await client.query(
    `
      insert into public.pg_stock_tombstones(entity, key, deleted_at, source, client_id, operator, payload)
      values ($1, $2, $3::timestamptz, $4, $5, $6, $7::jsonb)
      on conflict (entity, key) do update
      set deleted_at = greatest(public.pg_stock_tombstones.deleted_at, excluded.deleted_at),
          source = excluded.source,
          client_id = excluded.client_id,
          operator = excluded.operator,
          payload = coalesce(excluded.payload, public.pg_stock_tombstones.payload)
    `,
    [
      action.entity,
      action.key,
      action.updatedAt,
      action.source || null,
      action.clientId || null,
      action.operator || null,
      JSON.stringify(existingPayload || action.payload || {}),
    ]
  );
}

async function applyItemUpsert(client, action, context) {
  const existing = await getStockRow(client, "item", action.key);
  const tombstone = await getStockTombstone(client, "item", action.key);
  const decision = compareStockUpsert({
    incomingUpdatedAt: action.updatedAt,
    existingUpdatedAt: existing?.updated_at,
    existingDeletedAt: existing?.deleted_at,
    tombstoneDeletedAt: tombstone?.deleted_at,
  });
  if (!decision.accepted) {
    await auditStockWrite(client, {
      entity: "item",
      key: action.key,
      action: "upsert",
      source: action.source,
      clientId: action.clientId,
      operator: action.operator,
      requestId: context.requestId,
      incomingUpdatedAt: action.updatedAt,
      accepted: false,
      reason: decision.reason,
      beforePayload: existing?.data || tombstone?.payload || null,
      afterPayload: action.payload,
    });
    return { ...decision, actionId: action.actionId, entity: "item", key: action.key };
  }

  const payload = {
    ...action.payload,
    articleNumber: action.key,
    updatedAt: action.updatedAt,
  };
  await client.query(
    `
      insert into public.pg_items(article_number, data, updated_at, deleted_at, sync_source, sync_client_id, sync_operator)
      values ($1, $2::jsonb, $3::timestamptz, null, $4, $5, $6)
      on conflict (article_number) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted_at = null,
          sync_source = excluded.sync_source,
          sync_client_id = excluded.sync_client_id,
          sync_operator = excluded.sync_operator
      where excluded.updated_at > public.pg_items.updated_at
        and public.pg_items.deleted_at is null
    `,
    [
      action.key,
      JSON.stringify(payload),
      action.updatedAt,
      action.source || null,
      action.clientId || null,
      action.operator || null,
    ]
  );
  await client.query(
    `delete from public.pg_stock_tombstones where entity = 'item' and key = $1 and deleted_at < $2::timestamptz`,
    [action.key, action.updatedAt]
  );
  await auditStockWrite(client, {
    entity: "item",
    key: action.key,
    action: "upsert",
    source: action.source,
    clientId: action.clientId,
    operator: action.operator,
    requestId: context.requestId,
    incomingUpdatedAt: action.updatedAt,
    accepted: true,
    reason: decision.reason,
    beforePayload: existing?.data || tombstone?.payload || null,
    afterPayload: payload,
  });
  return { accepted: true, reason: decision.reason, actionId: action.actionId, entity: "item", key: action.key };
}

async function applyMovementUpsert(client, action, context) {
  const articleNumber = normalizeArticleNumber(action.payload.articleNumber);
  if (!articleNumber) {
    const result = { accepted: false, reason: "missing_movement_article_number" };
    await auditStockWrite(client, {
      entity: "movement",
      key: action.key,
      action: "upsert",
      source: action.source,
      clientId: action.clientId,
      operator: action.operator,
      requestId: context.requestId,
      incomingUpdatedAt: action.updatedAt,
      accepted: false,
      reason: result.reason,
      beforePayload: null,
      afterPayload: action.payload,
    });
    return { ...result, actionId: action.actionId, entity: "movement", key: action.key };
  }

  const parent = await getStockRow(client, "item", articleNumber);
  const parentTombstone = await getStockTombstone(client, "item", articleNumber);
  if (!parent || parent.deleted_at || parentTombstone?.deleted_at) {
    const result = { accepted: false, reason: "missing_or_deleted_parent_item" };
    await auditStockWrite(client, {
      entity: "movement",
      key: action.key,
      action: "upsert",
      source: action.source,
      clientId: action.clientId,
      operator: action.operator,
      requestId: context.requestId,
      incomingUpdatedAt: action.updatedAt,
      accepted: false,
      reason: result.reason,
      beforePayload: null,
      afterPayload: action.payload,
    });
    return { ...result, actionId: action.actionId, entity: "movement", key: action.key };
  }

  const existing = await getStockRow(client, "movement", action.key);
  const tombstone = await getStockTombstone(client, "movement", action.key);
  const decision = compareStockUpsert({
    incomingUpdatedAt: action.updatedAt,
    existingUpdatedAt: existing?.updated_at,
    existingDeletedAt: existing?.deleted_at,
    tombstoneDeletedAt: tombstone?.deleted_at,
  });
  if (!decision.accepted) {
    await auditStockWrite(client, {
      entity: "movement",
      key: action.key,
      action: "upsert",
      source: action.source,
      clientId: action.clientId,
      operator: action.operator,
      requestId: context.requestId,
      incomingUpdatedAt: action.updatedAt,
      accepted: false,
      reason: decision.reason,
      beforePayload: existing?.data || tombstone?.payload || null,
      afterPayload: action.payload,
    });
    return { ...decision, actionId: action.actionId, entity: "movement", key: action.key };
  }

  const payload = {
    ...action.payload,
    id: action.key,
    articleNumber,
    updatedAt: action.updatedAt,
  };
  const timestamp = toIsoOrNull(payload.timestamp) || action.updatedAt;
  await client.query(
    `
      insert into public.pg_movements(id, article_number, timestamp, data, updated_at, deleted_at, sync_source, sync_client_id, sync_operator)
      values ($1, $2, $3::timestamptz, $4::jsonb, $5::timestamptz, null, $6, $7, $8)
      on conflict (id) do update
      set article_number = excluded.article_number,
          timestamp = excluded.timestamp,
          data = excluded.data,
          updated_at = excluded.updated_at,
          deleted_at = null,
          sync_source = excluded.sync_source,
          sync_client_id = excluded.sync_client_id,
          sync_operator = excluded.sync_operator
      where excluded.updated_at > public.pg_movements.updated_at
        and public.pg_movements.deleted_at is null
    `,
    [
      action.key,
      articleNumber,
      timestamp,
      JSON.stringify(payload),
      action.updatedAt,
      action.source || null,
      action.clientId || null,
      action.operator || null,
    ]
  );
  await client.query(
    `delete from public.pg_stock_tombstones where entity = 'movement' and key = $1 and deleted_at < $2::timestamptz`,
    [action.key, action.updatedAt]
  );
  await auditStockWrite(client, {
    entity: "movement",
    key: action.key,
    action: "upsert",
    source: action.source,
    clientId: action.clientId,
    operator: action.operator,
    requestId: context.requestId,
    incomingUpdatedAt: action.updatedAt,
    accepted: true,
    reason: decision.reason,
    beforePayload: existing?.data || tombstone?.payload || null,
    afterPayload: payload,
  });
  return { accepted: true, reason: decision.reason, actionId: action.actionId, entity: "movement", key: action.key };
}

async function applyStockDelete(client, action, context) {
  const existing = await getStockRow(client, action.entity, action.key);
  const tombstone = await getStockTombstone(client, action.entity, action.key);
  const decision = compareStockDelete({
    incomingUpdatedAt: action.updatedAt,
    existingUpdatedAt: existing?.updated_at,
    existingDeletedAt: existing?.deleted_at,
    tombstoneDeletedAt: tombstone?.deleted_at,
  });
  if (!decision.accepted) {
    await auditStockWrite(client, {
      entity: action.entity,
      key: action.key,
      action: "delete",
      source: action.source,
      clientId: action.clientId,
      operator: action.operator,
      requestId: context.requestId,
      incomingUpdatedAt: action.updatedAt,
      accepted: false,
      reason: decision.reason,
      beforePayload: existing?.data || tombstone?.payload || null,
      afterPayload: action.payload,
    });
    return { ...decision, actionId: action.actionId, entity: action.entity, key: action.key };
  }

  await writeStockTombstone(client, action, existing?.data || tombstone?.payload || null);
  if (action.entity === "item") {
    const relatedMovements = await client.query(
      `select id, data from public.pg_movements where article_number = $1 and deleted_at is null`,
      [action.key]
    );
    for (const movement of relatedMovements.rows) {
      await client.query(
        `
          insert into public.pg_stock_tombstones(entity, key, deleted_at, source, client_id, operator, payload)
          values ('movement', $1, $2::timestamptz, $3, $4, $5, $6::jsonb)
          on conflict (entity, key) do update
          set deleted_at = greatest(public.pg_stock_tombstones.deleted_at, excluded.deleted_at),
              source = excluded.source,
              client_id = excluded.client_id,
              operator = excluded.operator,
              payload = excluded.payload
        `,
        [
          movement.id,
          action.updatedAt,
          action.source || null,
          action.clientId || null,
          action.operator || null,
          JSON.stringify(movement.data || {}),
        ]
      );
    }
    await client.query(
      `
        update public.pg_movements
        set deleted_at = $2::timestamptz,
            updated_at = greatest(updated_at, $2::timestamptz),
            sync_source = $3,
            sync_client_id = $4,
            sync_operator = $5
        where article_number = $1
          and deleted_at is null
      `,
      [action.key, action.updatedAt, action.source || null, action.clientId || null, action.operator || null]
    );
    await client.query(
      `
        update public.pg_items
        set deleted_at = $2::timestamptz,
            updated_at = greatest(updated_at, $2::timestamptz),
            sync_source = $3,
            sync_client_id = $4,
            sync_operator = $5
        where article_number = $1
          and deleted_at is null
      `,
      [action.key, action.updatedAt, action.source || null, action.clientId || null, action.operator || null]
    );
  } else {
    await client.query(
      `
        update public.pg_movements
        set deleted_at = $2::timestamptz,
            updated_at = greatest(updated_at, $2::timestamptz),
            sync_source = $3,
            sync_client_id = $4,
            sync_operator = $5
        where id = $1
          and deleted_at is null
      `,
      [action.key, action.updatedAt, action.source || null, action.clientId || null, action.operator || null]
    );
  }

  await auditStockWrite(client, {
    entity: action.entity,
    key: action.key,
    action: "delete",
    source: action.source,
    clientId: action.clientId,
    operator: action.operator,
    requestId: context.requestId,
    incomingUpdatedAt: action.updatedAt,
    accepted: true,
    reason: decision.reason,
    beforePayload: existing?.data || tombstone?.payload || null,
    afterPayload: action.payload,
  });
  return { accepted: true, reason: decision.reason, actionId: action.actionId, entity: action.entity, key: action.key };
}

async function applyStockAction(client, action, context) {
  if (action.action === "delete") return applyStockDelete(client, action, context);
  if (action.entity === "item") return applyItemUpsert(client, action, context);
  return applyMovementUpsert(client, action, context);
}

async function applyStockActions(client, actions, context) {
  const normalized = [];
  const rejected = [];

  (Array.isArray(actions) ? actions : []).forEach((rawAction, index) => {
    const result = normalizeStockAction(rawAction, context);
    if (!result.ok) {
      rejected.push({
        accepted: false,
        actionId: rawAction?.actionId || rawAction?.idempotencyKey || `invalid:${index}`,
        reason: result.error,
      });
      return;
    }
    normalized.push({ ...result.action, queueIndex: index });
  });

  normalized.sort((left, right) => {
    const timeDiff = Date.parse(left.updatedAt) - Date.parse(right.updatedAt);
    return timeDiff || left.queueIndex - right.queueIndex;
  });

  const results = [...rejected];
  for (const action of normalized) {
    results.push(await applyStockAction(client, action, context));
  }

  const acceptedCount = results.filter((result) => result.accepted).length;
  const rejectedCount = results.length - acceptedCount;
  if (results.length) {
    console.log("[stock-sync] stock action batch processed", {
      accepted: acceptedCount,
      rejected: rejectedCount,
      clientId: context.clientId || null,
      operator: context.operator || null,
      requestId: context.requestId,
    });
  }

  return {
    accepted: acceptedCount,
    rejected: rejectedCount,
    results,
  };
}

async function batchUpsertCoRecords(client, coRecords) {
  const valid = coRecords.filter((record) => record?.id);
  for (const chunk of chunkArray(valid, 300)) {
    const params = [];
    const valuesSql = chunk.map((record, index) => {
      const base = index * 4;
      const effectiveUpdatedAt = record.updatedAt || record.updated_at || record.deletedAt || record.createdAt || record.timestamp || new Date().toISOString();
      const normalized = {
        ...record,
        updatedAt: record.updatedAt || effectiveUpdatedAt,
      };
      params.push(
        normalized.id,
        normalized.machineId || "",
        normalized.timestamp || effectiveUpdatedAt,
        JSON.stringify(normalized),
        effectiveUpdatedAt
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::jsonb, $${base + 5}::timestamptz)`;
    }).join(",");

    await client.query(
      `insert into public.pg_co_records(id, machine_id, timestamp, data, updated_at)
       values ${valuesSql}
       on conflict (id) do update
       set data = excluded.data, updated_at = excluded.updated_at
       where coalesce(nullif((excluded.data ->> 'updatedAt'), '')::timestamptz, excluded.updated_at)
         >= coalesce(nullif((public.pg_co_records.data ->> 'updatedAt'), '')::timestamptz, public.pg_co_records.updated_at)`,
      params
    );
  }
  return valid.length;
}

function getPayloadUpdatedAt(value) {
  return value?.updatedAt || value?.updated_at || value?.timestamp || value?.loadedAt || new Date().toISOString();
}

async function batchUpsertColoradoRollStates(client, rollStates) {
  const valid = rollStates.filter((state) => state?.machineId);
  for (const chunk of chunkArray(valid, 300)) {
    const params = [];
    const valuesSql = chunk.map((state, index) => {
      const base = index * 3;
      const updatedAt = getPayloadUpdatedAt(state);
      const normalized = {
        ...state,
        updatedAt: state.updatedAt || updatedAt,
      };
      params.push(
        normalized.machineId,
        JSON.stringify(normalized),
        updatedAt
      );
      return `($${base + 1}, $${base + 2}::jsonb, $${base + 3}::timestamptz)`;
    }).join(",");

    await client.query(
      `insert into public.pg_colorado_roll_states(machine_id, data, updated_at)
       values ${valuesSql}
       on conflict (machine_id) do update
       set data = excluded.data, updated_at = excluded.updated_at
       where excluded.updated_at >= public.pg_colorado_roll_states.updated_at`,
      params
    );
  }
  return valid.length;
}

async function batchUpsertColoradoRollEvents(client, rollEvents) {
  const valid = rollEvents.filter((event) => event?.id && event?.machineId && event?.type);
  for (const chunk of chunkArray(valid, 300)) {
    const params = [];
    const valuesSql = chunk.map((event, index) => {
      const base = index * 6;
      const timestamp = event.timestamp || new Date().toISOString();
      const updatedAt = getPayloadUpdatedAt(event);
      const normalized = {
        ...event,
        timestamp,
        updatedAt: event.updatedAt || updatedAt,
      };
      params.push(
        normalized.id,
        normalized.machineId,
        normalized.type,
        timestamp,
        JSON.stringify(normalized),
        updatedAt
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}::timestamptz, $${base + 5}::jsonb, $${base + 6}::timestamptz)`;
    }).join(",");

    await client.query(
      `insert into public.pg_colorado_roll_events(id, machine_id, event_type, timestamp, data, updated_at)
       values ${valuesSql}
       on conflict (id) do update
       set machine_id = excluded.machine_id,
           event_type = excluded.event_type,
           timestamp = excluded.timestamp,
           data = excluded.data,
           updated_at = excluded.updated_at
       where excluded.updated_at >= public.pg_colorado_roll_events.updated_at`,
      params
    );
  }
  return valid.length;
}

export async function handler(event) {
  const conn = process.env.NEON_DATABASE_URL || process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL;
  if (!conn) return resp(500, { ok: false, error: "Missing NEON_DATABASE_URL" });

  if (event.httpMethod === "DELETE") {
    try {
      checkRateLimit(event, "sync-delete", 20);
      requireAdminAccess(event);
    } catch (e) {
      if (e && (e.statusCode === 401 || e.statusCode === 429)) {
        return resp(e.statusCode, { ok: false, error: e.message });
      }
      return resp(500, { ok: false, error: String(e?.message || e) });
    }
  }

  const client = new Client({
    connectionString: conn,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    await ensureSyncTables(client);

    // ---------- GET = pull ----------
    if (event.httpMethod === "GET") {
      const items = (await client.query(
        "select data, updated_at from public.pg_items where deleted_at is null order by article_number asc"
      )).rows.map(mapStockData);
      const movements = (await client.query(
        "select data, updated_at from public.pg_movements where deleted_at is null order by timestamp asc, id asc"
      )).rows.map(mapStockData);
      const coRecords = (await client.query("select data, updated_at from public.pg_co_records order by timestamp asc")).rows.map((r) => ({
        ...(r.data || {}),
        updatedAt: r.data?.updatedAt || r.updated_at || null,
      }));
      const coloradoRollStates = (await client.query("select data, updated_at from public.pg_colorado_roll_states order by machine_id asc")).rows.map((r) => ({
        ...(r.data || {}),
        updatedAt: r.data?.updatedAt || r.updated_at || null,
      }));
      const coloradoRollEvents = (await client.query("select data, updated_at from public.pg_colorado_roll_events order by timestamp asc, id asc")).rows.map((r) => ({
        ...(r.data || {}),
        updatedAt: r.data?.updatedAt || r.updated_at || null,
      }));

      return resp(200, { ok: true, items, movements, coRecords, coloradoRollStates, coloradoRollEvents });
    }

    // ---------- POST = push ----------
    if (event.httpMethod === "POST") {
      const payload = JSON.parse(event.body || "{}");
      const context = getSyncContext(event, payload);
      const items = Array.isArray(payload.items) ? payload.items : [];
      const movements = Array.isArray(payload.movements) ? payload.movements : [];
      const stockActions = Array.isArray(payload.stockActions) ? payload.stockActions : [];
      const coRecords = Array.isArray(payload.coRecords) ? payload.coRecords : [];
      const coloradoRollStates = Array.isArray(payload.coloradoRollStates) ? payload.coloradoRollStates : [];
      const coloradoRollEvents = Array.isArray(payload.coloradoRollEvents) ? payload.coloradoRollEvents : [];

      await client.query("begin");

      const rejectedLegacyItems = await rejectLegacyStockPayload(client, "item", items, context);
      const rejectedLegacyMovements = await rejectLegacyStockPayload(client, "movement", movements, context);
      const stockActionSummary = await applyStockActions(client, stockActions, context);
      const acceptedItemActions = stockActionSummary.results.filter((result) => result.accepted && result.entity === "item").length;
      const acceptedMovementActions = stockActionSummary.results.filter((result) => result.accepted && result.entity === "movement").length;
      const upsertedCoRecords = await batchUpsertCoRecords(client, coRecords);
      const upsertedColoradoRollStates = await batchUpsertColoradoRollStates(client, coloradoRollStates);
      const upsertedColoradoRollEvents = await batchUpsertColoradoRollEvents(client, coloradoRollEvents);

      await client.query("commit");
      return resp(200, {
        ok: true,
        upserted: {
          items: acceptedItemActions,
          movements: acceptedMovementActions,
          coRecords: upsertedCoRecords,
          coloradoRollStates: upsertedColoradoRollStates,
          coloradoRollEvents: upsertedColoradoRollEvents,
        },
        stockActions: stockActionSummary,
        rejectedLegacyStockPush: {
          items: rejectedLegacyItems,
          movements: rejectedLegacyMovements,
        },
      });
    }

    // ---------- DELETE = hard delete ----------
    if (event.httpMethod === "DELETE") {
      const query = event.queryStringParameters || {};
      const kind = String(query.kind || "").trim();
      const key = String(query.key || "").trim();

      if (!kind || !key) {
        return resp(400, { ok: false, error: "Missing delete kind/key" });
      }

      await client.query("begin");

      if (kind === "movement") {
        const updatedAt = new Date().toISOString();
        const context = getSyncContext(event, { source: "delete_endpoint" });
        const deleteResult = await applyStockAction(client, {
          action: "delete",
          actionId: `delete:movement:${key}:${updatedAt}`,
          clientId: context.clientId,
          entity: "movement",
          key,
          operator: context.operator,
          payload: { id: key, deletedAt: updatedAt, updatedAt },
          source: "delete_endpoint:movement",
          updatedAt,
        }, context);
        if (!deleteResult.accepted) {
          console.warn("[stock-sync] movement delete ignored", deleteResult);
        }
      } else if (kind === "coRecord") {
        const existing = await client.query(`select data, updated_at from public.pg_co_records where id = $1`, [key]);
        if (!existing.rowCount) {
          await client.query("rollback");
          return resp(404, { ok: false, error: "Record not found" });
        }
        const row = existing.rows[0] || {};
        const current = row.data || {};
        const deletedAt = new Date().toISOString();
        const tombstone = {
          ...current,
          deletedAt,
          updatedAt: deletedAt,
        };
        await client.query(
          `insert into public.pg_co_records(id, machine_id, timestamp, data, updated_at)
           values ($1, $2, $3, $4::jsonb, $5::timestamptz)
           on conflict (id) do update
           set data = excluded.data, updated_at = excluded.updated_at`,
          [
            key,
            current.machineId || "",
            current.timestamp || deletedAt,
            JSON.stringify(tombstone),
            deletedAt,
          ]
        );
      } else if (kind === "item") {
        const updatedAt = new Date().toISOString();
        const context = getSyncContext(event, { source: "delete_endpoint" });
        const deleteResult = await applyStockAction(client, {
          action: "delete",
          actionId: `delete:item:${key}:${updatedAt}`,
          clientId: context.clientId,
          entity: "item",
          key: normalizeArticleNumber(key),
          operator: context.operator,
          payload: { articleNumber: normalizeArticleNumber(key), deletedAt: updatedAt, updatedAt },
          source: "delete_endpoint:item",
          updatedAt,
        }, context);
        if (!deleteResult.accepted) {
          console.warn("[stock-sync] item delete ignored", deleteResult);
        }
      } else {
        await client.query("rollback");
        return resp(400, { ok: false, error: `Unsupported delete kind: ${kind}` });
      }

      await client.query("commit");
      return resp(200, { ok: true, deleted: { kind, key } });
    }

    return resp(405, { ok: false, error: "Method not allowed" });
  } catch (e) {
    try { await client.query("rollback"); } catch {}
    console.error("[sync] request failed", {
      method: event.httpMethod,
      error: String(e?.message || e),
      stack: e?.stack || null,
    });
    if (e && (e.statusCode === 401 || e.statusCode === 429)) {
      return resp(e.statusCode, { ok: false, error: e.message });
    }
    return resp(500, { ok: false, error: String(e?.message || e) });
  } finally {
    try { await client.end(); } catch {}
  }
}
