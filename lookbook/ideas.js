const SEARCH_READER_URL = 'https://r.jina.ai/http://https://www.bing.com/search?q=';
const PAGE_READER_URL = 'https://r.jina.ai/http://';
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
  try {
    const markdown = await fetchSearchMarkdown(query);
    const searchIdeas = parseBingMarkdownResults(markdown)
      .filter(result => isUsefulIdeaResult(result, source))
      .slice(0, 8)
      .map(normalizeIdeaResult);

    if (searchIdeas.length) return searchIdeas;
  } catch {
    // Use source fallbacks below when web search is blocked or times out.
  }

  return fetchFallbackInspirationIdeas(promptText, source);
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
  return fetchReaderText(SEARCH_READER_URL + encodeURIComponent(query));
}

async function fetchReaderText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IDEA_FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('search_error');
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchFallbackInspirationIdeas(promptText, source = 'all') {
  const shouldFetchPinterest = source === 'all' || source === 'pinterest';
  if (shouldFetchPinterest) {
    try {
      const markdown = await fetchReaderText(PAGE_READER_URL + buildPinterestSearchUrl(promptText));
      const ideas = parsePinterestMarkdownResults(markdown, promptText).slice(0, 8).map(normalizeIdeaResult);
      if (ideas.length) return ideas;
    } catch {
      // Fall back to source search cards below.
    }
  }

  return buildSourceSearchIdeas(promptText, source).map(normalizeIdeaResult);
}

function normalizeIdeaResult(result) {
  return {
    ...result,
    sourceType: result.sourceType || getResultSourceType(result.url),
    shoppingQuery: buildProductQuery(result)
  };
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

function buildPinterestSearchUrl(promptText) {
  return 'https://www.pinterest.com/search/pins/?q=' + encodeURIComponent(sanitizeSearchText(promptText || DEFAULT_IDEA_PROMPT));
}

function buildSourceSearchIdeas(promptText, source = 'all') {
  const query = sanitizeSearchText(promptText || DEFAULT_IDEA_PROMPT);
  const encoded = encodeURIComponent(`${query} outfit ideas`);
  const sources = {
    pinterest: [{
      title: `Pinterest ideas for ${query}`,
      url: buildPinterestSearchUrl(query),
      snippet: 'Open Pinterest inspiration results for this exact outfit prompt.',
      sourceType: 'Pinterest'
    }],
    youtube: [{
      title: `YouTube outfit ideas for ${query}`,
      url: `https://www.youtube.com/results?search_query=${encoded}`,
      snippet: 'Search YouTube creators and influencer videos for this outfit prompt.',
      sourceType: 'YouTube'
    }],
    instagram: [{
      title: `Instagram inspiration for ${query}`,
      url: `https://www.instagram.com/explore/search/keyword/?q=${encoded}`,
      snippet: 'Open Instagram search for public outfit inspiration posts.',
      sourceType: 'Instagram'
    }],
    tiktok: [{
      title: `TikTok outfit ideas for ${query}`,
      url: `https://www.tiktok.com/search?q=${encoded}`,
      snippet: 'Open TikTok search for short-form outfit inspiration.',
      sourceType: 'TikTok'
    }],
    influencer: [
      {
        title: `Tim Dessaint style search for ${query}`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`Tim Dessaint ${query} outfit ideas`)}`,
        snippet: 'Search Tim Dessaint videos for minimalist menswear inspiration.',
        sourceType: 'YouTube'
      },
      {
        title: `Daniel Simmons style search for ${query}`,
        url: `https://www.google.com/search?q=${encodeURIComponent(`Daniel Simmons ${query} outfit inspiration`)}`,
        snippet: 'Search for Daniel Simmons-inspired neutral, elevated menswear ideas.',
        sourceType: 'Web'
      },
      {
        title: `Harry Has trend search for ${query}`,
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`Harry Has ${query} menswear outfit ideas`)}`,
        snippet: 'Search Harry Has videos for current menswear styling ideas.',
        sourceType: 'YouTube'
      }
    ],
    street: [{
      title: `Street style ideas for ${query}`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${query} menswear street style outfit ideas`)}`,
      snippet: 'Open web search results for street-style outfit inspiration.',
      sourceType: 'Web'
    }],
    blogs: [{
      title: `Style guide articles for ${query}`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`${query} outfit ideas style guide menswear blog`)}`,
      snippet: 'Open fashion blog and style-guide results for this prompt.',
      sourceType: 'Web'
    }]
  };

  if (source && source !== 'all' && sources[source]) return sources[source];

  return [
    ...sources.pinterest,
    ...sources.youtube,
    ...sources.influencer.slice(0, 2),
    ...sources.street
  ];
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

function parsePinterestMarkdownResults(markdown, promptText) {
  const text = String(markdown || '');
  const results = [];
  const pinRegex = /\[!\[Image\s+\d+:\s*([^\]]+)\]\([^)]+\)\]\((https?:\/\/(?:www\.)?pinterest\.[^)]+\/pin\/[^)]+)\)/gi;
  let match;

  while ((match = pinRegex.exec(text)) !== null) {
    const snippet = cleanMarkdownText(match[1]);
    const title = summarizePinterestTitle(snippet, promptText);
    if (title && match[2]) {
      results.push({
        title,
        url: match[2],
        snippet,
        sourceType: 'Pinterest'
      });
    }
  }

  return dedupeResults(results);
}

function summarizePinterestTitle(snippet, promptText) {
  const clean = cleanMarkdownText(snippet)
    .replace(/#[\w-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const sentence = clean.match(/^(.{20,120}?)(?:[.!?]|$)/)?.[1]?.trim();
  if (sentence) return sentence;

  const prompt = sanitizeSearchText(promptText || DEFAULT_IDEA_PROMPT);
  return prompt ? `Pinterest idea: ${prompt}` : 'Pinterest outfit idea';
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
