// The colours a wardrobe is actually described in. Recommendations have to be
// sayable — "ecru linen shirt" is useful, "#e8dfcb linen shirt" is not — so
// every pixel is matched to one of these names rather than clustered freely.
const WARDROBE_COLORS = [
  { name: 'white', rgb: [250, 250, 248], goesWith: ['navy', 'olive', 'charcoal', 'denim blue', 'camel'] },
  { name: 'ecru', rgb: [232, 223, 203], goesWith: ['navy', 'olive', 'chocolate', 'sage', 'denim blue'] },
  { name: 'cream', rgb: [240, 231, 209], goesWith: ['camel', 'navy', 'rust', 'olive'] },
  { name: 'sand', rgb: [214, 196, 166], goesWith: ['navy', 'white', 'olive', 'burgundy'] },
  { name: 'stone', rgb: [190, 182, 168], goesWith: ['navy', 'charcoal', 'sage', 'white'] },
  { name: 'taupe', rgb: [150, 136, 122], goesWith: ['cream', 'navy', 'olive', 'burgundy'] },
  { name: 'camel', rgb: [178, 138, 92], goesWith: ['navy', 'cream', 'charcoal', 'forest green'] },
  { name: 'tan', rgb: [193, 156, 114], goesWith: ['navy', 'white', 'olive', 'burgundy'] },
  { name: 'chocolate', rgb: [90, 62, 44], goesWith: ['ecru', 'sand', 'sage', 'denim blue'] },
  { name: 'rust', rgb: [162, 84, 46], goesWith: ['cream', 'olive', 'navy', 'stone'] },
  { name: 'burgundy', rgb: [98, 40, 48], goesWith: ['ecru', 'grey', 'navy', 'camel'] },
  { name: 'mustard', rgb: [188, 152, 62], goesWith: ['navy', 'charcoal', 'ecru', 'forest green'] },
  { name: 'olive', rgb: [107, 104, 66], goesWith: ['ecru', 'cream', 'tan', 'navy', 'white'] },
  { name: 'sage', rgb: [158, 168, 145], goesWith: ['ecru', 'chocolate', 'navy', 'stone'] },
  { name: 'forest green', rgb: [52, 78, 60], goesWith: ['cream', 'camel', 'stone', 'navy'] },
  { name: 'navy', rgb: [38, 48, 76], goesWith: ['ecru', 'camel', 'white', 'grey', 'rust'] },
  { name: 'denim blue', rgb: [86, 116, 150], goesWith: ['ecru', 'white', 'olive', 'chocolate'] },
  { name: 'sky blue', rgb: [163, 194, 219], goesWith: ['navy', 'ecru', 'stone', 'charcoal'] },
  { name: 'charcoal', rgb: [64, 64, 66], goesWith: ['ecru', 'white', 'camel', 'sky blue'] },
  { name: 'grey', rgb: [142, 142, 142], goesWith: ['navy', 'white', 'burgundy', 'sky blue'] },
  { name: 'light grey', rgb: [202, 202, 202], goesWith: ['navy', 'charcoal', 'olive', 'white'] },
  { name: 'black', rgb: [28, 28, 28], goesWith: ['white', 'grey', 'ecru', 'sky blue'] },
  { name: 'pink', rgb: [226, 180, 178], goesWith: ['navy', 'grey', 'ecru', 'olive'] },
  { name: 'lilac', rgb: [182, 168, 200], goesWith: ['navy', 'grey', 'cream', 'sage'] },
];

const PALETTE_SAMPLE_PX = 64;

function wardrobeColor(name) {
  return WARDROBE_COLORS.find(color => color.name === name) || null;
}

function colorHex(name) {
  const color = wardrobeColor(name);
  if (!color) return '#cccccc';
  return '#' + color.rgb.map(v => v.toString(16).padStart(2, '0')).join('');
}

// ── Colour matching ────────────────────────────────────────────────────────
// Compared in Lab rather than RGB, where "nearest" matches how a person would
// judge it: mid grey is closer to charcoal than to sky blue.
function srgbToLab([r, g, b]) {
  const linear = channel => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const [lr, lg, lb] = [linear(r), linear(g), linear(b)];
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = (lr * 0.2126 + lg * 0.7152 + lb * 0.0722);
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const f = t => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const WARDROBE_LABS = WARDROBE_COLORS.map(color => ({ ...color, lab: srgbToLab(color.rgb) }));

function nearestWardrobeColor(rgb) {
  const lab = srgbToLab(rgb);
  let best = WARDROBE_LABS[0];
  let bestDistance = Infinity;
  for (const color of WARDROBE_LABS) {
    const distance = labDistance(lab, color.lab);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = color;
    }
  }
  return { name: best.name, distance: bestDistance };
}

// ── Pixels worth counting ──────────────────────────────────────────────────
function rgbToHsl([r, g, b]) {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6;
  else hue = ((rn - gn) / delta + 4) / 6;
  return [hue * 360, saturation, lightness];
}

// Studio backdrops are near-white and colourless; counting them would make
// every wardrobe look white. Chroma is used rather than HSL saturation, which
// reports misleadingly high values for near-white pixels. The threshold is set
// high enough that the shaded folds of a white shirt still count as clothing.
function isBackdrop([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return (max + min) / 2 > 242 && max - min < 13;
}

// Skin is deliberately not filtered by colour: it occupies the same range as
// ecru, sand, tan and camel, and losing those would blind the palette to the
// neutrals this wardrobe is mostly made of. Cropping to the torso keeps faces
// and hands out of the sample instead.
const SAMPLE_CROP = { x: 0.22, y: 0.24, width: 0.56, height: 0.56 };

// ── Palette extraction ─────────────────────────────────────────────────────
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_load_failed'));
    img.src = src;
  });
}

// Samples the middle of the photo, where the garment is, and reports which
// wardrobe colours it is made of.
async function extractPaletteFromImage(src) {
  const img = await loadImageElement(src);
  const canvas = document.createElement('canvas');
  canvas.width = PALETTE_SAMPLE_PX;
  canvas.height = PALETTE_SAMPLE_PX;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  ctx.drawImage(img,
    img.naturalWidth * SAMPLE_CROP.x, img.naturalHeight * SAMPLE_CROP.y,
    img.naturalWidth * SAMPLE_CROP.width, img.naturalHeight * SAMPLE_CROP.height,
    0, 0, PALETTE_SAMPLE_PX, PALETTE_SAMPLE_PX);

  let pixels;
  try {
    pixels = ctx.getImageData(0, 0, PALETTE_SAMPLE_PX, PALETTE_SAMPLE_PX).data;
  } catch {
    // A photo hotlinked from a shop taints the canvas and cannot be read.
    return [];
  }

  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
    if (isBackdrop(rgb)) continue;

    const { name } = nearestWardrobeColor(rgb);
    const bucket = buckets.get(name) || { name, count: 0, sum: [0, 0, 0] };
    bucket.count++;
    bucket.sum = [bucket.sum[0] + rgb[0], bucket.sum[1] + rgb[1], bucket.sum[2] + rgb[2]];
    buckets.set(name, bucket);
  }

  const total = [...buckets.values()].reduce((sum, bucket) => sum + bucket.count, 0);
  if (!total) return [];

  return [...buckets.values()]
    .map(bucket => ({
      name: bucket.name,
      share: bucket.count / total,
      rgb: bucket.sum.map(value => Math.round(value / bucket.count)),
    }))
    .sort((a, b) => b.share - a.share)
    .filter(entry => entry.share >= 0.06)
    .slice(0, 3);
}

// Reads every saved photo and returns the colours the wardrobe actually leans
// on, most-used first.
async function paletteFromLooks(looks) {
  const sources = looks.flatMap(look => (look.pieces || []).map(piece => piece.imageData).filter(Boolean));
  const palettes = await Promise.all(sources.map(src => extractPaletteFromImage(src).catch(() => [])));

  const totals = new Map();
  for (const palette of palettes) {
    for (const entry of palette) {
      const running = totals.get(entry.name) || { name: entry.name, weight: 0, rgb: entry.rgb, pieces: 0 };
      running.weight += entry.share;
      running.pieces++;
      totals.set(entry.name, running);
    }
  }

  const weight = [...totals.values()].reduce((sum, entry) => sum + entry.weight, 0);
  return [...totals.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5)
    .map(entry => ({ ...entry, share: weight ? entry.weight / weight : 0 }));
}

// Colours that flatter what is already owned but are not yet in it — the ones
// worth actually shopping for.
function suggestedAccents(paletteNames, limit = 4) {
  const owned = new Set(paletteNames);
  const votes = new Map();

  for (const name of paletteNames) {
    for (const partner of wardrobeColor(name)?.goesWith || []) {
      if (owned.has(partner)) continue;
      votes.set(partner, (votes.get(partner) || 0) + 1);
    }
  }

  return [...votes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name]) => name);
}

function colorsGoTogether(a, b) {
  if (a === b) return false;
  return Boolean(wardrobeColor(a)?.goesWith.includes(b) || wardrobeColor(b)?.goesWith.includes(a));
}

// The style note is written for a person, not a parser, so "navy and olive, no
// black" has to be read as two colours wanted and one refused.
const AVOID_CLAUSE = /\b(?:avoid|avoiding|no|not|never|nothing|without|hate|dislike|dislikes)\b([^.;,\n]*)/gi;

function colorNamesIn(text) {
  const haystack = String(text || '').toLowerCase();
  return WARDROBE_COLORS.filter(color => new RegExp(`\\b${color.name}\\b`).test(haystack)).map(color => color.name);
}

function avoidedColorNames(text) {
  const avoided = new Set();
  for (const match of String(text || '').toLowerCase().matchAll(AVOID_CLAUSE)) {
    colorNamesIn(match[1]).forEach(name => avoided.add(name));
  }
  return [...avoided];
}

// Falls back to whatever colours the style note mentions, so a brand-new
// lookbook with no photos still gets recommendations in the right tones.
function paletteFromText(text) {
  const avoided = new Set(avoidedColorNames(text));
  return colorNamesIn(text)
    .filter(name => !avoided.has(name))
    .slice(0, 5)
    .map(name => ({ name, rgb: wardrobeColor(name).rgb, share: 0, pieces: 0 }));
}

const DEFAULT_PALETTE = ['ecru', 'navy', 'olive'];
