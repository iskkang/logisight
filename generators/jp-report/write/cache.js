'use strict';
// generators/jp-report/write/cache.js
// 섹션별 원고 캐시 — 통과한 섹션은 다시 쓰지 않는다.
//
// 한 섹션이 막히면 7섹션을 전부 다시 썼다. 2026-06호에서 air 하나 때문에
// 나머지 여섯의 결과물을 버렸고, 25분과 호출 비용이 매번 날아갔다.
//
// ■ 낡은 원고가 살아남는 것이 더 위험하다
// 캐시의 위험은 속도가 아니라 정합성이다. 팩트시트가 바뀌었는데 옛 본문을
// 그대로 쓰면 수치가 어긋난 리포트가 나간다. 그래서 입력이 조금이라도 달라지면
// 무조건 버린다. 지문(fingerprint)에 다음을 전부 넣는다:
//   - 그 섹션이 받는 팩트시트 조각
//   - 섹션의 지시(focus·소섹션 구성)
//   - 문체·SEO 가이드
//
// ■ 요지(digest)를 지문에 넣는 기준
// 총론과 전망은 앞 섹션의 요지를 종합하는 것이 일이므로, 요지가 바뀌면
// 다시 써야 한다. 데이터 섹션(해운·항공·…)에게 요지는 배경 맥락일 뿐이고,
// 앞 섹션이 문장을 다듬었다고 해서 이쪽이 틀리지는 않는다.
// 전자만 지문에 넣는다. 전부 넣으면 한 섹션만 고쳐도 뒤가 통째로 무효가 된다.
//
// ■ 캐시를 되쓸 때도 검사는 다시 돈다
// 검사기를 새로 추가했을 때, 예전에 통과한 본문이 그 검사를 안 받고 넘어가면
// 안 된다. 결정적 검사(수치·유보·지속·내부명칭·인과)는 호출이 없으므로
// 되쓸 때마다 전부 다시 돌린다. 아끼는 것은 생성과 LLM 편집 검수뿐이다.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../../outputs/cache/jp-report');

const sha = (v) => crypto.createHash('sha1').update(v).digest('hex').slice(0, 16);

/**
 * @param {object} args
 * @param {object} args.slim 그 섹션이 받는 팩트시트 조각
 * @param {object} args.section 섹션 정의
 * @param {string} args.style 문체 가이드
 * @param {string} args.seo SEO 가이드
 * @param {Array} args.digests 앞 섹션의 요지
 */
function fingerprint({ slim, section, style, seo, digests }) {
  return sha(JSON.stringify({
    slim,
    focus: section.focus,
    subsections: section.subsections || null,
    title: `${section.no}. ${section.title}`,
    style: sha(style),
    seo: sha(seo),
    // 총론·전망만 요지에 좌우된다. 위 주석 참고.
    digests: section.generateLast ? digests.map((d) => d.digest) : null,
  }));
}

function fileOf(period, sectionId) {
  return path.join(ROOT, String(period), `${sectionId}.json`);
}

/** 지문이 맞는 저장분. 없거나 어긋나면 null. */
function read(period, sectionId, fp) {
  try {
    const raw = JSON.parse(fs.readFileSync(fileOf(period, sectionId), 'utf8'));
    if (raw.fingerprint !== fp) return null;
    return typeof raw.body === 'string' && raw.body.trim() ? raw.body : null;
  } catch {
    return null;
  }
}

/** 검수까지 통과한 본문만 저장한다. 막힌 본문을 저장하면 다음 회차가 그걸 되쓴다. */
function write(period, sectionId, fp, body) {
  const f = fileOf(period, sectionId);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({
    fingerprint: fp,
    section: sectionId,
    savedAt: new Date().toISOString(),
    body,
  }, null, 2), 'utf8');
}

/** --fresh 로 전부 다시 쓰고 싶을 때. */
function clear(period) {
  fs.rmSync(path.join(ROOT, String(period)), { recursive: true, force: true });
}

// ── 미해결 목록 ──────────────────────────────────────────────────────
// writer가 멈춘 이유를 파일로 남긴다. 오케스트레이터(run.js)는 자식 프로세스의
// 종료 코드밖에 못 보는데, 워크플로 로그에서는 "무엇이 왜 막혔는지"를 봐야 한다.
// 콘솔 출력은 로그 위로 밀려 올라가고, 재실행하면 사라진다.

function unresolvedFile(period) {
  return path.join(ROOT, String(period), 'unresolved.json');
}

/** @param {{status: string, unresolved: Array<{section, type, detail}>}} result */
function writeUnresolved(period, result) {
  const f = unresolvedFile(period);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify({
    period: String(period),
    status: result.status,
    savedAt: new Date().toISOString(),
    unresolved: result.unresolved || [],
  }, null, 2), 'utf8');
  return f;
}

function readUnresolved(period) {
  try {
    return JSON.parse(fs.readFileSync(unresolvedFile(period), 'utf8'));
  } catch {
    return null;
  }
}

/** 통과한 회차의 낡은 목록은 지운다. 남겨두면 다음 실행의 로그가 거짓말을 한다. */
function clearUnresolved(period) {
  fs.rmSync(unresolvedFile(period), { force: true });
}

module.exports = {
  ROOT, fingerprint, read, write, clear, fileOf,
  unresolvedFile, writeUnresolved, readUnresolved, clearUnresolved,
};
