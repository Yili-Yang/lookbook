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
  const photoCount = look.pieces?.length || 0;
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
  const slots = [...document.getElementById('pieces-container').querySelectorAll('.piece-slot')];
  const hasOnePiece = slots.some(slot => {
    const img = slot.querySelector('img.slot-img');
    return img && img.src && img.src !== window.location.href;
  });
  document.getElementById('btn-save').disabled = !(title && hasOnePiece);
}

function saveNewLook() {
  const title = document.getElementById('look-title').value.trim();
  const notes = document.getElementById('look-notes').value.trim();
  const slots = [...document.getElementById('pieces-container').querySelectorAll('.piece-slot')];

  const pieces = slots.map(slot => {
    const img = slot.querySelector('img.slot-img');
    const imageUrl = (img?.src && img.src !== window.location.href) ? img.src : '';
    const urlInput = slot.querySelector('.slot-url-row input');
    const productUrl = urlInput?.value.trim() || '';
    // Reject javascript: protocol URLs
    const safeProductUrl = /^https?:\/\//i.test(productUrl) ? productUrl : '';
    const rawFallbackUrl = slot.querySelector('.slot-fallback input')?.value.trim() || '';
    const safeFallbackUrl = /^https?:\/\//i.test(rawFallbackUrl) ? rawFallbackUrl : '';
    return {
      id: uuid(),
      productUrl: safeProductUrl,
      imageUrl: imageUrl || safeFallbackUrl,
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
  input.value = el.textContent;
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

  // Close modal/drawer on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!document.getElementById('modal-overlay').classList.contains('hidden')) closeModal();
      if (!document.getElementById('prefs-drawer').classList.contains('hidden')) closeDrawer();
    }
  });

  renderGrid();
}

init();
