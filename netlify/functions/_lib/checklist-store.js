'use strict';

const checklistDomain = require('../../../reports/checklist-domain.js');
let checklistSchemaReady = false;

function cleanOptionalString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function mapChecklistRow(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    enabled: row.enabled !== false,
    daysOfWeek: Array.isArray(row.days_of_week) ? row.days_of_week : [],
    dayOfMonth: row.day_of_month == null ? null : Number(row.day_of_month),
    timeOfDay: row.time_of_day,
    category: row.category,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || ''),
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    scheduleType: row.schedule_type || 'weekly',
    timeZone: row.time_zone || 'Europe/Prague',
  };
}

async function ensureChecklistTables(client) {
  if (checklistSchemaReady) return;

  await client.query(
    `
      create table if not exists checklist_tasks (
        id text primary key,
        title text not null,
        description text null,
        enabled boolean not null default true,
        schedule_type text not null default 'weekly',
        days_of_week jsonb not null default '[]'::jsonb,
        day_of_month integer null,
        time_of_day text not null,
        category text null,
        time_zone text not null default 'Europe/Prague',
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now(),
        created_by text null,
        updated_by text null
      )
    `
  );

  await client.query(
    `
      create table if not exists checklist_reminder_state (
        occurrence_key text primary key,
        checklist_id text not null references checklist_tasks(id) on delete cascade,
        schedule_type text not null,
        time_zone text not null,
        scheduled_local_date date not null,
        scheduled_local_time text not null,
        delivery_status text not null,
        matched_subscriptions integer not null default 0,
        sent_count integer not null default 0,
        failed_count integer not null default 0,
        payload jsonb not null default '{}'::jsonb,
        error text null,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      )
    `
  );

  await client.query(
    `
      create index if not exists checklist_tasks_enabled_idx
      on checklist_tasks (enabled)
    `
  );

  await client.query(
    `
      create index if not exists checklist_state_checklist_date_idx
      on checklist_reminder_state (checklist_id, scheduled_local_date desc)
    `
  );

  await client.query(
    `
      create table if not exists checklist_occurrence_completion (
        occurrence_key text primary key,
        checklist_id text not null references checklist_tasks(id) on delete cascade,
        checklist_title text null,
        completed_at timestamptz not null,
        completed_by text null,
        device_id text null,
        created_at timestamptz not null default now()
      )
    `
  );

  await client.query(
    `alter table if exists checklist_occurrence_completion add column if not exists checklist_title text null`
  );

  await client.query(
    `alter table if exists checklist_tasks add column if not exists day_of_month integer null`
  );

  await client.query(
    `update checklist_tasks set schedule_type = 'weekly' where schedule_type is null or schedule_type = ''`
  );

  await client.query(
    `update checklist_tasks set day_of_month = null where schedule_type <> 'monthly'`
  );

  checklistSchemaReady = true;
}

async function listChecklistItems(client) {
  await ensureChecklistTables(client);
  const result = await client.query(
    `
      select
        id,
        title,
        description,
        enabled,
        schedule_type,
        days_of_week,
        day_of_month,
        time_of_day,
        category,
        time_zone,
        created_at,
        updated_at,
        created_by,
        updated_by
      from checklist_tasks
      order by lower(title) asc, created_at asc
    `
  );

  return result.rows.map(mapChecklistRow);
}

async function saveChecklistItem(client, input, actor) {
  await ensureChecklistTables(client);

  const id = cleanOptionalString(input && input.id);
  const existing = id
    ? (await client.query(
      `
        select
          id,
          title,
          description,
          enabled,
          schedule_type,
          days_of_week,
          day_of_month,
          time_of_day,
          category,
          time_zone,
          created_at,
          updated_at,
          created_by,
          updated_by
        from checklist_tasks
        where id = $1
        limit 1
      `,
      [id]
    )).rows[0]
    : null;

  const normalized = checklistDomain.validateChecklistItemInput({
    ...input,
    id: id || undefined,
    createdAt: existing ? new Date(existing.created_at).toISOString() : input && input.createdAt,
    createdBy: existing ? existing.created_by : actor,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
  });

  await client.query(
    `
      insert into checklist_tasks (
        id,
        title,
        description,
        enabled,
        schedule_type,
        days_of_week,
        day_of_month,
        time_of_day,
        category,
        time_zone,
        created_at,
        updated_at,
        created_by,
        updated_by
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6::jsonb,
        $7,
        $8,
        $9,
        $10,
        $11::timestamptz,
        $12::timestamptz,
        $13,
        $14
      )
      on conflict (id) do update
      set
        title = excluded.title,
        description = excluded.description,
        enabled = excluded.enabled,
        schedule_type = excluded.schedule_type,
        days_of_week = excluded.days_of_week,
        time_of_day = excluded.time_of_day,
        category = excluded.category,
        time_zone = excluded.time_zone,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `,
    [
      normalized.id,
      normalized.title,
      normalized.description,
      normalized.enabled,
      normalized.scheduleType || 'weekly',
      JSON.stringify(normalized.daysOfWeek || []),
      normalized.dayOfMonth || null,
      normalized.timeOfDay,
      normalized.category,
      normalized.timeZone || 'Europe/Prague',
      normalized.createdAt,
      normalized.updatedAt,
      normalized.createdBy,
      normalized.updatedBy,
    ]
  );

  const saved = await client.query(
    `
      select
        id,
        title,
        description,
        enabled,
        schedule_type,
        days_of_week,
        day_of_month,
        time_of_day,
        category,
        time_zone,
        created_at,
        updated_at,
        created_by,
        updated_by
      from checklist_tasks
      where id = $1
      limit 1
    `,
    [normalized.id]
  );

  return mapChecklistRow(saved.rows[0]);
}

async function deleteChecklistItem(client, id) {
  await ensureChecklistTables(client);
  const result = await client.query(
    `
      delete from checklist_tasks
      where id = $1
    `,
    [id]
  );

  return result.rowCount > 0;
}

async function reserveChecklistOccurrence(client, occurrence, payload) {
  await ensureChecklistTables(client);
  const result = await client.query(
    `
      insert into checklist_reminder_state (
        occurrence_key,
        checklist_id,
        schedule_type,
        time_zone,
        scheduled_local_date,
        scheduled_local_time,
        delivery_status,
        matched_subscriptions,
        sent_count,
        failed_count,
        payload,
        error,
        created_at,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        $5::date,
        $6,
        'reserved',
        0,
        0,
        0,
        $7::jsonb,
        null,
        now(),
        now()
      )
      on conflict (occurrence_key) do nothing
    `,
    [
      occurrence.occurrenceKey,
      occurrence.checklistId,
      occurrence.item.scheduleType || 'weekly',
      occurrence.item.timeZone || 'Europe/Prague',
      occurrence.localDate,
      occurrence.localTime,
      JSON.stringify(payload || {}),
    ]
  );

  return result.rowCount > 0;
}

async function finalizeChecklistOccurrence(client, occurrenceKey, result) {
  await ensureChecklistTables(client);
  await client.query(
    `
      update checklist_reminder_state
      set
        delivery_status = $2,
        matched_subscriptions = $3,
        sent_count = $4,
        failed_count = $5,
        payload = $6::jsonb,
        error = $7,
        updated_at = now()
      where occurrence_key = $1
    `,
    [
      occurrenceKey,
      result && result.status ? result.status : 'failed',
      Math.max(0, Number(result && result.matchedSubscriptions) || 0),
      Math.max(0, Number(result && result.sent) || 0),
      Math.max(0, Number(result && result.failed) || 0),
      JSON.stringify((result && result.payload) || {}),
      cleanOptionalString(result && result.error),
    ]
  );
}

async function completeChecklistOccurrence(client, completion) {
  await ensureChecklistTables(client);
  const result = await client.query(
    `
      insert into checklist_occurrence_completion (
        occurrence_key,
        checklist_id,
        checklist_title,
        completed_at,
        completed_by,
        device_id,
        created_at
      )
      values (
        $1,
        $2,
        $3,
        $4::timestamptz,
        $5,
        $6,
        now()
      )
      on conflict (occurrence_key) do nothing
      returning occurrence_key
    `,
    [
      completion.occurrenceKey,
      completion.checklistId,
      cleanOptionalString(completion.checklistTitle),
      completion.completedAt,
      completion.completedBy,
      completion.deviceId,
    ]
  );

  return result.rowCount > 0;
}

async function listChecklistCompletions(client, limit = 50) {
  await ensureChecklistTables(client);
  const result = await client.query(
    `
      select
        c.occurrence_key,
        c.checklist_id,
        coalesce(c.checklist_title, t.title) as checklist_title,
        c.completed_at,
        c.completed_by,
        c.device_id,
        c.created_at
      from checklist_occurrence_completion c
      left join checklist_tasks t on t.id = c.checklist_id
      order by c.completed_at desc, c.created_at desc
      limit $1
    `,
    [Math.max(1, Number(limit) || 50)]
  );

  return result.rows.map((row) => ({
    occurrenceKey: row.occurrence_key,
    checklistId: row.checklist_id,
    checklistTitle: row.checklist_title,
    completedAt: row.completed_at instanceof Date ? row.completed_at.toISOString() : String(row.completed_at || ''),
    completedBy: row.completed_by,
    deviceId: row.device_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || ''),
  }));
}

module.exports = {
  completeChecklistOccurrence,
  deleteChecklistItem,
  ensureChecklistTables,
  finalizeChecklistOccurrence,
  listChecklistItems,
  listChecklistCompletions,
  reserveChecklistOccurrence,
  saveChecklistItem,
};
