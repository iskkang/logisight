const crypto = require('node:crypto');
const { ruleParseEvent } = require('../ruleParseEvent');
const { matchCorridors } = require('../matchCorridors');
const { scoreEvent } = require('../scoreEvent');

const ARTICLE_TABLE = 'maritime_news';
const RAIL_CATEGORY = '\ucca0\ub3c4';
const NA_RAIL_CATEGORY = '\ucca0\ub3c4-\ubd81\ubbf8';

const STRONG = new Set(['embargo', 'derailment', 'line_out_of_service', 'service_interruption', 'congestion']);
const MACRO_EXCLUDE = [
  /\b(scfi|wci|kcci|fbx|xsi|bdi|worldacd|iata)\b/i,
  /\bindex\b|round[- ]?up|weekly (recap|summary|update)/i,
  /\bmarket,\s*week\b/i,
];

const SUBJECT_ALIASES = {
  BNSF: [/\bbnsf\b/i],
  UP: [/\bunion pacific\b/i],
  CN: [/\bcanadian national\b/i, /\bcn rail\b/i],
  CPKC: [/\bcpkc\b/i, /\bcanadian pacific\b/i],
  NS: [/\bnorfolk southern\b/i],
  CSX: [/\bcsx\b/i],
};

function sha(value) {
  return crypto.createHash('sha256').update(value || '').digest('hex');
}

function toISODate(value) {
  if (!value) return null;
  const isoDate = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDate) return isoDate[1];
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
}

function cleanText(value) {
  return (value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function railroadInSubject(railroad, title, lead) {
  const aliases = SUBJECT_ALIASES[railroad];
  if (!aliases) return false;
  const hay = `${title} ${lead}`;
  return aliases.some((pattern) => pattern.test(hay));
}

function leadFromArticle(article) {
  return cleanText(article.summary || article.content || '').slice(0, 400);
}

function publisherSlug(value) {
  return cleanText(value || 'news').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'news';
}

async function collectNews({ supabase, sinceDays = 21 } = {}) {
  const out = { source: 'news', rows: [], errors: [], stats: { read: 0, mapped: 0 } };
  if (!supabase) {
    out.errors.push('missing supabase client');
    return out;
  }

  const sinceISO = new Date(Date.now() - sinceDays * 864e5).toISOString();
  let articles;
  try {
    const { data, error } = await supabase
      .from(ARTICLE_TABLE)
      .select('id,title,summary,content,url,source,published_at,category')
      .in('category', [RAIL_CATEGORY, NA_RAIL_CATEGORY])
      .gte('published_at', sinceISO);
    if (error) throw error;
    articles = data ?? [];
  } catch (error) {
    out.errors.push(`article read: ${error.message}`);
    return out;
  }

  out.stats.read = articles.length;
  for (const article of articles) {
    const title = cleanText(article.title);
    const lead = leadFromArticle(article);
    if (!title || !lead) continue;
    if (MACRO_EXCLUDE.some((pattern) => pattern.test(title))) continue;

    const parsed = ruleParseEvent(`${title}\n${lead}`, { source: 'news', location_text: title });
    if (!STRONG.has(parsed.event_type)) continue;

    const match = matchCorridors(parsed);
    if (match.scope !== 'specific' || !match.corridorCodes.length) continue;
    if (!railroadInSubject(parsed.railroad, title, lead)) continue;

    const publisher = publisherSlug(article.source);
    const sourceUid = String(article.id ?? sha(article.url || title)).slice(0, 64);
    const score = Math.round(scoreEvent(parsed, 'specific') * 0.85);

    out.rows.push({
      source: `news:${publisher}`,
      source_uid: sourceUid,
      checksum: sha(`${title}|${lead}`),
      event_type: parsed.event_type,
      severity: parsed.severity,
      railroad: parsed.railroad,
      location_text: title,
      affected_corridors: match.corridorCodes,
      scope: 'specific',
      score,
      summary: title.slice(0, 200),
      evidence_text: lead.slice(0, 1000),
      confidence_score: 0.6,
      start_date: toISODate(article.published_at),
      end_date: null,
    });
    out.stats.mapped += 1;
  }

  return out;
}

module.exports = { collectNews, ARTICLE_TABLE, RAIL_CATEGORY, NA_RAIL_CATEGORY };
