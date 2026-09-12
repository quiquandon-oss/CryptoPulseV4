// docs/app.js
// Shared across all V4 pages.
window.V4_API_BASE = localStorage.getItem('v4-api-base-override') || 'https://cryptopulse-v4.quiquandon.workers.dev';

async function v4Fetch(path) {
  const res = await fetch(`${window.V4_API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> HTTP ${res.status}`);
  return res.json();
}

const FRESHNESS_DOT = { LIVE: 'bg-up', RECENT: 'bg-recent', STALE: 'bg-stale', UNAVAILABLE: 'bg-unavailable', OK: 'bg-up', ERROR: 'bg-unavailable' };
const DIRECTION_COLOR = { BULLISH: 'text-up', BEARISH: 'text-down', NEUTRAL: 'text-muted' };

function fmtAge(ms) {
  if (ms == null) return 'no data';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m ago`;
}

function fmtPct(v) {
  if (v == null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// --- Theme toggle -----------------------------------------------------
// The FOUC-prevention step (reading localStorage and setting data-theme
// before first paint) happens in an inline <script> in each page's <head>,
// before theme.css loads. This just wires up the visible toggle button.
function initThemeToggle() {
  document.querySelectorAll('.theme-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (isLight) {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('v4-theme', 'dark');
      } else {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('v4-theme', 'light');
      }
    });
  });
}

// --- Shared nav ---------------------------------------------------------
const NAV_PAGES = [
  { href: 'index.html', label: 'Dashboard' },
  { href: 'portfolio.html', label: 'My Assets' },
  { href: 'performance.html', label: 'Performance' },
  { href: 'health.html', label: 'Health' },
  { href: 'audit.html', label: 'Audit' },
  { href: 'settings.html', label: 'Settings' },
];

function renderNav(activeHref) {
  const el = document.getElementById('siteNav');
  if (!el) return;
  el.innerHTML = NAV_PAGES.map((p) => {
    const active = p.href === activeHref;
    return `<a href="${p.href}" class="text-xs px-2.5 py-1 rounded-md whitespace-nowrap ${active ? 'bg-accent-soft text-accent' : 'text-faint hover-text-muted'}">${p.label}</a>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', initThemeToggle);

// --- Price + signal timeline chart --------------------------------------
// points: [{ ts, price, direction, score }], oldest first.
function renderPriceSignalChart(container, points) {
  if (!points || points.length < 2) {
    container.innerHTML = '<div class="px-4 py-10 text-center text-sm text-faint">Not enough history yet for a chart.</div>';
    return;
  }
  const W = 600, H = 220, priceH = 150, scoreTop = 165, scoreH = 45, pad = 8;
  const prices = points.map((p) => p.price).filter((p) => p != null);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const rangeP = (maxP - minP) || 1;
  const n = points.length;
  const x = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const yPrice = (p) => priceH - pad - ((p - minP) / rangeP) * (priceH - pad * 2);

  const pricePoints = points.map((p, i) => (p.price != null ? `${x(i).toFixed(1)},${yPrice(p.price).toFixed(1)}` : null)).filter(Boolean).join(' ');

  const maxScore = Math.max(6, ...points.map((p) => Math.abs(p.score || 0)));
  const barW = Math.max(1.5, ((W - pad * 2) / n) * 0.6);
  const scoreMid = scoreTop + scoreH / 2;
  const bars = points.map((p, i) => {
    const h = (Math.abs(p.score || 0) / maxScore) * (scoreH / 2);
    const color = p.direction === 'BULLISH' ? 'var(--up)' : p.direction === 'BEARISH' ? 'var(--down)' : 'var(--faint)';
    const yTop = (p.score || 0) >= 0 ? scoreMid - h : scoreMid;
    return `<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${color}" />`;
  }).join('');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">
      <polyline points="${pricePoints}" fill="none" stroke="var(--accent)" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
      <line x1="${pad}" y1="${scoreMid}" x2="${W - pad}" y2="${scoreMid}" stroke="var(--border)" stroke-width="1" />
      ${bars}
    </svg>
    <div class="flex justify-between text-[10px] text-faint mt-1 px-1">
      <span>${new Date(points[0].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })}</span>
      <span class="text-accent">— price</span>
      <span>${new Date(points[n - 1].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })}</span>
    </div>`;
}

// --- Portfolio: allocation donut ----------------------------------------
function renderAllocationDonut(container, allocation) {
  const filtered = allocation.filter((a) => a.value != null && a.value > 0);
  if (!filtered.length) {
    container.innerHTML = '<div class="text-sm text-faint p-4">No allocation data yet.</div>';
    return;
  }
  const total = filtered.reduce((s, a) => s + a.value, 0);
  const colors = ['var(--accent)', 'var(--up)', 'var(--warn)', 'var(--down)', 'var(--muted)'];
  const R = 60, C = 2 * Math.PI * R, CX = 80, CY = 80;
  let offset = 0;
  const circles = filtered.map((a, i) => {
    const frac = a.value / total;
    const dash = frac * C;
    const circle = `<circle cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="24" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
    offset += dash;
    return circle;
  }).join('');
  const legend = filtered.map((a, i) => `
    <a href="asset.html?asset=${a.asset}" class="flex items-center gap-2 text-xs hover-text-muted">
      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${colors[i % colors.length]}"></span>
      <span class="font-mono">${a.asset}</span>
      <span class="text-faint">${((a.allocationPct ?? 0) * 100).toFixed(1)}%</span>
    </a>`).join('');
  container.innerHTML = `
    <div class="flex items-center gap-6 flex-wrap">
      <svg viewBox="0 0 160 160" class="w-28 h-28 shrink-0" style="transform: rotate(-90deg)">${circles}</svg>
      <div class="flex flex-col gap-2">${legend}</div>
    </div>`;
}

// --- Portfolio: value-over-time chart (value line + invested-capital reference line) ---
function renderPortfolioValueChart(container, points) {
  const valid = points.filter((p) => p.total_value_usd != null);
  if (valid.length < 2) {
    container.innerHTML = '<div class="px-4 py-10 text-center text-sm text-faint">Not enough history yet — this fills in as snapshots accumulate.</div>';
    return;
  }
  const W = 600, H = 180, pad = 8;
  const allVals = valid.flatMap((p) => [p.total_value_usd, p.invested_capital_usd]).filter((v) => v != null);
  const min = Math.min(...allVals), max = Math.max(...allVals);
  const range = (max - min) || 1;
  const n = valid.length;
  const x = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / range) * (H - pad * 2);

  const valueLine = valid.map((p, i) => `${x(i).toFixed(1)},${y(p.total_value_usd).toFixed(1)}`).join(' ');
  const investedPoints = valid.filter((p) => p.invested_capital_usd != null);
  const investedLine = investedPoints.map((p) => `${x(valid.indexOf(p)).toFixed(1)},${y(p.invested_capital_usd).toFixed(1)}`).join(' ');

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">
      ${investedLine ? `<polyline points="${investedLine}" fill="none" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="4 3"/>` : ''}
      <polyline points="${valueLine}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div class="flex justify-between items-center text-[10px] text-faint mt-1 px-1">
      <span>${new Date(valid[0].ts).toLocaleDateString()}</span>
      <span><span class="text-accent">— </span>value &nbsp; <span class="text-faint">- - </span>invested</span>
      <span>${new Date(valid[n - 1].ts).toLocaleDateString()}</span>
    </div>`;
}
