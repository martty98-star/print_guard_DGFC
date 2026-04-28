create or replace view v_print_order_pipeline as
with pending_reprints as (
  select
    order_id,
    true as has_pending_reprint
  from processed_order_reprint_requests
  where status = 'pending'
  group by order_id
)
select
  coalesce(i.order_number, p.order_name) as order_number,
  i.external_order_id,
  i.customer_order_id,
  i.received_at,
  i.api_seen_at,
  p.id as processed_order_id,
  p.order_name as processed_order_name,
  p.xml_file_name,
  p.queued_date_time as processed_at,
  p.queued_date_time,
  p.workflow_name,
  p.order_type,
  p.print_files,
  p.source_xml_path,
  p.source_month,
  coalesce(r.has_pending_reprint, false) as reprint_pending,
  case
    when coalesce(r.has_pending_reprint, false) then 'reprint_pending'
    when i.external_order_id is not null and p.id is not null then 'processed'
    when i.external_order_id is not null and p.id is null then 'received_only'
    when i.external_order_id is null and p.id is not null then 'processed_without_received'
    else 'received_only'
  end as pipeline_status
from print_orders_received i
full join processed_print_orders p
  on p.order_name = i.order_number
  or p.order_name = i.external_order_id
  or p.order_name = i.customer_order_id
left join pending_reprints r on r.order_id = p.id;
