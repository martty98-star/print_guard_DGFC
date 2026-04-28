create table if not exists print_lifecycle_events (
  id bigserial primary key,
  source text not null,
  source_module text null,
  event_type text not null,
  order_identifier text not null,
  order_number text null,
  matched_external_order_id text null,
  event_status text null,
  event_at timestamptz not null,
  raw_line text not null,
  raw_line_hash text not null unique,
  lifecycle_dedupe_key text null,
  created_at timestamptz not null default now()
);

alter table print_lifecycle_events
  add column if not exists lifecycle_dedupe_key text null;

update print_lifecycle_events
set lifecycle_dedupe_key = concat_ws('|', source, order_identifier, coalesce(event_status, ''), to_char(event_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
where lifecycle_dedupe_key is null;

create index if not exists print_lifecycle_events_order_idx
  on print_lifecycle_events (source, order_identifier, event_at desc);

create unique index if not exists print_lifecycle_events_dedupe_key_idx
  on print_lifecycle_events (lifecycle_dedupe_key)
  where lifecycle_dedupe_key is not null;
