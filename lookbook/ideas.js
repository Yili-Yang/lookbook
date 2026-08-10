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

const SOURCES_PER_RUN = 5;
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
// Colours already spent on other suggestions are skipped, so a list of ideas
// does not come back as five variations on navy.
function chooseColour(idea, { palette, accents, avoid = [], taken = [] }) {
  const free = colour => colour && !avoid.includes(colour) && !taken.includes(colour);

  const shared = idea.colours.find(colour => palette.includes(colour) && free(colour));
  if (shared) return { colour: shared, reason: 'wardrobe' };

  const accent = accents.find(free);
  if (accent) return { colour: accent, reason: 'accent' };

  const suggested = idea.colours.find(free);
  if (suggested) return { colour: suggested, reason: 'source' };

  const owned = palette.find(free);
  if (owned) return { colour: owned, reason: 'wardrobe' };

  // Everything suitable is already used; repeating beats returning nothing.
  const fallback = [...accents, ...palette, ...DEFAULT_PALETTE].find(colour => !avoid.includes(colour));
  return { colour: fallback || 'ecru', reason: 'wardrobe' };
}

// Writers usually name the garment and leave the cloth to the reader. Without
// one, a search returns a department rather than a shirt, so each garment has a
// sensible default — presented as part of the suggestion, never as something a
// writer said. Garments that already imply their cloth get none.
const DEFAULT_MATERIALS = {
  'camp collar shirt': 'linen', 'camp-collar shirt': 'linen', 'oxford shirt': 'cotton',
  'button-down shirt': 'cotton', 'button down shirt': 'cotton', 'polo shirt': 'cotton',
  'crewneck sweater': 'merino', 'crew neck sweater': 'merino', 'cardigan': 'wool',
  'turtleneck': 'merino', 'sweatshirt': 'cotton', 'henley': 'cotton', 'tank top': 'cotton',
  't-shirt': 'cotton', 'tee': 'cotton', 'blouse': 'silk', 'shirt': 'cotton', 'sweater': 'merino',
  'jumper': 'merino', 'knit': 'cotton', 'polo': 'cotton', 'vest': 'wool',
  'pleated trousers': 'wool', 'wide-leg trousers': 'linen', 'wide leg trousers': 'linen',
  'cargo trousers': 'cotton', 'chinos': 'cotton', 'trousers': 'wool', 'pants': 'cotton',
  'shorts': 'cotton', 'skirt': 'cotton', 'midi skirt': 'linen',
  'sport coat': 'wool', 'chore coat': 'cotton', 'chore jacket': 'cotton', 'trench coat': 'cotton',
  'field jacket': 'cotton', 'overshirt': 'wool', 'blazer': 'wool', 'coat': 'wool',
  'loafers': 'suede', 'derbies': 'leather', 'boots': 'leather', 'sandals': 'leather', 'mules': 'leather',
};

function materialFor(idea) {
  return idea.material || DEFAULT_MATERIALS[idea.garment] || '';
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

  // "Linen camp collar shirt" can be searched for; "shirt" returns a category
  // page. Anything nameable is used first, whatever the mention count says.
  const byUsefulness = category => [
    ...ranked.filter(idea => idea.category === category && isSearchable(idea)),
    ...ranked.filter(idea => idea.category === category && !isSearchable(idea)),
  ];

  const tops = byUsefulness('top');
  const bottoms = orderBottoms(byUsefulness('bottom'), preferences);
  const outers = byUsefulness('outer');

  const outfits = [];
  const usedGarments = new Set();
  const usedColours = [];
  const usedBottomColours = [];

  for (const top of tops) {
    if (outfits.length >= limit) break;
    if (usedGarments.has(top.garment)) continue;

    const topColour = chooseColour(top, { palette, accents, avoid, taken: usedColours });
    usedColours.push(topColour.colour);
    const bottom = bottoms.find(candidate =>
      !usedGarments.has(candidate.garment) &&
      candidate.garment !== top.garment &&
      pickBottomColour(candidate, topColour.colour, { palette, accents, avoid }));
    if (!bottom) continue;

    const bottomColour = pickBottomColour(bottom, topColour.colour, { palette, accents, avoid, taken: usedBottomColours });
    usedBottomColours.push(bottomColour);
    usedGarments.add(top.garment);
    usedGarments.add(bottom.garment);

    const pieces = [describePiece(top, topColour.colour), describePiece(bottom, bottomColour)];

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
    outfit.extra = describePiece(outer, colour);
  }

  return outfits;
}

// The cloth is what makes a query specific. "Linen camp collar shirt" finds a
// shirt; "tank top" finds a department. Multi-word garment names look specific
// but are not — they are still just the name of a category.
function describePiece(idea, colour) {
  const material = materialFor(idea);
  return {
    ...idea,
    colour,
    material,
    // Only a cloth the writer actually named may be credited to them.
    materialFromSource: Boolean(idea.material),
    label: pieceLabel({ colour, material, garment: idea.garment }),
  };
}

function isSearchable(idea) {
  return Boolean(idea.material);
}

// Skirts and dresses only belong in a suggestion if the wardrobe or the style
// note gives some sign they are wanted; otherwise they go last rather than
// being dropped, since this is a guess and not a rule.
const WOMENSWEAR_HINT = /\b(?:skirt|skirts|dress|dresses|blouse|midi|maxi|women|womens|women's|her)\b/i;
const WOMENSWEAR_GARMENT = /\b(?:skirt|dress)\b/i;

function orderBottoms(bottoms, preferences) {
  if (WOMENSWEAR_HINT.test(preferences || '')) return bottoms;
  return [
    ...bottoms.filter(idea => !WOMENSWEAR_GARMENT.test(idea.garment)),
    ...bottoms.filter(idea => WOMENSWEAR_GARMENT.test(idea.garment)),
  ];
}

function pickBottomColour(idea, topColour, { palette, accents, avoid = [], taken = [] }) {
  const candidates = [
    ...idea.colours.filter(colour => colorsGoTogether(colour, topColour)),
    ...palette.filter(colour => colorsGoTogether(colour, topColour)),
    ...accents.filter(colour => colorsGoTogether(colour, topColour)),
    ...(wardrobeColor(topColour)?.goesWith || []),
  ].filter(colour => colour && colour !== topColour && !avoid.includes(colour));

  // Spread the suggestions out rather than putting the same trousers under
  // every top, but repeat sooner than return nothing.
  return candidates.find(colour => !taken.includes(colour)) || candidates[0] || '';
}

function outfitTitle(pieces) {
  const [top, bottom] = pieces;
  return `${capitalise(top.label)} with ${bottom.label}`;
}

function capitalise(word) {
  return String(word || '').charAt(0).toUpperCase() + String(word || '').slice(1);
}

// "Jeans" and "chinos" are already plural; "shirt" is not.
const ALREADY_PLURAL = /(?:s|jeans|chinos|trousers|shorts|pants)$/i;

function pluralise(garment) {
  return ALREADY_PLURAL.test(garment) ? garment : `${garment}s`;
}

function agrees(garment, singular, plural) {
  return ALREADY_PLURAL.test(garment) ? plural : singular;
}

function explainOutfit(pieces, topColour, { palette }) {
  const [top, bottom] = pieces;
  const writers = [...new Set(top.sources)].slice(0, 2).join(' and ');
  const subject = pluralise((top.materialFromSource ? `${top.material} ${top.garment}` : top.garment).trim());
  const colourReason = topColour.reason === 'wardrobe'
    ? `${top.colour} is already the tone your lookbook leans on`
    : topColour.reason === 'accent'
      ? `${top.colour} is missing from a lookbook built on ${palette.slice(0, 2).join(' and ') || 'neutrals'}`
      : `${top.colour} suits the rest of your wardrobe`;

  return `${capitalise(subject)} keep coming up on ${writers || 'the blogs read today'}, and ${colourReason}. `
    + `${capitalise(bottom.label)} ${agrees(bottom.garment, 'finishes', 'finish')} it without fighting the top.`;
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
const NOT_A_PRODUCT = new RegExp([
  '/search', '/s/', '/s\\?', '/sch/', '/browse/', '/market/', '/category/', '/categories/',
  '/product-category/', '/product-tag/', '/collection/', '/dept/', '/departments/',
  '/collections/[^/]+/?$', '/c/', '/buy/', '/shop/?$', '/shop/(?!product)',
  '_normal|[?&](?:filter|facet|refine)', 'pinterest\\.', 'reddit\\.', 'youtube\\.', 'facebook\\.',
  'instagram\\.', 'tiktok\\.', 'wikipedia\\.', 'quora\\.', 'substack\\.', 'blogspot\\.',
  'medium\\.com', '\\.pdf$',
].join('|'), 'i');
const SEARCH_QUERY = /[?&](?:q|k|s|query|keyword|search|_nkw|srsltid)=/i;
const LOOKS_LIKE_PRODUCT = /\/(?:products?|p|dp|itm|item|pd)\/|\/product-|-p\d{4,}|\/p\d{4,}/i;

// Wardrobe colour names double as other things — navy is a branch of the armed
// forces, olive is a fruit — and searching for the fuller name avoids a shirt
// that is navy only in the naval sense.
const SEARCH_SYNONYMS = { navy: 'navy blue', olive: 'olive green', sage: 'sage green', mustard: 'mustard yellow' };

function unambiguous(query) {
  return String(query).replace(/^\s*([a-z]+)/i, (match, first) => SEARCH_SYNONYMS[first.toLowerCase()] || match);
}

async function searchProductUrl(query, { onProgress = () => {} } = {}) {
  const candidates = await searchResults(`${unambiguous(query)} buy`, { onProgress });
  if (!candidates.length) return null;

  // Scored against what was asked for, not the expanded phrasing.
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

// A category page and a product page look alike from the outside. What tells
// them apart is that a product is identified: by a /products/ style path, by an
// id or SKU, or by a slug long enough to name one specific thing. A path that
// is only the words searched for — /navy-tank-top — is a department.
const PRODUCT_ID = /\/[a-z0-9-]*\d{4,}|\/[a-z]*\d+[a-z]+\d*(?:\.html?)?$|-\d{5,}/i;

function slugWords(path) {
  const lastSegment = path.replace(/\/$/, '').split('/').pop() || '';
  return lastSegment.replace(/\.html?$/i, '').split('-').filter(Boolean).length;
}

function scoreProductUrl(url, words) {
  if (NOT_A_PRODUCT.test(url) || SEARCH_QUERY.test(url)) return 0;

  const slug = url.toLowerCase().replace(/https?:\/\//, '');
  const matches = words.filter(word => slug.includes(word)).length;
  // Two words in common is the difference between a page about this garment
  // and a page that merely sells clothes.
  if (matches < 2) return 0;

  const path = new URL(url).pathname;
  const marked = LOOKS_LIKE_PRODUCT.test(url);
  const identified = PRODUCT_ID.test(path);
  const slugLength = slugWords(path);
  // /products/pants/linen.html is a department despite the /products/ in it,
  // and /navy-tank-top is one despite reading like a garment. What identifies a
  // single item is an id, a long descriptive slug, or a product path with a
  // slug that still names something.
  const descriptive = slugLength >= 4 || (marked && slugLength >= 3);
  if (!identified && !descriptive) return 0;

  // Marketplace listings match almost any words and are rarely the piece a
  // style writer had in mind, so a brand's own shop wins a tie.
  const marketplace = MARKETPLACE.test(url) ? 8 : 0;
  return matches * 4 + (marked ? 10 : 0) + (identified ? 6 : 0) + slugLength - marketplace;
}

const MARKETPLACE = /(?:amazon\.|ebay\.|walmart\.|aliexpress\.|temu\.|wish\.com|etsy\.|alibaba\.|dhgate\.)/i;
