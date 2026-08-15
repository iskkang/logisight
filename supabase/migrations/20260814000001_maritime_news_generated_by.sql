-- AI가 쓴 기사를 AI가 썼다고 표시하기 위한 열.
--
-- 이전에는 모델이 스스로 붙인 고지("본 기사는 …작성됐습니다")를 발행 직전에
-- 정규식으로 잘라내고 있었다(generators/web/lib/news-pipeline.js). 그 코드를
-- 지우면서, 표기를 지우는 대신 표기를 하는 쪽으로 바꾼다.
--
-- 값에 모델 이름을 넣는다. "AI로 만들었다"만으로는 나중에 어느 모델이 쓴
-- 글인지 되짚을 수 없고, 문제가 생겼을 때 범위를 특정할 수 없다.
--   예: 'deepseek-v4-flash', 'claude-opus-5'
--
-- NULL 은 "사람이 썼거나, 표기가 시작되기 전에 발행된 기사"다. 소급해서
-- 채우지 않는다 —— 어느 기사가 AI였는지 지금은 확실히 알 수 없고, 확실하지
-- 않은 것을 확실한 것처럼 적으면 이 열의 의미가 없어진다.
-- 화면도 NULL 인 행에는 배지를 붙이지 않는다.
alter table public.maritime_news
  add column if not exists generated_by text;

comment on column public.maritime_news.generated_by is
  'AI가 초안을 쓴 경우 그 모델 이름(예: deepseek-v4-flash). 사람이 쓴 기사와 표기 시작 이전 기사는 NULL.';

-- 어느 모델이 얼마나 쓰고 있는지 세는 일이 잦다.
create index if not exists maritime_news_generated_by_idx
  on public.maritime_news (generated_by)
  where generated_by is not null;
