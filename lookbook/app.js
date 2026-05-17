// Lookbook app — loads looks.json, renders cards, persists saves/notes to localStorage.
// Real product photos load from /images. If the image is missing, falls back to a drawn SVG illustration.

const SHAPES = {
  tee: (color, stroke) => `
    <svg viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg" style="width:75%;height:75%">
      <path d="M 10 28 L 22 14 L 42 6 L 78 6 L 98 14 L 110 28 L 104 38 L 96 36 L 96 122 L 24 122 L 24 36 L 16 38 Z"
            fill="${color}" stroke="${stroke}" stroke-width="1"/>
      <path d="M 44 6 Q 60 18 76 6" fill="none" stroke="${stroke}" stroke-width="1"/>
      <line x1="30" y1="60" x2="90" y2="60" stroke="${stroke}" stroke-width="0.4" opacity="0.4"/>
      <line x1="28" y1="90" x2="92" y2="90" stroke="${stroke}" stroke-width="0.4" opacity="0.4"/>
    </svg>`,
  shirt: (color, stroke) => `
    <svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" style="width:75%;height:75%">
      <path d="M 14 10 L 36 4 L 84 4 L 106 10 L 114 26 L 114 134 L 6 134 L 6 26 Z" fill="${color}" stroke="${stroke}" stroke-width="1"/>
      <path d="M 36 4 L 54 18 L 60 12 L 66 18 L 84 4" fill="${color}" stroke="${stroke}" stroke-width="1"/>
      <line x1="60" y1="18" x2="60" y2="130" stroke="${stroke}" stroke-width="0.5" opacity="0.5"/>
      <circle cx="60" cy="38" r="1" fill="${stroke}"/>
      <circle cx="60" cy="62" r="1" fill="${stroke}"/>
      <circle cx="60" cy="86" r="1" fill="${stroke}"/>
      <circle cx="60" cy="110" r="1" fill="${stroke}"/>
    </svg>`,
  polo: (color, stroke) => `
    <svg viewBox="0 0 120 130" xmlns="http://www.w3.org/2000/svg" style="width:75%;height:75%">
      <path d="M 10 28 L 22 14 L 42 8 L 52 18 L 60 12 L 68 18 L 78 8 L 98 14 L 110 28 L 104 38 L 96 36 L 96 122 L 24 122 L 24 36 L 16 38 Z"
            fill="${color}" stroke="${stroke}" stroke-width="1"/>
      <line x1="60" y1="12" x2="60" y2="32" stroke="${stroke}" stroke-width="0.6"/>
      <circle cx="56" cy="18" r="1" fill="${stroke}"/>
      <circle cx="56" cy="26" r="1" fill="${stroke}"/>
    </svg>`,
  overshirt: (color, stroke) => `
    <svg viewBox="0 0 120 140" xmlns="http://www.w3.org/2000/svg" style="width:75%;height:75%">
      <path d="M 8 12 L 30 6 L 50 10 L 60 10 L 70 10 L 90 6 L 112 12 L 118 28 L 118 134 L 2 134 L 2 28 Z" fill="${color}" stroke="${stroke}" stroke-width="1"/>
      <path d="M 30 6 L 50 22 L 60 16 L 70 22 L 90 6" fill="${color}" stroke="${stroke}" stroke-width="1"/>
      <line x1="60" y1="22" x2="60" y2="132" stroke="${stroke}" stroke-width="0.6"/>
      <rect x="14" y="72" width="20" height="24" fill="none" stroke="${stroke}" stroke-width="0.5" opacity="0.5"/>
      <rect x="86" y="72" width="20" height="24" fill="none" stroke="${stroke}" stroke-width="0.5" opacity="0.5"/>
      <circle cx="60" cy="42" r="1" fill="${stroke}"/>
      <circle cx="60" cy="64" r="1" fill="${stroke}"/>
      <circle cx="60" cy="86" r="1" fill="${stroke}"/>
      <circle cx="60" cy="108" r="1" fill="${stroke}"/>
    </svg>`,
  trouser: (color, stroke) => `
    <svg viewBox="0 0 100 180" xmlns="http://www.w3.org/2000/svg" style="width:62%;height:88%">
      <rect x="6" y="2" width="88" height="12" fill="${stroke}" opacity="0.85"/>
      <path d="M 6 14 L 94 14 L 90 174 L 56 174 L 52 80 L 48 80 L 44 174 L 10 174 Z" fill="${color}" stroke="${stroke}" stroke-width="1"/>
      <line x1="22" y1="20" x2="20" y2="80" stroke="${stroke}" stroke-width="0.8" opacity="0.7"/>
      <line x1="32" y1="20" x2="31" y2="80" stroke="${stroke}" stroke-width="0.5" opacity="0.5"/>
      <line x1="68" y1="20" x2="69" y2="80" stroke="${stroke}" stroke-width="0.8" opacity="0.7"/>
      <line x1="78" y1="20" x2="80" y2="80" stroke="${stroke}" stroke-width="0.5" opacity="0.5"/>
      <line x1="50" y1="14" x2="50" y2="80" stroke="${stroke}" stroke-width="0.4" opacity="0.4"/>
    </svg>`,
  short: (color, stroke) => `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:62%;height:80%">
      <rect x="6" y="2" width="88" height="12" fill="${stroke}" opacity="0.85"/>
      <path d="M 6 14 L 94 14 L 88 92 L 56 92 L 52 48 L 48 48 L 44 92 L 12 92 Z" fill="${color}" stroke="${stroke}" stroke-width="1"/>
      <line x1="22" y1="20" x2="20" y2="48" stroke="${stroke}" stroke-width="0.8" opacity="0.7"/>
      <line x1="68" y1="20" x2="69" y2="48" stroke="${stroke}" stroke-width="0.8" opacity="0.7"/>
      <line x1="50" y1="14" x2="50" y2="48" stroke="${stroke}" stroke-width="0.4" opacity="0.4"/>
    </svg>`,
};

// Slightly darken a hex color for stroke
function darken(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substr(0, 2), 16);
  const g = parseInt(h.substr(2, 2), 16);
  const b = parseInt(h.substr(4, 2), 16);
  const factor = 0.7;
  return '#' + [r, g, b].map(c => Math.round(c * factor).toString(16).padStart(2, '0')).join('');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STORAGE_KEY = 'lookbook-v3';

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { saved: [], notes: {} };
}

function saveState(state) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch (e) { console.error('Save failed', e); }
}

let state = loadState();
let currentFilter = 'all';
let looks = [];

function isSaved(id) { return state.saved.includes(id); }

function toggleSave(id) {
  if (isSaved(id)) state.saved = state.saved.filter(s => s !== id);
  else state.saved.push(id);
  saveState(state);
  render();
}

function updateNote(id, value) {
  if (value) state.notes[id] = value;
  else delete state.notes[id];
  saveState(state);
}

function renderPieceThumb(piece) {
  // Try real image; if missing, fall back to SVG.
  // Use onerror to swap to the SVG if the image fails to load.
  const fallbackSvg = SHAPES[piece.shape]
    ? SHAPES[piece.shape](piece.color, darken(piece.color))
    : '';
  return `
    <div class="piece-thumb">
      <img src="${escapeHtml(piece.image)}"
           alt="${escapeHtml(piece.name)}"
           onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
      <div style="display:none;width:100%;height:100%;align-items:center;justify-content:center;">
        ${fallbackSvg}
      </div>
    </div>`;
}

function renderFlatlay(look) {
  return `
    <div class="look-flatlay" style="background: ${look.bg};">
      ${look.pieces.map(p => `
        <div class="flatlay-cell">
          <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.name)}"
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
          <div class="placeholder" style="display:none;">
            ${SHAPES[p.shape] ? SHAPES[p.shape](p.color, darken(p.color)) : ''}
          </div>
        </div>
      `).join('')}
    </div>`;
}

function renderLook(look) {
  const saved = isSaved(look.id);
  const note = state.notes[look.id] || '';
  const piecesHtml = look.pieces.map(p => `
    <div class="piece">
      ${renderPieceThumb(p)}
      <div class="piece-info">
        <div class="piece-name">${escapeHtml(p.name)} <span class="piece-price">${escapeHtml(p.price)}</span></div>
        <div class="piece-meta">${escapeHtml(p.brand)} &middot; ${escapeHtml(p.details)}</div>
        <div class="piece-links">
          ${p.links.map(l => `<a class="piece-link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.label)} &rarr;</a>`).join('')}
        </div>
      </div>
    </div>
  `).join('');

  return `
    <article class="look" data-id="${look.id}" data-tags="${look.tags.join(' ')}">
      ${renderFlatlay(look)}
      <div class="look-body">
        <div class="look-head">
          <div>
            <h2 class="look-title">${escapeHtml(look.title)}</h2>
            <p class="look-vibe">${escapeHtml(look.vibe)}</p>
          </div>
          <button class="save-btn ${saved ? 'saved' : ''}" onclick="window._toggle('${look.id}')" aria-label="Save look">
            ${saved ? '★' : '♡'}
          </button>
        </div>
        <p class="why">${escapeHtml(look.why)}</p>
        <div class="pieces">${piecesHtml}</div>
        <textarea class="notes" placeholder="Add a note about fit, sizing, where you'd wear it..."
                  oninput="window._note('${look.id}', this.value)">${escapeHtml(note)}</textarea>
      </div>
    </article>
  `;
}

function render() {
  const container = document.getElementById('looks-container');
  const visible = looks.filter(l => {
    if (currentFilter === 'all') return true;
    if (currentFilter === 'saved') return isSaved(l.id);
    return l.tags.includes(currentFilter);
  });

  if (visible.length === 0) {
    container.innerHTML = `<p style="grid-column:1/-1;text-align:center;color:var(--ink-soft);padding:48px 0;font-style:italic;font-family:var(--serif);">Nothing saved here yet.</p>`;
  } else {
    container.innerHTML = visible.map(renderLook).join('');
  }

  document.getElementById('saved-count').textContent =
    state.saved.length === 0 ? '0 saved' :
    state.saved.length === 1 ? '1 saved' :
    `${state.saved.length} saved`;
}

function setupFilters() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      render();
    });
  });
}

window._toggle = toggleSave;
window._note = updateNote;

async function init() {
  try {
    const res = await fetch('looks.json');
    const data = await res.json();
    looks = data.looks;
    setupFilters();
    render();
  } catch (e) {
    document.getElementById('looks-container').innerHTML =
      `<p style="grid-column:1/-1;color:#a3290d;padding:24px;">Failed to load looks.json. Make sure you're serving this through a local web server (see README) rather than opening the file directly.</p>`;
    console.error(e);
  }
}

init();
