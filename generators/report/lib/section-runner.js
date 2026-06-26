'use strict';
const fs   = require('fs');
const path = require('path');
const { normalizeMonthlyReportMarkdown } = require('./report-style-normalizer');

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
  // BOM 제거 + CRLF→LF 정규화 (PowerShell 편집·인코딩으로 인한 누출 방지)
  content = String(content).replace(/^﻿/, '').replace(/\r\n/g, '\n');
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
  return `당신은 Logisight의 글로벌 해운·물류 시장 수석 분석가입니다.
이 리포트는 **외부 고객(화주·포워더·물류 실무자 및 경영진) 열람용**입니다.
분석 초점: ${focus}

# 문체·구조 규약 (반드시 준수)
① 명사·명사형으로 간결히 종결 — 어색한 '~임/~함/~됨/~해짐' 서술 어미를 붙이지 말고 명사로 끝낼 것. 예: '~할 전망임'→'~할 전망', '~한 상황임'→'~한 상황', '~인 구조임'→'~인 구조', '작용 중임'→'작용 중', '조정됨'→'조정', '반복됨'→'반복', '가능함'→'가능', '뚜렷해짐'→'뚜렷', '상승함'→'상승', '기록함'→'기록'. 경어체('습니다')·평서체('이다/했다') 금지.
② 정량 비교(WoW/MoM/YoY + ▲▼) — 수치엔 항상 단위·비교 기준
③ 현상에서 원인·배경·전망으로 자연스럽게 이어지는 **연결된 산문**으로 작성.
   ★★ [현상]·[원인]·[배경]·[전망] 같은 대괄호 라벨·머리표·구획 표지를 출력에 절대 쓰지 말 것.
   논리 전개는 문단의 흐름으로만 드러내고, 한 문단에서 다음 문단으로 매끄럽게 이어지게 작성.
④ 각 분석은 **객관적 시장 전망 + 실무 시사점**으로 마무리.
   ★★ 특정 회사 영업 문구는 금지하되, 한국 화주·포워더 관점의 계약·부킹·BAF·환헤지 등 실무 함의를
   마지막 한 줄에 '➔' 형태로 명시할 것.
⑤ 출처 표기 금지 — 본문에 괄호식 출처 표기 (매체, 날짜), 각주 마크 [n], 번호 참고자료 목록을 만들지 말 것.
   출처가 신뢰도상 꼭 필요하면 **문장 안에 매체명만 자연스럽게(날짜·괄호 없이) 1회** 녹여 쓰고, 그 외엔 생략.
⑥ Bold 강조 규칙 — 문단 리드 소제목은 별도 줄 \`**소제목**\`으로 쓰고 마침표를 붙이지 말 것.
   본문 Bold는 단어·지수명 단독 강조가 아니라 판단을 담은 2~10어절 핵심 구절에만 적용.
   좋은 예: \`**2026년 5월 시장**\`, \`**동시에 강세**\`, \`**같은 방향으로 움직인 점**\`, \`**구조적 비용 충격**\`.
   금지 예: \`**SCFI**\`, \`**KCCI**\`, \`**BAF**\`, \`**IATA**\`, \`**동반 상승의 의미.**\`.
⑦ PDF 레이아웃 규칙 — \`NN-N.\` 하위 페이지 제목은 한 줄로 들어가도록 짧게 작성.
   표·차트가 함께 들어가는 페이지는 본문이 다음 페이지로 넘어가지 않게 해설을 줄일 것.
   \`[[STATS]]\` 카드 토큰은 \`값|라벨|up/down\` 순서이며, 라벨은 18자 안팎으로 축약.
   내용이 짧거나 직접 연결되는 인접 하위 페이지는 병합될 수 있으므로 병합 그룹(02-5+02-6, 02-7+02-8, 03-2+03-3, 05-2+05-3+05-4, 06-1+06-2)은 각 블록을 2문단 이내로 압축.

# 기사 선정·사용 기준
- 운임·물동량·정책·인프라 등 시장 분석성 기사 우선(JOC·Drewry·Linerlytica·Flexport·gCaptain 등 전문 매체).
- 단신·인물·가십·사건사고는 제외. 본문이 매우 짧거나(100자 미만) 섹션 주제와 직접 무관한 기사는 건너뛸 것.
- 기사 주제가 해당 섹션과 일치해야 함 — 항공 섹션엔 항공 화물 기사만, 철도엔 철도만, 지역엔 지역 이슈만.

--- 스타일 가이드 시작 ---
${styleGuide}
--- 스타일 가이드 끝 ---

# 데이터 사용 원칙 (환각 방지 — 최우선)
1. 제공된 기사 제목·요약·본문에 명시된 사실만 사용. 출처에 없는 수치 절대 생성 금지.
   ★★ 항공 운임 수치는 입력의 KITA 참고운임·TAC Index(Superset)·BAI(aircargoweek.com) 블록에 있는 값만 인용.
   이 블록이 없거나 비어 있으면 수치를 만들지 말고 "데이터 미수집"으로 표기. WorldACD를 포함한 일체의 외부 운임 소스를 학습 데이터 기반으로 생성 금지.
2. 운임 수치는 입력의 '확정 운임 지수' 블록 값만 인용. 표·차트는 시스템이 삽입하므로 본문에 표를 그리지 말 것.
3. 근거가 약한 내용은 [Logisight 분석] + (추정) 표기.
4. 물류·해운·공급망과 무관한 기사는 제외.
5. 입력 기사가 적으면 무리하게 분량 늘리지 말 것.
6. 기사 본문의 구체 수치·인용을 적극 활용할 것. 매체명이 필요하면 문장에 자연스럽게 녹여 쓰되 날짜·괄호·각주는 쓰지 말 것.
7. 확정 지수 표(시스템 주입)와 기사 본문 수치는 구분해 사용.
8. 관영·국가계 매체는 검증 가능한 수치·사실만 인용(정치 평가·체제 주장 배제).
9. 철도 통계 기관 수치는 신뢰하되 매체 해석은 [Logisight 분석]과 구분.
10. 실측 정시 데이터(정시율·지연·P90)는 주어진 값만 사용, 보간·추정 금지.
11. 실측 수치와 공개 매체 수치를 혼동 금지. 음수 지연=예정 대비 조기 도착.

# 어휘 원칙
- "트랜스퍼시픽" → "아시아-북미 항로"
- "벙커비"/"벙커연료비" → "벙커유 가격"/"벙커유 상승"/"벙커유 급등"
- "하방 경직성" → "하락 방어" 또는 "하방 지지"
- "스페이스" → "선적 공간" 또는 "선복"`;
}

function topicArticleCandidates(items, keywords, limit = 3) {
  return items
    .map(item => {
      const title   = String(item.title || '').toLowerCase();
      const summary = String(item.summary_en || '').toLowerCase();
      const content = String(item.content || '').toLowerCase();
      const score = keywords.reduce((sum, keyword) => {
        const k = keyword.toLowerCase();
        return sum + (title.includes(k) ? 4 : 0) + (summary.includes(k) ? 2 : 0) + (content.includes(k) ? 1 : 0);
      }, 0);
      return { item, score };
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.item);
}

function appendTopicArticleGuide(lines, items, topicGuides) {
  if (!topicGuides?.length) return;
  lines.push('## 주제별 기사 탐색 맵');
  lines.push('아래 목록은 입력 기사에서 관련 주제어로 자동 검색한 후보입니다. 정량 표·차트만으로 페이지가 비는 주제는 해당 후보의 본문 근거를 우선 활용해 분석을 보강하세요. 관련 근거가 없으면 사실을 만들지 마세요.');
  for (const guide of topicGuides) {
    const candidates = topicArticleCandidates(items, guide.keywords);
    lines.push(`### ${guide.id} ${guide.title} — ${guide.target}`);
    if (!candidates.length) {
      lines.push('- 관련 기사 후보 없음: 제공된 정량 데이터 범위 안에서만 간결하게 작성');
      continue;
    }
    for (const item of candidates) {
      lines.push(`- [${item.source}] ${item.title}`);
      lines.push(`  URL: ${item.url}`);
    }
  }
  lines.push('');
}

function appendStickyRailGuide(lines, items) {
  const stickyRail = items.filter(i =>
    i &&
    i.sticky === true &&
    String(i.source || '').toLowerCase() === 'container-news' &&
    String(i.section || '').toLowerCase() === 'rail'
  );
  if (!stickyRail.length) return;

  lines.push('## Container News sticky rail items (gated event block)');
  lines.push('Use this block only because sticky rail items are present in this run. Keep the tone to what happened and why it matters; do not add recommendation or action wording.');
  for (const item of stickyRail) {
    lines.push(`- [${item.source}] ${item.title}`);
    if (item.summary_en || item.summary) lines.push(`  Summary: ${(item.summary_en || item.summary).slice(0, 600)}`);
    if (item.tags?.length) lines.push(`  Tags: ${item.tags.join(', ')}`);
    lines.push(`  URL: ${item.url}`);
  }
  lines.push('');
}

function buildSectionUserPrompt(title, items, month, indexFactText, railFactText, airFactText, portThroughputFactText, kitaFactText, topicGuides) {
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

  if (airFactText) {
    lines.push('## 항공 운임 지수 (이 수치만 사용, 다른 운임 수치 생성 금지)');
    lines.push(airFactText);
    lines.push('');
  }

  if (portThroughputFactText) {
    lines.push('## 컨테이너 항만 물동량 지수 (이 수치만 사용, 다른 숫자 생성 금지)');
    lines.push(portThroughputFactText);
    lines.push('');
  }

  if (kitaFactText) {
    lines.push(kitaFactText);
    lines.push('');
  }

  appendTopicArticleGuide(lines, items, topicGuides);
  appendStickyRailGuide(lines, items);

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
- [ ] 모든 문장이 명사·명사형으로 끝나되, '~임/~함/~됨/~해짐' 어미 없이 명사로 종결되는가? (전망임→전망, 상황임→상황, 조정됨→조정, 가능함→가능, 작용 중임→작용 중) — 위반 시 어미 제거
- [ ] '확정 운임 지수' 블록 외 운임 수치를 생성하지 않았는가? (환각 방지 — 최우선)
- [ ] 본문 안에 Markdown 표를 그리지 않았는가? (표는 시스템 삽입)
- [ ] [현상]·[원인]·[배경]·[전망] 등 대괄호 라벨·머리표가 본문에 전혀 없는가? — 있으면 제거하고 자연스러운 산문으로 재서술
- [ ] 특정 회사 영업 문구 없이 한국 화주·포워더 관점의 실무 시사점이 '➔' 한 줄로 포함됐는가?
- [ ] 분석이 시장 전망과 실무 함의를 함께 제시하며 마무리되는가?
- [ ] 수치에 ▲▼과 비교 기준(WoW/MoM/YoY)이 붙어 있는가?
- [ ] 괄호식 출처 표기 (매체, 날짜), 각주 마크 [n], 참고자료 목록이 전혀 없는가? 있으면 제거. 매체명이 꼭 필요하면 문장 안에 자연스럽게 1회만 녹여 썼는가?
- [ ] "~입니다/합니다" 경어체가 없는가? "~이다/했다" 평서체가 없는가?
- [ ] 벙커비/벙커연료비 → 벙커유로, 트랜스퍼시픽 → 아시아-북미 항로로 교체됐는가?
- [ ] 문단 리드 소제목은 별도 줄 \`**소제목**\` 형식이며 마침표가 없는가?
- [ ] \`**SCFI**\`, \`**KCCI**\`, \`**BAF**\`, \`**IATA**\`처럼 키워드·지수명만 단독으로 Bold 처리하지 않았는가?
- [ ] 본문 Bold는 문장을 읽고 이해해야 드러나는 핵심 구절(예: \`**구조적 비용 충격**\`)에만 적용됐는가?
- [ ] \`NN-N.\` 하위 페이지 제목이 한 줄에 들어갈 만큼 짧은가?
- [ ] 표·차트가 긴 페이지에서 본문이 다음 페이지로 넘어가지 않도록 문단 수와 문장 수를 줄였는가?
- [ ] \`[[STATS]]\` 카드가 \`값|라벨|up/down\` 순서이며 카드 라벨이 짧은가?
- [ ] 내용이 짧은 인접 하위 페이지는 무리하게 독립 페이지 분량으로 늘리지 않고 병합 가능한 밀도로 압축했는가?
- [ ] 출력에 한자(中文) 잔존 0건인가? 있으면 한국어로 번역.`;
}

function buildCritiqueUserPrompt(draft) {
  return `아래 초안을 체크리스트 기준으로 검수·수정하여 최종본을 출력하세요.\n\n---\n${draft}\n---`;
}

function replaceSectionContent(markdown, heading, content) {
  const start = markdown.indexOf(heading);
  if (start < 0) return markdown;
  const bodyStart = start + heading.length;
  const level = (heading.match(/^#+/) || ['###'])[0].length;
  const nextHeading = markdown
    .slice(bodyStart)
    .match(new RegExp(`\\n#{1,${level}}\\s`));
  const bodyEnd = nextHeading ? bodyStart + nextHeading.index : markdown.length;
  return markdown.slice(0, bodyStart) + content + markdown.slice(bodyEnd);
}

function removeSection(markdown, heading) {
  const start = markdown.indexOf(heading);
  if (start < 0) return markdown;
  const bodyStart = start + heading.length;
  const level = (heading.match(/^#+/) || ['###'])[0].length;
  const nextHeading = markdown
    .slice(bodyStart)
    .match(new RegExp(`\\n#{1,${level}}\\s`));
  const bodyEnd = nextHeading ? bodyStart + nextHeading.index : markdown.length;
  const prefix = markdown.slice(0, start);
  const pageBreak = prefix.match(/\n<div class="page-break"><\/div>\n\n$/);
  const sectionStart = pageBreak ? start - pageBreak[0].length : start;
  return markdown.slice(0, sectionStart) + markdown.slice(bodyEnd);
}

// ── Retry helper ─────────────────────────────────────────────────────────────
async function callWithRetry(fn, { tries = 3, baseMs = 4000 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const retriable = /timeout|aborted|ECONN|5\d\d|fetch failed/i.test(e.message || '');
      if (!retriable || i === tries - 1) throw e;
      const wait = baseMs * Math.pow(2, i);
      console.warn(`  ↻ 재시도 ${i + 1}/${tries - 1} (${wait}ms) — ${e.message}`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw last;
}

// ── DeepSeek streaming helper — PASS 1 (idle timeout 리셋으로 긴 생성 안전) ──
async function callDeepSeekStream(systemPrompt, userContent, maxTokens) {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  'Bearer ' + process.env.DEEPSEEK_API_KEY,
    },
    body: JSON.stringify({
      model:      'deepseek-v4-pro',
      max_tokens: maxTokens,
      stream:     true,
      messages:   [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userContent  },
      ],
    }),
    signal: AbortSignal.timeout(600000),  // 10 min hard cap; streaming keeps idle clock reset
  });
  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error('DeepSeek API HTTP ' + r.status + ': ' + body.slice(0, 200));
  }

  let text = '', finishReason = null, promptTokens = 0, completionTokens = 0;
  const reader  = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const json = trimmed.slice(6);
      if (json === '[DONE]') continue;
      try {
        const chunk = JSON.parse(json);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) text += delta;
        const fr = chunk.choices?.[0]?.finish_reason;
        if (fr) finishReason = fr;
        if (chunk.usage) {
          promptTokens     = chunk.usage.prompt_tokens     || 0;
          completionTokens = chunk.usage.completion_tokens || 0;
        }
      } catch (_) {}
    }
  }

  return {
    content:     [{ type: 'text', text }],
    stop_reason: finishReason === 'length' ? 'max_tokens' : 'end_turn',
    usage:       { input_tokens: promptTokens, output_tokens: completionTokens },
  };
}

// ── Core 2-pass engine ───────────────────────────────────────────────────────

async function runSection({ client, sectionConfig, items, styleGuide, month,
                            indexTable = null, indexFactText = null,
                            railTable = null, railFactText = null,
                            oceanBlocks = null,
                            airBundle = null,
                            airTable = null, airFactText = null,
                            portThroughputTable = null, portThroughputFactText = null, portCongestionTable = null,
                            kitaSeaBundle = null, kitaAirBundle = null }) {
  if (items.length === 0) {
    console.log(`⚠️  [${sectionConfig.id}] 관련 기사 없음 → status: no-data`);
    return { status: 'no-data', text: '', pass1Tokens: 0, pass2Tokens: 0 };
  }

  // maxItems: 대형 섹션 프롬프트 과부하 방지 (region 25, macro/policy 30 등)
  const cappedItems = sectionConfig.maxItems ? items.slice(0, sectionConfig.maxItems) : items;
  if (cappedItems.length < items.length)
    console.log(`   ↓ maxItems 적용: ${items.length} → ${cappedItems.length}건`);

  const kitaFactText = (kitaSeaBundle && kitaSeaBundle.factText) || (kitaAirBundle && kitaAirBundle.factText) || null;
  const systemPrompt = buildSectionSystemPrompt(styleGuide, sectionConfig.focus);
  const userPrompt   = buildSectionUserPrompt(sectionConfig.title, cappedItems, month, indexFactText, railFactText, airFactText, portThroughputFactText, kitaFactText, sectionConfig.topicGuides);

  // PASS 1: 초안 생성 — DEEPSEEK_API_KEY 설정 시 deepseek-v4-pro(스트리밍), 미설정 시 claude-sonnet-4-6
  const pass1Model = process.env.DEEPSEEK_API_KEY ? 'deepseek-v4-pro (stream)' : 'claude-sonnet-4-6';
  console.log(`⏳ [${sectionConfig.id}] PASS 1 — 초안 생성 (${pass1Model})...`);
  const pass1Res = await callWithRetry(
    () => process.env.DEEPSEEK_API_KEY
      ? callDeepSeekStream(systemPrompt, userPrompt, 12000)
      : client.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 12000,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }],
        }),
    { tries: 3, baseMs: 4000 }
  );
  const draft = pass1Res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const p1In  = pass1Res.usage?.input_tokens  || 0;
  const p1Out = pass1Res.usage?.output_tokens || 0;
  console.log(`   ✓ PASS 1 완료 (출력 ${p1Out} / 입력 ${p1In} tokens)`);
  if (pass1Res.stop_reason === 'max_tokens')
    console.warn(`   ⚠️ PASS 1이 max_tokens에서 잘림! 상향 필요`);

  // PASS 2: 자기검수 + 수정
  console.log(`⏳ [${sectionConfig.id}] PASS 2 — 자기검수·수정...`);
  const pass2Res = await callWithRetry(
    () => client.messages.create({
      model:      'claude-sonnet-4-6',
      max_tokens: 12000,
      system:     buildCritiqueSystemPrompt(styleGuide),
      messages:   [{ role: 'user', content: buildCritiqueUserPrompt(draft) }],
    }),
    { tries: 3, baseMs: 4000 }
  );
  let revised = pass2Res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
  const p2In  = pass2Res.usage?.input_tokens  || 0;
  const p2Out = pass2Res.usage?.output_tokens || 0;
  console.log(`   ✓ PASS 2 완료 (출력 ${p2Out} / 입력 ${p2In} tokens)`);
  if (pass2Res.stop_reason === 'max_tokens')
    console.warn(`   ⚠️ PASS 2가 max_tokens에서 잘림! 상향 필요`);

  // ocean 섹션: per-index 차트+표 주입 (02-1~02-5 각 소제목 아래, 둘째 지수부터 새 페이지)
  if (sectionConfig.id === 'ocean' && oceanBlocks && oceanBlocks.length) {
    oceanBlocks.forEach((b, idx) => {
      const pb = idx > 0 ? '<div class="page-break"></div>\n\n' : '';

      if (!b.table) {
        if (b.notice || b.omitWhenEmpty) {
          let noticeAnchor = null;
          for (const kw of b.headingKw) {
            const safe = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
            const m = revised.match(new RegExp('#{2,3}[^\\n]*' + safe + '[^\\n]*'));
            if (m) { noticeAnchor = m[0]; break; }
          }
          if (noticeAnchor) {
            if (b.omitWhenEmpty) {
              revised = removeSection(revised, noticeAnchor);
              return;
            }
            if (pb) revised = revised.replace(noticeAnchor, pb + noticeAnchor);
            revised = replaceSectionContent(revised, noticeAnchor, '\n\n> ⚠️ **' + b.notice + '**\n\n');
          }
        }
        return;
      }
      let anchor = null;
      for (const kw of b.headingKw) {
        const safe = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
        const m = revised.match(new RegExp('#{2,3}[^\\n]*' + safe + '[^\\n]*'));
        if (m) { anchor = m[0]; break; }
      }
      const chart = b.chart ? `\n\n[[CHART:${b.chart}]]` : '';
      const inject = `${chart}\n\n${b.table}\n`;
      if (anchor) revised = revised.replace(anchor, `${pb}${anchor}${inject}`);
      else        revised += `\n\n${pb}### (${b.id.toUpperCase()} 표)${inject}`;
    });
    // 벙커유는 KITA 참고운임과 별도 블록으로 분리한다.
    const bunkerM = revised.match(/#{2,3}[^\n]*(?:벙커유|벙커\s*유)[^\n]*/i);
    if (bunkerM) {
      revised = revised.replace(bunkerM[0], `${bunkerM[0]}\n\n[[CHART:ocean_bunker]]\n`);
    } else {
      revised += '\n\n<div class="page-break"></div>\n\n### 02-8. 벙커유 가격 추이\n\n[[CHART:ocean_bunker]]\n';
    }

    // KITA 부산발 참고운임 — 벙커유와 분리된 02-9 블록으로 주입한다.
    const kita09 = revised.match(/#{2,3}[^\n]*(?:02-9|KITA)[^\n]*/i);
    if (kitaSeaBundle && kitaSeaBundle.table) {
      const inject = '\n\n[[CHART:kita_sea]]\n\n' + kitaSeaBundle.table + '\n';
      if (kita09) {
        revised = revised.replace(kita09[0], '<div class="page-break"></div>\n\n' + kita09[0] + inject);
      } else {
        revised += '\n\n<div class="page-break"></div>\n\n## 02-9. KITA 부산발 해상 운임' + inject;
      }
    } else if (!kita09) {
      revised += '\n\n## 02-9. KITA 부산발 해상 운임\n\n> ⚠️ **KITA 해상 운임 미수집** — 다음 호 업데이트 예정.\n';
    }
  } else if (indexTable) {
    // 운임 지수 표 삽입 (01. 핵심 시황 섹션)
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
  }

  // rail Landbridge 정량 표 삽입 — 04-1 (중국-유럽) 소제목 아래
  if (railTable) {
    const anchor =
      revised.match(/#{2,3}[^\n]*04-1[^\n]*/) ||
      revised.match(/#{2,3}[^\n]*(?:중국.유럽|中欧|중구반열|TCR)[^\n]*/i);
    if (anchor) {
      revised = revised.replace(anchor[0], `${anchor[0]}\n\n${railTable}\n`);
    } else {
      revised += `\n\n${railTable}\n`;
    }
  }

  // air 섹션: 03-1 IATA, 03-2 KITA 한국발, 03-3 TAC/BAI 보조 추세 순서로 주입.
  // 섹션 제목(# NN.) 앞에 삽입하면 PDF에서 섹션 디바이더 이전 페이지에 렌더링되므로 반드시 제목 뒤에 삽입.
  if (sectionConfig.id === 'air') {
    const ab = airBundle;

    // 03-1: IATA 권역별 표
    if (ab?.iataTable) {
      const anchor = revised.match(/#{2,3}[^\n]*(?:03-1|IATA|권역별)[^\n]*/);
      if (anchor) {
        revised = revised.replace(anchor[0], anchor[0] + '\n\n' + ab.iataTable + '\n');
      }
    }

    // 03-2: KITA 인천발 참고운임
    if (kitaAirBundle && kitaAirBundle.table) {
      const anchor = revised.match(/#{2,3}[^\n]*(?:03-2|KITA|한국발|인천발)[^\n]*/);
      const inject = '\n\n[[CHART:kita_air]]\n\n' + kitaAirBundle.table + '\n';
      if (anchor) {
        const at = revised.indexOf(anchor[0]) + anchor[0].length;
        revised = revised.slice(0, at) + inject + revised.slice(at);
      }
    }

    // 03-3: Superset TAC 추세 차트와 표
    if (ab?.chartData) {
      const anchor = revised.match(/#{2,3}[^\n]*(?:03-3|TAC|BAI|추세|시계열)[^\n]*/);
      if (anchor) {
        revised = revised.replace(anchor[0], anchor[0] + '\n\n[[CHART:air_rate]]\n');
      }
      // Superset 표도 있으면 차트 아래에 추가
      if (ab.supersetTable && anchor) {
        const anchorUpdated = revised.match(/#{2,3}[^\n]*(?:03-3|TAC|BAI|추세|시계열)[^\n]*/);
        if (anchorUpdated) {
          const afterChart = anchorUpdated[0] + '\n\n[[CHART:air_rate]]\n';
          revised = revised.replace(afterChart, afterChart + '\n' + ab.supersetTable + '\n');
        }
      }
    } else {
      // Superset 없음 → 03-3 소제목 아래에 notice 삽입
      const notice = '\n\n> ⚠️ **항공 운임 추세 차트 미수집** — Superset 접속 실패. BAI 스냅샷으로 현황 대체.\n\n';
      const anchor = revised.match(/#{2,3}[^\n]*(?:03-3|TAC|BAI|추세|시계열)[^\n]*/);
      if (anchor) {
        const at = revised.indexOf(anchor[0]) + anchor[0].length;
        revised = revised.slice(0, at) + notice + revised.slice(at);
      }
    }

    // BAI 스냅샷 표는 TAC 보조 데이터로 03-3 하단에 배치한다.
    if (ab?.baiTable) {
      const anchor = revised.match(/#{2,3}[^\n]*(?:03-3|TAC|BAI|추세|시계열)[^\n]*/);
      if (anchor) {
        const at = revised.indexOf(anchor[0]) + anchor[0].length;
        revised = revised.slice(0, at) + '\n\n' + ab.baiTable + '\n' + revised.slice(at);
      }
    }

    // 03-3 보조: IATA 제트유 (cost 팩터)
    if (ab?.jetFuelTable) {
      const fa = revised.match(/#{2,3}[^\n]*(?:03-3|TAC|BAI|추세|시계열|항공유|연료)[^\n]*/);
      if (fa) { const at = revised.indexOf(fa[0]) + fa[0].length; revised = revised.slice(0, at) + '\n\n' + ab.jetFuelTable + '\n' + revised.slice(at); }
      else    { revised += '\n\n' + ab.jetFuelTable + '\n'; }
    }

    // 완전 미수집인 경우 (airBundle 자체가 null)
    if (!ab) {
      const notice = '\n\n> ⚠️ **이번 회차 항공 데이터 미수집** — TAC/BAI·IATA 수집 실패. 다음 호 업데이트 예정.\n\n';
      const subAnchor = revised.match(/\n#{2,3}[^\n]*/);
      if (subAnchor) {
        const at = revised.indexOf(subAnchor[0]) + subAnchor[0].length;
        revised = revised.slice(0, at) + notice + revised.slice(at);
      } else {
        const secAnchor = revised.match(/^#\s[^\n]*/m);
        if (secAnchor) {
          const at = revised.indexOf(secAnchor[0]) + secAnchor[0].length;
          revised = revised.slice(0, at) + notice + revised.slice(at);
        } else {
          revised = notice + revised;
        }
      }
    }
  }

  // macro 섹션: 항만 물동량(06-2) + 혼잡도(06-3) 주입.
  // 둘은 같은 06-2 앵커를 공유하므로 단일 블록으로 묶어 throughput→혼잡도 순서를 보장한다
  // (분리 주입 시 혼잡도가 헤딩 직후로 끼어들어 throughput 위로 올라오는 문제 방지).
  if (sectionConfig.id === 'macro') {
    const macroBlocks = [];
    if (portThroughputTable) macroBlocks.push('[[CHART:macro_port_throughput]]\n\n' + portThroughputTable);
    if (portCongestionTable)  macroBlocks.push('#### 항만 혼잡도\n\n' + portCongestionTable);
    if (macroBlocks.length) {
      const inject = '\n\n' + macroBlocks.join('\n\n') + '\n';
      const anchor = revised.match(/#{2,3}[^\n]*(?:06-3|혼잡|체선|congestion|대기)[^\n]*/i)
                  || revised.match(/#{2,3}[^\n]*(?:06-2|물동량|처리량|throughput)[^\n]*/i)
                  || revised.match(/#{2,3}[^\n]*/);
      if (anchor) { const at = revised.indexOf(anchor[0]) + anchor[0].length; revised = revised.slice(0, at) + inject + revised.slice(at); }
      else        revised += inject;
    } else {
      const notice = '\n\n> ⚠️ **이번 회차 항만 물동량 데이터 미수집** — RWI-ISL·ISL 수집 실패. 운임 데이터로 대체 분석.\n\n';
      const anchor = revised.match(/\n#{2,3}[^\n]*/);
      if (anchor) {
        const at = revised.indexOf(anchor[0]) + anchor[0].length;
        revised = revised.slice(0, at) + notice + revised.slice(at);
      } else {
        revised = notice + revised;
      }
    }
  }

  // Air 섹션: WorldACD 강제 제거 — airBundle 주입 이후에 실행해야 캐시 데이터도 제거됨
  if (sectionConfig.id === 'air') {
    revised = revised
      .replace(/\|[^\n]*WorldACD[^\n]*\n?/gi, '')
      .replace(/[^\n]*WorldACD[^\n]*(?:USD\/kg|\/kg|달러)[^\n]*/gi, '')
      .replace(/[^\n]*월드와이드[^\n]*(?:\/kg|달러)[^\n]*/gi, '')
      .replace(/^\|[^\n]+\|\n\|[-| ]+\|\s*\n(?!\|)/gm, '')
      .replace(/\n{3,}/g, '\n\n').trim();
    console.log(`   ✓ air 섹션 WorldACD 스트립 완료`);
    // 검증된 WorldACD 실데이터가 있으면 주입(스트립으로 지운 자리 대체). 없으면 스트립만 유지.
    if (airBundle?.worldacdTable) {
      const wa = revised.match(/#{2,3}[^\n]*(?:03-3|TAC|BAI|추세|시계열|운임)[^\n]*/i);
      const inject = '\n\n#### WorldACD 글로벌 주간 운임\n\n' + airBundle.worldacdTable + '\n';
      if (wa) { const at = revised.indexOf(wa[0]) + wa[0].length; revised = revised.slice(0, at) + inject + revised.slice(at); }
      else    { revised += inject; }
      console.log(`   ✓ air 섹션 WorldACD 실데이터 주입`);
    }
  }

  // 최종 산출물(pass2 + 표 주입 후)에 스타일 정규화 — 키워드 단독 Bold·소제목 끝 마침표 제거.
  // 반드시 반환 직전(모든 주입 이후)에 1회 — 중간 단계가 아닌 최종 revised가 통과해야 함.
  revised = normalizeMonthlyReportMarkdown(revised);
  return { status: 'draft', text: revised, pass1Tokens: p1Out, pass2Tokens: p2Out };
}

// ── File I/O ─────────────────────────────────────────────────────────────────

function saveSectionFile(outDir, sectionId, month, status, text, extra = {}) {
  text = normalizeMonthlyReportMarkdown(text);   // 파일 기록 경로 안전망 (반환값 외 호출 대비)
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
