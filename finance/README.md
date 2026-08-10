# Personal finance projection

A year-by-year projection of your own finances, plus a Monte Carlo layer that
runs thousands of randomized versions of it, so the plan is described by a range
of outcomes rather than one confident line.

It is a static site with no build step, no dependencies and no server. Open
`index.html` in a browser and it runs. Everything you type stays in that
browser's local storage; nothing is uploaded anywhere, because there is nowhere
for it to go.

## Running it

Double-clicking `index.html` works — there are no `fetch` calls, so the
`file://` protocol is fine.

Serving it is still the better habit, since local storage on `file://` is shared
with every other local file you open:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

The webfonts are the only remote request the page makes, and they fall back to
the system font stack when they cannot be reached, so the app works offline.

## Running the checks

```bash
node run-tests.js
```

Or open `test.html` in a browser for the same checks with the same results.

These check the arithmetic in `model.js`, not the interface. Each one exists
because that specific mechanic is a known trap — a pre-tax withdrawal that
forgets it is taxable income, a required distribution sized off the wrong
balance, a Social Security benefit counted gross where it should be net, a
Monte Carlo layer that has quietly drifted from the ledger it is meant to be a
randomized version of. Run them after any change to the model.

## The files

| File | What lives in it |
| --- | --- |
| `config.js` | Every field the model has: its label, its help text, its type, its default, and whether it is a personal figure you must replace. The only place a number is defined. |
| `model.js` | The projection engine. `runDeterministic` walks the ledger year by year; `runMonteCarlo` runs the same mechanics across thousands of randomized paths. Contains no figures at all. |
| `app.js` | State, rendering and event wiring. Decides nothing about what a number means. |
| `charts.js` | The charts, drawn by hand as SVG. No charting library. |
| `format.js` | Number and text formatting shared by the charts and the interface. |
| `store.js` | Local storage, import and export. |
| `tests.js` | The checks described above. |
| `index.html`, `style.css` | The page and its styling. |

The discipline worth keeping: **data lives in `config.js`, logic lives in
`model.js`, and neither one hardcodes anything belonging to the other.** If you
find yourself wanting to type a dollar amount into `model.js`, it belongs in
`config.js`. That separation is what keeps the model maintainable across many
sessions instead of degrading into a pile of one-off numbers.

## Where the writing lives

Three jobs that deliberately do not overlap:

- **The Assumptions tab** describes the model's *current* state, generated from
  your inputs and the notes you wrote when you verified them. It is not a
  changelog. It answers "why does the model look like this today", not "what did
  this number used to be".
- **The Open items tab** holds things that still need a decision, a real figure
  or a methodology improvement. Some are raised by the app itself and disappear
  when the underlying thing is resolved. This is different from the known
  limitations on the Assumptions tab: a limitation is a simplification that has
  been disclosed and accepted, an open item is something that should actually
  get resolved.
- **The git history** is the changelog. Each commit message says what changed
  and why. When you want the history of how a number evolved,
  `git log -p -- config.js` gives you real diffs with real timestamps, which is
  strictly better than prose trying to do the same job and drifting out of sync.

If you are tempted to write a dated entry into the Assumptions tab, ask whether
the commit message you are about to write says the same thing.

## Using it on your own numbers

Every figure ships as an illustrative placeholder — round numbers chosen to make
the model run, not advice and not anyone's real situation. Each personal field
stays visibly flagged until you replace it and mark it as your own with a note
saying where the number came from. Headline figures carry an "illustrative" tag
until then, because a projection built on demo numbers should not be able to
look like a plan.

Work through the checklist at the top of the Inputs tab. The short version:

1. Who is in scope, their ages, filing status, and the state and city you are
   taxed in — that last one drives most of the tax treatment.
2. Every income stream, from pay stubs or deposits rather than memory, each one
   marked clearly as gross or take-home. Conflating those is the easiest error
   to make here.
3. Every account balance, from current statements, invested the way the account
   is actually invested rather than a generic split.
4. What the money is for: a home, tuition, a sabbatical, supporting family, care
   costs — with dates and costs in today's dollars.
5. The items on the Verify tab, which are the parts that cannot be inherited
   from anyone else's model. Tax law changes and varies by jurisdiction, so
   those rates are worth nothing until you have checked them for your own
   situation.

**Never type an account number into this or any other app.** Balances,
contribution amounts and fund names are all the model needs. If you keep
statements on disk for reference, keep them in a directory excluded from version
control, and never commit them — not even to a private repository.

## What it does not know

The Assumptions tab keeps a running list, and it reflects what is actually
switched on rather than a fixed set of caveats. The ones worth knowing before
you read any output:

- Independent lognormal returns understate tail risk. Real returns have fatter
  tails and bad years cluster together; independent draws rarely produce the
  multi-year droughts that actually break plans. There is a fat-tailed option,
  which addresses the tails but not the clustering.
- Career risk and market risk are drawn independently unless you couple them.
  Recessions cause both at once, so drawing them separately understates how bad
  the genuinely bad scenarios get.
- Inflation is one flat rate in every path, so a stagflationary period is
  something the model cannot produce at all.
- Taxes are blended effective rates you supply, not brackets. No Roth
  conversions, no loss harvesting, no subsidy cliffs.

A projection is not a prediction. Every number it produces follows from
assumptions you supplied, and the ones about tax, returns and how long you live
are the ones most likely to be wrong.

Not financial, tax or legal advice.
