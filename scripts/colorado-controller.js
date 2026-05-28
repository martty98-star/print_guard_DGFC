(function attachPrintGuardColoradoController(global) {
  'use strict';

  const MACHINES = [
    { id: 'colorado1', label: 'Colorado 1' },
    { id: 'colorado2', label: 'Colorado 2' },
  ];

  const CO_FORMATS = [
    { key: '21x30', widthCm: 21, heightCm: 30 },
    { key: '30x40', widthCm: 30, heightCm: 40 },
    { key: '40x50', widthCm: 40, heightCm: 50 },
    { key: '50x50', widthCm: 50, heightCm: 50 },
    { key: '50x70', widthCm: 50, heightCm: 70 },
    { key: '70x100', widthCm: 70, heightCm: 100 },
  ];

  const COLORADO_ROLL_STORAGE_KEY = 'pg_colorado_roll_state_v1';
  const COLORADO_ROLL_EVENTS_STORAGE_KEY = 'pg_colorado_roll_events_v1';
  const COLORADO_ROLL_LENGTH_M = 130;
  const COLORADO_ROLL_STALE_MINUTES = 90;
  const COLORADO_ROLL_ACCOUNTING_REFRESH_MS = 60 * 1000;

  function normalizePositiveNumber(value, fallback = null) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function createColoradoController(deps) {
    const {
      S,
      ST_CORECS,
      Reports,
      cfg,
      ls,
      el,
      elSet,
      esc,
      fmtDT,
      fmtFileDT,
      fmtN,
      genId,
      getNullableNumber,
      dlBlob,
      idbPut,
      i18n,
      navigate,
      runNotificationDispatch,
      setSyncDirtyReason,
      showConfirm,
      showToast,
      toISOfromDT,
      toLocalDT,
      dateRangeFilter,
      isAdmin,
      adminErrorMessage,
      getCostUnitPerM2,
      getCostUnitPerMonth,
      exportCSVCombinedLifetimeCo,
      runSync,
    } = deps || {};
    let historyControlsBound = false;
    const exportUtils = (typeof window !== 'undefined' && window.PrintGuardExportUtils) || {};
    const downloadCsvBlob = dlBlob || exportUtils.dlBlob;
    const getExportFileStamp = fmtFileDT || exportUtils.fmtFileDT;

    if (!S || !Reports || !cfg || !ls || !el || !elSet || !esc || !fmtDT || !fmtN || !genId || !idbPut || !i18n || !navigate || !setSyncDirtyReason || !showConfirm || !showToast || !toISOfromDT || !toLocalDT || !dateRangeFilter) {
      throw new Error('Missing Colorado controller dependencies');
    }

    function getMachineLabel(machineId) {
      return MACHINES.find(machine => machine.id === machineId)?.label || machineId || 'Colorado';
    }

    function getConfiguredRollWidthMm(currentState = null) {
      const currentWidth = currentState && Number(currentState.mediaWidthMm);
      if (Number.isFinite(currentWidth) && currentWidth > 0) return currentWidth;
      const candidates = [cfg.coloradoRollWidthMm, cfg.coloradoMediaWidthMm, cfg.mediaWidthMm];
      for (const candidate of candidates) {
        const width = Number(candidate);
        if (Number.isFinite(width) && width > 0) return width;
      }
      return null;
    }

    function normalizeRollState(machineId, input, includeHistory = true) {
      const source = input && typeof input === 'object' ? input : {};
      const rollLengthM = Number(source.rollLengthM);
      const mediaWidthMm = Number(source.mediaWidthMm);
      const baselineMediaTotalM2 = Number(source.baselineMediaTotalM2);
      const previousState = includeHistory && source.previousState && typeof source.previousState === 'object'
        ? normalizeRollState(machineId, source.previousState, false)
        : null;

      return {
        machineId,
        machineName: String(source.machineName || getMachineLabel(machineId)).trim() || getMachineLabel(machineId),
        activeRollId: String(source.activeRollId || '').trim() || null,
        rollLengthM: Number.isFinite(rollLengthM) && rollLengthM > 0 ? rollLengthM : COLORADO_ROLL_LENGTH_M,
        mediaWidthMm: Number.isFinite(mediaWidthMm) && mediaWidthMm > 0 ? mediaWidthMm : null,
        baselineMediaTotalM2: Number.isFinite(baselineMediaTotalM2) ? baselineMediaTotalM2 : null,
        baselineRecordedAt: String(source.baselineRecordedAt || '').trim() || null,
        loadedAt: String(source.loadedAt || '').trim() || null,
        loadedBy: String(source.loadedBy || '').trim() || '',
        note: String(source.note || '').trim() || '',
        updatedAt: String(source.updatedAt || source.updated_at || source.loadedAt || '').trim() || null,
        lastLoadEventId: includeHistory ? (String(source.lastLoadEventId || '').trim() || null) : null,
        previousState,
      };
    }

    function loadColoradoRollStates() {
      try {
        const raw = ls(COLORADO_ROLL_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        const state = {};
        MACHINES.forEach(({ id }) => {
          state[id] = normalizeRollState(id, parsed && parsed[id]);
        });
        return state;
      } catch (error) {
        console.warn('Colorado roll state load failed', error);
        return {};
      }
    }

    function loadColoradoRollEvents() {
      try {
        const raw = ls(COLORADO_ROLL_EVENTS_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        const events = {};
        MACHINES.forEach(({ id }) => {
          events[id] = Array.isArray(parsed && parsed[id]) ? parsed[id] : [];
        });
        return events;
      } catch (error) {
        console.warn('Colorado roll event load failed', error);
        return {};
      }
    }

    function saveColoradoRollStates() {
      try {
        ls(COLORADO_ROLL_STORAGE_KEY, JSON.stringify(S.coloradoRolls || {}));
      } catch (error) {
        console.warn('Colorado roll state save failed', error);
      }
    }

    function saveColoradoRollEvents() {
      try {
        ls(COLORADO_ROLL_EVENTS_STORAGE_KEY, JSON.stringify(S.coloradoRollEvents || {}));
      } catch (error) {
        console.warn('Colorado roll event save failed', error);
      }
    }

    function getColoradoRollState(machineId) {
      if (!machineId) return null;
      const stored = normalizeRollState(machineId, S.coloradoRolls && S.coloradoRolls[machineId]);
      if (stored && stored.loadedAt) return stored;

      const fallback = getLatestColoradoRollLoadedState(machineId);
      if (!fallback) return stored;
      return normalizeRollState(machineId, {
        ...(stored || {}),
        ...fallback,
      });
    }

    function getColoradoAccountingPrinterName(machineId) {
      if (machineId === 'colorado1') return 'Colorado-91';
      if (machineId === 'colorado2') return 'Colorado-92';
      return '';
    }

    function getColoradoRollAccountingState(machineId) {
      if (!S.coloradoRollAccountingStatus) S.coloradoRollAccountingStatus = {};
      return S.coloradoRollAccountingStatus[machineId] || null;
    }

    function setColoradoRollAccountingState(machineId, nextState) {
      if (!S.coloradoRollAccountingStatus) S.coloradoRollAccountingStatus = {};
      S.coloradoRollAccountingStatus[machineId] = {
        ...(S.coloradoRollAccountingStatus[machineId] || {}),
        ...(nextState || {}),
      };
      return S.coloradoRollAccountingStatus[machineId];
    }

    function getColoradoRollEvents(machineId) {
      if (!machineId) return [];
      return Array.isArray(S.coloradoRollEvents && S.coloradoRollEvents[machineId]) ? S.coloradoRollEvents[machineId] : [];
    }

    function getLatestColoradoRollLoadedState(machineId) {
      const event = getColoradoRollEvents(machineId)
        .filter(item => item && item.type === 'roll_loaded')
        .slice()
        .sort((a, b) => new Date(b.timestamp || b.updatedAt || 0) - new Date(a.timestamp || a.updatedAt || 0))[0];
      if (!event) return null;

      const after = event.after && typeof event.after === 'object' ? event.after : {};
      const mediaWidthMm = getConfiguredRollWidthMm(after);
      return {
        ...after,
        machineId,
        machineName: after.machineName || getMachineLabel(machineId),
        activeRollId: after.activeRollId || event.activeRollId || event.rollId || null,
        rollLengthM: after.rollLengthM || COLORADO_ROLL_LENGTH_M,
        mediaWidthMm,
        loadedAt: after.loadedAt || event.timestamp || event.updatedAt || null,
        loadedBy: after.loadedBy || event.loadedBy || '',
        updatedAt: after.updatedAt || event.updatedAt || event.timestamp || null,
        lastLoadEventId: after.lastLoadEventId || event.eventId || event.id || null,
      };
    }

    function appendColoradoRollEvent(machineId, type, payload) {
      if (!machineId) return null;
      const event = {
        id: genId('co_roll_evt'),
        machineId,
        type,
        timestamp: new Date().toISOString(),
        ...(payload && typeof payload === 'object' ? payload : {}),
      };
      event.updatedAt = event.updatedAt || event.timestamp;
      S.coloradoRollEvents = {
        ...(S.coloradoRollEvents || {}),
        [machineId]: [...getColoradoRollEvents(machineId), event],
      };
      saveColoradoRollEvents();
      return event;
    }

    function setColoradoRollState(machineId, input) {
      if (!machineId) return null;
      const normalized = normalizeRollState(machineId, input);
      S.coloradoRolls = {
        ...(S.coloradoRolls || {}),
        [machineId]: normalized,
      };
      saveColoradoRollStates();
      return normalized;
    }

    function hydrateColoradoRollBaselines() {
      let changed = false;
      MACHINES.forEach(({ id }) => {
        const state = getColoradoRollState(id);
        if (!state || !state.loadedAt || state.baselineMediaTotalM2 !== null) return;
        const latest = getLatestCoRecord(id);
        if (!latest) return;
        const loadedAtMs = new Date(state.loadedAt).getTime();
        const latestAtMs = new Date(latest.timestamp).getTime();
        if (!Number.isFinite(loadedAtMs) || !Number.isFinite(latestAtMs) || latestAtMs < loadedAtMs) return;
        S.coloradoRolls[id] = {
          ...state,
          baselineMediaTotalM2: Number(latest.mediaTotalM2),
          baselineRecordedAt: latest.timestamp,
        };
        changed = true;
      });
      if (changed) saveColoradoRollStates();
      return changed;
    }

    function getLatestCoRecord(machineId) {
      const recs = getCoRecs(machineId);
      return recs.length ? recs[recs.length - 1] : null;
    }

    function getColoradoRollUiClass(status) {
      switch (status) {
        case 'ok': return 'roll-ok';
        case 'warn': return 'roll-warn';
        case 'low': return 'roll-low';
        case 'critical': return 'roll-critical';
        case 'empty': return 'roll-empty';
        case 'stale': return 'roll-stale';
        case 'error': return 'roll-critical';
        case 'no_data': return 'roll-unknown';
        case 'loading': return 'roll-wait';
        case 'waiting': return 'roll-wait';
        default: return 'roll-unknown';
      }
    }

    function getColoradoRollStatusText(summary) {
      if (!summary) return 'WAIT';
      if (summary.status === 'loading') return 'WAIT';
      if (summary.status === 'error') return 'CHYBA';
      if (summary.status === 'no_data') return 'BEZ DAT';
      if (summary.status === 'stale') return 'STALE';
      if (summary.status === 'ok') return 'OK';
      if (summary.status === 'warn' || summary.status === 'low') return 'LOW';
      if (summary.status === 'critical' || summary.status === 'empty') return 'CRIT';
      return 'WAIT';
    }

    function getColoradoRollFreshnessText(summary) {
      if (!summary || !summary.freshnessLabel) return '';
      return summary.freshnessLabel;
    }

    function getColoradoRollAggregate(summaries) {
      const rank = { error: 8, stale: 7, empty: 6, critical: 5, low: 4, warn: 3, no_data: 2, loading: 1, waiting: 1, ok: 0 };
      const worst = [...(summaries || [])].sort((a, b) => (rank[b.status] || 0) - (rank[a.status] || 0))[0] || null;
      const hasWarning = Boolean((summaries || []).find(summary => summary && summary.status !== 'ok'));
      return {
        status: worst ? worst.status : 'waiting',
        uiClass: worst ? getColoradoRollUiClass(worst.status) : 'roll-unknown',
        hasWarning,
        title: worst
          ? `${worst.machineId || 'Colorado'} · ${getColoradoRollStatusText(worst)}`
          : 'Papír',
      };
    }

    function logColoradoRollStatusDiagnostics(stage, payload) {
      if (typeof console === 'undefined' || typeof console.debug !== 'function') return;
      if (typeof localStorage !== 'undefined' && localStorage.getItem('pg_debug_colorado_roll') !== '1') return;
      console.debug(`[Colorado roll status] ${stage}`, payload);
    }

    function shouldRefreshColoradoRollAccounting(machineId, rollState) {
      if (!rollState || !rollState.loadedAt) return false;
      const current = getColoradoRollAccountingState(machineId);
      if (current && current.loading) return false;
      if (!current || current.loadedAt !== rollState.loadedAt) return true;
      const fetchedAtMs = Date.parse(current.fetchedAt || '');
      return !Number.isFinite(fetchedAtMs) || Date.now() - fetchedAtMs > COLORADO_ROLL_ACCOUNTING_REFRESH_MS;
    }

    async function refreshColoradoRollAccountingStatus(machineId, rollState) {
      const printerName = getColoradoAccountingPrinterName(machineId);
      if (!machineId || !rollState || !rollState.loadedAt || !printerName) return null;
      setColoradoRollAccountingState(machineId, {
        loading: true,
        error: '',
        loadedAt: rollState.loadedAt,
      });

      const params = new URLSearchParams({
        printer: printerName,
        from_at: rollState.loadedAt,
        limit: '1',
      });

      try {
        const response = await fetch(`/.netlify/functions/print-log-summary?${params.toString()}`, { cache: 'no-store' });
        const payload = await response.json().catch(() => ({}));
        logColoradoRollStatusDiagnostics('raw api response', {
          machineId,
          printerName,
          loadedAt: rollState.loadedAt,
          ok: response.ok,
          payload,
        });
        if (!response.ok || !payload.ok) throw new Error(payload.error || 'Print log summary failed');

        const printerSummary = payload.summary && payload.summary.byPrinter
          ? payload.summary.byPrinter[printerName]
          : null;
        const nextState = setColoradoRollAccountingState(machineId, {
          loading: false,
          error: '',
          loadedAt: rollState.loadedAt,
          printerName,
          mediaLengthM: Number(printerSummary && printerSummary.mediaLengthM) || 0,
          latestReadyAt: printerSummary && printerSummary.latestReadyAt ? printerSummary.latestReadyAt : null,
          latestImportedAt: printerSummary && printerSummary.latestImportedAt ? printerSummary.latestImportedAt : null,
          generatedAt: payload.generatedAt || new Date().toISOString(),
          fetchedAt: new Date().toISOString(),
          raw: printerSummary || null,
        });
        renderColoradoRollTracker();
        return nextState;
      } catch (error) {
        const nextState = setColoradoRollAccountingState(machineId, {
          loading: false,
          error: error && error.message ? error.message : String(error || 'Unknown error'),
          loadedAt: rollState.loadedAt,
          printerName,
          fetchedAt: new Date().toISOString(),
        });
        logColoradoRollStatusDiagnostics('api error', { machineId, printerName, error: nextState.error });
        renderColoradoRollTracker();
        return nextState;
      }
    }

    function renderColoradoRollSheet(summaries, focusMachineId) {
      const wrap = el('roll-sheet-body');
      if (!wrap) return;

      wrap.innerHTML = (summaries || []).map(summary => {
        const rollClass = getColoradoRollUiClass(summary.status);
        const statusText = getColoradoRollStatusText(summary);
        const machineLabel = getMachineLabel(summary.machineId);
        const compactLabel = machineLabel.replace(/^Colorado\s+/i, 'C');
        const isFocused = focusMachineId && focusMachineId === summary.machineId;
        const canUndo = Boolean(summary.canUndo);
        const canReset = Boolean(isAdmin && isAdmin());
        const historyCount = getColoradoRollHistoryEvents(summary.machineId).length;
        return `<div class="roll-sheet-row ${esc(rollClass)}${isFocused ? ' is-focused' : ''}">
          <div class="roll-sheet-head">
            <span class="roll-sheet-machine">${esc(compactLabel)}</span>
            <span class="roll-sheet-status">${esc(statusText)}</span>
          </div>
          <div class="roll-sheet-meta-row">
            ${summary.loadedAt ? `<span class="roll-sheet-meta">Poslední výměna: ${esc(fmtDT(summary.loadedAt))}</span>` : '<span class="roll-sheet-meta">Zatím bez výměny</span>'}
            <span class="roll-sheet-meta">${esc(historyCount)} ${historyCount === 1 ? 'záznam' : 'záznamů'}</span>
          </div>
          <div class="roll-battery" aria-hidden="true" style="${Number.isFinite(summary.fillPercent) ? `--roll-fill:${summary.fillPercent}%` : '--roll-fill:0%'}">
            <span class="roll-battery-fill"></span>
          </div>
          <div class="roll-sheet-actions">
            <button class="btn-secondary btn-sm" type="button" data-roll-load="${esc(summary.machineId)}" aria-label="Nová role">+</button>
            <button class="btn-secondary btn-sm" type="button" data-roll-history-export="${esc(summary.machineId)}" ${historyCount ? '' : 'disabled'}>CSV</button>
            <button class="btn-secondary btn-sm" type="button" data-roll-undo="${esc(summary.machineId)}" ${canUndo ? '' : 'disabled'}>Zrušit poslední výměnu</button>
            ${canReset ? `<button class="btn-secondary btn-sm" type="button" data-roll-reset="${esc(summary.machineId)}">Resetovat stav role</button>` : ''}
          </div>
        </div>`;
      }).join('');

      wrap.querySelectorAll('[data-roll-load]').forEach(button => {
        button.addEventListener('click', () => {
          closeColoradoRollSheet();
          openColoradoRollModal(button.dataset.rollLoad);
        });
      });

      wrap.querySelectorAll('[data-roll-history-export]').forEach(button => {
        button.addEventListener('click', () => exportColoradoRollHistoryCsv(button.dataset.rollHistoryExport));
      });

      wrap.querySelectorAll('[data-roll-undo]').forEach(button => {
        button.addEventListener('click', () => undoColoradoRollLoad(button.dataset.rollUndo));
      });

      wrap.querySelectorAll('[data-roll-reset]').forEach(button => {
        button.addEventListener('click', () => promptColoradoRollReset(button.dataset.rollReset));
      });
    }

    function renderColoradoRollTracker() {
      hydrateColoradoRollBaselines();
      const wrap = el('co-roll-tracker');
      if (!wrap) return;
      const helper = Reports.colorado && typeof Reports.colorado.buildColoradoRollSummary === 'function'
        ? Reports.colorado.buildColoradoRollSummary
        : null;
      if (!helper) {
        wrap.innerHTML = '';
        return;
      }

      const summaries = MACHINES.map(({ id, label }) => {
        const rollState = getColoradoRollState(id);
        if (shouldRefreshColoradoRollAccounting(id, rollState)) {
          void refreshColoradoRollAccountingStatus(id, rollState);
        }
        const accountingState = getColoradoRollAccountingState(id);
        const accountingUsage = accountingState
          ? {
            loading: Boolean(accountingState.loading),
            error: accountingState.error || '',
            mediaLengthM: accountingState.mediaLengthM,
            latestReadyAt: accountingState.latestReadyAt,
            latestImportedAt: accountingState.latestImportedAt,
            generatedAt: accountingState.generatedAt,
          }
          : (rollState && rollState.loadedAt ? { loading: true } : null);
        const summary = helper(S.coRecords || [], rollState || { machineId: id }, {
          staleMinutes: COLORADO_ROLL_STALE_MINUTES,
          nowMs: Date.now(),
          accountingUsage,
        });
        logColoradoRollStatusDiagnostics('computed', {
          machineId: id,
          machineLabel: label,
          rollLoadedAt: rollState && rollState.loadedAt,
          latestLegacyRecordAt: summary.latestSampleAt,
          accountingUsage,
          finalStatus: summary.status,
          finalLabel: getColoradoRollStatusText(summary),
          remainingM: summary.remainingM,
          sampleAgeMinutes: summary.sampleAgeMinutes,
        });
        return {
          ...summary,
          machineLabel: label,
          canUndo: Boolean(rollState && rollState.previousState && rollState.lastLoadEventId),
        };
      });

      wrap.innerHTML = summaries.map(summary => {
        const rollClass = getColoradoRollUiClass(summary.status);
        const compactLabel = (summary.machineLabel || summary.machineId || 'Colorado').replace(/^Colorado\s+/i, 'C');
        const statusText = getColoradoRollStatusText(summary);
        const fillPercent = Number.isFinite(summary.fillPercent) ? summary.fillPercent : 0;
        const freshnessText = getColoradoRollFreshnessText(summary);
        const ariaLabel = `${summary.machineLabel || summary.machineId} ${statusText}`;
        return `<div class="roll-group" data-roll-machine="${esc(summary.machineId)}">
          <button class="roll-chip ${esc(rollClass)}" type="button" data-roll-detail="${esc(summary.machineId)}" aria-label="${esc(ariaLabel)}" style="${Number.isFinite(summary.fillPercent) ? `--roll-fill:${fillPercent}%` : '--roll-fill:0%'}">
            <div class="roll-chip-main">
              <div class="roll-chip-head">
                <span class="roll-chip-machine">${esc(compactLabel)}</span>
                <span class="roll-chip-status">${esc(statusText)}</span>
              </div>
              <div class="roll-battery" aria-hidden="true">
                <span class="roll-battery-fill"></span>
              </div>
              ${freshnessText ? `<div class="roll-chip-freshness">${esc(freshnessText)}</div>` : ''}
            </div>
          </button>
          <button class="icon-btn roll-action-button" type="button" data-roll-load="${esc(summary.machineId)}" title="Nová role" aria-label="Nová role">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
        </div>`;
      }).join('');

      wrap.querySelectorAll('[data-roll-load]').forEach(button => {
        button.addEventListener('click', () => openColoradoRollModal(button.dataset.rollLoad));
      });

      wrap.querySelectorAll('[data-roll-detail]').forEach(button => {
        button.addEventListener('click', () => openColoradoRollSheet(button.dataset.rollDetail));
      });

      const mobileEntry = el('roll-mobile-entry');
      const mobileToggle = el('roll-mobile-toggle');
      const mobileDot = el('roll-mobile-dot');
      if (mobileEntry && mobileToggle && mobileDot) {
        const aggregate = getColoradoRollAggregate(summaries);
        mobileToggle.className = `icon-btn roll-mobile-toggle ${aggregate.uiClass}`;
        mobileToggle.title = aggregate.title;
        mobileToggle.setAttribute('aria-label', aggregate.title);
        mobileToggle.setAttribute('aria-expanded', mobileEntry.classList.contains('hidden') ? 'false' : 'true');
        mobileDot.classList.toggle('hidden', !aggregate.hasWarning);
      }

      renderColoradoRollSheet(summaries, el('roll-sheet')?.dataset.focusMachineId || null);
    }

    function closeColoradoRollModal() {
      const modal = el('roll-modal');
      if (modal) modal.classList.add('hidden');
    }

    function closeColoradoRollSheet() {
      const sheet = el('roll-sheet');
      const toggle = el('roll-mobile-toggle');
      if (sheet) sheet.classList.add('hidden');
      if (toggle) toggle.setAttribute('aria-expanded', 'false');
    }

    function openColoradoRollSheet(machineId) {
      const sheet = el('roll-sheet');
      const toggle = el('roll-mobile-toggle');
      if (!sheet) return;
      if (machineId) sheet.dataset.focusMachineId = machineId;
      else delete sheet.dataset.focusMachineId;
      renderColoradoRollTracker();
      sheet.classList.remove('hidden');
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
    }

    function getRollHistoryLabel(event) {
      if (!event) return 'Událost';
      if (event.type === 'roll_load_cancelled') return 'Výměna vrácena';
      if (event.type === 'roll_reset') return 'Reset stavu role';
      return 'Nová role';
    }

    function getColoradoRollHistoryEvents(machineId) {
      return getColoradoRollEvents(machineId)
        .filter(event => ['roll_loaded', 'roll_load_cancelled', 'roll_reset'].includes(event && event.type))
        .slice()
        .sort((a, b) => new Date(b.timestamp || b.updatedAt || 0) - new Date(a.timestamp || a.updatedAt || 0));
    }

    function exportColoradoRollHistoryCsv(machineId) {
      const events = getColoradoRollHistoryEvents(machineId);
      if (!events.length) {
        showToast('Historie výměn je prázdná', 'error');
        return;
      }
      if (!downloadCsvBlob || !getExportFileStamp || !Reports.csv || typeof Reports.csv.rowsToCsv !== 'function') {
        showToast('Export CSV není dostupný', 'error');
        return;
      }

      const machineLabel = getMachineLabel(machineId);
      const rows = events.map(event => {
        const before = event.before && typeof event.before === 'object' ? event.before : {};
        const after = event.after && typeof event.after === 'object' ? event.after : {};
        const baselineValue = Number(after.baselineMediaTotalM2);
        return {
          machine: machineLabel,
          type: getRollHistoryLabel(event),
          eventType: event.type || '',
          timestamp: event.timestamp || after.loadedAt || after.updatedAt || '',
          loadedBy: after.loadedBy || event.loadedBy || '',
          activeRollId: after.activeRollId || '',
          baselineMediaTotalM2: Number.isFinite(baselineValue) ? baselineValue : '',
          baselineRecordedAt: after.baselineRecordedAt || event.baselineRecordedAt || '',
          previousLoadedAt: before.loadedAt || '',
          previousBaselineMediaTotalM2: before.baselineMediaTotalM2 || '',
          previousRollId: before.activeRollId || '',
          rollLengthM: after.rollLengthM || '',
          mediaWidthMm: after.mediaWidthMm || before.mediaWidthMm || '',
          eventId: event.eventId || event.id || '',
          revertedEventId: event.revertedEventId || '',
        };
      });

      const csv = Reports.csv.rowsToCsv(rows, [
        { header: 'Tiskarna', value: row => row.machine },
        { header: 'Typ', value: row => row.type },
        { header: 'Interni typ', value: row => row.eventType },
        { header: 'Cas', value: row => row.timestamp },
        { header: 'Zadal', value: row => row.loadedBy },
        { header: 'Aktivni role ID', value: row => row.activeRollId },
        { header: 'Baseline media total m2', value: row => row.baselineMediaTotalM2 },
        { header: 'Baseline cas', value: row => row.baselineRecordedAt },
        { header: 'Predchozi vymena', value: row => row.previousLoadedAt },
        { header: 'Predchozi baseline media total m2', value: row => row.previousBaselineMediaTotalM2 },
        { header: 'Predchozi role ID', value: row => row.previousRollId },
        { header: 'Delka role m', value: row => row.rollLengthM },
        { header: 'Sirka media mm', value: row => row.mediaWidthMm },
        { header: 'Event ID', value: row => row.eventId },
        { header: 'Vraceny event ID', value: row => row.revertedEventId },
      ]);
      const fileMachine = machineLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'colorado';
      downloadCsvBlob(csv, 'text/csv;charset=utf-8', `historie_vymen_papiru_${fileMachine}_${getExportFileStamp()}.csv`);
    }

    function renderColoradoRollModalHistory(machineId) {
      const list = el('roll-modal-history-list');
      const count = el('roll-modal-history-count');
      const exportButton = el('roll-modal-history-export');
      if (!list) return;

      const events = getColoradoRollHistoryEvents(machineId);
      const visibleEvents = events.slice(0, 5);

      if (count) {
        count.textContent = events.length === 1 ? '1 záznam' : `${events.length} záznamů`;
      }
      if (exportButton) {
        exportButton.disabled = !events.length;
        exportButton.dataset.machineId = machineId || '';
        exportButton.onclick = () => exportColoradoRollHistoryCsv(exportButton.dataset.machineId || '');
      }

      if (!visibleEvents.length) {
        list.innerHTML = '<div class="roll-modal-history-empty">Zatím žádná výměna pro tuhle tiskárnu.</div>';
        return;
      }

      list.innerHTML = visibleEvents.map(event => {
        const after = event.after && typeof event.after === 'object' ? event.after : {};
        const before = event.before && typeof event.before === 'object' ? event.before : {};
        const eventTime = event.timestamp || after.loadedAt || after.updatedAt || '';
        const actor = after.loadedBy || event.loadedBy || '';
        const baselineValue = Number(after.baselineMediaTotalM2);
        const previousLoadedAt = before.loadedAt || '';
        const baselineLabel = Number.isFinite(baselineValue)
          ? `${fmtN(baselineValue, 2)} m2`
          : (event.baselineKnown === false ? 'čeká na sync' : '');
        const details = [
          actor ? `Zadal: ${actor}` : '',
          previousLoadedAt && event.type === 'roll_loaded' ? `Předchozí: ${fmtDT(previousLoadedAt)}` : '',
          baselineLabel ? `Stav: ${baselineLabel}` : '',
        ].filter(Boolean);

        return `<article class="roll-modal-history-item ${esc(event.type || '')}">
          <div class="roll-modal-history-item-top">
            <strong>${esc(getRollHistoryLabel(event))}</strong>
            <time>${esc(eventTime ? fmtDT(eventTime) : '-')}</time>
          </div>
          ${details.length ? `<div class="roll-modal-history-meta">${details.map(detail => `<span>${esc(detail)}</span>`).join('')}</div>` : ''}
        </article>`;
      }).join('');
    }

    function openColoradoRollModal(machineId) {
      const modal = el('roll-modal');
      if (!modal) return;
      const machine = MACHINES.find(item => item.id === machineId) || MACHINES[0];
      if (!machine) return;
      const latest = getLatestCoRecord(machine.id);
      const summary = latest
        ? 'Potvrdit výměnu role?'
        : 'Zatím nemáme poslední stav z Colorada. Výpočet se spustí po dalším syncu.';

      elSet('roll-modal-title', `Nová role  ${machine.label}`);
      elSet('roll-modal-summary', summary);
      renderColoradoRollModalHistory(machine.id);
      modal.dataset.machineId = machine.id;
      modal.classList.remove('hidden');
    }

    async function saveColoradoRollModal() {
      const modal = el('roll-modal');
      if (!modal) return;
      const machineId = modal.dataset.machineId || '';
      const machine = MACHINES.find(item => item.id === machineId);
      if (!machine) {
        showToast('Vyberte tiskárnu', 'error');
        return;
      }

      const latest = getLatestCoRecord(machine.id);
      const now = new Date().toISOString();
      const activeRollId = genId('roll');
      const baselineKnown = Boolean(latest);
      const currentState = getColoradoRollState(machine.id);
      const configuredWidth = getConfiguredRollWidthMm(currentState);
      const previousState = currentState ? normalizeRollState(machine.id, currentState, false) : null;
      const loadEventId = genId('co-roll-loaded');
      const nextState = normalizeRollState(machine.id, {
        activeRollId,
        rollLengthM: COLORADO_ROLL_LENGTH_M,
        mediaWidthMm: configuredWidth,
        baselineMediaTotalM2: baselineKnown ? Number(latest.mediaTotalM2) : null,
        baselineRecordedAt: baselineKnown ? latest.timestamp : null,
        loadedAt: now,
        loadedBy: cfg.userName || cfg.deviceId,
        machineName: machine.label,
        updatedAt: now,
        previousState,
        lastLoadEventId: loadEventId,
      });

      setColoradoRollState(machine.id, nextState);
      appendColoradoRollEvent(machine.id, 'roll_loaded', {
        eventId: loadEventId,
        before: previousState,
        after: nextState,
        baselineKnown,
        baselineRecordedAt: nextState.baselineRecordedAt,
      });
      setSyncDirtyReason('colorado');
      closeColoradoRollModal();
      renderColoradoRollTracker();
      showToast(
        baselineKnown ? 'Nová role uložena' : 'Nová role uložena, čekáme na další sync',
        'success',
        {
          label: 'Vrátit zpět',
          onClick: () => undoColoradoRollLoad(machine.id),
        }
      );
      if (navigator.onLine && typeof runSync === 'function') void runSync({ silent: true });
    }

    function undoColoradoRollLoad(machineId) {
      const current = getColoradoRollState(machineId);
      if (!current || !current.lastLoadEventId) {
        showToast('Nelze vrátit poslední výměnu', 'error');
        return;
      }

      const preservedWidth = getConfiguredRollWidthMm(current);
      const restored = current.previousState
        ? normalizeRollState(machineId, current.previousState)
        : normalizeRollState(machineId, {
          machineName: getMachineLabel(machineId),
          mediaWidthMm: preservedWidth,
        });

      setColoradoRollState(machineId, restored);
      appendColoradoRollEvent(machineId, 'roll_load_cancelled', {
        revertedEventId: current.lastLoadEventId,
        before: current,
        after: restored,
      });
      setSyncDirtyReason('colorado');
      renderColoradoRollTracker();
      closeColoradoRollSheet();
      showToast('Výměna vrácena', 'success');
      if (navigator.onLine && typeof runSync === 'function') void runSync({ silent: true });
    }

    function resetColoradoRollState(machineId) {
      const before = getColoradoRollState(machineId);
      const preservedWidth = getConfiguredRollWidthMm(before);
      const next = normalizeRollState(machineId, {
        machineName: getMachineLabel(machineId),
        mediaWidthMm: preservedWidth,
      });
      setColoradoRollState(machineId, next);
      appendColoradoRollEvent(machineId, 'roll_reset', {
        before,
        after: next,
      });
      setSyncDirtyReason('colorado');
      renderColoradoRollTracker();
      closeColoradoRollSheet();
      showToast('Stav role resetován', 'success');
      if (navigator.onLine && typeof runSync === 'function') void runSync({ silent: true });
    }

    function promptColoradoRollReset(machineId) {
      if (!machineId) return;
      showConfirm({
        title: 'Zrušit poslední výměnu role?',
        body: 'Tím se obnoví předchozí stav role.',
        cancelLabel: 'Nechat',
        confirmLabel: 'Zrušit výměnu',
      }, () => resetColoradoRollState(machineId));
    }

    function getCoRecs(machineId) {
      return (S.coRecords || [])
        .filter(record => record.machineId === machineId && !record.deletedAt)
        .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    }

    function computeCoIntervals(machineId) {
      return Reports.colorado.buildColoradoIntervals(getCoRecs(machineId), {
        inkCost: cfg.inkCost,
        mediaCost: cfg.mediaCost,
      });
    }

    function computeCoStats(machineId) {
      return Reports.colorado.buildColoradoStats(getCoRecs(machineId), {
        rollingN: cfg.rollingN,
        inkCost: cfg.inkCost,
        mediaCost: cfg.mediaCost,
      });
    }

    function getCombinedCoLifetimeInkBasis() {
      const intervals = MACHINES
        .flatMap(({ id }) => computeCoIntervals(id))
        .filter(iv => Number(iv.mediaUsed) > 0 && Number(iv.inkUsed) >= 0);

      if (!intervals.length) return null;

      const inkUsed = intervals.reduce((sum, iv) => sum + (Number(iv.inkUsed) || 0), 0);
      const mediaUsed = intervals.reduce((sum, iv) => sum + (Number(iv.mediaUsed) || 0), 0);
      if (!(mediaUsed > 0)) return null;

      return {
        source: 'combined_lifetime',
        intervalCount: intervals.length,
        inkUsed,
        mediaUsed,
        inkPerM2: inkUsed / mediaUsed,
      };
    }

    function getColoradoFormatEstimates() {
      const basis = getCombinedCoLifetimeInkBasis();
      if (!basis) return { basis: null, rows: [] };

      const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
      return {
        basis,
        rows: CO_FORMATS.map(format => {
          const areaM2 = (format.widthCm / 100) * (format.heightCm / 100);
          const inkL = areaM2 * basis.inkPerM2;
          const cost = hasCosts ? (inkL * cfg.inkCost) + (areaM2 * cfg.mediaCost) : null;
          return {
            label: format.key,
            areaM2,
            inkL,
            inkMl: inkL * 1000,
            cost,
          };
        }),
      };
    }

    function renderMachineCard(machineId, label) {
      const wrap = el('card-' + machineId);
      if (!wrap) return;
      const recs = getCoRecs(machineId);
      const s = computeCoStats(machineId);

      if (!s || recs.length < 2) {
        const lastLine = recs.length === 1
          ? `<br>${i18n('colorado.card.need-two.last')}: <strong>${fmtDT(recs[0].timestamp)}</strong> · ${i18n('colorado.card.ink-total')} <strong>${fmtN(recs[0].inkTotalLiters, 2)} L</strong> · ${i18n('colorado.card.media-total')} <strong>${fmtN(recs[0].mediaTotalM2, 1)} m²</strong>`
          : '';
        wrap.innerHTML = `<div class="mc-header">
          <span class="mc-label">${esc(label)}</span>
          <span class="mc-badge">${recs.length} ${recs.length === 1 ? i18n('colorado.card.record.one') : i18n('colorado.card.record.other')}</span>
        </div>
        <div class="mc-empty">
          ${i18n('colorado.card.need-two')}
          ${lastLine}
        </div>`;
        return;
      }

      const recordWord = s.recordCount === 1 ? i18n('colorado.card.record.one') : i18n('colorado.card.record.other');
      const intervalWord = s.intervalCount === 1 ? i18n('colorado.card.interval.one') : i18n('colorado.card.interval.other');

      wrap.innerHTML = `
        <div class="mc-header">
          <span class="mc-label">${esc(label)}</span>
          <span class="mc-badge">${s.recordCount} ${recordWord} · ${s.intervalCount} ${intervalWord}</span>
        </div>
        <div class="metrics-grid">
          <div class="metric-block">
            <span class="metric-big">${fmtN(s.avgMediaDay, 1)}</span>
            <span class="metric-unit">${i18n('unit.m2-per-day')}</span>
            <span class="metric-desc">${i18n('colorado.card.metrics.media-day')}</span>
          </div>
          <div class="metric-block">
            <span class="metric-big">${fmtN(s.avgMediaMonth, 0)}</span>
            <span class="metric-unit">${i18n('unit.m2-per-month')}</span>
            <span class="metric-desc">${i18n('colorado.card.metrics.media-month')}</span>
          </div>
          <div class="metric-block ink-bg">
            <span class="metric-big">${fmtN(s.avgInkDay, 3)}</span>
            <span class="metric-unit">${i18n('unit.l-per-day')}</span>
            <span class="metric-desc">${i18n('colorado.card.metrics.ink-day')}</span>
          </div>
          <div class="metric-block ink-bg">
            <span class="metric-big">${fmtN(s.avgInkMonth, 2)}</span>
            <span class="metric-unit">${i18n('unit.l-per-month')}</span>
            <span class="metric-desc">${i18n('colorado.card.metrics.ink-month')}</span>
          </div>
          <div class="metric-block ink-bg">
            <span class="metric-big">${s.avgInkPM2 !== null ? fmtN(s.avgInkPM2, 4) : '—'}</span>
            <span class="metric-unit">${i18n('unit.l-per-m2')}</span>
            <span class="metric-desc">${i18n('colorado.card.metrics.ink-per-m2')}</span>
          </div>
          ${s.hasCosts && s.avgCostPM2 !== null ? `<div class="metric-block cost-bg">
            <span class="metric-big">${fmtN(s.avgCostPM2, 2)}</span>
            <span class="metric-unit">${getCostUnitPerM2()}</span>
            <span class="metric-desc">${i18n('colorado.card.metrics.cost-per-m2')}</span>
          </div>` : ''}
        </div>
        <div class="mc-last">
          ${i18n('colorado.card.last')} <strong>${fmtDT(s.last.timestamp)}</strong> ·
          ${i18n('colorado.card.ink-total')} <strong>${fmtN(s.last.inkTotalLiters, 2)} L</strong> ·
          ${i18n('colorado.card.media-total')} <strong>${fmtN(s.last.mediaTotalM2, 1)} m²</strong>
        </div>`;
    }

    function renderCombinedCard() {
      const wrap = el('card-combined');
      if (!wrap) return;
      const valid = MACHINES.map(m => computeCoStats(m.id)).filter(s => s && s.intervalCount > 0);
      if (!valid.length) {
        wrap.innerHTML = `<div class="mc-header"><span class="mc-label">${i18n('colorado.card.combined.title')}</span><button class="btn-sm" id="co-lifetime-export-btn">${i18n('colorado.export.lifetime-combined')}</button></div><div class="mc-empty">${i18n('colorado.card.no-data')}</div>`;
        el('co-lifetime-export-btn')?.addEventListener('click', exportCSVCombinedLifetimeCo);
        return;
      }
      const sum = (fn) => valid.reduce((s, v) => s + fn(v), 0);
      const inkMonth = sum(v => v.avgInkMonth);
      const mediaMonth = sum(v => v.avgMediaMonth);
      const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
      const costMonth = hasCosts ? inkMonth * cfg.inkCost + mediaMonth * cfg.mediaCost : null;
      const basis = getCombinedCoLifetimeInkBasis();
      const formatEstimates = getColoradoFormatEstimates();

      const formatTable = formatEstimates.rows.length ? `
        <div class="format-estimates">
          <div class="format-estimates-head">
            <span class="format-estimates-title">${i18n('colorado.card.formats.note')}</span>
            <span class="format-estimates-subtitle">${basis ? `${fmtN(basis.intervalCount || 0, 0)} ${i18n('colorado.card.formats.intervals')}` : ''}</span>
          </div>
          <div class="table-wrap">
            <table class="data-table format-estimates-table">
              <thead>
                <tr>
                  <th>${i18n('colorado.card.formats.table.format')}</th>
                  <th>${i18n('colorado.card.formats.table.area')}</th>
                  <th>${i18n('colorado.card.formats.table.ink')}</th>
                  ${hasCosts ? `<th>${i18n('colorado.card.formats.table.cost')}</th>` : ''}
                </tr>
              </thead>
              <tbody>
                ${formatEstimates.rows.map(row => `
                  <tr>
                    <td><strong>${esc(row.label)}</strong></td>
                    <td class="num">${fmtN(row.areaM2, 2)} m²</td>
                    <td class="num">${fmtN(row.inkL, 3)} L</td>
                    ${hasCosts ? `<td class="num">${row.cost !== null ? fmtN(row.cost, 2) : '—'}</td>` : ''}
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>` : '';

      wrap.innerHTML = `
        <div class="mc-header">
          <span class="mc-label">${i18n('colorado.card.combined.title')}</span>
          <button class="btn-sm" id="co-lifetime-export-btn">${i18n('colorado.export.lifetime-combined')}</button>
        </div>
        <div class="metrics-grid">
          <div class="metric-block">
            <span class="metric-big">${fmtN(inkMonth, 3)}</span>
            <span class="metric-unit">${i18n('unit.l-per-month')}</span>
            <span class="metric-desc">${i18n('colorado.card.combined.ink-month')}</span>
          </div>
          <div class="metric-block">
            <span class="metric-big">${fmtN(mediaMonth, 1)}</span>
            <span class="metric-unit">${i18n('unit.m2-per-month')}</span>
            <span class="metric-desc">${i18n('colorado.card.combined.media-month')}</span>
          </div>
          <div class="metric-block ink-bg">
            <span class="metric-big">${basis ? fmtN(basis.inkPerM2, 4) : '—'}</span>
            <span class="metric-unit">${i18n('unit.l-per-m2')}</span>
            <span class="metric-desc">${i18n('colorado.card.combined.ink-total')}</span>
          </div>
          <div class="metric-block ink-bg">
            <span class="metric-big">${fmtN(inkMonth, 2)}</span>
            <span class="metric-unit">${i18n('unit.l-per-month')}</span>
            <span class="metric-desc">${i18n('colorado.card.combined.ink-month')}</span>
          </div>
          ${hasCosts && costMonth !== null ? `<div class="metric-block cost-bg">
            <span class="metric-big">${fmtN(costMonth, 0)}</span>
            <span class="metric-unit">${getCostUnitPerMonth()}</span>
            <span class="metric-desc">${i18n('colorado.card.combined.cost-month')}</span>
          </div>` : ''}
        </div>
        ${formatTable}`;
      el('co-lifetime-export-btn')?.addEventListener('click', exportCSVCombinedLifetimeCo);
    }

    function renderCoDashboard() {
      renderColoradoRollTracker();
      MACHINES.forEach(({ id, label }) => renderMachineCard(id, label));
      renderCombinedCard();
    }

    function setupCoEntry() {
      document.querySelectorAll('.machine-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('.machine-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          updateCoPreview();
        });
      });
      el('co-ink').addEventListener('input', updateCoPreview);
      el('co-media').addEventListener('input', updateCoPreview);
      el('co-timestamp').value = toLocalDT(new Date().toISOString());
      el('co-save-btn').addEventListener('click', saveCoEntry);
    }

    function getSelectedMachine() {
      return document.querySelector('.machine-btn.active')?.dataset.machine || null;
    }

    function updateCoPreview() {
      const machineId = getSelectedMachine();
      const inkVal = parseFloat(el('co-ink').value);
      const mediaVal = parseFloat(el('co-media').value);
      if (!machineId || isNaN(inkVal) || isNaN(mediaVal)) {
        el('co-preview').classList.add('hidden');
        return;
      }
      const recs = getCoRecs(machineId);
      const last = recs[recs.length - 1];
      if (!last) {
        el('co-preview').classList.remove('hidden');
        return;
      }

      const inkUsed = Math.max(0, inkVal - last.inkTotalLiters);
      const mediaUsed = Math.max(0, mediaVal - last.mediaTotalM2);
      const ts = new Date(toISOfromDT(el('co-timestamp').value));
      const days = Math.max((ts - new Date(last.timestamp)) / 86400000, 0.0001);
      const ratio = mediaUsed > 0 ? inkUsed / mediaUsed : null;

      el('co-prev-ink').textContent = `+${fmtN(inkUsed, 3)} L`;
      el('co-prev-media').textContent = `+${fmtN(mediaUsed, 1)} m²`;
      el('co-prev-ratio').textContent = ratio !== null ? `${fmtN(ratio, 4)} L/m²` : '—';
      el('co-prev-days').textContent = `${fmtN(days, 1)} dní`;
      el('co-preview').classList.remove('hidden');
    }

    async function saveCoEntry() {
      const machineId = getSelectedMachine();
      if (!machineId) { showToast('Vyberte tiskárnu', 'error'); return; }
      const inkVal = parseFloat(el('co-ink').value);
      const mediaVal = parseFloat(el('co-media').value);
      if (isNaN(inkVal) || inkVal < 0) { showToast('Zadejte platnou hodnotu inkoustu', 'error'); return; }
      if (isNaN(mediaVal) || mediaVal < 0) { showToast('Zadejte platnou hodnotu média', 'error'); return; }

      const now = new Date().toISOString();
      const rec = {
        id: genId('co'),
        machineId,
        timestamp: toISOfromDT(el('co-timestamp').value) || now,
        inkTotalLiters: inkVal,
        mediaTotalM2: mediaVal,
        note: el('co-note').value.trim() || undefined,
        createdAt: now,
        updatedAt: now,
      };

      el('co-save-btn').disabled = true;
      try {
        await idbPut(ST_CORECS, rec);
        S.coRecords.push(rec);
        setSyncDirtyReason('colorado');
        S.coRecords.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const machineLabel = getMachineLabel(machineId);
        showToast('Záznam Colorado uložen', 'success');
        el('co-ink').value = '';
        el('co-media').value = '';
        el('co-note').value = '';
        el('co-timestamp').value = toLocalDT(new Date().toISOString());
        el('co-preview').classList.add('hidden');
        renderCoDashboard();
        renderCoHistory();
        navigate('co-dashboard');
        runNotificationDispatch?.(Reports.notificationDispatch?.emitColoradoRecordCreated?.(rec, machineLabel), 'colorado record event');
      } catch (err) {
        showToast('Chyba: ' + err.message, 'error');
      } finally {
        el('co-save-btn').disabled = false;
      }
    }

    function renderCoHistory() {
      const machineId = S.coHistMachine;
      document.querySelectorAll('.hist-tab').forEach(b =>
        b.classList.toggle('active', b.dataset.machine === machineId));

      const recs = getCoRecs(machineId);
      const ivs = computeCoIntervals(machineId);
      const ivByRec = {};
      ivs.forEach(iv => { ivByRec[iv.recordId] = iv; });

      const wrap = el('co-history-wrap');
      if (!recs.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné záznamy.</p></div>`;
        return;
      }

      const hasCosts = cfg.inkCost > 0 || cfg.mediaCost > 0;
      const filteredRecs = recs.filter(rec => dateRangeFilter(rec.timestamp, S.coDateFrom, S.coDateTo));

      if (!filteredRecs.length) {
        wrap.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📋</div><p>Žádné záznamy v daném období.</p></div>`;
        return;
      }

      const rows = [...filteredRecs].reverse().map(rec => {
        const iv = ivByRec[rec.id];
        return `<tr>
          <td>${fmtDT(rec.timestamp)}</td>
          <td class="num">${fmtN(rec.inkTotalLiters, 3)}</td>
          <td class="num">${fmtN(rec.mediaTotalM2, 1)}</td>
          <td class="num delta">${iv ? '+' + fmtN(iv.mediaUsed, 1) : '—'}</td>
          <td class="num delta">${iv ? '+' + fmtN(iv.inkUsed, 3) : '—'}</td>
          <td class="num">${iv && iv.inkPerM2 !== null ? fmtN(iv.inkPerM2, 4) : '—'}</td>
          ${hasCosts ? `<td class="num">${iv && iv.costPerM2 !== null ? fmtN(iv.costPerM2, 2) : '—'}</td>` : ''}
          <td class="note-td">${esc(rec.note || '—')}</td>
          <td><button class="btn-del admin-only" data-id="${esc(rec.id)}" title="Smazat (jen admin)">✕</button></td>
        </tr>`;
      }).join('');

      wrap.innerHTML = `<table class="data-table">
        <thead><tr>
          <th>${i18n('colorado.table.datetime')}</th>
          <th>${i18n('colorado.table.ink-total')}</th>
          <th>${i18n('colorado.table.media-total')}</th>
          <th>${i18n('colorado.table.media-delta')}</th>
          <th>${i18n('colorado.table.ink-delta')}</th>
          <th>${i18n('unit.l-per-m2')}</th>
          ${hasCosts ? `<th>${getCostUnitPerM2()}</th>` : ''}
          <th>${i18n('table.note')}</th>
          <th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;

      wrap.querySelectorAll('.btn-del').forEach(btn =>
        btn.addEventListener('click', () => deleteCoRecord(btn.dataset.id)));
    }

    function bindColoradoHistoryControls(options = {}) {
      const onExportRaw = options.exportCSVRawCo;
      const onExportMonth = options.exportCSVCurrentMonthCo;
      if (historyControlsBound) return;
      historyControlsBound = true;

      document.querySelectorAll('.hist-tab').forEach(button =>
        button.addEventListener('click', () => {
          S.coHistMachine = button.dataset.machine;
          renderCoHistory();
        }));
      el('co-hist-from').addEventListener('change', e => {
        S.coDateFrom = e.target.value;
        renderCoHistory();
      });
      el('co-hist-to').addEventListener('change', e => {
        S.coDateTo = e.target.value;
        renderCoHistory();
      });
      el('co-hist-clear-dates').addEventListener('click', () => {
        S.coDateFrom = '';
        S.coDateTo = '';
        el('co-hist-from').value = '';
        el('co-hist-to').value = '';
        renderCoHistory();
      });
      el('co-history-export-btn').addEventListener('click', () => {
        if (typeof onExportRaw === 'function') onExportRaw();
      });
      el('co-month-export-btn').addEventListener('click', () => {
        if (typeof onExportMonth === 'function') onExportMonth();
      });
    }

    async function deleteCoRecord(id) {
      if (!isAdmin || !isAdmin()) { showToast('Mazání záznamů Colorado — jen admin', 'error'); return; }
      showConfirm('Smazat tento záznam Colorado? (Admin)', async () => {
        try {
          const now = new Date().toISOString();
          const current = S.coRecords.find(r => r.id === id);
          if (!current) {
            showToast('Záznam už není v lokální paměti.', 'error');
            return;
          }
          const tombstone = {
            ...current,
            deletedAt: now,
            updatedAt: now,
          };
          await idbPut(ST_CORECS, tombstone);
          setSyncDirtyReason('colorado');
          S.coRecords = S.coRecords.filter(r => r.id !== id);
          renderCoDashboard();
          renderCoHistory();
          showToast('Záznam smazán');
          if (navigator.onLine && typeof runSync === 'function') void runSync({ silent: true });
        } catch (err) {
          showToast(`Mazání selhalo: ${adminErrorMessage ? adminErrorMessage(err) : err.message}`, 'error');
        }
      });
    }

    return {
      MACHINES,
      loadColoradoRollStates,
      loadColoradoRollEvents,
      renderColoradoRollTracker,
      closeColoradoRollModal,
      closeColoradoRollSheet,
      openColoradoRollSheet,
      openColoradoRollModal,
      saveColoradoRollModal,
      undoColoradoRollLoad,
      resetColoradoRollState,
      promptColoradoRollReset,
      getCoRecs,
      computeCoIntervals,
      computeCoStats,
      getCombinedCoLifetimeInkBasis,
      getColoradoFormatEstimates,
      renderCoDashboard,
      setupCoEntry,
      bindColoradoHistoryControls,
      getSelectedMachine,
      updateCoPreview,
      renderCoHistory,
      deleteCoRecord,
    };
  }

  global.PrintGuardColoradoController = {
    createColoradoController,
  };
})(window);
