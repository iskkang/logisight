# Follow-up: surface null-ETA stalled TCR containers on /eurasia 현재 지연

**Status:** open · **Created:** 2026-06-13 · **Origin:** `tracing_tcr_current.ts` first ingest (Option i)

## Problem (confirmed mismatch, not a bug)

`tracing_tcr_current.ts` (pipeline repo) now fills `tcr_containers_current` / `tcr_route_segments` / `tcr_risk_alerts`
in hmg from MTL Link `action=list`. The current-delay view `public.tcr_delay_current_snapshot` computes
delay as `current_date − segment.eta`, where `eta := container.eta_final` (Option i).

But ~16 of 95 live containers are **red/yellow with `eta_final = null`** and `signal_reason` like
`동일 위치 14일 정체` / `출발 28일 초과`. The view filter `where s.eta is not null and d>0` **excludes them**,
so the operationally-worst stalls never reach the map. They are currently captured **only** in
`tcr_risk_alerts` (severity=high/medium, `alert_type` STALLED/DEPARTURE_OVERDUE) — no delay magnitude stored.

First-ingest evidence (2026-06-13): view emits 2 segments (Kashgar→Andijan max 9d; Xi'an→Małaszewicze max 5d),
while 16 stalled containers stay hidden.

## Goal

Make null-`eta_final` stalled containers appear on `/eurasia` 현재 지연 **without faking ETA**.

## Tasks

1. **Pipeline** (`collectors/tracing_tcr_current.ts`): parse delay-days from `signal_reason`
   (`정체` → "동일 위치 **N**일 정체"; `초과` → "출발 **N**일 초과") into an explicit integer.
2. **Schema** (hmg): add a delay column — e.g. `tcr_route_segments.delay_days_reported int` (or a numeric
   on `tcr_risk_alerts`). Store the parsed value; leave null when unparseable. No DDL on anon grants.
3. **View** (`tcr_delay_current_snapshot`): widen so a row qualifies if **either** `d>0` (eta-based)
   **or** `delay_days_reported > 0`. Coalesce the two into `max_delay_days`/`median_delay_days`.
   Tag `data_quality='indicative'` for reason-derived-only rows so the map can de-emphasize them.

## Hard constraints

- **Do not fabricate `eta_final`/`eta` values** to force visibility — use a separate reported-delay field.
- Frontend stays **aggregate-only** (reads the view; no raw rows). No `/eurasia` component change required
  if the view keeps the same columns.
- Reason-derived delays must be visibly distinguishable from ETA-based delays (quality flag), per CLAUDE.md
  honesty rules — no silent mixing.

## Out of scope

TCR truck-vs-rail mode split (view derives mode from `load_type`/`segment_name`, which don't carry the
`transport_mode='Truck'` hint) — note only, separate ticket.
