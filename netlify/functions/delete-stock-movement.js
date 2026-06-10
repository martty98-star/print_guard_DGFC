'use strict';

const {
  json,
  parseRequestBody,
  requireAdminPin,
  withClient,
} = require('./_lib/db');

async function ensureStockDeleteSchema(client) {
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
  await client.query(
    `alter table public.pg_movements add column if not exists deleted_at timestamptz null`,
  );
  await client.query(
    `alter table public.pg_movements add column if not exists sync_source text null`,
  );
  await client.query(
    `alter table public.pg_movements add column if not exists sync_client_id text null`,
  );
  await client.query(
    `alter table public.pg_movements add column if not exists sync_operator text null`,
  );
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
}

exports.handler = async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return json(204, {});
  }

  try {
    if (event.httpMethod !== 'DELETE') {
      return json(
        405,
        { ok: false, error: 'Method not allowed' },
        { allow: 'DELETE,OPTIONS' },
      );
    }

    requireAdminPin(event);

    const requestBody = parseRequestBody(event);
    const id = String(
      requestBody.id || event.queryStringParameters?.id || '',
    ).trim();
    const clientId = String(
      requestBody.clientId || event.headers?.['x-printguard-client-id'] || '',
    ).trim();
    const operator = String(
      requestBody.operator || event.headers?.['x-printguard-operator'] || '',
    ).trim();

    if (!id) {
      return json(400, { ok: false, error: 'Missing movement id' });
    }

    const body = await withClient(async (client) => {
      await ensureStockDeleteSchema(client);
      const deletedAt = new Date().toISOString();
      const existing = await client.query(
        'select data, updated_at, deleted_at from public.pg_movements where id = $1',
        [id],
      );
      const beforePayload = existing.rows[0]?.data || null;
      await client.query(
        `
          insert into public.pg_stock_tombstones(entity, key, deleted_at, source, client_id, operator, payload)
          values ('movement', $1, $2::timestamptz, 'delete_stock_movement_function', $3, $4, $5::jsonb)
          on conflict (entity, key) do update
          set deleted_at = greatest(public.pg_stock_tombstones.deleted_at, excluded.deleted_at),
              source = excluded.source,
              client_id = excluded.client_id,
              operator = excluded.operator,
              payload = coalesce(excluded.payload, public.pg_stock_tombstones.payload)
        `,
        [
          id,
          deletedAt,
          clientId || null,
          operator || null,
          JSON.stringify(beforePayload || { id }),
        ],
      );
      const result = await client.query(
        `
          update public.pg_movements
          set deleted_at = $2::timestamptz,
              updated_at = greatest(updated_at, $2::timestamptz),
              sync_source = 'delete_stock_movement_function',
              sync_client_id = $3,
              sync_operator = $4
          where id = $1
            and deleted_at is null
        `,
        [id, deletedAt, clientId || null, operator || null],
      );
      await client.query(
        `
          insert into public.pg_stock_write_audit (
            entity, stock_item_id, movement_id, action, source, client_id, operator,
            request_id, incoming_updated_at, accepted, reason, before_payload, after_payload
          )
          values (
            'movement', null, $1, 'delete', 'delete_stock_movement_function', $2, $3,
            null, $4::timestamptz, true, 'soft_deleted_with_tombstone', $5::jsonb, $6::jsonb
          )
        `,
        [
          id,
          clientId || null,
          operator || null,
          deletedAt,
          JSON.stringify(beforePayload),
          JSON.stringify({ id, deletedAt, updatedAt: deletedAt }),
        ],
      );

      return {
        ok: true,
        deleted: result.rowCount > 0,
      };
    });

    return json(200, body);
  } catch (error) {
    if (error && (error.statusCode === 401 || error.statusCode === 429)) {
      return json(error.statusCode, {
        ok: false,
        error: error.message || 'Unauthorized',
      });
    }
    console.error('delete-stock-movement failed', error);
    return json(500, {
      ok: false,
      error:
        error && error.message ? error.message : 'delete-stock-movement failed',
    });
  }
};
