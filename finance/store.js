/* store.js — persistence.
 *
 * Everything lives in this browser's localStorage and nothing is ever sent
 * anywhere: there is no server, no analytics, and no network call in this app.
 * That is also the limitation — clearing site data clears your plan, so the
 * export button exists and is worth using.
 */

const PLAN_KEY = 'finance-plan';
const SCENARIO_KEY = 'finance-scenarios';

// Saved plans are merged into the current defaults rather than used as-is, so
// that a plan saved before a field existed still opens, with the new field at
// its default rather than undefined.
function mergeWithDefaults(saved) {
  const base = defaultConfig();
  if (!saved || typeof saved !== 'object') return base;
  const cfg = {
    schemaVersion: base.schemaVersion,
    name: typeof saved.name === 'string' ? saved.name : base.name,
    values: Object.assign({}, base.values),
    meta: Object.assign({}, base.meta),
    incomes: Array.isArray(saved.incomes) ? saved.incomes : base.incomes,
    goals: Array.isArray(saved.goals) ? saved.goals : base.goals,
    research: saved.research && typeof saved.research === 'object' ? saved.research : {},
    notes: typeof saved.notes === 'string' ? saved.notes : '',
    todos: Array.isArray(saved.todos) ? saved.todos : [],
  };
  for (const key of Object.keys(base.values)) {
    if (saved.values && saved.values[key] != null) cfg.values[key] = saved.values[key];
    const savedMeta = saved.meta && saved.meta[key];
    cfg.meta[key] = {
      verified: savedMeta ? !!savedMeta.verified : base.meta[key].verified,
      source: savedMeta && typeof savedMeta.source === 'string' ? savedMeta.source : '',
    };
  }
  return cfg;
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(PLAN_KEY);
    return mergeWithDefaults(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.error('[store] could not read the saved plan:', err);
    return defaultConfig();
  }
}

function saveConfig(cfg) {
  try {
    localStorage.setItem(PLAN_KEY, JSON.stringify(cfg));
    return true;
  } catch (err) {
    console.error('[store] could not save the plan:', err);
    return false;
  }
}

function clearConfig() {
  try { localStorage.removeItem(PLAN_KEY); } catch { /* nothing to do */ }
}

// ── Scenarios ───────────────────────────────────────────────────────────────
// A scenario is a frozen copy of the whole config plus the headline numbers it
// produced, so that comparing "retire at 62" against "retire at 65" is a matter
// of saving one and then editing the other.
function loadScenarios() {
  try {
    const raw = localStorage.getItem(SCENARIO_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (err) {
    console.error('[store] could not read scenarios:', err);
    return [];
  }
}

function saveScenarios(list) {
  try {
    localStorage.setItem(SCENARIO_KEY, JSON.stringify(list));
    return true;
  } catch (err) {
    console.error('[store] could not save scenarios:', err);
    return false;
  }
}

function newId(prefix) {
  const rand = crypto.randomUUID ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${rand}`;
}

// ── Files in and out ────────────────────────────────────────────────────────
function downloadFile(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPlan(cfg) {
  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (cfg.name || 'plan').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  downloadFile(`finance-${safeName}-${stamp}.json`, JSON.stringify(cfg, null, 2));
}

function ledgerToCsv(rows, columns) {
  const header = columns.map(c => c.label).join(',');
  const lines = rows.map(row => columns.map(c => {
    const v = c.get(row);
    return typeof v === 'number' ? Math.round(v * 100) / 100 : `"${String(v).replace(/"/g, '""')}"`;
  }).join(','));
  return [header].concat(lines).join('\n');
}
