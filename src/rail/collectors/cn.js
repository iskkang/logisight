const crypto = require('node:crypto');
const cheerio = require('cheerio');

const LIST_URL = 'https://www.cn.ca/en/customer-centre/stay-informed/customer-news/';
const ORIGIN = 'https://www.cn.ca';
const UA = 'LogisightRailMonitor/0.1 (+research)';

const CATEGORY_VALUES = [
  '{565E7C01-BE15-43E9-BB7C-1CEC9A6E69A5}', // Blockades
  '{1B47DBE8-72BD-4246-BDBA-A1FFD2D3678A}', // Intermodal
  '{31534A6F-746E-4E49-98A2-FB7EC6A926FB}', // Bulletins
];

const TITLE_EXCLUDE = [
  /gate hours/i,
  /weight restriction/i,
  /bargaining/i,
  /fuel surcharge/i,
  /tariff/i,
  /\bsurvey\b/i,
  /brochure/i,
];

function sha(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function cleanText(value) {
  return (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function absoluteUrl(href) {
  return href.startsWith('http') ? href : new URL(href, ORIGIN).href;
}

function sourceUidFromUrl(url) {
  return url.match(/\/news\/(\d{4}\/\d{2}\/[^/?#]+)/)?.[1] || sha(url).slice(0, 16);
}

function hiddenField($, name) {
  return $(`[name="${name}"]`).attr('value') || '';
}

async function fetchHtml(url, { fetchImpl, body } = {}) {
  const response = await fetchImpl(url, {
    method: body ? 'POST' : 'GET',
    headers: {
      'User-Agent': UA,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function categoryRequestBody($, categoryValue) {
  const params = new URLSearchParams();
  for (const name of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
    params.set(name, hiddenField($, name));
  }
  params.set('ctl00$BaseLayout$phbottomcontent_0$ddlYear', '2026');
  params.set('ctl00$BaseLayout$phbottomcontent_0$ddlQuarter', '---');
  params.set('ctl00$BaseLayout$phbottomcontent_0$ddlCategories', categoryValue);
  params.set('ctl00$BaseLayout$phbottomcontent_0$btnView', 'View');
  return params;
}

function extractCards(html) {
  const $ = cheerio.load(html);
  const cards = [];
  $('.c-content-roll-up-filter .items .item').each((_, element) => {
    const link = $(element).find('.link a[href*="/en/news/"]').first();
    const title = cleanText(link.text());
    const href = link.attr('href');
    const date = cleanText($(element).find('.newsDate').text());
    if (title && href) cards.push({ title, href: absoluteUrl(href), date });
  });
  return cards;
}

async function collectCn({ fetchImpl = fetch } = {}) {
  const out = { source: 'cn', items: [], errors: [] };

  let listHtml;
  try {
    listHtml = await fetchHtml(LIST_URL, { fetchImpl });
  } catch (error) {
    out.errors.push(`list fetch: ${error.message}`);
    return out;
  }

  const list = cheerio.load(listHtml);
  const cards = extractCards(listHtml);

  for (const categoryValue of CATEGORY_VALUES) {
    try {
      const html = await fetchHtml(LIST_URL, { fetchImpl, body: categoryRequestBody(list, categoryValue) });
      cards.push(...extractCards(html));
    } catch (error) {
      out.errors.push(`category ${categoryValue}: ${error.message}`);
    }
  }

  const seen = new Set();
  for (const card of cards) {
    if (seen.has(card.href)) continue;
    seen.add(card.href);
    if (TITLE_EXCLUDE.some((pattern) => pattern.test(card.title))) continue;

    const sourceUid = sourceUidFromUrl(card.href);
    try {
      const html = await fetchHtml(card.href, { fetchImpl });
      const detail = cheerio.load(html);
      const title = cleanText(detail('h1.page-title').first().text()) || card.title;
      const body = detail('#BaseLayout_phleftcontent_0_divControlContent .rte_field p')
        .map((_, paragraph) => cleanText(detail(paragraph).text()))
        .get()
        .filter(Boolean)
        .join('\n')
        .trim();
      const leadDate = cleanText(detail('#BaseLayout_phleftcontent_0_divControlContent .rte_field').text())
        .match(/\b([A-Z][a-z]+ \d{1,2}, \d{4})\b/)?.[1];
      const date = leadDate || card.date;

      out.items.push({
        source_uid: sourceUid,
        url: card.href,
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

module.exports = { collectCn, LIST_URL };
