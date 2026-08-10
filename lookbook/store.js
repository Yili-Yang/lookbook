const LOOKS_KEY = 'lookbook-looks';
const PREFS_KEY = 'lookbook-preferences';

function loadLooks() {
  try {
    const raw = localStorage.getItem(LOOKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { console.error('[store] loadLooks parse error:', e); return []; }
}

// Returns false when the browser refused the write — normally the ~5 MB
// localStorage quota, which stored photos can reach. Callers decide whether to
// retry with lighter data rather than silently losing the look.
function saveLooks(looks) {
  try {
    localStorage.setItem(LOOKS_KEY, JSON.stringify(looks));
    return true;
  } catch (e) {
    console.error('[store] saveLooks failed:', e);
    return false;
  }
}

function loadPrefs() {
  return localStorage.getItem(PREFS_KEY) || '';
}

function savePrefs(text) {
  try {
    localStorage.setItem(PREFS_KEY, text);
    return true;
  } catch (e) {
    console.error('[store] savePrefs failed:', e);
    return false;
  }
}

function storageUsage() {
  let bytes = 0;
  try {
    for (const key of [LOOKS_KEY, PREFS_KEY]) {
      bytes += (localStorage.getItem(key) || '').length * 2;
    }
  } catch { /* storage unavailable */ }
  return bytes;
}
