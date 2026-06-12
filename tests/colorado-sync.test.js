'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeLocalStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function loadSyncFactory(localStorage, fetchImpl) {
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'app', 'sync.js'),
    'utf8',
  );
  const context = {
    console,
    document: { visibilityState: 'visible' },
    fetch: fetchImpl,
    localStorage,
    navigator: { onLine: true },
    setInterval() {
      return 1;
    },
    clearInterval() {},
    setTimeout,
    URLSearchParams,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'app/sync.js' });
  return context.PrintGuardSync.createSync;
}

async function testDirtyColoradoPushIncludesStaleLocalRecords() {
  const staleLocalRecord = {
    id: 'co-local-missing-in-db',
    machineId: 'colorado1',
    timestamp: '2026-06-10T08:00:00.000Z',
    inkTotalLiters: 10,
    mediaTotalM2: 1200,
    mediaLengthM: 800,
    createdAt: '2026-06-10T08:00:00.000Z',
  };
  const localStorage = makeLocalStorage({
    pg_last_cloud_sync_ms: String(Date.parse('2026-06-11T08:00:00.000Z')),
    pg_sync_dirty_reasons: JSON.stringify(['colorado']),
  });
  let pushedPayload = null;
  const createSync = loadSyncFactory(localStorage, async (_url, options) => {
    pushedPayload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      async text() {
        return JSON.stringify({
          ok: true,
          upserted: {
            items: 0,
            movements: 0,
            coRecords: pushedPayload.coRecords.length,
            coloradoRollStates: 0,
            coloradoRollEvents: 0,
          },
          stockActions: { results: [] },
        });
      },
    };
  });

  const sync = createSync({
    S: { coloradoRolls: {}, coloradoRollEvents: {} },
    ST_CORECS: 'co_records',
    ST_ITEMS: 'items',
    ST_MOVES: 'movements',
    ST_SETTINGS: 'settings',
    StockStore: {},
    adminHeaders: () => ({}),
    applyRoleUI() {},
    cfg: {
      costCurrency: 'CZK',
      deviceId: 'mobile-1',
      inkCost: 0,
      mediaCost: 0,
      rollingN: 6,
      userName: 'Operator',
      weeksN: 8,
    },
    el: () => null,
    idbAll: async (store) =>
      store === 'co_records' ? [staleLocalRecord] : [],
    idbClear: async () => {},
    idbPut: async () => {},
    loadAll: async () => {},
    ls(key, value) {
      if (value !== undefined) {
        localStorage.setItem(key, value);
        return value;
      }
      return localStorage.getItem(key) || '';
    },
    renderColoradoRollTracker() {},
    sendStockNotifications: async () => {},
    showToast() {},
    stockDbAdapter: () => ({}),
    updateOfflineBanner() {},
  });

  const response = await sync.cloudPush();
  assert.strictEqual(response.ok, true);
  assert.strictEqual(pushedPayload.coRecords.length, 1);
  assert.strictEqual(pushedPayload.coRecords[0].id, staleLocalRecord.id);
  assert.strictEqual(pushedPayload.coRecords[0].mediaLengthM, 800);
}

async function testSyncApiPersistsReadsAndRejectsStaleColoradoCache() {
  const pg = require('pg');
  const originalClient = pg.Client;
  const db = new Map();

  class FakeClient {
    async connect() {}
    async end() {}
    async query(sql, params = []) {
      const text = String(sql || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (
        ['begin', 'commit', 'rollback'].includes(text) ||
        text.startsWith('create table') ||
        text.startsWith('create index')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith('insert into public.pg_co_records')) {
        const maxPlaceholder = Math.max(
          ...Array.from(String(sql).matchAll(/\$(\d+)/g), (match) =>
            Number(match[1]),
          ),
        );
        assert.strictEqual(
          maxPlaceholder,
          params.length,
          'pg_co_records batch upsert SQL placeholder count must match bind parameters',
        );
        for (let index = 0; index < params.length; index += 5) {
          const id = params[index];
          const machineId = params[index + 1];
          const timestamp = params[index + 2];
          const data = JSON.parse(params[index + 3]);
          const updatedAt = params[index + 4];
          const incomingMs = Date.parse(data.updatedAt || updatedAt);
          const existing = db.get(id);
          const existingMs = existing
            ? Date.parse(existing.data.updatedAt || existing.updated_at)
            : Number.NEGATIVE_INFINITY;
          if (!existing || incomingMs >= existingMs) {
            db.set(id, {
              data,
              machine_id: machineId,
              timestamp,
              updated_at: updatedAt,
            });
          }
        }
        return { rows: [], rowCount: params.length / 5 };
      }
      if (text.includes('from public.pg_co_records')) {
        return {
          rows: Array.from(db.values()).sort((left, right) =>
            String(left.timestamp || '').localeCompare(
              String(right.timestamp || ''),
            ),
          ),
          rowCount: db.size,
        };
      }
      if (
        text.includes('from public.pg_items') ||
        text.includes('from public.pg_movements') ||
        text.includes('from public.pg_colorado_roll_states') ||
        text.includes('from public.pg_colorado_roll_events')
      ) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }
  }

  pg.Client = FakeClient;
  process.env.NEON_DATABASE_URL = 'postgres://fake';
  delete require.cache[require.resolve('../netlify/functions/sync')];
  const { handler } = require('../netlify/functions/sync');

  async function request(method, body = undefined) {
    const response = await handler({
      httpMethod: method,
      headers: { 'x-forwarded-for': `test-${Math.random()}` },
      body: body == null ? '' : JSON.stringify(body),
    });
    return {
      statusCode: response.statusCode,
      body: JSON.parse(response.body || '{}'),
    };
  }

  try {
    const firstRecord = {
      id: 'co-sync-api-record',
      machineId: 'colorado1',
      timestamp: '2026-06-12T08:00:00.000Z',
      inkTotalLiters: 50,
      mediaTotalM2: 1200,
      mediaLengthM: 800,
      updatedAt: '2026-06-12T08:01:00.000Z',
    };
    const secondInitialRecord = {
      id: 'co-sync-api-record-2',
      machineId: 'colorado2',
      timestamp: '2026-06-12T08:05:00.000Z',
      inkTotalLiters: 60,
      mediaTotalM2: 2200,
      mediaLengthM: 1400,
      updatedAt: '2026-06-12T08:06:00.000Z',
    };
    const firstSave = await request('POST', {
      items: [],
      movements: [],
      coRecords: [firstRecord, secondInitialRecord],
    });
    assert.strictEqual(firstSave.statusCode, 200);
    assert.strictEqual(firstSave.body.ok, true);
    assert.strictEqual(firstSave.body.upserted.coRecords, 2);
    assert.strictEqual(db.get(firstRecord.id).data.mediaTotalM2, 1200);
    assert.strictEqual(
      db.get(secondInitialRecord.id).data.mediaLengthM,
      1400,
    );

    const firstRead = await request('GET');
    assert.strictEqual(firstRead.statusCode, 200);
    assert.strictEqual(firstRead.body.coRecords.length, 2);
    const firstReadRecord = firstRead.body.coRecords.find(
      (record) => record.id === firstRecord.id,
    );
    assert.ok(firstReadRecord);
    assert.strictEqual(firstReadRecord.mediaTotalM2, 1200);
    assert.strictEqual(firstReadRecord.mediaLengthM, 800);

    const updatedRecord = {
      ...firstRecord,
      mediaTotalM2: 1300,
      mediaLengthM: 870,
      updatedAt: '2026-06-12T09:00:00.000Z',
    };
    const secondSave = await request('POST', {
      items: [],
      movements: [],
      coRecords: [updatedRecord],
    });
    assert.strictEqual(secondSave.statusCode, 200);
    assert.strictEqual(db.get(firstRecord.id).data.mediaTotalM2, 1300);
    assert.strictEqual(db.get(firstRecord.id).data.mediaLengthM, 870);

    const staleLocalCache = {
      ...firstRecord,
      mediaTotalM2: 900,
      mediaLengthM: 600,
      updatedAt: '2026-06-12T08:30:00.000Z',
    };
    const staleSave = await request('POST', {
      items: [],
      movements: [],
      coRecords: [staleLocalCache],
    });
    assert.strictEqual(staleSave.statusCode, 200);
    assert.strictEqual(
      db.get(firstRecord.id).data.mediaTotalM2,
      1300,
      'older local cache must not overwrite newer DB counter',
    );
    assert.strictEqual(db.get(firstRecord.id).data.mediaLengthM, 870);

    const secondClientRead = await request('GET');
    assert.strictEqual(secondClientRead.body.coRecords.length, 2);
    const secondClientRecord = secondClientRead.body.coRecords.find(
      (record) => record.id === firstRecord.id,
    );
    assert.ok(secondClientRecord);
    assert.strictEqual(secondClientRecord.mediaTotalM2, 1300);
    assert.strictEqual(secondClientRecord.mediaLengthM, 870);
  } finally {
    pg.Client = originalClient;
    delete require.cache[require.resolve('../netlify/functions/sync')];
  }
}

async function run() {
  await testDirtyColoradoPushIncludesStaleLocalRecords();
  await testSyncApiPersistsReadsAndRejectsStaleColoradoCache();
}

run()
  .then(() => {
    console.log('colorado sync tests passed');
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
