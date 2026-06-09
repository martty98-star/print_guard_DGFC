-- Stock safe sync migration.
-- Apply before deleting stock rows directly in Neon.

create table if not exists public.pg_items (
  article_number text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  sync_source text null,
  sync_client_id text null,
  sync_operator text null
);

create table if not exists public.pg_movements (
  id text primary key,
  article_number text not null,
  timestamp timestamptz not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz null,
  sync_source text null,
  sync_client_id text null,
  sync_operator text null
);

alter table public.pg_items add column if not exists deleted_at timestamptz null;
alter table public.pg_items add column if not exists sync_source text null;
alter table public.pg_items add column if not exists sync_client_id text null;
alter table public.pg_items add column if not exists sync_operator text null;
alter table public.pg_movements add column if not exists deleted_at timestamptz null;
alter table public.pg_movements add column if not exists sync_source text null;
alter table public.pg_movements add column if not exists sync_client_id text null;
alter table public.pg_movements add column if not exists sync_operator text null;

create table if not exists public.pg_stock_tombstones (
  entity text not null,
  key text not null,
  deleted_at timestamptz not null default now(),
  source text null,
  client_id text null,
  operator text null,
  payload jsonb null,
  created_at timestamptz not null default now(),
  primary key (entity, key)
);

create table if not exists public.pg_stock_write_audit (
  id bigserial primary key,
  entity text not null,
  stock_item_id text null,
  movement_id text null,
  action text not null,
  source text null,
  client_id text null,
  operator text null,
  request_id text null,
  incoming_updated_at timestamptz null,
  accepted boolean not null default false,
  reason text null,
  before_payload jsonb null,
  after_payload jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists pg_items_active_idx
  on public.pg_items(article_number)
  where deleted_at is null;

create index if not exists pg_movements_active_article_idx
  on public.pg_movements(article_number, timestamp)
  where deleted_at is null;

create or replace function public.pg_stock_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.updated_at is not distinct from old.updated_at
     and (
       new.data is distinct from old.data
       or new.deleted_at is distinct from old.deleted_at
     ) then
    new.updated_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists pg_items_set_updated_at on public.pg_items;
create trigger pg_items_set_updated_at
before update on public.pg_items
for each row execute function public.pg_stock_set_updated_at();

drop trigger if exists pg_movements_set_updated_at on public.pg_movements;
create trigger pg_movements_set_updated_at
before update on public.pg_movements
for each row execute function public.pg_stock_set_updated_at();

create or replace function public.pg_stock_tombstone_deleted_row()
returns trigger
language plpgsql
as $$
declare
  tombstone_entity text;
  tombstone_key text;
begin
  if tg_table_name = 'pg_items' then
    tombstone_entity = 'item';
    tombstone_key = old.article_number;
  elsif tg_table_name = 'pg_movements' then
    tombstone_entity = 'movement';
    tombstone_key = old.id;
  else
    return old;
  end if;

  insert into public.pg_stock_tombstones(entity, key, deleted_at, source, client_id, operator, payload)
  values (tombstone_entity, tombstone_key, now(), 'db_delete_trigger', old.sync_client_id, old.sync_operator, old.data)
  on conflict (entity, key) do update
  set deleted_at = greatest(public.pg_stock_tombstones.deleted_at, excluded.deleted_at),
      source = excluded.source,
      client_id = excluded.client_id,
      operator = excluded.operator,
      payload = excluded.payload;
  return old;
end;
$$;

drop trigger if exists pg_items_tombstone_deleted_row on public.pg_items;
create trigger pg_items_tombstone_deleted_row
after delete on public.pg_items
for each row execute function public.pg_stock_tombstone_deleted_row();

drop trigger if exists pg_movements_tombstone_deleted_row on public.pg_movements;
create trigger pg_movements_tombstone_deleted_row
after delete on public.pg_movements
for each row execute function public.pg_stock_tombstone_deleted_row();
