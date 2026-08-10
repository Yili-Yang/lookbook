/* model.js — the projection engine.
 *
 * Two passes over the same mechanics:
 *   runDeterministic  one path, point-estimate assumptions, full year-by-year ledger
 *   runMonteCarlo     thousands of randomized paths, percentile outcomes
 *
 * There are no figures in this file. Every number comes from the config object.
 * If you find yourself wanting to type a dollar amount or a rate here, it
 * belongs in config.js instead.
 */

// ── Seeded random draws ─────────────────────────────────────────────────────
// Seeded so that the same inputs always produce the same paths: a change in
// the output is then always a change you made, never a reshuffle of the dice.
function makeRng(seed) {
  let a = (seed | 0) >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNormal(rng) {
  let spare = null;
  return function normal() {
    if (spare !== null) { const s = spare; spare = null; return s; }
    let u = 0, v = 0, s = 0;
    do {
      u = rng() * 2 - 1;
      v = rng() * 2 - 1;
      s = u * u + v * v;
    } while (s === 0 || s >= 1);
    const f = Math.sqrt(-2 * Math.log(s) / s);
    spare = v * f;
    return u * f;
  };
}

// Marsaglia-Tsang gamma, used only to build chi-square draws for the
// fat-tailed return option.
function makeGamma(rng, normal) {
  return function gamma(shape) {
    if (shape < 1) return gamma(shape + 1) * Math.pow(rng(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / (3 * Math.sqrt(d));
    for (;;) {
      const x = normal();
      let v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v;
      const u = rng();
      const xx = x * x;
      if (u < 1 - 0.0331 * xx * xx) return d * v;
      if (Math.log(u) < 0.5 * xx + d * (1 - v + Math.log(v))) return d * v;
    }
  };
}

// A unit-variance draw: either standard normal, or a Student-t rescaled to
// unit variance so that the volatility you specified still means what it says
// while the tails get fatter.
function makeShockDraw(cfg, rng, normal) {
  if (cfg.values.returnModel !== 'fatTail') return normal;
  const df = Math.min(100, Math.max(3, cfg.values.tDf || 5));
  const gamma = makeGamma(rng, normal);
  const rescale = Math.sqrt(df / (df - 2));
  return function shock() {
    const chi2 = 2 * gamma(df / 2);
    return (normal() / Math.sqrt(chi2 / df)) / rescale;
  };
}

// ── Derived assumptions ─────────────────────────────────────────────────────
// Everything the ledger needs that is computed from config rather than entered.
function derive(cfg) {
  const v = cfg.values;
  const nYears = Math.max(1, v.endAge - v.startAge + 1);
  const retireYear = v.startYear + (v.retireAge - v.startAge);

  const returnPre = v.equityPctPre * v.equityReturn + (1 - v.equityPctPre) * v.bondReturn;
  const returnPost = v.equityPctPost * v.equityReturn + (1 - v.equityPctPost) * v.bondReturn;
  const ltcgRate = v.ltcgFederal + v.stateLocalGains;

  const takeHome0 = takeHomeInYear(cfg, v.startYear);

  // The living-expense baseline. In residual mode it is whatever take-home pay
  // is left after the explicit savings transfer — a top-down figure that
  // implicitly already covers today's actual bills, mortgage payment included.
  // That is exactly why it must never be double-counted by also adding a
  // withdrawal for a bill it already contains.
  const baseLivingExp = v.livingExpenseMode === 'explicit'
    ? v.livingExpenseExplicit
    : Math.max(0, takeHome0 - v.contribTaxableRecurring);

  // The mortgage payment is a component of that baseline that behaves
  // differently from the rest of it: fixed in nominal dollars, and it stops
  // entirely at payoff. So it is separated out and tracked on its own terms
  // rather than being inflated forever along with everything else.
  const mortPayment = v.mortgage0 > 0 ? Math.min(v.mortAnnualPayment, baseLivingExp) : 0;
  const livingExpExMortgage = Math.max(0, baseLivingExp - mortPayment);

  return {
    nYears, retireYear, returnPre, returnPost, ltcgRate,
    takeHome0, baseLivingExp, mortPayment, livingExpExMortgage,
    savingsRate0: takeHome0 > 0 ? (v.contribTaxableRecurring + v.contribPretax) / (takeHome0 + v.contribPretax) : 0,
  };
}

// ── Income streams ──────────────────────────────────────────────────────────
// Amounts are entered in today's dollars and grown from the current year, so a
// stream that starts later still arrives having grown at its own rate. Streams
// with no explicit end year stop when earned income stops at retirement;
// a pension or annuity meant to continue should be given an explicit end year.
function streamAmount(cfg, stream, year) {
  const v = cfg.values;
  const retireYear = v.startYear + (v.retireAge - v.startAge);
  const from = stream.startYear == null ? v.startYear : stream.startYear;
  const to = stream.endYear == null ? retireYear - 1 : stream.endYear;
  if (year < from || year > to) return 0;
  const growth = stream.growth == null ? v.salaryGrowth : stream.growth;
  const t = year - v.startYear;
  return (stream.amount || 0) * Math.pow(1 + growth, t);
}

function takeHomeInYear(cfg, year) {
  const effTax = cfg.values.effectiveTax;
  let total = 0;
  for (const s of cfg.incomes || []) {
    const gross = streamAmount(cfg, s, year);
    total += s.basis === 'net' ? gross : gross * (1 - effTax);
  }
  return total;
}

function grossInYear(cfg, year) {
  let total = 0;
  for (const s of cfg.incomes || []) {
    const amt = streamAmount(cfg, s, year);
    total += s.basis === 'net' ? amt / Math.max(0.01, 1 - cfg.values.effectiveTax) : amt;
  }
  return total;
}

// ── Goals ───────────────────────────────────────────────────────────────────
// Costs are entered in today's dollars with their own inflation rate, since
// education and healthcare routinely run hotter than general inflation. A goal
// with an end year repeats every year in the range, which is how a temporary
// recurring expense should be modeled: it drops to zero when it ends, and the
// permanent part of the same bill stays where it belongs, inside the
// living-expense baseline.
function goalCosts(cfg, year) {
  const t = year - cfg.values.startYear;
  let discretionary = 0, committed = 0, earmarked = 0;
  for (const g of cfg.goals || []) {
    const from = g.startYear;
    const to = g.endYear == null ? g.startYear : g.endYear;
    if (year < from || year > to) continue;
    const inflation = g.inflation == null ? cfg.values.inflation : g.inflation;
    const cost = (g.cost0 || 0) * Math.pow(1 + inflation, t);
    if (g.bucket === 'earmarked') earmarked += cost;
    else if (g.discretionary) discretionary += cost;
    else committed += cost;
  }
  return { discretionary, committed, earmarked, total: discretionary + committed + earmarked };
}

// ── Required minimum distributions ──────────────────────────────────────────
// Sized off the balance at the start of the year, divided by the distribution
// period for that age. Distributions apply per person on their own age and
// their own share of the balance, which is why a spouse share splits the
// calculation in two rather than keying everything off one age.
function distributionPeriod(age) {
  const table = UNIFORM_LIFETIME_TABLE;
  const ages = Object.keys(table).map(Number);
  const maxAge = Math.max(...ages);
  if (age > maxAge) return table[maxAge];
  return table[age] || null;
}

function requiredDistribution(cfg, pretaxBoy, age, spouseAge) {
  const v = cfg.values;
  if (pretaxBoy <= 0) return 0;
  const share = Math.min(1, Math.max(0, v.spousePretaxShare || 0));
  let rmd = 0;
  if (age >= v.rmdStartAge) {
    const period = distributionPeriod(age);
    if (period) rmd += (pretaxBoy * (1 - share)) / period;
  }
  if (share > 0 && spouseAge >= v.rmdStartAge) {
    const period = distributionPeriod(spouseAge);
    if (period) rmd += (pretaxBoy * share) / period;
  }
  return rmd;
}

// ── Withdrawal waterfall ────────────────────────────────────────────────────
// Cash first, then bonds, then taxable brokerage, then pre-tax, and Roth only
// as a last resort — tax-free growth is the most valuable thing in the stack,
// so it is preserved the longest. One consequence worth stating plainly: a real
// household in trouble would very likely tap Roth before draining everything
// else, so this ordering makes the worst paths look slightly worse than they
// would really be.
//
// Pre-tax withdrawals are taxable income, so the gross withdrawal is grossed up
// to leave the needed amount after tax. Taking the need dollar-for-dollar out
// of a pre-tax account would quietly treat it as a tax-free account.
function drawDown(state, need, pretaxTaxRate) {
  const out = { fromCash: 0, fromBonds: 0, fromTaxable: 0, fromPretax: 0, fromRoth: 0, tax: 0, shortfall: 0 };
  let remaining = need;
  if (remaining <= 0) return out;

  out.fromCash = Math.min(Math.max(0, state.cash), remaining);
  state.cash -= out.fromCash;
  remaining -= out.fromCash;

  out.fromBonds = Math.min(Math.max(0, state.bonds), remaining);
  state.bonds -= out.fromBonds;
  remaining -= out.fromBonds;

  out.fromTaxable = Math.min(Math.max(0, state.taxable), remaining);
  state.taxable -= out.fromTaxable;
  remaining -= out.fromTaxable;

  if (remaining > 0 && state.pretax > 0) {
    const grossNeeded = remaining / Math.max(0.01, 1 - pretaxTaxRate);
    out.fromPretax = Math.min(state.pretax, grossNeeded);
    state.pretax -= out.fromPretax;
    out.tax += out.fromPretax * pretaxTaxRate;
    remaining -= out.fromPretax * (1 - pretaxTaxRate);
  }

  if (remaining > 0 && state.roth > 0) {
    out.fromRoth = Math.min(state.roth, remaining);
    state.roth -= out.fromRoth;
    remaining -= out.fromRoth;
  }

  if (remaining > 0) {
    // Nothing left to sell: the gap becomes debt, carried as a negative
    // taxable balance so it stays visible instead of silently disappearing.
    out.shortfall = remaining;
    state.taxable -= remaining;
  }
  return out;
}

// A bucket's after-tax value is what you would keep if you liquidated it: the
// taxable account net of the gains embedded in it, the pre-tax account net of
// the ordinary-income rate. Charts stack these rather than the raw balances, so
// the discount lives here once instead of being restated by every caller.
function afterTaxParts(state, cfg, d) {
  const v = cfg.values;
  const embeddedGainsTax = Math.max(0, state.taxable) * v.taxableGainPct * d.ltcgRate;
  return {
    taxable: state.taxable - embeddedGainsTax,
    pretax: state.pretax * (1 - v.pretaxTaxRate),
    embeddedGainsTax,
  };
}

function afterTaxNetWorth(state, cfg, d, houseEquity) {
  const parts = afterTaxParts(state, cfg, d);
  return state.cash + state.bonds + parts.taxable
    + parts.pretax + state.roth + state.earmarked + houseEquity;
}

// ── Deterministic ledger ────────────────────────────────────────────────────
function runDeterministic(cfg) {
  const v = cfg.values;
  const d = derive(cfg);
  const rows = [];
  const warnings = [];

  const state = {
    cash: +v.cash0, bonds: +v.bonds0, taxable: +v.taxableMix0,
    pretax: +v.pretax0, roth: +v.roth0, earmarked: +v.earmarked0,
  };
  let mortBal = +v.mortgage0;
  let reValue = +v.reValue0;

  for (let t = 0; t < d.nYears; t++) {
    const year = v.startYear + t;
    const age = v.startAge + t;
    const spouseAge = (v.spouseAge || 0) + t;
    const retired = age >= v.retireAge;
    const r = retired ? d.returnPost : d.returnPre;
    const inf = Math.pow(1 + v.inflation, t);
    const pretaxBoy = state.pretax;

    // ── Income ──
    const takeHome = takeHomeInYear(cfg, year);
    const gross = grossInYear(cfg, year);
    const ssGross = age >= v.ssStartAge ? v.ssAnnual * inf : 0;
    // Only the after-tax benefit offsets spending; using the gross benefit
    // would overstate what it actually covers.
    const ssNet = ssGross * (1 - v.ssTaxablePct * v.ssFederalRate);
    const ssTax = ssGross - ssNet;

    // ── Spending ──
    const mortDue = mortBal > 0 ? d.mortPayment : 0;
    const livingExp = retired
      ? v.retireSpend * inf
      : d.livingExpExMortgage * inf + mortDue;
    const goals = goalCosts(cfg, year);

    // ── Contributions ──
    const contribScale = Math.pow(1 + v.contribGrowth, t);
    const pretaxContrib = retired ? 0 : v.contribPretax * contribScale;
    const transfer = retired ? 0 : v.contribTaxableRecurring * contribScale;

    // Cash flow from the paycheck alone, before Social Security and before the
    // portfolio is touched. A surplus is consumed unless you have said you
    // would save part of it; a deficit has to be funded by selling something.
    const payCashFlow = retired ? 0 : takeHome - livingExp - transfer;
    const savedSurplus = retired ? 0 : Math.max(0, payCashFlow) * v.saveSurplusPct;

    // Social Security arriving while still working covers any paycheck gap
    // first, and whatever is left is pure surplus that gets saved. It is added
    // outside the floor applied to the savings transfer, so an unrelated
    // negative surplus in some other year can never zero out real income.
    const gapBeforeSs = retired ? 0 : Math.max(0, -payCashFlow);
    const ssAvailable = retired ? 0 : (age >= v.ssStartAge ? ssNet : 0);
    const ssApplied = Math.min(ssAvailable, gapBeforeSs);
    const ssSurplus = ssAvailable - ssApplied;
    const deficit = gapBeforeSs - ssApplied;
    const taxableContrib = retired ? 0 : Math.max(0, transfer + savedSurplus) + ssSurplus;

    // ── Growth, then contributions ──
    state.cash *= (1 + v.cashReturn);
    state.bonds *= (1 + v.bondReturn);
    state.taxable *= (1 + r);
    state.pretax *= (1 + r);
    state.roth *= (1 + r);
    state.earmarked *= (1 + r);
    state.pretax += pretaxContrib;
    state.taxable += taxableContrib;

    // ── Earmarked goals draw from their own account first ──
    const fromEarmarked = Math.min(Math.max(0, state.earmarked), goals.earmarked);
    state.earmarked -= fromEarmarked;
    const earmarkedGap = goals.earmarked - fromEarmarked;

    // ── Withdrawals ──
    const retirementNeed = retired
      ? Math.max(0, livingExp - ssNet - takeHome)
      : 0;
    const need = goals.discretionary + goals.committed + earmarkedGap + retirementNeed + deficit;
    const draw = drawDown(state, need, v.pretaxTaxRate);

    // ── Required minimum distributions ──
    // Anything the RMD forces out beyond what was already withdrawn is not
    // spent — it is taxed and swept into the taxable account.
    const rmdRequired = requiredDistribution(cfg, pretaxBoy, age, spouseAge);
    let rmdForced = 0;
    if (rmdRequired > draw.fromPretax) {
      rmdForced = Math.min(rmdRequired - draw.fromPretax, Math.max(0, state.pretax));
      state.pretax -= rmdForced;
      state.taxable += rmdForced * (1 - v.pretaxTaxRate);
    }

    // ── Property ──
    if (mortBal > 0) {
      const interest = mortBal * v.mortRate;
      const principal = d.mortPayment - interest;
      if (principal <= 0 && t === 0) {
        warnings.push('The mortgage payment does not cover the annual interest, so the balance never amortizes. Check the payment and rate.');
      }
      mortBal = Math.max(0, mortBal - Math.max(0, principal));
    }
    reValue *= (1 + v.reAppreciation);
    const houseEquity = Math.max(0, reValue - mortBal);

    const liquid = state.cash + state.bonds + state.taxable + state.pretax + state.roth + state.earmarked;
    const netWorth = liquid + houseEquity;
    const parts = afterTaxParts(state, cfg, d);
    const netWorthAfterTax = afterTaxNetWorth(state, cfg, d, houseEquity);

    rows.push({
      year, age, t, retired, deflator: inf, returnUsed: r,
      gross, takeHome, ssGross, ssNet,
      livingExp, goalCost: goals.total, goalDiscretionary: goals.discretionary,
      pretaxContrib, taxableContrib, savedSurplus, deficit, ssSurplus, ssApplied,
      need, withdrawal: draw.fromCash + draw.fromBonds + draw.fromTaxable + draw.fromPretax + draw.fromRoth,
      fromCash: draw.fromCash, fromBonds: draw.fromBonds, fromTaxable: draw.fromTaxable,
      fromPretax: draw.fromPretax, fromRoth: draw.fromRoth, fromEarmarked,
      taxPaid: draw.tax + ssTax, shortfall: draw.shortfall,
      rmdRequired, rmdForced,
      cash: state.cash, bonds: state.bonds, taxable: state.taxable,
      pretax: state.pretax, roth: state.roth, earmarked: state.earmarked,
      taxableAfterTax: parts.taxable, pretaxAfterTax: parts.pretax,
      mortgage: mortBal, reValue, houseEquity,
      liquid, netWorth, netWorthAfterTax,
      netWorthAfterTaxReal: netWorthAfterTax / inf,
      // The after-tax figure with property stripped out, which is the basis the
      // Monte Carlo layer reports and so the only one its fan can be compared to.
      liquidAfterTaxReal: (netWorthAfterTax - houseEquity) / inf,
      liquidReal: liquid / inf,
    });
  }

  return { rows, derived: d, summary: summarize(cfg, rows, d), warnings };
}

function summarize(cfg, rows, d) {
  const v = cfg.values;
  const last = rows[rows.length - 1];
  const atRetirement = rows.find(row => row.retired) || last;
  const depleted = rows.find(row => row.liquid <= 0);
  const firstShortfall = rows.find(row => row.shortfall > 0.5);
  const peak = rows.reduce((best, row) => row.netWorthAfterTaxReal > best.netWorthAfterTaxReal ? row : best, rows[0]);
  return {
    terminalReal: last.netWorthAfterTaxReal,
    terminalNominal: last.netWorthAfterTax,
    atRetirementReal: atRetirement.netWorthAfterTaxReal,
    retireYear: d.retireYear,
    peakReal: peak.netWorthAfterTaxReal,
    peakYear: peak.year,
    depletionAge: depleted ? depleted.age : null,
    shortfallAge: firstShortfall ? firstShortfall.age : null,
    lifetimeTaxReal: rows.reduce((sum, row) => sum + row.taxPaid / row.deflator, 0),
    baseLivingExp: d.baseLivingExp,
    takeHome0: d.takeHome0,
    firstRmdAge: (rows.find(row => row.rmdRequired > 0) || {}).age || null,
    // Spending the portfolio has to cover in the first full retirement year,
    // which is the number the whole plan really turns on.
    firstRetirementDraw: atRetirement.need,
  };
}

// ── Monte Carlo ─────────────────────────────────────────────────────────────
// The same mechanics as the ledger above, run across many paths with a random
// return each year, optional career-path risk, and spending that adapts toward
// a floor before a path resorts to debt.
function runMonteCarlo(cfg, deterministic) {
  const v = cfg.values;
  const d = derive(cfg);
  const det = deterministic || runDeterministic(cfg);
  const nYears = d.nYears;
  const nSims = Math.max(1, Math.min(50000, v.nSims | 0));

  const rng = makeRng(v.seed);
  const normal = makeNormal(rng);
  const shock = makeShockDraw(cfg, rng, normal);

  const cash = new Float64Array(nSims).fill(+v.cash0);
  const bonds = new Float64Array(nSims).fill(+v.bonds0);
  const taxable = new Float64Array(nSims).fill(+v.taxableMix0);
  const pretax = new Float64Array(nSims).fill(+v.pretax0);
  const roth = new Float64Array(nSims).fill(+v.roth0);
  const earmarked = new Float64Array(nSims).fill(+v.earmarked0);

  const disabled = new Uint8Array(nSims);
  const everInDebt = new Uint8Array(nSims);
  const everCut = new Uint8Array(nSims);
  const everDepleted = new Uint8Array(nSims);
  const ltcYearsLeft = new Int16Array(nSims);
  const ltcEver = new Uint8Array(nSims);
  const depletionAge = new Int16Array(nSims).fill(-1);

  const liquidReal = new Float64Array(nYears * nSims);
  const totalReal = new Float64Array(nYears * nSims);
  const solventCount = new Float64Array(nYears);
  const spendRatioSum = new Float64Array(nYears);

  for (let t = 0; t < nYears; t++) {
    const row = det.rows[t];
    const age = row.age;
    const spouseAge = (v.spouseAge || 0) + t;
    const retired = row.retired;
    const inf = row.deflator;
    const mean = retired ? d.returnPost : d.returnPre;
    const sigma = retired ? v.sigmaPost : v.sigmaPre;
    // Volatility drives a wedge between the average yearly return and the
    // compound rate actually earned. Which of the two the input represents is
    // the user's choice, because getting it backwards shifts the whole fan.
    const mu = v.returnBasis === 'arithmetic'
      ? Math.log(1 + mean) - 0.5 * sigma * sigma
      : Math.log(1 + mean);
    const houseEquity = row.houseEquity;

    // Spending that is fixed across paths: goal costs, and the retirement
    // spending target net of Social Security and any income still arriving.
    const goals = goalCosts(cfg, row.year);
    const retirementNeed = retired ? Math.max(0, row.livingExp - row.ssNet - row.takeHome) : 0;
    const committedBase = goals.committed;
    const discretionaryBase = goals.discretionary;
    const earmarkedBase = goals.earmarked;
    const contribScale = Math.pow(1 + v.contribGrowth, t);

    for (let i = 0; i < nSims; i++) {
      const pretaxBoy = pretax[i];
      const r = Math.exp(mu + sigma * shock()) - 1;

      // ── Career risk ──
      let incomeFactor = 1;
      if (!retired) {
        if (!disabled[i] && rng() < v.disabilityProb) disabled[i] = 1;
        let jobLossProb = v.jobLossProb;
        if (v.coupleCareerToMarket && r < v.recessionReturnThreshold) {
          jobLossProb = Math.min(1, jobLossProb * v.recessionJobLossMultiplier);
        }
        const jobLoss = !disabled[i] && rng() < jobLossProb;
        incomeFactor = disabled[i] ? v.disabilityIncomePct : (jobLoss ? v.jobLossIncomePct : 1);
      }

      // ── Long-term care ──
      let ltcCost = 0;
      if (v.ltcEnabled) {
        if (ltcYearsLeft[i] === 0 && age >= v.ltcStartAge && rng() < v.ltcAnnualProb) {
          ltcYearsLeft[i] = Math.max(1, v.ltcDurationYears | 0);
          ltcEver[i] = 1;
        }
        if (ltcYearsLeft[i] > 0) {
          ltcCost = v.ltcAnnualCost0 * inf;
          ltcYearsLeft[i] -= 1;
        }
      }

      // ── Growth, then contributions scaled by whatever income arrived ──
      cash[i] *= (1 + v.cashReturn);
      bonds[i] *= (1 + v.bondReturn);
      taxable[i] *= (1 + r);
      pretax[i] *= (1 + r);
      roth[i] *= (1 + r);
      earmarked[i] *= (1 + r);
      if (!retired) {
        pretax[i] += v.contribPretax * contribScale * incomeFactor;
        taxable[i] += Math.max(0, v.contribTaxableRecurring * contribScale * incomeFactor)
          + row.savedSurplus * incomeFactor + row.ssSurplus;
      }

      const fromEarmarked = Math.min(Math.max(0, earmarked[i]), earmarkedBase);
      earmarked[i] -= fromEarmarked;
      const earmarkedGap = earmarkedBase - fromEarmarked;

      // ── Desired spending, and how far it can be cut ──
      // Lifestyle and discretionary goals are cut simultaneously toward two
      // different floors rather than one combined floor: a household under
      // stress trims the holiday before it trims the heating.
      // The portfolio only has to fund the part of life the paycheck stopped
      // covering, plus any structural gap that exists even at full income.
      const lostIncomeNeed = retired ? 0 : d.baseLivingExp * inf * (1 - incomeFactor) + row.deficit;
      const lifestyleDesired = retired ? retirementNeed : lostIncomeNeed;
      const committedDesired = committedBase + earmarkedGap + ltcCost;
      const discretionaryDesired = discretionaryBase;

      const lifestyleFloor = lifestyleDesired * v.minSpendPct;
      const discretionaryFloor = discretionaryDesired * v.minGoalPct;
      const desiredTotal = lifestyleDesired + committedDesired + discretionaryDesired;
      const floorTotal = lifestyleFloor + committedDesired + discretionaryFloor;

      const available = Math.max(0, cash[i]) + Math.max(0, bonds[i])
        + Math.max(0, taxable[i]) + Math.max(0, pretax[i]) + Math.max(0, roth[i]);
      const actualTotal = Math.min(desiredTotal, Math.max(available, floorTotal));
      if (actualTotal < desiredTotal - 1) everCut[i] = 1;
      if (desiredTotal > 0) spendRatioSum[t] += actualTotal / desiredTotal;
      else spendRatioSum[t] += 1;

      const state = { cash: cash[i], bonds: bonds[i], taxable: taxable[i], pretax: pretax[i], roth: roth[i] };
      const draw = drawDown(state, actualTotal, v.pretaxTaxRate);
      cash[i] = state.cash; bonds[i] = state.bonds; taxable[i] = state.taxable;
      pretax[i] = Math.max(0, state.pretax); roth[i] = state.roth;
      if (draw.shortfall > 0.5 || taxable[i] < 0) everInDebt[i] = 1;

      const rmdRequired = requiredDistribution(cfg, pretaxBoy, age, spouseAge);
      if (rmdRequired > draw.fromPretax) {
        const forced = Math.min(rmdRequired - draw.fromPretax, Math.max(0, pretax[i]));
        pretax[i] -= forced;
        taxable[i] += forced * (1 - v.pretaxTaxRate);
      }

      const embeddedGainsTax = Math.max(0, taxable[i]) * v.taxableGainPct * d.ltcgRate;
      const liquidAfterTax = cash[i] + bonds[i] + (taxable[i] - embeddedGainsTax)
        + pretax[i] * (1 - v.pretaxTaxRate) + roth[i] + earmarked[i];

      const idx = t * nSims + i;
      liquidReal[idx] = liquidAfterTax / inf;
      totalReal[idx] = (liquidAfterTax + houseEquity) / inf;
      if (liquidAfterTax > 0) solventCount[t] += 1;
      else if (depletionAge[i] === -1) { depletionAge[i] = age; everDepleted[i] = 1; }
    }
  }

  // ── Percentiles per year ──
  const pcts = [5, 10, 25, 50, 75, 90, 95];
  const bands = { liquid: {}, total: {} };
  for (const p of pcts) { bands.liquid[p] = new Float64Array(nYears); bands.total[p] = new Float64Array(nYears); }
  const scratch = new Float64Array(nSims);
  for (const [key, matrix] of [['liquid', liquidReal], ['total', totalReal]]) {
    for (let t = 0; t < nYears; t++) {
      scratch.set(matrix.subarray(t * nSims, (t + 1) * nSims));
      const sorted = Float64Array.prototype.slice.call(scratch).sort();
      for (const p of pcts) bands[key][p][t] = quantileSorted(sorted, p / 100);
    }
  }

  const terminal = Float64Array.prototype.slice.call(totalReal.subarray((nYears - 1) * nSims)).sort();
  const terminalLiquid = Float64Array.prototype.slice.call(liquidReal.subarray((nYears - 1) * nSims)).sort();

  return {
    nSims, nYears,
    years: det.rows.map(r => r.year),
    ages: det.rows.map(r => r.age),
    bands,
    terminalPercentiles: Object.fromEntries(pcts.map(p => [p, quantileSorted(terminal, p / 100)])),
    terminalPercentilesLiquid: Object.fromEntries(pcts.map(p => [p, quantileSorted(terminalLiquid, p / 100)])),
    terminalSamples: terminal,
    terminalSamplesLiquid: terminalLiquid,
    probEverInDebt: mean(everInDebt),
    probEverCutSpending: mean(everCut),
    probDepleted: mean(everDepleted),
    probSuccess: 1 - mean(everDepleted),
    probLtc: v.ltcEnabled ? mean(ltcEver) : null,
    probTerminalBelowZero: terminalLiquid.reduce((n, x) => n + (x <= 0 ? 1 : 0), 0) / nSims,
    solventShare: Array.from(solventCount, c => c / nSims),
    avgSpendRatio: Array.from(spendRatioSum, s => s / nSims),
    medianDepletionAge: medianOfPositive(depletionAge),
  };
}

function quantileSorted(sorted, q) {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function mean(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  return arr.length ? sum / arr.length : 0;
}

function medianOfPositive(arr) {
  const vals = Array.from(arr).filter(x => x > 0).sort((a, b) => a - b);
  if (!vals.length) return null;
  return vals[Math.floor(vals.length / 2)];
}
