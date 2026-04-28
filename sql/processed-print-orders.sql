create table if not exists processed_print_orders (
  id bigserial primary key,
  order_key text not null unique,
  order_name text not null,
  xml_file_name text null,
  guid text null,
  status text null,
  order_date_time timestamptz null,
  queued_date_time timestamptz null,
  printer_name text null,
  run_workflow boolean null,
  workflow_name text null,
  order_type text null,
  print_files jsonb not null default '[]'::jsonb,
  source_xml_path text not null,
  source_xml_hash text not null,
  source_month text null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists processed_print_orders_guid_idx
  on processed_print_orders (guid)
  where guid is not null;

create index if not exists processed_print_orders_queued_idx
  on processed_print_orders (queued_date_time desc nulls last, id desc);

create index if not exists processed_print_orders_source_month_idx
  on processed_print_orders (source_month);

create table if not exists processed_order_reprint_requests (
  id bigserial primary key,
  order_id bigint not null references processed_print_orders(id) on delete cascade,
  order_name text not null,
  print_file_path text null,
  requested_by text null,
  requested_at timestamptz not null default now(),
  workstation_id text null,
  status text not null default 'pending',
  note text null
);

create index if not exists processed_reprint_order_idx
  on processed_order_reprint_requests (order_id, requested_at desc);
