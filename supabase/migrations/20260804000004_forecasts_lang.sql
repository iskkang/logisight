-- AI 서술의 언어 축.
--
-- forecasts.statement / impact_note 는 LLM이 쓴 한국어 산문이다. 일본 사이트가
-- 이 행을 그대로 읽어 화면에 한국어가 나온다. assets.name_ja 처럼 컬럼을 더하는
-- 방식은 여기서는 못 쓴다 — 산문은 어휘가 닫혀 있지 않고, 본문·영향·권장행동이
-- 각각 긴 문단이라 컬럼을 언어 수만큼 늘리면 테이블이 무너진다.
--
-- 리포트(reports.lang)와 같이 행을 언어별로 나눈다. 같은 이벤트에 대해
-- ko 행과 ja 행이 각각 서고, 각 사이트는 자기 언어만 읽는다.
--
-- DO NOT APPLY automatically — Supabase SQL Editor에서 수동 적용.

alter table public.forecasts
  add column if not exists lang text not null default 'ko';

alter table public.forecasts drop constraint if exists forecasts_lang_check;
alter table public.forecasts add constraint forecasts_lang_check check (lang in ('ko', 'ja'));

comment on column public.forecasts.lang is
  '본문(statement·impact_note)의 언어. 사이트는 자기 언어 행만 읽는다.';

-- 중복 방지 키에 lang을 넣지 않으면 ja 행이 ko 행과 충돌해 아예 들어가지 못한다.
drop index if exists forecasts_dedup_idx;
create unique index forecasts_dedup_idx
  on public.forecasts (metric_ref, horizon_date, model_version, lang);

-- ── 관문 이름 ─────────────────────────────────────────────────────────
-- basis에 관문명이 들어가고 화면에도 나온다. name_ko만 있으면 일본어 본문 안에
-- '미야코해협'이 섞인다.
alter table public.passages add column if not exists name_ja text;

comment on column public.passages.name_ja is '일본판 표시명. 없으면 name_ko로 대체한다.';

update public.passages set name_ja = v.ja from (values
  ('bab_el_mandeb',    'バブ・エル・マンデブ海峡'),
  ('bashi_channel',    'バシー海峡'),
  ('cape_of_good_hope','喜望峰'),
  ('dover',            'ドーバー海峡'),
  ('gibraltar',        'ジブラルタル海峡'),
  ('hormuz',           'ホルムズ海峡'),
  ('indian_ocean_wp',  'インド洋の航路点'),
  ('korea_strait',     '対馬海峡'),
  ('luzon_strait',     'ルソン海峡'),
  ('malacca',          'マラッカ海峡'),
  ('miyako_strait',    '宮古海峡'),
  ('mozambique_ch',    'モザンビーク海峡'),
  ('oceania_approach', 'オセアニア接近点(トレス海峡)'),
  ('panama',           'パナマ運河'),
  ('scs_waypoint',     '南シナ海の航路点'),
  ('suez',             'スエズ運河'),
  ('sunda_lombok',     'スンダ・ロンボク海峡'),
  ('taiwan_strait',    '台湾海峡'),
  ('transpacific_wp',  '環太平洋の航路点')
) as v(id, ja) where passages.id = v.id;
