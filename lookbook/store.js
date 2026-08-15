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

const SOURCES_KEY = 'lookbook-sources';

// Which style sources to read, and any the user added themselves. Taste is
// personal enough that the built-in list is only a starting point.
function loadSourceSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SOURCES_KEY) || '{}');
    return {
      disabled: Array.isArray(saved.disabled) ? saved.disabled : [],
      custom: Array.isArray(saved.custom) ? saved.custom : [],
    };
  } catch (e) {
    console.error('[store] loadSourceSettings parse error:', e);
    return { disabled: [], custom: [] };
  }
}

function saveSourceSettings(settings) {
  try {
    localStorage.setItem(SOURCES_KEY, JSON.stringify(settings));
    return true;
  } catch (e) {
    console.error('[store] saveSourceSettings failed:', e);
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
