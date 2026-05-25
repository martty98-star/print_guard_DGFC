-- Optional order pipeline search indexes.
-- Review against production before applying; this task does not apply migrations.

create index if not exists print_orders_received_order_number_idx
  on public.print_orders_received (order_number)
  where order_number is not null;

create index if not exists print_orders_received_external_order_id_idx
  on public.print_orders_received (external_order_id)
  where external_order_id is not null;

create index if not exists print_orders_received_customer_order_id_idx
  on public.print_orders_received (customer_order_id)
  where customer_order_id is not null;

create index if not exists processed_print_orders_order_name_idx
  on public.processed_print_orders (order_name)
  where order_name is not null;

create index if not exists processed_print_orders_xml_file_name_idx
  on public.processed_print_orders (xml_file_name)
  where xml_file_name is not null;

create index if not exists processed_print_orders_order_type_queued_idx
  on public.processed_print_orders ((upper(coalesce(order_type, 'S'))), queued_date_time desc nulls last, id desc);

create index if not exists processed_print_orders_order_name_queued_idx
  on public.processed_print_orders (order_name, queued_date_time desc nulls last, id desc)
  where order_name is not null;

create index if not exists processed_print_orders_active_order_name_queued_idx
  on public.processed_print_orders (order_name, queued_date_time desc nulls last, id desc)
  where order_name is not null
    and coalesce(ignored, false) = false;

create index if not exists print_orders_received_order_match_idx
  on public.print_orders_received (order_number, external_order_id, customer_order_id);

create index if not exists print_orders_received_status_received_idx
  on public.print_orders_received (status, coalesce(received_at, api_seen_at) desc, id desc);

create index if not exists print_orders_received_api_seen_idx
  on public.print_orders_received (api_seen_at desc, id desc);

create index if not exists processed_reprint_status_idx
  on public.processed_order_reprint_requests (status);

create index if not exists processed_reprint_status_order_idx
  on public.processed_order_reprint_requests (status, order_id, requested_at desc);

create index if not exists processed_reprint_order_status_idx
  on public.processed_order_reprint_requests (order_id, status, requested_at desc);

create index if not exists processed_reprint_order_name_idx
  on public.processed_order_reprint_requests (order_name);

create index if not exists processed_reprint_status_requested_idx
  on public.processed_order_reprint_requests (status, requested_at desc, id desc);

-- Optional fuzzy search support. Requires pg_trgm and should be applied during
-- a low-traffic window if broad text search stays slow.
create extension if not exists pg_trgm;

create index if not exists print_orders_received_order_number_trgm_idx
  on public.print_orders_received using gin (order_number gin_trgm_ops)
  where order_number is not null;

create index if not exists print_orders_received_external_order_id_trgm_idx
  on public.print_orders_received using gin (external_order_id gin_trgm_ops)
  where external_order_id is not null;

create index if not exists print_orders_received_customer_order_id_trgm_idx
  on public.print_orders_received using gin (customer_order_id gin_trgm_ops)
  where customer_order_id is not null;

create index if not exists processed_print_orders_order_name_trgm_idx
  on public.processed_print_orders using gin (order_name gin_trgm_ops)
  where order_name is not null;

create index if not exists processed_print_orders_xml_file_name_trgm_idx
  on public.processed_print_orders using gin (xml_file_name gin_trgm_ops)
  where xml_file_name is not null;

create index if not exists processed_print_orders_source_xml_path_trgm_idx
  on public.processed_print_orders using gin (source_xml_path gin_trgm_ops)
  where source_xml_path is not null;
