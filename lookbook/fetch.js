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

  const imageUrl = getMeta(
    'meta[property="og:image"]',
    'meta[name="twitter:image"]',
    'meta[name="twitter:image:src"]'
  ) || (() => {
    const imgs = [...doc.querySelectorAll('img[src]')];
    return imgs.find(i => /product|hero|main|pdp/i.test(i.getAttribute('src')))?.getAttribute('src') || '';
  })();

  const rawTitle = getMeta('meta[property="og:title"]', 'meta[name="twitter:title"]') || doc.title || '';
  const name = rawTitle.replace(/\s*[-–—|·]\s*.+$/, '').trim();

  const priceAmount = getMeta('meta[property="product:price:amount"]', 'meta[property="og:price:amount"]');
  const priceCurrency = getMeta('meta[property="product:price:currency"]', 'meta[property="og:price:currency"]');
  let price = '';
  if (priceAmount) {
    const symbol = (!priceCurrency || priceCurrency === 'USD') ? '$' : priceCurrency + ' ';
    price = symbol + priceAmount;
  } else {
    price = html.match(/\$\d{1,3}(?:,\d{3})*(?:\.\d{2})?/)?.[0] || '';
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
