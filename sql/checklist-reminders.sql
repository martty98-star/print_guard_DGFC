create table if not exists checklist_tasks (
  id text primary key,
  title text not null,
  description text null,
  enabled boolean not null default true,
  schedule_type text not null default 'weekly',
  days_of_week jsonb not null default '[]'::jsonb,
  time_of_day text not null,
  category text null,
  time_zone text not null default 'Europe/Prague',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text null,
  updated_by text null
);

create index if not exists checklist_tasks_enabled_idx
on checklist_tasks (enabled);

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
);

create index if not exists checklist_state_checklist_date_idx
on checklist_reminder_state (checklist_id, scheduled_local_date desc);

create table if not exists checklist_occurrence_completion (
  occurrence_key text primary key,
  checklist_id text not null references checklist_tasks(id) on delete cascade,
  completed_at timestamptz not null,
  completed_by text null,
  device_id text null,
  created_at timestamptz not null default now()
);
