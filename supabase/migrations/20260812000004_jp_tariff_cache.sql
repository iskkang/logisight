-- 対米関税の照会結果を貯める。
--
-- LandedIQ のエッジ関数は IP 当たり毎分 30 回までで、サーバから呼ぶと
-- サイト全体が 1 つの IP に見える。原産地 6 か国 × 照会 5 件で 1 分の枠を
-- 使い切るため、ここは性能のための工夫ではなく**動く条件**である。
--
-- 期限切れの行も消さない。相手が止まっても、最後に取れた値を時点付きで
-- 見せ続けられるようにするためである。「一緒に止まる」を「代わりに古くなる」
-- に変える。
create table if not exists public.jp_tariff_cache (
  q_norm     text        not null,
  origin     text        not null,
  as_of      date        not null,
  payload    jsonb       not null,
  fetched_at timestamptz not null default now(),
  primary key (q_norm, origin, as_of)
);

comment on table public.jp_tariff_cache is
  '対米関税照会のキャッシュ。期限切れも消さない(相手停止時の代替表示に使う)。';

-- 読み書きはサーバの service role からのみ。匿名クライアントには触らせない。
-- ポリシーを 1 つも置かないことで、それを表現する。
alter table public.jp_tariff_cache enable row level security;
