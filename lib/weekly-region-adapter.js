// 순수 함수. region JSON(rich: items[] + selection) → 렌더 모델.
// 빈 블록(아이템·인트로 모두 없음)은 생략(gating).
function adapt(json, meta) {
  const items = json.items || json.articles || [];
  const byType = { news: [], policy: [], trade: [] };
  for (const it of items) {
    (byType[it.briefType] || byType.news).push({
      tag: it.tag || it.category || it.briefType || '',
      headline: it.headline || it.title || '',
      lead: it.lead || it.summary || it.description || '',
      image: it.image || it.image_url || it.ogImage || null,  // 없으면 카드에서 이미지 생략
      body: it.body || it.content || '',
      source: it.source || it.publisher || '',
    });
  }
  const sel = json.selection || {};
  const defs = [
    { key: 'news', title: '운영 동향' },
    { key: 'policy', title: '정책·거시' },
    { key: 'trade', title: '무역량 동향' },
  ];
  const blocks = defs
    .map((d) => ({ title: d.title, intro: String(sel[d.key] || '').trim(), items: byType[d.key] }))
    .filter((b) => b.items.length > 0 || b.intro);   // 빈 블록 생략

  return {
    coverTitle: meta.coverTitle,
    regionEn: meta.en,
    week: json.week || json.week_of || '',
    period: json.period || '',
    summary: String(sel.content || '').trim(),
    blocks,
  };
}

module.exports = { adapt };
