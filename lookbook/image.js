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
// The blob comes back too, so the photo can be re-framed without downloading
// it again.
async function captureImage(url, { frame = 'auto', category = '' } = {}) {
  const blob = await downloadImage(url);
  if (!blob) return null;
  return { blob, ...(await renderStoredImage(blob, { frame, category })) };
}

async function downloadImage(url) {
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
      if (blob && blob.size > 0) return blob;
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

// A lookbook card puts two photos side by side, one for the top and one for the
// bottom. When both are full-length shots of a whole outfit you cannot see
// either garment, so a photo can be framed on the half that matters.
const FRAMES = {
  full: { y: 0, height: 1 },
  top: { y: 0.06, height: 0.5 },
  bottom: { y: 0.44, height: 0.54 },
};

async function renderStoredImage(blob, { frame = 'full', category = '' } = {}) {
  const bitmap = await loadBitmap(blob);
  const chosen = frame === 'auto' ? chooseFrame(bitmap, category) : (FRAMES[frame] ? frame : 'full');
  const window = FRAMES[chosen];

  const cropY = Math.round(bitmap.height * window.y);
  const cropHeight = Math.max(1, Math.round(bitmap.height * window.height));
  const scale = Math.min(1, STORED_MAX_PX / Math.max(bitmap.width, cropHeight));

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(cropHeight * scale));

  const ctx = canvas.getContext('2d');
  // Product cut-outs are often transparent PNGs; JPEG has no alpha, so without
  // this they would come out on a black background.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, cropY, bitmap.width, cropHeight, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();

  return {
    dataUrl: canvas.toDataURL('image/jpeg', STORED_QUALITY),
    width: canvas.width,
    height: canvas.height,
    frame: chosen,
  };
}

function reframeImage(blob, frame) {
  return renderStoredImage(blob, { frame });
}

// Only a photograph of somebody wearing the whole outfit is worth cropping. A
// garment shot on its own already shows the piece, and half of it is no use.
function chooseFrame(bitmap, category) {
  if (category !== 'top' && category !== 'bottom' && category !== 'outer') return 'full';

  // Measured against real product photography: somebody photographed head to
  // toe fills the height of a tall frame, while a garment on its own is either
  // squarer or leaves margins above and below it. The width test only rules out
  // a garment photographed edge to edge, which a person never is.
  const bounds = measureContent(bitmap);
  const tall = bitmap.height / bitmap.width >= 1.15;
  const fillsHeight = bounds.height >= 0.78;
  const notEdgeToEdge = bounds.width <= 0.9;

  if (!tall || !fillsHeight || !notEdgeToEdge) return 'full';
  return category === 'bottom' ? 'bottom' : 'top';
}

const CONTENT_SAMPLE_PX = 48;
// How far a pixel may drift from the backdrop colour and still be backdrop.
// Loose enough for the shading and compression noise of a real studio wall.
const BACKDROP_TOLERANCE = 26;

// How much of the frame the subject actually occupies. The backdrop colour is
// taken from the edges of the photo rather than assumed to be white, because
// studio walls are usually a shade of grey or beige.
function measureContent(bitmap) {
  const canvas = document.createElement('canvas');
  canvas.width = CONTENT_SAMPLE_PX;
  canvas.height = CONTENT_SAMPLE_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, CONTENT_SAMPLE_PX, CONTENT_SAMPLE_PX);
  ctx.drawImage(bitmap, 0, 0, CONTENT_SAMPLE_PX, CONTENT_SAMPLE_PX);

  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, CONTENT_SAMPLE_PX, CONTENT_SAMPLE_PX).data;
  } catch {
    return { width: 1, height: 1 };
  }

  const backdrop = edgeColour(pixels);
  // A photograph taken somewhere real has no single backdrop colour, and
  // guessing where the garment sits in it would be worse than not cropping.
  if (!backdrop) return { width: 1, height: 1 };

  let top = CONTENT_SAMPLE_PX;
  let bottom = -1;
  let left = CONTENT_SAMPLE_PX;
  let right = -1;

  for (let y = 0; y < CONTENT_SAMPLE_PX; y++) {
    for (let x = 0; x < CONTENT_SAMPLE_PX; x++) {
      const i = (y * CONTENT_SAMPLE_PX + x) * 4;
      if (near(pixels, i, backdrop)) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }

  if (bottom < 0) return { width: 0, height: 0 };
  return {
    width: (right - left + 1) / CONTENT_SAMPLE_PX,
    height: (bottom - top + 1) / CONTENT_SAMPLE_PX,
  };
}

function near(pixels, i, [r, g, b]) {
  return Math.abs(pixels[i] - r) <= BACKDROP_TOLERANCE
    && Math.abs(pixels[i + 1] - g) <= BACKDROP_TOLERANCE
    && Math.abs(pixels[i + 2] - b) <= BACKDROP_TOLERANCE;
}

// The median colour of the outermost ring, or null when the edges disagree
// with each other — which means there is no plain backdrop to speak of.
function edgeColour(pixels) {
  const ring = [];
  for (let y = 0; y < CONTENT_SAMPLE_PX; y++) {
    for (let x = 0; x < CONTENT_SAMPLE_PX; x++) {
      const onEdge = x === 0 || y === 0 || x === CONTENT_SAMPLE_PX - 1 || y === CONTENT_SAMPLE_PX - 1;
      if (!onEdge) continue;
      const i = (y * CONTENT_SAMPLE_PX + x) * 4;
      ring.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
    }
  }

  const median = channel => {
    const values = ring.map(pixel => pixel[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const colour = [median(0), median(1), median(2)];

  const agreeing = ring.filter(pixel =>
    Math.abs(pixel[0] - colour[0]) <= BACKDROP_TOLERANCE
    && Math.abs(pixel[1] - colour[1]) <= BACKDROP_TOLERANCE
    && Math.abs(pixel[2] - colour[2]) <= BACKDROP_TOLERANCE).length;

  // A model's arm, a shadow or a caption often touches the frame, so the edges
  // need only mostly agree. Guessing the backdrop wrongly is safe: the subject
  // then measures as full width, and a photo that wide is never cropped.
  return agreeing / ring.length >= 0.6 ? colour : null;
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
async function captureLocalFile(file, { frame = 'auto', category = '' } = {}) {
  if (!file || !/^image\//.test(file.type)) throw new Error('not_an_image');
  return { blob: file, ...(await renderStoredImage(file, { frame, category })) };
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

// Non-breaking space: these sizes sit in narrow captions that would otherwise
// wrap between the number and its unit.
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes}\u00a0B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}\u00a0KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}\u00a0MB`;
}
