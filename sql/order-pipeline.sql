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
processed_normal as (
  select p.*
  from processed_print_orders p
  where upper(coalesce(p.order_type, 'S')) <> 'R'
    and coalesce(p.ignored, false) = false
),
processed_reprints as (
  select distinct on (coalesce(nullif(source_xml_path, ''), nullif(xml_file_name, ''), id::text))
    p.*,
    coalesce(
      nullif(regexp_replace(regexp_replace(lower(coalesce(p.order_name, '')), '([[:space:]_-]*reprint.*)$', '', 'i'), '[[:space:]_-]+', '', 'g'), ''),
      nullif(regexp_replace(regexp_replace(lower(coalesce(p.xml_file_name, '')), '([[:space:]_-]*reprint.*|\.xml)$', '', 'i'), '[[:space:]_-]+', '', 'g'), '')
    ) as parent_match_key
  from processed_print_orders p
  where upper(coalesce(p.order_type, 'S')) = 'R'
    and coalesce(p.ignored, false) = false
  order by coalesce(nullif(source_xml_path, ''), nullif(xml_file_name, ''), id::text),
    queued_date_time desc nulls last,
    updated_at desc,
    id desc
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
    from processed_normal p
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
  from processed_normal p
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
),
pipeline_with_reprints as (
  select
    pr.*,
    coalesce(rr.reprint_record_count, 0) as reprint_record_count,
    coalesce(rr.reprint_records, '[]'::jsonb) as reprint_records,
    rr.latest_reprint_record_at
  from pipeline_rows pr
  left join lateral (
    select
      count(*)::int as reprint_record_count,
      max(rp.queued_date_time) as latest_reprint_record_at,
      jsonb_agg(
        jsonb_build_object(
          'id', rp.id,
          'orderName', rp.order_name,
          'xmlFileName', rp.xml_file_name,
          'status', rp.status,
          'orderType', 'R',
          'processedAt', rp.queued_date_time,
          'queuedDateTime', rp.queued_date_time,
          'sourceXmlPath', rp.source_xml_path,
          'printFiles', rp.print_files,
          'isFullReprint', jsonb_array_length(coalesce(rp.print_files, '[]'::jsonb)) > 1
        )
        order by rp.queued_date_time desc nulls last, rp.id desc
      ) as reprint_records
    from processed_reprints rp
    where rp.parent_match_key = any(array_remove(array[
      regexp_replace(lower(coalesce(pr.order_number, '')), '[[:space:]_-]+', '', 'g'),
      regexp_replace(lower(coalesce(pr.processed_order_name, '')), '[[:space:]_-]+', '', 'g'),
      regexp_replace(lower(coalesce(pr.external_order_id, '')), '[[:space:]_-]+', '', 'g'),
      regexp_replace(lower(coalesce(pr.customer_order_id, '')), '[[:space:]_-]+', '', 'g')
    ], ''))
    or exists (
      select 1
      from jsonb_array_elements(coalesce(pr.print_files, '[]'::jsonb)) parent_file
      join jsonb_array_elements(coalesce(rp.print_files, '[]'::jsonb)) reprint_file
        on lower(coalesce(parent_file->>'printFilePath', '')) = lower(coalesce(reprint_file->>'printFilePath', ''))
        or regexp_replace(lower(regexp_replace(coalesce(parent_file->>'printFilePath', ''), '^.*[\\/]', '')), '[[:space:]_-]+', '', 'g')
          = regexp_replace(lower(regexp_replace(coalesce(reprint_file->>'printFilePath', ''), '^.*[\\/]', '')), '[[:space:]_-]+', '', 'g')
      where coalesce(parent_file->>'printFilePath', '') <> ''
    )
  ) rr on true
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
  pr.reprint_record_count,
  pr.reprint_records,
  pr.latest_reprint_record_at,
  coalesce(r.reprint_request_count, 0) as reprint_request_count,
  coalesce(r.reprint_pending_count, 0) as reprint_pending_count,
  coalesce(r.reprint_completed_count, 0) as reprint_completed_count,
  r.latest_reprint_status,
  coalesce(r.reprint_pending_count, 0) > 0 as reprint_pending,
  false as is_reprint_record,
  case
    when coalesce(r.reprint_pending_count, 0) > 0 then 'reprint_pending'
    when pr.external_order_id is not null and pr.processed_order_id is not null then 'processed'
    when pr.external_order_id is not null and pr.processed_order_id is null then 'received_only'
    when pr.external_order_id is null and pr.processed_order_id is not null then 'processed_without_received'
    else 'received_only'
  end as pipeline_status
from pipeline_with_reprints pr
left join reprint_summary r on r.order_id = pr.processed_order_id;
