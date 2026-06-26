const crypto = require('node:crypto');
const cheerio = require('cheerio');

const LIST_URL = 'https://www.bnsf.com/news-media/customer-notifications/library.page?type=service';
const BASE = 'https://www.bnsf.com';
const UA = 'LogisightRailMonitor/0.1 (+research)';

const TITLE_EXCLUDE = [/weekly surface transportation board update/i];

function sha(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function cleanText(value) {
  return (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function detailUrlFromHref(href) {
  return href.startsWith('http') ? href : new URL(href, BASE).href;
}

async function collectBnsf({ fetchImpl = fetch } = {}) {
  const out = { source: 'bnsf', items: [], errors: [] };

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
  $('.media-asset[data-type="service"]').each((_, element) => {
    const link = $(element).find('.media-asset-copy h3 a');
    const title = cleanText(link.text());
    const href = link.attr('href');
    const date = cleanText($(element).find('.media-asset-copy p.date').text());
    if (title && href) cards.push({ title, href, date });
  });

  for (const card of cards) {
    if (TITLE_EXCLUDE.some((pattern) => pattern.test(card.title))) continue;

    const detailUrl = detailUrlFromHref(card.href);
    const sourceUid = new URL(detailUrl).searchParams.get('notId') || sha(detailUrl).slice(0, 16);

    try {
      const response = await fetchImpl(detailUrl, { headers: { 'User-Agent': UA } });
      if (!response.ok) throw new Error(`detail HTTP ${response.status}`);
      const detail = cheerio.load(await response.text());
      const title = cleanText(detail('.page.single-article h1').text()) || card.title;
      const date = cleanText(detail('.single-sidebar p.date').text()).replace(/^Date\s*/i, '') || card.date;
      const body = detail('.single-content-bottom > p')
        .map((_, paragraph) => cleanText(detail(paragraph).text()))
        .get()
        .filter(Boolean)
        .join('\n')
        .trim();

      out.items.push({
        source_uid: sourceUid,
        url: detailUrl,
        title,
        date,
        body,
        checksum: sha(`${title}|${body}`),
      });
    } catch (error) {
      out.errors.push(`detail ${sourceUid}: ${error.message}`);
    }
  }

  return out;
}

module.exports = { collectBnsf, LIST_URL };
