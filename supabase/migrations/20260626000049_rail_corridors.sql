create table if not exists rail_corridors (
  corridor_code    text primary key,
  name             text not null,
  origin_area      text not null,
  destination_area text not null,
  railroad         text not null,
  geometry         jsonb not null,
  created_at       timestamptz default now()
);

create table if not exists rail_corridor_status (
  corridor_code    text primary key references rail_corridors(corridor_code),
  status           text not null default 'unknown',
  score            int,
  reason           text,
  source           text,
  active_event_ids text[] default '{}',
  updated_at       timestamptz default now()
);

alter table rail_corridors enable row level security;
alter table rail_corridor_status enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'rail_corridors'
      and policyname = 'public read corridors'
  ) then
    create policy "public read corridors"
      on rail_corridors for select using (true);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'rail_corridor_status'
      and policyname = 'public read corridor status'
  ) then
    create policy "public read corridor status"
      on rail_corridor_status for select using (true);
  end if;
end
$$;
