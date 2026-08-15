// Retail sites almost never send CORS headers, so every request goes through a
// public proxy. Any single proxy is regularly rate-limited or down, so the
// strategies below are tried in order until one returns a usable page.
const FETCH_TIMEOUT_MS = 20000;

const FETCH_STRATEGIES = [
  {
    name: 'reader-html',
    label: 'Opening the page…',
    // Renders JavaScript before returning HTML, which is the only way to read
    // storefronts that build their gallery client-side.
    request: url => [`https://r.jina.ai/${url}`, { headers: { 'x-return-format': 'html' } }],
    parse: (body, url) => parseProductPage(body, url),
  },
  {
    name: 'allorigins',
    label: 'Trying another route…',
    request: url => [`https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`, {}],
    parse: (body, url) => parseProductPage(body, url),
  },
  {
    name: 'codetabs',
    label: 'Trying another route…',
    request: url => [`https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`, {}],
    parse: (body, url) => parseProductPage(body, url),
  },
  {
    name: 'corsproxy',
    label: 'Trying another route…',
    request: url => [`https://corsproxy.io/?url=${encodeURIComponent(url)}`, {}],
    parse: (body, url) => parseProductPage(body, url),
  },
  {
    name: 'reader-text',
    label: 'Last try — reading text only…',
    request: url => [`https://r.jina.ai/${url}`, {}],
    parse: (body, url) => parseReaderText(body, url),
  },
];

const MAX_CANDIDATES = 20;

async function fetchProductData(productUrl, { onProgress = () => {} } = {}) {
  const url = normalizePageUrl(productUrl);
  if (!url) throw new Error('invalid_url');

  let best = null;
  const failures = [];

  for (const strategy of FETCH_STRATEGIES) {
    onProgress(strategy.label);
    try {
      const body = await fetchText(...strategy.request(url));
      const data = { ...strategy.parse(body, url), source: strategy.name };
      // Proxies often answer with the shop's error or bot-check page while
      // still reporting success, and its images are never what was asked for.
      if (looksLikeErrorPage(data)) throw new Error('error_page');
      // A page whose only images look like logos or icons is worth retrying
      // elsewhere, but keep it in case every remaining source fails too.
      if (data.images.some(image => image.score > 0)) return data;
      if (!best && (data.images.length || data.name || data.price)) best = data;
    } catch (err) {
      failures.push(`${strategy.name}: ${err.message}`);
    }
  }

  if (best) return best;
  throw new Error(failures.length === FETCH_STRATEGIES.length ? 'all_sources_failed' : 'no_images_found');
}

async function fetchText(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const body = await res.text();
    // Proxies answer errors with a short JSON or HTML blurb rather than a status
    // code, so anything this small is treated as a failure.
    if (body.trim().length < 400) throw new Error('empty_response');
    return body;
  } finally {
    clearTimeout(timer);
  }
}

// Titles that mean a proxy handed back its own failure, the shop's error page,
// or a bot check, none of which contain the product being asked for.
const ERROR_PAGE_TITLE = /^\s*(?:40[0-9]|50[0-9]|error|page not found|not found|access denied|forbidden|are you a robot|just a moment|origin dns error|dns error|site not found|bad gateway|service unavailable|attention required|security check|captcha|robot check)\b/i;

function looksLikeErrorPage(data) {
  return ERROR_PAGE_TITLE.test(data.name || '');
}

// Feeds have to come back byte for byte, so the reader — which rewrites pages
// into prose — is no use for them. These proxies pass the response through.
//
// Order matters and is measured from a browser, not from a terminal: allorigins
// and codetabs answer curl happily but send no CORS header, so the browser
// blocks them, and it takes them twenty to fifty seconds to say so. Trying them
// first meant a feed never arrived before the deadline.
const RAW_PROXIES = [
  url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];
const RAW_TIMEOUT_MS = 8000;

async function fetchRaw(url) {
  const failures = [];
  for (const proxy of RAW_PROXIES) {
    try {
      return await fetchText(proxy(url), {}, RAW_TIMEOUT_MS);
    } catch (err) {
      failures.push(err.message);
    }
  }
  throw new Error(`no_proxy_available: ${failures.join(', ')}`);
}

function normalizePageUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withScheme);
    return /^https?:$/.test(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

// ── Page parsing ───────────────────────────────────────────────────────────
function parseProductPage(html, productUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  function getMeta(...selectors) {
    for (const sel of selectors) {
      const val = doc.querySelector(sel)?.content?.trim();
      if (val) return val;
    }
    return '';
  }

  const rawTitle = getMeta('meta[property="og:title"]', 'meta[name="twitter:title"]') || doc.title || '';
  const name = cleanTitle(rawTitle);
  const jsonLd = readJsonLdProduct(doc);

  // A bare regex over the page is the last resort: it happily returns the
  // shipping threshold from a promo banner instead of what the item costs.
  const price = formatPrice(
    getMeta('meta[property="product:price:amount"]', 'meta[property="og:price:amount"]'),
    getMeta('meta[property="product:price:currency"]', 'meta[property="og:price:currency"]'),
  ) || formatPrice(jsonLd.price, jsonLd.currency) || findPriceInDocument(doc, html);

  const brand = jsonLd.brand || getMeta('meta[property="og:site_name"]') || brandFromHostname(productUrl);

  const images = rankImageCandidates(collectImageCandidates(doc, html, jsonLd.images), {
    productUrl,
    keywords: keywordsFrom(rawTitle, productUrl),
  });

  return { imageUrl: images[0]?.url || '', images, name, brand, price, productUrl };
}

// The text reader returns markdown, which keeps image URLs and alt text but
// loses every other signal. It is the last resort when no proxy serves HTML.
function parseReaderText(markdown, productUrl) {
  const text = String(markdown ?? '');
  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || '';
  const name = cleanTitle(title);

  const raw = [];
  for (const match of text.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)) {
    raw.push({ url: match[2], alt: match[1].replace(/^Image\s+\d+:\s*/i, ''), origin: 'markdown' });
  }

  const images = rankImageCandidates(raw, { productUrl, keywords: keywordsFrom(title, productUrl) });

  return {
    imageUrl: images[0]?.url || '',
    images,
    name,
    brand: brandFromHostname(productUrl),
    price: findLabelledPriceInText(text),
    productUrl,
  };
}

// Page titles usually read "Product name | Brand". A dash only separates when
// it has space around it, so hyphenated names such as "T-Shirt" survive.
function cleanTitle(title) {
  return String(title ?? '').replace(/(?:\s*[|·]\s*|\s+[-–—]\s+).+$/, '').trim();
}

const PRICE_PATTERN = /[$£€¥]\s?\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/;
const LABELLED_PRICE = new RegExp(`(?:price|cost|now|sale)[^\\d$£€¥]{0,25}(${PRICE_PATTERN.source})`, 'gi');
const NOT_A_PRICE = /shipping|delivery|postage|spend|save|voucher|gift ?card|minimum|over/i;

function findPriceInText(text) {
  return String(text).match(PRICE_PATTERN)?.[0]?.replace(/\s/g, '') || '';
}

// Used where the surrounding words are all there is to go on. An amount only
// counts when something nearby calls it a price, and not when it is really a
// shipping fee or a spend-over-this threshold.
function findLabelledPriceInText(text) {
  const haystack = String(text);
  for (const match of haystack.matchAll(LABELLED_PRICE)) {
    const context = haystack.slice(Math.max(0, match.index - 60), match.index + match[0].length);
    if (NOT_A_PRICE.test(context)) continue;
    return match[1].replace(/\s/g, '');
  }
  return '';
}

// Prefer an amount the page itself labels as a price. Falling straight to a
// regex tends to return whatever number appears first — a shipping threshold,
// a discount banner, or a figure buried in inline JSON.
function findPriceInDocument(doc, html) {
  const declared = doc.querySelector('[itemprop="price"]')?.getAttribute('content')?.trim();
  if (declared && /^\d/.test(declared)) {
    return formatPrice(declared, doc.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content'));
  }

  for (const el of doc.querySelectorAll('[class*="price" i], [id*="price" i], [data-testid*="price" i]')) {
    const found = findPriceInText(el.textContent);
    if (found) return found;
  }

  return findLabelledPriceInText(visibleText(doc) || html);
}

function visibleText(doc) {
  const body = doc.body?.cloneNode(true);
  if (!body) return '';
  body.querySelectorAll('script, style, noscript, template').forEach(el => el.remove());
  return body.textContent || '';
}

function brandFromHostname(productUrl) {
  try {
    const host = new URL(productUrl).hostname.replace(/^www\d?\./, '');
    const part = host.split('.')[0];
    return part.charAt(0).toUpperCase() + part.slice(1);
  } catch {
    return '';
  }
}

const TITLE_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'shop', 'buy', 'men', 'mens', 'women', 'womens',
  'unisex', 'new', 'online', 'store', 'official', 'com', 'size', 'color', 'colour',
  'product', 'products', 'item', 'items', 'category', 'collection', 'collections',
  'html', 'htm', 'aspx', 'php', 'index', 'default',
]);

// Words that identify this particular product. The page title is the obvious
// source, but plenty of shops give every page the same generic title, so the
// URL slug — which names the product almost every time — is used as well.
function keywordsFrom(title, productUrl = '') {
  const fromTitle = tokenizeKeywords(title);
  let fromSlug = [];
  try {
    fromSlug = tokenizeKeywords(new URL(productUrl).pathname);
  } catch { /* not a usable URL */ }

  return [...new Set([...fromTitle, ...fromSlug])].slice(0, 10);
}

function tokenizeKeywords(text) {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length > 2 && !/^\d+$/.test(word) && !TITLE_STOPWORDS.has(word));
}

// ── Image candidates ───────────────────────────────────────────────────────
// `origin` records where a URL came from; declared markup wins over a URL that
// merely appeared somewhere in the page source.
const ORIGIN_SCORES = {
  'og:image': 60,
  'twitter:image': 55,
  'json-ld': 50,
  'link': 30,
  'markdown': 25,
  'img': 20,
  'source': 18,
  'style': 8,
  'raw': 4,
};

function collectImageCandidates(doc, html, jsonLdImages = []) {
  return [
    ...metaImageCandidates(doc),
    ...jsonLdImages.map(url => ({ url, origin: 'json-ld', alt: '' })),
    ...linkImageCandidates(doc),
    ...elementImageCandidates(doc),
    ...styleImageCandidates(doc),
    ...rawImageCandidates(html),
  ];
}

// Structured product data is the most reliable source on storefronts that hide
// the real photos behind client-side rendering, and the only place the actual
// selling price can be told apart from every other number on the page.
function readJsonLdProduct(doc) {
  const product = { images: [], price: '', currency: '', brand: '' };

  doc.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    let data;
    try {
      data = JSON.parse(script.textContent);
    } catch {
      return;
    }
    walkJsonLd(data, false, product);
  });

  return product;
}

function walkJsonLd(node, insideProduct, product) {
  if (!node || typeof node !== 'object') return;

  if (Array.isArray(node)) {
    node.forEach(item => walkJsonLd(item, insideProduct, product));
    return;
  }

  const types = [node['@type']].flat().filter(Boolean).map(type => String(type).toLowerCase());
  const isProduct = insideProduct || types.some(type => type === 'product' || type === 'productgroup');

  if (isProduct) {
    collectJsonLdImages(node.image, product.images);
    if (!product.brand) product.brand = jsonLdBrand(node.brand);
    if (!product.price) Object.assign(product, jsonLdPrice(node.offers));
  }

  Object.values(node).forEach(child => walkJsonLd(child, isProduct, product));
}

function collectJsonLdImages(value, images) {
  if (!value) return;
  if (typeof value === 'string') return void images.push(value);
  if (Array.isArray(value)) return value.forEach(item => collectJsonLdImages(item, images));
  if (typeof value !== 'object') return;
  ['url', 'contentUrl', 'thumbnailUrl'].forEach(key => {
    if (typeof value[key] === 'string') images.push(value[key]);
  });
}

function jsonLdBrand(brand) {
  if (typeof brand === 'string') return brand.trim();
  if (Array.isArray(brand)) return jsonLdBrand(brand[0]);
  if (brand && typeof brand === 'object' && typeof brand.name === 'string') return brand.name.trim();
  return '';
}

function jsonLdPrice(offers) {
  if (!offers) return {};
  if (Array.isArray(offers)) {
    for (const offer of offers) {
      const found = jsonLdPrice(offer);
      if (found.price) return found;
    }
    return {};
  }
  if (typeof offers !== 'object') return {};

  const raw = offers.price ?? offers.lowPrice ?? offers.priceSpecification?.price;
  const price = raw === undefined || raw === null || raw === '' ? '' : String(raw).trim();
  if (!price || !/^\d/.test(price)) return jsonLdPrice(offers.offers);

  return { price, currency: String(offers.priceCurrency || offers.priceSpecification?.priceCurrency || '').trim() };
}

const CURRENCY_SYMBOLS = { USD: '$', GBP: '£', EUR: '€', JPY: '¥', CNY: '¥' };

function formatPrice(amount, currency) {
  if (!amount) return '';
  // Structured data reports "215.0" and "215.00" for the same price; neither is
  // how anyone writes it.
  const number = Number(String(amount).replace(/,/g, ''));
  const text = Number.isFinite(number)
    ? (Number.isInteger(number) ? String(number) : number.toFixed(2))
    : String(amount).trim();

  const symbol = CURRENCY_SYMBOLS[String(currency || 'USD').toUpperCase()];
  return symbol ? symbol + text : `${currency} ${text}`;
}

function metaImageCandidates(doc) {
  const out = [];
  const groups = [
    ['og:image', 'meta[property="og:image"], meta[property="og:image:url"], meta[property="og:image:secure_url"]'],
    ['twitter:image', 'meta[name="twitter:image"], meta[name="twitter:image:src"], meta[property="twitter:image"]'],
    ['json-ld', 'meta[itemprop="image"]'],
  ];
  for (const [origin, selector] of groups) {
    doc.querySelectorAll(selector).forEach(el => {
      const url = el.getAttribute('content');
      if (url) out.push({ url, origin, alt: '' });
    });
  }
  return out;
}

function linkImageCandidates(doc) {
  const out = [];
  doc.querySelectorAll('link[rel="image_src"], link[rel="preload"][as="image"]').forEach(el => {
    const href = el.getAttribute('href');
    if (href) out.push({ url: href, origin: 'link', alt: '' });
    const srcset = el.getAttribute('imagesrcset');
    if (srcset) srcsetUrls(srcset).forEach(url => out.push({ url, origin: 'link', alt: '' }));
  });
  return out;
}

const LAZY_ATTRS = [
  'src', 'data-src', 'data-original', 'data-lazy', 'data-lazy-src', 'data-image',
  'data-image-src', 'data-large-image', 'data-zoom-image', 'data-hi-res-src', 'data-defer-src',
];

function elementImageCandidates(doc) {
  const out = [];
  doc.querySelectorAll('img, source').forEach(el => {
    const origin = el.tagName.toLowerCase() === 'img' ? 'img' : 'source';
    const alt = el.getAttribute('alt') || el.closest('picture')?.querySelector('img')?.getAttribute('alt') || '';
    const width = Number(el.getAttribute('width')) || 0;
    const height = Number(el.getAttribute('height')) || 0;

    for (const attr of LAZY_ATTRS) {
      const value = el.getAttribute(attr);
      if (value) out.push({ url: value, origin, alt, width, height });
    }
    for (const attr of ['srcset', 'data-srcset', 'data-lazy-srcset']) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      srcsetEntries(value).forEach((entry, index) => {
        out.push({ url: entry.url, origin, alt, width, height, srcsetWidth: entry.width, srcsetRank: index });
      });
    }
  });
  return out;
}

// Widest source first, so the top of the list is the highest-resolution variant.
function srcsetEntries(srcset) {
  return String(srcset)
    .split(',')
    .map(part => {
      const [url, descriptor = ''] = part.trim().split(/\s+/);
      const width = Number(descriptor.match(/^(\d+)w$/)?.[1] || 0);
      const density = Number(descriptor.match(/^([\d.]+)x$/)?.[1] || 0);
      return { url, width: width || Math.round(density * 1000) };
    })
    .filter(entry => entry.url)
    .sort((a, b) => b.width - a.width);
}

function srcsetUrls(srcset) {
  return srcsetEntries(srcset).map(entry => entry.url);
}

function styleImageCandidates(doc) {
  const out = [];
  doc.querySelectorAll('[style*="background"]').forEach(el => {
    const url = el.getAttribute('style')?.match(/url\((['"]?)([^)'"]+)\1\)/)?.[2];
    if (url) out.push({ url, origin: 'style', alt: '' });
  });
  return out;
}

// Some storefronts only ever mention the gallery inside inline JSON, so the raw
// source is scanned as a final source of candidates.
function rawImageCandidates(html) {
  const pattern = /(?:https?:)?\\?\/\\?\/[^"'`<>\s\\]+?\.(?:avif|webp|jpe?g|png)(?:\?[^"'`<>\s\\]*)?/gi;
  const out = [];
  for (const match of String(html).matchAll(pattern)) {
    out.push({ url: match[0], origin: 'raw', alt: '' });
    if (out.length > 400) break;
  }
  return out;
}

// ── Normalizing and ranking ────────────────────────────────────────────────
function normalizeImageUrl(candidate, baseUrl) {
  if (!candidate) return '';
  let raw = decodeEntities(String(candidate)).trim();
  raw = raw.replace(/^url\((.*)\)$/i, '$1').replace(/^['"]|['"]$/g, '').trim();
  raw = raw.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
  if (!raw || /^(data:|blob:|javascript:|about:)/i.test(raw)) return '';

  try {
    const resolved = new URL(raw, baseUrl || undefined);
    if (!/^https?:$/.test(resolved.protocol)) return '';
    // Product CDNs are HTTPS everywhere, and mixed content would be blocked.
    resolved.protocol = 'https:';
    return resolved.href;
  } catch {
    return '';
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", '#x2F': '/', '#47': '/' };

function decodeEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    const key = code.toLowerCase();
    if (ENTITIES[key] !== undefined) return ENTITIES[key];
    if (/^#x/.test(key)) return String.fromCodePoint(parseInt(key.slice(2), 16));
    if (/^#/.test(key)) return String.fromCodePoint(parseInt(key.slice(1), 10));
    return match;
  });
}

// Matched against whole words: a URL containing "navy" must not be read as a
// navigation asset, and "iconic" is not an icon.
const JUNK_TOKENS = new Set([
  'logo', 'logos', 'favicon', 'sprite', 'sprites', 'icon', 'icons', 'placeholder', 'spinner',
  'loading', 'blank', 'spacer', 'pixel', 'avatar', 'badge', 'payment', 'visa', 'mastercard',
  'paypal', 'klarna', 'afterpay', 'social', 'instagram', 'facebook', 'twitter', 'tiktok',
  'youtube', 'pinterest', 'arrow', 'chevron', 'close', 'menu', 'search', 'cart', 'flag',
  'flags', 'swatch', 'swatches', 'chip', 'chips', 'banner', 'promo', 'newsletter',
  'giftcard', 'sizeguide', 'sizechart', 'footer', 'header', 'nav', 'navigation', 'sitemap',
]);
const JUNK_PHRASES = /gift-?card|size-?guide|size-?chart|logo-|-logo|placeholder|no-?image/i;
const SMALL_TOKENS = new Set(['thumb', 'thumbs', 'thumbnail', 'thumbnails', 'mini', 'tiny', 'micro']);
const GOOD_WORDS = /product|pdp|hero|zoom|large|detail|gallery|media|catalog|shot|model|front|item|goods/i;

function rankImageCandidates(candidates, { productUrl = '', keywords = [] } = {}) {
  const byIdentity = new Map();

  for (const candidate of candidates) {
    const url = normalizeImageUrl(candidate.url, productUrl);
    if (!url) continue;

    const score = scoreImageCandidate({ ...candidate, url }, keywords);
    if (score <= -30) continue;

    const identity = imageIdentity(url);
    const existing = byIdentity.get(identity);
    if (!existing || score > existing.score) {
      byIdentity.set(identity, { url, score, origin: candidate.origin, alt: candidate.alt || '' });
    }
  }

  return [...byIdentity.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
    .map(candidate => ({ ...candidate, url: upgradeImageUrl(candidate.url) }));
}

function scoreImageCandidate(candidate, keywords = []) {
  const { url, origin = 'raw', alt = '', width = 0, height = 0, srcsetWidth = 0, srcsetRank = 0 } = candidate;
  const haystack = `${url} ${alt}`.toLowerCase();
  const tokens = haystack.split(/[^a-z0-9]+/);
  let score = ORIGIN_SCORES[origin] ?? 4;

  // A logo served as og:image is the single most common wrong answer, so junk
  // hints outweigh a trusted origin instead of merely nudging it down.
  if (JUNK_PHRASES.test(haystack) || tokens.some(token => JUNK_TOKENS.has(token))) score -= 70;
  if (tokens.some(token => SMALL_TOKENS.has(token))) score -= 18;
  if (GOOD_WORDS.test(haystack)) score += 14;

  if (/\.svg(\?|$)/i.test(url)) score -= 40;
  if (/\.gif(\?|$)/i.test(url)) score -= 25;

  // How big the markup says the image is drawn, versus how big the URL claims
  // the file itself is. A tiny rendered size means decoration, not a product.
  const declared = Math.max(width, height);
  if (declared && declared < 120) score -= 45;
  else if (declared >= 900) score += 16;
  else if (declared >= 500) score += 10;
  else if (declared >= 300) score += 4;

  score += Math.min(Math.max(sizeHint(url), srcsetWidth) / 100, 18);
  score -= srcsetRank * 2;

  const matches = keywords.filter(word => haystack.includes(word)).length;
  score += Math.min(matches * 7, 21);

  return score;
}

// Reads any resolution the URL advertises, e.g. `2000x2000`, `w=1200`, `_1024`.
function sizeHint(url) {
  const numbers = [
    ...String(url).matchAll(/(?:^|[^0-9])(\d{3,4})\s*x\s*(\d{3,4})(?:[^0-9]|$)/gi),
  ].flatMap(match => [Number(match[1]), Number(match[2])]);

  for (const match of String(url).matchAll(/[?&_/-](?:w|wid|width|sw|mw|size|dw|h|hei|height)[=_-]?(\d{2,4})\b/gi)) {
    numbers.push(Number(match[1]));
  }

  const usable = numbers.filter(n => n >= 100 && n <= 4000);
  return usable.length ? Math.max(...usable) : 0;
}

// Parameters that only pick a rendition of the same photo. Ignoring them groups
// variants together so the picker shows each product shot once rather than
// eight sizes of it.
const RENDITION_PARAMS = new Set([
  'width', 'w', 'wid', 'height', 'h', 'hei', 'sw', 'sh', 'size', 'dw', 'dpr', 'scale',
  'quality', 'q', 'fmt', 'format', 'output', 'fit', 'crop', 'v', 'ver', 'version', 'cache', 't',
]);

function imageIdentity(url) {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname
      .replace(/[_-]\d{2,4}x\d{0,4}(?=\.[a-z]+$|$)/i, '')
      .replace(/[_-](?:small|medium|large|thumb|thumbnail|zoom|grande|compact|master)(?=\.[a-z]+$|$)/i, '');
    const params = [...parsed.searchParams]
      .filter(([key]) => !RENDITION_PARAMS.has(key.toLowerCase()))
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('&');
    return `${parsed.hostname}${path}${params ? `?${params}` : ''}`.toLowerCase();
  } catch {
    return String(url).toLowerCase();
  }
}

// Shopify (and a handful of lookalikes) size images with a query parameter, so
// a thumbnail URL can be asked for at full size instead.
function upgradeImageUrl(url) {
  try {
    const parsed = new URL(url);
    const width = Number(parsed.searchParams.get('width'));
    if (width && width < 1200 && /cdn\/shop|cdn\.shopify\.com/.test(parsed.href)) {
      parsed.searchParams.set('width', '1200');
      return parsed.href;
    }
    return url;
  } catch {
    return url;
  }
}
