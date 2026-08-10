// Recommendations come from two places: what independent style writers are
// actually talking about right now, and the colours already in the lookbook.
// The writers supply the garment and the cut; the wardrobe supplies the colour.
const STYLE_SOURCES = [
  { name: 'He Spoke Style', url: 'https://hespokestyle.com/category/style/', voice: 'classic menswear outfits' },
  { name: 'Who What Wear', url: 'https://www.whowhatwear.com/section/fashion', voice: 'what editors are wearing' },
  { name: 'Die, Workwear!', url: 'https://dieworkwear.com/', voice: 'menswear criticism' },
  { name: 'Permanent Style', url: 'https://www.permanentstyle.com/', voice: 'tailoring and cloth' },
  { name: 'GQ Style', url: 'https://www.gq.com/style', voice: 'trend reporting' },
  { name: 'Esquire Style', url: 'https://www.esquire.com/style/', voice: 'trend reporting' },
  { name: 'Blackbird Spyplane', url: 'https://www.blackbirdspyplane.com/', voice: 'off-centre recommendations' },
];

const SOURCES_PER_RUN = 4;
const IDEAS_CACHE_KEY = 'lookbook-ideas-cache';
const IDEAS_CACHE_MS = 12 * 60 * 60 * 1000;

// ── Vocabulary ─────────────────────────────────────────────────────────────
// A garment is only recognised if it is on this list, which keeps ideas to
// things that can actually be shopped for.
const GARMENTS = [
  ['camp collar shirt', 'top'], ['camp-collar shirt', 'top'], ['oxford shirt', 'top'],
  ['button-down shirt', 'top'], ['button down shirt', 'top'], ['polo shirt', 'top'],
  ['crewneck sweater', 'top'], ['crew neck sweater', 'top'], ['cardigan', 'top'],
  ['turtleneck', 'top'], ['sweatshirt', 'top'], ['henley', 'top'], ['tank top', 'top'],
  ['t-shirt', 'top'], ['tee', 'top'], ['blouse', 'top'], ['shirt', 'top'], ['sweater', 'top'],
  ['jumper', 'top'], ['knit', 'top'], ['polo', 'top'], ['vest', 'top'],
  ['pleated trousers', 'bottom'], ['wide-leg trousers', 'bottom'], ['wide leg trousers', 'bottom'],
  ['cargo trousers', 'bottom'], ['chinos', 'bottom'], ['trousers', 'bottom'], ['pants', 'bottom'],
  ['jeans', 'bottom'], ['shorts', 'bottom'], ['skirt', 'bottom'], ['midi skirt', 'bottom'],
  ['sport coat', 'outer'], ['chore coat', 'outer'], ['chore jacket', 'outer'], ['trench coat', 'outer'],
  ['field jacket', 'outer'], ['denim jacket', 'outer'], ['bomber jacket', 'outer'], ['overshirt', 'outer'],
  ['blazer', 'outer'], ['parka', 'outer'], ['jacket', 'outer'], ['coat', 'outer'],
  ['loafers', 'shoes'], ['sneakers', 'shoes'], ['derbies', 'shoes'], ['boots', 'shoes'],
  ['sandals', 'shoes'], ['mules', 'shoes'],
];

const MATERIALS = [
  'linen', 'cotton', 'merino', 'wool', 'cashmere', 'silk', 'denim', 'corduroy', 'flannel',
  'tweed', 'hopsack', 'seersucker', 'poplin', 'oxford cloth', 'leather', 'suede', 'jersey',
  'twill', 'chambray', 'knit',
];

const COLOUR_WORDS = [
  'off-white', 'off white', 'navy blue', 'light grey', 'light gray', 'dark green', 'forest green',
  'olive green', 'sky blue', 'light blue', 'pale blue', 'powder blue', 'ecru', 'cream', 'ivory',
  'white', 'sand', 'beige', 'stone', 'oatmeal', 'camel', 'tan', 'taupe', 'khaki', 'chocolate',
  'brown', 'rust', 'terracotta', 'burgundy', 'maroon', 'olive', 'sage', 'navy', 'indigo',
  'charcoal', 'grey', 'gray', 'black', 'mustard', 'pink', 'lilac',
];

// Blog colour words do not always match wardrobe colour names one for one.
const COLOUR_SYNONYMS = {
  'off-white': 'cream', 'off white': 'cream', ivory: 'cream', oatmeal: 'ecru', beige: 'sand',
  khaki: 'tan', 'navy blue': 'navy', indigo: 'navy', 'olive green': 'olive', 'dark green': 'forest green',
  'light blue': 'sky blue', 'pale blue': 'sky blue', 'powder blue': 'sky blue', gray: 'grey',
  'light gray': 'light grey', maroon: 'burgundy', terracotta: 'rust', brown: 'chocolate',
};

const GARMENT_CATEGORY = new Map(GARMENTS);

function alternation(words) {
  return words
    .slice()
    .sort((a, b) => b.length - a.length)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
}

const IDEA_PATTERN = new RegExp(
  `\\b(?:(${alternation(COLOUR_WORDS)})\\s+)?(?:(${alternation(MATERIALS)})\\s+)?(${alternation(GARMENTS.map(([word]) => word))})\\b`,
  'gi',
);

// ── Reading the sources ────────────────────────────────────────────────────
async function readStyleSource(source) {
  // Markdown rather than HTML: it strips the navigation and leaves the writing.
  const body = await fetchText(`https://r.jina.ai/${source.url}`);
  return extractGarmentIdeas(body, source);
}

// Slugs such as "navy-blue-hopsack-sport-coat-with-white-linen-pants" describe
// whole outfits, so URLs are turned back into words rather than discarded.
function readableText(markdown) {
  return String(markdown ?? '').replace(/https?:\/\/\S+/g, match => match.replace(/[-_/]+/g, ' '));
}

function extractGarmentIdeas(markdown, source) {
  const text = readableText(markdown);
  const ideas = new Map();

  for (const match of text.matchAll(IDEA_PATTERN)) {
    const garment = match[3].toLowerCase();
    const category = GARMENT_CATEGORY.get(garment);
    if (!category) continue;

    const rawColour = match[1]?.toLowerCase() || '';
    const colour = COLOUR_SYNONYMS[rawColour] || rawColour;
    const material = match[2]?.toLowerCase() || '';
    const key = `${material} ${garment}`.trim();

    const idea = ideas.get(key) || {
      garment, category, material, mentions: 0, colours: new Set(), source: source.name, sourceUrl: source.url,
    };
    idea.mentions++;
    if (colour && wardrobeColor(colour)) idea.colours.add(colour);
    ideas.set(key, idea);
  }

  return [...ideas.values()].map(idea => ({ ...idea, colours: [...idea.colours] }));
}

async function gatherStyleIdeas({ onProgress = () => {} } = {}) {
  const cached = readIdeasCache();
  if (cached) return cached;

  // A rotating subset keeps runs quick and the recommendations varied.
  const sources = shuffle(STYLE_SOURCES).slice(0, SOURCES_PER_RUN);
  const collected = [];
  const read = [];

  for (const source of sources) {
    onProgress(`Reading ${source.name}…`);
    try {
      const ideas = await readStyleSource(source);
      if (ideas.length) {
        collected.push(...ideas);
        read.push(source);
      }
    } catch {
      // A source that will not load is simply skipped.
    }
  }

  if (!collected.length) throw new Error('no_sources_read');
  const result = { ideas: mergeIdeas(collected), sources: read, readAt: Date.now() };
  writeIdeasCache(result);
  return result;
}

function mergeIdeas(ideas) {
  const merged = new Map();
  for (const idea of ideas) {
    const key = `${idea.material} ${idea.garment}`.trim();
    const running = merged.get(key);
    if (!running) {
      merged.set(key, { ...idea, sources: [idea.source] });
      continue;
    }
    running.mentions += idea.mentions;
    running.colours = [...new Set([...running.colours, ...idea.colours])];
    if (!running.sources.includes(idea.source)) running.sources.push(idea.source);
  }
  return [...merged.values()].sort((a, b) => b.mentions - a.mentions);
}

function shuffle(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function readIdeasCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(IDEAS_CACHE_KEY) || 'null');
    return cached && Date.now() - cached.readAt < IDEAS_CACHE_MS ? cached : null;
  } catch {
    return null;
  }
}

function writeIdeasCache(result) {
  try {
    localStorage.setItem(IDEAS_CACHE_KEY, JSON.stringify(result));
  } catch { /* not worth failing a run over */ }
}

function clearIdeasCache() {
  try {
    localStorage.removeItem(IDEAS_CACHE_KEY);
  } catch { /* ignore */ }
}

// ── Turning ideas into outfits ─────────────────────────────────────────────
// "Linen camp collar shirt" is something you can search for and buy; "shirt" is
// not, however often it is mentioned. Specificity therefore outweighs how
// frequently a word came up.
function scoreIdea(idea, { palette, accents, preferenceWords }) {
  let score = Math.min(idea.mentions, 4);
  if (idea.sources.length > 1) score += 3;
  if (idea.material) score += 3;
  if (idea.garment.includes(' ')) score += 6;
  if (idea.colours.some(colour => palette.includes(colour))) score += 3;
  if (idea.colours.some(colour => accents.includes(colour))) score += 2;

  const words = `${idea.material} ${idea.garment}`;
  score += preferenceWords.filter(word => words.includes(word)).length * 3;
  return score;
}

// Prefers a colour the writer already suggested when the wardrobe agrees with
// it, and otherwise dresses the garment in a colour that suits what is owned.
function chooseColour(idea, { palette, accents, avoid = [] }) {
  const shared = idea.colours.find(colour => palette.includes(colour) && !avoid.includes(colour));
  if (shared) return { colour: shared, reason: 'wardrobe' };

  const accent = accents.find(colour => !avoid.includes(colour));
  const owned = palette.find(colour => !avoid.includes(colour));
  const suggested = idea.colours.find(colour => !avoid.includes(colour));

  if (accent) return { colour: accent, reason: 'accent' };
  if (suggested) return { colour: suggested, reason: 'source' };
  if (owned) return { colour: owned, reason: 'wardrobe' };
  return { colour: DEFAULT_PALETTE.find(colour => !avoid.includes(colour)) || 'ecru', reason: 'default' };
}

function pieceLabel({ colour, material, garment }) {
  return [colour, material, garment].filter(Boolean).join(' ');
}

// Builds wearable pairings: something on top, something on the bottom, in two
// colours that work together.
function buildOutfitIdeas({ ideas, sources, palette, accents, preferences = '', limit = 5 }) {
  const avoid = avoidedColorNames(preferences);
  palette = palette.filter(colour => !avoid.includes(colour));
  accents = accents.filter(colour => !avoid.includes(colour));

  const preferenceWords = String(preferences).toLowerCase().split(/[^a-z-]+/).filter(word => word.length > 3);
  const context = { palette, accents, preferenceWords };

  const ranked = ideas
    .map(idea => ({ ...idea, score: scoreIdea(idea, context) }))
    .sort((a, b) => b.score - a.score);

  const tops = ranked.filter(idea => idea.category === 'top');
  const bottoms = ranked.filter(idea => idea.category === 'bottom');
  const outers = ranked.filter(idea => idea.category === 'outer');

  const outfits = [];
  const usedGarments = new Set();

  for (const top of tops) {
    if (outfits.length >= limit) break;
    if (usedGarments.has(top.garment)) continue;

    const topColour = chooseColour(top, { palette, accents, avoid });
    const bottom = bottoms.find(candidate =>
      !usedGarments.has(candidate.garment) &&
      candidate.garment !== top.garment &&
      pickBottomColour(candidate, topColour.colour, { palette, accents, avoid }));
    if (!bottom) continue;

    const bottomColour = pickBottomColour(bottom, topColour.colour, { palette, accents, avoid });
    usedGarments.add(top.garment);
    usedGarments.add(bottom.garment);

    const pieces = [
      { ...top, colour: topColour.colour, label: pieceLabel({ ...top, colour: topColour.colour }) },
      { ...bottom, colour: bottomColour, label: pieceLabel({ ...bottom, colour: bottomColour }) },
    ];

    outfits.push({
      id: `${top.garment}-${bottom.garment}`.replace(/\s+/g, '-'),
      title: outfitTitle(pieces),
      pieces,
      why: explainOutfit(pieces, topColour, { palette, accents }),
      sources: [...new Set([...top.sources, ...bottom.sources])],
      sourceLinks: sources.filter(source => [...top.sources, ...bottom.sources].includes(source.name)),
      colours: [topColour.colour, bottomColour],
    });
  }

  // An outer layer is a nice-to-have, added only where one clearly fits.
  for (const outfit of outfits) {
    const outer = outers.find(candidate => !outfit.pieces.some(piece => piece.garment === candidate.garment));
    if (!outer || outfit.pieces.length > 2) continue;
    const colour = pickBottomColour(outer, outfit.colours[0], { palette, accents, avoid });
    if (!colour || outfit.colours.includes(colour)) continue;
    outfit.extra = { ...outer, colour, label: pieceLabel({ ...outer, colour }) };
  }

  return outfits;
}

function pickBottomColour(idea, topColour, { palette, accents, avoid = [] }) {
  const candidates = [
    ...idea.colours.filter(colour => colorsGoTogether(colour, topColour)),
    ...palette.filter(colour => colorsGoTogether(colour, topColour)),
    ...accents.filter(colour => colorsGoTogether(colour, topColour)),
    ...(wardrobeColor(topColour)?.goesWith || []),
  ];
  return candidates.find(colour => colour && colour !== topColour && !avoid.includes(colour)) || '';
}

function outfitTitle(pieces) {
  const [top, bottom] = pieces;
  const name = `${capitalise(top.colour)} ${top.material || ''} ${top.garment}`.replace(/\s+/g, ' ').trim();
  return `${name} with ${bottom.colour} ${bottom.garment}`;
}

function capitalise(word) {
  return String(word || '').charAt(0).toUpperCase() + String(word || '').slice(1);
}

function explainOutfit(pieces, topColour, { palette }) {
  const [top, bottom] = pieces;
  const writers = [...new Set(top.sources)].slice(0, 2).join(' and ');
  const colourReason = topColour.reason === 'wardrobe'
    ? `${top.colour} is already the tone your lookbook leans on`
    : topColour.reason === 'accent'
      ? `${top.colour} is the colour missing from a lookbook built on ${palette.slice(0, 2).join(' and ') || 'neutrals'}`
      : `${top.colour} suits the rest of your wardrobe`;

  return `${capitalise(top.material || top.garment)} ${top.material ? top.garment : 'pieces'} keep coming up on ${writers || 'the blogs read'}, and ${colourReason}. ${capitalise(bottom.colour)} ${bottom.garment} finish it without fighting the top.`;
}

// ── Finding something to buy ───────────────────────────────────────────────
const SEARCH_ENDPOINTS = [
  query => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  query => `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  query => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
];

// Marketplaces, category listings and search results are not a specific
// product, and a search page dressed up as a result is the most common way a
// query goes wrong.
const NOT_A_PRODUCT = /(?:\/search|\/s\?|\/browse\/|\/market\/|\/category\/|\/categories\/|\/collections\/[^/]+\/?$|\/c\/|\/buy\/|\/shop\/?$|\/shop\/[^/]*$|pinterest\.|reddit\.|youtube\.|facebook\.|instagram\.|tiktok\.|wikipedia\.|quora\.|substack\.|blogspot\.|medium\.com|\.pdf$)/i;
const SEARCH_QUERY = /[?&](?:q|k|s|query|keyword|search|_nkw|srsltid)=/i;
const LOOKS_LIKE_PRODUCT = /\/(?:products?|p|dp|itm|item|pd)\/|\/product-|-p\d{4,}|\/p\d{4,}/i;

async function searchProductUrl(query, { onProgress = () => {} } = {}) {
  const candidates = await searchResults(`${query} buy`, { onProgress });
  if (!candidates.length) return null;

  const words = String(query).toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
  const scored = candidates
    .map(url => ({ url, score: scoreProductUrl(url, words) }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.url || null;
}

async function searchResults(query, { onProgress = () => {} } = {}) {
  for (const endpoint of SEARCH_ENDPOINTS) {
    onProgress(`Searching for ${query.replace(/ buy$/, '')}…`);
    try {
      const body = await fetchText(`https://r.jina.ai/${endpoint(query)}`);
      const urls = extractSearchResultUrls(body);
      if (urls.length) return urls;
    } catch {
      // Try the next endpoint.
    }
  }
  return [];
}

// DuckDuckGo wraps every result in a redirect carrying the real address in a
// `uddg` parameter; its own links and sponsored slots are dropped.
function extractSearchResultUrls(body) {
  const urls = [];
  for (const match of String(body).matchAll(/uddg=([^&)\s"'\]]+)/g)) {
    let url;
    try {
      url = decodeURIComponent(match[1]);
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(url)) continue;
    if (/duckduckgo\.com|ad_domain=|ad_provider=/i.test(url)) continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}

function scoreProductUrl(url, words) {
  if (NOT_A_PRODUCT.test(url) || SEARCH_QUERY.test(url)) return 0;

  const slug = url.toLowerCase().replace(/https?:\/\//, '');
  const matches = words.filter(word => slug.includes(word)).length;
  // Two words in common is the difference between a page about this garment
  // and a page that merely sells clothes.
  if (matches < 2) return 0;

  let score = matches * 4;
  if (LOOKS_LIKE_PRODUCT.test(url)) score += 10;
  // A descriptive final segment, e.g. /mens-merino-sweater-dark-navy, names one
  // item even on shops that use no product prefix at all.
  if (/[^/]+(?:-[^/]+){2,}(?:\.html?)?$/i.test(new URL(url).pathname)) score += 6;
  return score;
}
