-- Latest committed label scans.
select
  scan_id,
  scanned_at,
  barcode,
  order_number,
  station,
  operator,
  commit_batch_id,
  match_status,
  matched_processed_order_id,
  matched_order_name,
  match_reason
from public.print_job_label_scans
order by committed_at desc nulls last, scanned_at desc
limit 50;

-- Unmatched or ambiguous scans for operator diagnosis.
select
  scan_id,
  scanned_at,
  barcode,
  order_number,
  station,
  operator,
  match_status,
  match_reason
from public.print_job_label_scans
where match_status in ('unmatched', 'ambiguous', 'error')
order by scanned_at desc
limit 100;

-- Processed orders marked as physically printed.
select
  id,
  order_name,
  physically_printed_at,
  physically_printed_by,
  physically_printed_station,
  physically_printed_scan_id,
  physically_printed_batch_id
from public.processed_print_orders
where physically_printed_at is not null
order by physically_printed_at desc
limit 50;

-- Latest operator commit batches.
select
  batch_id,
  committed_at,
  committed_by,
  station,
  scan_count,
  matched_count,
  unmatched_count,
  duplicate_count,
  error_count,
  source
from public.print_scan_commit_batches
order by committed_at desc
limit 50;
