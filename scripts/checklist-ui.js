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

  if (!ChecklistApi) throw new Error('Missing PrintGuardChecklistApi');
  if (!ChecklistDomain) throw new Error('Missing checklistDomain');

  const WEEKDAY_OPTIONS = [
    { key: 'mon', label: 'Po' },
    { key: 'tue', label: 'Ut' },
    { key: 'wed', label: 'St' },
    { key: 'thu', label: 'Ct' },
    { key: 'fri', label: 'Pa' },
    { key: 'sat', label: 'So' },
    { key: 'sun', label: 'Ne' },
  ];

  const state = {
    applyRoleUI: null,
    cfg: null,
    el: null,
    fetchImpl: null,
    i18n: null,
    initialized: false,
    items: [],
    completions: [],
    loaded: false,
    loading: false,
    editingItemId: null,
    showConfirm: null,
    showToast: null,
  };

  function isAdmin() {
    return Boolean(state.cfg && state.cfg.role === 'admin');
  }

  function getActor() {
    const userName = state.cfg && state.cfg.userName ? String(state.cfg.userName).trim() : '';
    if (userName) {
      return userName;
    }
    const deviceId = state.cfg && state.cfg.deviceId ? state.cfg.deviceId : 'device';
    const role = state.cfg && state.cfg.role ? state.cfg.role : 'operator';
    return role + ':' + deviceId;
  }

  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat('cs-CZ', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }

  function formatOccurrenceLabel(occurrenceKey) {
    const raw = String(occurrenceKey || '').trim();
    if (!raw) return '';

    const parts = raw.split(':');
    const scheduleType = parts[0] || '';
    const checklistId = parts[1] || '';
    const localDate = parts[2] || '';
    const localTime = parts.slice(3).join(':') || '';
    const item = findItemById(checklistId);

    const scheduleLabel = scheduleType === 'weekly'
      ? t('checklist.schedule.weekly')
      : scheduleType === 'monthly'
        ? t('checklist.schedule.monthly')
        : t('checklist.occurrence.label');
    const title = item && item.title ? item.title : checklistId;
    const datePart = localDate ? localDate.split('-').reverse().join('.') : '';
    const timePart = localTime || '';
    const fragments = [scheduleLabel, title];
    if (datePart && timePart) {
      fragments.push(datePart + ' ' + timePart);
    } else if (datePart) {
      fragments.push(datePart);
    } else if (localDate || timePart) {
      fragments.push([localDate, timePart].filter(Boolean).join(' '));
    }
    return fragments.filter(Boolean).join(' · ');
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function t(key) {
    if (typeof state.i18n === 'function') {
      return state.i18n(key);
    }
    return key;
  }

  function getDefaultItem() {
    return {
      title: '',
      description: '',
      enabled: true,
      scheduleType: 'weekly',
      daysOfWeek: ['mon', 'tue', 'wed', 'thu', 'fri'],
      dayOfMonth: null,
      timeOfDay: '08:00',
      category: 'maintenance',
      timeZone: 'Europe/Prague',
    };
  }

  function findItemById(id) {
    return state.items.find((item) => item.id === id) || null;
  }

  function getVisibleOccurrence(item) {
    const getOccurrence = ChecklistDomain.getVisibleChecklistOccurrence || ChecklistDomain.getNextChecklistOccurrence;
    return getOccurrence(item);
  }

  function getCompletedOccurrenceKeys() {
    return new Set((state.completions || []).map((row) => String(row.occurrenceKey || '').trim()).filter(Boolean));
  }

  function getEditingItem() {
    return findItemById(state.editingItemId) || null;
  }

  function setStatus(text) {
    const node = state.el('checklist-status-text');
    if (node) {
      node.textContent = text;
    }
  }

  function getWeekdayLabel(dayKey) {
    return t('checklist.day.' + dayKey);
  }

  function getScheduleLabel(item) {
    if ((item.scheduleType || 'weekly') === 'monthly') {
      return `${t('checklist.schedule.monthly')} ${t('checklist.schedule.day-prefix')} ${item.dayOfMonth || '?'} Â· ${item.timeOfDay || ''}`;
    }
    const normalizedDays = Array.isArray(item.daysOfWeek) ? item.daysOfWeek : [];
    return `${t('checklist.schedule.weekly')} ${normalizedDays.map(getWeekdayLabel).join(', ')} Â· ${item.timeOfDay || ''}`;
  }

  function getFormPayload() {
    const daysOfWeek = WEEKDAY_OPTIONS
      .filter((day) => {
        const input = state.el('checklist-day-' + day.key);
        return Boolean(input && input.checked);
      })
      .map((day) => day.key);

    return {
      id: state.editingItemId || undefined,
      title: state.el('checklist-title')?.value || '',
      description: state.el('checklist-description')?.value || '',
      enabled: Boolean(state.el('checklist-enabled')?.checked),
      scheduleType: state.el('checklist-schedule-type')?.value || 'weekly',
      daysOfWeek,
      dayOfMonth: state.el('checklist-day-of-month')?.value ? Number(state.el('checklist-day-of-month').value) : null,
      timeOfDay: state.el('checklist-time')?.value || '',
      category: state.el('checklist-category')?.value || '',
      timeZone: 'Europe/Prague',
      actor: getActor(),
    };
  }

  function fillForm(item) {
    const normalized = item || getDefaultItem();

    if (state.el('checklist-title')) state.el('checklist-title').value = normalized.title || '';
    if (state.el('checklist-description')) state.el('checklist-description').value = normalized.description || '';
    if (state.el('checklist-enabled')) state.el('checklist-enabled').checked = normalized.enabled !== false;
    if (state.el('checklist-schedule-type')) state.el('checklist-schedule-type').value = normalized.scheduleType || 'weekly';
    if (state.el('checklist-time')) state.el('checklist-time').value = normalized.timeOfDay || '08:00';
    if (state.el('checklist-category')) state.el('checklist-category').value = normalized.category || '';
    if (state.el('checklist-day-of-month')) state.el('checklist-day-of-month').value = normalized.dayOfMonth || '';
    const dayWrap = state.el('checklist-day-of-month-wrap');
    if (dayWrap) dayWrap.classList.toggle('hidden', (normalized.scheduleType || 'weekly') !== 'monthly');
    const daysWrap = state.el('checklist-days-wrap');
    if (daysWrap) daysWrap.classList.toggle('hidden', (normalized.scheduleType || 'weekly') === 'monthly');

    const days = Array.isArray(normalized.daysOfWeek) ? normalized.daysOfWeek : [];
    WEEKDAY_OPTIONS.forEach((day) => {
      const input = state.el('checklist-day-' + day.key);
      if (input) {
        input.checked = days.includes(day.key);
      }
    });
  }

  function openForm(item) {
    if (!isAdmin()) {
      return;
    }

    state.editingItemId = item && item.id ? item.id : null;
    fillForm(item || getDefaultItem());
    state.el('checklist-form-card')?.classList.remove('hidden');
    state.el('checklist-form-title') && (state.el('checklist-form-title').textContent = item ? t('checklist.form.edit') : t('checklist.form.new'));
  }

  function closeForm() {
    state.editingItemId = null;
    state.el('checklist-form-card')?.classList.add('hidden');
    fillForm(getDefaultItem());
  }

  function renderChecklistList() {
    const host = state.el('checklist-list');
    if (!host) {
      return;
    }

    if (state.loading && !state.loaded) {
      host.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${escapeHtml(t('checklist.loading'))}</p></div>`;
      return;
    }

    if (!state.items.length) {
      host.innerHTML = `<div class="empty-state"><h3>${escapeHtml(t('checklist.empty.title'))}</h3><p>${escapeHtml(t('checklist.empty.body'))}</p></div>`;
      return;
    }

    host.innerHTML = state.items.map((item) => {
      const nextOccurrence = getVisibleOccurrence(item);
      const isCompleted = Boolean(nextOccurrence && getCompletedOccurrenceKeys().has(nextOccurrence.occurrenceKey));
      const scheduleLabel = getScheduleLabel(item);
      const enabledLabel = item.enabled ? t('checklist.status.enabled') : t('checklist.status.disabled');
      const nextLabel = nextOccurrence
        ? (nextOccurrence.localDate + ' ' + nextOccurrence.localTime)
        : t('checklist.next.none');
      const completeLabel = isCompleted ? 'Completed' : 'Complete';

      return `
        <article class="checklist-item-card ${item.enabled ? '' : 'is-disabled'} ${isCompleted ? 'is-completed' : ''}">
          <div class="checklist-item-head">
            <div>
              <h3>${escapeHtml(item.title)}</h3>
              <div class="checklist-meta-row">
                <span class="checklist-pill">${escapeHtml(enabledLabel)}</span>
                ${item.category ? `<span class="checklist-pill">${escapeHtml(item.category)}</span>` : ''}
                <span class="checklist-pill">${escapeHtml(scheduleLabel)}</span>
              </div>
            </div>
            <div class="checklist-item-actions">
              <button class="btn-sm admin-only" data-action="toggle" data-id="${escapeHtml(item.id)}">${item.enabled ? escapeHtml(t('checklist.action.disable')) : escapeHtml(t('checklist.action.enable'))}</button>
              <button class="btn-sm" data-action="complete" data-id="${escapeHtml(item.id)}" ${isCompleted ? 'disabled' : ''}>${escapeHtml(completeLabel)}</button>
              <button class="btn-sm admin-only" data-action="edit" data-id="${escapeHtml(item.id)}">${escapeHtml(t('btn.edit'))}</button>
              <button class="btn-sm admin-only danger" data-action="delete" data-id="${escapeHtml(item.id)}">${escapeHtml(t('btn.delete'))}</button>
            </div>
          </div>
          ${item.description ? `<p class="checklist-description">${escapeHtml(item.description)}</p>` : ''}
          <div class="checklist-detail-row">
            <span>${escapeHtml(t('checklist.next.label'))}</span>
            <strong>${escapeHtml(nextLabel)}</strong>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderSummary() {
    const total = state.items.length;
    const enabled = state.items.filter((item) => item.enabled).length;
    const disabled = total - enabled;
    const summaryNode = state.el('checklist-summary');
    if (!summaryNode) {
      return;
    }

    summaryNode.innerHTML = `
      <div class="checklist-summary-row">
        <div class="checklist-summary-stat">
          <strong>${total}</strong>
          <span>${escapeHtml(t('checklist.summary.total'))}</span>
        </div>
        <div class="checklist-summary-stat">
          <strong>${enabled}</strong>
          <span>${escapeHtml(t('checklist.summary.enabled'))}</span>
        </div>
        <div class="checklist-summary-stat">
          <strong>${disabled}</strong>
          <span>${escapeHtml(t('checklist.summary.disabled'))}</span>
        </div>
      </div>
    `;
  }

  function renderChecklistLog() {
    const host = state.el('checklist-log');
    if (!host) {
      return;
    }

    if (!state.completions.length) {
      host.innerHTML = `<div class="empty-state"><h3>No checklist completions yet</h3><p>Completed occurrences will appear here.</p></div>`;
      return;
    }

    host.innerHTML = `<table class="data-table">
      <thead><tr><th>Task</th><th>Occurrence</th><th>Completed at</th><th>By</th><th>Device</th></tr></thead>
      <tbody>${state.completions.map((row) => `
        <tr>
          <td>${escapeHtml(row.checklistTitle || row.checklistId || '')}</td>
          <td>${escapeHtml(formatOccurrenceLabel(row.occurrenceKey || ''))}</td>
          <td>${escapeHtml(formatDate(row.completedAt || ''))}</td>
          <td>${escapeHtml(row.completedBy || '')}</td>
          <td>${escapeHtml(row.deviceId || '')}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }

  function applyUiAccessState() {
    if (typeof state.applyRoleUI === 'function') {
      state.applyRoleUI();
    }
  }

  async function refreshChecklist(force) {
    if (state.loading) {
      return;
    }

    if (state.loaded && !force) {
      renderChecklistScreen();
      return;
    }

    state.loading = true;
    setStatus(t('checklist.loading'));
    renderChecklistList();

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
      setStatus(t('checklist.status.ready'));
    } catch (error) {
      setStatus(t('checklist.status.load-error'));
      state.showToast && state.showToast(error && error.message ? error.message : t('checklist.error.load'), 'error');
    } finally {
      state.loading = false;
      renderChecklistScreen();
    }
  }

  async function saveChecklist() {
    try {
      const authHeaders = typeof state.adminHeaders === 'function' ? state.adminHeaders() : {};
      const payload = getFormPayload();
      const requestBody = {
        ...payload,
        actor: getActor(),
      };

      if (payload.id) {
        await ChecklistApi.updateChecklistItem(requestBody, { fetchImpl: state.fetchImpl, headers: authHeaders });
      } else {
        await ChecklistApi.createChecklistItem(requestBody, { fetchImpl: state.fetchImpl, headers: authHeaders });
      }

      closeForm();
      state.showToast && state.showToast(t('checklist.toast.saved'), 'success');
      await refreshChecklist(true);
    } catch (error) {
      const message = typeof state.adminErrorMessage === 'function' ? state.adminErrorMessage(error) : (error && error.message ? error.message : t('checklist.error.save'));
      state.showToast && state.showToast(message, 'error');
    }
  }

  async function toggleChecklist(id) {
    const item = findItemById(id);
    if (!item) {
      return;
    }

    try {
      const authHeaders = typeof state.adminHeaders === 'function' ? state.adminHeaders() : {};
      await ChecklistApi.updateChecklistItem(
        {
          ...item,
          enabled: !item.enabled,
          actor: getActor(),
        },
        { fetchImpl: state.fetchImpl, headers: authHeaders }
      );
      state.showToast && state.showToast(t('checklist.toast.updated'), 'success');
      await refreshChecklist(true);
    } catch (error) {
      const message = typeof state.adminErrorMessage === 'function' ? state.adminErrorMessage(error) : (error && error.message ? error.message : t('checklist.error.update'));
      state.showToast && state.showToast(message, 'error');
    }
  }

  async function completeChecklist(item) {
    const nextOccurrence = getVisibleOccurrence(item);
    if (!nextOccurrence) return;
    if (getCompletedOccurrenceKeys().has(nextOccurrence.occurrenceKey)) {
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
          completed_by: getActor(),
          actor: getActor(),
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
        state.showToast && state.showToast(t('checklist.toast.deleted'), 'success');
        await refreshChecklist(true);
      } catch (error) {
        const message = typeof state.adminErrorMessage === 'function' ? state.adminErrorMessage(error) : (error && error.message ? error.message : t('checklist.error.delete'));
        state.showToast && state.showToast(message, 'error');
      }
    };

    if (typeof state.showConfirm === 'function') {
      state.showConfirm(t('checklist.confirm.delete'), runDelete);
      return;
    }

    if (window.confirm(t('checklist.confirm.delete'))) {
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

      state.showToast && state.showToast(t('checklist.toast.evaluate') + ': ' + summary, 'success');
    } catch (error) {
      const message = typeof state.adminErrorMessage === 'function' ? state.adminErrorMessage(error) : (error && error.message ? error.message : t('checklist.error.evaluate'));
      state.showToast && state.showToast(message, 'error');
    }
  }

  function handleListClick(event) {
    const button = event.target && event.target.closest ? event.target.closest('[data-action][data-id]') : null;
    if (!button) {
      return;
    }

    const id = button.getAttribute('data-id');
    const action = button.getAttribute('data-action');
    const item = findItemById(id);

    if (!item) {
      return;
    }

    if (action === 'edit') {
      openForm(item);
      return;
    }

    if (action === 'toggle') {
      toggleChecklist(id);
      return;
    }

    if (action === 'complete') {
      completeChecklist(item);
      return;
    }

    if (action === 'delete') {
      deleteChecklist(id);
    }
  }

  function renderChecklistScreen(force) {
    renderSummary();
    renderChecklistList();
    renderChecklistLog();
    applyUiAccessState();

    if (!state.loaded || force) {
      refreshChecklist(Boolean(force));
    }
  }

  function initChecklistUI(options) {
    if (state.initialized) {
      return;
    }

    state.applyRoleUI = options.applyRoleUI || null;
    state.cfg = options.cfg;
    state.el = options.el;
    state.fetchImpl = options.fetchImpl || (typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : fetch);
    state.i18n = options.i18n || null;
    state.showConfirm = options.showConfirm || null;
    state.showToast = options.showToast || null;
    state.initialized = true;

    state.el('checklist-refresh-btn')?.addEventListener('click', function onRefresh() {
      refreshChecklist(true);
    });
    state.el('checklist-run-btn')?.addEventListener('click', function onRun() {
      runManualEvaluation();
    });
    state.el('checklist-new-btn')?.addEventListener('click', function onNew() {
      openForm(null);
    });
    state.el('checklist-cancel-btn')?.addEventListener('click', function onCancel() {
      closeForm();
    });
    state.el('checklist-save-btn')?.addEventListener('click', function onSave() {
      saveChecklist();
    });
    state.el('checklist-list')?.addEventListener('click', handleListClick);
    state.el('checklist-schedule-type')?.addEventListener('change', function onScheduleTypeChange() {
      fillForm(getEditingItem() || getDefaultItem());
    });

    const scheduleGroupLabel = state.el('checklist-schedule-type')?.closest('.form-group')?.querySelector('label');
    if (scheduleGroupLabel) scheduleGroupLabel.textContent = t('checklist.form.schedule');
    const scheduleSelect = state.el('checklist-schedule-type');
    if (scheduleSelect && scheduleSelect.options.length >= 2) {
      scheduleSelect.options[0].textContent = t('checklist.form.schedule.weekly');
      scheduleSelect.options[1].textContent = t('checklist.form.schedule.monthly');
    }
    const dayOfMonthLabel = state.el('checklist-day-of-month')?.closest('.form-group')?.querySelector('label');
    if (dayOfMonthLabel) dayOfMonthLabel.textContent = t('checklist.form.day-of-month');

    fillForm(getDefaultItem());
  }

  return {
    initChecklistUI,
    renderChecklistScreen,
    refreshChecklist,
  };
});

