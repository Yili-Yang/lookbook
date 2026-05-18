# Lookbook Redesign — Personal Outfit & Style Tool

**Date:** 2026-05-17  
**Status:** Approved

---

## Goal

Turn the existing read-only lookbook (6 hardcoded looks in `looks.json`) into a fully personal, editable tool where the user can:

1. Save outfit looks they find online, composed of real product photos fetched automatically from product URLs
2. Store free-form style preferences and clothing ideas persistently

No shoes — footwear is explicitly out of scope.

---

## Architecture

Single-page static site — HTML + CSS + JS, no build step, no framework, no backend. All state in `localStorage`. Served via any local static server (or the existing one).

**Files changed:**
- `lookbook/index.html` — restructured with modal + drawer markup
- `lookbook/style.css` — extended with modal, drawer, card, and form styles
- `lookbook/app.js` — full rewrite; `looks.json` dependency removed
- `lookbook/looks.json` — deleted (all data lives in localStorage)

---

## Data Model

Stored under two localStorage keys:

### `lookbook-looks` (array of Look objects)
```json
[
  {
    "id": "uuid-v4",
    "title": "Navy linen weekend",
    "createdAt": 1716000000000,
    "starred": false,
    "notes": "Good for warm evenings",
    "pieces": [
      {
        "id": "uuid-v4",
        "productUrl": "https://www.cos.com/...",
        "imageUrl": "https://cdn.cos.com/...",
        "name": "Relaxed-fit linen shirt",
        "brand": "COS",
        "price": "$79"
      }
    ]
  }
]
```

### `lookbook-preferences` (string)
Free-form text. Saved on every keystroke.

---

## UI Structure

### Top bar
- Left: "Lookbook" title (serif, large)
- Right: "Preferences" button + "+ Add Look" button

### Filter bar (below top bar)
- Two pills: **All** | **★ Starred**

### Main grid
- `auto-fill, minmax(420px, 1fr)` — same responsive grid as current
- Each look card (see below)
- Empty state: italic serif message when no looks saved

### Look card
**Top section — photo grid:**
- 2–3 columns of equal width, white background (`#ffffff`)
- Each cell: product image, `object-fit: contain`, 180px height
- Photos load from stored `imageUrl`

**Bottom section — card body:**
- Title: editable inline on click (blurs to save, Escape to cancel)
- Star button (top-right of body)
- Piece list: thumbnail (40×40) + name + brand + price + "Shop →" link per piece
- Notes textarea: auto-saves on input
- Delete button: trash icon, visible on card hover, confirms before deleting

### Add Look modal
Triggered by "+ Add Look". Full-screen overlay, centered content panel (max 560px wide).

**Fields:**
1. Look title (text input, required)
2. Piece slots — starts with 2, "+ Add piece" adds a 3rd (max 3):
   - URL input: "Paste product page URL" + **Fetch** button (also triggers on Enter)
   - While fetching: spinner, URL field disabled
   - On success: photo preview + editable name / brand / price fields populate
   - On failure: error message + "Paste image URL directly" fallback field appears
3. Notes (optional textarea)
4. **Save** button (disabled until title + at least 1 piece with image)
5. **Cancel** / click-outside closes without saving

### Preferences drawer
Triggered by "Preferences" button. Slides in from the right (320px wide), overlays content with a semi-transparent backdrop.

**Contents:**
- Heading: "My Style"
- Single `<textarea>` filling the available height
- Auto-saves to `lookbook-preferences` on every keystroke
- Loads saved text on open
- Close: × button or click backdrop

---

## Image Fetching

**Endpoint:** `https://api.allorigins.win/get?url=<encoded-product-url>`

**Parsing order (first match wins):**
1. `<meta property="og:image" content="...">` 
2. `<meta name="twitter:image" content="...">`
3. First `<img>` with `src` matching `/product|hero|main|pdp/i`

**Auto-populated fields (first match wins):**
- Name: `og:title` → `<title>` text (trimmed)
- Price: `product:price:amount` + `product:price:currency` → `og:price:amount` → regex match on page for `\$[\d,]+`
- Brand: `og:site_name` → domain name (capitalized)

**Failure handling:**
- Network error or proxy timeout (>8s): show "Couldn't fetch — paste image URL directly"
- Proxy returns 200 but no image found: same fallback
- Fallback: user pastes a direct image URL; name/brand/price filled manually

---

## State Management

All reads/writes go through two pure functions:

```js
function loadLooks()        // returns Look[] from localStorage
function saveLooks(looks)   // serializes Look[] to localStorage
function loadPrefs()        // returns string
function savePrefs(text)    // saves string
```

No global mutable state beyond the current in-memory array (re-read from localStorage on init). Every user action calls the appropriate save function immediately.

---

## What's Removed

- `looks.json` and all 6 pre-seeded looks
- SVG fallback shape illustrations (SHAPES object) — real photos only
- `darken()` helper
- Filter tags beyond All / Starred (smart-casual, relaxed, elevated removed)
- Footer instructions about adding images

---

## Out of Scope

- Shoes / footwear — no category, no piece type, no prompt
- Multi-device sync
- Export / import
- Image hosting (images referenced by URL, not stored as data)
- Authentication
