/* PrintGuard — cloud sync orchestration and dirty-state helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardSync(global) {
  const SYNC_ONLINE_RETRY_DELAY_MS = 15 * 1000;
  const SYNC_DIRTY_REASONS_KEY = 'pg_sync_dirty_reasons';
  const SYNC_DIRTY_VERSION_KEY = 'pg_sync_dirty_version';
  const STOCK_ACTION_QUEUE_KEY = 'pg_stock_action_queue_v1';
  const COLORADO_ROLL_STORAGE_KEY = 'pg_colorado_roll_state_v1';
  const COLORADO_ROLL_EVENTS_STORAGE_KEY = 'pg_colorado_roll_events_v1';

  function createSync(deps) {
    const {
      S, ST_CORECS, ST_ITEMS, ST_MOVES, ST_SETTINGS, StockStore, adminHeaders,
      applyRoleUI, cfg, el, idbClear, idbPut, loadAll, ls, renderColoradoRollTracker, sendStockNotifications,
      showToast, stockDbAdapter, updateOfflineBanner,
      idbAll,
    } = deps;

    function getLastCloudSyncMs() {
      const value = Number(ls('pg_last_cloud_sync_ms') || 0);
      return Number.isFinite(value) ? value : 0;
    }

    function markCloudSyncComplete() {
      ls('pg_last_cloud_sync_ms', String(Date.now()));
    }

    function getSyncDirtyReasons() {
      const raw = ls(SYNC_DIRTY_REASONS_KEY);
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(reason => ['stock', 'colorado', 'all'].includes(reason)) : [];
      } catch (_) {
        return [];
      }
    }

    function setSyncDirtyReason(reason) {
      if (!['stock', 'colorado', 'all'].includes(reason)) return;
      const reasons = new Set(getSyncDirtyReasons());
      reasons.add(reason);
      ls(SYNC_DIRTY_REASONS_KEY, JSON.stringify([...reasons]));
      ls(SYNC_DIRTY_VERSION_KEY, String(Date.now()));
    }

    function clearSyncDirtyReasons() {
      localStorage.removeItem(SYNC_DIRTY_REASONS_KEY);
      localStorage.removeItem(SYNC_DIRTY_VERSION_KEY);
    }

    function removeSyncDirtyReason(reason) {
      const next = getSyncDirtyReasons().filter(item => item !== reason);
      if (next.length) {
        ls(SYNC_DIRTY_REASONS_KEY, JSON.stringify(next));
        ls(SYNC_DIRTY_VERSION_KEY, String(Date.now()));
      } else {
        clearSyncDirtyReasons();
      }
    }

    function getSyncDirtyVersion() {
      return ls(SYNC_DIRTY_VERSION_KEY) || '';
    }

    function getStockSyncClientContext(source) {
      return {
        clientId: cfg.deviceId || '',
        operator: cfg.userName || '',
        source: source || 'browser_sync_queue',
      };
    }

    function readStockActionQueue() {
      try {
        const parsed = JSON.parse(localStorage.getItem(STOCK_ACTION_QUEUE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter(action => action && action.actionId) : [];
      } catch (_) {
        return [];
      }
    }

    function writeStockActionQueue(actions) {
      localStorage.setItem(STOCK_ACTION_QUEUE_KEY, JSON.stringify(Array.isArray(actions) ? actions : []));
    }

    function clearCompletedStockActions(results) {
      const completedIds = new Set((Array.isArray(results) ? results : [])
        .map(result => result && result.actionId)
        .filter(Boolean));
      if (!completedIds.size) return 0;
      const before = readStockActionQueue();
      const after = before.filter(action => !completedIds.has(action.actionId));
      writeStockActionQueue(after);
      return before.length - after.length;
    }

    function makeStockActionId(entity, action, key, updatedAt) {
      if (global.crypto && typeof global.crypto.randomUUID === 'function') {
        return global.crypto.randomUUID();
      }
      return `${entity}:${action}:${key}:${updatedAt}:${Math.random().toString(36).slice(2)}`;
    }

    function normalizeArticleNumber(value) {
      return String(value || '').trim().toUpperCase().replace(/\s+/g, '-');
    }

    function enqueueStockAction(input) {
      const entity = String(input?.entity || '').trim();
      const action = String(input?.action || '').trim();
      const payload = input?.payload && typeof input.payload === 'object' ? { ...input.payload } : {};
      const updatedAt = input?.updatedAt || payload.updatedAt || payload.timestamp || new Date().toISOString();
      const key = entity === 'item'
        ? normalizeArticleNumber(input?.key || payload.articleNumber)
        : String(input?.key || payload.id || '').trim();
      if (!['item', 'movement'].includes(entity) || !['upsert', 'delete'].includes(action) || !key) {
        console.warn('[stock-sync] dropped invalid stock action', input);
        return null;
      }
      if (entity === 'item') payload.articleNumber = key;
      if (entity === 'movement' && payload.articleNumber) payload.articleNumber = normalizeArticleNumber(payload.articleNumber);
      payload.updatedAt = payload.updatedAt || updatedAt;
      if (action === 'delete') payload.deletedAt = payload.deletedAt || updatedAt;

      const context = getStockSyncClientContext(input?.source || 'browser_stock_action');
      const stockAction = {
        action,
        actionId: input?.actionId || makeStockActionId(entity, action, key, updatedAt),
        clientId: context.clientId,
        entity,
        key,
        operator: context.operator,
        payload,
        queuedAt: new Date().toISOString(),
        source: input?.source || context.source,
        updatedAt,
      };
      const queue = readStockActionQueue();
      queue.push(stockAction);
      writeStockActionQueue(queue);
      setSyncDirtyReason('stock');
      console.log('[stock-sync] queued stock action', {
        entity,
        action,
        key,
        source: stockAction.source,
        clientId: stockAction.clientId || null,
        operator: stockAction.operator || null,
        updatedAt,
        queueLength: queue.length,
      });
      return stockAction;
    }

    async function resetLocalStockCache() {
      localStorage.removeItem(STOCK_ACTION_QUEUE_KEY);
      await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES)]);
      removeSyncDirtyReason('stock');
      await loadAll();
    }

    function getCoRecordUpdatedAtMs(record) {
      const value = record?.updatedAt || record?.updated_at || record?.deletedAt || record?.createdAt || record?.timestamp || '';
      const ms = Date.parse(value);
      return Number.isFinite(ms) ? ms : 0;
    }

    function getColoradoRollStatesForSync() {
      return Object.values(S.coloradoRolls || {}).filter(state => state && state.machineId);
    }

    function getColoradoRollEventsForSync() {
      return Object.values(S.coloradoRollEvents || {})
        .flatMap(events => Array.isArray(events) ? events : [])
        .filter(event => event && event.id && event.machineId);
    }

    function groupColoradoRollEvents(events) {
      return (Array.isArray(events) ? events : []).reduce((grouped, event) => {
        if (!event || !event.machineId) return grouped;
        if (!grouped[event.machineId]) grouped[event.machineId] = [];
        grouped[event.machineId].push(event);
        return grouped;
      }, {});
    }

    function mapColoradoRollStates(states) {
      return (Array.isArray(states) ? states : []).reduce((mapped, state) => {
        if (!state || !state.machineId) return mapped;
        mapped[state.machineId] = state;
        return mapped;
      }, {});
    }

    function persistColoradoRollCloudState(states, events) {
      S.coloradoRolls = mapColoradoRollStates(states);
      S.coloradoRollEvents = groupColoradoRollEvents(events);
      ls(COLORADO_ROLL_STORAGE_KEY, JSON.stringify(S.coloradoRolls));
      ls(COLORADO_ROLL_EVENTS_STORAGE_KEY, JSON.stringify(S.coloradoRollEvents));
    }

    function shouldRunBackgroundSync() {
      if (document.visibilityState !== 'visible') {
        console.log('background sync skipped: tab hidden');
        return false;
      }
      if (!getSyncDirtyReasons().length) {
        console.log('background sync skipped: no local changes');
        return false;
      }
      return navigator.onLine;
    }

    async function cloudPull() {
      const res = await fetch('/.netlify/functions/sync', { method: 'GET', cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud pull failed');
      return j;
    }

    async function cloudPush() {
      const lastSyncMs = getLastCloudSyncMs();
      const rawCoRecords = await idbAll(ST_CORECS);
      const coRecords = rawCoRecords.filter(record => {
        const updatedMs = getCoRecordUpdatedAtMs(record);
        return !lastSyncMs || updatedMs > lastSyncMs;
      });
      const stockActions = readStockActionQueue();
      const stockContext = getStockSyncClientContext('browser_sync_queue');
      const res = await fetch('/.netlify/functions/sync', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-printguard-client-id': stockContext.clientId,
          'x-printguard-operator': stockContext.operator,
          'x-printguard-sync-source': stockContext.source,
        },
        cache: 'no-store',
        body: JSON.stringify({
          clientId: stockContext.clientId,
          operator: stockContext.operator,
          source: stockContext.source,
          stockActions,
          items: [],
          movements: [],
          coRecords,
          coloradoRollStates: getColoradoRollStatesForSync(),
          coloradoRollEvents: getColoradoRollEventsForSync(),
          settings: [{
            key: 'config',
            weeksN: cfg.weeksN,
            rollingN: cfg.rollingN,
            inkCost: cfg.inkCost,
            mediaCost: cfg.mediaCost,
            costCurrency: cfg.costCurrency,
            savedAt: new Date().toISOString(),
          }],
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud push failed');
      const cleared = clearCompletedStockActions(j.stockActions?.results);
      if (stockActions.length || cleared) {
        console.log('[stock-sync] stock action push result', {
          queued: stockActions.length,
          cleared,
          accepted: j.stockActions?.accepted || 0,
          rejected: j.stockActions?.rejected || 0,
          rejectedLegacyStockPush: j.rejectedLegacyStockPush || null,
        });
      }
      return j;
    }

    async function cloudDelete(kind, key) {
      const params = new URLSearchParams({ kind: String(kind || ''), key: String(key || '') });
      const res = await fetch(`/.netlify/functions/sync?${params.toString()}`, {
        method: 'DELETE',
        headers: adminHeaders({
          'x-printguard-client-id': cfg.deviceId || '',
          'x-printguard-operator': cfg.userName || '',
          'x-printguard-sync-source': `browser_delete:${kind}`,
        }),
        cache: 'no-store',
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j.error || 'Cloud delete failed');
      return j;
    }

    async function runSync(options = {}) {
      const { silent = false } = options;
      const btn = el('sync-btn');
      const dirtyReasonsBeforeSync = getSyncDirtyReasons();
      const dirtyVersionBeforeSync = getSyncDirtyVersion();
      if (S.syncRunning) return false;
      if (!navigator.onLine) {
        if (!silent) showToast('Jsi offline — sync nejde.', 'error');
        return false;
      }
      S.syncRunning = true;
      btn?.classList.add('syncing');
      try {
        if (!silent) showToast('Sync…');
        await loadAll();
        const badLocalItem = (S.items || []).find(it => !it?.articleNumber);
        if (badLocalItem) {
          console.warn('[SYNC] Local item missing articleNumber:', badLocalItem);
          if (!silent) showToast('Lokální data: některé položky nemají articleNumber.', 'error');
          return false;
        }
        const badLocalMove = (S.movements || []).find(m => !m?.id);
        if (badLocalMove) {
          console.warn('[SYNC] Local movement missing id:', badLocalMove);
          if (!silent) showToast('Lokální data: některé pohyby nemají id.', 'error');
          return false;
        }
        const badLocalCo = (S.coRecords || []).find(r => !r?.id);
        if (badLocalCo) {
          console.warn('[SYNC] Local coRecord missing id:', badLocalCo);
          if (!silent) showToast('Lokální data: některé Colorado záznamy nemají id.', 'error');
          return false;
        }

        const pushRes = await cloudPush();
        const remote = await cloudPull();
        const rawItems = Array.isArray(remote?.items) ? remote.items : [];
        const rawMoves = Array.isArray(remote?.movements) ? remote.movements : [];
        const rawCo = Array.isArray(remote?.coRecords) ? remote.coRecords : [];
        const rawSettings = Array.isArray(remote?.settings) ? remote.settings : [];
        const rawRollStates = Array.isArray(remote?.coloradoRollStates) ? remote.coloradoRollStates : [];
        const rawRollEvents = Array.isArray(remote?.coloradoRollEvents) ? remote.coloradoRollEvents : [];
        const goodItems = [];
        const badItems = [];
        for (const it of rawItems) {
          const articleNumber = it?.articleNumber ?? it?.ArticleNumber ?? it?.article ?? it?.code ?? null;
          if (!articleNumber || String(articleNumber).trim() === '') {
            badItems.push(it);
            continue;
          }
          goodItems.push({ ...it, articleNumber: String(articleNumber).trim().toUpperCase().replace(/\s+/g, '-') });
        }
        const goodMoves = [];
        const badMoves = [];
        for (const m of rawMoves) {
          const id = m?.id ?? null;
          const articleNumber = m?.articleNumber ?? m?.ArticleNumber ?? null;
          if (!id || String(id).trim() === '' || !articleNumber || String(articleNumber).trim() === '') {
            badMoves.push(m);
            continue;
          }
          goodMoves.push({ ...m, id: String(id).trim(), articleNumber: String(articleNumber).trim().toUpperCase().replace(/\s+/g, '-') });
        }
        const goodCo = [];
        const badCo = [];
        for (const r of rawCo) {
          const id = r?.id ?? null;
          const machineId = r?.machineId ?? null;
          if (!id || String(id).trim() === '' || !machineId || String(machineId).trim() === '') {
            badCo.push(r);
            continue;
          }
          goodCo.push({ ...r, id: String(id).trim(), machineId: String(machineId).trim() });
        }
        if (badItems.length || badMoves.length || badCo.length) {
          console.warn('[SYNC] Dropping invalid remote records:', { badItems, badMoves, badCo });
        }
        await Promise.all([idbClear(ST_ITEMS), idbClear(ST_MOVES), idbClear(ST_CORECS), idbClear(ST_SETTINGS)]);
        for (const it of goodItems) await StockStore.putItem(stockDbAdapter(), it);
        for (const m of goodMoves) await StockStore.putMovement(stockDbAdapter(), m);
        for (const r of goodCo) await idbPut(ST_CORECS, r);
        for (const s of rawSettings) {
          if (s?.key) await idbPut(ST_SETTINGS, s);
        }
        persistColoradoRollCloudState(rawRollStates, rawRollEvents);
        await loadAll();
        if (typeof renderColoradoRollTracker === 'function') renderColoradoRollTracker();
        if (dirtyReasonsBeforeSync.includes('stock') || dirtyReasonsBeforeSync.includes('all')) {
          await sendStockNotifications({ silent: true, trigger: 'sync' });
        } else {
          console.log('stock alerts skipped: no stock dirty reason');
        }
        const dropped = badItems.length + badMoves.length + badCo.length;
        if (!silent) {
          showToast(
            `Sync OK · items:${pushRes?.upserted?.items ?? 0} · moves:${pushRes?.upserted?.movements ?? 0} · co:${pushRes?.upserted?.coRecords ?? 0}` +
            ` · rolls:${pushRes?.upserted?.coloradoRollEvents ?? 0}` +
            (dropped ? ` · zahoz.:${dropped}` : ''),
            dropped ? 'warn' : 'success'
          );
        }
        markCloudSyncComplete();
        if (getSyncDirtyVersion() === dirtyVersionBeforeSync) clearSyncDirtyReasons();
        return true;
      } catch (e) {
        console.error('[SYNC] Error:', e);
        if (!silent) showToast('Sync chyba: ' + (e?.message || e), 'error');
        return false;
      } finally {
        S.syncRunning = false;
        applyRoleUI();
        setTimeout(() => btn?.classList.remove('syncing'), 500);
      }
    }

    function setupBackgroundSync() {
      global.addEventListener('online', () => {
        updateOfflineBanner();
        global.setTimeout(() => {
          if (shouldRunBackgroundSync()) runSync({ silent: true });
        }, SYNC_ONLINE_RETRY_DELAY_MS);
      });
      document.addEventListener('visibilitychange', () => {
        if (shouldRunBackgroundSync()) runSync({ silent: true });
      });
      if (S.syncIntervalId) clearInterval(S.syncIntervalId);
      S.syncIntervalId = null;
    }

    return {
      cloudDelete,
      cloudPull,
      cloudPush,
      enqueueStockAction,
      getLastCloudSyncMs,
      getSyncDirtyReasons,
      readStockActionQueue,
      resetLocalStockCache,
      runSync,
      setSyncDirtyReason,
      setupBackgroundSync,
    };
  }

  global.PrintGuardSync = { createSync };
})(window);
