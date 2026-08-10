/* app.js — state, rendering, and event wiring.
 *
 * One config object is the truth. Every render function reads from it and never
 * mutates it; every handler writes to it and then asks for a recompute. There
 * is no framework and no build step, so that split is the only thing keeping
 * this manageable — break it and the app starts disagreeing with itself.
 *
 * Nothing here decides what a number means. Labels, help text, defaults and
 * which fields are personal all come from config.js; the arithmetic all comes
 * from model.js. This file is presentation and plumbing.
 */

const state = {
  cfg: null,
  scenarios: [],
  det: null,
  mc: null,
  tab: 'overview',
  ledgerReal: true,
  fanIncludeHouse: true,
  // The lever values as they stood when the page loaded or the levers were last
  // put back, so each slider can report what moving it actually bought.
  leverBase: {},
};

// ── Levers ──────────────────────────────────────────────────────────────────
// The handful of inputs worth dragging rather than typing. Slider bounds are UI
// bounds, not assumptions: they are derived from the current value so a plan
// with unusual numbers still gets a usable range instead of a pinned slider.
const LEVERS = [
  {
    key: 'retireAge', label: 'Retire at',
    range: v => ({ min: Math.max(30, Math.min(v.startAge, 50)), max: Math.max(75, v.retireAge + 5), step: 1 }),
    fmt: x => `age ${Math.round(x)}`,
  },
  {
    key: 'retireSpend', label: 'Retirement spending',
    range: v => ({ min: 0, max: roundUpTo(Math.max(200000, v.retireSpend * 2), 10000), step: 1000 }),
    fmt: fmtMoney,
  },
  {
    key: 'contribTaxableRecurring', label: 'Saved after tax each year',
    range: v => ({ min: 0, max: roundUpTo(Math.max(50000, v.contribTaxableRecurring * 2), 5000), step: 500 }),
    fmt: fmtMoney,
  },
  {
    key: 'contribPretax', label: 'Saved pre-tax each year',
    range: v => ({ min: 0, max: roundUpTo(Math.max(50000, v.contribPretax * 2), 5000), step: 500 }),
    fmt: fmtMoney,
  },
  {
    key: 'equityReturn', label: 'Expected equity return',
    range: () => ({ min: 0, max: 0.12, step: 0.0025 }),
    fmt: x => fmtPct(x, 2),
  },
  {
    key: 'equityPctPre', label: 'Equity allocation while working',
    range: () => ({ min: 0, max: 1, step: 0.05 }),
    fmt: x => fmtPct(x, 0),
  },
  {
    key: 'ssStartAge', label: 'Claim Social Security at',
    range: () => ({ min: 62, max: 70, step: 1 }),
    fmt: x => `age ${Math.round(x)}`,
  },
];

function roundUpTo(x, step) { return Math.ceil(x / step) * step; }

// ── Boot ────────────────────────────────────────────────────────────────────
function init() {
  state.cfg = loadConfig();
  state.scenarios = loadScenarios();
  state.leverBase = leverSnapshot();

  wireChrome();
  wireInputs();
  renderStructural();
  update();
}

// Recompute, redraw everything that is derived, and save. Called after any
// change to the config, debounced by the callers that fire rapidly.
function update() {
  const started = performance.now();
  state.det = runDeterministic(state.cfg);
  state.mc = runMonteCarlo(state.cfg, state.det);
  state.lastRunMs = performance.now() - started;
  renderDerived();
  persistSoon();
}

const persistSoon = debounce(() => saveConfig(state.cfg), 400);
const updateSoon = debounce(update, 160);

function debounce(fn, ms) {
  let handle = null;
  return function debounced(...args) {
    clearTimeout(handle);
    handle = setTimeout(() => fn.apply(null, args), ms);
  };
}

// Whether the user is part-way through typing inside this container. Redrawing
// it now would take the caret with it, so the redraw waits. Only free text
// counts: a focused button or checkbox has just been clicked, and skipping the
// redraw then would leave the click looking like it did nothing.
const NON_TYPING_INPUTS = new Set(['checkbox', 'radio', 'range', 'button', 'submit', 'file']);

function isTypingIn(container) {
  const el = document.activeElement;
  if (!el || !container.contains(el)) return false;
  if (el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !NON_TYPING_INPUTS.has(el.type);
}

// Structural render: the parts made of form controls, rebuilt only when the
// shape of the plan changes. Rebuilding these on every keystroke would take the
// caret out of whatever the user was typing into.
function renderStructural() {
  document.getElementById('plan-name').value = state.cfg.name || '';
  document.getElementById('notes').value = state.cfg.notes || '';
  renderFieldGroups();
  renderIncomes();
  renderGoals();
  renderResearch();
}

function renderDerived() {
  renderBanner();
  renderTabCounts();
  renderWarnings();
  renderMetrics();
  renderLevers();
  renderBalancesChart();
  renderFanChart('chart-fan-mini', 'legend-fan-mini');
  renderRiskMetrics();
  renderFanChart('chart-fan', 'legend-fan');
  renderSolventChart();
  renderHistogram();
  renderLedger();
  renderAssumptions();
  renderLimitations();
  renderIntake();
  renderResearchValues();
  renderTodos();
  renderScenarios();
  renderRunStatus();
  syncFieldInputs();
  refreshGroupCounts();
  refreshFieldEffects();
  refreshRowSummaries();
}

// ── Chrome: tabs, plan name, import/export/reset ────────────────────────────
function wireChrome() {
  document.getElementById('tabs').addEventListener('click', event => {
    const tab = event.target.closest('.tab');
    if (tab) showTab(tab.dataset.tab);
  });

  document.body.addEventListener('click', event => {
    const goto = event.target.closest('[data-goto]');
    if (goto) showTab(goto.dataset.goto);
  });

  document.getElementById('plan-name').addEventListener('input', event => {
    state.cfg.name = event.target.value;
    persistSoon();
    renderScenarios();
  });

  document.getElementById('notes').addEventListener('input', event => {
    state.cfg.notes = event.target.value;
    persistSoon();
  });

  document.getElementById('btn-export').addEventListener('click', () => exportPlan(state.cfg));
  document.getElementById('btn-import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', onImportFile);
  document.getElementById('btn-reset').addEventListener('click', onReset);

  document.getElementById('btn-levers-reset').addEventListener('click', () => {
    for (const lever of LEVERS) state.cfg.values[lever.key] = state.leverBase[lever.key];
    update();
  });

  document.getElementById('ledger-real').addEventListener('change', event => {
    state.ledgerReal = event.target.checked;
    renderLedger();
  });
  document.getElementById('btn-export-csv').addEventListener('click', onExportCsv);

  // Re-running with the same seed would return the identical answer, since the
  // draws are reproducible on purpose. So the button advances the seed: the
  // useful question is whether a conclusion survives a different set of dice.
  document.getElementById('btn-new-draw').addEventListener('click', () => {
    state.cfg.values.seed = (state.cfg.values.seed | 0) + 1;
    update();
  });

  document.getElementById('fan-include-house').addEventListener('change', event => {
    state.fanIncludeHouse = event.target.checked;
    renderFanChart('chart-fan', 'legend-fan');
    renderFanChart('chart-fan-mini', 'legend-fan-mini');
  });

  document.getElementById('btn-add-income').addEventListener('click', onAddIncome);
  document.getElementById('btn-add-goal').addEventListener('click', onAddGoal);
  document.getElementById('btn-add-todo').addEventListener('click', onAddTodo);
  document.getElementById('todo-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') onAddTodo();
  });
  document.getElementById('btn-save-scenario').addEventListener('click', onSaveScenario);
  document.getElementById('scenario-name').addEventListener('keydown', event => {
    if (event.key === 'Enter') onSaveScenario();
  });

  // Containers holding free text are left alone while they have focus, so a
  // recompute cannot yank a half-typed note out from under the cursor. When
  // focus leaves, they catch up.
  const catchUp = debounce(renderDerived, 80);
  document.body.addEventListener('focusout', catchUp);
}

function showTab(name) {
  state.tab = name;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  }
  for (const panel of document.querySelectorAll('.panel')) {
    panel.classList.toggle('hidden', panel.id !== `panel-${name}`);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onReset() {
  if (!confirm('Reset every input back to the illustrative placeholders? Your saved scenarios are kept. Export first if you want this plan back.')) return;
  clearConfig();
  state.cfg = defaultConfig();
  state.leverBase = leverSnapshot();
  renderStructural();
  update();
}

function onImportFile(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      state.cfg = mergeWithDefaults(JSON.parse(String(reader.result)));
      state.leverBase = leverSnapshot();
      renderStructural();
      update();
    } catch (err) {
      alert(`That file could not be read as a plan: ${err.message}`);
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function onExportCsv() {
  const columns = ledgerColumns(false).map(c => ({ label: c.label, get: c.get }));
  const stamp = new Date().toISOString().slice(0, 10);
  const basis = state.ledgerReal ? 'todays-dollars' : 'nominal';
  downloadFile(`finance-ledger-${basis}-${stamp}.csv`, ledgerToCsv(state.det.rows, columns), 'text/csv');
}

// ── Banner, warnings, tab counts ────────────────────────────────────────────
function renderBanner() {
  const el = document.getElementById('placeholder-banner');
  const keys = placeholderKeys(state.cfg);
  const unverifiedRows = countUnverifiedRows();
  const total = keys.length + unverifiedRows;
  if (total === 0) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const rowNote = unverifiedRows > 0
    ? ` and ${unverifiedRows} unverified ${unverifiedRows === 1 ? 'entry' : 'entries'} in your income or goals`
    : '';
  el.innerHTML = `<span><strong>${total} illustrative ${total === 1 ? 'input' : 'inputs'} still to replace.</strong>
      ${keys.length} personal ${keys.length === 1 ? 'field is' : 'fields are'} still at a placeholder${rowNote}.
      Every headline figure on this screen is a demonstration until they are your own numbers.</span>
    <button class="btn-ghost btn-sm" data-goto="inputs">Replace them</button>`;
}

function countUnverifiedRows() {
  const incomes = (state.cfg.incomes || []).filter(s => !s.verified).length;
  const goals = (state.cfg.goals || []).filter(g => !g.verified).length;
  return incomes + goals;
}

function renderTabCounts() {
  const counts = {
    inputs: placeholderKeys(state.cfg).length + countUnverifiedRows(),
    verify: RESEARCH_ITEMS.filter(item => !(state.cfg.research[item.id] || {}).done).length,
    open: openItems().filter(item => !item.done).length,
  };
  for (const tab of document.querySelectorAll('.tab')) {
    const count = counts[tab.dataset.tab];
    const existing = tab.querySelector('.tab-count');
    if (existing) existing.remove();
    if (count) tab.insertAdjacentHTML('beforeend', `<span class="tab-count">${count}</span>`);
  }
}

function renderWarnings() {
  const el = document.getElementById('warnings');
  const summary = state.det.summary;
  const messages = state.det.warnings.slice();

  if (summary.depletionAge != null) {
    messages.push(`On the point-estimate path the spendable portfolio runs out at age ${summary.depletionAge}. Everything after that year is the model describing a plan that has already failed.`);
  } else if (summary.shortfallAge != null) {
    messages.push(`At age ${summary.shortfallAge} spending exceeds everything available to sell and the gap is carried as debt.`);
  }
  if (state.mc.probSuccess < 0.75) {
    messages.push(`${fmtPct(1 - state.mc.probSuccess, 0)} of simulated paths run out of spendable assets before age ${state.cfg.values.endAge}.`);
  }
  const v = state.cfg.values;
  if (v.retireAge <= v.startAge) {
    messages.push('Retirement age is at or below your current age, so there are no working years left to model.');
  }
  if (!(state.cfg.incomes || []).length && v.retireAge > v.startAge) {
    messages.push('There are no income streams, so the model assumes you are already living entirely off the portfolio.');
  }

  el.innerHTML = messages.map(text => `<div class="banner bad"><span>${esc(text)}</span></div>`).join('');
}

// ── Metrics ─────────────────────────────────────────────────────────────────
function metricTile(label, value, note, tone) {
  return `<div class="metric">
    <div class="metric-label">${esc(label)}</div>
    <div class="metric-value${tone ? ` ${tone}` : ''}">${value}</div>
    <div class="metric-note">${note}</div>
  </div>`;
}

function illustrativePill() {
  return placeholderKeys(state.cfg).length
    ? '<span class="pill placeholder">illustrative</span> '
    : '';
}

function renderMetrics() {
  const v = state.cfg.values;
  const s = state.det.summary;
  const mc = state.mc;
  const flag = illustrativePill();
  const atRetirement = state.det.rows.find(row => row.retired) || state.det.rows[state.det.rows.length - 1];
  const drawRate = atRetirement.liquid > 0 ? atRetirement.need / atRetirement.liquid : null;

  const tiles = [
    metricTile('At retirement',
      esc(fmtShort(s.atRetirementReal)),
      `${flag}Age ${v.retireAge} in ${s.retireYear}, after tax, in today's dollars`),

    metricTile(`At age ${v.endAge}`,
      esc(fmtShort(s.terminalReal)),
      `${flag}The point-estimate path, with no bad luck in it`,
      s.terminalReal <= 0 ? 'bad' : null),

    metricTile('Paths that never run dry',
      esc(fmtPct(mc.probSuccess, 0)),
      `${flag}Of ${mc.nSims.toLocaleString('en-US')} randomized paths`,
      mc.probSuccess >= 0.85 ? 'good' : (mc.probSuccess < 0.6 ? 'bad' : null)),

    metricTile('Median simulated outcome',
      esc(fmtShort(mc.terminalPercentiles[50])),
      `${flag}Middle of the range at age ${v.endAge}. Compare it against the point estimate above`),

    metricTile('First-year withdrawal rate',
      drawRate == null ? '&mdash;' : esc(fmtPct(drawRate, 1)),
      `${flag}${esc(fmtShort(atRetirement.need))} drawn from ${esc(fmtShort(atRetirement.liquid))} in ${atRetirement.year}`,
      drawRate != null && drawRate > 0.05 ? 'bad' : null),

    metricTile('Money runs out',
      s.depletionAge == null ? 'Not on this path' : esc(`Age ${s.depletionAge}`),
      `${flag}Point-estimate path only. The risk tab is where this question is answered properly`,
      s.depletionAge == null ? 'good' : 'bad'),

    metricTile('Baseline living expenses',
      esc(fmtShort(s.baseLivingExp)),
      `${flag}${v.livingExpenseMode === 'residual' ? 'Take-home minus savings transfers' : 'The figure you entered'}, today's dollars`),

    metricTile('Lifetime tax on withdrawals',
      esc(fmtShort(s.lifetimeTaxReal)),
      `${flag}Sum of every year's tax, in today's dollars`),
  ];
  document.getElementById('metric-grid').innerHTML = tiles.join('');
}

function renderRiskMetrics() {
  const mc = state.mc;
  const v = state.cfg.values;
  const flag = illustrativePill();
  const finalSpendRatio = mc.avgSpendRatio[mc.avgSpendRatio.length - 1];

  const tiles = [
    metricTile('Never ran dry', esc(fmtPct(mc.probSuccess, 0)),
      `${flag}Held spendable assets through age ${v.endAge}`,
      mc.probSuccess >= 0.85 ? 'good' : (mc.probSuccess < 0.6 ? 'bad' : null)),

    metricTile('Needed debt at some point', esc(fmtPct(mc.probEverInDebt, 0)),
      `${flag}Spending could not be met even after cutting to the floor`,
      mc.probEverInDebt > 0.2 ? 'bad' : null),

    metricTile('Had to cut spending', esc(fmtPct(mc.probEverCutSpending, 0)),
      `${flag}Spent below target in at least one year, down to ${esc(fmtPct(v.minSpendPct, 0))} of it at worst`),

    metricTile('Typical age money runs out',
      mc.medianDepletionAge == null ? 'Never' : esc(`Age ${mc.medianDepletionAge}`),
      `${flag}Median across the paths that did run out`,
      mc.medianDepletionAge == null ? 'good' : 'bad'),

    metricTile('Bad case, 10th percentile', esc(fmtShort(mc.terminalPercentiles[10])),
      `${flag}One path in ten ends below this`),

    metricTile('Good case, 90th percentile', esc(fmtShort(mc.terminalPercentiles[90])),
      `${flag}One path in ten ends above this`),

    metricTile('Spending funded at the end', esc(fmtPct(finalSpendRatio, 0)),
      `${flag}Average share of desired spending actually funded in the final year`),

    mc.probLtc == null
      ? metricTile('Entered long-term care', 'Not modeled',
        'Any allowance for care is buried inside the flat retirement spending figure. Switch it on below to model it as its own event')
      : metricTile('Entered long-term care', esc(fmtPct(mc.probLtc, 0)),
        `${flag}Share of paths with a care event after age ${v.ltcStartAge}`),
  ];
  document.getElementById('risk-metrics').innerHTML = tiles.join('');
}

// ── Levers ──────────────────────────────────────────────────────────────────
function leverSnapshot() {
  const snap = {};
  for (const lever of LEVERS) snap[lever.key] = state.cfg.values[lever.key];
  return snap;
}

// What a lever is worth: the same plan with only this one input put back where
// it started. Everything else stays where it is now, so the figure answers
// "what did moving this buy me", not "what if I reverted everything".
function leverEffect(lever) {
  const v = state.cfg.values;
  const base = state.leverBase[lever.key];
  if (v[lever.key] === base) return 'At its starting value.';
  const reverted = clonePlain(state.cfg);
  reverted.values[lever.key] = base;
  const delta = state.det.summary.terminalReal - runDeterministic(reverted).summary.terminalReal;
  return `${fmtSigned(delta)} at age ${v.endAge} versus ${lever.fmt(base)}.`;
}

function renderLevers() {
  const v = state.cfg.values;
  const grid = document.getElementById('lever-grid');

  // Mid-drag the slider being held must not be replaced, so only the readouts
  // are refreshed. They are the part that has to stay live: a lever whose
  // effect text lagged behind the handle would be worse than no readout.
  if (grid.querySelector('.lever') && grid.contains(document.activeElement)) {
    for (const el of grid.querySelectorAll('.lever')) {
      const lever = LEVERS.find(l => l.key === el.dataset.key);
      if (!lever) continue;
      el.querySelector('.lever-value').textContent = lever.fmt(v[lever.key]);
      el.querySelector('.lever-effect').textContent = leverEffect(lever);
    }
    return;
  }

  grid.innerHTML = LEVERS.map(lever => {
    const range = lever.range(v);
    return `<div class="lever" data-key="${lever.key}">
      <div class="lever-head">
        <span class="lever-name">${esc(lever.label)}</span>
        <span class="lever-value">${esc(lever.fmt(v[lever.key]))}</span>
      </div>
      <input type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="${v[lever.key]}">
      <div class="lever-effect">${esc(leverEffect(lever))}</div>
    </div>`;
  }).join('');

  grid.oninput = event => {
    const holder = event.target.closest('.lever');
    if (!holder) return;
    const lever = LEVERS.find(l => l.key === holder.dataset.key);
    state.cfg.values[lever.key] = parseFloat(event.target.value);
    holder.querySelector('.lever-value').textContent = lever.fmt(state.cfg.values[lever.key]);
    updateSoon();
  };
}

// ── Charts ──────────────────────────────────────────────────────────────────
const BUCKET_LABELS = {
  cash: 'Cash',
  bonds: 'Bonds',
  taxable: 'Taxable brokerage',
  pretax: 'Pre-tax retirement',
  roth: 'Roth',
  earmarked: 'Earmarked goal account',
  houseEquity: 'Property equity',
};

function balanceSeries(rows) {
  const getters = {
    cash: r => r.cash,
    bonds: r => r.bonds,
    taxable: r => r.taxableAfterTax,
    pretax: r => r.pretaxAfterTax,
    roth: r => r.roth,
    earmarked: r => r.earmarked,
    houseEquity: r => r.houseEquity,
  };
  return Object.keys(getters)
    .map(key => ({
      key,
      label: BUCKET_LABELS[key],
      color: BUCKET_COLORS[key],
      values: rows.map(r => getters[key](r) / r.deflator),
    }))
    .filter(s => s.values.some(x => Math.abs(x) > 0.5));
}

function renderBalancesChart() {
  const rows = state.det.rows;
  const years = rows.map(r => r.year);
  const series = balanceSeries(rows);
  const holder = document.getElementById('chart-balances');
  holder.innerHTML = stackedAreaChart(years, series);

  attachHover(holder, years, index => {
    const row = rows[index];
    const lines = series.map(s => `<div class="tip-row">
        <span><span class="tip-swatch" style="background:${s.color}"></span>${esc(s.label)}</span>
        <span>${esc(fmtShort(s.values[index]))}</span>
      </div>`).join('');
    return `<div class="tip-head">${row.year} &middot; age ${row.age}${row.retired ? ' &middot; retired' : ''}</div>
      ${lines}
      <div class="tip-row"><span><strong>After-tax total</strong></span><span><strong>${esc(fmtShort(row.netWorthAfterTaxReal))}</strong></span></div>`;
  });

  document.getElementById('legend-balances').innerHTML = series.map(s =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${s.color}"></span>${esc(s.label)}</span>`
  ).join('') + '<span class="legend-item"><span class="legend-swatch line"></span>After-tax total</span>';
}

function renderFanChart(chartId, legendId) {
  const mc = state.mc;
  const rows = state.det.rows;
  const years = mc.years;
  const bands = state.fanIncludeHouse ? mc.bands.total : mc.bands.liquid;
  const line = rows.map(r => (state.fanIncludeHouse ? r.netWorthAfterTaxReal : r.liquidAfterTaxReal));

  const holder = document.getElementById(chartId);
  holder.innerHTML = fanChart(years, bands, line);

  attachHover(holder, years, index => {
    const row = rows[index];
    const rowsHtml = [[95, '95th'], [75, '75th'], [50, 'Median'], [25, '25th'], [5, '5th']].map(([p, label]) =>
      `<div class="tip-row"><span>${label}</span><span>${esc(fmtShort(bands[p][index]))}</span></div>`
    ).join('');
    return `<div class="tip-head">${row.year} &middot; age ${row.age}</div>
      ${rowsHtml}
      <div class="tip-row"><span>Point estimate</span><span>${esc(fmtShort(line[index]))}</span></div>
      <div class="tip-row"><span>Still solvent</span><span>${esc(fmtPct(mc.solventShare[index], 0))}</span></div>`;
  });

  document.getElementById(legendId).innerHTML = `
    <span class="legend-item"><span class="legend-swatch" style="background:rgba(107,93,63,0.24)"></span>25th to 75th percentile</span>
    <span class="legend-item"><span class="legend-swatch" style="background:rgba(107,93,63,0.12)"></span>5th to 95th percentile</span>
    <span class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>Median path</span>
    <span class="legend-item"><span class="legend-swatch dashed"></span>Point-estimate path</span>`;
}

function renderSolventChart() {
  const mc = state.mc;
  const holder = document.getElementById('chart-solvent');
  holder.innerHTML = shareChart(mc.years, mc.solventShare, 'Share of paths with spendable assets left');
  attachHover(holder, mc.years, index =>
    `<div class="tip-head">${mc.years[index]} &middot; age ${mc.ages[index]}</div>
     <div class="tip-row"><span>Still solvent</span><span>${esc(fmtPct(mc.solventShare[index], 1))}</span></div>
     <div class="tip-row"><span>Spending funded</span><span>${esc(fmtPct(mc.avgSpendRatio[index], 0))}</span></div>`);
}

// The distribution of outcomes has a very long right tail — a handful of paths
// compound their way to absurd numbers — and drawing it in full squeezes every
// path you might actually live into the leftmost inch of the chart. The extreme
// 1% at each end is left off the axis and reported underneath instead, so the
// tail is disclosed rather than allowed to flatten everything else.
function renderHistogram() {
  const samples = state.fanIncludeHouse ? state.mc.terminalSamples : state.mc.terminalSamplesLiquid;
  const n = samples.length;
  const loIndex = Math.floor(n * 0.01);
  const hiIndex = Math.max(loIndex + 1, Math.ceil(n * 0.99));
  const shown = samples.slice(loIndex, hiIndex);
  const omitted = n - shown.length;

  document.getElementById('chart-hist').innerHTML = histogramChart(shown, 40);
  document.getElementById('hist-note').textContent = omitted > 0
    ? `Drawn from ${fmtShort(shown[0])} to ${fmtShort(shown[shown.length - 1])}. The ${omitted} most extreme of ${n.toLocaleString('en-US')} paths are off the axis at each end — the best of them reaches ${fmtShort(samples[n - 1])}, which says more about compounding over ${state.mc.nYears} years than about a plan.`
    : `All ${n.toLocaleString('en-US')} paths are drawn.`;
}

// ── Inputs: the generic field rows ──────────────────────────────────────────
function fieldControl(f, value) {
  const id = `f-${f.key}`;
  if (f.type === 'bool') {
    return `<input type="checkbox" id="${id}" data-role="value"${value ? ' checked' : ''}>`;
  }
  if (f.type === 'choice') {
    const options = f.options.map(([val, label]) =>
      `<option value="${esc(val)}"${val === value ? ' selected' : ''}>${esc(label)}</option>`).join('');
    return `<select id="${id}" data-role="value">${options}</select>`;
  }
  if (f.type === 'text') {
    return `<input type="text" id="${id}" data-role="value" value="${esc(value)}" autocomplete="off">`;
  }
  if (f.type === 'pct') {
    return `<input type="number" id="${id}" data-role="value" step="0.1" value="${esc(pctToInput(value))}"><span class="unit">%</span>`;
  }
  const step = f.type === 'money' ? '100' : '1';
  const unit = f.type === 'money' ? '<span class="unit">$</span>' : '';
  return `${unit}<input type="number" id="${id}" data-role="value" step="${step}" value="${esc(value)}">`;
}

// A field is inactive when a switch elsewhere makes it feed nothing. It stays
// editable — the value still matters the moment the switch goes on — but it says
// so, because a setting that silently changes no output is indistinguishable
// from an app that has stopped recalculating.
function fieldIsActive(f) {
  return !f.activeWhen || !!f.activeWhen(state.cfg);
}

function inactiveText(f) {
  return `Changing this has no effect right now — ${f.inactiveNote}.`;
}

function fieldPills(f) {
  const meta = state.cfg.meta[f.key] || {};
  let out = '';
  if (f.personal) {
    out += meta.verified
      ? '<span class="pill verified">yours</span>'
      : '<span class="pill placeholder">placeholder</span>';
  }
  if (f.research) out += '<span class="pill research">needs research</span>';
  return out;
}

function fieldRow(f) {
  const value = state.cfg.values[f.key];
  const meta = state.cfg.meta[f.key] || {};
  const ph = isPlaceholder(state.cfg, f.key);
  const inactive = !fieldIsActive(f);
  return `<div class="field${ph ? ' is-placeholder' : ''}${inactive ? ' is-inactive' : ''}" data-key="${f.key}">
    <div class="field-main">
      <div class="field-name">
        <label for="f-${f.key}">${esc(f.label)}</label>
        <span class="field-pills">${fieldPills(f)}</span>
      </div>
      <p class="field-help">${esc(f.help)}</p>
      ${inactive ? `<p class="field-inactive">${esc(inactiveText(f))}</p>` : ''}
    </div>
    <div class="field-input">${fieldControl(f, value)}</div>
    <div class="field-status">
      <label class="verify-toggle">
        <input type="checkbox" data-role="verify"${meta.verified ? ' checked' : ''}> This is my own number
      </label>
      <input class="field-source" type="text" data-role="source" autocomplete="off"
        placeholder="Where it came from" value="${esc(meta.source || '')}">
    </div>
  </div>`;
}

function renderFieldGroups() {
  const container = document.getElementById('field-groups');
  container.innerHTML = GROUPS.filter(g => g.id !== 'monteCarlo').map(group => {
    const fields = FIELDS.filter(f => f.group === group.id);
    const pending = fields.filter(f => isPlaceholder(state.cfg, f.key)).length;
    return `<details class="group" data-group="${group.id}"${group.id === 'timeline' ? ' open' : ''}>
      <summary>
        <h2>${esc(group.label)}</h2>
        <span class="group-blurb">${esc(group.blurb)}</span>
        ${pending ? `<span class="pill placeholder">${pending} to replace</span>` : '<span class="pill verified">done</span>'}
      </summary>
      ${fields.map(fieldRow).join('')}
    </details>`;
  }).join('');

  document.getElementById('risk-fields').innerHTML =
    FIELDS.filter(f => f.group === 'monteCarlo').map(fieldRow).join('');
}

function wireInputs() {
  for (const id of ['field-groups', 'risk-fields']) {
    const container = document.getElementById(id);
    container.addEventListener('input', onFieldEvent);
    container.addEventListener('change', onFieldEvent);
  }
  document.getElementById('income-list').addEventListener('input', onRowEvent);
  document.getElementById('income-list').addEventListener('change', onRowEvent);
  document.getElementById('income-list').addEventListener('click', onRowClick);
  document.getElementById('goal-list').addEventListener('input', onRowEvent);
  document.getElementById('goal-list').addEventListener('change', onRowEvent);
  document.getElementById('goal-list').addEventListener('click', onRowClick);
  document.getElementById('research-list').addEventListener('input', onResearchEvent);
  document.getElementById('research-list').addEventListener('change', onResearchEvent);
  document.getElementById('todo-list').addEventListener('click', onTodoClick);
  document.getElementById('todo-list').addEventListener('change', onTodoClick);
  document.getElementById('scenario-list').addEventListener('click', onScenarioClick);
}

function onFieldEvent(event) {
  const row = event.target.closest('.field');
  if (!row) return;
  const key = row.dataset.key;
  const f = FIELDS_BY_KEY[key];
  const role = event.target.dataset.role;
  if (!f || !role) return;

  if (role === 'value') {
    if (event.type === 'change' && f.type !== 'bool' && f.type !== 'choice') return;
    state.cfg.values[key] = readControl(f, event.target);
    if (key === 'birthYear') suggestRmdAge();
    updateSoon();
    return;
  }
  if (role === 'verify') {
    state.cfg.meta[key].verified = event.target.checked;
    row.classList.toggle('is-placeholder', isPlaceholder(state.cfg, key));
    row.querySelector('.field-pills').innerHTML = fieldPills(f);
    updateSoon();
    return;
  }
  if (role === 'source') {
    state.cfg.meta[key].source = event.target.value;
    persistSoon();
  }
}

function readControl(f, el) {
  if (f.type === 'bool') return el.checked;
  if (f.type === 'choice' || f.type === 'text') return el.value;
  if (f.type === 'pct') return inputToPct(el.value);
  if (f.type === 'money') return parseNumber(el.value);
  return Math.round(parseNumber(el.value));
}

// The RMD start age depends on birth year under current law, so the app offers
// the age the law suggests rather than silently applying it — the whole point
// of the Verify tab is that this is a rule to confirm, not inherit.
function suggestRmdAge() {
  const suggested = suggestedRmdAge(state.cfg.values.birthYear);
  const row = document.querySelector('.field[data-key="rmdStartAge"]');
  if (!row || suggested == null) return;
  let hint = row.querySelector('.rmd-hint');
  if (suggested === state.cfg.values.rmdStartAge) {
    if (hint) hint.remove();
    return;
  }
  if (!hint) {
    hint = document.createElement('button');
    hint.className = 'btn-link rmd-hint';
    hint.addEventListener('click', () => {
      state.cfg.values.rmdStartAge = suggestedRmdAge(state.cfg.values.birthYear);
      document.querySelector('.field[data-key="rmdStartAge"] [data-role="value"]').value = state.cfg.values.rmdStartAge;
      suggestRmdAge();
      update();
    });
    row.querySelector('.field-main').appendChild(hint);
  }
  hint.textContent = `Current law suggests ${suggested} for someone born in ${state.cfg.values.birthYear} — use it?`;
}

// Each group header carries a count of how many placeholders are left inside
// it. That header lives in markup only rebuilt when the shape of the plan
// changes, so the count has to be refreshed on its own: marking a field as your
// own clears its row immediately, and a header above it still insisting on the
// old number reads as the app having ignored the click. Refreshed in place
// rather than re-rendered, so open sections stay open.
function refreshGroupCounts() {
  for (const group of document.querySelectorAll('#field-groups .group')) {
    const pill = group.querySelector('summary .pill');
    if (!pill) continue;
    const pending = FIELDS.filter(f =>
      f.group === group.dataset.group && isPlaceholder(state.cfg, f.key)).length;
    pill.className = `pill ${pending ? 'placeholder' : 'verified'}`;
    pill.textContent = pending ? `${pending} to replace` : 'done';
  }
}

// Whether a field is inactive depends on other fields, so it is re-evaluated
// after every change rather than only when the rows are built. Updated in place
// so the row keeps its focus and its typed contents.
function refreshFieldEffects() {
  for (const row of document.querySelectorAll('.field')) {
    const f = FIELDS_BY_KEY[row.dataset.key];
    if (!f || !f.activeWhen) continue;
    const active = fieldIsActive(f);
    row.classList.toggle('is-inactive', !active);
    const existing = row.querySelector('.field-inactive');
    if (active) {
      if (existing) existing.remove();
      continue;
    }
    const note = existing || row.querySelector('.field-main').appendChild(document.createElement('p'));
    note.className = 'field-inactive';
    note.textContent = inactiveText(f);
  }
}

// What the last simulation actually cost, so the price of a big path count is
// visible rather than felt as unexplained lag.
function renderRunStatus() {
  document.getElementById('run-status').textContent =
    `${state.mc.nSims.toLocaleString('en-US')} paths, seed ${state.cfg.values.seed}, drawn in ${Math.round(state.lastRunMs)} ms`;
}

// Levers and imports change values behind the field inputs' backs, so the
// inputs are re-synced from config. Whatever has focus is left alone, because
// overwriting a control mid-edit is how you lose a half-typed number.
function syncFieldInputs() {
  for (const row of document.querySelectorAll('.field')) {
    const f = FIELDS_BY_KEY[row.dataset.key];
    const el = row.querySelector('[data-role="value"]');
    if (!f || !el || el === document.activeElement) continue;
    const value = state.cfg.values[f.key];
    if (f.type === 'bool') el.checked = !!value;
    else if (f.type === 'pct') el.value = pctToInput(value);
    else el.value = value;
  }
}

// ── Inputs: income streams ──────────────────────────────────────────────────
function incomeRow(s) {
  return `<div class="row-card" data-id="${esc(s.id)}" data-kind="income">
    <div class="row-grid">
      <label class="wide"><span class="field-label">Name</span>
        <input type="text" data-f="name" value="${esc(s.name || '')}" autocomplete="off"></label>
      <label><span class="field-label">Amount / year</span>
        <input type="number" step="100" data-f="amount" value="${esc(s.amount || 0)}"></label>
      <label><span class="field-label">Basis</span>
        <select data-f="basis">
          <option value="gross"${s.basis === 'gross' ? ' selected' : ''}>Gross</option>
          <option value="net"${s.basis === 'net' ? ' selected' : ''}>Take-home</option>
        </select></label>
      <label><span class="field-label">Growth %</span>
        <input type="number" step="0.1" data-f="growth" value="${s.growth == null ? '' : esc(pctToInput(s.growth))}"
          placeholder="${esc(pctToInput(state.cfg.values.salaryGrowth))}"></label>
      <label><span class="field-label">Starts</span>
        <input type="number" step="1" data-f="startYear" value="${s.startYear == null ? '' : esc(s.startYear)}"
          placeholder="now"></label>
      <label><span class="field-label">Ends</span>
        <input type="number" step="1" data-f="endYear" value="${s.endYear == null ? '' : esc(s.endYear)}"
          placeholder="retirement"></label>
      <label class="wide"><span class="field-label">Where this number came from</span>
        <input type="text" data-f="source" value="${esc(s.source || '')}" autocomplete="off"
          placeholder="A pay stub, a contract, an estimate"></label>
    </div>
    <div class="row-foot">
      <span class="row-summary"></span>
      <div class="button-row">
        <label class="verify-toggle"><input type="checkbox" data-f="verified"${s.verified ? ' checked' : ''}> Verified</label>
        <button class="btn-link danger" data-act="remove">Remove</button>
      </div>
    </div>
  </div>`;
}

function renderIncomes() {
  const list = document.getElementById('income-list');
  const streams = state.cfg.incomes || [];
  list.innerHTML = streams.length
    ? streams.map(incomeRow).join('')
    : '<p class="empty-state">No income streams. The model will assume you are already living entirely off the portfolio.</p>';
}

function onAddIncome() {
  state.cfg.incomes.push({
    id: newId('inc'), name: 'New stream', amount: 0, basis: 'gross',
    growth: null, startYear: null, endYear: null, source: '', verified: false,
  });
  renderIncomes();
  update();
}

// ── Inputs: goals ───────────────────────────────────────────────────────────
function goalRow(g) {
  return `<div class="row-card" data-id="${esc(g.id)}" data-kind="goal">
    <div class="row-grid">
      <label class="wide"><span class="field-label">Name</span>
        <input type="text" data-f="name" value="${esc(g.name || '')}" autocomplete="off"></label>
      <label><span class="field-label">Cost, today's $</span>
        <input type="number" step="100" data-f="cost0" value="${esc(g.cost0 || 0)}"></label>
      <label><span class="field-label">Its own inflation %</span>
        <input type="number" step="0.1" data-f="inflation" value="${g.inflation == null ? '' : esc(pctToInput(g.inflation))}"
          placeholder="${esc(pctToInput(state.cfg.values.inflation))}"></label>
      <label><span class="field-label">First year</span>
        <input type="number" step="1" data-f="startYear" value="${esc(g.startYear || state.cfg.values.startYear)}"></label>
      <label><span class="field-label">Last year</span>
        <input type="number" step="1" data-f="endYear" value="${g.endYear == null ? '' : esc(g.endYear)}"
          placeholder="one-off"></label>
      <label><span class="field-label">Funded from</span>
        <select data-f="bucket">
          <option value="general"${g.bucket === 'general' ? ' selected' : ''}>The portfolio</option>
          <option value="earmarked"${g.bucket === 'earmarked' ? ' selected' : ''}>Earmarked account first</option>
        </select></label>
      <label class="wide"><span class="field-label">Where this number came from</span>
        <input type="text" data-f="source" value="${esc(g.source || '')}" autocomplete="off"
          placeholder="A quote, a tuition schedule, an estimate"></label>
    </div>
    <div class="row-foot">
      <span class="row-summary"></span>
      <div class="button-row">
        <label class="verify-toggle"><input type="checkbox" data-f="discretionary"${g.discretionary ? ' checked' : ''}> Can be cut under stress</label>
        <label class="verify-toggle"><input type="checkbox" data-f="verified"${g.verified ? ' checked' : ''}> Verified</label>
        <button class="btn-link danger" data-act="remove">Remove</button>
      </div>
    </div>
  </div>`;
}

function renderGoals() {
  const list = document.getElementById('goal-list');
  const goals = state.cfg.goals || [];
  list.innerHTML = goals.length
    ? goals.map(goalRow).join('')
    : '<p class="empty-state">No goals yet. Anything that costs money on a schedule belongs here.</p>';

  document.getElementById('goal-trap-note').innerHTML =
    `<strong>Before adding a recurring bill, check it is not already counted.</strong>
     Your baseline living expenses ${state.cfg.values.livingExpenseMode === 'residual'
      ? 'are a top-down residual of take-home pay, so they already include every bill you pay today'
      : 'are the figure you entered, which should already include every bill you pay today'}.
     A bill that is partly permanent and partly temporary — an ongoing common charge plus a special
     assessment that ends on a known date, say — should be entered here as the temporary part only,
     dropping to zero when it ends. Entering the full combined bill double-counts the permanent half
     for as long as the goal runs.`;
}

function onAddGoal() {
  state.cfg.goals.push({
    id: newId('goal'), name: 'New goal', startYear: state.cfg.values.startYear + 1, endYear: null,
    cost0: 0, inflation: null, discretionary: true, bucket: 'general', source: '', verified: false,
  });
  renderGoals();
  update();
}

// ── Row editing shared by income streams and goals ──────────────────────────
const ROW_BLANKABLE = new Set(['growth', 'startYear', 'endYear', 'inflation']);

function onRowEvent(event) {
  const card = event.target.closest('.row-card');
  const field = event.target.dataset.f;
  if (!card || !field) return;
  const list = card.dataset.kind === 'income' ? state.cfg.incomes : state.cfg.goals;
  const row = list.find(r => r.id === card.dataset.id);
  if (!row) return;

  const el = event.target;
  if (el.type === 'checkbox') row[field] = el.checked;
  else if (el.tagName === 'SELECT' || field === 'name' || field === 'source') row[field] = el.value;
  else if (ROW_BLANKABLE.has(field) && el.value.trim() === '') row[field] = null;
  else if (field === 'growth' || field === 'inflation') row[field] = inputToPct(el.value);
  else if (field === 'startYear' || field === 'endYear') row[field] = Math.round(parseNumber(el.value));
  else row[field] = parseNumber(el.value);

  updateSoon();
}

function onRowClick(event) {
  const button = event.target.closest('[data-act="remove"]');
  if (!button) return;
  const card = button.closest('.row-card');
  const kind = card.dataset.kind;
  const list = kind === 'income' ? state.cfg.incomes : state.cfg.goals;
  const index = list.findIndex(r => r.id === card.dataset.id);
  if (index >= 0) list.splice(index, 1);
  if (kind === 'income') renderIncomes(); else renderGoals();
  update();
}

function refreshRowSummaries() {
  const v = state.cfg.values;
  const retireYear = state.det.derived.retireYear;

  for (const card of document.querySelectorAll('.row-card[data-kind="income"]')) {
    const s = (state.cfg.incomes || []).find(r => r.id === card.dataset.id);
    const el = card.querySelector('.row-summary');
    if (!s || !el) continue;
    const thisYear = streamAmount(state.cfg, s, v.startYear);
    const takeHome = s.basis === 'net' ? thisYear : thisYear * (1 - v.effectiveTax);
    const from = s.startYear == null ? v.startYear : s.startYear;
    const to = s.endYear == null ? retireYear - 1 : s.endYear;
    el.textContent = thisYear > 0
      ? `${fmtMoney(thisYear)} this year, ${fmtMoney(takeHome)} after tax · runs ${from} to ${to}`
      : `Nothing arrives this year · runs ${from} to ${to}`;
  }

  for (const card of document.querySelectorAll('.row-card[data-kind="goal"]')) {
    const g = (state.cfg.goals || []).find(r => r.id === card.dataset.id);
    const el = card.querySelector('.row-summary');
    if (!g || !el) continue;
    const inflation = g.inflation == null ? v.inflation : g.inflation;
    const t = (g.startYear || v.startYear) - v.startYear;
    const atCost = (g.cost0 || 0) * Math.pow(1 + inflation, t);
    const years = g.endYear == null ? 1 : Math.max(1, g.endYear - g.startYear + 1);
    el.textContent = `${fmtMoney(g.cost0 || 0)} today is ${fmtMoney(atCost)} in ${g.startYear}`
      + (years > 1 ? ` · repeats for ${years} years` : ' · one-off')
      + (g.discretionary ? ' · can be cut' : ' · always funded in full');
  }
}

// ── Intake checklist ────────────────────────────────────────────────────────
function renderIntake() {
  const cfg = state.cfg;
  const v = cfg.values;
  const done = (ok, text) => `<li>${ok ? '<span class="pill verified">done</span> ' : ''}${text}</li>`;
  const groupPending = id => FIELDS.filter(f => f.group === id && isPlaceholder(cfg, f.key)).length;

  const balancesLeft = groupPending('balances');
  const incomesVerified = (cfg.incomes || []).filter(s => s.verified).length;
  const goalsVerified = (cfg.goals || []).filter(g => g.verified).length;

  const items = [
    done(groupPending('timeline') === 0,
      `<strong>Who is in scope, and where.</strong> Ages, filing status, dependents, and the state and city you are taxed in — that last one drives most of the tax treatment below.`),
    done((cfg.incomes || []).length > 0 && incomesVerified === (cfg.incomes || []).length,
      `<strong>Every income stream, from real documents.</strong> ${incomesVerified} of ${(cfg.incomes || []).length} verified. Take the figures from pay stubs or deposits, and mark each one gross or take-home — conflating those is the easiest error here.`),
    done(balancesLeft === 0,
      `<strong>Every account balance, from current statements.</strong> ${balancesLeft ? `${balancesLeft} still at a placeholder.` : 'All replaced.'} Use what each account actually holds rather than a generic split.`),
    done((cfg.goals || []).length > 0 && goalsVerified === (cfg.goals || []).length,
      `<strong>What the money is for.</strong> ${goalsVerified} of ${(cfg.goals || []).length} goals verified. A home, tuition, a sabbatical, supporting family, care costs — with dates and costs in today's dollars.`),
    done(RESEARCH_ITEMS.every(item => (cfg.research[item.id] || {}).done),
      `<strong>The tax and account rules, researched for you.</strong> The Verify tab lists what cannot be inherited from a template. Placeholder tax rates are worth nothing until checked.`),
    done(v.livingExpenseMode === 'explicit' || groupPending('spending') === 0,
      `<strong>What life actually costs.</strong> ${v.livingExpenseMode === 'residual'
        ? 'Currently a top-down residual of take-home pay, which quietly shrinks whenever an income input is corrected downward. An explicit figure from real spending data is more honest if you have it.'
        : 'Entered explicitly, which is the more honest of the two options.'}`),
    done(true,
      `<strong>Keep documents out of this app.</strong> Balances, contributions and fund names are all it needs. Never type an account number, and if you keep statements on disk, keep them somewhere excluded from version control.`),
  ];
  document.getElementById('intake-list').innerHTML = items.join('');
}

// ── Ledger ──────────────────────────────────────────────────────────────────
function ledgerColumns(applyDeflator) {
  const real = applyDeflator == null ? state.ledgerReal : applyDeflator;
  const m = get => row => (real ? get(row) / row.deflator : get(row));
  return [
    { label: 'Year', get: r => r.year, plain: true },
    { label: 'Age', get: r => r.age, plain: true },
    { label: 'Gross income', get: m(r => r.gross) },
    { label: 'Take-home', get: m(r => r.takeHome) },
    { label: 'Social Security, net', get: m(r => r.ssNet) },
    { label: 'Living expenses', get: m(r => r.livingExp) },
    { label: 'Goals', get: m(r => r.goalCost) },
    { label: 'Saved pre-tax', get: m(r => r.pretaxContrib) },
    { label: 'Saved taxable', get: m(r => r.taxableContrib) },
    { label: 'Portfolio draw', get: m(r => r.withdrawal) },
    { label: 'From pre-tax', get: m(r => r.fromPretax) },
    { label: 'RMD required', get: m(r => r.rmdRequired) },
    { label: 'Tax paid', get: m(r => r.taxPaid) },
    { label: 'Shortfall', get: m(r => r.shortfall) },
    { label: 'Cash', get: m(r => r.cash) },
    { label: 'Bonds', get: m(r => r.bonds) },
    { label: 'Taxable', get: m(r => r.taxable) },
    { label: 'Pre-tax', get: m(r => r.pretax) },
    { label: 'Roth', get: m(r => r.roth) },
    { label: 'Earmarked', get: m(r => r.earmarked) },
    { label: 'Mortgage', get: m(r => r.mortgage) },
    { label: 'Property equity', get: m(r => r.houseEquity) },
    { label: 'Net worth, after tax', get: m(r => r.netWorthAfterTax) },
  ];
}

function renderLedger() {
  const rows = state.det.rows;
  // A column that is zero in every year is noise in a table this wide, so it is
  // dropped from the view. The CSV export still carries every column.
  const columns = ledgerColumns().filter(c =>
    c.plain || rows.some(r => Math.abs(c.get(r)) > 0.5));

  const head = `<thead><tr>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>`;
  const body = rows.map(r => {
    const classes = [];
    if (r.retired) classes.push('is-retired');
    if (r.shortfall > 0.5) classes.push('is-shortfall');
    const cells = columns.map(c => {
      const value = c.get(r);
      if (c.plain) return `<td>${value}</td>`;
      return `<td${value < -0.5 ? ' class="neg"' : ''}>${esc(fmtShort(value))}</td>`;
    }).join('');
    return `<tr class="${classes.join(' ')}">${cells}</tr>`;
  }).join('');

  document.getElementById('ledger-table').innerHTML = head + `<tbody>${body}</tbody>`;
  document.getElementById('ledger-note').textContent =
    `${state.ledgerReal ? "Today's dollars" : 'Nominal dollars of each year'}. Figures are rounded for reading and columns that are zero in every year are hidden — the CSV export carries exact numbers and every column. Retirement years are marked in the year column; a year that ended in debt is shaded.`;
}

// ── Assumptions ─────────────────────────────────────────────────────────────
function choiceLabel(key) {
  const f = FIELDS_BY_KEY[key];
  const found = (f.options || []).find(([val]) => val === state.cfg.values[key]);
  return found ? found[1] : state.cfg.values[key];
}

function fmtValue(f) {
  const value = state.cfg.values[f.key];
  if (f.type === 'pct') return fmtPct(value, 2);
  if (f.type === 'money') return fmtMoney(value);
  if (f.type === 'bool') return value ? 'on' : 'off';
  if (f.type === 'choice') return choiceLabel(f.key);
  if (f.type === 'text') return value || 'not recorded';
  return String(value);
}

// One paragraph per group, written from the numbers currently in the config.
// This is the "why the model looks the way it does" narrative — current state
// only, never a history of what the numbers used to be. That history lives in
// the git log, where the diffs are real and cannot drift out of sync.
function groupNarrative(id) {
  const v = state.cfg.values;
  const d = state.det.derived;
  const s = state.det.summary;

  if (id === 'timeline') {
    return `You are ${v.startAge} in ${v.startYear}, retiring at ${v.retireAge} in ${d.retireYear}, with the
      projection running to age ${v.endAge}. That is ${v.retireAge - v.startAge} more working years and
      ${v.endAge - v.retireAge} retired ones. Filing status is ${choiceLabel('filingStatus').toLowerCase()}.
      ${v.jurisdiction ? `Taxed in ${esc(v.jurisdiction)}.` : 'No jurisdiction is recorded, which leaves every state and local rate below unanchored to anywhere in particular.'}`;
  }
  if (id === 'income') {
    const gross = grossInYear(state.cfg, v.startYear);
    const realRaise = v.salaryGrowth - v.inflation;
    return `${(state.cfg.incomes || []).length} income ${(state.cfg.incomes || []).length === 1 ? 'stream brings' : 'streams bring'}
      ${fmtMoney(gross)} gross this year, ${fmtMoney(d.takeHome0)} of it take-home after an assumed
      ${fmtPct(v.effectiveTax)} effective rate. Income grows at ${fmtPct(v.salaryGrowth)} against
      ${fmtPct(v.inflation)} inflation, so ${realRaise > 0.0005
        ? `about ${fmtPct(realRaise)} a year in real terms`
        : realRaise < -0.0005 ? 'a real-terms decline every year' : 'no real growth at all'}.
      You save ${fmtMoney(v.contribPretax)} pre-tax and ${fmtMoney(v.contribTaxableRecurring)} after tax,
      ${fmtPct(d.savingsRate0)} of gross pay. ${v.saveSurplusPct > 0
        ? `${fmtPct(v.saveSurplusPct)} of any take-home left over on top of that is saved too.`
        : 'Anything left over on top of that is assumed to be absorbed by lifestyle rather than saved, which is the conservative reading of a raise.'}`;
  }
  if (id === 'spending') {
    const replacement = d.baseLivingExp > 0 ? v.retireSpend / d.baseLivingExp : null;
    return `Baseline living expenses are ${fmtMoney(d.baseLivingExp)} a year in today's dollars,
      ${v.livingExpenseMode === 'residual'
        ? 'derived top-down as take-home pay minus the savings transfer. That figure is convenient and always self-consistent with income, but it shrinks whenever an income input is corrected downward even if real spending never changed — and it is load-bearing well beyond display'
        : 'entered explicitly rather than derived from income, which is the more honest of the two options'}.
      ${d.mortPayment > 0
        ? `Of that, ${fmtMoney(d.mortPayment)} is the mortgage payment, held flat in nominal terms and dropping out entirely at payoff, while the remaining ${fmtMoney(d.livingExpExMortgage)} inflates each year.`
        : 'There is no mortgage payment inside it.'}
      Retirement spending is ${fmtMoney(v.retireSpend)}${replacement ? `, ${fmtPct(replacement, 0)} of what life costs now` : ''}.`;
  }
  if (id === 'balances') {
    const liquid = v.cash0 + v.bonds0 + v.taxableMix0 + v.pretax0 + v.roth0 + v.earmarked0;
    return `${fmtMoney(liquid)} across every account today: ${fmtMoney(v.cash0)} cash,
      ${fmtMoney(v.bonds0)} in separately-held bonds, ${fmtMoney(v.taxableMix0)} taxable,
      ${fmtMoney(v.pretax0)} pre-tax, ${fmtMoney(v.roth0)} Roth${v.earmarked0 > 0 ? `, ${fmtMoney(v.earmarked0)} earmarked` : ''}.
      ${v.reValue0 > 0
        ? `Property worth ${fmtMoney(v.reValue0)} appreciating at ${fmtPct(v.reAppreciation)} against a ${fmtMoney(v.mortgage0)} mortgage at ${fmtPct(v.mortRate)}, leaving ${fmtMoney(Math.max(0, v.reValue0 - v.mortgage0))} of equity now.`
        : 'No property is modeled, so housing costs sit entirely inside living expenses as rent.'}`;
  }
  if (id === 'returns') {
    return `The invested mix returns ${fmtPct(d.returnPre)} a year while working
      (${fmtPct(v.equityPctPre, 0)} equity at ${fmtPct(v.equityReturn)}, the rest in bonds at ${fmtPct(v.bondReturn)})
      and ${fmtPct(d.returnPost)} after retirement at ${fmtPct(v.equityPctPost, 0)} equity. Against
      ${fmtPct(v.inflation)} inflation those are real returns of about ${fmtPct(d.returnPre - v.inflation)}
      and ${fmtPct(d.returnPost - v.inflation)}. Cash earns ${fmtPct(v.cashReturn)}, which is
      ${v.cashReturn >= v.inflation ? 'at or above inflation' : 'below inflation, so the emergency fund loses real value every year it sits there'}.
      These figures are read as ${v.returnBasis === 'geometric' ? 'compound annual growth rates' : 'arithmetic averages of yearly returns'},
      and the simulation moves around them with ${fmtPct(v.sigmaPre)} volatility before retirement and ${fmtPct(v.sigmaPost)} after.`;
  }
  if (id === 'socialSecurity') {
    const net = v.ssAnnual * (1 - v.ssTaxablePct * v.ssFederalRate);
    const share = v.retireSpend > 0 ? net / v.retireSpend : null;
    return `${fmtMoney(v.ssAnnual)} a year claimed at ${v.ssStartAge}, of which ${fmtPct(v.ssTaxablePct, 0)}
      is assumed federally taxable at ${fmtPct(v.ssFederalRate)} — leaving ${fmtMoney(net)} actually spendable.
      ${share ? `That covers ${fmtPct(share, 0)} of the retirement spending target; the portfolio funds the rest.` : ''}
      The benefit figure has to correspond to that claiming age, since claiming early permanently reduces it and
      delaying permanently increases it.`;
  }
  if (id === 'taxes') {
    const embedded = v.taxableMix0 * v.taxableGainPct * (v.ltcgFederal + v.stateLocalGains);
    return `Pre-tax withdrawals are taxed at a blended ${fmtPct(v.pretaxTaxRate)}, and withdrawals are grossed
      up by that rate so the after-tax proceeds actually cover what was needed. ${fmtPct(v.taxableGainPct, 0)}
      of the taxable balance is assumed to be unrealized gain, taxed at ${fmtPct(v.ltcgFederal + v.stateLocalGains)}
      (${fmtPct(v.ltcgFederal)} federal plus ${fmtPct(v.stateLocalGains)} state and local) — about
      ${fmtMoney(embedded)} of embedded liability inside today's taxable balance.
      ${v.stateLocalGains === 0 ? 'State and local gains tax is set to zero, which is only right if your state genuinely exempts capital gains — several tax them as ordinary income.' : ''}`;
  }
  if (id === 'rmd') {
    const suggested = suggestedRmdAge(v.birthYear);
    return `Required distributions begin at ${v.rmdStartAge}${suggested && suggested !== v.rmdStartAge
      ? `, though current law suggests ${suggested} for a ${v.birthYear} birth year — worth reconciling`
      : ''}. ${s.firstRmdAge ? `The first one in this projection lands at age ${s.firstRmdAge}.` : 'None falls inside the projection horizon.'}
      ${v.spousePretaxShare > 0
        ? `${fmtPct(v.spousePretaxShare, 0)} of the pre-tax balance belongs to a spouse aged ${v.spouseAge}, so two separate distributions are computed on their own ages and their own balances.`
        : 'The whole pre-tax balance is treated as one person\'s, so there is a single distribution keyed off your age.'}
      Anything forced out beyond what was already being spent is taxed and swept into the taxable account, not consumed.`;
  }
  if (id === 'monteCarlo') {
    const on = [];
    if (v.jobLossProb > 0) on.push(`job loss at ${fmtPct(v.jobLossProb)} a year retaining ${fmtPct(v.jobLossIncomePct, 0)} of income`);
    if (v.disabilityProb > 0) on.push(`permanent disability at ${fmtPct(v.disabilityProb)} a year retaining ${fmtPct(v.disabilityIncomePct, 0)}`);
    if (v.coupleCareerToMarket) on.push(`job-loss risk multiplied ${v.recessionJobLossMultiplier}× when returns fall below ${fmtPct(v.recessionReturnThreshold)}`);
    if (v.ltcEnabled) on.push(`long-term care from age ${v.ltcStartAge} at ${fmtPct(v.ltcAnnualProb)} a year, ${v.ltcDurationYears} years at ${fmtMoney(v.ltcAnnualCost0)}`);
    return `${v.nSims.toLocaleString('en-US')} paths from seed ${v.seed}, drawing
      ${v.returnModel === 'fatTail' ? `fat-tailed returns with ${v.tDf} degrees of freedom` : 'independent lognormal returns'}.
      Under stress, lifestyle spending can fall to ${fmtPct(v.minSpendPct, 0)} of target and discretionary goals to
      ${fmtPct(v.minGoalPct, 0)} of theirs, cut simultaneously toward two separate floors rather than one combined one.
      ${on.length ? `Risks switched on: ${on.join('; ')}.` : 'No career or care risk is switched on, so these paths vary only by investment return.'}`;
  }
  return '';
}

function renderAssumptions() {
  const cfg = state.cfg;
  const html = GROUPS.map(group => {
    const fields = FIELDS.filter(f => f.group === group.id);
    const pending = fields.filter(f => isPlaceholder(cfg, f.key));
    const sourced = fields.filter(f => (cfg.meta[f.key] || {}).source);

    const values = fields.map(f => `<div class="assume-row">
        <span class="assume-name">${esc(f.label)}</span>
        <span class="note-value">${esc(fmtValue(f))}</span>
        <span class="assume-source">${(cfg.meta[f.key] || {}).source
          ? esc(cfg.meta[f.key].source)
          : (f.personal && !cfg.meta[f.key].verified ? '<em>placeholder, no note</em>' : '')}</span>
      </div>`).join('');

    return `<div class="note-item${pending.length ? ' flagged' : ''}">
      <h3>${esc(group.label)}</h3>
      <p>${groupNarrative(group.id)}</p>
      ${pending.length
        ? `<p><strong>${pending.length} of these ${pending.length === 1 ? 'is' : 'are'} still a placeholder:</strong> ${esc(pending.map(f => f.label).join(', '))}.</p>`
        : `<p>All ${fields.length} inputs are your own, ${sourced.length} with a note on where the number came from.</p>`}
      <div class="assume-grid">${values}</div>
    </div>`;
  }).join('');

  const body = document.getElementById('assumptions-body');
  if (!isTypingIn(body)) body.innerHTML = `<div class="note-list">${html}</div>`;

  renderStructuralNotes();
  renderUltTable();
}

// Structural choices: the things that are true of the model's shape rather than
// of any one number, and that a reader cannot infer from the inputs.
function renderStructuralNotes() {
  const v = state.cfg.values;
  const notes = [
    ['Withdrawals follow a fixed waterfall',
      `Cash, then separately-held bonds, then taxable brokerage, then pre-tax, and Roth only as a last resort, because tax-free growth is the most valuable thing in the stack. One honest consequence: a real household in trouble would very likely tap Roth before draining everything else, so the worst paths here look slightly worse than they would really be.`],
    ['Pre-tax withdrawals are grossed up',
      `Taking a dollar of spending out of a pre-tax account requires selling more than a dollar, because the withdrawal is ordinary income. The model divides by one minus ${fmtPct(v.pretaxTaxRate)} rather than treating the account as though it were tax-free.`],
    ['The living-expense baseline is load-bearing',
      `It does not only feed the spending line. It also sizes how much a job loss or disability actually costs in the simulation, since the shortfall is that baseline times the fraction of income lost. A baseline that drifts low quietly makes simulated career risk milder, not just the displayed expense smaller.`],
    ['A mortgage payment is inside living expenses, not added to them',
      `The balance is amortized to track equity, but the payment is never withdrawn a second time — it is already part of what life costs. At payoff the payment stops and total spending falls.`],
    ['Allocation changes in one step at retirement',
      `From ${fmtPct(v.equityPctPre, 0)} equity to ${fmtPct(v.equityPctPost, 0)}, on the retirement birthday, rather than gliding down gradually over the preceding years.`],
    ['Property is not simulated',
      `Its value follows the same deterministic path in every scenario. Including it in the fan chart therefore narrows the visible spread without adding any real certainty, which is why it can be switched off there.`],
    ['Everything is reported after tax, in today\'s dollars',
      `Pre-tax balances are shown discounted by the withdrawal rate and taxable balances net of embedded gains, so the headline figure is closer to what you could actually spend than a gross net-worth number would be.`],
    ['Taxes are blended effective rates, not brackets',
      `There is no bracket-by-bracket calculation, no standard deduction, no Roth conversion planning and no tax-loss harvesting. Each rate is a single average you supply, which is a fair simplification only if you derived it from your own expected income.`],
    ['Forced distributions are swept, not spent',
      `An RMD larger than what was already being withdrawn is taxed and moved into the taxable account rather than counted as consumption.`],
    [`Return figures are read as ${v.returnBasis === 'geometric' ? 'compound rates' : 'arithmetic averages'}`,
      v.returnBasis === 'geometric'
        ? `The deterministic ledger compounds at exactly the rate you entered, and the simulation is centred so the same rate is what a path actually earns over time. Published forward-looking capital market assumptions are usually quoted this way.`
        : `The simulation treats your input as the average of yearly returns, which is higher than the compound rate a volatile portfolio actually delivers — so the median simulated path will sit below the deterministic one by design.`],
  ];
  document.getElementById('structural-notes').innerHTML = `<div class="note-list">${notes.map(([title, text]) =>
    `<div class="note-item"><h3>${esc(title)}</h3><p>${text}</p></div>`).join('')}</div>`;
}

// Limitations: currently accepted simplifications. Several of them are toggles,
// so the text reports what is actually switched on rather than a fixed list.
function limitations() {
  const v = state.cfg.values;
  const out = [];

  out.push(v.returnModel === 'fatTail'
    ? ['Bad years still do not cluster', 'Fat tails are switched on, so single-year crashes are more severe than a normal distribution would produce. But draws remain independent from year to year, and real markets produce multi-year real-return droughts that independent draws almost never generate. Bootstrapping from actual historical sequences is the fuller fix.']
    : ['Independent lognormal returns understate tail risk', 'Real returns have fatter tails than this distribution and bad years cluster together. The fat-tailed option in the risk settings addresses the first half of that; nothing here addresses the clustering.']);

  out.push(v.coupleCareerToMarket
    ? ['Career and market risk are coupled crudely', `Job-loss probability is multiplied ${v.recessionJobLossMultiplier}× in years when returns fall below ${fmtPct(v.recessionReturnThreshold)}. That is a rough stand-in for a real correlation, not a calibrated estimate.`]
    : ['Career risk and market risk are drawn independently', 'Recessions cause market downturns and job losses at the same time. Drawing them independently understates how bad the genuinely bad scenarios get. There is a switch for this in the risk settings.']);

  out.push(v.ltcEnabled
    ? ['Long-term care uses one duration, not a distribution', `Every care event lasts ${v.ltcDurationYears} years at ${fmtMoney(v.ltcAnnualCost0)}. Real duration is heavily skewed, and it is the long stay that actually breaks a plan.`]
    : ['Long-term care is not modeled', 'Any allowance for it is buried inside the flat retirement spending figure. Care is low-probability, high-severity and escalates with age, which a flat annual add-on captures poorly. There is a switch for this in the risk settings.']);

  out.push(['Inflation is a single flat rate in every path', `Every path uses ${fmtPct(v.inflation)} in every year, so a stagflationary period — high inflation alongside poor real returns — is something this model cannot produce at all.`]);
  out.push(['Social Security is a fixed real benefit', `It is assumed to arrive in full, indexed to inflation, taxed at a flat ${fmtPct(v.ssTaxablePct * v.ssFederalRate)} blended rate. Provisional-income thresholds are not recomputed year by year, and no policy change is modeled.`]);
  out.push(['One return stream drives every invested account', 'Taxable, pre-tax and Roth balances all earn the same rate in the same year, so there is no rebalancing, no asset location strategy and no dispersion between accounts.']);
  out.push(['No bracket-level tax planning', 'Roth conversions, harvesting losses, filling a low bracket in early retirement, and ACA subsidy cliffs are all outside what blended effective rates can express.']);
  out.push(['Distribution periods come from one table', 'The IRS Uniform Lifetime Table is used throughout. The separate table that applies when a spouse is more than ten years younger and is the sole beneficiary is not implemented.']);
  out.push(['Spending is smooth apart from goals', 'Real retirement spending tends to fall through the go-go, slow-go and no-go years and then rise again with health costs. Here it is a flat real figure plus whatever goals you entered.']);
  return out;
}

function renderLimitations() {
  const all = limitations();
  const render = list => `<div class="note-list">${list.map(([title, text]) =>
    `<div class="note-item"><h3>${esc(title)}</h3><p>${text}</p></div>`).join('')}</div>`;
  document.getElementById('limitations-full').innerHTML = render(all);
  document.getElementById('limitations-short').innerHTML = render(all.slice(0, 3));
}

function renderUltTable() {
  const ages = Object.keys(UNIFORM_LIFETIME_TABLE).map(Number).sort((a, b) => a - b);
  const head = `<thead><tr><th>Age</th>${ages.map(a => `<th>${a}</th>`).join('')}</tr></thead>`;
  const body = `<tbody><tr><td>Distribution period</td>${ages.map(a =>
    `<td>${UNIFORM_LIFETIME_TABLE[a]}</td>`).join('')}</tr></tbody>`;
  document.getElementById('ult-table').innerHTML = head + body;
}

// ── Verify ──────────────────────────────────────────────────────────────────
function renderResearch() {
  const cfg = state.cfg;
  document.getElementById('research-list').innerHTML = RESEARCH_ITEMS.map(item => {
    const saved = cfg.research[item.id] || {};
    return `<div class="check-item${saved.done ? ' done' : ''}" data-id="${esc(item.id)}">
      <input type="checkbox" data-role="done"${saved.done ? ' checked' : ''}>
      <div>
        <h3>${esc(item.title)}${saved.done ? '' : '<span class="pill research">open</span>'}</h3>
        <p>${esc(item.detail)}</p>
        <div class="check-fields" data-role="chips"></div>
        <textarea rows="2" data-role="note" placeholder="What you found, and where. This becomes the note you will thank yourself for in six months.">${esc(saved.note || '')}</textarea>
      </div>
    </div>`;
  }).join('');
  renderResearchValues();
}

// The chips show what the model is currently using for each field the item
// covers, so the thing being checked is visible next to the instruction.
function renderResearchValues() {
  for (const el of document.querySelectorAll('.check-item')) {
    const item = RESEARCH_ITEMS.find(i => i.id === el.dataset.id);
    const chips = el.querySelector('[data-role="chips"]');
    if (!item || !chips) continue;
    chips.innerHTML = item.fields.map(key => {
      const f = FIELDS_BY_KEY[key];
      return f ? `<span class="field-chip">${esc(f.label)}: ${esc(fmtValue(f))}</span>` : '';
    }).join('');
  }
}

function onResearchEvent(event) {
  const el = event.target.closest('.check-item');
  if (!el) return;
  const id = el.dataset.id;
  const entry = state.cfg.research[id] || (state.cfg.research[id] = { done: false, note: '' });
  if (event.target.dataset.role === 'done') {
    entry.done = event.target.checked;
    el.classList.toggle('done', entry.done);
    const heading = el.querySelector('h3 .pill');
    if (entry.done && heading) heading.remove();
    else if (!entry.done && !heading) el.querySelector('h3').insertAdjacentHTML('beforeend', '<span class="pill research">open</span>');
    renderTabCounts();
    renderTodos();
  } else if (event.target.dataset.role === 'note') {
    entry.note = event.target.value;
  }
  persistSoon();
}

// ── Open items ──────────────────────────────────────────────────────────────
// Two sources: items the app can work out for itself from the state of the
// plan, and items you typed. The seeded ones disappear when the underlying
// thing is resolved, which is what keeps this list from becoming a graveyard.
function openItems() {
  const cfg = state.cfg;
  const v = cfg.values;
  const items = [];

  const placeholders = placeholderKeys(cfg);
  if (placeholders.length) {
    items.push({ seeded: true, text: `${placeholders.length} personal ${placeholders.length === 1 ? 'input is' : 'inputs are'} still an illustrative placeholder.`, done: false });
  }
  const unverifiedRows = countUnverifiedRows();
  if (unverifiedRows) {
    items.push({ seeded: true, text: `${unverifiedRows} income ${unverifiedRows === 1 ? 'stream or goal has' : 'streams or goals have'} not been checked against a real document.`, done: false });
  }
  for (const item of RESEARCH_ITEMS) {
    if (!(cfg.research[item.id] || {}).done) {
      items.push({ seeded: true, text: `Research: ${item.title.toLowerCase()}.`, done: false });
    }
  }
  const suggested = suggestedRmdAge(v.birthYear);
  if (suggested && suggested !== v.rmdStartAge) {
    items.push({ seeded: true, text: `RMDs are set to begin at ${v.rmdStartAge}, but current law suggests ${suggested} for a ${v.birthYear} birth year. Reconcile the two.`, done: false });
  }
  if (v.stateLocalGains === 0 && !(cfg.meta.stateLocalGains || {}).source) {
    items.push({ seeded: true, text: 'State and local capital gains tax is zero with no note explaining why. Confirm your state actually exempts gains rather than taxing them as ordinary income.', done: false });
  }
  if (v.livingExpenseMode === 'residual') {
    items.push({ seeded: true, text: 'Living expenses are a top-down residual. Compare it against a year of real spending data — it also sizes how badly a job loss hurts in the simulation.', done: false });
  }
  if (v.disabilityIncomePct === 0 && v.disabilityProb > 0) {
    items.push({ seeded: true, text: 'Disability is modeled as a total loss of income. Check what fraction of income your actual long-term disability coverage would replace.', done: false });
  }
  if (v.spousePretaxShare === 0 && v.filingStatus === 'mfj') {
    items.push({ seeded: true, text: 'Filing jointly with the entire pre-tax balance treated as one person\'s. If it is meaningfully split, set the spouse share so distributions are computed on each age separately.', done: false });
  }

  for (const todo of cfg.todos || []) items.push({ ...todo, seeded: false });
  return items;
}

function renderTodos() {
  const list = document.getElementById('todo-list');
  if (isTypingIn(list)) return;
  const items = openItems();
  if (!items.length) {
    list.innerHTML = '<p class="empty-state">Nothing open. Every placeholder is replaced and every research item is checked.</p>';
    return;
  }
  list.innerHTML = items.map((item, index) => {
    if (item.seeded) {
      return `<div class="todo-item">
        <span class="todo-text">${esc(item.text)} <span class="seeded">— raised automatically, and it will disappear when resolved</span></span>
      </div>`;
    }
    const todoIndex = (state.cfg.todos || []).findIndex(t => t.id === item.id);
    return `<div class="todo-item${item.done ? ' done' : ''}" data-id="${esc(item.id)}">
      <input type="checkbox" data-role="done"${item.done ? ' checked' : ''}>
      <span class="todo-text">${esc(item.text)}</span>
      <button class="btn-link danger" data-act="remove" data-index="${todoIndex}">Delete</button>
    </div>`;
  }).join('');
}

function onAddTodo() {
  const input = document.getElementById('todo-input');
  const text = input.value.trim();
  if (!text) return;
  state.cfg.todos.push({ id: newId('todo'), text, done: false });
  input.value = '';
  renderTodos();
  renderTabCounts();
  persistSoon();
}

function onTodoClick(event) {
  const row = event.target.closest('.todo-item');
  if (!row || !row.dataset.id) return;
  const todo = (state.cfg.todos || []).find(t => t.id === row.dataset.id);
  if (!todo) return;
  if (event.target.dataset.act === 'remove') {
    state.cfg.todos = state.cfg.todos.filter(t => t.id !== todo.id);
  } else if (event.target.dataset.role === 'done') {
    todo.done = event.target.checked;
  } else {
    return;
  }
  renderTodos();
  renderTabCounts();
  persistSoon();
}

// ── Scenarios ───────────────────────────────────────────────────────────────
function currentHeadline() {
  return {
    terminalReal: state.det.summary.terminalReal,
    atRetirementReal: state.det.summary.atRetirementReal,
    medianTerminal: state.mc.terminalPercentiles[50],
    probSuccess: state.mc.probSuccess,
    depletionAge: state.det.summary.depletionAge,
    retireAge: state.cfg.values.retireAge,
    retireSpend: state.cfg.values.retireSpend,
  };
}

function onSaveScenario() {
  const input = document.getElementById('scenario-name');
  const name = input.value.trim() || `${state.cfg.name || 'Plan'} — ${new Date().toLocaleDateString('en-US')}`;
  state.scenarios.unshift({
    id: newId('scn'),
    name,
    savedAt: new Date().toISOString(),
    cfg: clonePlain(state.cfg),
    headline: currentHeadline(),
  });
  saveScenarios(state.scenarios);
  input.value = '';
  renderScenarios();
}

function renderScenarios() {
  const live = currentHeadline();
  const head = `<div class="scenario head">
    <span>Scenario</span>
    <span class="num">At retirement</span>
    <span class="num">At the end</span>
    <span class="num">Median path</span>
    <span class="num">Never runs dry</span>
    <span></span>
  </div>`;

  const current = `<div class="scenario current">
    <span class="scenario-name">${esc(state.cfg.name || 'Current plan')}
      <span class="scenario-meta">live · retire at ${live.retireAge}, spending ${fmtShort(live.retireSpend)}</span></span>
    <span class="num">${esc(fmtShort(live.atRetirementReal))}</span>
    <span class="num">${esc(fmtShort(live.terminalReal))}</span>
    <span class="num">${esc(fmtShort(live.medianTerminal))}</span>
    <span class="num">${esc(fmtPct(live.probSuccess, 0))}</span>
    <span></span>
  </div>`;

  const saved = state.scenarios.map(scn => {
    const h = scn.headline;
    const delta = (a, b) => {
      const diff = a - b;
      if (Math.abs(diff) < 1) return '';
      return `<span class="delta ${diff > 0 ? 'down' : 'up'}">${esc(fmtSigned(-diff))} vs now</span>`;
    };
    return `<div class="scenario" data-id="${esc(scn.id)}">
      <span class="scenario-name">${esc(scn.name)}
        <span class="scenario-meta">saved ${new Date(scn.savedAt).toLocaleDateString('en-US')} · retire at ${h.retireAge}, spending ${fmtShort(h.retireSpend)}${h.depletionAge ? ` · ran dry at ${h.depletionAge}` : ''}</span></span>
      <span class="num">${esc(fmtShort(h.atRetirementReal))}</span>
      <span class="num">${esc(fmtShort(h.terminalReal))}<br>${delta(h.terminalReal, live.terminalReal)}</span>
      <span class="num">${esc(fmtShort(h.medianTerminal))}<br>${delta(h.medianTerminal, live.medianTerminal)}</span>
      <span class="num">${esc(fmtPct(h.probSuccess, 0))}</span>
      <span class="button-row">
        <button class="btn-link" data-act="load">Load</button>
        <button class="btn-link danger" data-act="delete">Delete</button>
      </span>
    </div>`;
  }).join('');

  document.getElementById('scenario-list').innerHTML = head + current + (saved ||
    '<div class="empty-state">No saved scenarios yet. Save the current plan, change one thing, and the difference shows up here.</div>');
}

function onScenarioClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button) return;
  const row = button.closest('.scenario');
  const scn = state.scenarios.find(s => s.id === row.dataset.id);
  if (!scn) return;

  if (button.dataset.act === 'delete') {
    if (!confirm(`Delete the scenario "${scn.name}"?`)) return;
    state.scenarios = state.scenarios.filter(s => s.id !== scn.id);
    saveScenarios(state.scenarios);
    renderScenarios();
    return;
  }
  if (button.dataset.act === 'load') {
    if (!confirm(`Load "${scn.name}" over the current plan? Save the current one first if you want to keep it.`)) return;
    state.cfg = mergeWithDefaults(scn.cfg);
    state.leverBase = leverSnapshot();
    renderStructural();
    update();
    showTab('overview');
  }
}

function clonePlain(obj) { return JSON.parse(JSON.stringify(obj)); }

document.addEventListener('DOMContentLoaded', init);
