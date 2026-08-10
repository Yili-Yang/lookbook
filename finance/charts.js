/* charts.js — the charts, drawn by hand as SVG.
 *
 * No charting library, for the same reason the rest of the project has no
 * dependencies: this is a tool you own outright, and a projection you cannot
 * open in five years because a CDN moved is not much of a plan.
 *
 * Every chart takes values already converted to today's dollars by the caller.
 * Doing the deflation at the edge means a chart never silently mixes bases.
 */

const CHART_W = 860;
const CHART_H = 340;
const PAD = { top: 18, right: 18, bottom: 34, left: 68 };

const BUCKET_COLORS = {
  cash: '#c9bfa6',
  bonds: '#9aa89f',
  taxable: '#7f9bb0',
  pretax: '#b4906c',
  roth: '#8f7f9e',
  earmarked: '#c2a08c',
  houseEquity: '#ded6c4',
  debt: '#b4564f',
};

function scale(domain, range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  return x => r0 + ((x - d0) / span) * (r1 - r0);
}

// Axis ticks at values a person would actually choose: 1, 2, 2.5, 5, 10.
function niceTicks(min, max, count) {
  if (min === max) { min -= 1; max += 1; }
  const rawStep = (max - min) / Math.max(1, count);
  const mag = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)));
  const candidates = [1, 2, 2.5, 5, 10].map(m => m * mag);
  const step = candidates.find(c => c >= rawStep) || candidates[candidates.length - 1];
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v);
  return ticks;
}

function svgOpen(className) {
  return `<svg class="chart-svg ${className || ''}" viewBox="0 0 ${CHART_W} ${CHART_H}" role="img">`;
}

function axes(xs, ys, xTicks, yTicks, xLabelEvery) {
  let out = '';
  for (const ty of yTicks) {
    const y = ys(ty);
    out += `<line class="grid" x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${CHART_W - PAD.right}" y2="${y.toFixed(1)}"/>`;
    out += `<text class="axis-label" x="${PAD.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(fmtShort(ty))}</text>`;
  }
  for (let i = 0; i < xTicks.length; i++) {
    if (i % xLabelEvery !== 0 && i !== xTicks.length - 1) continue;
    const x = xs(xTicks[i]);
    out += `<text class="axis-label" x="${x.toFixed(1)}" y="${CHART_H - PAD.bottom + 20}" text-anchor="middle">${xTicks[i]}</text>`;
  }
  return out;
}

function zeroLine(ys, min) {
  if (min >= 0) return '';
  return `<line class="zero-line" x1="${PAD.left}" y1="${ys(0).toFixed(1)}" x2="${CHART_W - PAD.right}" y2="${ys(0).toFixed(1)}"/>`;
}

function crosshair() {
  return `<line class="crosshair hidden" x1="0" y1="${PAD.top}" x2="0" y2="${CHART_H - PAD.bottom}"/>`;
}

function areaPath(xs, ys, years, lower, upper) {
  let top = '', bottom = '';
  for (let i = 0; i < years.length; i++) {
    top += `${i === 0 ? 'M' : 'L'}${xs(years[i]).toFixed(1)},${ys(upper[i]).toFixed(1)}`;
  }
  for (let i = years.length - 1; i >= 0; i--) {
    bottom += `L${xs(years[i]).toFixed(1)},${ys(lower[i]).toFixed(1)}`;
  }
  return top + bottom + 'Z';
}

function linePath(xs, ys, years, values) {
  let out = '';
  for (let i = 0; i < years.length; i++) {
    out += `${i === 0 ? 'M' : 'L'}${xs(years[i]).toFixed(1)},${ys(values[i]).toFixed(1)}`;
  }
  return out;
}

// ── Stacked balances over time ──────────────────────────────────────────────
// Buckets stack upward from zero; a year that ends in debt stacks downward from
// zero instead, so a plan that borrows cannot hide it behind a tall stack.
function stackedAreaChart(years, series) {
  const positiveTotals = years.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.values[i]), 0));
  const negativeTotals = years.map((_, i) => series.reduce((sum, s) => sum + Math.min(0, s.values[i]), 0));
  const yMax = Math.max(1, ...positiveTotals);
  const yMin = Math.min(0, ...negativeTotals);

  const xs = scale([years[0], years[years.length - 1]], [PAD.left, CHART_W - PAD.right]);
  const yTicks = niceTicks(yMin, yMax, 5);
  const ys = scale([Math.min(yMin, yTicks[0]), Math.max(yMax, yTicks[yTicks.length - 1])], [CHART_H - PAD.bottom, PAD.top]);

  let out = svgOpen('chart-stacked');
  out += axes(xs, ys, years, yTicks, Math.ceil(years.length / 10));
  out += zeroLine(ys, yMin);

  const upperRunning = years.map(() => 0);
  const lowerRunning = years.map(() => 0);
  for (const s of series) {
    const lower = [], upper = [];
    for (let i = 0; i < years.length; i++) {
      const v = s.values[i];
      if (v >= 0) {
        lower.push(upperRunning[i]);
        upperRunning[i] += v;
        upper.push(upperRunning[i]);
      } else {
        upper.push(lowerRunning[i]);
        lowerRunning[i] += v;
        lower.push(lowerRunning[i]);
      }
    }
    out += `<path class="area" d="${areaPath(xs, ys, years, lower, upper)}" fill="${s.color}"/>`;
  }
  out += `<path class="total-line" d="${linePath(xs, ys, years, positiveTotals)}"/>`;
  out += crosshair();
  out += `<rect class="hover-target" x="${PAD.left}" y="${PAD.top}" width="${CHART_W - PAD.left - PAD.right}" height="${CHART_H - PAD.top - PAD.bottom}"/>`;
  return out + '</svg>';
}

// ── Monte Carlo percentile fan ──────────────────────────────────────────────
function fanChart(years, bands, deterministic) {
  const all = [];
  for (const p of [5, 95]) for (const v of bands[p]) all.push(v);
  if (deterministic) for (const v of deterministic) all.push(v);
  const yMax = Math.max(1, ...all);
  const yMin = Math.min(0, ...all);

  const xs = scale([years[0], years[years.length - 1]], [PAD.left, CHART_W - PAD.right]);
  const yTicks = niceTicks(yMin, yMax, 5);
  const ys = scale([Math.min(yMin, yTicks[0]), Math.max(yMax, yTicks[yTicks.length - 1])], [CHART_H - PAD.bottom, PAD.top]);

  let out = svgOpen('chart-fan');
  out += axes(xs, ys, years, yTicks, Math.ceil(years.length / 10));
  out += zeroLine(ys, yMin);
  const pairs = [[5, 95, 'band-outer'], [10, 90, 'band-mid'], [25, 75, 'band-inner']];
  for (const [lo, hi, cls] of pairs) {
    out += `<path class="${cls}" d="${areaPath(xs, ys, years, Array.from(bands[lo]), Array.from(bands[hi]))}"/>`;
  }
  out += `<path class="median-line" d="${linePath(xs, ys, years, Array.from(bands[50]))}"/>`;
  if (deterministic) {
    out += `<path class="deterministic-line" d="${linePath(xs, ys, years, deterministic)}"/>`;
  }
  out += crosshair();
  out += `<rect class="hover-target" x="${PAD.left}" y="${PAD.top}" width="${CHART_W - PAD.left - PAD.right}" height="${CHART_H - PAD.top - PAD.bottom}"/>`;
  return out + '</svg>';
}

// ── A single line, used for the share of paths still solvent ────────────────
function shareChart(years, values, thresholdLabel) {
  const xs = scale([years[0], years[years.length - 1]], [PAD.left, CHART_W - PAD.right]);
  const ys = scale([0, 1], [CHART_H - PAD.bottom, PAD.top]);

  let out = svgOpen('chart-share');
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    const y = ys(t);
    out += `<line class="grid" x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${CHART_W - PAD.right}" y2="${y.toFixed(1)}"/>`;
    out += `<text class="axis-label" x="${PAD.left - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end">${Math.round(t * 100)}%</text>`;
  }
  const every = Math.ceil(years.length / 10);
  for (let i = 0; i < years.length; i++) {
    if (i % every !== 0 && i !== years.length - 1) continue;
    out += `<text class="axis-label" x="${xs(years[i]).toFixed(1)}" y="${CHART_H - PAD.bottom + 20}" text-anchor="middle">${years[i]}</text>`;
  }
  out += `<path class="area" d="${areaPath(xs, ys, years, years.map(() => 0), values)}" fill="rgba(107,93,63,0.14)"/>`;
  out += `<path class="median-line" d="${linePath(xs, ys, years, values)}"/>`;
  if (thresholdLabel) {
    out += `<text class="axis-note" x="${CHART_W - PAD.right}" y="${PAD.top + 12}" text-anchor="end">${esc(thresholdLabel)}</text>`;
  }
  out += crosshair();
  out += `<rect class="hover-target" x="${PAD.left}" y="${PAD.top}" width="${CHART_W - PAD.left - PAD.right}" height="${CHART_H - PAD.top - PAD.bottom}"/>`;
  return out + '</svg>';
}

// ── Distribution of final outcomes ──────────────────────────────────────────
function histogramChart(samples, binCount) {
  const n = samples.length;
  if (!n) return '';
  const lo = samples[0];
  const hi = samples[n - 1];
  const bins = Math.max(8, binCount || 36);
  const width = (hi - lo) / bins || 1;
  const counts = new Array(bins).fill(0);
  for (let i = 0; i < n; i++) {
    const b = Math.min(bins - 1, Math.max(0, Math.floor((samples[i] - lo) / width)));
    counts[b]++;
  }
  const maxCount = Math.max(...counts);
  const xs = scale([lo, hi], [PAD.left, CHART_W - PAD.right]);
  const ys = scale([0, maxCount], [CHART_H - PAD.bottom, PAD.top]);

  let out = svgOpen('chart-hist');
  const xTicks = niceTicks(lo, hi, 6);
  for (const t of xTicks) {
    if (t < lo || t > hi) continue;
    out += `<text class="axis-label" x="${xs(t).toFixed(1)}" y="${CHART_H - PAD.bottom + 20}" text-anchor="middle">${esc(fmtShort(t))}</text>`;
  }
  const barW = (CHART_W - PAD.left - PAD.right) / bins;
  for (let b = 0; b < bins; b++) {
    const binLo = lo + b * width;
    const h = (CHART_H - PAD.bottom) - ys(counts[b]);
    const fill = binLo < 0 ? BUCKET_COLORS.debt : 'rgba(107,93,63,0.55)';
    out += `<rect class="hist-bar" x="${(PAD.left + b * barW).toFixed(1)}" y="${ys(counts[b]).toFixed(1)}" width="${Math.max(1, barW - 1).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" fill="${fill}"><title>${esc(fmtShort(binLo))} to ${esc(fmtShort(binLo + width))}: ${counts[b]} of ${n} paths</title></rect>`;
  }
  if (lo < 0) {
    out += `<line class="zero-line" x1="${xs(0).toFixed(1)}" y1="${PAD.top}" x2="${xs(0).toFixed(1)}" y2="${CHART_H - PAD.bottom}"/>`;
  }
  return out + '</svg>';
}

// ── Hover behaviour ─────────────────────────────────────────────────────────
// One shared implementation: find the year under the cursor, move the
// crosshair, and hand the index back to the caller to fill in a tooltip.
function attachHover(container, years, describe) {
  const svg = container.querySelector('svg');
  if (!svg) return;
  const target = svg.querySelector('.hover-target');
  const line = svg.querySelector('.crosshair');
  if (!target || !line) return;

  let tip = container.querySelector('.chart-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tooltip hidden';
    container.appendChild(tip);
  }

  const xs = scale([years[0], years[years.length - 1]], [PAD.left, CHART_W - PAD.right]);

  function onMove(event) {
    const rect = svg.getBoundingClientRect();
    const vx = ((event.clientX - rect.left) / rect.width) * CHART_W;
    const span = years[years.length - 1] - years[0];
    const raw = years[0] + ((vx - PAD.left) / (CHART_W - PAD.left - PAD.right)) * span;
    let index = Math.round(raw - years[0]);
    index = Math.max(0, Math.min(years.length - 1, index));

    const x = xs(years[index]);
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.classList.remove('hidden');

    tip.innerHTML = describe(index);
    tip.classList.remove('hidden');
    const left = (x / CHART_W) * rect.width;
    const flip = left > rect.width * 0.6;
    tip.style.left = flip ? 'auto' : `${left + 14}px`;
    tip.style.right = flip ? `${rect.width - left + 14}px` : 'auto';
  }

  function onLeave() {
    line.classList.add('hidden');
    tip.classList.add('hidden');
  }

  target.addEventListener('mousemove', onMove);
  target.addEventListener('mouseleave', onLeave);
  svg.addEventListener('touchmove', event => {
    if (event.touches.length) onMove(event.touches[0]);
  }, { passive: true });
}
