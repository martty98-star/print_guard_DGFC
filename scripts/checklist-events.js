(function attachChecklistEvents(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.PrintGuardChecklistEvents = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChecklistEventsModule() {
  'use strict';

  const ChecklistState = (typeof window !== 'undefined' && window.PrintGuardChecklistState) || null;
  if (!ChecklistState) throw new Error('Missing PrintGuardChecklistState');

  const WEEKDAY_OPTIONS = [
    { key: 'mon', label: 'Po' },
    { key: 'tue', label: 'Ut' },
    { key: 'wed', label: 'St' },
    { key: 'thu', label: 'Ct' },
    { key: 'fri', label: 'Pa' },
    { key: 'sat', label: 'So' },
    { key: 'sun', label: 'Ne' },
  ];

  function getFormPayload(state) {
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
      actor: ChecklistState.getActor(state),
    };
  }

  function fillForm(state, item) {
    const normalized = item || ChecklistState.getDefaultItem();

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
      if (input) input.checked = days.includes(day.key);
    });
  }

  function openForm(state, item) {
    if (!ChecklistState.isAdmin(state)) return;
    state.editingItemId = item && item.id ? item.id : null;
    fillForm(state, item || ChecklistState.getDefaultItem());
    state.el('checklist-form-card')?.classList.remove('hidden');
    state.el('checklist-form-title') && (state.el('checklist-form-title').textContent = item ? ChecklistState.t(state, 'checklist.form.edit') : ChecklistState.t(state, 'checklist.form.new'));
  }

  function closeForm(state) {
    state.editingItemId = null;
    state.el('checklist-form-card')?.classList.add('hidden');
    fillForm(state, ChecklistState.getDefaultItem());
  }

  function bindChecklistEvents(state, handlers) {
    state.el('checklist-refresh-btn')?.addEventListener('click', function onRefresh() {
      handlers.refreshChecklist(true);
    });
    state.el('checklist-run-btn')?.addEventListener('click', function onRun() {
      handlers.runManualEvaluation();
    });
    state.el('checklist-new-btn')?.addEventListener('click', function onNew() {
      openForm(state, null);
    });
    state.el('checklist-cancel-btn')?.addEventListener('click', function onCancel() {
      closeForm(state);
    });
    state.el('checklist-save-btn')?.addEventListener('click', function onSave() {
      handlers.saveChecklist();
    });
    state.el('checklist-list')?.addEventListener('click', function onListClick(event) {
      const button = event.target && event.target.closest ? event.target.closest('[data-action][data-id]') : null;
      if (!button) return;

      const id = button.getAttribute('data-id');
      const action = button.getAttribute('data-action');
      const item = ChecklistState.findItemById(state, id);
      if (!item) return;

      if (action === 'edit') {
        openForm(state, item);
        return;
      }
      if (action === 'toggle') {
        handlers.toggleChecklist(id);
        return;
      }
      if (action === 'complete') {
        handlers.completeChecklist(item);
        return;
      }
      if (action === 'delete') {
        handlers.deleteChecklist(id);
      }
    });
    state.el('checklist-schedule-type')?.addEventListener('change', function onScheduleTypeChange() {
      fillForm(state, ChecklistState.getEditingItem(state) || ChecklistState.getDefaultItem());
    });
  }

  function localizeStaticFormLabels(state) {
    const scheduleGroupLabel = state.el('checklist-schedule-type')?.closest('.form-group')?.querySelector('label');
    if (scheduleGroupLabel) scheduleGroupLabel.textContent = ChecklistState.t(state, 'checklist.form.schedule');
    const scheduleSelect = state.el('checklist-schedule-type');
    if (scheduleSelect && scheduleSelect.options.length >= 2) {
      scheduleSelect.options[0].textContent = ChecklistState.t(state, 'checklist.form.schedule.weekly');
      scheduleSelect.options[1].textContent = ChecklistState.t(state, 'checklist.form.schedule.monthly');
    }
    const dayOfMonthLabel = state.el('checklist-day-of-month')?.closest('.form-group')?.querySelector('label');
    if (dayOfMonthLabel) dayOfMonthLabel.textContent = ChecklistState.t(state, 'checklist.form.day-of-month');
  }

  return {
    bindChecklistEvents,
    closeForm,
    fillForm,
    getFormPayload,
    localizeStaticFormLabels,
    openForm,
  };
});
