(function attachChecklistUi(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.PrintGuardChecklistUI = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChecklistUi() {
  'use strict';

  const ChecklistApi = (typeof window !== 'undefined' && window.PrintGuardChecklistApi) || null;
  const ChecklistDomain = (typeof window !== 'undefined' && window.checklistDomain) || null;
  const ChecklistState = (typeof window !== 'undefined' && window.PrintGuardChecklistState) || null;
  const ChecklistRender = (typeof window !== 'undefined' && window.PrintGuardChecklistRender) || null;
  const ChecklistEvents = (typeof window !== 'undefined' && window.PrintGuardChecklistEvents) || null;

  if (!ChecklistApi) throw new Error('Missing PrintGuardChecklistApi');
  if (!ChecklistDomain) throw new Error('Missing checklistDomain');
  if (!ChecklistState) throw new Error('Missing PrintGuardChecklistState');
  if (!ChecklistRender) throw new Error('Missing PrintGuardChecklistRender');
  if (!ChecklistEvents) throw new Error('Missing PrintGuardChecklistEvents');

  const state = ChecklistState.createState();

  function getVisibleOccurrence(item) {
    return ChecklistRender.getVisibleOccurrence(item);
  }

  function setStatus(text) {
    const node = state.el('checklist-status-text');
    if (node) node.textContent = text;
  }

  function applyUiAccessState() {
    if (typeof state.applyRoleUI === 'function') state.applyRoleUI();
  }

  async function refreshChecklist(force) {
    if (state.loading) return;

    if (state.loaded && !force) {
      renderChecklistScreen();
      return;
    }

    state.loading = true;
    setStatus(ChecklistState.t(state, 'checklist.loading'));
    ChecklistRender.renderChecklistList(state);

    try {
      const response = await ChecklistApi.listChecklistItems({
        fetchImpl: state.fetchImpl,
      });
      const logResponse = await ChecklistApi.listChecklistCompletions({
        fetchImpl: state.fetchImpl,
        limit: 500,
      });
      state.items = Array.isArray(response.items) ? response.items : [];
      state.completions = Array.isArray(logResponse.completions) ? logResponse.completions : [];
      state.loaded = true;
      setStatus(ChecklistState.t(state, 'checklist.status.ready'));
    } catch (error) {
      setStatus(ChecklistState.t(state, 'checklist.status.load-error'));
      state.showToast && state.showToast(error && error.message ? error.message : ChecklistState.t(state, 'checklist.error.load'), 'error');
    } finally {
      state.loading = false;
      renderChecklistScreen();
    }
  }

  async function saveChecklist() {
    try {
      const authHeaders = typeof state.adminHeaders === 'function' ? state.adminHeaders() : {};
      const payload = ChecklistEvents.getFormPayload(state);
      const requestBody = {
        ...payload,
        actor: ChecklistState.getActor(state),
      };

      if (payload.id) {
        await ChecklistApi.updateChecklistItem(requestBody, { fetchImpl: state.fetchImpl, headers: authHeaders });
      } else {
        await ChecklistApi.createChecklistItem(requestBody, { fetchImpl: state.fetchImpl, headers: authHeaders });
      }

      ChecklistEvents.closeForm(state);
      state.showToast && state.showToast(ChecklistState.t(state, 'checklist.toast.saved'), 'success');
      await refreshChecklist(true);
    } catch (error) {
      const message = typeof state.adminErrorMessage === 'function' ? state.adminErrorMessage(error) : (error && error.message ? error.message : ChecklistState.t(state, 'checklist.error.save'));
      state.showToast && state.showToast(message, 'error');
    }
  }

  async function toggleChecklist(id) {
    const item = ChecklistState.findItemById(state, id);
    if (!item) return;

    try {
      const authHeaders = typeof state.adminHeaders === 'function' ? state.adminHeaders() : {};
      await ChecklistApi.updateChecklistItem(
        {
          ...item,
          enabled: !item.enabled,
          actor: ChecklistState.getActor(state),
        },
        { fetchImpl: state.fetchImpl, headers: authHeaders }
      );
      state.showToast && state.showToast(ChecklistState.t(state, 'checklist.toast.updated'), 'success');
      await refreshChecklist(true);
    } catch (error) {
      const message = typeof state.adminErrorMessage === 'function' ? state.adminErrorMessage(error) : (error && error.message ? error.message : ChecklistState.t(state, 'checklist.error.update'));
      state.showToast && state.showToast(message, 'error');
    }
  }

  async function completeChecklist(item) {
    const nextOccurrence = getVisibleOccurrence(item);
    if (!nextOccurrence) return;
    if (ChecklistState.getCompletedOccurrenceKeys(state).has(nextOccurrence.occurrenceKey)) {
      await refreshChecklist(true);
      return;
    }

    try {
      const result = await ChecklistApi.completeChecklistOccurrence(
        {
          checklist_id: item.id,
          checklist_title: item.title,
          occurrence_key: nextOccurrence.occurrenceKey,
          completed_at: new Date().toISOString(),
          completed_by: ChecklistState.getActor(state),
          actor: ChecklistState.getActor(state),
          device_id: state.cfg && state.cfg.deviceId ? state.cfg.deviceId : 'device',
        },
        { fetchImpl: state.fetchImpl }
      );
      state.showToast && state.showToast(result && result.alreadyCompleted ? 'Checklist occurrence already completed' : 'Checklist occurrence completed', 'success');
      await refreshChecklist(true);
    } catch (error) {
      if (error && error.status === 409) {
        await refreshChecklist(true);
        state.showToast && state.showToast('Checklist occurrence already completed', 'success');
        return;
      }
      state.showToast && state.showToast(error && error.message ? error.message : 'Checklist completion failed', 'error');
    }
  }

  async function deleteChecklist(id) {
    const runDelete = async function runDelete() {
      try {
        const authHeaders = typeof state.adminHeaders === 'function' ? state.adminHeaders() : {};
        await ChecklistApi.deleteChecklistItem(id, { fetchImpl: state.fetchImpl, headers: authHeaders });
        state.showToast && state.showToast(ChecklistState.t(state, 'checklist.toast.deleted'), 'success');
        await refreshChecklist(true);
      } catch (error) {
        const message = typeof state.adminErrorMessage === 'function' ? state.adminErrorMessage(error) : (error && error.message ? error.message : ChecklistState.t(state, 'checklist.error.delete'));
        state.showToast && state.showToast(message, 'error');
      }
    };

    if (typeof state.showConfirm === 'function') {
      state.showConfirm(ChecklistState.t(state, 'checklist.confirm.delete'), runDelete);
      return;
    }

    if (window.confirm(ChecklistState.t(state, 'checklist.confirm.delete'))) {
      await runDelete();
    }
  }

  async function runManualEvaluation() {
    try {
      const authHeaders = typeof state.adminHeaders === 'function' ? state.adminHeaders() : {};
      const result = await ChecklistApi.evaluateChecklistReminders(
        { lookbackMinutes: 15 },
        { fetchImpl: state.fetchImpl, headers: authHeaders }
      );

      const summary = [
        'due ' + (result.dueOccurrences || 0),
        'reserved ' + (result.reservedOccurrences || 0),
        'duplicate ' + (result.duplicateOccurrences || 0),
        'sent ' + (result.sent || 0),
      ].join(' | ');

      state.showToast && state.showToast(ChecklistState.t(state, 'checklist.toast.evaluate') + ': ' + summary, 'success');
    } catch (error) {
      const message = typeof state.adminErrorMessage === 'function' ? state.adminErrorMessage(error) : (error && error.message ? error.message : ChecklistState.t(state, 'checklist.error.evaluate'));
      state.showToast && state.showToast(message, 'error');
    }
  }

  function renderChecklistScreen(force) {
    ChecklistRender.renderChecklistScreen(state);
    applyUiAccessState();

    if (!state.loaded || force) {
      refreshChecklist(Boolean(force));
    }
  }

  function initChecklistUI(options) {
    if (state.initialized) return;

    state.adminErrorMessage = options.adminErrorMessage || null;
    state.adminHeaders = options.adminHeaders || null;
    state.applyRoleUI = options.applyRoleUI || null;
    state.cfg = options.cfg;
    state.el = options.el;
    state.fetchImpl = options.fetchImpl || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : fetch);
    state.i18n = options.i18n || null;
    state.showConfirm = options.showConfirm || null;
    state.showToast = options.showToast || null;
    state.initialized = true;

    ChecklistEvents.bindChecklistEvents(state, {
      completeChecklist,
      deleteChecklist,
      refreshChecklist,
      runManualEvaluation,
      saveChecklist,
      toggleChecklist,
    });
    ChecklistEvents.localizeStaticFormLabels(state);
    ChecklistEvents.fillForm(state, ChecklistState.getDefaultItem());
  }

  return {
    initChecklistUI,
    renderChecklistScreen,
    refreshChecklist,
  };
});
