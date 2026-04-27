-- Indexes matched to current Netlify function query patterns.
-- Apply during a low-traffic window. CONCURRENTLY is intentionally not used so
-- this file can run inside simple migration runners that wrap statements.

create index if not exists pg_movements_article_number_idx
  on public.pg_movements (article_number);

create index if not exists pg_movements_timestamp_idx
  on public.pg_movements (timestamp);

create index if not exists pg_co_records_machine_timestamp_idx
  on public.pg_co_records (machine_id, timestamp);

create index if not exists print_accounting_rows_ready_at_idx
  on public.print_accounting_rows (ready_at desc);

create index if not exists print_accounting_rows_reception_at_idx
  on public.print_accounting_rows (reception_at desc);

create index if not exists print_accounting_rows_printer_ready_at_idx
  on public.print_accounting_rows (printer_name, ready_at desc);

create index if not exists print_accounting_rows_row_type_ready_at_idx
  on public.print_accounting_rows (row_type, ready_at desc);

create index if not exists print_accounting_rows_result_ready_at_idx
  on public.print_accounting_rows (result, ready_at desc);

create index if not exists print_accounting_rows_job_id_idx
  on public.print_accounting_rows (job_id)
  where job_id is not null;

create index if not exists print_accounting_rows_source_file_idx
  on public.print_accounting_rows (source_file)
  where source_file is not null;

create index if not exists print_orders_received_list_idx
  on public.print_orders_received ((coalesce(received_at, api_seen_at)) desc, id desc);

create index if not exists push_subscriptions_active_idx
  on public.push_subscriptions (is_active)
  where is_active = true;

create index if not exists push_notification_state_category_active_idx
  on public.push_notification_state (category, is_active);

create index if not exists checklist_completion_completed_at_idx
  on public.checklist_occurrence_completion (completed_at desc, created_at desc);
