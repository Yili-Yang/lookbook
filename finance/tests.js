/* tests.js — checks on the mechanics that are easy to get wrong.
 *
 * This is deliberately not a general unit-test suite. Each check below exists
 * because that specific mechanic is a known trap: a pre-tax withdrawal that
 * forgets it is taxable income, an RMD sized off the wrong balance, a Social
 * Security benefit counted gross where it should be net, a Monte Carlo layer
 * that quietly implements slightly different mechanics from the deterministic
 * ledger it is supposed to be a randomized version of.
 *
 * Run them in the browser by opening test.html, or headlessly with
 * `node run-tests.js`.
 */

const TESTS = [];
function test(name, fn) { TESTS.push({ name, fn }); }

function clone(obj) { return JSON.parse(JSON.stringify(obj)); }

// A config with every source of noise turned off, so a check is only exercising
// the one mechanic it names.
function quietConfig(overrides) {
  const cfg = defaultConfig();
  Object.assign(cfg.values, {
    startYear: 2026, startAge: 40, retireAge: 65, endAge: 90,
    inflation: 0, salaryGrowth: 0, contribGrowth: 0, saveSurplusPct: 0,
    equityReturn: 0, bondReturn: 0, cashReturn: 0, reAppreciation: 0,
    sigmaPre: 0, sigmaPost: 0,
    jobLossProb: 0, disabilityProb: 0, ltcEnabled: false,
    cash0: 0, bonds0: 0, taxableMix0: 0, pretax0: 0, roth0: 0, earmarked0: 0,
    reValue0: 0, mortgage0: 0, mortAnnualPayment: 0,
    ssAnnual: 0, retireSpend: 0, rmdStartAge: 999,
    contribPretax: 0, contribTaxableRecurring: 0,
    livingExpenseMode: 'explicit', livingExpenseExplicit: 0,
    nSims: 200,
  }, overrides || {});
  cfg.incomes = [];
  cfg.goals = [];
  return cfg;
}

function close(a, b, tol) {
  return Math.abs(a - b) <= (tol == null ? 0.01 : tol);
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'assertion failed');
}

function assertClose(actual, expected, tol, message) {
  if (!close(actual, expected, tol)) {
    throw new Error(`${message || 'value'}: expected ${expected}, got ${actual}`);
  }
}

// ── Withdrawal mechanics ────────────────────────────────────────────────────

test('pre-tax withdrawals are grossed up for tax', () => {
  const cfg = quietConfig({
    startAge: 65, retireAge: 65, endAge: 66,
    pretax0: 1000000, retireSpend: 100000, pretaxTaxRate: 0.3,
  });
  const row = runDeterministic(cfg).rows[0];
  assertClose(row.fromPretax, 100000 / 0.7, 1, 'gross pre-tax withdrawal');
  assertClose(row.fromPretax * (1 - 0.3), 100000, 1, 'after-tax proceeds cover the need');
  assert(row.shortfall === 0, 'no shortfall when the account can cover it');
});

test('withdrawals follow the waterfall and leave Roth for last', () => {
  const cfg = quietConfig({
    startAge: 65, retireAge: 65, endAge: 66,
    cash0: 10000, bonds0: 10000, taxableMix0: 10000, pretax0: 10000, roth0: 500000,
    retireSpend: 45000, pretaxTaxRate: 0.3,
  });
  const row = runDeterministic(cfg).rows[0];
  assertClose(row.fromCash, 10000, 1, 'cash drained first');
  assertClose(row.fromBonds, 10000, 1, 'then bonds');
  assertClose(row.fromTaxable, 10000, 1, 'then taxable');
  assertClose(row.fromPretax, 10000, 1, 'then pre-tax, to exhaustion');
  // 15,000 of need remains after the first three buckets, and the whole 10,000
  // pre-tax balance only yields 7,000 of it after tax.
  assertClose(row.fromRoth, 8000, 1, 'Roth covers only what is left');
  assert(row.roth > 0, 'Roth is not touched beyond the remaining need');
});

test('a need larger than the whole portfolio becomes visible debt', () => {
  const cfg = quietConfig({
    startAge: 65, retireAge: 65, endAge: 66, cash0: 1000, retireSpend: 50000,
  });
  const row = runDeterministic(cfg).rows[0];
  assert(row.shortfall > 0, 'shortfall is recorded');
  assert(row.taxable < 0, 'the gap is carried as a negative balance, not dropped');
});

// ── Required minimum distributions ──────────────────────────────────────────

test('RMDs are sized off the start-of-year balance, not the end', () => {
  const cfg = quietConfig({
    startAge: 75, retireAge: 65, endAge: 76, rmdStartAge: 75,
    pretax0: 1000000, equityReturn: 0.5, bondReturn: 0.5, equityPctPost: 1,
  });
  const row = runDeterministic(cfg).rows[0];
  // Using the post-growth balance would give 1,500,000 / 24.6 instead.
  assertClose(row.rmdRequired, 1000000 / UNIFORM_LIFETIME_TABLE[75], 1, 'RMD amount');
});

test('a forced RMD is swept to taxable net of tax, not spent', () => {
  const cfg = quietConfig({
    startAge: 75, retireAge: 65, endAge: 76, rmdStartAge: 75,
    pretax0: 1000000, pretaxTaxRate: 0.3, retireSpend: 0,
  });
  const row = runDeterministic(cfg).rows[0];
  assert(row.rmdForced > 0, 'a distribution is forced when nothing is being spent');
  assertClose(row.taxable, row.rmdForced * 0.7, 1, 'net proceeds land in taxable');
  assertClose(row.pretax, 1000000 - row.rmdForced, 1, 'pre-tax falls by the gross amount');
});

test('spending already covered by a withdrawal does not trigger an extra RMD', () => {
  const cfg = quietConfig({
    startAge: 75, retireAge: 65, endAge: 76, rmdStartAge: 75,
    pretax0: 1000000, pretaxTaxRate: 0.3, retireSpend: 200000,
  });
  const row = runDeterministic(cfg).rows[0];
  assert(row.fromPretax > row.rmdRequired, 'the voluntary withdrawal already exceeds the RMD');
  assertClose(row.rmdForced, 0, 0.01, 'nothing additional is forced out');
});

test('a spouse share splits the RMD across two ages', () => {
  const base = quietConfig({
    startAge: 75, retireAge: 65, endAge: 76, rmdStartAge: 75, pretax0: 1000000,
    spouseAge: 60, spouseBirthYear: 1966,
  });
  const single = runDeterministic(base).rows[0].rmdRequired;
  const split = clone(base);
  split.values.spousePretaxShare = 0.5;
  const splitRmd = runDeterministic(split).rows[0].rmdRequired;
  assertClose(splitRmd, single * 0.5, 1, 'only the older spouse share is distributable yet');
  assert(splitRmd < single, 'a younger spouse reduces the combined distribution');
});

// ── Social Security ─────────────────────────────────────────────────────────

test('Social Security offsets spending on an after-tax basis', () => {
  const cfg = quietConfig({
    startAge: 70, retireAge: 65, endAge: 71,
    ssAnnual: 40000, ssStartAge: 67, ssTaxablePct: 0.85, ssFederalRate: 0.22,
    retireSpend: 100000, cash0: 1000000,
  });
  const row = runDeterministic(cfg).rows[0];
  const net = 40000 * (1 - 0.85 * 0.22);
  assertClose(row.ssNet, net, 1, 'net benefit');
  assertClose(row.need, 100000 - net, 1, 'the portfolio funds spending net of the after-tax benefit');
  assert(row.need > 100000 - 40000, 'using the gross benefit would understate the withdrawal');
});

test('Social Security received while still working is saved, not lost', () => {
  const cfg = quietConfig({
    startAge: 67, retireAge: 70, endAge: 68,
    ssAnnual: 40000, ssStartAge: 67, livingExpenseExplicit: 50000,
  });
  cfg.incomes = [{ id: 'i', name: 'Salary', amount: 100000, basis: 'net', growth: 0, startYear: null, endYear: null }];
  const row = runDeterministic(cfg).rows[0];
  assertClose(row.ssSurplus, row.ssNet, 1, 'the whole benefit is surplus when pay covers life');
  assert(row.taxableContrib >= row.ssNet, 'the surplus reaches the taxable account');
});

test('Social Security covers a paycheck gap before anything is saved', () => {
  const cfg = quietConfig({
    startAge: 67, retireAge: 70, endAge: 68,
    ssAnnual: 40000, ssStartAge: 67, ssTaxablePct: 0, livingExpenseExplicit: 120000,
  });
  cfg.incomes = [{ id: 'i', name: 'Salary', amount: 100000, basis: 'net', growth: 0, startYear: null, endYear: null }];
  const row = runDeterministic(cfg).rows[0];
  assertClose(row.ssApplied, 20000, 1, 'benefit fills the gap');
  assertClose(row.deficit, 0, 1, 'no portfolio withdrawal is needed');
  assertClose(row.ssSurplus, 20000, 1, 'only the remainder is saved');
});

// ── Spending baseline and the double-counting trap ──────────────────────────

test('the residual baseline equals take-home minus the savings transfer', () => {
  const cfg = quietConfig({
    livingExpenseMode: 'residual', contribTaxableRecurring: 6000, effectiveTax: 0.3,
  });
  cfg.incomes = [{ id: 'i', name: 'Salary', amount: 100000, basis: 'gross', growth: 0, startYear: null, endYear: null }];
  const out = runDeterministic(cfg);
  assertClose(out.derived.takeHome0, 70000, 1, 'take-home');
  assertClose(out.derived.baseLivingExp, 64000, 1, 'residual baseline');
  assertClose(out.rows[0].deficit, 0, 1, 'by construction the residual leaves no gap in year 0');
});

test('a mortgage payment inside the baseline is not withdrawn a second time', () => {
  const cfg = quietConfig({
    livingExpenseMode: 'explicit', livingExpenseExplicit: 60000,
    mortgage0: 100000, mortAnnualPayment: 24000, mortRate: 0,
    cash0: 500000, endAge: 45,
  });
  cfg.incomes = [{ id: 'i', name: 'Salary', amount: 60000, basis: 'net', growth: 0, startYear: null, endYear: null }];
  const rows = runDeterministic(cfg).rows;
  assertClose(rows[0].livingExp, 60000, 1, 'spending is the baseline, not baseline plus mortgage');
  assertClose(rows[0].need, 0, 1, 'nothing is drawn from the portfolio while pay covers life');
});

test('at payoff the mortgage component drops to zero and the rest keeps inflating', () => {
  const cfg = quietConfig({
    livingExpenseMode: 'explicit', livingExpenseExplicit: 60000, inflation: 0.02,
    mortgage0: 48000, mortAnnualPayment: 24000, mortRate: 0, endAge: 45,
  });
  cfg.incomes = [{ id: 'i', name: 'Salary', amount: 200000, basis: 'net', growth: 0, startYear: null, endYear: null }];
  const rows = runDeterministic(cfg).rows;
  const permanent = 60000 - 24000;
  assertClose(rows[0].livingExp, permanent * 1 + 24000, 1, 'year 0 includes the payment at face value');
  assertClose(rows[1].livingExp, permanent * 1.02 + 24000, 1, 'the permanent part inflates, the payment does not');
  assertClose(rows[2].livingExp, permanent * Math.pow(1.02, 2), 1, 'after payoff the payment is gone entirely');
  assert(rows[2].livingExp < rows[1].livingExp, 'spending actually falls at payoff');
});

// ── Goals ───────────────────────────────────────────────────────────────────

test('goal costs inflate at their own rate and are drawn while still working', () => {
  const cfg = quietConfig({ inflation: 0.02, cash0: 500000, endAge: 45 });
  cfg.goals = [{ id: 'g', name: 'Tuition', startYear: 2028, endYear: 2029, cost0: 50000, inflation: 0.05, discretionary: false, bucket: 'general' }];
  const rows = runDeterministic(cfg).rows;
  assertClose(rows[2].goalCost, 50000 * Math.pow(1.05, 2), 1, 'own inflation rate, not the general one');
  assertClose(rows[2].need, rows[2].goalCost, 1, 'funded from the portfolio during working years');
  assertClose(rows[4].goalCost, 0, 0.01, 'the cost stops when the goal ends');
});

test('earmarked goals draw from the earmarked account first', () => {
  const cfg = quietConfig({ earmarked0: 30000, cash0: 500000, endAge: 42 });
  cfg.goals = [{ id: 'g', name: 'Tuition', startYear: 2026, endYear: null, cost0: 50000, inflation: 0, discretionary: false, bucket: 'earmarked' }];
  const row = runDeterministic(cfg).rows[0];
  assertClose(row.fromEarmarked, 30000, 1, 'the earmarked account is spent first');
  assertClose(row.fromCash, 20000, 1, 'only the gap falls to the general waterfall');
});

// ── Reporting basis ─────────────────────────────────────────────────────────

test("today's-dollars figures are the nominal ones divided by the deflator", () => {
  const cfg = quietConfig({ inflation: 0.03, cash0: 100000, cashReturn: 0.03, endAge: 50 });
  const rows = runDeterministic(cfg).rows;
  for (const row of rows) {
    assertClose(row.deflator, Math.pow(1.03, row.t), 1e-9, 'deflator');
    assertClose(row.netWorthAfterTaxReal, row.netWorthAfterTax / row.deflator, 0.01, 'real net worth');
  }
  // Each row holds the end-of-year balance but is deflated by that year's
  // start-of-year deflator, so a bucket earning exactly inflation sits one
  // year's growth above its starting balance — and then stays there, which is
  // the property that matters.
  assertClose(rows[rows.length - 1].liquidReal, rows[0].liquidReal, 0.01, 'real value is flat over time');
  assertClose(rows[0].liquidReal, 100000 * 1.03, 1, 'end-of-year basis in start-of-year dollars');
});

test('after-tax net worth discounts pre-tax balances and embedded gains', () => {
  const cfg = quietConfig({
    cash0: 100000, pretax0: 100000, taxableMix0: 100000, endAge: 41,
    pretaxTaxRate: 0.3, taxableGainPct: 0.5, ltcgFederal: 0.2, stateLocalGains: 0.05,
  });
  const row = runDeterministic(cfg).rows[0];
  const expected = 100000 + (100000 - 100000 * 0.5 * 0.25) + 100000 * 0.7;
  assertClose(row.netWorthAfterTax, expected, 1, 'after-tax net worth');
  assert(row.netWorthAfterTax < row.netWorth, 'the after-tax figure is the more honest one');
});

// ── Monte Carlo ─────────────────────────────────────────────────────────────

test('the same seed reproduces the same paths, a different seed does not', () => {
  const cfg = quietConfig({ cash0: 200000, taxableMix0: 500000, sigmaPre: 0.17, equityReturn: 0.07, retireSpend: 40000 });
  const a = runMonteCarlo(cfg).terminalPercentiles[50];
  const b = runMonteCarlo(clone(cfg)).terminalPercentiles[50];
  assertClose(a, b, 1e-6, 'identical inputs give identical output');
  const other = clone(cfg);
  other.values.seed = 43;
  assert(!close(runMonteCarlo(other).terminalPercentiles[50], a, 1), 'a new seed reshuffles the draws');
});

test('with no volatility and no career risk, Monte Carlo matches the ledger', () => {
  // The strongest check available: the two code paths are supposed to
  // implement the same mechanics, so with all randomness removed they must
  // agree. Any divergence means one of them has drifted.
  const cfg = quietConfig({
    startAge: 45, retireAge: 60, endAge: 85,
    equityReturn: 0.06, bondReturn: 0.04, cashReturn: 0.02, inflation: 0.025,
    salaryGrowth: 0.03, contribGrowth: 0.025, saveSurplusPct: 0.5,
    cash0: 50000, bonds0: 40000, taxableMix0: 300000, pretax0: 400000, roth0: 80000,
    earmarked0: 20000, contribPretax: 20000, contribTaxableRecurring: 12000,
    livingExpenseMode: 'residual', retireSpend: 90000,
    ssAnnual: 30000, ssStartAge: 67, rmdStartAge: 75,
    reValue0: 500000, mortgage0: 200000, mortAnnualPayment: 24000, mortRate: 0.04,
    sigmaPre: 0, sigmaPost: 0, nSims: 20,
  });
  cfg.incomes = [{ id: 'i', name: 'Salary', amount: 180000, basis: 'gross', growth: null, startYear: null, endYear: null }];
  cfg.goals = [
    { id: 'g1', name: 'Committed', startYear: 2030, endYear: 2033, cost0: 25000, inflation: 0.05, discretionary: false, bucket: 'general' },
    { id: 'g2', name: 'Discretionary', startYear: 2040, endYear: null, cost0: 60000, inflation: 0.03, discretionary: true, bucket: 'general' },
    { id: 'g3', name: 'Earmarked', startYear: 2036, endYear: 2039, cost0: 30000, inflation: 0.05, discretionary: false, bucket: 'earmarked' },
  ];
  const det = runDeterministic(cfg);
  const mc = runMonteCarlo(cfg, det);
  const detTerminal = det.summary.terminalReal;
  const mcTerminal = mc.terminalPercentiles[50];
  const tol = Math.max(1, Math.abs(detTerminal) * 1e-6);
  assertClose(mcTerminal, detTerminal, tol, 'zero-volatility Monte Carlo vs deterministic terminal');
  for (let t = 0; t < mc.nYears; t++) {
    assertClose(mc.bands.total[50][t], det.rows[t].netWorthAfterTaxReal, Math.max(1, Math.abs(det.rows[t].netWorthAfterTaxReal) * 1e-6), `year ${mc.years[t]} median`);
  }
});

test('percentile bands are ordered in every year', () => {
  const cfg = quietConfig({
    startAge: 40, retireAge: 65, endAge: 95, equityReturn: 0.07, bondReturn: 0.04,
    sigmaPre: 0.18, sigmaPost: 0.1, cash0: 50000, taxableMix0: 300000, pretax0: 300000,
    retireSpend: 70000, nSims: 400,
  });
  cfg.incomes = [{ id: 'i', name: 'Salary', amount: 150000, basis: 'gross', growth: null, startYear: null, endYear: null }];
  const mc = runMonteCarlo(cfg);
  for (let t = 0; t < mc.nYears; t++) {
    const b = mc.bands.total;
    assert(b[5][t] <= b[25][t] + 1e-6 && b[25][t] <= b[50][t] + 1e-6
      && b[50][t] <= b[75][t] + 1e-6 && b[75][t] <= b[95][t] + 1e-6, `bands out of order in ${mc.years[t]}`);
  }
});

test('career risk makes outcomes worse, and coupling it to markets makes them worse still', () => {
  const base = quietConfig({
    startAge: 40, retireAge: 65, endAge: 90, equityReturn: 0.07, bondReturn: 0.04,
    sigmaPre: 0.18, sigmaPost: 0.1, cash0: 50000, taxableMix0: 200000, pretax0: 200000,
    contribPretax: 20000, contribTaxableRecurring: 10000, retireSpend: 90000,
    livingExpenseMode: 'residual', nSims: 800,
  });
  base.incomes = [{ id: 'i', name: 'Salary', amount: 160000, basis: 'gross', growth: null, startYear: null, endYear: null }];
  const noRisk = runMonteCarlo(base).terminalPercentiles[10];

  const withRisk = clone(base);
  Object.assign(withRisk.values, { jobLossProb: 0.05, jobLossIncomePct: 0.25, disabilityProb: 0.01 });
  const risky = runMonteCarlo(withRisk).terminalPercentiles[10];
  assert(risky < noRisk, 'adding career risk lowers the downside percentile');

  const coupled = clone(withRisk);
  coupled.values.coupleCareerToMarket = true;
  const coupledOut = runMonteCarlo(coupled).terminalPercentiles[10];
  assert(coupledOut <= risky, 'correlating job loss with bad markets is not free');
});

test('fat tails widen the tails without changing the volatility assumption', () => {
  const base = quietConfig({
    startAge: 40, retireAge: 65, endAge: 90, equityReturn: 0.07, bondReturn: 0.04,
    sigmaPre: 0.18, sigmaPost: 0.12, cash0: 50000, taxableMix0: 400000, pretax0: 300000,
    contribPretax: 20000, retireSpend: 80000, livingExpenseMode: 'residual', nSims: 3000,
  });
  base.incomes = [{ id: 'i', name: 'Salary', amount: 150000, basis: 'gross', growth: null, startYear: null, endYear: null }];
  const normal = runMonteCarlo(base);
  const fat = clone(base);
  fat.values.returnModel = 'fatTail';
  const fatOut = runMonteCarlo(fat);
  assert(fatOut.terminalPercentiles[5] < normal.terminalPercentiles[5], 'the bad tail gets worse');
  const spreadNormal = normal.terminalPercentiles[75] - normal.terminalPercentiles[25];
  const spreadFat = fatOut.terminalPercentiles[75] - fatOut.terminalPercentiles[25];
  assert(spreadFat < spreadNormal * 1.2, 'the middle of the distribution is not blown up too');
});

test('the return basis shifts the median path, and only when there is volatility', () => {
  const base = quietConfig({
    startAge: 40, retireAge: 65, endAge: 90, equityReturn: 0.07, bondReturn: 0.04,
    sigmaPre: 0.18, sigmaPost: 0.12, cash0: 50000, taxableMix0: 400000, pretax0: 300000,
    contribPretax: 20000, retireSpend: 80000, livingExpenseMode: 'residual', nSims: 2000,
  });
  base.incomes = [{ id: 'i', name: 'Salary', amount: 150000, basis: 'gross', growth: null, startYear: null, endYear: null }];
  const geometric = runMonteCarlo(base).terminalPercentiles[50];
  const arithmetic = clone(base);
  arithmetic.values.returnBasis = 'arithmetic';
  assert(runMonteCarlo(arithmetic).terminalPercentiles[50] < geometric,
    'reading the input as an average of yearly returns lowers the compound rate, and so the median');

  const flatGeo = clone(base);
  Object.assign(flatGeo.values, { sigmaPre: 0, sigmaPost: 0 });
  const flatArith = clone(flatGeo);
  flatArith.values.returnBasis = 'arithmetic';
  assertClose(runMonteCarlo(flatArith).terminalPercentiles[50], runMonteCarlo(flatGeo).terminalPercentiles[50],
    1, 'with no volatility the two conventions are the same thing');
});

test('a spending floor prevents debt that an inflexible plan would incur', () => {
  const base = quietConfig({
    startAge: 60, retireAge: 62, endAge: 95, equityReturn: 0.05, bondReturn: 0.03,
    sigmaPre: 0.18, sigmaPost: 0.14, cash0: 40000, taxableMix0: 250000, pretax0: 250000,
    retireSpend: 90000, livingExpenseMode: 'explicit', livingExpenseExplicit: 90000,
    minSpendPct: 1, nSims: 1000,
  });
  base.incomes = [{ id: 'i', name: 'Salary', amount: 120000, basis: 'net', growth: 0, startYear: null, endYear: null }];
  const rigid = runMonteCarlo(base);
  const flexible = clone(base);
  flexible.values.minSpendPct = 0.6;
  const flex = runMonteCarlo(flexible);
  assert(flex.probEverInDebt <= rigid.probEverInDebt, 'flexibility cannot increase the debt probability');
  assert(flex.probEverCutSpending >= rigid.probEverCutSpending, 'flexibility shows up as cut spending instead');
});

test('long-term care events only fire after the age they can start', () => {
  const cfg = quietConfig({
    startAge: 60, retireAge: 62, endAge: 95, equityReturn: 0.05, bondReturn: 0.04,
    cash0: 100000, taxableMix0: 600000, pretax0: 600000, retireSpend: 60000,
    livingExpenseMode: 'explicit', livingExpenseExplicit: 60000,
    ltcEnabled: true, ltcStartAge: 85, ltcAnnualProb: 0.5, ltcDurationYears: 3,
    ltcAnnualCost0: 150000, nSims: 500,
  });
  cfg.incomes = [{ id: 'i', name: 'Salary', amount: 100000, basis: 'net', growth: 0, startYear: null, endYear: null }];
  const withLtc = runMonteCarlo(cfg);
  const without = clone(cfg);
  without.values.ltcEnabled = false;
  const base = runMonteCarlo(without);
  assert(withLtc.probLtc > 0.5, 'events do occur at a 50% annual hazard');
  assert(withLtc.terminalPercentiles[50] < base.terminalPercentiles[50], 'care costs money');
  const ageIndex = cfg.values.ltcStartAge - cfg.values.startAge - 1;
  assertClose(withLtc.bands.total[50][ageIndex], base.bands.total[50][ageIndex],
    Math.max(1, Math.abs(base.bands.total[50][ageIndex]) * 1e-6), 'no effect before the start age');
});

// ── The load-bearing residual ───────────────────────────────────────────────

test('the living-expense residual also sizes career-disruption severity', () => {
  // Worth a check of its own: this figure looks like a display number, but it
  // sets the dollar magnitude of the job-loss shortfall in the Monte Carlo
  // layer too. If it drifts low, simulated career risk gets quietly milder.
  const base = quietConfig({
    startAge: 40, retireAge: 65, endAge: 90, equityReturn: 0.06, bondReturn: 0.04,
    sigmaPre: 0.15, sigmaPost: 0.1, cash0: 50000, taxableMix0: 200000, pretax0: 200000,
    contribPretax: 15000, retireSpend: 60000, jobLossProb: 0.15, jobLossIncomePct: 0,
    livingExpenseMode: 'explicit', livingExpenseExplicit: 60000, nSims: 1500,
  });
  base.incomes = [{ id: 'i', name: 'Salary', amount: 150000, basis: 'net', growth: 0, startYear: null, endYear: null }];
  const modest = runMonteCarlo(base).terminalPercentiles[10];
  const larger = clone(base);
  larger.values.livingExpenseExplicit = 120000;
  const larger10 = runMonteCarlo(larger).terminalPercentiles[10];
  assert(larger10 < modest, 'a bigger baseline makes a job loss cost more, not just display differently');
});

// ── Runner ──────────────────────────────────────────────────────────────────
function runAllTests() {
  const results = [];
  for (const { name, fn } of TESTS) {
    try {
      fn();
      results.push({ name, pass: true });
    } catch (err) {
      results.push({ name, pass: false, error: err.message });
    }
  }
  return results;
}
