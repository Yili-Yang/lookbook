# Summer Lookbook

A personal lookbook for outfits in the spirit of Tim Dessaint — minimalist, neutral-toned, considered. Built as a static site you fully own and control.

## Quick start

You need to serve this through a local web server (not just `file://`) because the app fetches `looks.json`.

**Python (easiest, comes pre-installed on Mac/Linux):**
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

**VS Code:**
Install the "Live Server" extension, right-click `index.html` → "Open with Live Server".

## How to add real product photos

The app shows a drawn fallback illustration whenever a real image is missing. To replace any fallback with a real photo:

1. Open the brand's product page (links are in the lookbook itself — click "Shop on Uniqlo" etc.)
2. Right-click the product image → "Save image as..."
3. Save it to the `images/` folder with the filename listed in `looks.json` (e.g. `uniqlo_pleated_beige.jpg`)
4. Refresh the page

That's it. No code changes needed.

## How to edit looks

Edit `looks.json`. Each look has:
- `id`, `title`, `vibe`, `tags` (used for filters)
- `bg` — background color of the flat-lay
- `why` — short styling note shown on the card
- `pieces` — array of pieces (each with `name`, `brand`, `price`, `details`, `color`, `image`, `shape`, and `links`)

`shape` values: `tee`, `shirt`, `polo`, `overshirt`, `trouser`, `short` — these control the fallback SVG.

## How to add a new look

1. Open `looks.json`
2. Copy an existing look object, change the `id` (e.g. `L07`), update the fields
3. Save and refresh

## Saved looks & notes

Saving a look (♡ button) and adding notes both write to your browser's `localStorage` on this device. They persist across page reloads but are tied to this browser, not to the files.

## Deploying online

This is just static HTML/CSS/JS. You can drop it on:
- **GitHub Pages**: push to a repo, enable Pages, done
- **Netlify / Vercel**: drag-and-drop the folder
- **Cloudflare Pages**: same

## File structure
```
lookbook/
├── index.html       — main page
├── style.css        — editorial-style CSS
├── app.js           — render + storage logic
├── looks.json       — your lookbook data (edit this)
├── images/          — product photos (add your own)
└── README.md
```
