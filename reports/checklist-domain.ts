export type ChecklistScheduleType = 'weekly';

export type ChecklistWeekdayKey =
  | 'mon'
  | 'tue'
  | 'wed'
  | 'thu'
  | 'fri'
  | 'sat'
  | 'sun';

export interface ChecklistItemInput {
  id?: string | null;
  title?: string | null;
  description?: string | null;
  enabled?: boolean | null;
  daysOfWeek?: string[] | null;
  timeOfDay?: string | null;
  category?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  scheduleType?: string | null;
  timeZone?: string | null;
}

export interface ChecklistItem {
  id: string;
  title: string;
  description: string | null;
  enabled: boolean;
  daysOfWeek: ChecklistWeekdayKey[];
  timeOfDay: string;
  category: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
  scheduleType: ChecklistScheduleType;
  timeZone: string;
}

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface ChecklistOccurrence {
  occurrenceKey: string;
  checklistId: string;
  item: ChecklistItem;
  localDate: string;
  localTime: string;
  localWeekday: ChecklistWeekdayKey;
  pseudoEpochMs: number;
}

export interface ReminderEvent {
  type: 'checklist.reminder.due';
  category: 'checklist';
  dedupeKey: string;
  title: string;
  body: string;
  url: string;
  metadata: {
    checklistId: string;
    localDate: string;
    localTime: string;
    timeZone: string;
    category: string | null;
  };
}

export interface DueEvaluationOptions {
  timeZone?: string;
  lookbackMinutes?: number;
  now?: Date | string | number;
}

const WEEKDAY_ORDER: ChecklistWeekdayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const WEEKDAY_LABELS_CS: Record<ChecklistWeekdayKey, string> = {
  mon: 'Po',
  tue: 'Út',
  wed: 'St',
  thu: 'Čt',
  fri: 'Pá',
  sat: 'So',
  sun: 'Ne',
};

function cleanOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function createChecklistId(prefix = 'chk'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeChecklistWeekday(value: unknown): ChecklistWeekdayKey | null {
  const raw = String(value || '').trim().toLowerCase();
  const aliases: Record<string, ChecklistWeekdayKey> = {
    mon: 'mon',
    monday: 'mon',
    mo: 'mon',
    pondeli: 'mon',
    pondělí: 'mon',
    tue: 'tue',
    tuesday: 'tue',
    tu: 'tue',
    ut: 'tue',
    út: 'tue',
    utery: 'tue',
    úterý: 'tue',
    wed: 'wed',
    wednesday: 'wed',
    we: 'wed',
    st: 'wed',
    streda: 'wed',
    středa: 'wed',
    thu: 'thu',
    thursday: 'thu',
    th: 'thu',
    ct: 'thu',
    čt: 'thu',
    ctvrtek: 'thu',
    čtvrtek: 'thu',
    fri: 'fri',
    friday: 'fri',
    fr: 'fri',
    pa: 'fri',
    pá: 'fri',
    patek: 'fri',
    pátek: 'fri',
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
    neděle: 'sun',
  };
  return aliases[raw] || null;
}

export function normalizeChecklistDaysOfWeek(value: unknown): ChecklistWeekdayKey[] {
  const input = Array.isArray(value) ? value : [];
  const normalized = input
    .map((item) => normalizeChecklistWeekday(item))
    .filter((item): item is ChecklistWeekdayKey => Boolean(item));
  return WEEKDAY_ORDER.filter((day) => normalized.includes(day));
}

export function normalizeChecklistTimeOfDay(value: unknown): string | null {
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

export function parseChecklistTimeOfDay(value: string): { hour: number; minute: number } | null {
  const normalized = normalizeChecklistTimeOfDay(value);
  if (!normalized) return null;
  const [hour, minute] = normalized.split(':').map(Number);
  return { hour, minute };
}

export function validateChecklistItemInput(input: ChecklistItemInput, now = new Date()): ChecklistItem {
  const title = cleanOptionalString(input?.title);
  if (!title) throw new Error('Checklist title is required');

  const daysOfWeek = normalizeChecklistDaysOfWeek(input?.daysOfWeek);
  if (!daysOfWeek.length) throw new Error('Checklist requires at least one day of week');

  const timeOfDay = normalizeChecklistTimeOfDay(input?.timeOfDay);
  if (!timeOfDay) throw new Error('Checklist requires a valid time of day');

  const createdAt = cleanOptionalString(input?.createdAt) || now.toISOString();
  const updatedAt = cleanOptionalString(input?.updatedAt) || now.toISOString();

  return {
    id: cleanOptionalString(input?.id) || createChecklistId(),
    title,
    description: cleanOptionalString(input?.description),
    enabled: input?.enabled !== false,
    daysOfWeek,
    timeOfDay,
    category: cleanOptionalString(input?.category),
    createdAt,
    updatedAt,
    createdBy: cleanOptionalString(input?.createdBy),
    updatedBy: cleanOptionalString(input?.updatedBy),
    scheduleType: 'weekly',
    timeZone: cleanOptionalString(input?.timeZone) || 'Europe/Prague',
  };
}

export function getChecklistZonedParts(input: Date | string | number, timeZone = 'Europe/Prague'): ZonedDateParts {
  const date = input instanceof Date ? input : new Date(input);
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

export function getChecklistLocalDateKey(input: Date | string | number, timeZone = 'Europe/Prague'): string {
  const parts = getChecklistZonedParts(input, timeZone);
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function getChecklistLocalWeekday(dateKey: string): ChecklistWeekdayKey {
  const [year, month, day] = dateKey.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const mapping: ChecklistWeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  return mapping[utcDay];
}

export function addChecklistLocalDays(dateKey: string, offsetDays: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offsetDays));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function getChecklistPseudoEpochMs(dateKey: string, timeOfDay: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  const time = parseChecklistTimeOfDay(timeOfDay);
  if (!time) throw new Error(`Invalid checklist time: ${timeOfDay}`);
  return Date.UTC(year, month - 1, day, time.hour, time.minute, 0, 0);
}

export function buildChecklistOccurrenceKey(item: ChecklistItem | string, localDate: string, timeOfDay: string): string {
  const id = typeof item === 'string' ? item : item.id;
  return `weekly:${id}:${localDate}:${timeOfDay}`;
}

export function getNextChecklistOccurrence(item: ChecklistItemInput, options?: DueEvaluationOptions): ChecklistOccurrence | null {
  const normalized = validateChecklistItemInput(item, new Date());
  const timeZone = options?.timeZone || normalized.timeZone || 'Europe/Prague';
  const now = options?.now ? new Date(options.now) : new Date();
  const nowDateKey = getChecklistLocalDateKey(now, timeZone);
  const nowParts = getChecklistZonedParts(now, timeZone);
  const nowPseudo = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute, nowParts.second, 0);

  for (let offset = 0; offset < 8; offset += 1) {
    const candidateDate = addChecklistLocalDays(nowDateKey, offset);
    const weekday = getChecklistLocalWeekday(candidateDate);
    if (!normalized.daysOfWeek.includes(weekday)) continue;
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

export function evaluateDueChecklistOccurrences(items: ChecklistItemInput[], options?: DueEvaluationOptions): ChecklistOccurrence[] {
  const now = options?.now ? new Date(options.now) : new Date();
  const lookbackMinutes = Math.max(1, Number(options?.lookbackMinutes) || 15);
  const occurrences: ChecklistOccurrence[] = [];

  for (const rawItem of items || []) {
    const item = validateChecklistItemInput(rawItem, now);
    if (!item.enabled || item.scheduleType !== 'weekly') continue;

    const itemTimeZone = item.timeZone || options?.timeZone || 'Europe/Prague';
    const nowParts = getChecklistZonedParts(now, itemTimeZone);
    const nowDateKey = getChecklistLocalDateKey(now, itemTimeZone);
    const nowPseudo = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day, nowParts.hour, nowParts.minute, nowParts.second, 0);
    const windowStartPseudo = nowPseudo - lookbackMinutes * 60 * 1000;
    const candidateDates = [addChecklistLocalDays(nowDateKey, -1), nowDateKey];

    for (const localDate of candidateDates) {
      const weekday = getChecklistLocalWeekday(localDate);
      if (!item.daysOfWeek.includes(weekday)) continue;
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

export function buildChecklistReminderEvent(occurrence: ChecklistOccurrence, url = '/?mode=stock&screen=checklist'): ReminderEvent {
  const title = `Checklist · ${occurrence.item.title}`;
  const body = occurrence.item.description
    ? occurrence.item.description
    : `Je čas na úkol "${occurrence.item.title}" (${occurrence.localTime}).`;

  return {
    type: 'checklist.reminder.due',
    category: 'checklist',
    dedupeKey: occurrence.occurrenceKey,
    title,
    body,
    url,
    metadata: {
      checklistId: occurrence.checklistId,
      localDate: occurrence.localDate,
      localTime: occurrence.localTime,
      timeZone: occurrence.item.timeZone,
      category: occurrence.item.category,
    },
  };
}

export function formatChecklistScheduleLabel(item: ChecklistItemInput): string {
  const normalized = validateChecklistItemInput(item, new Date());
  const dayLabel = normalized.daysOfWeek.map((day) => WEEKDAY_LABELS_CS[day]).join(', ');
  return `${dayLabel} · ${normalized.timeOfDay}`;
}
