# AGENTS.md

## Cursor Cloud specific instructions

This repo is a single, fully static front-end web app (the **Lookbook**) in `lookbook/`. It is plain HTML/CSS/vanilla JS with **no package manager, no build step, no bundler, and no backend**. Data persists in the browser's `localStorage` only.

### Services

| Service | Run command | Notes |
|---|---|---|
| Lookbook (static site) | `cd lookbook && python3 -m http.server 8000` then open `http://localhost:8000` | Must be served over HTTP, not `file://`. `python3` is the simplest option; `npx serve` also works. |

### Run / test / build / lint

- **Run (dev):** `cd lookbook && python3 -m http.server 8000` (see README). There is no separate "production build" — the files are served as-is.
- **Test:** Open `http://localhost:8000/test.html` in a browser. It is a self-running JS assertion harness for `store.js` + `fetch.js` and prints a `N passed, M failed` summary inline. There is no headless/CLI test runner.
- **Build:** None. Nothing to compile or bundle.
- **Lint:** None configured (no ESLint/Prettier/linter config in the repo).

### Non-obvious caveats

- The "Fetch product by URL" feature in the Add Look modal calls an external CORS proxy (`api.allorigins.win`) and Google Fonts loads from a CDN; both require internet and are purely optional. The app degrades gracefully offline — you can still add a look by clicking **Fetch** (which reveals a "paste image URL directly" fallback input) and pasting an image URL (an `http(s)://` URL or a `data:` URL both work).
- The **Save Look** button stays disabled until there is both a title and at least one piece with a loaded image.
- The root `index.html` (repo root, not `lookbook/`) is legacy/orphaned — it references `style.css`/`app.js` at the repo root which don't exist. The maintained product lives entirely in `lookbook/`.
- The `lookbook/README.md` still mentions a `looks.json` data file, but that file was removed; the current app seeds nothing and stores all looks in `localStorage`.
