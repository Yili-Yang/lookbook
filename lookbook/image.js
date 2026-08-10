// Turning a remote product photo into a stored copy solves three problems at
// once: hotlink-protected CDNs that refuse to render on another origin, links
// that rot when a product sells out, and looks that should still open offline.
const IMAGE_PROXY = 'https://images.weserv.nl/?url=';
const PROBE_TIMEOUT_MS = 12000;
// One slow route must not hold up the whole download, and the total is capped
// so that saving a look never waits on it for an unpredictable length of time.
const DOWNLOAD_TIMEOUT_MS = 10000;
const DOWNLOAD_BUDGET_MS = 22000;

// Roughly 25–45 KB per photo as JPEG, which keeps a few hundred pieces inside
// the localStorage budget while still looking sharp on a retina card.
const STORED_MAX_PX = 700;
const STORED_QUALITY = 0.78;
const MIN_USABLE_PX = 160;

// The proxy fetches server-side, so it also bypasses referrer checks that make
// a CDN return 403 for a direct browser request from another origin.
function proxiedImageUrl(url, { width = 1000 } = {}) {
  return `${IMAGE_PROXY}${encodeURIComponent(url)}&w=${width}&we&output=jpg&q=85`;
}

// Loads a URL as a plain <img> to learn whether it renders at all and how big
// it really is. No CORS involved, so it works for any host.
function probeImage(url) {
  return new Promise(resolve => {
    const img = new Image();
    let settled = false;

    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      img.onload = img.onerror = null;
      resolve(result);
    };

    const timer = setTimeout(() => finish({ url, ok: false, width: 0, height: 0 }), PROBE_TIMEOUT_MS);
    img.onload = () => finish({ url, ok: true, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => finish({ url, ok: false, width: 0, height: 0 });
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';
    img.src = url;
  });
}

// Drops candidates that are broken, blocked, or too small to be a product shot,
// and re-sorts what is left so bigger photos come first within a score band.
async function verifyImageCandidates(candidates, { limit = 16 } = {}) {
  const shortlist = candidates.slice(0, limit);
  const probes = await Promise.all(shortlist.map(candidate => probeImage(candidate.url)));

  return shortlist
    .map((candidate, index) => ({ ...candidate, ...probes[index] }))
    .filter(candidate => candidate.ok && Math.max(candidate.width, candidate.height) >= MIN_USABLE_PX)
    .sort((a, b) => (b.score + areaBonus(b)) - (a.score + areaBonus(a)));
}

function areaBonus({ width = 0, height = 0 }) {
  const longest = Math.max(width, height);
  if (longest >= 1200) return 20;
  if (longest >= 800) return 14;
  if (longest >= 500) return 8;
  if (longest >= 300) return 2;
  return -10;
}

// Downloads a photo and returns a downscaled JPEG data URL, or null when every
// route is blocked (the caller then falls back to hotlinking the original).
async function captureImage(url) {
  const deadline = Date.now() + DOWNLOAD_BUDGET_MS;
  const routes = [
    () => proxiedImageUrl(url),
    () => url,
    () => proxiedImageUrl(url, { width: 500 }),
  ];

  for (const route of routes) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      const blob = await fetchBlob(route(), Math.min(remaining, DOWNLOAD_TIMEOUT_MS));
      if (blob && blob.size > 0) return await blobToStoredImage(blob);
    } catch {
      // Try the next route.
    }
  }
  return null;
}

async function fetchBlob(url, timeoutMs = DOWNLOAD_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, referrerPolicy: 'no-referrer' });
    if (!res.ok) throw new Error(`http_${res.status}`);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type)) throw new Error('not_an_image');
    return blob;
  } finally {
    clearTimeout(timer);
  }
}

async function blobToStoredImage(blob) {
  const bitmap = await loadBitmap(blob);
  const scale = Math.min(1, STORED_MAX_PX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));

  const ctx = canvas.getContext('2d');
  // Product cut-outs are often transparent PNGs; JPEG has no alpha, so without
  // this they would come out on a black background.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  return {
    dataUrl: canvas.toDataURL('image/jpeg', STORED_QUALITY),
    width: canvas.width,
    height: canvas.height,
  };
}

function loadBitmap(blob) {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob).catch(() => loadBitmapViaImage(blob));
  }
  return loadBitmapViaImage(blob);
}

function loadBitmapViaImage(blob) {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('decode_failed'));
    };
    img.src = objectUrl;
  });
}

// Accepts a photo the user dropped, picked, or pasted from the clipboard.
async function captureLocalFile(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error('not_an_image');
  return blobToStoredImage(file);
}

function imageFromClipboard(event) {
  const items = [...(event.clipboardData?.items || [])];
  const item = items.find(entry => entry.kind === 'file' && /^image\//.test(entry.type));
  return item ? item.getAsFile() : null;
}

function approximateBytes(dataUrl) {
  const base64 = String(dataUrl ?? '').split(',')[1] || '';
  return Math.round(base64.length * 0.75);
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
