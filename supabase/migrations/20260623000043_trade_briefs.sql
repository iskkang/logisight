create table if not exists public.trade_briefs (
  period       text primary key,
  verdict      text not null,
  detail       text not null,
  input_hash   text not null,
  model        text not null,
  generated_at timestamptz not null default now()
);

alter table public.trade_briefs enable row level security;

create policy "trade_briefs read" on public.trade_briefs
  for select using (true);
