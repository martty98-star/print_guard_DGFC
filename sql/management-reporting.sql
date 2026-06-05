-- PrintGuard management reporting support.
-- Safe to run repeatedly.

create table if not exists public.reporting_stock_monthly_snapshots (
  snapshot_month date not null,
  article_number text not null,
  item_name text null,
  category text null,
  stock_type text null,
  unit text null,
  on_hand numeric null,
  media_stock_m2 numeric null,
  ink_stock_l numeric null,
  media_type text null,
  printer text null,
  snapshot_at timestamptz not null default now(),
  source text not null default 'manual_or_scheduled',
  primary key (snapshot_month, article_number)
);

create or replace view public.v_reporting_monthly_stock_snapshot as
select
  to_char(snapshot_month, 'YYYY-MM') as month,
  article_number,
  item_name,
  category,
  stock_type,
  unit,
  on_hand,
  media_stock_m2 as media_stock_m2_end_of_month,
  ink_stock_l as ink_stock_l_end_of_month,
  media_type,
  printer,
  snapshot_at,
  source
from public.reporting_stock_monthly_snapshots;

create or replace view public.v_reporting_monthly_consumption as
select
  to_char(date_trunc('month', coalesce(ready_at::date, source_date)::timestamp), 'YYYY-MM') as month,
  printer_name as printer,
  coalesce(nullif(media_type, ''), 'Unknown media') as media_type,
  count(*) filter (where lower(coalesce(result, '')) = 'done')::int as done_jobs,
  coalesce(sum(printed_area::numeric / 1000000.0) filter (where lower(coalesce(result, '')) = 'done'), 0) as total_consumed_media_m2_including_reprints,
  coalesce(sum(media_length_used::numeric / 10000.0) filter (where lower(coalesce(result, '')) = 'done'), 0) as total_consumed_media_length_m,
  coalesce(sum(
    (coalesce(ink_cyan, 0) + coalesce(ink_magenta, 0) + coalesce(ink_yellow, 0) + coalesce(ink_black, 0) + coalesce(ink_white, 0))::numeric / 1000000.0
  ) filter (where lower(coalesce(result, '')) = 'done'), 0) as total_consumed_ink_l_including_reprints,
  coalesce(sum(active_time_sec) filter (where lower(coalesce(result, '')) = 'done'), 0)::bigint as nett_printing_time_sec
from public.print_accounting_rows
where row_type is null or lower(row_type) = 'print'
group by 1, 2, 3;

create or replace view public.v_reporting_monthly_reprints as
select
  to_char(date_trunc('month', coalesce(queued_date_time, imported_at) at time zone 'Europe/Prague'), 'YYYY-MM') as month,
  coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where left(upper(coalesce(order_type, 'S')), 1) <> 'R'), 0)::int as standard_file_count,
  coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where left(upper(coalesce(order_type, 'S')), 1) = 'R'), 0)::int as reprinted_file_count,
  (
    coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where left(upper(coalesce(order_type, 'S')), 1) = 'R'), 0)::numeric
    / nullif(coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where left(upper(coalesce(order_type, 'S')), 1) <> 'R'), 0), 0)
  ) as reprinted_files_per_standard_file
from public.processed_print_orders
where coalesce(ignored, false) = false
group by 1;

create or replace view public.v_reporting_monthly_files_per_order as
with file_counts as (
  select
    to_char(date_trunc('month', coalesce(queued_date_time, imported_at) at time zone 'Europe/Prague'), 'YYYY-MM') as month,
    count(*)::int as total_xml_count,
    coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))), 0)::int as total_files,
    coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where left(upper(coalesce(order_type, 'S')), 1) <> 'R'), 0)::int as standard_files,
    coalesce(sum(jsonb_array_length(coalesce(print_files, '[]'::jsonb))) filter (where left(upper(coalesce(order_type, 'S')), 1) = 'R'), 0)::int as reprint_files
  from public.processed_print_orders
  where coalesce(ignored, false) = false
  group by 1
),
sales_orders as (
  select
    to_char(date_trunc('month', coalesce(received_at, api_seen_at) at time zone 'Europe/Prague'), 'YYYY-MM') as month,
    count(distinct coalesce(nullif(order_number, ''), nullif(external_order_id, ''), nullif(customer_order_id, '')))::int as total_sales_orders
  from public.print_orders_received
  where coalesce(ignored, false) = false
  group by 1
)
select
  coalesce(f.month, s.month) as month,
  coalesce(f.total_xml_count, 0) as total_xml_count,
  coalesce(f.total_files, 0) as total_files,
  coalesce(f.standard_files, 0) as standard_files,
  coalesce(f.reprint_files, 0) as reprint_files,
  coalesce(s.total_sales_orders, 0) as total_sales_orders,
  coalesce(f.total_files, 0)::numeric / nullif(s.total_sales_orders, 0) as avg_files_per_sales_order,
  coalesce(f.total_files, 0)::numeric / nullif(f.total_xml_count, 0) as avg_files_per_xml
from file_counts f
full outer join sales_orders s on s.month = f.month;

create or replace view public.v_reporting_eod_printing_time as
select
  coalesce(ready_at::date, source_date) as report_date,
  printer_name as printer,
  coalesce(nullif(media_type, ''), 'Unknown media') as media_type,
  count(*) filter (where lower(coalesce(result, '')) = 'done')::int as done_jobs,
  coalesce(sum(active_time_sec) filter (where lower(coalesce(result, '')) = 'done'), 0)::bigint as total_nett_printing_time_sec,
  coalesce(sum(duration_sec) filter (where lower(coalesce(result, '')) = 'done'), 0)::bigint as gross_elapsed_time_sec,
  coalesce(sum(printed_area::numeric / 1000000.0) filter (where lower(coalesce(result, '')) = 'done'), 0) as consumed_media_m2,
  coalesce(sum(
    (coalesce(ink_cyan, 0) + coalesce(ink_magenta, 0) + coalesce(ink_yellow, 0) + coalesce(ink_black, 0) + coalesce(ink_white, 0))::numeric / 1000000.0
  ) filter (where lower(coalesce(result, '')) = 'done'), 0) as consumed_ink_l
from public.print_accounting_rows
where row_type is null or lower(row_type) = 'print'
group by 1, 2, 3;

create or replace view public.v_reporting_eod_summary as
select
  report_date,
  sum(done_jobs)::int as done_jobs,
  sum(total_nett_printing_time_sec)::bigint as total_nett_printing_time_sec,
  sum(total_nett_printing_time_sec)::numeric / 60.0 as total_nett_printing_time_minutes,
  sum(total_nett_printing_time_sec)::numeric / 3600.0 as total_nett_printing_time_hours,
  sum(gross_elapsed_time_sec)::numeric / 3600.0 as gross_elapsed_time_hours,
  sum(consumed_media_m2) as consumed_media_m2,
  sum(consumed_ink_l) as consumed_ink_l
from public.v_reporting_eod_printing_time
group by report_date;
