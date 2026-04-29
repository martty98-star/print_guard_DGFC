(function attachChecklistRender(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.PrintGuardChecklistRender = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChecklistRenderModule() {
  'use strict';

  const ChecklistDomain = (typeof window !== 'undefined' && window.checklistDomain) || null;
  const ChecklistState = (typeof window !== 'undefined' && window.PrintGuardChecklistState) || null;

  if (!ChecklistDomain) throw new Error('Missing checklistDomain');
  if (!ChecklistState) throw new Error('Missing PrintGuardChecklistState');

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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

  function getVisibleOccurrence(item) {
    const getOccurrence = ChecklistDomain.getVisibleChecklistOccurrence || ChecklistDomain.getNextChecklistOccurrence;
    return getOccurrence(item);
  }

  function formatOccurrenceLabel(state, occurrenceKey) {
    const raw = String(occurrenceKey || '').trim();
    if (!raw) return '';

    const parts = raw.split(':');
    const scheduleType = parts[0] || '';
    const checklistId = parts[1] || '';
    const localDate = parts[2] || '';
    const localTime = parts.slice(3).join(':') || '';
    const item = ChecklistState.findItemById(state, checklistId);

    const scheduleLabel = scheduleType === 'weekly'
      ? ChecklistState.t(state, 'checklist.schedule.weekly')
      : scheduleType === 'monthly'
        ? ChecklistState.t(state, 'checklist.schedule.monthly')
        : ChecklistState.t(state, 'checklist.occurrence.label');
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

  function getWeekdayLabel(state, dayKey) {
    return ChecklistState.t(state, 'checklist.day.' + dayKey);
  }

  function getScheduleLabel(state, item) {
    if ((item.scheduleType || 'weekly') === 'monthly') {
      return `${ChecklistState.t(state, 'checklist.schedule.monthly')} ${ChecklistState.t(state, 'checklist.schedule.day-prefix')} ${item.dayOfMonth || '?'} Â· ${item.timeOfDay || ''}`;
    }
    const normalizedDays = Array.isArray(item.daysOfWeek) ? item.daysOfWeek : [];
    return `${ChecklistState.t(state, 'checklist.schedule.weekly')} ${normalizedDays.map((day) => getWeekdayLabel(state, day)).join(', ')} Â· ${item.timeOfDay || ''}`;
  }

  function renderChecklistList(state) {
    const host = state.el('checklist-list');
    if (!host) return;

    if (state.loading && !state.loaded) {
      host.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>${escapeHtml(ChecklistState.t(state, 'checklist.loading'))}</p></div>`;
      return;
    }

    if (!state.items.length) {
      host.innerHTML = `<div class="empty-state"><h3>${escapeHtml(ChecklistState.t(state, 'checklist.empty.title'))}</h3><p>${escapeHtml(ChecklistState.t(state, 'checklist.empty.body'))}</p></div>`;
      return;
    }

    host.innerHTML = state.items.map((item) => {
      const nextOccurrence = getVisibleOccurrence(item);
      const isCompleted = Boolean(nextOccurrence && ChecklistState.getCompletedOccurrenceKeys(state).has(nextOccurrence.occurrenceKey));
      const scheduleLabel = getScheduleLabel(state, item);
      const enabledLabel = item.enabled ? ChecklistState.t(state, 'checklist.status.enabled') : ChecklistState.t(state, 'checklist.status.disabled');
      const nextLabel = nextOccurrence
        ? (nextOccurrence.localDate + ' ' + nextOccurrence.localTime)
        : ChecklistState.t(state, 'checklist.next.none');
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
              <button class="btn-sm admin-only" data-action="toggle" data-id="${escapeHtml(item.id)}">${item.enabled ? escapeHtml(ChecklistState.t(state, 'checklist.action.disable')) : escapeHtml(ChecklistState.t(state, 'checklist.action.enable'))}</button>
              <button class="btn-sm" data-action="complete" data-id="${escapeHtml(item.id)}" ${isCompleted ? 'disabled' : ''}>${escapeHtml(completeLabel)}</button>
              <button class="btn-sm admin-only" data-action="edit" data-id="${escapeHtml(item.id)}">${escapeHtml(ChecklistState.t(state, 'btn.edit'))}</button>
              <button class="btn-sm admin-only danger" data-action="delete" data-id="${escapeHtml(item.id)}">${escapeHtml(ChecklistState.t(state, 'btn.delete'))}</button>
            </div>
          </div>
          ${item.description ? `<p class="checklist-description">${escapeHtml(item.description)}</p>` : ''}
          <div class="checklist-detail-row">
            <span>${escapeHtml(ChecklistState.t(state, 'checklist.next.label'))}</span>
            <strong>${escapeHtml(nextLabel)}</strong>
          </div>
        </article>
      `;
    }).join('');
  }

  function renderSummary(state) {
    const total = state.items.length;
    const enabled = state.items.filter((item) => item.enabled).length;
    const disabled = total - enabled;
    const summaryNode = state.el('checklist-summary');
    if (!summaryNode) return;

    summaryNode.innerHTML = `
      <div class="checklist-summary-row">
        <div class="checklist-summary-stat">
          <strong>${total}</strong>
          <span>${escapeHtml(ChecklistState.t(state, 'checklist.summary.total'))}</span>
        </div>
        <div class="checklist-summary-stat">
          <strong>${enabled}</strong>
          <span>${escapeHtml(ChecklistState.t(state, 'checklist.summary.enabled'))}</span>
        </div>
        <div class="checklist-summary-stat">
          <strong>${disabled}</strong>
          <span>${escapeHtml(ChecklistState.t(state, 'checklist.summary.disabled'))}</span>
        </div>
      </div>
    `;
  }

  function renderChecklistLog(state) {
    const host = state.el('checklist-log');
    if (!host) return;

    if (!state.completions.length) {
      host.innerHTML = `<div class="empty-state"><h3>No checklist completions yet</h3><p>Completed occurrences will appear here.</p></div>`;
      return;
    }

    host.innerHTML = `<table class="data-table">
      <thead><tr><th>Task</th><th>Occurrence</th><th>Completed at</th><th>By</th><th>Device</th></tr></thead>
      <tbody>${state.completions.map((row) => `
        <tr>
          <td>${escapeHtml(row.checklistTitle || row.checklistId || '')}</td>
          <td>${escapeHtml(formatOccurrenceLabel(state, row.occurrenceKey || ''))}</td>
          <td>${escapeHtml(formatDate(row.completedAt || ''))}</td>
          <td>${escapeHtml(row.completedBy || '')}</td>
          <td>${escapeHtml(row.deviceId || '')}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  }

  function renderChecklistScreen(state) {
    renderSummary(state);
    renderChecklistList(state);
    renderChecklistLog(state);
  }

  return {
    escapeHtml,
    formatDate,
    formatOccurrenceLabel,
    getScheduleLabel,
    getVisibleOccurrence,
    renderChecklistList,
    renderChecklistLog,
    renderChecklistScreen,
    renderSummary,
  };
});
