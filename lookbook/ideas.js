const SEARCH_READER_URL = 'https://r.jina.ai/http://https://www.bing.com/search?q=';
const IDEA_FETCH_TIMEOUT_MS = 12000;
const DEFAULT_IDEA_PROMPT = 'minimal neutral everyday outfit inspiration';

const INSPIRATION_SOURCE_LABELS = {
  all: 'Influencers + style sites',
  influencer: 'Influencers',
  pinterest: 'Pinterest',
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  street: 'Street style',
  blogs: 'Style blogs'
};

async function fetchInspirationIdeas(promptText, source = 'all') {
  const query = buildInspirationQuery(promptText, source);
  const markdown = await fetchSearchMarkdown(query);
  return parseBingMarkdownResults(markdown)
    .filter(result => isUsefulIdeaResult(result, source))
    .slice(0, 8)
    .map(result => ({
      ...result,
      sourceType: getResultSourceType(result.url),
      shoppingQuery: buildProductQuery(result)
    }));
}

async function fetchProductLinksForIdea(idea) {
  const query = buildProductQuery(idea);
  const markdown = await fetchSearchMarkdown(query);
  const productResults = parseBingMarkdownResults(markdown)
    .filter(result => /office\.co\.uk\/view\/product\/office_catalog/i.test(result.url))
    .slice(0, 6);

  return productResults.length ? productResults : getOfficeFallbackLinks(idea);
}

async function fetchSearchMarkdown(query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDEA_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(SEARCH_READER_URL + encodeURIComponent(query), {
      signal: controller.signal
    });
    if (!res.ok) throw new Error('search_error');
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function buildInspirationQuery(promptText, source = 'all') {
  const base = sanitizeSearchText(promptText || DEFAULT_IDEA_PROMPT);
  const fashionBase = `"${base}" "outfit ideas" fashion style -definition -dictionary`;
  const sourceQueries = {
    all: `${fashionBase} influencer street style menswear`,
    influencer: `${fashionBase} influencer Tim Dessaint Daniel Simmons Harry Has`,
    pinterest: `site:pinterest.com ${fashionBase} inspiration`,
    youtube: `site:youtube.com/watch ${fashionBase}`,
    instagram: `site:instagram.com ${fashionBase} inspiration`,
    tiktok: `site:tiktok.com ${fashionBase} inspiration`,
    street: `${fashionBase} street style`,
    blogs: `${fashionBase} style guide blog`
  };

  return sourceQueries[source] || sourceQueries.all;
}

function buildProductQuery(idea) {
  const terms = extractShoppingTerms(`${idea.title || ''} ${idea.snippet || ''}`);
  return `"www.office.co.uk/view/product/office_catalog" ${terms} shoes`;
}

function getShoppingSearchUrls(idea) {
  const terms = encodeURIComponent(extractShoppingTerms(`${idea.title || ''} ${idea.snippet || ''}`));
  return [
    { label: 'Office products', url: `https://www.bing.com/search?q=site%3Aoffice.co.uk%2Fview%2Fproduct%2Foffice_catalog+${terms}` },
    { label: 'Pinterest', url: `https://www.pinterest.com/search/pins/?q=${terms}` },
    { label: 'Google Shopping', url: `https://www.google.com/search?tbm=shop&q=${terms}` }
  ];
}

function getOfficeFallbackLinks(idea) {
  const terms = extractShoppingTerms(`${idea.title || ''} ${idea.snippet || ''}`).toLowerCase();
  const links = [];

  if (/trainer|sneaker|white|casual/.test(terms)) {
    links.push({
      title: 'Office men\'s trainers',
      url: 'https://www.office.co.uk/mens/trainers',
      snippet: 'Browse Office trainer styles matching the inspiration terms.'
    });
    links.push({
      title: 'Office men\'s casual trainers',
      url: 'https://www.office.co.uk/mens/casual-trainers',
      snippet: 'Browse smart-casual trainer options from Office.'
    });
  }

  if (/loafer|derby|oxford|brogue|smart|leather|suede|black|brown|tan/.test(terms) || links.length === 0) {
    links.push({
      title: 'Office men\'s smart shoes',
      url: 'https://www.office.co.uk/mens/smart-shoes',
      snippet: 'Browse loafers, derbies, oxfords, brogues, and leather smart shoes at Office.'
    });
  }

  return links.slice(0, 3);
}

function parseBingMarkdownResults(markdown) {
  const text = String(markdown || '');
  const results = [];
  const resultRegex = /(?:^|\n)\s*\d+\.\s+##\s+\[(.*?)\]\((.*?)\)\s*\n+([\s\S]*?)(?=\n\s*\d+\.\s+##\s+\[|$)/g;
  let match;

  while ((match = resultRegex.exec(text)) !== null) {
    const title = cleanMarkdownText(match[1]);
    const url = resolveSearchUrl(match[2]);
    const snippet = cleanMarkdownText(match[3]).replace(/\s+/g, ' ').trim();

    if (title && url) {
      results.push({ title, url, snippet });
    }
  }

  return dedupeResults(results);
}

function resolveSearchUrl(url) {
  const direct = decodeHtmlEntitiesPlain(String(url || '').trim());
  if (!direct) return '';

  try {
    const parsed = new URL(direct, 'https://www.bing.com');
    const encodedTarget = parsed.searchParams.get('u');
    const decodedTarget = encodedTarget ? decodeBingTarget(encodedTarget) : '';
    return decodedTarget || parsed.href;
  } catch {
    return direct;
  }
}

function decodeBingTarget(value) {
  const raw = String(value || '').replace(/^a1/i, '');
  if (!raw) return '';

  try {
    const base64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    return decodeURIComponent(escape(atob(padded)));
  } catch {
    return '';
  }
}

function cleanMarkdownText(value) {
  return decodeHtmlEntitiesPlain(String(value || '')
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/#+/g, '')
    .trim());
}

function decodeHtmlEntitiesPlain(value) {
  const el = document.createElement('textarea');
  el.innerHTML = value;
  return el.value;
}

function dedupeResults(results) {
  const seen = new Set();
  return results.filter(result => {
    const key = result.url.replace(/[?#].*$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isUsefulIdeaResult(result, source) {
  const lowerUrl = result.url.toLowerCase();
  const lowerText = `${result.title} ${result.snippet}`.toLowerCase();

  if (/bing\.com|microsoft\.com|google\.com\/search|accounts\.google|support\.google/.test(lowerUrl)) return false;
  if (/merriam-webster|cambridge\.org\/dictionary|dictionary\.com|thesaurus\.com/.test(lowerUrl)) return false;
  if (/app store|google play|download|login|sign in|privacy policy|definition|meaning|synonym/.test(lowerText)) return false;
  if (source === 'youtube' && !/youtube\.com\/watch|youtu\.be\//.test(lowerUrl)) return false;
  if (source === 'pinterest' && !/pinterest\./.test(lowerUrl)) return false;
  if (source === 'instagram' && !/instagram\.com/.test(lowerUrl)) return false;
  if (source === 'tiktok' && !/tiktok\.com/.test(lowerUrl)) return false;

  return /outfit|style|fashion|wardrobe|menswear|street|inspiration|look/i.test(lowerText + ' ' + lowerUrl);
}

function getResultSourceType(url) {
  const host = (() => {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  })();

  if (/youtube\.com|youtu\.be/.test(host)) return 'YouTube';
  if (/pinterest\./.test(host)) return 'Pinterest';
  if (/instagram\.com/.test(host)) return 'Instagram';
  if (/tiktok\.com/.test(host)) return 'TikTok';
  if (/office\.co\.uk/.test(host)) return 'Office';
  return host || 'Web';
}

function extractShoppingTerms(text) {
  const stopWords = new Set([
    'about', 'after', 'also', 'and', 'are', 'best', 'but', 'can', 'for', 'from',
    'guide', 'has', 'have', 'how', 'ideas', 'inspiration', 'into', 'look',
    'looks', 'men', 'mens', 'outfit', 'outfits', 'style', 'the', 'this', 'that',
    'their', 'with', 'women', 'womens', 'you', 'your'
  ]);
  const preferred = [
    'loafer', 'loafers', 'trainer', 'trainers', 'sneaker', 'sneakers', 'derby',
    'oxford', 'brogue', 'brogues', 'boot', 'boots', 'leather', 'suede', 'black',
    'brown', 'tan', 'white', 'navy', 'cream', 'minimal', 'smart', 'casual'
  ];
  const words = sanitizeSearchText(text).toLowerCase().split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word));
  const picked = [
    ...preferred.filter(word => words.includes(word)),
    ...words.filter(word => !preferred.includes(word))
  ];

  return [...new Set(picked)].slice(0, 8).join(' ') || 'smart casual shoes';
}

function sanitizeSearchText(value) {
  return String(value || '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[^\w\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
