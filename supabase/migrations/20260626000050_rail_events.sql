create extension if not exists pgcrypto;

create table if not exists rail_events (
  id                 uuid primary key default gen_random_uuid(),
  source             text not null,
  source_uid         text,
  checksum           text,
  event_type         text not null,
  severity           text,
  railroad           text,
  location_text      text,
  affected_corridors text[] default '{}',
  scope              text,
  score              int,
  summary            text,
  evidence_text      text,
  confidence_score   numeric,
  start_date         date,
  end_date           date,
  captured_at        timestamptz default now(),
  unique (source, source_uid)
);

alter table rail_events enable row level security;
