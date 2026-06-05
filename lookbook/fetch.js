const PROXY_URL = 'https://api.allorigins.win/get?url=';
const FETCH_TIMEOUT_MS = 8000;

async function fetchProductData(productUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PROXY_URL + encodeURIComponent(productUrl), { signal: controller.signal });
    if (!res.ok) throw new Error('proxy_error');
    const { contents } = await res.json();
    return parseProductPage(contents, productUrl);
  } finally {
    clearTimeout(timer);
  }
}

function parseProductPage(html, productUrl) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  function getMeta(...selectors) {
    for (const sel of selectors) {
      const val = doc.querySelector(sel)?.content?.trim();
      if (val) return val;
    }
    return '';
  }

  const imageUrl = findProductImageUrl(doc, html, productUrl, getMeta);

  const rawTitle = getMeta('meta[property="og:title"]', 'meta[name="twitter:title"]') || doc.title || '';
  const name = rawTitle.replace(/\s*[-–—|·]\s*.+$/, '').trim();

  const priceAmount = getMeta('meta[property="product:price:amount"]', 'meta[property="og:price:amount"]');
  const priceCurrency = getMeta('meta[property="product:price:currency"]', 'meta[property="og:price:currency"]');
  let price = '';
  if (priceAmount) {
    const symbol = (!priceCurrency || priceCurrency === 'USD') ? '$' : priceCurrency + ' ';
    price = symbol + priceAmount;
  } else {
    price = html.match(/[$£€]\d{1,3}(?:,\d{3})*(?:\.\d{2})?/)?.[0] || '';
  }

  const siteName = getMeta('meta[property="og:site_name"]');
  const brand = siteName || (() => {
    try {
      const host = new URL(productUrl).hostname.replace(/^www\./, '');
      const part = host.split('.')[0];
      return part.charAt(0).toUpperCase() + part.slice(1);
    } catch { return ''; }
  })();

  return { imageUrl, name, brand, price, productUrl };
}

function findProductImageUrl(doc, html, productUrl, getMeta) {
  return firstNormalizedImageUrl(productUrl,
    getMeta(
      'meta[property="og:image"]',
      'meta[property="og:image:url"]',
      'meta[name="twitter:image"]',
      'meta[name="twitter:image:src"]'
    )
  ) || firstNormalizedImageUrl(productUrl, ...getJsonLdProductImages(doc))
    || getBestImageCandidate(getElementImageCandidates(doc), productUrl)
    || getBestImageCandidate(getRawImageCandidates(html), productUrl);
}

function firstNormalizedImageUrl(productUrl, ...candidates) {
  for (const candidate of candidates.flat()) {
    const normalized = normalizeImageUrl(candidate, productUrl);
    if (normalized) return normalized;
  }
  return '';
}

function normalizeImageUrl(candidate, productUrl) {
  if (!candidate) return '';
  let raw = decodeHtmlEntities(String(candidate)).trim();
  raw = raw.replace(/^url\((.*)\)$/i, '$1').replace(/^['"]|['"]$/g, '').trim();
  raw = raw.replace(/\\u0026/gi, '&').replace(/\\\//g, '/');

  if (!raw || /^(data:|blob:|javascript:|about:)/i.test(raw)) return '';

  try {
    return new URL(raw, productUrl).href;
  } catch {
    return '';
  }
}

function decodeHtmlEntities(value) {
  const el = document.createElement('textarea');
  el.innerHTML = value;
  return el.value;
}

function getBestImageCandidate(candidates, productUrl) {
  const unique = [...new Set(candidates.map(candidate => normalizeImageUrl(candidate, productUrl)).filter(Boolean))];
  if (!unique.length) return '';

  return unique
    .map(url => ({ url, score: scoreImageUrl(url) }))
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.url || unique[0];
}

function scoreImageUrl(url) {
  const lower = url.toLowerCase();
  let score = 0;

  if (/\.(avif|webp|jpe?g|png)(?:[?#]|$)/.test(lower)) score += 5;
  if (/product|pdp|hero|main|catalog|zoom|large/.test(lower)) score += 4;
  if (/cdn\.media\.amplience\.net\/i\/office|media\.office\.co\.uk|\/office\//.test(lower)) score += 5;
  if (/_(sd|dt|bk|bv|pr)\d/i.test(url)) score += 4;
  if (/logo|icon|sprite|placeholder|spinner|loading|badge|swatch/.test(lower)) score -= 8;

  return score;
}

function getElementImageCandidates(doc) {
  const candidates = [];
  const attrs = [
    'src',
    'data-src',
    'data-original',
    'data-image',
    'data-image-url',
    'data-large-image',
    'data-zoom-image',
    'content'
  ];

  doc.querySelectorAll('img, source, link[rel="image_src"], meta[itemprop="image"]').forEach(el => {
    attrs.forEach(attr => {
      const value = el.getAttribute(attr);
      if (value) candidates.push(value);
    });

    ['srcset', 'data-srcset'].forEach(attr => {
      const value = el.getAttribute(attr);
      if (value) candidates.push(...extractSrcsetUrls(value));
    });
  });

  return candidates;
}

function extractSrcsetUrls(srcset) {
  return String(srcset).split(',')
    .map(part => {
      const [url, descriptor = ''] = part.trim().split(/\s+/, 2);
      const width = Number(descriptor.match(/^(\d+)w$/)?.[1] || 0);
      const density = Number(descriptor.match(/^(\d+(?:\.\d+)?)x$/)?.[1] || 0);
      return { url, weight: width || density * 1000 || 1 };
    })
    .filter(candidate => candidate.url)
    .sort((a, b) => b.weight - a.weight)
    .map(candidate => candidate.url);
}

function getJsonLdProductImages(doc) {
  const images = [];

  doc.querySelectorAll('script[type="application/ld+json"]').forEach(script => {
    try {
      collectProductImages(JSON.parse(script.textContent), images);
    } catch {
      // Ignore malformed third-party structured data.
    }
  });

  return images;
}

function collectProductImages(value, images, insideProduct = false) {
  if (!value) return;

  if (Array.isArray(value)) {
    value.forEach(item => collectProductImages(item, images, insideProduct));
    return;
  }

  if (typeof value !== 'object') return;

  const type = value['@type'];
  const isProduct = insideProduct || (Array.isArray(type)
    ? type.some(item => String(item).toLowerCase() === 'product')
    : String(type || '').toLowerCase() === 'product');

  if (isProduct && value.image) collectImageValues(value.image, images);

  Object.values(value).forEach(child => collectProductImages(child, images));
}

function collectImageValues(value, images) {
  if (!value) return;

  if (typeof value === 'string') {
    images.push(value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach(item => collectImageValues(item, images));
    return;
  }

  if (typeof value !== 'object') return;

  ['url', 'contentUrl', 'thumbnailUrl'].forEach(key => {
    if (typeof value[key] === 'string') images.push(value[key]);
  });
}

function getRawImageCandidates(html) {
  return [
    ...String(html).matchAll(/https?:\\?\/\\?\/[^"'<>\\\s]+?\.(?:avif|webp|jpe?g|png)(?:\?[^"'<>\\\s]*)?/gi),
    ...String(html).matchAll(/\/\/[^"'<>\\\s]+?\.(?:avif|webp|jpe?g|png)(?:\?[^"'<>\\\s]*)?/gi)
  ].map(match => match[0]);
}
