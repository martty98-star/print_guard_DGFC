drop view if exists v_print_order_pipeline;

create view v_print_order_pipeline as

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
  p.workflow_name,
  p.order_type,
  p.print_files,

  pr.has_pending_reprint,

  case
    when i.external_order_id is not null and p.id is null then 'received_only'
    when i.external_order_id is null and p.id is not null then 'processed_without_received'
    when i.external_order_id is not null and p.id is not null then 'processed'
    else 'unknown'
  end as pipeline_status

from print_orders_received i
full join processed_print_orders p
  on p.order_name = coalesce(i.order_number, i.external_order_id, i.customer_order_id)

left join pending_reprints pr
  on pr.order_id = p.id;