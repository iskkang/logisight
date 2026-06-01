'use strict';
// OG 이미지 → base64 DataURI 변환 헬퍼 (build-featured.js / monthly-report-pdf.js 공유)
async function fetchOgImage(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LogisightBot/1.0)' } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
           || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)
           || html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i);
    if (!m) return null;
    let img = m[1].replace(/&amp;/g, '&');
    if (img.startsWith('//')) img = 'https:' + img;
    else if (img.startsWith('/')) { const u = new URL(url); img = u.origin + img; }
    const ir = await fetch(img, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!ir.ok) return null;
    const ct = (ir.headers.get('content-type') || 'image/jpeg').split(';')[0];
    if (!/^image\//.test(ct)) return null;
    const buf = Buffer.from(await ir.arrayBuffer());
    if (buf.length > 3_000_000) return null;  // 3MB 초과 스킵
    return `data:${ct};base64,${buf.toString('base64')}`;
  } catch (_) { return null; }
}

module.exports = { fetchOgImage };
