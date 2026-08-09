/* config.js — the single source of truth for every number in the model.
 *
 * Nothing else in this app hardcodes a figure. model.js reads values from a
 * config object; this file defines what fields exist, what they mean, and what
 * they default to.
 *
 * Every default here is an ILLUSTRATIVE PLACEHOLDER, not advice and not
 * anyone's real data. Each field carries a `personal` flag: personal fields
 * start life marked "placeholder" and stay visibly flagged until you replace
 * them with your own number and mark them verified with a note saying where
 * the number came from (a statement, a pay stub, a stated preference). The
 * app refuses to present its headline numbers as anything but illustrative
 * while core placeholders remain.
 */

// ── Field types ─────────────────────────────────────────────────────────────
// money  — dollars, entered as a plain number
// pct    — stored as a decimal fraction (0.07), entered as a percent (7)
// int    — whole number
// age    — whole number, an age
// year   — a calendar year
// bool   — checkbox
// choice — one of `options`
// text   — free text, never used in arithmetic

const FIELDS = [
  // ── Timeline ──────────────────────────────────────────────────────────────
  {
    key: 'startYear', group: 'timeline', label: 'Current year', type: 'year',
    def: new Date().getFullYear(), personal: false,
    help: 'Year 0 of the projection. Every "today\'s dollars" figure is expressed in this year\'s money.',
  },
  {
    key: 'birthYear', group: 'timeline', label: 'Your birth year', type: 'year',
    def: 1986, personal: true,
    help: 'Drives the suggested RMD start age. Birth year matters directly for retirement-account rules, which is why it is an input rather than derived from your age.',
  },
  {
    key: 'startAge', group: 'timeline', label: 'Your age today', type: 'age',
    def: 40, personal: true,
    help: 'Your age in the current year.',
  },
  {
    key: 'retireAge', group: 'timeline', label: 'Planned retirement age', type: 'age',
    def: 65, personal: true,
    help: 'The age at which earned income stops, spending switches to the retirement target, and the portfolio shifts to its post-retirement allocation. If a second earner retires at a different time, model that through their income stream\'s end year rather than this field.',
  },
  {
    key: 'endAge', group: 'timeline', label: 'Projection horizon (age)', type: 'age',
    def: 100, personal: true,
    help: 'Age the projection runs to. Planning to a deliberately long horizon is the conservative choice — longevity risk is the whole reason a plan can look fine at 85 and fail at 95.',
  },
  {
    key: 'filingStatus', group: 'timeline', label: 'Tax filing status', type: 'choice',
    def: 'single', personal: true,
    options: [
      ['single', 'Single'],
      ['mfj', 'Married filing jointly'],
      ['mfs', 'Married filing separately'],
      ['hoh', 'Head of household'],
    ],
    help: 'Not used in arithmetic directly — the model uses blended effective rates you supply. It is recorded here because it is the first thing you need to know when you go research those rates.',
  },
  {
    key: 'jurisdiction', group: 'timeline', label: 'State / city of residence', type: 'text',
    def: '', personal: true,
    help: 'State and local tax treatment varies enormously and has to be researched for your specific location. Recording it here is a reminder that the tax rates below are location-dependent.',
  },
  {
    key: 'dependents', group: 'timeline', label: 'Dependents / people in scope', type: 'text',
    def: '', personal: true,
    help: 'Free-text note: kids and their ages, aging parents being supported, nobody. Any associated costs belong in the Goals section as their own line.',
  },

  // ── Income ────────────────────────────────────────────────────────────────
  {
    key: 'effectiveTax', group: 'income', label: 'Blended effective tax rate on earned income', type: 'pct',
    def: 0.35, personal: true, research: true,
    help: 'Applied to income streams entered on a GROSS basis to get take-home pay. This is an effective (average) rate across federal + state + local + payroll, not a marginal bracket. Derive it from an actual pay stub or tax return rather than guessing.',
  },
  {
    key: 'salaryGrowth', group: 'income', label: 'Default annual income growth', type: 'pct',
    def: 0.04, personal: true,
    help: 'Nominal growth applied to income streams that do not specify their own rate. Should exceed inflation only to the extent you expect real raises or promotions.',
  },
  {
    key: 'inflation', group: 'income', label: 'General inflation', type: 'pct',
    def: 0.03, personal: false,
    help: 'Used both to inflate spending and to deflate every chart back into today\'s dollars. A single flat rate applied uniformly is a known simplification — see the limitations list.',
  },
  {
    key: 'contribPretax', group: 'income', label: 'Annual pre-tax retirement contribution', type: 'money',
    def: 25000, personal: true,
    help: 'Employee deferral plus employer match, combined. Comes out of gross pay, so it is not part of take-home; the model adds it to the pre-tax bucket directly.',
  },
  {
    key: 'contribTaxableRecurring', group: 'income', label: 'Annual after-tax savings transfer', type: 'money',
    def: 6000, personal: true,
    help: 'Automatic recurring transfers into taxable savings/brokerage out of take-home pay. Whatever take-home is left after this is treated as the living-expense residual below.',
  },
  {
    key: 'contribGrowth', group: 'income', label: 'Contribution growth', type: 'pct',
    def: 0.03, personal: false,
    help: 'Contribution limits are indexed to inflation, so holding contributions flat in nominal terms understates lifetime saving. Set this to 0 to hold them flat instead.',
  },
  {
    key: 'saveSurplusPct', group: 'income', label: 'Share of leftover take-home saved', type: 'pct',
    def: 0, personal: true,
    help: 'Applies to whatever take-home pay is left over after living expenses and the savings transfer above. At 0 — the deliberately conservative default — raises above inflation are assumed to be absorbed by lifestyle rather than saved. Raise it if you expect to bank part of future income growth.',
  },

  // ── Spending ──────────────────────────────────────────────────────────────
  {
    key: 'livingExpenseMode', group: 'spending', label: 'How to set baseline living expenses', type: 'choice',
    def: 'residual', personal: false,
    options: [
      ['residual', 'Top-down residual (take-home minus savings transfers)'],
      ['explicit', 'Explicit figure I enter myself'],
    ],
    help: 'The residual is easy to compute and always self-consistent with income, but it silently shrinks whenever income inputs get corrected downward — even if real spending did not change. An explicit figure from actual spending data is more honest if you have it.',
  },
  {
    key: 'livingExpenseExplicit', group: 'spending', label: 'Explicit annual living expenses', type: 'money',
    def: 0, personal: true,
    help: 'Today\'s-dollars total annual outflow for normal life, including rent or mortgage payments, utilities, and any non-mortgage debt payments. Only used when the mode above is set to explicit.',
  },
  {
    key: 'retireSpend', group: 'spending', label: 'Retirement spending target', type: 'money',
    def: 80000, personal: true,
    help: 'Today\'s-dollars annual spending once retired, inflated forward from there. Social Security and any income stream still running in retirement offset this before anything is withdrawn from the portfolio. This is a total: if a mortgage payment will still be running in retirement, include it here.',
  },

  // ── Balances ──────────────────────────────────────────────────────────────
  {
    key: 'cash0', group: 'balances', label: 'Cash / emergency fund', type: 'money',
    def: 30000, personal: true,
    help: 'Checking, savings, money market. Grows at the cash return and is drawn from first.',
  },
  {
    key: 'bonds0', group: 'balances', label: 'Bonds / fixed income held separately', type: 'money',
    def: 20000, personal: true,
    help: 'Only bonds held as their own account or sleeve. Bonds inside a blended brokerage or 401(k) allocation belong in the equity/bond mix percentages instead, not here.',
  },
  {
    key: 'taxableMix0', group: 'balances', label: 'Taxable brokerage', type: 'money',
    def: 100000, personal: true,
    help: 'Invested at the mixed allocation set in the Returns section. Pull the real balance from a current statement.',
  },
  {
    key: 'pretax0', group: 'balances', label: 'Pre-tax retirement', type: 'money',
    def: 300000, personal: true,
    help: '401(k), 403(b), Traditional IRA — anything where withdrawals are ordinary income. Subject to RMDs.',
  },
  {
    key: 'roth0', group: 'balances', label: 'Roth retirement', type: 'money',
    def: 50000, personal: true,
    help: 'Roth IRA / Roth 401(k). Withdrawals are tax-free, so the model treats this as the very last account to touch.',
  },
  {
    key: 'earmarked0', group: 'balances', label: 'Earmarked goal account (529 / HSA / custodial)', type: 'money',
    def: 0, personal: true,
    help: 'Balance reserved for specific goals. Goals flagged "earmarked" draw from here first. Set to 0 if you have no such account.',
  },
  {
    key: 'reValue0', group: 'balances', label: 'Real estate value', type: 'money',
    def: 400000, personal: true,
    help: 'Current market value of property you own. Set to 0 if you rent — and if you rent, remember rent is already inside the living-expense figure.',
  },
  {
    key: 'reAppreciation', group: 'balances', label: 'Real estate appreciation', type: 'pct',
    def: 0.03, personal: true,
    help: 'Nominal annual appreciation. Setting this equal to inflation means the home holds real value but contributes no real growth, which is a defensible neutral assumption.',
  },
  {
    key: 'mortgage0', group: 'balances', label: 'Mortgage balance', type: 'money',
    def: 250000, personal: true,
    help: 'Current outstanding principal. Set to 0 if you have no mortgage.',
  },
  {
    key: 'mortRate', group: 'balances', label: 'Mortgage rate', type: 'pct',
    def: 0.035, personal: true,
    help: 'Annual interest rate on the mortgage above.',
  },
  {
    key: 'mortAnnualPayment', group: 'balances', label: 'Mortgage payment (annualized)', type: 'money',
    def: 24000, personal: true,
    help: 'Principal and interest only, times 12. Taxes and insurance are part of living expenses, not of amortization. This payment is already inside your living-expense figure — the model amortizes the balance to track equity, it does not withdraw the payment a second time.',
  },

  // ── Returns and volatility ────────────────────────────────────────────────
  {
    key: 'equityReturn', group: 'returns', label: 'Expected equity return', type: 'pct',
    def: 0.07, personal: false, research: true,
    help: 'Nominal expected return. Compare against current published forward-looking capital market assumptions rather than assuming the long-run historical average repeats — post-high-valuation forward estimates are frequently lower.',
  },
  {
    key: 'bondReturn', group: 'returns', label: 'Expected bond return', type: 'pct',
    def: 0.045, personal: false, research: true,
    help: 'Nominal expected return on fixed income.',
  },
  {
    key: 'cashReturn', group: 'returns', label: 'Expected cash return', type: 'pct',
    def: 0.03, personal: false, research: true,
    help: 'Nominal yield on cash. Note that cash yields near or below inflation mean the emergency fund loses real value over time.',
  },
  {
    key: 'equityPctPre', group: 'returns', label: 'Equity allocation before retirement', type: 'pct',
    def: 0.9, personal: true,
    help: 'Equity share of the invested mix (taxable brokerage, pre-tax, and Roth) while working. Pull the real allocation from your actual statements rather than assuming a generic split.',
  },
  {
    key: 'equityPctPost', group: 'returns', label: 'Equity allocation after retirement', type: 'pct',
    def: 0.5, personal: true,
    help: 'Equity share of the invested mix once retired. The shift happens as a single step at retirement, not as a glide path.',
  },
  {
    key: 'sigmaPre', group: 'returns', label: 'Return volatility before retirement', type: 'pct',
    def: 0.17, personal: false,
    help: 'Annual standard deviation of the invested mix while working. Only used by the Monte Carlo layer.',
  },
  {
    key: 'sigmaPost', group: 'returns', label: 'Return volatility after retirement', type: 'pct',
    def: 0.10, personal: false,
    help: 'Annual standard deviation of the invested mix after retirement, lower because the allocation is more conservative.',
  },

  // ── Social Security ───────────────────────────────────────────────────────
  {
    key: 'ssAnnual', group: 'socialSecurity', label: 'Expected Social Security benefit', type: 'money',
    def: 30000, personal: true, research: true,
    help: 'Combined household benefit in today\'s dollars. Get this from an official benefit estimate at your claiming age, not from a rule of thumb.',
  },
  {
    key: 'ssStartAge', group: 'socialSecurity', label: 'Claiming age', type: 'age',
    def: 67, personal: true,
    help: 'Benefits claimed before full retirement age are permanently reduced and delayed claiming permanently increases them, so the benefit figure above must correspond to this age.',
  },
  {
    key: 'ssTaxablePct', group: 'socialSecurity', label: 'Share of benefit that is federally taxable', type: 'pct',
    def: 0.85, personal: false, research: true,
    help: 'Up to 85% of benefits become federally taxable once provisional income crosses IRS thresholds. Those thresholds are not inflation-indexed, so verify the current figures instead of assuming they are static.',
  },
  {
    key: 'ssFederalRate', group: 'socialSecurity', label: 'Tax rate on the taxable share', type: 'pct',
    def: 0.22, personal: true, research: true,
    help: 'Federal blended rate applied to the taxable portion. Most states do not tax Social Security but a few do — check yours specifically and add it here if it does.',
  },

  // ── Tax treatment of withdrawals ──────────────────────────────────────────
  {
    key: 'pretaxTaxRate', group: 'taxes', label: 'Effective rate on pre-tax withdrawals', type: 'pct',
    def: 0.30, personal: true, research: true,
    help: 'Blended federal + state + local ordinary-income rate expected in retirement. Derive it from your projected retirement income level rather than using your current working rate.',
  },
  {
    key: 'taxableGainPct', group: 'taxes', label: 'Share of taxable balance that is unrealized gain', type: 'pct',
    def: 0.50, personal: true,
    help: 'Used to estimate the embedded capital-gains liability inside the taxable brokerage balance. A long-held, heavily-appreciated portfolio sits far higher than a recently-funded one.',
  },
  {
    key: 'ltcgFederal', group: 'taxes', label: 'Federal long-term capital gains rate', type: 'pct',
    def: 0.238, personal: false, research: true,
    help: 'Top federal LTCG rate plus the 3.8% Net Investment Income Tax where it applies. Note that qualified retirement distributions are excluded from the NIIT base itself but still count toward the income threshold that triggers NIIT on other income.',
  },
  {
    key: 'stateLocalGains', group: 'taxes', label: 'State and local capital gains rate', type: 'pct',
    def: 0, personal: true, research: true,
    help: 'Some states tax capital gains as ordinary income with no preferential rate at all; others exempt them partly or entirely. Leaving this at 0 without checking your state is one of the easiest ways to make the plan look better than it is.',
  },

  // ── RMDs ──────────────────────────────────────────────────────────────────
  {
    key: 'rmdStartAge', group: 'rmd', label: 'Age RMDs begin', type: 'age',
    def: 75, personal: true, research: true,
    help: 'Depends on your birth year under current law and has changed several times in recent years. The app suggests an age from your birth year, but confirm it against current rules rather than trusting either the suggestion or this default.',
  },
  {
    key: 'spousePretaxShare', group: 'rmd', label: 'Spouse share of pre-tax balance', type: 'pct',
    def: 0, personal: true,
    help: 'RMDs apply per person, on each person\'s own age and their own balances. Set this above 0 if a meaningful part of the pre-tax total belongs to a spouse of a different age, and the model will compute two separate distributions.',
  },
  {
    key: 'spouseBirthYear', group: 'rmd', label: 'Spouse birth year', type: 'year',
    def: 1986, personal: true,
    help: 'Only used when the spouse share above is greater than 0.',
  },
  {
    key: 'spouseAge', group: 'rmd', label: 'Spouse age today', type: 'age',
    def: 40, personal: true,
    help: 'Only used when the spouse share above is greater than 0.',
  },

  // ── Monte Carlo ───────────────────────────────────────────────────────────
  {
    key: 'nSims', group: 'monteCarlo', label: 'Number of simulated paths', type: 'int',
    def: 2000, personal: false,
    help: 'More paths give more stable percentile estimates and take longer. A few thousand is plenty for reading percentiles; tail probabilities need more.',
  },
  {
    key: 'seed', group: 'monteCarlo', label: 'Random seed', type: 'int',
    def: 42, personal: false,
    help: 'Fixed so results are reproducible: the same inputs always produce the same paths. Change it to confirm a conclusion is not an artifact of one particular random draw.',
  },
  {
    key: 'returnModel', group: 'monteCarlo', label: 'Return distribution', type: 'choice',
    def: 'lognormal', personal: false,
    options: [
      ['lognormal', 'Lognormal, independent draws'],
      ['fatTail', 'Fat-tailed (Student-t), independent draws'],
    ],
    help: 'Independent lognormal draws understate tail risk: real returns have fatter tails and bad years cluster together. The fat-tailed option addresses the first half of that problem but not the clustering.',
  },
  {
    key: 'tDf', group: 'monteCarlo', label: 'Fat-tail degrees of freedom', type: 'int',
    def: 5, personal: false,
    help: 'Lower means fatter tails; above roughly 30 it is indistinguishable from normal. Draws are rescaled to keep the volatility you specified, so this changes the shape of the tails without changing the standard deviation.',
  },
  {
    key: 'jobLossProb', group: 'monteCarlo', label: 'Annual probability of job loss', type: 'pct',
    def: 0.03, personal: true,
    help: 'Chance in any working year of a disruption that cuts income to the fraction below for that year.',
  },
  {
    key: 'jobLossIncomePct', group: 'monteCarlo', label: 'Income retained during job loss', type: 'pct',
    def: 0.25, personal: true,
    help: 'Fraction of normal income still arriving in a job-loss year, from severance, unemployment insurance, or a partner who is still working.',
  },
  {
    key: 'disabilityProb', group: 'monteCarlo', label: 'Annual probability of disability', type: 'pct',
    def: 0.005, personal: true,
    help: 'Chance in any working year of a permanent loss of earning capacity. Unlike job loss, this persists for the rest of the working years in that path.',
  },
  {
    key: 'disabilityIncomePct', group: 'monteCarlo', label: 'Income retained if disabled', type: 'pct',
    def: 0, personal: true,
    help: 'Zero is the harshest assumption. Raise it if you hold long-term disability coverage — and check what fraction of income your actual policy replaces.',
  },
  {
    key: 'minSpendPct', group: 'monteCarlo', label: 'Lifestyle spending floor', type: 'pct',
    def: 0.5, personal: true,
    help: 'How far lifestyle spending can be cut before a path resorts to debt. Real households cut back under stress, and a model that cannot cut spending overstates failure rates.',
  },
  {
    key: 'minGoalPct', group: 'monteCarlo', label: 'Discretionary goal floor', type: 'pct',
    def: 0, personal: true,
    help: 'How much of a goal flagged discretionary must still be funded under stress. Zero means a discretionary goal can be abandoned entirely. Goals not flagged discretionary are always funded in full.',
  },
  {
    key: 'coupleCareerToMarket', group: 'monteCarlo', label: 'Couple job-loss risk to bad markets', type: 'bool',
    def: false, personal: false,
    help: 'Drawing career risk and market risk independently understates how bad the genuinely bad scenarios get, because recessions cause both at once. Turning this on multiplies job-loss probability in years where the return draw falls below the threshold below.',
  },
  {
    key: 'recessionReturnThreshold', group: 'monteCarlo', label: 'Return that counts as a bad market year', type: 'pct',
    def: -0.10, personal: false,
    help: 'Only used when coupling is on.',
  },
  {
    key: 'recessionJobLossMultiplier', group: 'monteCarlo', label: 'Job-loss multiplier in bad years', type: 'int',
    def: 3, personal: false,
    help: 'Only used when coupling is on. A rough stand-in for the real correlation, not a calibrated estimate.',
  },
  {
    key: 'ltcEnabled', group: 'monteCarlo', label: 'Model long-term care as a random event', type: 'bool',
    def: false, personal: false,
    help: 'A flat annual cushion added to retirement spending does not capture long-term care, which is low-probability, high-severity, and escalates with age. Turning this on models it as its own event instead.',
  },
  {
    key: 'ltcStartAge', group: 'monteCarlo', label: 'Earliest age of long-term care', type: 'age',
    def: 80, personal: false,
    help: 'Below this age the event cannot occur.',
  },
  {
    key: 'ltcAnnualProb', group: 'monteCarlo', label: 'Annual probability of entering care', type: 'pct',
    def: 0.04, personal: true, research: true,
    help: 'Per-year chance of entering care once past the age above. Worth checking against published incidence data for your age and sex rather than accepting this placeholder.',
  },
  {
    key: 'ltcDurationYears', group: 'monteCarlo', label: 'Years of care', type: 'int',
    def: 3, personal: true, research: true,
    help: 'Average duration is a poor summary of a very skewed distribution — a long stay is what actually breaks a plan.',
  },
  {
    key: 'ltcAnnualCost0', group: 'monteCarlo', label: 'Annual cost of care', type: 'money',
    def: 120000, personal: true, research: true,
    help: 'Today\'s dollars, net of anything you expect insurance to cover. Costs vary widely by care level and location, and have historically risen faster than general inflation.',
  },
];

// ── IRS Uniform Lifetime Table ──────────────────────────────────────────────
// Public IRS data used to size required minimum distributions: the pre-tax
// balance at the start of the year divided by the distribution period for that
// age. Confirm you have the current version before trusting RMD figures.
const UNIFORM_LIFETIME_TABLE = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1,
  80: 20.2, 81: 19.4, 82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
  87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8, 93: 10.1,
  94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
};

// ── Group presentation ──────────────────────────────────────────────────────
const GROUPS = [
  {
    id: 'timeline', label: 'People & timeline',
    blurb: 'Who is in scope, how long the projection runs, and where you are taxed.',
  },
  {
    id: 'income', label: 'Income & saving',
    blurb: 'Income streams live in their own list below. These fields set the tax and growth assumptions applied to them, plus what you save each year.',
  },
  {
    id: 'spending', label: 'Spending',
    blurb: 'What life costs now and what you expect it to cost in retirement.',
  },
  {
    id: 'balances', label: 'Accounts & property',
    blurb: 'Current balances, pulled from real statements. One line per bucket, not per account — add balances of the same type together.',
  },
  {
    id: 'returns', label: 'Returns & allocation',
    blurb: 'What the money earns, and how much it moves around that average.',
  },
  {
    id: 'socialSecurity', label: 'Social Security',
    blurb: 'Benefit, claiming age, and how much of it survives federal tax.',
  },
  {
    id: 'taxes', label: 'Withdrawal taxes',
    blurb: 'What it costs to get money out of each bucket. These rates are location-specific and need real research — see the Verify tab.',
  },
  {
    id: 'rmd', label: 'Required minimum distributions',
    blurb: 'Forced withdrawals from pre-tax accounts, driven by age and birth year.',
  },
  {
    id: 'monteCarlo', label: 'Risk & simulation',
    blurb: 'How the thousands of randomized paths are generated, and which risks they include.',
  },
];

const FIELDS_BY_KEY = Object.fromEntries(FIELDS.map(f => [f.key, f]));

// ── Starter income streams and goals ────────────────────────────────────────
// Illustrative shapes, not recommendations. Both lists are meant to be emptied
// and rebuilt around your actual situation.
function starterIncomes(year) {
  return [{
    id: 'inc-1', name: 'Salary', amount: 150000, basis: 'gross',
    growth: null, startYear: null, endYear: null,
    source: '', verified: false,
  }];
}

function starterGoals(year) {
  return [{
    id: 'goal-1', name: 'Example goal — replace me', startYear: year + 6, endYear: null,
    cost0: 50000, inflation: 0.05, discretionary: true, bucket: 'general',
    source: '', verified: false,
  }];
}

// ── Research checklist ──────────────────────────────────────────────────────
// The items that must be independently researched for the user's own
// jurisdiction and circumstances rather than inherited from any template.
const RESEARCH_ITEMS = [
  {
    id: 'ltcg',
    title: 'Capital gains treatment, federal and state',
    detail: 'Confirm the federal long-term rate that applies at your income level, whether the 3.8% Net Investment Income Tax applies, and how your state and city treat gains. Some states tax them as ordinary income with no preferential rate; others exempt them.',
    fields: ['ltcgFederal', 'stateLocalGains'],
  },
  {
    id: 'ss-tax',
    title: 'Social Security taxation',
    detail: 'Verify the current provisional-income thresholds that determine how much of the benefit is federally taxable. They are not inflation-indexed. Separately check whether your state taxes benefits — most do not, a few do.',
    fields: ['ssTaxablePct', 'ssFederalRate'],
  },
  {
    id: 'rmd-age',
    title: 'RMD start age against your birth year',
    detail: 'The age RMDs begin depends on birth year under current law and has moved more than once in recent years. If pre-tax balances are meaningfully split between spouses of different ages, each person\'s distribution is computed on their own age and their own balance.',
    fields: ['rmdStartAge'],
  },
  {
    id: 'ordinary-rate',
    title: 'Ordinary income rate on pre-tax withdrawals',
    detail: 'Build a blended estimate from your expected retirement income: federal marginal bracket, plus state, plus local where it applies. A flat effective rate is a fair simplification, but it should be derived from your numbers rather than assumed.',
    fields: ['pretaxTaxRate'],
  },
  {
    id: '529',
    title: '529 state conformity, if you hold one',
    detail: 'Federal law permits certain K-12 tuition withdrawals. Not every state conforms for state tax purposes, and non-conforming states can claw back deductions or apply penalties on withdrawals that are federally qualified.',
    fields: ['earmarked0'],
  },
  {
    id: 'cma',
    title: 'Forward-looking capital market assumptions',
    detail: 'Compare your return assumptions against current published forward-looking estimates rather than long-run historical averages. Forward estimates are frequently lower, particularly for equities after a period of high valuations. The comparison tells you whether your model is optimistic, neutral, or conservative against current consensus.',
    fields: ['equityReturn', 'bondReturn', 'cashReturn'],
  },
  {
    id: 'ult',
    title: 'Current IRS Uniform Lifetime Table',
    detail: 'The distribution periods built into this app are public IRS data, but confirm they match the current published table.',
    fields: [],
  },
];

// ── Default config ──────────────────────────────────────────────────────────
function defaultConfig() {
  const year = new Date().getFullYear();
  const values = {};
  const meta = {};
  for (const f of FIELDS) {
    values[f.key] = f.key === 'startYear' ? year : f.def;
    meta[f.key] = { verified: !f.personal, source: '' };
  }
  return {
    schemaVersion: 1,
    name: 'My plan',
    values,
    meta,
    incomes: starterIncomes(year),
    goals: starterGoals(year),
    research: {},
    notes: '',
    todos: [],
  };
}

// Suggested RMD age from birth year under current law. The 1959 cohort is
// genuinely ambiguous in the statute and is conventionally treated as 73.
function suggestedRmdAge(birthYear) {
  if (!birthYear) return null;
  if (birthYear <= 1950) return 72;
  if (birthYear <= 1959) return 73;
  return 75;
}

function isPlaceholder(cfg, key) {
  const f = FIELDS_BY_KEY[key];
  if (!f || !f.personal) return false;
  return !(cfg.meta[key] && cfg.meta[key].verified);
}

function placeholderKeys(cfg) {
  return FIELDS.filter(f => f.personal && !(cfg.meta[f.key] && cfg.meta[f.key].verified)).map(f => f.key);
}
