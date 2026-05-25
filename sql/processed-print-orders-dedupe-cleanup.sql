-- Safe Submit Tool processed order dedupe / soft-ignore cleanup.
-- Review row counts in the returned sections before committing this in production.
-- This script does not delete data.

begin;

create extension if not exists pgcrypto;

alter table public.processed_print_orders
  add column if not exists order_dedupe_key text null;

alter table public.processed_print_orders
  add column if not exists ignored boolean not null default false;

alter table public.processed_print_orders
  add column if not exists ignore_reason text null;

drop index if exists public.processed_print_orders_guid_idx;

create or replace function public.processed_print_order_stable_key(
  p_order_name text,
  p_order_type text,
  p_print_files jsonb
) returns text
language sql
immutable
as $$
  with normalized_files as (
    select
      (
        '{"pageSize":' ||
        coalesce(to_json(nullif(btrim(file_item.value->>'pageSize'), ''))::text, 'null') ||
        ',"copies":' ||
        case
          when btrim(coalesce(file_item.value->>'copies', '')) ~ '^-?\d+(\.\d+)?$'
            then to_json((btrim(file_item.value->>'copies'))::numeric)::text
          else 'null'
        end ||
        ',"printFilePath":' ||
        coalesce(to_json(nullif(btrim(file_item.value->>'printFilePath'), ''))::text, 'null') ||
        '}'
      ) as file_json
    from jsonb_array_elements(coalesce(p_print_files, '[]'::jsonb)) as file_item(value)
    where nullif(btrim(file_item.value->>'printFilePath'), '') is not null
       or nullif(btrim(file_item.value->>'pageSize'), '') is not null
  ),
  payload as (
    select
      '{"orderName":' ||
      to_json(coalesce(btrim(p_order_name), ''))::text ||
      ',"orderType":' ||
      to_json(case
        when upper(btrim(coalesce(p_order_type, ''))) in ('S', 'C', 'R') then upper(btrim(p_order_type))
        else 'S'
      end)::text ||
      ',"printFiles":[' ||
      coalesce(string_agg(file_json, ',' order by file_json), '') ||
      ']}' as payload_json
    from normalized_files
  )
  select 'stable:v1:' || encode(digest(payload_json, 'sha256'), 'hex')
  from payload;
$$;

update public.processed_print_orders p
set order_dedupe_key = public.processed_print_order_stable_key(p.order_name, p.order_type, p.print_files)
where p.order_dedupe_key is distinct from public.processed_print_order_stable_key(p.order_name, p.order_type, p.print_files);

-- Legacy rows imported before the API pairing table existed are kept for audit,
-- but hidden from operational views so they do not appear as "needs attention".
with api_floor as (
  select min(coalesce(received_at, api_seen_at)) as first_api_seen_at
  from public.print_orders_received
),
marked as (
  update public.processed_print_orders p
  set ignored = true,
      ignore_reason = coalesce(p.ignore_reason, 'legacy_before_api_pairing'),
      updated_at = now()
  from api_floor
  where api_floor.first_api_seen_at is not null
    and coalesce(p.queued_date_time, p.imported_at, p.updated_at) < api_floor.first_api_seen_at
    and coalesce(p.ignored, false) = false
  returning p.id
)
select count(*) as legacy_before_api_pairing_ignored
from marked;

-- Submit Tool retries can change GUID, XML path/hash, and queued_date_time while
-- preserving the real order payload. Keep the earliest non-ignored row per stable
-- order payload and soft-ignore later retry duplicates.
with ranked as (
  select
    p.id,
    row_number() over (
      partition by p.order_dedupe_key
      order by p.queued_date_time asc nulls last, p.imported_at asc nulls last, p.id asc
    ) as rn
  from public.processed_print_orders p
  where coalesce(p.ignored, false) = false
    and p.order_dedupe_key is not null
),
marked as (
  update public.processed_print_orders p
  set ignored = true,
      ignore_reason = coalesce(p.ignore_reason, 'submit_tool_retry_duplicate'),
      updated_at = now()
  from ranked
  where ranked.id = p.id
    and ranked.rn > 1
  returning p.id
)
select count(*) as submit_tool_retry_duplicates_ignored
from marked;

-- If an ignored row already owns the new stable order_key, move it out of the
-- way so the active canonical row can take the stable conflict key.
update public.processed_print_orders p
set order_key = 'ignored:' || p.id::text || ':' || p.order_key
where coalesce(p.ignored, false) = true
  and p.order_key = p.order_dedupe_key;

-- Backfill active rows so future imports conflict on the stable key and update
-- the canonical row instead of inserting another actionable order.
update public.processed_print_orders p
set order_key = p.order_dedupe_key,
    updated_at = now()
where coalesce(p.ignored, false) = false
  and p.order_dedupe_key is not null
  and p.order_key is distinct from p.order_dedupe_key
  and not exists (
    select 1
    from public.processed_print_orders other
    where other.id <> p.id
      and other.order_key = p.order_dedupe_key
  );

create index if not exists processed_print_orders_dedupe_key_idx
  on public.processed_print_orders (order_dedupe_key);

create unique index if not exists processed_print_orders_active_dedupe_key_uidx
  on public.processed_print_orders (order_dedupe_key)
  where coalesce(ignored, false) = false
    and order_dedupe_key is not null;

-- The deployed application recreates v_print_order_pipeline with ignored-row
-- filtering on startup. If applying SQL manually without redeploying, also apply
-- sql/order-pipeline.sql from this revision.

commit;
