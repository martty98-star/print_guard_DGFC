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

