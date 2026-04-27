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
  created_at timestamptz not null default now()
);

create index if not exists print_lifecycle_events_order_idx
  on print_lifecycle_events (source, order_identifier, event_at desc);
