const LOOKS_KEY = 'lookbook-looks';
const PREFS_KEY = 'lookbook-preferences';

function loadLooks() {
  try {
    const raw = localStorage.getItem(LOOKS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveLooks(looks) {
  localStorage.setItem(LOOKS_KEY, JSON.stringify(looks));
}

function loadPrefs() {
  return localStorage.getItem(PREFS_KEY) || '';
}

function savePrefs(text) {
  localStorage.setItem(PREFS_KEY, text);
}
