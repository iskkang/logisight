'use strict';
const fs   = require('fs');
const path = require('path');

// ── Frontmatter helpers ──────────────────────────────────────────────────────

function buildFrontmatter(meta) {
  const lines = ['---'];
  for (const [k, v] of Object.entries(meta)) {
    lines.push(`${k}: ${v}`);
  }
  lines.push('---', '');
  return lines.join('\n');
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };
  const meta = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const idx = line.indexOf(': ');
    if (idx > 0) meta[line.slice(0, idx)] = line.slice(idx + 2).trim();
  }
  return { meta, body: match[2] };
}

// ── Prompt builders ──────────────────────────────────────────────────────────

function bodyOf(i) {
  if (i.content && i.content.length > 100) return i.content.slice(0, 1500);
  return i.summary_en ? i.summary_en.slice(0, 300) : '';
}

function buildSectionSystemPrompt(styleGuide, focus) {
  return `당신은 Logisight(MTL Shipping Agency)의 글로벌 해운·물류 시장 수석 분석가입니다.
독자: 한국 화주·포워더·MTL 영업팀 및 경영진.
분석 초점: ${focus}

# 문체·구조 규약 (반드시 준수)
① 명사형 객관체 종결(~함/됨/임/전망/예상) — 경어체("습니다")·평서체("이다/했다") 금지
② 정량 비교(WoW/MoM/YoY + ▲▼) — 수치엔 항상 단위·비교 기준
③ 현상→원인→배경→전망 4단 논리 — 사실 나열로 끝내지 말 것
④ 각 분석 블록 끝에 ☞ 또는 ➔ 시사점(So what)으로 마무리
⑤ 모든 수치·인용에 출처(기관/날짜) 명기

--- 스타일 가이드 시작 ---
${styleGuide}
--- 스타일 가이드 끝 ---

# 데이터 사용 원칙 (환각 방지 — 최우선)
1. 제공된 기사 제목·요약·본문에 명시된 사실만 사용. 출처에 없는 수치 절대 생성 금지.
2. 운임 수치는 입력의 '확정 운임 지수' 블록 값만 인용. 그 외 숫자 생성 금지. 표는 시스템이 삽입하므로 본문엔 표를 그리지 말 것.
3. 근거가 약한 내용은 [Logisight 분석] 마커 + (추정) 표기.
4. 물류·해운·공급망과 무관한 기사는 제외.
5. 입력 기사가 적으면 무리하게 분량 늘리지 말 것.
6. 기사 "본문"에 담긴 구체 수치·인용·항로 정보를 적극 활용해 분석 깊이를 높일 것. 단 본문에서 인용한 수치·사실은 반드시 출처(매체명, 날짜)를 병기.
7. 확정 운임 지수 표(시스템 주입, oneksa 검증치)와 기사 본문 수치는 구분할 것. 본문 수치는 서사에서 출처와 함께 인용(예: "Drewry 기준 상하이-로테르담 $2,147/FEU (gCaptain, 2026-04-24)").
8. 관영·국가계 매체(Global Times, SeaNews, TASS 등)는 운행 편수·물동량·국경 통과량 등 '검증 가능한 수치·사실'만 인용할 것. 정치적 평가·체제 우월성 주장·일방적 논평은 인용하지 말 것. 인용 시 출처(매체명) 명기하여 1차 주장임을 명확히 할 것.
9. 철도 운임·물동량 수치는 출처가 통계 기관(RZD·China Railway·KTZ 등)인 경우 신뢰하되, 매체의 해석은 [Logisight 분석]과 구분.
10. "MTL Link 실측 정시 데이터"의 수치(정시율·지연·P90)는 주어진 값만 사용. 보간·추정 금지. 인용 시 "MTL Link TCR-Tracking 실측"으로 출처 명기.
11. MTL 실측 수치와 뉴스(공개 매체) 수치를 혼동하지 말 것. 실측=내부 데이터, 뉴스=출처 매체 병기. 음수 지연은 "예정 대비 조기 도착"으로 해석.

# 어휘 원칙
- "트랜스퍼시픽" → "아시아-북미 항로"
- "벙커비" / "벙커연료비" → "벙커유 가격" / "벙커유 상승" / "벙커유 급등"
- "하방 경직성" → "하락 방어" 또는 "하방 지지"
- "스페이스" → "선적 공간" 또는 "선복"`;
}

function buildSectionUserPrompt(title, items, month, indexFactText, railFactText) {
  const lines = [`분석 기준월: ${month}`, ''];

  if (indexFactText) {
    lines.push('## 확정 운임 지수 (이 수치만 사용, 다른 숫자 생성 금지)');
    lines.push(indexFactText);
    lines.push('');
  }

  if (railFactText) {
    lines.push('## MTL Link 실측 정시 데이터 (이 수치만 사용, 다른 숫자 생성 금지)');
    lines.push(railFactText);
    lines.push('');
  }

  const causal  = items.filter(i => i.category === 'lane_causal');
  const carrier = items.filter(i => i.category === 'carrier_update');
  const deep    = items.filter(i => i.category === 'deep_analysis');
  const other   = items.filter(
    i => !['lane_causal', 'carrier_update', 'deep_analysis'].includes(i.category)
  );

  if (causal.length > 0) {
    lines.push(
      `## 항로별 원인 코멘트 (${causal.length}건) — ★ 아래 코멘트에 명시된 원인만 사용, 창작 금지`
    );
    for (const i of causal) {
      lines.push(`- [${i.source}] ${i.title}`);
      const body = bodyOf(i);
      if (body) lines.push(`  본문: ${body}`);
      lines.push(`  URL: ${i.url}`);
    }
    lines.push('');
  }
  if (carrier.length > 0) {
    lines.push(`## 운임·시황 업데이트 (${carrier.length}건)`);
    for (const i of carrier) {
      lines.push(`- [${i.source}] ${i.title}`);
      const body = bodyOf(i);
      if (body) lines.push(`  본문: ${body}`);
      lines.push(`  URL: ${i.url}`);
    }
    lines.push('');
  }
  if (deep.length > 0) {
    lines.push(`## 심층 분석 기사 (${deep.length}건)`);
    for (const i of deep) {
      lines.push(`- [${i.source}] ${i.title}`);
      const body = bodyOf(i);
      if (body) lines.push(`  본문: ${body}`);
      lines.push(`  URL: ${i.url}`);
    }
    lines.push('');
  }
  if (other.length > 0) {
    lines.push(`## 기타 기사 (${other.length}건)`);
    for (const i of other) {
      lines.push(`- [${i.source}] ${i.title}`);
      const body = bodyOf(i);
      if (body) lines.push(`  본문: ${body}`);
      lines.push(`  URL: ${i.url}`);
    }
    lines.push('');
  }

  lines.push(`위 기사들을 바탕으로 **${title}** 섹션을 작성하세요.`);
  lines.push('출력: Markdown 형식, 한국어, 스타일 가이드 톤 준수.');
  return lines.join('\n');
}

function buildCritiqueSystemPrompt(styleGuide) {
  return `당신은 Logisight 월간 리포트 시니어 에디터입니다.
초안을 아래 체크리스트로 점검하고, 위반 항목을 모두 수정한 최종본을 출력합니다.
설명·해설 없이 수정된 본문만 출력하세요. 수정이 없으면 원문 그대로 출력하세요.

--- 스타일 가이드 시작 ---
${styleGuide}
--- 스타일 가이드 끝 ---

# 자기검수 체크리스트 (모두 통과해야 최종본)
- [ ] 모든 문장이 명사형(~함/됨/임/전망)으로 끝나는가?
- [ ] '확정 운임 지수' 블록 외 운임 수치를 생성하지 않았는가? (환각 방지 — 최우선)
- [ ] 본문 안에 Markdown 표를 그리지 않았는가? (표는 시스템 삽입)
- [ ] 각 분석 블록이 현상→원인→배경→전망 4단 구조인가?
- [ ] 분석 블록 끝에 ☞/➔ 시사점이 있는가?
- [ ] 수치에 ▲▼과 비교 기준(WoW/MoM/YoY)이 붙어 있는가?
- [ ] 출처(기관명·날짜)가 명기됐는가?
- [ ] "~입니다/합니다" 경어체가 없는가?
- [ ] "~이다/했다" 평서체가 없는가?
- [ ] 벙커비/벙커연료비 → 벙커유 가격/상승/급등으로 교체됐는가?
- [ ] 트랜스퍼시픽 → 아시아-북미 항로로 교체됐는가?`;
}

function buildCritiqueUserPrompt(draft) {
  return `아래 초안을 체크리스트 기준으로 검수·수정하여 최종본을 출력하세요.\n\n---\n${draft}\n---`;
}

// ── Core 2-pass engine ───────────────────────────────────────────────────────

async function runSection({ client, sectionConfig, items, styleGuide, month,
                            indexTable = null, indexFactText = null,
                            railTable = null, railFactText = null }) {
  if (items.length === 0) {
    console.log(`⚠️  [${sectionConfig.id}] 관련 기사 없음 → status: no-data`);
    return { status: 'no-data', text: '', pass1Tokens: 0, pass2Tokens: 0 };
  }

  const systemPrompt = buildSectionSystemPrompt(styleGuide, sectionConfig.focus);
  const userPrompt   = buildSectionUserPrompt(sectionConfig.title, items, month, indexFactText, railFactText);

  // PASS 1: 초안 생성
  console.log(`⏳ [${sectionConfig.id}] PASS 1 — 초안 생성...`);
  const pass1Res = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 12000,   // 한국어 토큰 효율 고려 — 꼭지 4개 섹션도 안 잘리게
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });
  const draft = pass1Res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const p1In  = pass1Res.usage?.input_tokens  || 0;
  const p1Out = pass1Res.usage?.output_tokens || 0;
  console.log(`   ✓ PASS 1 완료 (출력 ${p1Out} / 입력 ${p1In} tokens)`);
  if (pass1Res.stop_reason === 'max_tokens')
    console.warn(`   ⚠️ PASS 1이 max_tokens에서 잘림! 상향 필요`);

  // PASS 2: 자기검수 + 수정
  console.log(`⏳ [${sectionConfig.id}] PASS 2 — 자기검수·수정...`);
  const pass2Res = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 12000,
    system:     buildCritiqueSystemPrompt(styleGuide),
    messages:   [{ role: 'user', content: buildCritiqueUserPrompt(draft) }],
  });
  let revised = pass2Res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const p2In  = pass2Res.usage?.input_tokens  || 0;
  const p2Out = pass2Res.usage?.output_tokens || 0;
  console.log(`   ✓ PASS 2 완료 (출력 ${p2Out} / 입력 ${p2In} tokens)`);
  if (pass2Res.stop_reason === 'max_tokens')
    console.warn(`   ⚠️ PASS 2가 max_tokens에서 잘림! 상향 필요`);

  // 지표 표 삽입 — LLM이 그리지 않으므로 코드에서 주입
  if (indexTable) {
    // 우선순위: "운임"+"지수" 동시 포함 > "지수 동향" > "운임"or"지수" 단독 > 첫 ## 다음 > 맨 앞
    const anchor =
      revised.match(/##[^\n]*운임[^\n]*지수[^\n]*/) ||
      revised.match(/##[^\n]*지수[^\n]*동향[^\n]*/) ||
      revised.match(/##[^\n]*(?:운임|지수)[^\n]*/);
    if (anchor) {
      revised = revised.replace(anchor[0], `${anchor[0]}\n\n${indexTable}\n`);
    } else {
      const firstH = revised.match(/\n##\s[^\n]*\n/);
      if (firstH) {
        const at = revised.indexOf(firstH[0]) + firstH[0].length;
        revised = revised.slice(0, at) + `\n${indexTable}\n\n` + revised.slice(at);
      } else {
        revised = `## 운임 지수 동향\n\n${indexTable}\n\n${revised}`;
      }
    }
    // ocean 섹션에만 운임·벙커 차트 토큰 추가 (index 섹션 중복 방지)
    if (sectionConfig.id === 'ocean') {
      revised += '\n\n[[CHART:ocean_scfi]]\n\n[[CHART:ocean_bdi]]\n\n[[CHART:ocean_bunker]]\n';
    }
  }

  // rail 실측 표 삽입 — 04-3 소제목 아래
  if (railTable) {
    const anchor =
      revised.match(/#{2,3}[^\n]*04-3[^\n]*/) ||
      revised.match(/#{2,3}[^\n]*(?:회랑|정시)[^\n]*/);
    if (anchor) {
      revised = revised.replace(anchor[0], `${anchor[0]}\n\n${railTable}\n`);
    } else {
      const before04_4 = revised.match(/#{2,3}[^\n]*04-4[^\n]*/);
      if (before04_4) revised = revised.replace(before04_4[0], `${railTable}\n\n${before04_4[0]}`);
      else revised += `\n\n### 04-3. 유라시아 회랑별 정시 성과 (MTL 실측)\n\n${railTable}\n`;
    }
  }

  return { status: 'draft', text: revised, pass1Tokens: p1Out, pass2Tokens: p2Out };
}

// ── File I/O ─────────────────────────────────────────────────────────────────

function saveSectionFile(outDir, sectionId, month, status, text, extra = {}) {
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${sectionId}.md`);
  const frontmatter = buildFrontmatter({
    section:      sectionId,
    month,
    status,
    generated:    new Date().toISOString(),
    ...extra,
  });
  fs.writeFileSync(outPath, frontmatter + text + '\n', 'utf-8');
  return outPath;
}

module.exports = { runSection, saveSectionFile, parseFrontmatter };
