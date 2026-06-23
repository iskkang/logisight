-- (a-2) r3 출구 보정 — 류큐(미야코) 추가, 대만해협 유지(병기).
-- 근거: r3='아시아–미동안' 레인 전체 — 다항 스트링은 연안 N→S로 대만해협 통과 후 바시로 동진(대만해협≠0),
--       순수 상하이→파나마는 류큐(미야코) 출구. 둘 다 실존 → taiwan + miyako 병기.
-- route_passages의 r3 매핑만 수정(신규 노선/미서안/r2 손대지 않음). miyako_strait는 040에서 이미 시드됨(재시드 X).
-- DO NOT APPLY automatically — run manually after review (db push 수동). 040·041 이후.

-- seq 유니크 충돌 회피: r3 행 통째 삭제 후 4개 재적재(통과 순서 보존).
delete from public.route_passages where route_id = 'r3';
insert into public.route_passages (route_id, passage_id, seq) values
 ('r3', 'taiwan_strait', 1),   -- 연안 N→S 레그(다항 스트링) · 4노선 전파 기제 보존
 ('r3', 'miyako_strait', 2),   -- 류큐 출구(상하이→파나마 남동진) · 류큐 재곡 태풍 전파
 ('r3', 'bashi_channel', 3),   -- 남중국발 동진 출구(대만 남쪽)
 ('r3', 'panama', 4)
on conflict (route_id, passage_id) do update set seq = excluded.seq;
