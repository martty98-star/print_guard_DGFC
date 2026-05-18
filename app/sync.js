/* PrintGuard — cloud sync orchestration and dirty-state helpers (loaded before app.js) */
'use strict';

(function attachPrintGuardSync(global) {
  const SYNC_ONLINE_RETRY_DELAY_MS = 15 * 1000;
  const SYNC_DIRTY_REASONS_KEY = 'pg_sync_dirty_reasons';
  const SYNC_DIRTY_VERSION_KEY = 'pg_sync_dirty_version';

  function createSync(deps) {
    const {
      S, ST_CORECS, ST_ITEMS, ST_MOVES, ST_SETTINGS, StockStore, adminHeaders,
      applyRoleUI, cfg, el, idbClear, idbPut, loadAll, ls, sendStockNotifications,
      showToast, stockDbAdapter, updateOfflineBanner,
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

    function getSyncDirtyVersion() {
      return ls(SYNC_DIRTY_VERSION_KEY) || '';
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
      const res = await fetch('/.netlify/functions/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({
          items: S.items,
          movements: S.movements,
          coRecords: S.coRecords,
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
      return j;
    }

    async function cloudDelete(kind, key) {
      const params = new URLSearchParams({ kind: String(kind || ''), key: String(key || '') });
      const res = await fetch(`/.netlify/functions/sync?${params.toString()}`, {
        method: 'DELETE',
        headers: adminHeaders(),
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
        await loadAll();
        if (dirtyReasonsBeforeSync.includes('stock') || dirtyReasonsBeforeSync.includes('all')) {
          await sendStockNotifications({ silent: true, trigger: 'sync' });
        } else {
          console.log('stock alerts skipped: no stock dirty reason');
        }
        const dropped = badItems.length + badMoves.length + badCo.length;
        if (!silent) {
          showToast(
            `Sync OK · items:${pushRes?.upserted?.items ?? 0} · moves:${pushRes?.upserted?.movements ?? 0} · co:${pushRes?.upserted?.coRecords ?? 0}` +
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

    return { cloudDelete, cloudPull, cloudPush, getLastCloudSyncMs, getSyncDirtyReasons, runSync, setSyncDirtyReason, setupBackgroundSync };
  }

  global.PrintGuardSync = { createSync };
})(window);
