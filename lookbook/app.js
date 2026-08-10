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

function pieceImage(piece) {
  return piece?.imageData || piece?.imageUrl || '';
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
  const pieces = look.pieces || [];
  const photosHtml = pieces.map(p => `
    <div class="photo-cell">
      <img src="${esc(pieceImage(p))}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer"
           onerror="this.style.display='none';this.nextElementSibling.style.display='block'">
      <span class="photo-error" style="display:none">Image unavailable</span>
    </div>
  `).join('');

  const piecesHtml = pieces.map(p => `
    <div class="piece-row">
      <div class="piece-thumb">
        <img src="${esc(pieceImage(p))}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer"
             onerror="this.parentElement.style.background='var(--bg-soft)'">
      </div>
      <div class="piece-info">
        <div class="piece-name">${esc(p.name)}${p.price ? `<span class="piece-price">${esc(p.price)}</span>` : ''}</div>
        <div class="piece-meta">${esc(p.brand)}</div>
        ${p.productUrl ? `<a class="piece-link" href="${esc(p.productUrl)}" target="_blank" rel="noopener">Shop →</a>` : ''}
      </div>
    </div>
  `).join('');

  return `
    <article class="look-card" data-id="${esc(look.id)}">
      <div class="look-photos" style="--photo-count:${pieces.length}">
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

// ── Modal ──────────────────────────────────────────────────────────────────
const MAX_PIECES = 3;
const VISIBLE_THUMBS = 6;
let pieceSlotCount = 0;

function openModal() {
  pieceSlotCount = 0;
  document.getElementById('look-title').value = '';
  document.getElementById('look-notes').value = '';
  document.getElementById('pieces-container').innerHTML = '';
  document.getElementById('btn-save').disabled = true;
  document.getElementById('btn-add-piece').style.display = '';
  document.getElementById('modal-overlay').classList.remove('hidden');
  addPieceSlot();
  addPieceSlot();
  document.getElementById('look-title').focus();
}

function closeModal() {
  document.getElementById('modal-overlay').classList.add('hidden');
}

// Opens Add Look already filled in from an idea, and starts fetching each
// product so the photos are there by the time the user looks at it.
function openModalWithProducts({ title = '', notes = '', urls = [] }) {
  openModal();
  document.getElementById('look-title').value = title;
  document.getElementById('look-notes').value = notes;

  while (slotElements().length < urls.length) addPieceSlot();
  const slots = slotElements();
  urls.forEach((url, index) => {
    if (!slots[index]) return;
    slots[index].querySelector('.slot-url').value = url;
    triggerFetch(slots[index]);
  });
  updateSaveButton();
}

function slotElements() {
  return [...document.getElementById('pieces-container').querySelectorAll('.piece-slot')];
}

function addPieceSlot() {
  if (pieceSlotCount >= MAX_PIECES) return;
  pieceSlotCount++;
  const idx = pieceSlotCount;

  const slot = document.createElement('div');
  slot.className = 'piece-slot';
  slot.slotState = { candidates: [], selectedUrl: '', stored: null, fetchToken: 0, imageToken: 0, expanded: false };
  slot.innerHTML = `
    <div class="piece-slot-header">
      <span class="piece-slot-label">Piece ${idx}</span>
      ${idx > 1 ? `<button class="btn-icon" data-action="remove" aria-label="Remove piece">✕</button>` : ''}
    </div>
    <div class="slot-url-row">
      <input type="url" class="slot-url" placeholder="Paste the product page link" autocomplete="off">
      <button class="btn-ghost btn-sm" data-action="fetch">Get photos</button>
    </div>
    <div class="slot-status hidden"></div>
    <div class="slot-picker hidden">
      <div class="slot-picker-head">
        <span class="slot-picker-title">Pick the photo you want</span>
        <button class="btn-link" data-action="toggle-more" hidden>Show all</button>
      </div>
      <div class="slot-thumbs"></div>
    </div>
    <div class="slot-preview hidden">
      <div class="slot-img-wrap">
        <img class="slot-img" src="" alt="">
        <span class="slot-img-tag"></span>
      </div>
      <div class="slot-fields">
        <input type="text" placeholder="Name" data-field="name">
        <input type="text" placeholder="Brand" data-field="brand">
        <input type="text" placeholder="Price (e.g. $79)" data-field="price">
      </div>
    </div>
    <div class="slot-manual">
      <button class="btn-link" data-action="toggle-manual">Add a photo yourself</button>
      <div class="slot-manual-body hidden">
        <input type="url" class="slot-image-url" placeholder="Paste an image address (ends in .jpg, .png, .webp)" autocomplete="off">
        <label class="file-drop">
          <span><strong>Choose a file</strong>, drop one here, or press ${modifierKeyLabel()}+V to paste a copied image</span>
          <input type="file" accept="image/*" hidden>
        </label>
      </div>
    </div>
  `;

  wireSlot(slot);
  document.getElementById('pieces-container').appendChild(slot);
  if (pieceSlotCount >= MAX_PIECES) document.getElementById('btn-add-piece').style.display = 'none';
  updateSaveButton();
}

function modifierKeyLabel() {
  return /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl';
}

function wireSlot(slot) {
  const urlInput = slot.querySelector('.slot-url');
  urlInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); triggerFetch(slot); }
  });

  slot.addEventListener('click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'fetch') triggerFetch(slot);
    if (action === 'remove') removePieceSlot(slot);
    if (action === 'toggle-manual') toggleManual(slot);
    if (action === 'toggle-more') toggleMoreThumbs(slot);
  });

  slot.querySelectorAll('.slot-fields input').forEach(input => {
    input.addEventListener('input', updateSaveButton);
  });

  const imageUrlInput = slot.querySelector('.slot-image-url');
  imageUrlInput.addEventListener('input', debounce(() => useManualImageUrl(slot, imageUrlInput.value), 500));

  slot.querySelector('.file-drop input[type="file"]').addEventListener('change', e => {
    if (e.target.files?.[0]) useLocalFile(slot, e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach(type => slot.addEventListener(type, e => {
    e.preventDefault();
    slot.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach(type => slot.addEventListener(type, e => {
    if (type === 'dragleave' && slot.contains(e.relatedTarget)) return;
    slot.classList.remove('dragging');
  }));
  slot.addEventListener('drop', e => {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
    if (file) return useLocalFile(slot, file);
    const text = e.dataTransfer?.getData('text/uri-list') || e.dataTransfer?.getData('text/plain');
    if (text) useManualImageUrl(slot, text, { reveal: true });
  });
}

function removePieceSlot(slot) {
  slot.remove();
  pieceSlotCount--;
  document.getElementById('btn-add-piece').style.display = '';
  relabelSlots();
  updateSaveButton();
}

function relabelSlots() {
  slotElements().forEach((slot, index) => {
    slot.querySelector('.piece-slot-label').textContent = `Piece ${index + 1}`;
  });
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ── Slot status ────────────────────────────────────────────────────────────
function setStatus(slot, html, tone = '') {
  const el = slot.querySelector('.slot-status');
  if (!html) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.className = `slot-status ${tone}`.trim();
  el.innerHTML = html;
}

function setBusy(slot, busy) {
  slot.querySelectorAll('[data-action="fetch"], .slot-url').forEach(el => { el.disabled = busy; });
  slot.classList.toggle('busy', busy);
}

// ── Fetching product photos ────────────────────────────────────────────────
async function triggerFetch(slot) {
  const state = slot.slotState;
  const urlInput = slot.querySelector('.slot-url');
  const url = urlInput.value.trim();
  if (!url) {
    setStatus(slot, 'Paste a product page link first.', 'error');
    return;
  }

  const token = ++state.fetchToken;
  setBusy(slot, true);
  setStatus(slot, `<span class="spinner"></span> Opening the page…`, 'busy');
  slot.querySelector('.slot-picker').classList.add('hidden');

  try {
    const data = await fetchProductData(url, {
      onProgress: message => {
        if (state.fetchToken === token) setStatus(slot, `<span class="spinner"></span> ${esc(message)}`, 'busy');
      },
    });
    if (state.fetchToken !== token) return;

    fillField(slot, 'name', data.name);
    fillField(slot, 'brand', data.brand);
    fillField(slot, 'price', data.price);

    setStatus(slot, `<span class="spinner"></span> Checking ${data.images.length} photo${data.images.length === 1 ? '' : 's'}…`, 'busy');
    const verified = await verifyImageCandidates(data.images);
    if (state.fetchToken !== token) return;

    if (!verified.length) {
      setStatus(slot, 'Found the page, but no usable photo on it. Add one yourself below.', 'error');
      openManual(slot);
      return;
    }

    state.candidates = verified;
    state.expanded = false;
    setStatus(slot, '');
    renderThumbs(slot);
    startCapture(slot, verified[0].url);
  } catch (err) {
    if (state.fetchToken !== token) return;
    setStatus(slot, fetchErrorMessage(err), 'error');
    openManual(slot);
  } finally {
    if (state.fetchToken === token) {
      setBusy(slot, false);
      updateSaveButton();
    }
  }
}

function fetchErrorMessage(err) {
  if (err?.message === 'invalid_url') return `That does not look like a web address. Copy the link from your browser's address bar.`;
  if (err?.message === 'no_images_found') return `Read the page but found no photo on it. Add one below instead.`;
  return `Could not read that page — some shops block automated readers. Add a photo below instead.`;
}

function fillField(slot, field, value) {
  const input = slot.querySelector(`[data-field="${field}"]`);
  if (input && !input.value.trim() && value) input.value = value;
}

// ── Photo picker ───────────────────────────────────────────────────────────
function renderThumbs(slot) {
  const picker = slot.querySelector('.slot-picker');
  const grid = slot.querySelector('.slot-thumbs');
  const { candidates, expanded, selectedUrl } = slot.slotState;

  if (!candidates.length) {
    picker.classList.add('hidden');
    return;
  }

  const shown = expanded ? candidates : candidates.slice(0, VISIBLE_THUMBS);
  grid.innerHTML = shown.map(candidate => `
    <button type="button" class="thumb ${candidate.url === selectedUrl ? 'selected' : ''}"
            data-url="${esc(candidate.url)}" title="${esc(candidate.width)}×${esc(candidate.height)}">
      <img src="${esc(candidate.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">
    </button>
  `).join('');

  grid.querySelectorAll('.thumb').forEach(button => {
    button.addEventListener('click', () => startCapture(slot, button.dataset.url));
  });

  const moreBtn = slot.querySelector('[data-action="toggle-more"]');
  moreBtn.hidden = candidates.length <= VISIBLE_THUMBS;
  moreBtn.textContent = expanded ? 'Show fewer' : `Show all ${candidates.length}`;

  slot.querySelector('.slot-picker-title').textContent = candidates.length === 1
    ? 'Found this photo'
    : 'Pick the photo you want';
  picker.classList.remove('hidden');
}

function toggleMoreThumbs(slot) {
  slot.slotState.expanded = !slot.slotState.expanded;
  renderThumbs(slot);
}

// The download runs in the background so the picker stays responsive, but the
// promise is kept so saving can wait for a copy that is still on its way.
function startCapture(slot, url) {
  slot.slotState.pending = selectCandidate(slot, url);
  return slot.slotState.pending;
}

// Shows the chosen photo straight away, then quietly saves a copy so the look
// keeps working if the shop blocks hotlinking or the link later dies.
async function selectCandidate(slot, url) {
  const state = slot.slotState;
  const token = ++state.imageToken;
  state.selectedUrl = url;
  state.stored = null;

  showPreview(slot, url, 'Saving a copy…');
  renderThumbs(slot);
  updateSaveButton();

  const stored = await captureImage(url);
  if (state.imageToken !== token) return;

  if (stored) {
    state.stored = stored;
    showPreview(slot, stored.dataUrl, `Saved copy · ${formatBytes(approximateBytes(stored.dataUrl))}`);
  } else {
    showPreview(slot, url, 'Linked from the shop');
  }
  updateSaveButton();
}

function showPreview(slot, src, tag) {
  const preview = slot.querySelector('.slot-preview');
  slot.querySelector('.slot-img').src = src;
  slot.querySelector('.slot-img-tag').textContent = tag;
  preview.classList.remove('hidden');
}

// ── Manual photo entry ─────────────────────────────────────────────────────
function toggleManual(slot) {
  slot.querySelector('.slot-manual-body').classList.toggle('hidden');
}

function openManual(slot) {
  slot.querySelector('.slot-manual-body').classList.remove('hidden');
}

async function useManualImageUrl(slot, value, { reveal = false } = {}) {
  const url = String(value || '').trim();
  // Ignore half-typed addresses so the field does not scold on every keystroke.
  if (!/^https?:\/\/[^\s.]+\.[^\s]{2,}$/i.test(url)) return;

  if (reveal) {
    openManual(slot);
    slot.querySelector('.slot-image-url').value = url;
  }

  const state = slot.slotState;
  const token = ++state.imageToken;
  setStatus(slot, `<span class="spinner"></span> Loading that image…`, 'busy');

  const probe = await probeImage(url);
  if (state.imageToken !== token) return;
  if (!probe.ok) {
    setStatus(slot, 'That image would not load. On the shop\'s page, right-click the photo and choose "Copy image address".', 'error');
    return;
  }

  setStatus(slot, '');
  state.candidates = [];
  renderThumbs(slot);
  startCapture(slot, url);
}

function useLocalFile(slot, file) {
  slot.slotState.pending = storeLocalFile(slot, file);
  return slot.slotState.pending;
}

async function storeLocalFile(slot, file) {
  const state = slot.slotState;
  const token = ++state.imageToken;
  setStatus(slot, `<span class="spinner"></span> Adding your photo…`, 'busy');
  try {
    const stored = await captureLocalFile(file);
    if (state.imageToken !== token) return;
    state.candidates = [];
    state.selectedUrl = '';
    state.stored = stored;
    renderThumbs(slot);
    showPreview(slot, stored.dataUrl, `From your device · ${formatBytes(approximateBytes(stored.dataUrl))}`);
    setStatus(slot, '');
  } catch {
    if (state.imageToken === token) setStatus(slot, 'That file is not an image the browser can read.', 'error');
  } finally {
    updateSaveButton();
  }
}

// A copied product image can be pasted straight into the modal, which works
// even on shops that block every reader.
function handleModalPaste(event) {
  if (document.getElementById('modal-overlay').classList.contains('hidden')) return;
  const file = imageFromClipboard(event);
  if (!file) return;
  const slot = targetSlotForPaste();
  if (!slot) return;
  event.preventDefault();
  openManual(slot);
  useLocalFile(slot, file);
}

function targetSlotForPaste() {
  const slots = slotElements();
  if (!slots.length) return null;
  const focused = document.activeElement?.closest?.('.piece-slot');
  return focused || slots.find(slot => !slotHasImage(slot)) || slots[0];
}

// ── Saving ─────────────────────────────────────────────────────────────────
function slotHasImage(slot) {
  return Boolean(slot.slotState?.stored || slot.slotState?.selectedUrl);
}

function updateSaveButton() {
  const title = document.getElementById('look-title').value.trim();
  document.getElementById('btn-save').disabled = !(title && slotElements().some(slotHasImage));
}

// Saving a moment after picking a photo used to store only the shop's link,
// because the copy was still downloading. Give it a moment to land first.
async function waitForPendingCaptures() {
  const pending = slotElements().map(slot => slot.slotState?.pending).filter(Boolean);
  if (!pending.length) return;

  const button = document.getElementById('btn-save');
  const label = button.textContent;
  button.disabled = true;
  button.textContent = 'Saving photos…';
  try {
    await Promise.race([
      Promise.allSettled(pending),
      new Promise(resolve => setTimeout(resolve, CAPTURE_WAIT_MS)),
    ]);
  } finally {
    button.textContent = label;
    button.disabled = false;
  }
}

function collectPieces() {
  return slotElements().filter(slotHasImage).map(slot => {
    const productUrl = slot.querySelector('.slot-url').value.trim();
    return {
      id: uuid(),
      productUrl: /^https?:\/\//i.test(productUrl) ? productUrl : '',
      imageUrl: slot.slotState.selectedUrl || '',
      imageData: slot.slotState.stored?.dataUrl || '',
      name: slot.querySelector('[data-field="name"]').value.trim() || 'Untitled piece',
      brand: slot.querySelector('[data-field="brand"]').value.trim() || '',
      price: slot.querySelector('[data-field="price"]').value.trim() || '',
    };
  });
}

// Comfortably longer than image.js allows a download to take, so the wait ends
// because the copy arrived or definitively failed, not because it timed out.
const CAPTURE_WAIT_MS = 26000;

async function saveNewLook() {
  await waitForPendingCaptures();
  if (document.getElementById('modal-overlay').classList.contains('hidden')) return;

  const title = document.getElementById('look-title').value.trim();
  const notes = document.getElementById('look-notes').value.trim();
  const pieces = collectPieces();
  if (!title || pieces.length === 0) return;

  const look = { id: uuid(), title, starred: false, notes, pieces, createdAt: Date.now() };
  const next = [look, ...looks];

  if (saveLooks(next)) {
    looks = next;
    closeModal();
    renderGrid();
    return;
  }

  // Out of storage: keep the look by dropping the saved photo copies, which are
  // by far the largest part of it, and fall back to the shop's own links.
  const lighter = { ...look, pieces: pieces.map(p => ({ ...p, imageData: p.imageUrl ? '' : p.imageData })) };
  const retry = [lighter, ...looks];
  if (saveLooks(retry)) {
    looks = retry;
    closeModal();
    renderGrid();
    alert('Storage is nearly full, so this look links to the shop\'s photos instead of keeping its own copies. Delete an old look to free space.');
    return;
  }

  alert('There is no room left in this browser\'s storage. Delete a look or two and try again.');
}

// ── Ideas ──────────────────────────────────────────────────────────────────
let currentOutfits = [];

function openIdeas() {
  document.getElementById('ideas-overlay').classList.remove('hidden');
  renderPaletteStrip();
  if (currentOutfits.length) return;

  const cached = readIdeasCache();
  if (cached) {
    showOutfits(cached);
  } else {
    setIdeasStatus('');
    document.getElementById('ideas-list').innerHTML = `
      <p class="ideas-intro">Reads what a handful of independent style writers are posting right now,
      then suggests outfits in the colours your lookbook already lives in.</p>`;
  }
}

function closeIdeas() {
  document.getElementById('ideas-overlay').classList.add('hidden');
}

function setIdeasStatus(html, tone = '') {
  const el = document.getElementById('ideas-status');
  if (!html) {
    el.classList.add('hidden');
    el.innerHTML = '';
    return;
  }
  el.className = `slot-status ${tone}`.trim();
  el.innerHTML = html;
}

async function renderPaletteStrip() {
  const el = document.getElementById('ideas-palette');
  el.innerHTML = `<span class="palette-note">Reading the colours in your photos…</span>`;

  const palette = await currentPalette();
  if (!palette.length) {
    el.innerHTML = `<span class="palette-note">No photos to read yet — working from a neutral base of
      ${DEFAULT_PALETTE.join(', ')}. Save a look or two and this follows your own colours.</span>`;
    return;
  }

  const accents = suggestedAccents(palette.map(entry => entry.name));
  el.innerHTML = palette.map(entry => `
    <span class="swatch" title="${Math.round(entry.share * 100)}% of your saved photos">
      <span class="swatch-dot" style="background:${esc(rgbCss(entry.rgb))}"></span>${esc(entry.name)}
    </span>
  `).join('') + (accents.length ? `
    <span class="palette-note">Missing, and would work: ${accents.map(name => `
      <span class="swatch swatch-ghost"><span class="swatch-dot" style="background:${esc(colorHex(name))}"></span>${esc(name)}</span>
    `).join('')}</span>` : '');
}

function rgbCss([r, g, b]) {
  return `rgb(${r}, ${g}, ${b})`;
}

// The palette is derived from the saved photos, and falls back to the colours
// named in the style note when there are no photos to read.
async function currentPalette() {
  const fromPhotos = await paletteFromLooks(looks);
  if (fromPhotos.length) return fromPhotos;
  return paletteFromText(loadPrefs());
}

async function findIdeas({ refresh = false } = {}) {
  const findButton = document.getElementById('btn-ideas-find');
  findButton.disabled = true;
  if (refresh) {
    clearIdeasCache();
    currentOutfits = [];
  }

  try {
    setIdeasStatus(`<span class="spinner"></span> Reading style blogs…`, 'busy');
    const gathered = await gatherStyleIdeas({
      onProgress: message => setIdeasStatus(`<span class="spinner"></span> ${esc(message)}`, 'busy'),
    });
    await showOutfits(gathered);
  } catch (err) {
    setIdeasStatus(err?.message === 'no_sources_read'
      ? 'None of the style blogs would load just now. Try again in a minute.'
      : 'Could not put ideas together just now. Try again in a minute.', 'error');
  } finally {
    findButton.disabled = false;
    findButton.textContent = 'Find more ideas';
  }
}

async function showOutfits(gathered) {
  const palette = await currentPalette();
  const paletteNames = palette.length ? palette.map(entry => entry.name) : DEFAULT_PALETTE;

  currentOutfits = buildOutfitIdeas({
    ideas: gathered.ideas,
    sources: gathered.sources,
    palette: paletteNames,
    accents: suggestedAccents(paletteNames),
    preferences: loadPrefs(),
  });

  setIdeasStatus('');
  renderOutfits(gathered);
}

function renderOutfits(gathered) {
  const list = document.getElementById('ideas-list');
  if (!currentOutfits.length) {
    list.innerHTML = `<p class="ideas-intro">The blogs read today did not mention enough to build an outfit from.
      Try reading them again.</p>`;
    return;
  }

  const readAt = new Date(gathered.readAt);
  list.innerHTML = `
    <p class="ideas-meta">From ${gathered.sources.map(source => `<a href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.name)}</a>`).join(', ')}
      · read ${esc(readAt.toLocaleString())}</p>
    ${currentOutfits.map(renderOutfitCard).join('')}`;

  list.querySelectorAll('[data-build]').forEach(button => {
    button.addEventListener('click', () => buildLookFromIdea(button.dataset.build));
  });
}

function renderOutfitCard(outfit) {
  return `
    <article class="idea-card" data-id="${esc(outfit.id)}">
      <div class="idea-swatches">
        ${outfit.colours.map(name => `<span class="swatch-dot lg" style="background:${esc(colorHex(name))}" title="${esc(name)}"></span>`).join('')}
      </div>
      <div class="idea-body">
        <h3 class="idea-title">${esc(outfit.title)}</h3>
        <p class="idea-why">${esc(outfit.why)}</p>
        <p class="idea-pieces">${outfit.pieces.map(piece => `<span class="idea-piece">${esc(piece.label)}</span>`).join('')}</p>
        <div class="idea-actions">
          <button class="btn-primary btn-sm" data-build="${esc(outfit.id)}">Build this look</button>
          <span class="idea-progress"></span>
        </div>
      </div>
    </article>`;
}

// Searches the web for each piece, then hands the product links to the normal
// Add Look flow so the photos are picked and checked the same way as always.
async function buildLookFromIdea(id) {
  const outfit = currentOutfits.find(entry => entry.id === id);
  if (!outfit) return;

  const card = document.querySelector(`.idea-card[data-id="${CSS.escape(id)}"]`);
  const progress = card.querySelector('.idea-progress');
  const button = card.querySelector('[data-build]');
  button.disabled = true;

  const found = [];
  for (const piece of outfit.pieces) {
    progress.innerHTML = `<span class="spinner"></span> Looking for ${esc(piece.label)}…`;
    try {
      const url = await searchProductUrl(piece.label);
      if (url) {
        found.push(url);
        progress.textContent = `Found ${new URL(url).hostname.replace(/^www\./, '')}`;
      }
    } catch {
      // A piece that cannot be found is left for the user to fill in.
    }
  }

  button.disabled = false;
  if (!found.length) {
    progress.textContent = 'Could not find these online — open Add Look and paste a link yourself.';
    return;
  }

  progress.textContent = '';
  closeIdeas();
  openModalWithProducts({
    title: outfit.title,
    notes: `${outfit.why}\n\nSuggested by ${outfit.sources.join(', ')}.`,
    urls: found,
  });
}

// ── Preferences drawer ─────────────────────────────────────────────────────
function openDrawer() {
  document.getElementById('prefs-text').value = loadPrefs();
  document.getElementById('prefs-drawer').classList.remove('hidden');
  document.getElementById('drawer-backdrop').classList.remove('hidden');
  updateStorageMeter();
  document.getElementById('prefs-text').focus();
}

function closeDrawer() {
  document.getElementById('prefs-drawer').classList.add('hidden');
  document.getElementById('drawer-backdrop').classList.add('hidden');
}

// Browsers cap localStorage near 5 MB, and saved photos are what fill it, so
// the number is worth showing before a save starts failing.
const STORAGE_WARN_BYTES = 3.5 * 1024 * 1024;

function updateStorageMeter() {
  const el = document.getElementById('storage-meter');
  if (!el) return;
  const photos = looks.reduce((total, look) => total + (look.pieces || []).filter(p => p.imageData).length, 0);
  const used = storageUsage();
  const summary = `${looks.length} look${looks.length === 1 ? '' : 's'} · ${photos} saved photo${photos === 1 ? '' : 's'} · ${formatBytes(used)} used`;
  el.textContent = used > STORAGE_WARN_BYTES
    ? `${summary} — running low, delete a look to free space`
    : summary;
  el.classList.toggle('warning', used > STORAGE_WARN_BYTES);
}

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
  let cancelled = false;
  const input = document.createElement('input');
  input.className = 'look-title-input';
  input.value = el.textContent.trim();
  input.onblur = () => { if (!cancelled) saveTitleEdit(id, input); };
  input.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { cancelled = true; el.style.display = ''; input.remove(); }
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

// ── Init ───────────────────────────────────────────────────────────────────
function init() {
  looks = loadLooks();

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderGrid();
    });
  });

  document.getElementById('btn-add').addEventListener('click', openModal);
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-save').addEventListener('click', saveNewLook);
  document.getElementById('btn-add-piece').addEventListener('click', addPieceSlot);
  document.getElementById('look-title').addEventListener('input', updateSaveButton);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
  });
  document.addEventListener('paste', handleModalPaste);

  document.getElementById('btn-ideas').addEventListener('click', openIdeas);
  document.getElementById('ideas-close').addEventListener('click', closeIdeas);
  document.getElementById('btn-ideas-find').addEventListener('click', () => findIdeas());
  document.getElementById('btn-ideas-refresh').addEventListener('click', () => findIdeas({ refresh: true }));
  document.getElementById('ideas-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('ideas-overlay')) closeIdeas();
  });

  document.getElementById('btn-prefs').addEventListener('click', openDrawer);
  document.getElementById('drawer-close').addEventListener('click', closeDrawer);
  document.getElementById('drawer-backdrop').addEventListener('click', closeDrawer);
  document.getElementById('prefs-text').addEventListener('input', e => savePrefs(e.target.value));

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('modal-overlay').classList.contains('hidden')) closeModal();
      if (!document.getElementById('ideas-overlay').classList.contains('hidden')) closeIdeas();
      if (!document.getElementById('prefs-drawer').classList.contains('hidden')) closeDrawer();
    }
  });

  renderGrid();
}

init();
