create table if not exists print_orders_received (
  id bigserial primary key,
  external_order_id text not null unique,
  order_number text null,
  customer_order_id text null,
  status text null,
  source_payload jsonb not null,
  received_at timestamptz null,
  api_seen_at timestamptz not null default now(),
  submit_tool_processed_at timestamptz null,
  onyx_seen_at timestamptz null,
  colorado_printed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists print_orders_received_status_idx
  on print_orders_received (status);

create index if not exists print_orders_received_received_at_idx
  on print_orders_received (received_at desc nulls last);
