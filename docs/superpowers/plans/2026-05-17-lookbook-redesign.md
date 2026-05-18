# Lookbook Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the static lookbook into a personal editable tool — add looks by pasting product URLs (images auto-fetched via CORS proxy), star/delete/edit looks, and store free-form style preferences — all persisted in localStorage.

**Architecture:** Three JS modules loaded as `<script>` tags in order: `store.js` (localStorage CRUD), `fetch.js` (CORS proxy + og:image parsing), `app.js` (DOM, rendering, event handling). No build step, no framework, no server needed. `looks.json` is deleted; all data lives in localStorage.

**Tech Stack:** Vanilla JS (ES2022), CSS custom properties, localStorage, allorigins.win CORS proxy, Google Fonts (Fraunces + Inter)

---

### Task 1: Create feature branch and scaffold new files

**Files:**
- Create: `lookbook/store.js`
- Create: `lookbook/fetch.js`

- [ ] **Step 1: Check out new branch**

```bash
cd C:/Users/yiliy/repo/lookbook
git checkout -b feature/personal-lookbook
```

Expected: `Switched to a new branch 'feature/personal-lookbook'`

- [ ] **Step 2: Create `lookbook/store.js` with placeholder**

```js
// store.js — localStorage CRUD (populated in Task 2)
```

- [ ] **Step 3: Create `lookbook/fetch.js` with placeholder**

```js
// fetch.js — CORS proxy + og metadata parsing (populated in Task 3)
```

- [ ] **Step 4: Commit scaffolding**

```bash
git add lookbook/store.js lookbook/fetch.js
git commit -m "chore: scaffold store.js and fetch.js"
```

---

### Task 2: store.js — localStorage CRUD

**Files:**
- Modify: `lookbook/store.js`
- Create: `lookbook/test.html` (inline unit tests)

- [ ] **Step 1: Write the test file first**

Create `lookbook/test.html`:

```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Tests</title></head>
<body>
<pre id="out"></pre>
<script src="store.js"></script>
<script>
  const out = document.getElementById('out');
  let passed = 0, failed = 0;

  function assert(label, got, expected) {
    const ok = JSON.stringify(got) === JSON.stringify(expected);
    out.textContent += (ok ? '✓' : '✗') + ' ' + label + (ok ? '' : '\n  got: ' + JSON.stringify(got) + '\n  exp: ' + JSON.stringify(expected)) + '\n';
    ok ? passed++ : failed++;
  }

  localStorage.clear();

  // loadLooks returns [] when empty
  assert('loadLooks empty', loadLooks(), []);

  // saveLooks + loadLooks round-trips
  const look = { id: '1', title: 'Test', starred: false, notes: '', pieces: [], createdAt: 1 };
  saveLooks([look]);
  assert('saveLooks+loadLooks', loadLooks(), [look]);

  // loadPrefs returns '' when empty
  localStorage.clear();
  assert('loadPrefs empty', loadPrefs(), '');

  // savePrefs + loadPrefs round-trips
  savePrefs('navy and cream only');
  assert('savePrefs+loadPrefs', loadPrefs(), 'navy and cream only');

  out.textContent += '\n' + passed + ' passed, ' + failed + ' failed\n';
  localStorage.clear();
</script>
</body>
</html>
```

- [ ] **Step 2: Open test.html in browser, confirm all tests FAIL** (store.js is empty)

Open `lookbook/test.html` via a local static server (e.g. `python -m http.server 8080` in `lookbook/`) and navigate to `http://localhost:8080/test.html`. Expected: 4 failing assertions.

- [ ] **Step 3: Implement `lookbook/store.js`**

```js
const LOOKS_KEY = 'lookbook-looks';
const PREFS_KEY = 'lookbook-preferences';

function loadLooks() {
  try {
    const raw = localStorage.getItem(LOOKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveLooks(looks) {
  localStorage.setItem(LOOKS_KEY, JSON.stringify(looks));
}

function loadPrefs() {
  return localStorage.getItem(PREFS_KEY) || '';
}

function savePrefs(text) {
  localStorage.setItem(PREFS_KEY, text);
}
```

- [ ] **Step 4: Refresh test.html — confirm 4 passed, 0 failed**

- [ ] **Step 5: Commit**

```bash
git add lookbook/store.js lookbook/test.html
git commit -m "feat: add localStorage store module with tests"
```

---

### Task 3: fetch.js — CORS proxy + metadata parsing

**Files:**
- Modify: `lookbook/fetch.js`
- Modify: `lookbook/test.html` (add fetch parsing tests)

- [ ] **Step 1: Add parsing tests to `lookbook/test.html`**

Add the following block inside the `<script>` in test.html, after the store tests and before the summary line:

```js
  // parseProductPage: extracts og:image
  const html1 = `<html><head>
    <meta property="og:image" content="https://cdn.example.com/product.jpg">
    <meta property="og:title" content="Relaxed Linen Shirt - COS">
    <meta property="og:site_name" content="COS">
    <meta property="product:price:amount" content="79">
    <meta property="product:price:currency" content="USD">
  </head></html>`;
  const r1 = parseProductPage(html1, 'https://www.cos.com/en-us/product/123');
  assert('og:image', r1.imageUrl, 'https://cdn.example.com/product.jpg');
  assert('og:title trimmed', r1.name, 'Relaxed Linen Shirt');
  assert('og:site_name brand', r1.brand, 'COS');
  assert('product:price:amount USD', r1.price, '$79');

  // parseProductPage: twitter:image fallback
  const html2 = `<html><head>
    <meta name="twitter:image" content="https://cdn.example.com/tw.jpg">
    <title>Navy Chinos | Uniqlo</title>
  </head></html>`;
  const r2 = parseProductPage(html2, 'https://www.uniqlo.com/us/product/456');
  assert('twitter:image fallback', r2.imageUrl, 'https://cdn.example.com/tw.jpg');
  assert('title parsed brand separator', r2.name, 'Navy Chinos');
  assert('domain brand fallback', r2.brand, 'Uniqlo');

  // parseProductPage: price regex fallback
  const html3 = `<html><body>Price: $49.90</body></html>`;
  const r3 = parseProductPage(html3, 'https://store.example.com/item');
  assert('price regex fallback', r3.price, '$49.90');
```

- [ ] **Step 2: Refresh test.html — confirm new tests FAIL**

- [ ] **Step 3: Implement `lookbook/fetch.js`**

```js
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
  const name = rawTitle.replace(/\s*[-–|·]\s*.+$/, '').trim();

  const priceAmount = getMeta('meta[property="product:price:amount"]', 'meta[property="og:price:amount"]');
  const priceCurrency = getMeta('meta[property="product:price:currency"]', 'meta[property="og:price:currency"]');
  let price = '';
  if (priceAmount) {
    const symbol = (!priceCurrency || priceCurrency === 'USD') ? '$' : priceCurrency + ' ';
    price = symbol + priceAmount;
  } else {
    price = html.match(/\$[\d,]+(?:\.\d{2})?/)?.[0] || '';
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
```

- [ ] **Step 4: Refresh test.html — confirm all tests pass**

Expected output ends with: `N passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add lookbook/fetch.js lookbook/test.html
git commit -m "feat: add fetch module with og:image parsing and tests"
```

---

### Task 4: index.html — full restructure

**Files:**
- Modify: `lookbook/index.html`

- [ ] **Step 1: Replace `lookbook/index.html` entirely**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Lookbook</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300;0,9..144,400;1,9..144,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="style.css">
</head>
<body>

  <header>
    <div class="topbar">
      <h1>Lookbook</h1>
      <div class="topbar-actions">
        <button class="btn-ghost" id="btn-prefs">Preferences</button>
        <button class="btn-primary" id="btn-add">+ Add Look</button>
      </div>
    </div>
    <nav class="filters">
      <button class="filter-btn active" data-filter="all">All</button>
      <button class="filter-btn" data-filter="starred">★ Starred</button>
    </nav>
  </header>

  <main id="looks-grid"></main>

  <!-- Add Look modal -->
  <div id="modal-overlay" class="overlay hidden" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <div class="modal">
      <div class="modal-header">
        <h2 id="modal-title">Add Look</h2>
        <button class="btn-icon" id="modal-close" aria-label="Close">✕</button>
      </div>
      <div class="modal-body">
        <div class="form-field">
          <label for="look-title">Look title</label>
          <input type="text" id="look-title" placeholder="e.g. Navy linen weekend" autocomplete="off">
        </div>
        <div id="pieces-container"></div>
        <button class="btn-ghost btn-sm" id="btn-add-piece">+ Add piece</button>
        <div class="form-field" style="margin-top:16px">
          <label for="look-notes">Notes <span class="label-optional">(optional)</span></label>
          <textarea id="look-notes" placeholder="Where you'd wear it, fit notes..."></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-ghost" id="btn-cancel">Cancel</button>
        <button class="btn-primary" id="btn-save" disabled>Save Look</button>
      </div>
    </div>
  </div>

  <!-- Preferences drawer -->
  <div id="drawer-backdrop" class="drawer-backdrop hidden"></div>
  <aside id="prefs-drawer" class="drawer hidden" aria-label="Style preferences">
    <div class="drawer-header">
      <h2>My Style</h2>
      <button class="btn-icon" id="drawer-close" aria-label="Close">✕</button>
    </div>
    <textarea id="prefs-text" placeholder="Write anything — fits you like, colors, brands, what to avoid, wardrobe gaps..."></textarea>
  </aside>

  <script src="store.js"></script>
  <script src="fetch.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Open `http://localhost:8080/` in browser — verify page loads without JS errors**

Open browser devtools → Console. Expected: no errors. Page shows header only (grid is empty, that's correct since app.js is still old).

- [ ] **Step 3: Commit**

```bash
git add lookbook/index.html
git commit -m "feat: restructure index.html with modal and drawer markup"
```

---

### Task 5: style.css — full rewrite

**Files:**
- Modify: `lookbook/style.css`

- [ ] **Step 1: Replace `lookbook/style.css` entirely**

```css
:root {
  --bg: #f5f1ea;
  --bg-card: #ffffff;
  --bg-soft: #ebe4d7;
  --ink: #1a1a17;
  --ink-soft: #6b665a;
  --ink-faint: #a39d8d;
  --line: #d8d1c0;
  --accent: #6b5d3f;
  --serif: 'Fraunces', Georgia, serif;
  --sans: 'Inter', -apple-system, system-ui, sans-serif;
  --radius: 4px;
  --shadow: 0 1px 0 var(--line);
  --shadow-hover: 0 12px 32px -8px rgba(26,26,23,0.12);
}

*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }

body {
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
}

/* ── Header ── */
header {
  max-width: 1100px;
  margin: 0 auto;
  padding: 40px 32px 0;
}

.topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 32px;
}

h1 {
  font-family: var(--serif);
  font-size: clamp(40px, 6vw, 72px);
  font-weight: 300;
  font-style: italic;
  letter-spacing: -0.03em;
  line-height: 1;
  color: var(--ink);
}

.topbar-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}

/* ── Buttons ── */
.btn-primary {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  padding: 9px 18px;
  background: var(--ink);
  color: var(--bg);
  border: none;
  border-radius: var(--radius);
  cursor: pointer;
  transition: opacity 0.15s;
}
.btn-primary:hover { opacity: 0.85; }
.btn-primary:disabled { opacity: 0.35; cursor: not-allowed; }

.btn-ghost {
  font-family: var(--sans);
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.04em;
  padding: 9px 16px;
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btn-ghost:hover { background: var(--bg-soft); border-color: var(--ink-soft); }

.btn-sm { font-size: 12px; padding: 6px 12px; }

.btn-icon {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 16px;
  color: var(--ink-soft);
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  transition: background 0.15s, color 0.15s;
}
.btn-icon:hover { background: var(--bg-soft); color: var(--ink); }

/* ── Filters ── */
.filters {
  display: flex;
  gap: 4px;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  padding: 12px 0;
  margin-bottom: 0;
}

.filter-btn {
  font-family: var(--sans);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-soft);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 5px 14px;
  border-radius: 100px;
  transition: all 0.15s;
}
.filter-btn:hover { color: var(--ink); background: var(--bg-soft); }
.filter-btn.active { background: var(--ink); color: var(--bg); }

/* ── Grid ── */
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: 40px 32px 96px;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 440px), 1fr));
  gap: 28px;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 80px 0;
  font-family: var(--serif);
  font-style: italic;
  font-weight: 300;
  font-size: 18px;
  color: var(--ink-faint);
}

/* ── Look card ── */
.look-card {
  background: var(--bg-card);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  transition: transform 0.25s, box-shadow 0.25s;
  position: relative;
}
.look-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); }

.look-photos {
  display: grid;
  grid-template-columns: repeat(var(--photo-count, 2), 1fr);
  background: var(--bg-card);
  border-bottom: 1px solid var(--line);
}

.photo-cell {
  aspect-ratio: 3/4;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  overflow: hidden;
  border-right: 1px solid var(--line);
}
.photo-cell:last-child { border-right: none; }

.photo-cell img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  display: block;
}

.photo-cell .photo-error {
  font-size: 11px;
  color: var(--ink-faint);
  font-style: italic;
  text-align: center;
}

.look-body {
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
}

.look-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 12px;
}

.look-title-text {
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 400;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--ink);
  cursor: pointer;
  border-radius: 2px;
  padding: 1px 3px;
  margin: -1px -3px;
  transition: background 0.15s;
}
.look-title-text:hover { background: var(--bg-soft); }

.look-title-input {
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 400;
  line-height: 1.2;
  letter-spacing: -0.01em;
  color: var(--ink);
  background: var(--bg-soft);
  border: 1px solid var(--ink);
  border-radius: 2px;
  padding: 1px 3px;
  width: 100%;
  outline: none;
}

.look-actions {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-shrink: 0;
}

.star-btn {
  background: transparent;
  border: 1px solid var(--line);
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-soft);
  transition: all 0.15s;
  flex-shrink: 0;
}
.star-btn:hover { border-color: var(--ink); color: var(--ink); }
.star-btn.starred { background: var(--ink); border-color: var(--ink); color: var(--bg); }

.delete-btn {
  background: transparent;
  border: 1px solid transparent;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--ink-faint);
  transition: all 0.15s;
  flex-shrink: 0;
  opacity: 0;
}
.look-card:hover .delete-btn { opacity: 1; }
.delete-btn:hover { border-color: #c0392b; color: #c0392b; background: #fef5f5; }

/* ── Piece rows ── */
.piece-rows { display: flex; flex-direction: column; gap: 6px; }

.piece-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  padding: 10px;
  background: var(--bg);
  border-radius: 3px;
}

.piece-thumb {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  border-radius: 3px;
  background: var(--bg-soft);
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}
.piece-thumb img { width: 100%; height: 100%; object-fit: cover; }

.piece-info { flex: 1; min-width: 0; }

.piece-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--ink);
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.piece-meta {
  font-size: 11px;
  color: var(--ink-soft);
  margin-top: 1px;
}

.piece-price {
  font-family: var(--serif);
  font-style: italic;
  color: var(--accent);
  margin-left: 4px;
}

.piece-link {
  display: inline-block;
  margin-top: 5px;
  font-size: 11px;
  letter-spacing: 0.04em;
  padding: 2px 8px;
  border: 1px solid var(--line);
  border-radius: 100px;
  text-decoration: none;
  color: var(--ink);
  background: var(--bg-card);
  transition: all 0.12s;
}
.piece-link:hover { background: var(--ink); color: var(--bg); border-color: var(--ink); }

/* ── Notes textarea (in card) ── */
.look-notes {
  width: 100%;
  font-family: var(--sans);
  font-size: 12px;
  font-style: italic;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--bg);
  color: var(--ink);
  resize: vertical;
  min-height: 32px;
}
.look-notes::placeholder { color: var(--ink-faint); }
.look-notes:focus { outline: none; border-color: var(--ink); }

/* ── Modal ── */
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 23, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
  overflow-y: auto;
}
.overlay.hidden { display: none; }

.modal {
  background: var(--bg-card);
  border-radius: 6px;
  width: 100%;
  max-width: 560px;
  box-shadow: 0 24px 64px -12px rgba(26,26,23,0.3);
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 48px);
  overflow: hidden;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.modal-header h2 {
  font-family: var(--serif);
  font-size: 22px;
  font-weight: 400;
  font-style: italic;
}

.modal-body {
  padding: 20px 24px;
  overflow-y: auto;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.modal-footer {
  padding: 16px 24px 20px;
  border-top: 1px solid var(--line);
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
}

/* ── Form fields ── */
.form-field { display: flex; flex-direction: column; gap: 6px; }

.form-field label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.label-optional {
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
  font-size: 11px;
  color: var(--ink-faint);
}

.form-field input,
.form-field textarea {
  font-family: var(--sans);
  font-size: 14px;
  padding: 9px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--ink);
  width: 100%;
  transition: border-color 0.15s;
}
.form-field input:focus,
.form-field textarea:focus { outline: none; border-color: var(--ink); }
.form-field textarea { min-height: 72px; resize: vertical; }

/* ── Piece slot (in modal) ── */
.piece-slot {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  padding: 14px;
  background: var(--bg);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.piece-slot-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.piece-slot-label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--ink-soft);
}

.slot-url-row {
  display: flex;
  gap: 8px;
}

.slot-url-row input {
  flex: 1;
  font-family: var(--sans);
  font-size: 13px;
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--bg-card);
  color: var(--ink);
  transition: border-color 0.15s;
}
.slot-url-row input:focus { outline: none; border-color: var(--ink); }

.slot-preview {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.slot-img {
  width: 72px;
  height: 72px;
  border-radius: 3px;
  object-fit: cover;
  background: var(--bg-soft);
  border: 1px solid var(--line);
  flex-shrink: 0;
}

.slot-fields {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slot-fields input {
  font-family: var(--sans);
  font-size: 13px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--bg-card);
  color: var(--ink);
  width: 100%;
}
.slot-fields input:focus { outline: none; border-color: var(--ink); }

.slot-status {
  font-size: 12px;
  font-style: italic;
  color: var(--ink-soft);
  display: flex;
  align-items: center;
  gap: 6px;
}
.slot-status.error { color: #c0392b; }

.slot-fallback input {
  font-family: var(--sans);
  font-size: 12px;
  padding: 6px 8px;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: var(--bg-card);
  color: var(--ink);
  width: 100%;
}
.slot-fallback input:focus { outline: none; border-color: var(--ink); }
.slot-fallback-label {
  font-size: 11px;
  color: var(--ink-soft);
  margin-bottom: 4px;
}

/* ── Spinner ── */
.spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid var(--line);
  border-top-color: var(--ink);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes spin { to { transform: rotate(360deg); } }

/* ── Preferences drawer ── */
.drawer-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(26, 26, 23, 0.35);
  z-index: 90;
}
.drawer-backdrop.hidden { display: none; }

.drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  background: var(--bg-card);
  box-shadow: -4px 0 32px -4px rgba(26,26,23,0.15);
  z-index: 91;
  display: flex;
  flex-direction: column;
  padding: 0;
  transform: translateX(0);
  transition: transform 0.25s ease;
}
.drawer.hidden { display: none; }

.drawer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 20px 20px 16px;
  border-bottom: 1px solid var(--line);
  flex-shrink: 0;
}

.drawer-header h2 {
  font-family: var(--serif);
  font-size: 20px;
  font-weight: 400;
  font-style: italic;
}

#prefs-text {
  flex: 1;
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.65;
  padding: 16px 20px;
  border: none;
  resize: none;
  background: var(--bg-card);
  color: var(--ink);
  width: 100%;
}
#prefs-text::placeholder { color: var(--ink-faint); }
#prefs-text:focus { outline: none; }

/* ── Responsive ── */
@media (max-width: 640px) {
  header { padding: 28px 20px 0; }
  main { padding: 28px 20px 64px; gap: 18px; }
  .topbar { flex-wrap: wrap; gap: 12px; }
  .drawer { width: 100%; }
  .modal { max-height: 100vh; border-radius: 0; margin: 0; }
}
```

- [ ] **Step 2: Reload `http://localhost:8080/` — verify layout looks correct**

Expected: header with "Lookbook" title, Preferences + Add Look buttons, filter bar with All/Starred pills, empty main area. No console errors.

- [ ] **Step 3: Commit**

```bash
git add lookbook/style.css
git commit -m "feat: new style.css with card, modal, and drawer styles"
```

---

### Task 6: app.js — state + render functions

**Files:**
- Modify: `lookbook/app.js` (full rewrite — replace all existing content)

- [ ] **Step 1: Replace `lookbook/app.js` with state + render skeleton**

```js
// ── State ──────────────────────────────────────────────────────────────────
let looks = [];
let currentFilter = 'all';

function getLooks() {
  return currentFilter === 'starred' ? looks.filter(l => l.starred) : looks;
}

// ── UUID ───────────────────────────────────────────────────────────────────
function uuid() {
  return crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ── Escape HTML ────────────────────────────────────────────────────────────
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Render ─────────────────────────────────────────────────────────────────
function renderGrid() {
  const grid = document.getElementById('looks-grid');
  const visible = getLooks();

  if (visible.length === 0) {
    grid.innerHTML = `<p class="empty-state">${currentFilter === 'starred' ? 'No starred looks yet.' : 'No looks yet — add your first one.'}</p>`;
    return;
  }

  grid.innerHTML = visible.map(renderLook).join('');
}

function renderLook(look) {
  const photoCount = look.pieces.length;
  const photosHtml = look.pieces.map(p => `
    <div class="photo-cell">
      <img src="${esc(p.imageUrl)}" alt="${esc(p.name)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span class="photo-error" style="display:none">Image unavailable</span>
    </div>
  `).join('');

  const piecesHtml = look.pieces.map(p => `
    <div class="piece-row">
      <div class="piece-thumb">
        <img src="${esc(p.imageUrl)}" alt="${esc(p.name)}"
             onerror="this.parentElement.style.background='var(--bg-soft)'">
      </div>
      <div class="piece-info">
        <div class="piece-name">${esc(p.name)}${p.price ? `<span class="piece-price">${esc(p.price)}</span>` : ''}</div>
        <div class="piece-meta">${esc(p.brand)}</div>
        <a class="piece-link" href="${esc(p.productUrl)}" target="_blank" rel="noopener">Shop →</a>
      </div>
    </div>
  `).join('');

  return `
    <article class="look-card" data-id="${esc(look.id)}">
      <div class="look-photos" style="--photo-count:${photoCount}">
        ${photosHtml}
      </div>
      <div class="look-body">
        <div class="look-head">
          <span class="look-title-text" title="Click to rename" onclick="startTitleEdit('${esc(look.id)}', this)">${esc(look.title)}</span>
          <div class="look-actions">
            <button class="star-btn ${look.starred ? 'starred' : ''}" onclick="toggleStar('${esc(look.id)}')" aria-label="${look.starred ? 'Unstar' : 'Star'} look">
              ${look.starred ? '★' : '☆'}
            </button>
            <button class="delete-btn" onclick="deleteLook('${esc(look.id)}')" aria-label="Delete look">🗑</button>
          </div>
        </div>
        <div class="piece-rows">${piecesHtml}</div>
        <textarea class="look-notes" placeholder="Add a note about fit, sizing, where you'd wear it..."
                  oninput="saveNotes('${esc(look.id)}', this.value)">${esc(look.notes)}</textarea>
      </div>
    </article>
  `;
}
```

- [ ] **Step 2: Reload — verify no JS errors**

The grid will still be empty. No console errors expected.

- [ ] **Step 3: Commit**

```bash
git add lookbook/app.js
git commit -m "feat: app.js state and render functions"
```

---

### Task 7: app.js — Add Look modal

**Files:**
- Modify: `lookbook/app.js` (append to existing content)

- [ ] **Step 1: Append modal logic to `lookbook/app.js`**

```js
// ── Modal ──────────────────────────────────────────────────────────────────
let pieceSlotCount = 0;

function openModal() {
  pieceSlotCount = 0;
  document.getElementById('look-title').value = '';
  document.getElementById('look-notes').value = '';
  document.getElementById('pieces-container').innerHTML = '';
  document.getElementById('btn-save').disabled = true;
  document.getElementById('modal-overlay').classList.remove('hidden');
  addPieceSlot();
  addPieceSlot();
  document.getElementById('look-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

function addPieceSlot() {
  if (pieceSlotCount >= 3) return;
  pieceSlotCount++;
  const idx = pieceSlotCount;
  const slot = document.createElement('div');
  slot.className = 'piece-slot';
  slot.dataset.slotIndex = idx;
  slot.innerHTML = `
    <div class="piece-slot-header">
      <span class="piece-slot-label">Piece ${idx}</span>
      ${idx > 1 ? `<button class="btn-icon" onclick="removePieceSlot(this)" aria-label="Remove piece">✕</button>` : ''}
    </div>
    <div class="slot-url-row">
      <input type="url" placeholder="Paste product page URL" autocomplete="off">
      <button class="btn-ghost btn-sm" onclick="triggerFetch(this.closest('.piece-slot'))">Fetch</button>
    </div>
    <div class="slot-status" style="display:none"></div>
    <div class="slot-preview" style="display:none">
      <img class="slot-img" src="" alt="">
      <div class="slot-fields">
        <input type="text" placeholder="Name" data-field="name">
        <input type="text" placeholder="Brand" data-field="brand">
        <input type="text" placeholder="Price (e.g. $79)" data-field="price">
      </div>
    </div>
    <div class="slot-fallback" style="display:none">
      <div class="slot-fallback-label">Couldn't fetch image — paste image URL directly:</div>
      <input type="url" placeholder="https://cdn.example.com/image.jpg"
             oninput="onFallbackImageInput(this)">
    </div>
  `;
  const urlInput = slot.querySelector('.slot-url-row input');
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') triggerFetch(slot); });
  slot.querySelectorAll('.slot-fields input, .slot-fallback input').forEach(inp => {
    inp.addEventListener('input', updateSaveButton);
  });
  document.getElementById('pieces-container').appendChild(slot);
  if (pieceSlotCount >= 3) document.getElementById('btn-add-piece').style.display = 'none';
  updateSaveButton();
}

function removePieceSlot(btn) {
  btn.closest('.piece-slot').remove();
  pieceSlotCount--;
  document.getElementById('btn-add-piece').style.display = '';
  updateSaveButton();
}

async function triggerFetch(slot) {
  const urlInput = slot.querySelector('.slot-url-row input');
  const url = urlInput.value.trim();
  if (!url) return;

  const statusEl = slot.querySelector('.slot-status');
  const previewEl = slot.querySelector('.slot-preview');
  const fallbackEl = slot.querySelector('.slot-fallback');
  const fetchBtn = slot.querySelector('.slot-url-row button');

  statusEl.className = 'slot-status';
  statusEl.innerHTML = `<span class="spinner"></span> Fetching…`;
  statusEl.style.display = 'flex';
  previewEl.style.display = 'none';
  fallbackEl.style.display = 'none';
  urlInput.disabled = true;
  fetchBtn.disabled = true;

  try {
    const data = await fetchProductData(url);

    slot.querySelector('img.slot-img').src = data.imageUrl;
    slot.querySelector('[data-field="name"]').value = data.name;
    slot.querySelector('[data-field="brand"]').value = data.brand;
    slot.querySelector('[data-field="price"]').value = data.price;

    if (data.imageUrl) {
      statusEl.style.display = 'none';
      previewEl.style.display = 'flex';
    } else {
      statusEl.className = 'slot-status error';
      statusEl.textContent = "Couldn't find image — paste it below.";
      fallbackEl.style.display = 'block';
    }
  } catch (err) {
    statusEl.className = 'slot-status error';
    statusEl.textContent = "Couldn't fetch — paste image URL directly.";
    statusEl.style.display = 'flex';
    fallbackEl.style.display = 'block';
  } finally {
    urlInput.disabled = false;
    fetchBtn.disabled = false;
    updateSaveButton();
  }
}

function onFallbackImageInput(input) {
  const slot = input.closest('.piece-slot');
  const imgEl = slot.querySelector('img.slot-img');
  const previewEl = slot.querySelector('.slot-preview');
  imgEl.src = input.value.trim();
  previewEl.style.display = input.value.trim() ? 'flex' : 'none';
  updateSaveButton();
}

function updateSaveButton() {
  const title = document.getElementById('look-title').value.trim();
  const slots = [...document.querySelectorAll('.piece-slot')];
  const hasOnePiece = slots.some(slot => {
    const img = slot.querySelector('img.slot-img');
    return img && img.src && img.src !== window.location.href;
  });
  document.getElementById('btn-save').disabled = !(title && hasOnePiece);
}

function saveNewLook() {
  const title = document.getElementById('look-title').value.trim();
  const notes = document.getElementById('look-notes').value.trim();
  const slots = [...document.querySelectorAll('.piece-slot')];

  const pieces = slots.map(slot => {
    const img = slot.querySelector('img.slot-img');
    const imageUrl = img?.src || '';
    const urlInput = slot.querySelector('.slot-url-row input');
    const fallbackUrl = slot.querySelector('.slot-fallback input')?.value.trim() || '';
    return {
      id: uuid(),
      productUrl: urlInput?.value.trim() || '',
      imageUrl: imageUrl !== window.location.href ? imageUrl : fallbackUrl,
      name: slot.querySelector('[data-field="name"]')?.value.trim() || 'Untitled piece',
      brand: slot.querySelector('[data-field="brand"]')?.value.trim() || '',
      price: slot.querySelector('[data-field="price"]')?.value.trim() || '',
    };
  }).filter(p => p.imageUrl);

  if (!title || pieces.length === 0) return;

  const look = { id: uuid(), title, starred: false, notes, pieces, createdAt: Date.now() };
  looks.unshift(look);
  saveLooks(looks);
  closeModal();
  renderGrid();
}
```

- [ ] **Step 2: Verify modal opens — reload, click "+ Add Look"**

Expected: modal opens with 2 piece slots, each with a URL input and Fetch button. "+ Add piece" visible. Save button disabled.

- [ ] **Step 3: Test the fetch flow manually**

In the modal, paste `https://www.uniqlo.com/us/en/products/E462197-000/00` into Piece 1 URL, press Enter or click Fetch. Expected: spinner shows briefly, then product image + name/brand/price populate. Save button still disabled (need title).

- [ ] **Step 4: Commit**

```bash
git add lookbook/app.js
git commit -m "feat: add look modal with CORS proxy image fetching"
```

---

### Task 8: app.js — Preferences drawer

**Files:**
- Modify: `lookbook/app.js` (append)

- [ ] **Step 1: Append drawer logic to `lookbook/app.js`**

```js
// ── Preferences drawer ─────────────────────────────────────────────────────
function openDrawer() {
  document.getElementById('prefs-text').value = loadPrefs();
  document.getElementById('prefs-drawer').classList.remove('hidden');
  document.getElementById('drawer-backdrop').classList.remove('hidden');
  document.getElementById('prefs-text').focus();
}

function closeDrawer() {
  document.getElementById('prefs-drawer').classList.add('hidden');
  document.getElementById('drawer-backdrop').classList.add('hidden');
}
```

- [ ] **Step 2: Verify drawer opens — click "Preferences"**

Expected: drawer slides in from right, textarea is empty (first time), auto-saves on typing. Click backdrop or × closes it.

- [ ] **Step 3: Commit**

```bash
git add lookbook/app.js
git commit -m "feat: preferences drawer with auto-save"
```

---

### Task 9: app.js — card interactions

**Files:**
- Modify: `lookbook/app.js` (append)

- [ ] **Step 1: Append card interaction functions to `lookbook/app.js`**

```js
// ── Card interactions ──────────────────────────────────────────────────────
function toggleStar(id) {
  looks = looks.map(l => l.id === id ? { ...l, starred: !l.starred } : l);
  saveLooks(looks);
  renderGrid();
}

function deleteLook(id) {
  if (!confirm('Delete this look?')) return;
  looks = looks.filter(l => l.id !== id);
  saveLooks(looks);
  renderGrid();
}

function startTitleEdit(id, el) {
  const input = document.createElement('input');
  input.className = 'look-title-input';
  input.value = el.textContent;
  input.onblur = () => saveTitleEdit(id, input);
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { el.style.display = ''; input.remove(); }
  };
  el.style.display = 'none';
  el.parentNode.insertBefore(input, el);
  input.focus();
  input.select();
}

function saveTitleEdit(id, input) {
  const title = input.value.trim();
  if (title) {
    looks = looks.map(l => l.id === id ? { ...l, title } : l);
    saveLooks(looks);
  }
  renderGrid();
}

function saveNotes(id, value) {
  looks = looks.map(l => l.id === id ? { ...l, notes: value } : l);
  saveLooks(looks);
}
```

- [ ] **Step 2: Verify card interactions — add a look (Task 7 must be wired up first via Task 10)**

Skip manual verification here; interactions verified holistically in Task 10.

- [ ] **Step 3: Commit**

```bash
git add lookbook/app.js
git commit -m "feat: card interactions — star, delete, title edit, notes"
```

---

### Task 10: app.js — init and wire up everything

**Files:**
- Modify: `lookbook/app.js` (append)

- [ ] **Step 1: Append init function to `lookbook/app.js`**

```js
// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  looks = loadLooks();

  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGrid();
    });
  });

  // Add Look button + modal controls
  document.getElementById('btn-add').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-save').addEventListener('click', saveNewLook);
  document.getElementById('btn-add-piece').addEventListener('click', addPieceSlot);
  document.getElementById('look-title').addEventListener('input', updateSaveButton);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });

  // Preferences drawer
  document.getElementById('btn-prefs').addEventListener('click', openDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
  document.getElementById('prefs-text').addEventListener('input', e => savePrefs(e.target.value));

  // Close modal on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('modal-overlay').classList.contains('hidden')) closeModal();
      if (!document.getElementById('prefs-drawer').classList.contains('hidden')) closeDrawer();
    }
  });

  renderGrid();
}

init();
```

- [ ] **Step 2: Full end-to-end smoke test**

Open `http://localhost:8080/` and verify:

1. Page loads with empty grid, "No looks yet" message
2. Click "+ Add Look" → modal opens with 2 piece slots
3. Enter a title (e.g. "Linen summer")
4. Paste a real product URL in Piece 1, press Enter → spinner → image + fields populate
5. Click Save → modal closes, card appears in grid with photos, piece rows, and shop link
6. Click ☆ on card → turns ★, click "★ Starred" filter → card still shows, click "All" → card shows
7. Click the look title → editable input appears, change it, blur → title updates
8. Type in the notes textarea → text persists on reload
9. Click 🗑 → confirm dialog → card removed
10. Click "Preferences" → drawer opens, type text, close drawer, reopen → text is still there
11. Reload the page → saved looks and preferences persist

Expected: all 11 checks pass with no console errors.

- [ ] **Step 3: Commit**

```bash
git add lookbook/app.js
git commit -m "feat: init function and full event wiring"
```

---

### Task 11: Delete looks.json and final push

**Files:**
- Delete: `lookbook/looks.json`
- Delete: `lookbook/lookbook/` directory (duplicate subfolder from original)
- Update: `lookbook/.gitignore` (add test.html to gitignore if desired to keep it local)

- [ ] **Step 1: Remove looks.json and the duplicate inner lookbook/ folder**

```bash
git rm lookbook/looks.json
git rm -r lookbook/lookbook/
```

- [ ] **Step 2: Verify the app still loads cleanly**

Reload `http://localhost:8080/` — no errors, no references to looks.json in console.

- [ ] **Step 3: Final commit and push**

```bash
git add -A
git commit -m "feat: remove looks.json and legacy lookbook subfolder"
git push -u origin feature/personal-lookbook
```

- [ ] **Step 4: Confirm GitHub has the branch**

```bash
git log --oneline origin/feature/personal-lookbook
```

Expected: all feature commits visible.

---

## Self-Review

**Spec coverage:**
- ✓ Save looks with product links — Tasks 7, 10
- ✓ Real product photos via URL auto-fetch (CORS proxy) — Task 3, 7
- ✓ Free-form style preferences — Tasks 4, 8, 10
- ✓ No shoes — never mentioned in any task
- ✓ localStorage only — Tasks 2, 6–9
- ✓ 2–3 pieces, simple horizontal photo grid — Tasks 5, 6
- ✓ Star/filter — Tasks 6, 9, 10
- ✓ Delete — Task 9
- ✓ Inline title edit — Task 9
- ✓ Notes per look — Tasks 6, 9
- ✓ Fetch failure fallback (manual image URL) — Task 7

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `loadLooks` / `saveLooks` / `loadPrefs` / `savePrefs` — defined in Task 2, used in Tasks 6–9 ✓
- `fetchProductData(url)` — defined in Task 3, called in Task 7 ✓
- `parseProductPage(html, url)` — defined in Task 3, tested in Task 3 ✓
- Look shape `{ id, title, starred, notes, pieces, createdAt }` — consistent across Tasks 6, 7, 9 ✓
- Piece shape `{ id, productUrl, imageUrl, name, brand, price }` — consistent across Tasks 3, 6, 7 ✓
