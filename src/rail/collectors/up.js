const crypto = require('node:crypto');
const cheerio = require('cheerio');

const LIST_URL = 'https://www.up.com/announcements/customer-news';
const BASE = 'https://www.up.com';
const UA = 'LogisightRailMonitor/0.1 (+research)';

const TITLE_EXCLUDE = [
  /accessorial charges/i,
  /operating plan/i,
  /merger/i,
  /rates after the merger/i,
  /status of the railroad/i,
  /stb application/i,
  /switching tariff/i,
];

function sha(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function cleanText(value) {
  return (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function detailUrlFromHref(href) {
  return href.startsWith('http') ? href : new URL(href, BASE).href;
}

function sourceUidFromUrl(detailUrl) {
  return detailUrl.match(/\/(CN\d{4}-\d+)$/i)?.[1] || sha(detailUrl).slice(0, 16);
}

async function collectUp({ fetchImpl = fetch } = {}) {
  const out = { source: 'up', items: [], errors: [] };

  let listHtml;
  try {
    const response = await fetchImpl(LIST_URL, { headers: { 'User-Agent': UA } });
    if (!response.ok) throw new Error(`list HTTP ${response.status}`);
    listHtml = await response.text();
  } catch (error) {
    out.errors.push(`list fetch: ${error.message}`);
    return out;
  }

  const $ = cheerio.load(listHtml);
  const cards = [];
  $('.up-suggested-posts__card.js-suggestedPosts-card').each((_, element) => {
    const link = $(element).find('.up-suggested-posts__title.js-suggestedPosts-title');
    const title = cleanText(link.text());
    const href = link.attr('href');
    const date = cleanText($(element).find('.up-suggested-posts__date.js-suggestedPosts-date').text());
    if (title && href) cards.push({ title, href, date });
  });

  for (const card of cards) {
    if (TITLE_EXCLUDE.some((pattern) => pattern.test(card.title))) continue;

    const detailUrl = detailUrlFromHref(card.href);
    const sourceUid = sourceUidFromUrl(detailUrl);

    try {
      const response = await fetchImpl(detailUrl, { headers: { 'User-Agent': UA } });
      if (!response.ok) throw new Error(`detail HTTP ${response.status}`);
      const detail = cheerio.load(await response.text());
      const title = cleanText(detail('h1').first().text()) || card.title;
      const date = cleanText(detail('.up-post-detail-hero__date, [class*="date"]').first().text()) || card.date;
      const body = cleanText(detail('.up-post-detail-hero-wysiwyg .up-rich-text').first().text());

      out.items.push({
        source_uid: sourceUid,
        url: detailUrl,
        title,
        date,
        body,
        checksum: sha(`${title}|${date}|${body}`),
      });
    } catch (error) {
      out.errors.push(`detail ${sourceUid}: ${error.message}`);
    }
  }

  return out;
}

module.exports = { collectUp, LIST_URL };
