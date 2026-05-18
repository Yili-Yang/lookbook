const LOOKS_KEY = 'lookbook-looks';
const PREFS_KEY = 'lookbook-preferences';

function loadLooks() {
  try {
    const raw = localStorage.getItem(LOOKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { console.error('[store] loadLooks parse error:', e); return []; }
}

function saveLooks(looks) {
  try {
    localStorage.setItem(LOOKS_KEY, JSON.stringify(looks));
  } catch { /* quota exceeded or private browsing — data not persisted */ }
}

function loadPrefs() {
  return localStorage.getItem(PREFS_KEY) || '';
}

function savePrefs(text) {
  try {
    localStorage.setItem(PREFS_KEY, text);
  } catch { /* quota exceeded or private browsing — data not persisted */ }
}
