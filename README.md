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

## Ideas

**Ideas** suggests outfits and can build them for you. It works from two things at once:

- **Your colours.** Every photo you have saved is sampled down to the wardrobe colours it is actually made of — ecru, olive, navy, camel and so on — matched perceptually rather than by raw RGB. The panel shows the tones you lean on and the ones that would go with them but are missing.
- **What style writers are posting.** A rotating handful of independent style blogs and magazines are read, and the garments and cloths they keep coming back to are pulled out.

The two are combined: the writers supply the garment and the fabric, your wardrobe supplies the colour. Each suggestion says where it came from and why that colour.

**Build this look** searches the web for each piece, then opens Add Look already filled in with the product links, photos fetched and ready to pick from. You review it and press Save. Anything the search could not find is left as an open piece with a note, so you can paste a link or photo yourself.

A few honest limitations: the searches sometimes land on a near miss rather than the exact piece, which is why you get the final say before anything is saved. If you have no photos saved yet, the colours are taken from your style note instead — and if that note says "no black", black stays out of the suggestions. Results are cached for half a day; **Read the blogs again** forces a fresh run.

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
├── palette.js        — reads the colours out of your saved photos
├── ideas.js          — reads style blogs and turns them into outfit ideas
├── app.js            — rendering and interaction
└── test.html         — browser test suite
```

## What it talks to

No accounts and no API keys, but the app does reach three public services from your browser:

- **`r.jina.ai`** renders and returns pages, since shops do not allow a browser on another site to read them directly. Used for product pages, style blogs, and search results.
- **`images.weserv.nl`** fetches and resizes product photos so they can be stored with the look.
- **`duckduckgo.com`** answers the product searches behind Ideas.

Nothing about you is sent to them beyond the address being looked up.
