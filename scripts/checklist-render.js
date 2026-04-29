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

  function parseOccurrenceKey(occurrenceKey) {
    const raw = String(occurrenceKey || '').trim();
    const parts = raw.split(':');
    return {
      scheduleType: parts[0] || '',
      checklistId: parts[1] || '',
      localDate: parts[2] || '',
      localTime: parts.slice(3).join(':') || '',
    };
  }

  function dateKeyToUtcMidday(dateKey) {
    const parts = String(dateKey || '').split('-').map(Number);
    if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) return null;
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0));
  }

  function getCurrentLocalDateKey(state) {
    const timeZone = (state.items && state.items[0] && state.items[0].timeZone) || 'Europe/Prague';
    return ChecklistDomain.getChecklistLocalDateKey(new Date(), timeZone);
  }

  function getFilterRange(state, filter) {
    const today = getCurrentLocalDateKey(state);
    const nowZone = (state.items && state.items[0] && state.items[0].timeZone) || 'Europe/Prague';
    const currentDay = ChecklistDomain.getChecklistLocalWeekday(today);

    if (filter === 'today' || filter === 'only_missing') {
      return { start: today, end: today };
    }

    if (filter === 'this_week') {
      let start = today;
      while (ChecklistDomain.getChecklistLocalWeekday(start) !== 'mon') {
        start = ChecklistDomain.addChecklistLocalDays(start, -1);
      }
      return { start, end: today };
    }

    if (filter === 'this_month') {
      return { start: today.slice(0, 8) + '01', end: today };
    }

    return { start: null, end: null };
  }

  function getFilterLabel(filter) {
    const labels = {
      today: 'Today',
      this_week: 'This week',
      this_month: 'This month',
      only_missing: 'Only missing',
      all: 'All',
    };
    return labels[filter] || 'All';
  }

  function isDateInRange(dateKey, range) {
    if (!range.start || !range.end) return true;
    return String(dateKey || '') >= range.start && String(dateKey || '') <= range.end;
  }

  function buildLogEntries(state, range, onlyMissing) {
    const completedKeys = ChecklistState.getCompletedOccurrenceKeys(state);
    const byDay = new Map();
    const summaryByChecklist = new Map();
    const today = getCurrentLocalDateKey(state);

    if (!onlyMissing) {
      (state.completions || []).forEach((row) => {
        const parsed = parseOccurrenceKey(row.occurrenceKey);
        if (!parsed.localDate || !isDateInRange(parsed.localDate, range)) return;
        const entry = {
          type: 'completed',
          localDate: parsed.localDate,
          localTime: parsed.localTime || '',
          checklistId: parsed.checklistId || row.checklistId || '',
          title: row.checklistTitle || row.checklistId || '',
          completedBy: row.completedBy || '',
          completedAt: row.completedAt || '',
          note: '',
        };
        if (!byDay.has(entry.localDate)) byDay.set(entry.localDate, []);
        byDay.get(entry.localDate).push(entry);

        const summaryKey = entry.checklistId || entry.title;
        if (!summaryByChecklist.has(summaryKey)) {
          summaryByChecklist.set(summaryKey, { title: entry.title, completed: 0, expected: 0 });
        }
        summaryByChecklist.get(summaryKey).completed += 1;
      });
    }

    (state.items || []).forEach((item) => {
      const visible = getVisibleOccurrence(item);
      if (!visible || visible.localDate !== today) return;
      if (completedKeys.has(visible.occurrenceKey)) return;
      if (onlyMissing === false && !isDateInRange(visible.localDate, range)) return;
      if (onlyMissing && visible.localDate !== today) return;

      const entry = {
        type: 'missing',
        localDate: visible.localDate,
        localTime: visible.localTime || '',
        checklistId: item.id,
        title: item.title || '',
        completedBy: '',
        completedAt: '',
        note: 'Not completed today',
      };
      if (!byDay.has(entry.localDate)) byDay.set(entry.localDate, []);
      byDay.get(entry.localDate).push(entry);

      const summaryKey = item.id || item.title;
      if (!summaryByChecklist.has(summaryKey)) {
        summaryByChecklist.set(summaryKey, { title: item.title || '', completed: 0, expected: 0 });
      }
      summaryByChecklist.get(summaryKey).expected += 1;
    });

    for (const [title, summary] of summaryByChecklist.entries()) {
      if (summary.completed > summary.expected) {
        summary.expected = summary.completed;
      }
    }

    const groupedDays = Array.from(byDay.entries())
      .filter(([dateKey]) => isDateInRange(dateKey, range))
      .map(([dateKey, entries]) => ({
        dateKey,
        entries: entries.slice().sort((a, b) => String(a.localTime || '').localeCompare(String(b.localTime || '')) || a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

    const summaries = Array.from(summaryByChecklist.values())
      .sort((a, b) => a.title.localeCompare(b.title));

    return { groupedDays, summaries };
  }

  function renderChecklistLogCards(entries, esc) {
    return entries.map((entry) => {
      const isMissing = entry.type === 'missing';
      return `<article class="checklist-completion-card ${isMissing ? 'is-missing' : ''}">
        <div class="checklist-completion-task">${esc(entry.title || '-')}</div>
        <div class="checklist-completion-meta">
          <span>${esc(isMissing ? 'Not completed today' : (entry.completedBy || '-'))}</span>
          <span>${esc(isMissing ? (entry.localTime ? `Due ${entry.localTime}` : 'Due today') : formatDate(entry.completedAt || ''))}</span>
        </div>
      </article>`;
    }).join('');
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

    const filter = state.checklistLogFilter || 'all';
    state.checklistLogFilter = filter;
    const range = getFilterRange(state, filter);
    const onlyMissing = filter === 'only_missing';
    const model = buildLogEntries(state, range, onlyMissing);
    const hasEntries = model.groupedDays.length > 0;

    if (!state.items.length && !state.completions.length) {
      host.innerHTML = `<div class="empty-state"><h3>No checklist completions yet</h3><p>Completed occurrences will appear here.</p></div>`;
      return;
    }

    host.innerHTML = `
      <div class="checklist-log-summary">
        <div class="checklist-log-summary-head">
          <strong>Summary</strong>
          <span>${escapeHtml(getFilterLabel(filter))}</span>
        </div>
        <div class="checklist-log-summary-list">
          ${model.summaries.length ? model.summaries.map((item) => `
            <div class="checklist-log-summary-item">
              <span>${escapeHtml(item.title || '-')}</span>
              <strong>${escapeHtml(String(item.completed || 0))}/${escapeHtml(String(item.expected || 0))}</strong>
            </div>
          `).join('') : '<div class="checklist-log-summary-empty">No summary data</div>'}
        </div>
      </div>
      <div class="checklist-log-filters">
        ${['today', 'this_week', 'this_month', 'all', 'only_missing'].map((key) => `<button class="checklist-log-filter ${filter === key ? 'active' : ''}" type="button" data-checklist-log-filter="${escapeHtml(key)}">${escapeHtml(getFilterLabel(key))}</button>`).join('')}
      </div>
      ${hasEntries ? `<div class="checklist-log-days">
        ${model.groupedDays.map((group) => `
          <section class="checklist-log-day">
            <div class="checklist-log-day-header">${escapeHtml(group.dateKey.split('-').reverse().join('.'))}</div>
            <div class="checklist-completion-list">
              ${renderChecklistLogCards(group.entries, escapeHtml)}
            </div>
          </section>
        `).join('')}
      </div>` : `<div class="empty-state"><h3>No checklist completions yet</h3><p>Completed occurrences will appear here.</p></div>`}
    `;

    host.querySelectorAll('[data-checklist-log-filter]').forEach((button) => {
      button.addEventListener('click', () => {
        state.checklistLogFilter = button.dataset.checklistLogFilter || 'all';
        renderChecklistLog(state);
      });
    });
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
