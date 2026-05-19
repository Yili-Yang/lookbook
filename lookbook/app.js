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
