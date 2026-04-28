drop view if exists v_print_order_pipeline;

create view v_print_order_pipeline as
with pending_reprints as (
  select
    order_id,
    true as has_pending_reprint
  from processed_order_reprint_requests
  where status = 'pending'
  group by order_id
),
incoming_pipeline as (
  select
    i.order_number,
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
    p.source_month
  from print_orders_received i
  left join lateral (
    select p.*
    from processed_print_orders p
    where p.order_name = any(array_remove(array[
      i.order_number,
      i.external_order_id,
      i.customer_order_id
    ], null))
    order by case
      when p.order_name = i.order_number then 1
      when p.order_name = i.external_order_id then 2
      when p.order_name = i.customer_order_id then 3
      else 4
    end, p.queued_date_time desc nulls last, p.id desc
    limit 1
  ) p on true
),
processed_orphans as (
  select
    p.order_name as order_number,
    null::text as external_order_id,
    null::text as customer_order_id,
    null::timestamptz as received_at,
    null::timestamptz as api_seen_at,
    p.id as processed_order_id,
    p.order_name as processed_order_name,
    p.xml_file_name,
    p.queued_date_time as processed_at,
    p.queued_date_time,
    p.workflow_name,
    p.order_type,
    p.print_files,
    p.source_xml_path,
    p.source_month
  from processed_print_orders p
  where not exists (
    select 1
    from print_orders_received i
    where p.order_name = any(array_remove(array[
      i.order_number,
      i.external_order_id,
      i.customer_order_id
    ], null))
  )
),
pipeline_rows as (
  select * from incoming_pipeline
  union all
  select * from processed_orphans
)
select
  coalesce(pr.order_number, pr.processed_order_name) as order_number,
  pr.external_order_id,
  pr.customer_order_id,
  pr.received_at,
  pr.api_seen_at,
  pr.processed_order_id,
  pr.processed_order_name,
  pr.xml_file_name,
  pr.processed_at,
  pr.queued_date_time,
  pr.workflow_name,
  pr.order_type,
  pr.print_files,
  pr.source_xml_path,
  pr.source_month,
  coalesce(r.has_pending_reprint, false) as reprint_pending,
  case
    when coalesce(r.has_pending_reprint, false) then 'reprint_pending'
    when pr.external_order_id is not null and pr.processed_order_id is not null then 'processed'
    when pr.external_order_id is not null and pr.processed_order_id is null then 'received_only'
    when pr.external_order_id is null and pr.processed_order_id is not null then 'processed_without_received'
    else 'received_only'
  end as pipeline_status
from pipeline_rows pr
left join pending_reprints r
  on r.order_id = pr.processed_order_id;
