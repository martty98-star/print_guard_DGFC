create table if not exists public.print_scan_commit_batches (
  batch_id text primary key,
  committed_at timestamptz not null default now(),
  committed_by text,
  station text,
  scan_count integer not null default 0,
  matched_count integer not null default 0,
  unmatched_count integer not null default 0,
  duplicate_count integer not null default 0,
  error_count integer not null default 0,
  source text not null default 'operator_commit',
  status text not null default 'committed',
  retry_count integer not null default 0,
  updated_at timestamptz not null default now(),
  diagnostics jsonb not null default '{}'::jsonb
);

create table if not exists public.print_job_label_scans (
  scan_id text primary key,
  scanned_at timestamptz not null,
  barcode text not null,
  raw_barcode text,
  order_number text,
  order_type text,
  is_reprint boolean not null default false,
  reprint_kind text,
  station text,
  operator text,
  source text not null default 'job_label_scan',
  commit_batch_id text,
  committed_at timestamptz,
  committed_by text,
  matched_processed_order_id bigint,
  matched_order_name text,
  match_status text not null default 'pending',
  match_reason text,
  ingested_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint print_job_label_scans_match_status_chk
    check (match_status in ('pending', 'matched', 'unmatched', 'ambiguous', 'error'))
);

create index if not exists print_job_label_scans_order_number_idx
  on public.print_job_label_scans (order_number);

create index if not exists print_job_label_scans_scanned_at_desc_idx
  on public.print_job_label_scans (scanned_at desc);

create index if not exists print_job_label_scans_match_status_idx
  on public.print_job_label_scans (match_status);

create index if not exists print_job_label_scans_commit_batch_id_idx
  on public.print_job_label_scans (commit_batch_id);

create index if not exists print_job_label_scans_batch_status_idx
  on public.print_job_label_scans (commit_batch_id, match_status);

alter table public.print_scan_commit_batches
  add column if not exists status text not null default 'committed';

alter table public.print_scan_commit_batches
  add column if not exists retry_count integer not null default 0;

alter table public.print_scan_commit_batches
  add column if not exists updated_at timestamptz not null default now();

alter table public.print_scan_commit_batches
  add column if not exists diagnostics jsonb not null default '{}'::jsonb;

alter table public.print_job_label_scans
  add column if not exists order_type text;

alter table public.print_job_label_scans
  add column if not exists is_reprint boolean not null default false;

alter table public.print_job_label_scans
  add column if not exists reprint_kind text;

alter table public.processed_print_orders
  add column if not exists physically_printed_at timestamptz;

alter table public.processed_print_orders
  add column if not exists physically_printed_by text;

alter table public.processed_print_orders
  add column if not exists physically_printed_station text;

alter table public.processed_print_orders
  add column if not exists physically_printed_scan_id text;

alter table public.processed_print_orders
  add column if not exists physically_printed_batch_id text;

alter table public.processed_order_reprint_requests
  add column if not exists order_type text;

alter table public.processed_order_reprint_requests
  add column if not exists reprint_kind text;

alter table public.processed_order_reprint_requests
  add column if not exists scan_barcode text;

alter table public.processed_order_reprint_requests
  add column if not exists scan_raw_barcode text;

alter table public.processed_order_reprint_requests
  add column if not exists completed_scan_id text;

alter table public.processed_order_reprint_requests
  add column if not exists completed_batch_id text;

create index if not exists processed_reprint_scan_status_idx
  on public.processed_order_reprint_requests (status, order_name, requested_at desc, id desc);
