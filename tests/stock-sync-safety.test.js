'use strict';

const assert = require('assert');

async function run() {
  const { compareStockDelete, compareStockUpsert, normalizeStockAction } =
    await import('../netlify/functions/_lib/stock-sync-safety.mjs');

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T08:00:00.000Z',
      tombstoneDeletedAt: '2026-06-09T09:00:00.000Z',
    }).accepted,
    false,
    'deleted item must not reappear from older local cache',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T08:00:00.000Z',
      existingUpdatedAt: '2026-06-09T09:00:00.000Z',
    }).accepted,
    false,
    'DB edit must not be overwritten by older local cache',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T10:00:00.000Z',
    }).accepted,
    true,
    'new item can be created intentionally',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T10:00:00.000Z',
      existingUpdatedAt: '2026-06-09T09:00:00.000Z',
    }).accepted,
    true,
    'newer UI edit can update existing item',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T10:00:00.000Z',
      existingUpdatedAt: '2026-06-09T09:30:00.000Z',
    }).accepted,
    true,
    'offline queued update is accepted when newer than DB',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T09:00:00.000Z',
      existingUpdatedAt: '2026-06-09T09:30:00.000Z',
    }).accepted,
    false,
    'stale queued update is rejected',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T09:00:00.000Z',
      existingDeletedAt: '2026-06-09T09:00:00.000Z',
    }).accepted,
    false,
    'soft-deleted item is not recreated by equal timestamp upsert',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T10:00:00.000Z',
      existingDeletedAt: '2026-06-09T09:00:00.000Z',
    }).accepted,
    false,
    'soft-deleted item is not recreated even by newer upsert',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T11:00:00.000Z',
      existingUpdatedAt: '2026-06-09T10:00:00.000Z',
    }).accepted,
    true,
    'newer client wins over older client',
  );

  assert.strictEqual(
    compareStockUpsert({
      incomingUpdatedAt: '2026-06-09T10:00:00.000Z',
      existingUpdatedAt: '2026-06-09T11:00:00.000Z',
    }).accepted,
    false,
    'older client cannot overwrite newer client',
  );

  assert.strictEqual(
    compareStockDelete({
      incomingUpdatedAt: '2026-06-09T10:00:00.000Z',
      existingUpdatedAt: '2026-06-09T09:00:00.000Z',
    }).accepted,
    true,
    'newer explicit delete is accepted',
  );

  assert.strictEqual(
    compareStockDelete({
      incomingUpdatedAt: '2026-06-09T08:00:00.000Z',
      tombstoneDeletedAt: '2026-06-09T09:00:00.000Z',
    }).accepted,
    false,
    'older delete replay is ignored once tombstoned',
  );

  const normalized = normalizeStockAction(
    {
      entity: 'item',
      action: 'upsert',
      payload: {
        articleNumber: ' abc 123 ',
        name: 'Material',
        updatedAt: '2026-06-09T10:00:00.000Z',
      },
      source: 'ui:item:create',
    },
    {
      clientId: 'ipad-1',
      operator: 'Alice',
    },
  );
  assert.strictEqual(normalized.ok, true);
  assert.strictEqual(normalized.action.key, 'ABC-123');
  assert.strictEqual(normalized.action.clientId, 'ipad-1');
  assert.strictEqual(normalized.action.operator, 'Alice');

  assert.strictEqual(
    normalizeStockAction({
      entity: 'item',
      action: 'upsert',
      payload: { articleNumber: 'ABC-123' },
    }).ok,
    false,
    'stock actions without updatedAt are not replayed',
  );
}

run()
  .then(() => {
    console.log('stock sync safety tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
