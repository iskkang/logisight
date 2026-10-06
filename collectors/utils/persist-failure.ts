// collectors/utils/persist-failure.ts
// 저장 실패를 "삼키지 않고" 남기는 한 곳.
//
// ■ 왜 만드나
// 수집기들은 저장 실패를 .catch(console.warn) 으로 흘려보내고 있었다. 의도는
// 알겠다 —— Supabase 가 잠깐 죽어도 스냅샷 파일 경로는 살리자는 것이다. 그런데
// warn 은 종료코드를 바꾸지 않아서, 워크플로는 계속 초록불이 된다.
//
// 실제로 그 대가를 치렀다. 2026-08-06 에 maritime_news 의 유니크 키가 (url, lang)
// 으로 바뀌었는데 쓰는 쪽이 'url' 에 남아, 그날 이후 모든 upsert 가 거절됐다.
// 긁기는 멀쩡했고 로그에는 "persist skipped" 한 줄이 찍혔을 뿐이라, external 기사가
// 7월 606건 → 10월 2건으로 마르는 동안 두 달간 아무도 몰랐다. 월간 리포트의
// macro 섹션이 기사 0건으로 비고 나서야 드러났다.
//
// ■ 무엇을 바꾸나
// 두 가지만 바꾼다. 스냅샷을 살리는 원래 동작은 그대로 둔다.
//   1. console.error + ::error:: —— GitHub Actions 요약에 빨간 줄로 뜬다.
//   2. process.exitCode = 1 —— 현재 수집기를 중단시키지는 않되(남은 소스는 계속
//      긁는다), 프로세스는 실패로 끝난다. 워크플로가 빨개진다.
//
// throw 로 바꾸지 않은 이유: index.ts 는 "전체 collector 가 모두 실패한 경우에만"
// exit(1) 한다(외부 사이트 차단을 정상으로 보는 정책). 그 집계에 얹으면 저장 실패
// 하나는 또 묻힌다. 종료코드를 직접 세우는 편이 정책과 독립적이다.

export function reportPersistFailure(table: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  // ::error:: 는 GitHub Actions 주석 문법이다. 로컬에서는 그냥 한 줄로 보인다.
  console.error(`::error::[${table}] 저장 실패 — ${message}`);
  console.error(`   스냅샷 파일은 그대로 남는다. DB 적재만 건너뛴 것이며, 이 실행은 실패로 끝난다.`);
  process.exitCode = 1;
}
