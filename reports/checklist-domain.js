(function attachChecklistDomain(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  root.checklistDomain = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function createChecklistDomain() {
  'use strict';

  const WEEKDAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const WEEKDAY_LABELS_CS = {
    mon: 'Po',
    tue: '\u00dat',
    wed: 'St',
    thu: '\u010ct',
    fri: 'P\u00e1',
    sat: 'So',
    sun: 'Ne',
  };

  function cleanOptionalString(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  function normalizeChecklistDayOfMonth(value) {
    const raw = Number(value);
    if (!Number.isInteger(raw) || raw < 1 || raw > 31) return null;
    return raw;
  }

  function createChecklistId(prefix) {
    const safePrefix = prefix || 'chk';
    return `${safePrefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function normalizeChecklistLookupKey(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function normalizeChecklistWeekday(value) {
    const raw = normalizeChecklistLookupKey(value);
    const aliases = {
      mon: 'mon',
      monday: 'mon',
      mo: 'mon',
      pondeli: 'mon',
      tue: 'tue',
      tuesday: 'tue',
      tu: 'tue',
      ut: 'tue',
      utery: 'tue',
      wed: 'wed',
      wednesday: 'wed',
      we: 'wed',
      st: 'wed',
      streda: 'wed',
      thu: 'thu',
      thursday: 'thu',
      th: 'thu',
      ct: 'thu',
      ctvrtek: 'thu',
      fri: 'fri',
      friday: 'fri',
      fr: 'fri',
      pa: 'fri',
      patek: 'fri',
      sat: 'sat',
      saturday: 'sat',
      sa: 'sat',
      sobota: 'sat',
      so: 'sat',
      sun: 'sun',
      sunday: 'sun',
      su: 'sun',
      ne: 'sun',
      nedele: 'sun',
    };
    return aliases[raw] || null;
  }

  function normalizeChecklistDaysOfWeek(value) {
    const input = Array.isArray(value) ? value : [];
    const normalized = input
      .map((item) => normalizeChecklistWeekday(item))
      .filter(Boolean);
    return WEEKDAY_ORDER.filter((day) => normalized.includes(day));
  }

  function normalizeChecklistTimeOfDay(value) {
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      return null;
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  function parseChecklistTimeOfDay(value) {
    const normalized = normalizeChecklistTimeOfDay(value);
    if (!normalized) return null;
    const parts = normalized.split(':').map(Number);
    return { hour: parts[0], minute: parts[1] };
  }

  function validateChecklistItemInput(input, now) {
    const current = now instanceof Date ? now : new Date(now || Date.now());
    const title = cleanOptionalString(input && input.title);
    if (!title) throw new Error('Checklist title is required');

    const scheduleType = String(input && input.scheduleType || '').trim().toLowerCase() === 'monthly' ? 'monthly' : 'weekly';
    const daysOfWeek = normalizeChecklistDaysOfWeek(input && input.daysOfWeek);
    const dayOfMonth = normalizeChecklistDayOfMonth(input && input.dayOfMonth);
    if (scheduleType === 'weekly' && !daysOfWeek.length) throw new Error('Checklist requires at least one day of week');
    if (scheduleType === 'monthly' && !dayOfMonth) throw new Error('Checklist requires a valid day of month');

    const timeOfDay = normalizeChecklistTimeOfDay(input && input.timeOfDay);
    if (!timeOfDay) throw new Error('Checklist requires a valid time of day');

    return {
      id: cleanOptionalString(input && input.id) || createChecklistId(),
      title,
      description: cleanOptionalString(input && input.description),
      enabled: input && input.enabled !== false,
      daysOfWeek,
      dayOfMonth,
      timeOfDay,
      category: cleanOptionalString(input && input.category),
      createdAt: cleanOptionalString(input && input.createdAt) || current.toISOString(),
      updatedAt: cleanOptionalString(input && input.updatedAt) || current.toISOString(),
      createdBy: cleanOptionalString(input && input.createdBy),
      updatedBy: cleanOptionalString(input && input.updatedBy),
      scheduleType,
      timeZone: cleanOptionalString(input && input.timeZone) || 'Europe/Prague',
    };
  }

  function getChecklistZonedParts(input, timeZone) {
    const zone = timeZone || 'Europe/Prague';
    const date = input instanceof Date ? input : new Date(input);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const get = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      hour: get('hour'),
      minute: get('minute'),
      second: get('second'),
    };
  }

  function getChecklistLocalDateKey(input, timeZone) {
    const parts = getChecklistZonedParts(input, timeZone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }

  function getChecklistLocalWeekday(dateKey) {
    const parts = String(dateKey || '').split('-').map(Number);
    const utcDay = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay();
    const mapping = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return mapping[utcDay];
  }

  function addChecklistLocalDays(dateKey, offsetDays) {
    const parts = String(dateKey || '').split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + offsetDays));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
  }

  function getChecklistPseudoEpochMs(dateKey, timeOfDay) {
    const parts = String(dateKey || '').split('-').map(Number);
    const time = parseChecklistTimeOfDay(timeOfDay);
    if (!time) throw new Error(`Invalid checklist time: ${timeOfDay}`);
    return Date.UTC(parts[0], parts[1] - 1, parts[2], time.hour, time.minute, 0, 0);
  }

  function buildChecklistOccurrenceKey(item, localDate, timeOfDay) {
    const id = typeof item === 'string' ? item : item.id;
    const scheduleType = typeof item === 'string' ? 'weekly' : item.scheduleType || 'weekly';
    return `${scheduleType}:${id}:${localDate}:${timeOfDay}`;
  }

  function getNextChecklistOccurrence(item, options) {
    const normalized = validateChecklistItemInput(item, new Date());
    const timeZone = (options && options.timeZone) || normalized.timeZone || 'Europe/Prague';
    const now = options && options.now ? new Date(options.now) : new Date();
    const nowDateKey = getChecklistLocalDateKey(now, timeZone);
    const nowParts = getChecklistZonedParts(now, timeZone);
    const nowPseudo = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute, nowParts.second, 0);

    for (let offset = 0; offset < 8; offset += 1) {
      const candidateDate = addChecklistLocalDays(nowDateKey, offset);
      const weekday = getChecklistLocalWeekday(candidateDate);
      const dayOfMonth = Number(candidateDate.split('-')[2]);
      if (normalized.scheduleType === 'weekly' && !normalized.daysOfWeek.includes(weekday)) continue;
      if (normalized.scheduleType === 'monthly' && normalized.dayOfMonth !== dayOfMonth) continue;
      const candidatePseudo = getChecklistPseudoEpochMs(candidateDate, normalized.timeOfDay);
      if (candidatePseudo < nowPseudo) continue;
      return {
        occurrenceKey: buildChecklistOccurrenceKey(normalized, candidateDate, normalized.timeOfDay),
        checklistId: normalized.id,
        item: normalized,
        localDate: candidateDate,
        localTime: normalized.timeOfDay,
        localWeekday: weekday,
        pseudoEpochMs: candidatePseudo,
      };
    }

    return null;
  }

  function getVisibleChecklistOccurrence(item, options) {
    const normalized = validateChecklistItemInput(item, new Date());
    const timeZone = (options && options.timeZone) || normalized.timeZone || 'Europe/Prague';
    const now = options && options.now ? new Date(options.now) : new Date();
    const today = getChecklistLocalDateKey(now, timeZone);
    const weekday = getChecklistLocalWeekday(today);
    const dayOfMonth = Number(today.split('-')[2]);
    const occursToday = normalized.scheduleType === 'weekly'
      ? normalized.daysOfWeek.includes(weekday)
      : normalized.dayOfMonth === dayOfMonth;

    if (occursToday) {
      return {
        occurrenceKey: buildChecklistOccurrenceKey(normalized, today, normalized.timeOfDay),
        checklistId: normalized.id,
        item: normalized,
        localDate: today,
        localTime: normalized.timeOfDay,
        localWeekday: weekday,
        pseudoEpochMs: getChecklistPseudoEpochMs(today, normalized.timeOfDay),
      };
    }

    return getNextChecklistOccurrence(normalized, options);
  }

  function evaluateDueChecklistOccurrences(items, options) {
    const now = options && options.now ? new Date(options.now) : new Date();
    const lookbackMinutes = Math.max(1, Number(options && options.lookbackMinutes) || 15);
    const occurrences = [];

    for (const rawItem of items || []) {
      const item = validateChecklistItemInput(rawItem, now);
      if (!item.enabled || (item.scheduleType !== 'weekly' && item.scheduleType !== 'monthly')) continue;

      const itemTimeZone = item.timeZone || (options && options.timeZone) || 'Europe/Prague';
      const nowParts = getChecklistZonedParts(now, itemTimeZone);
      const nowDateKey = getChecklistLocalDateKey(now, itemTimeZone);
      const nowPseudo = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute, nowParts.second, 0);
      const windowStartPseudo = nowPseudo - lookbackMinutes * 60 * 1000;
      const candidateDates = item.scheduleType === 'monthly'
        ? [nowDateKey, addChecklistLocalDays(nowDateKey, -1)]
        : [addChecklistLocalDays(nowDateKey, -1), nowDateKey];

      for (const localDate of candidateDates) {
        const weekday = getChecklistLocalWeekday(localDate);
        const dayOfMonth = Number(localDate.split('-')[2]);
        if (item.scheduleType === 'weekly' && !item.daysOfWeek.includes(weekday)) continue;
        if (item.scheduleType === 'monthly' && item.dayOfMonth !== dayOfMonth) continue;
        const occurrencePseudo = getChecklistPseudoEpochMs(localDate, item.timeOfDay);
        if (occurrencePseudo > nowPseudo || occurrencePseudo < windowStartPseudo) continue;
        occurrences.push({
          occurrenceKey: buildChecklistOccurrenceKey(item, localDate, item.timeOfDay),
          checklistId: item.id,
          item,
          localDate,
          localTime: item.timeOfDay,
          localWeekday: weekday,
          pseudoEpochMs: occurrencePseudo,
        });
      }
    }

    occurrences.sort((a, b) => a.pseudoEpochMs - b.pseudoEpochMs || a.item.title.localeCompare(b.item.title));
    return occurrences;
  }

  function buildChecklistReminderEvent(occurrence, url) {
    const targetUrl = url || '/?mode=stock&screen=checklist';
    const title = `Checklist \u00b7 ${occurrence.item.title}`;
    const body = occurrence.item.description
      ? occurrence.item.description
      : `Je \u010das na \u00fakol "${occurrence.item.title}" (${occurrence.localTime}).`;

    return {
      type: 'checklist.reminder.due',
      category: 'checklist',
      dedupeKey: occurrence.occurrenceKey,
      title,
      body,
      url: targetUrl,
      metadata: {
        checklistId: occurrence.checklistId,
        localDate: occurrence.localDate,
        localTime: occurrence.localTime,
        timeZone: occurrence.item.timeZone,
        category: occurrence.item.category,
      },
    };
  }

  function formatChecklistScheduleLabel(item) {
    const normalized = validateChecklistItemInput(item, new Date());
    if (normalized.scheduleType === 'monthly') {
      return 'Každý měsíc dne ' + (normalized.dayOfMonth || '?') + ' · ' + normalized.timeOfDay;
    }
    const dayLabel = normalized.daysOfWeek.map((day) => WEEKDAY_LABELS_CS[day]).join(', ');
    return dayLabel + ' · ' + normalized.timeOfDay;
  }

  return {
    WEEKDAY_ORDER,
    addChecklistLocalDays,
    buildChecklistOccurrenceKey,
    buildChecklistReminderEvent,
    createChecklistId,
    evaluateDueChecklistOccurrences,
    formatChecklistScheduleLabel,
    getChecklistLocalDateKey,
    getChecklistLocalWeekday,
    getChecklistPseudoEpochMs,
    getChecklistZonedParts,
    getNextChecklistOccurrence,
    getVisibleChecklistOccurrence,
    normalizeChecklistDaysOfWeek,
    normalizeChecklistTimeOfDay,
    normalizeChecklistWeekday,
    parseChecklistTimeOfDay,
    validateChecklistItemInput,
  };
});
