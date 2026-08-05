'use strict';
// 일본 기사 → 사이트 카테고리(海上/航空/港湾/鉄道/貿易/物流).
//
// 분류는 코드가 한다. LLM에 맡기면 같은 기사가 실행마다 다른 칸에 들어가고,
// 독자가 카테고리로 찾는 흐름이 무너진다. LLM은 요약만 쓴다.
//
// 두 매체의 태그는 매우 세분화돼 있다(LNEWS 80종·LOGISTICS TODAY 168종/20건).
// 태그를 그대로 쓸 수 없으므로 키워드로 묶는다. 태그가 없거나 안 걸리면
// 제목으로 한 번 더 본다 — 태그가 비는 기사가 실제로 있다.

// 순서가 우선순위다. 위에서 걸리면 아래는 보지 않는다.
// 港湾을 海上보다 먼저 둔다 — '港湾で海上コンテナ'처럼 둘 다 걸리는 기사는
// 항만 쪽이 더 구체적이다.
const RULES = [
  ['航空', ['航空', 'エアカーゴ', '空港', 'JAL', 'ANA', 'フェデックス', 'FedEx', 'DHL Express', '貨物機', 'ベリー']],
  ['鉄道', ['鉄道', '貨物列車', 'JR貨物', 'レール', '中欧班列']],
  ['港湾', ['港湾', '港運', 'ターミナル', '荷役', 'コンテナヤード', '接岸', '寄港', '港']],
  // '運賃'은 넣지 않는다 — 모드를 가리지 않는 말이라 트럭 운임 기사가 海上으로 간다
  //   (西濃運輸の新届出運賃 기사가 실제로 그랬다).
  ['海上', ['海運', '海上輸送', '海上コンテナ', '船社', '船腹', 'タンカー', 'バルク', 'フェリー', '内航', '外航', '傭船', '商船三井', '日本郵船', '川崎汽船', 'ONE']],
  ['貿易', ['貿易', '通関', '関税', '輸出入', '為替', '原産地', 'FTA', 'EPA']],
];

const FALLBACK = '物流';

/**
 * @param {{title?: string, tags?: string[]}} item
 * @param {string} [fallback] 매체가 전문지면 그 분야로 떨어뜨린다.
 *   日本海事新聞의 '紅海・アデン湾、針路変更相次ぐ'처럼 키워드에 안 걸리는 해사
 *   기사가 物流로 가면 어색하다. 키워드를 끝없이 늘리는 것보다 매체 성격을 쓴다.
 * @returns {'海上'|'航空'|'港湾'|'鉄道'|'貿易'|'物流'}
 */
function categorize(item, fallback) {
  const tags = (item && item.tags) || [];
  const title = (item && item.title) || '';
  // 태그를 먼저 본다. 매체가 붙인 분류라 제목보다 정확하다.
  for (const [cat, keys] of RULES) {
    if (tags.some((t) => keys.some((k) => String(t).includes(k)))) return cat;
  }
  for (const [cat, keys] of RULES) {
    if (keys.some((k) => title.includes(k))) return cat;
  }
  return fallback || FALLBACK;
}

module.exports = { categorize, RULES, FALLBACK };
