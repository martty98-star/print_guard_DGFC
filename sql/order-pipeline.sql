drop view if exists v_print_order_pipeline;

create view v_print_order_pipeline as
with reprint_summary as (
  select
    order_id,
    count(*)::int as reprint_request_count,
    count(*) filter (where status = 'pending')::int as reprint_pending_count,
    count(*) filter (where status in ('completed', 'resolved', 'done'))::int as reprint_completed_count,
    (array_agg(status order by requested_at desc, id desc))[1] as latest_reprint_status
  from processed_order_reprint_requests
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
  coalesce(r.reprint_request_count, 0) as reprint_request_count,
  coalesce(r.reprint_pending_count, 0) as reprint_pending_count,
  coalesce(r.reprint_completed_count, 0) as reprint_completed_count,
  r.latest_reprint_status,
  coalesce(r.reprint_pending_count, 0) > 0 as reprint_pending,
  case
    when coalesce(r.reprint_pending_count, 0) > 0 then 'reprint_pending'
    when pr.external_order_id is not null and pr.processed_order_id is not null then 'processed'
    when pr.external_order_id is not null and pr.processed_order_id is null then 'received_only'
    when pr.external_order_id is null and pr.processed_order_id is not null then 'processed_without_received'
    else 'received_only'
  end as pipeline_status
from pipeline_rows pr
left join reprint_summary r
  on r.order_id = pr.processed_order_id;
