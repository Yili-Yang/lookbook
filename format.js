/* format.js — number and text formatting shared by the charts and the UI. */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// A true minus sign rather than a hyphen: negative money is worth noticing.
function signPrefix(x) { return x < 0 ? '\u2212' : ''; }

function fmtMoney(x) {
  if (x == null || !isFinite(x)) return '\u2014';
  const rounded = Math.round(Math.abs(x));
  return signPrefix(x) + '$' + rounded.toLocaleString('en-US');
}

function fmtShort(x) {
  if (x == null || !isFinite(x)) return '\u2014';
  const abs = Math.abs(x);
  const sign = signPrefix(x);
  if (abs >= 1e9) return sign + '$' + (abs / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B';
  if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + 'M';
  if (abs >= 1e3) return sign + '$' + Math.round(abs / 1e3) + 'k';
  return sign + '$' + Math.round(abs);
}

function fmtPct(x, digits) {
  if (x == null || !isFinite(x)) return '\u2014';
  return (x * 100).toFixed(digits == null ? 1 : digits) + '%';
}

function fmtSigned(x) {
  if (x == null || !isFinite(x)) return '\u2014';
  if (Math.round(x) === 0) return 'no change';
  return (x > 0 ? '+' : '\u2212') + '$' + Math.round(Math.abs(x)).toLocaleString('en-US');
}

// Percent-typed fields are stored as decimals and edited as percents, so the
// round trip has to survive values like 0.238 without showing 23.799999999.
function pctToInput(x) {
  if (x == null || !isFinite(x)) return '';
  return String(Math.round(x * 1e6) / 1e4);
}

function inputToPct(s) {
  const n = parseFloat(String(s).replace(/[%\s,]/g, ''));
  if (!isFinite(n)) return 0;
  return Math.round(n * 1e4) / 1e6;
}

function parseNumber(s) {
  const n = parseFloat(String(s).replace(/[$,\s]/g, ''));
  return isFinite(n) ? n : 0;
}
