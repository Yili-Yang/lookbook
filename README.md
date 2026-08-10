# Lookbook

A personal lookbook: paste a link to a product page, pick the photo you want, and keep the outfit. Minimalist, neutral-toned, and entirely yours — a static site with no accounts, no server, and no build step.

## Quick start

Serve the `lookbook/` folder through a local web server rather than opening the file directly, because browsers block the network requests the app needs on `file://` pages.

**Python (pre-installed on Mac and Linux):**
```bash
cd lookbook
python3 -m http.server 8000
```
Then open http://localhost:8000

**Node:**
```bash
cd lookbook
npx serve
```

**VS Code:** install the "Live Server" extension, then right-click `index.html` → "Open with Live Server".

## Getting product pictures

Click **+ Add Look**, paste a product page link into a piece, and press **Get photos**. The app reads the page, shows every photo it found on it, and you click the one you want. The name, brand, and price are filled in from the page and stay editable.

Whichever photo you pick is downloaded, shrunk, and stored inside your lookbook. That matters because a lot of shops refuse to display their images on another site, and product links break the moment something sells out — the saved copy keeps your look intact either way.

### When a shop cannot be read

Some retailers (Zara and Uniqlo's checkout-heavy pages among them) block automated readers outright, and the app will say so. Every piece has a manual path that always works:

- **Paste the image** — right-click the photo on the shop's page, choose "Copy image", and press Ctrl+V (⌘+V on a Mac) anywhere in the Add Look window.
- **Paste an image address** — right-click the photo, choose "Copy image address", and paste it under "Add a photo yourself".
- **Upload or drag a file** — drop any image straight onto the piece.

### How a photo is chosen

Shops very often advertise their own logo as the page's preview image, so the app does not trust that alone. It gathers candidates from page metadata, structured product data, `srcset` and lazy-loading attributes, and the raw page source, then ranks them by where they came from, how large they are, and whether they mention the product named in the page title or URL. Logos, icons, swatches, and promo banners are filtered out. You still get the final say in the picker.

## Everything else

- **Star** a look to keep it in the ★ Starred filter.
- **Click a title** to rename it; **🗑** deletes it.
- The **notes** box on each card saves as you type.
- **Preferences** is a free-form note about your style — fits, colours, brands to avoid — plus a readout of how much browser storage your looks use.

## Where your data lives

Everything is stored in this browser's `localStorage` on this device: looks, notes, preferences, and the saved photo copies. Nothing is uploaded anywhere. That storage is capped at roughly 5 MB, which is a few hundred photos; if it fills up, the app keeps the look and falls back to linking the shop's own image rather than losing it.

Because the data is per-browser, opening the site on another device or in a private window shows an empty lookbook.

## Running the tests

```bash
bash run-tests.sh
```

This serves the app and runs `lookbook/test.html` in headless Chrome, covering page parsing, image ranking, and storage. You can also just open `http://localhost:8000/test.html` in any browser.

## Deploying online

It is plain HTML, CSS, and JavaScript, so it works anywhere static files are served — GitHub Pages, Netlify, Vercel, or Cloudflare Pages. The root `index.html` redirects to `lookbook/`.

## File structure

```
index.html            — redirect to lookbook/
run-tests.sh          — headless test runner
lookbook/
├── index.html        — the app
├── style.css         — editorial-style CSS
├── store.js          — localStorage read/write
├── fetch.js          — reads product pages and ranks their images
├── image.js          — downloads, shrinks, and stores photos
├── app.js            — rendering and interaction
└── test.html         — browser test suite
```
