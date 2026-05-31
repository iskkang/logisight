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
1. 제공된 기사 제목·요약에 명시된 사실만 사용. 출처에 없는 수치 절대 생성 금지.
2. 운임 수치는 입력의 '확정 운임 지수' 블록 값만 인용. 그 외 숫자 생성 금지. 표는 시스템이 삽입하므로 본문엔 표를 그리지 말 것.
3. 근거가 약한 내용은 [Logisight 분석] 마커 + (추정) 표기.
4. 물류·해운·공급망과 무관한 기사는 제외.
5. 입력 기사가 적으면 무리하게 분량 늘리지 말 것.

# 어휘 원칙
- "트랜스퍼시픽" → "아시아-북미 항로"
- "벙커비" / "벙커연료비" → "벙커유 가격" / "벙커유 상승" / "벙커유 급등"
- "하방 경직성" → "하락 방어" 또는 "하방 지지"
- "스페이스" → "선적 공간" 또는 "선복"`;
}

function buildSectionUserPrompt(title, items, month, indexFactText) {
  const lines = [`분석 기준월: ${month}`, ''];

  if (indexFactText) {
    lines.push('## 확정 운임 지수 (이 수치만 사용, 다른 숫자 생성 금지)');
    lines.push(indexFactText);
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
      const summary = i.summary_en ? ` — ${i.summary_en.slice(0, 400)}` : '';
      lines.push(`- [${i.source}] ${i.title}${summary}`);
      lines.push(`  URL: ${i.url}`);
    }
    lines.push('');
  }
  if (carrier.length > 0) {
    lines.push(`## 운임·시황 업데이트 (${carrier.length}건)`);
    for (const i of carrier) {
      lines.push(`- [${i.source}] ${i.title} — ${i.url}`);
    }
    lines.push('');
  }
  if (deep.length > 0) {
    lines.push(`## 심층 분석 기사 (${deep.length}건)`);
    for (const i of deep) {
      const summary = i.summary_en ? ` — 요약: ${i.summary_en.slice(0, 180)}` : '';
      lines.push(`- [${i.source}] ${i.title}${summary}`);
      lines.push(`  URL: ${i.url}`);
    }
    lines.push('');
  }
  if (other.length > 0) {
    lines.push(`## 기타 기사 (${other.length}건)`);
    for (const i of other) {
      const summary = i.summary_en ? ` — ${i.summary_en.slice(0, 150)}` : '';
      lines.push(`- [${i.source}] ${i.title}${summary}`);
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
                            indexTable = null, indexFactText = null }) {
  if (items.length === 0) {
    console.log(`⚠️  [${sectionConfig.id}] 관련 기사 없음 → status: no-data`);
    return { status: 'no-data', text: '', pass1Tokens: 0, pass2Tokens: 0 };
  }

  const systemPrompt = buildSectionSystemPrompt(styleGuide, sectionConfig.focus);
  const userPrompt   = buildSectionUserPrompt(sectionConfig.title, items, month, indexFactText);

  // PASS 1: 초안 생성
  console.log(`⏳ [${sectionConfig.id}] PASS 1 — 초안 생성...`);
  const pass1Res = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 3000,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  });
  const draft = pass1Res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const pass1Tokens = (pass1Res.usage?.input_tokens || 0) + (pass1Res.usage?.output_tokens || 0);
  console.log(`   ✓ PASS 1 완료 (${pass1Tokens} tokens)`);

  // PASS 2: 자기검수 + 수정
  console.log(`⏳ [${sectionConfig.id}] PASS 2 — 자기검수·수정...`);
  const pass2Res = await client.messages.create({
    model:      'claude-sonnet-4-6',
    max_tokens: 3500,
    system:     buildCritiqueSystemPrompt(styleGuide),
    messages:   [{ role: 'user', content: buildCritiqueUserPrompt(draft) }],
  });
  let revised = pass2Res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const pass2Tokens = (pass2Res.usage?.input_tokens || 0) + (pass2Res.usage?.output_tokens || 0);
  console.log(`   ✓ PASS 2 완료 (${pass2Tokens} tokens)`);

  // 지표 표 삽입 — LLM이 그리지 않으므로 코드에서 주입
  if (indexTable) {
    const anchor = revised.match(/##[^\n]*(?:운임|지수)[^\n]*/);
    if (anchor) {
      revised = revised.replace(anchor[0], `${anchor[0]}\n\n${indexTable}\n`);
    } else {
      revised = `## 01. 운임 지수 동향\n\n${indexTable}\n\n${revised}`;
    }
  }

  return { status: 'draft', text: revised, pass1Tokens, pass2Tokens };
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
