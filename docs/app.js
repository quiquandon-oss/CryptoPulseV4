// docs/app.js — Shared frontend components & institutional chart engine
//
// CACHE BUSTING: every page loads this via <script src="app.js?v=XXXX">.
// GitHub Pages' CDN and browsers cache this aggressively with no version-
// tracked build step in this repo — a real change here was once invisible
// to the user for that exact reason. Bump the ?v= query param on every
// page whenever this file changes, or the deploy will look like it did
// nothing even though the source is correct.
window.V4_API_BASE = localStorage.getItem('v4-api-base-override') || 'https://cryptopulse-v4.quiquandon.workers.dev';

async function v4Fetch(path) {
  const res = await fetch(`${window.V4_API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> HTTP ${res.status}`);
  return res.json();
}

// Note: CSS class names below don't match their own colors (bg-recent is
// amber/--warn, bg-stale is red/--down — a historical naming mismatch, not
// touched here to avoid a wider CSS rename). Reused by color, not by name,
// to match health.html's severity mapping: green/amber/red for OK/STALE/UNAVAILABLE.
const FRESHNESS_DOT = { LIVE: 'bg-up', RECENT: 'bg-up', STALE: 'bg-recent', UNAVAILABLE: 'bg-stale', OK: 'bg-up', ERROR: 'bg-stale' };
const DIRECTION_COLOR = { BULLISH: 'text-up', BEARISH: 'text-down', NEUTRAL: 'text-muted' };

// --- Shared: smooth curves for every line chart ---------------------------
// Catmull-Rom -> cubic Bezier conversion (tension 1/6, the standard factor).
// Straight polyline segments are the single biggest visual cue that reads as
// "spreadsheet" rather than "app" — this one helper, used everywhere a line
// chart draws its series, is what makes every chart in the app read as one
// consistent, deliberate visual language instead of assembled one-off SVGs.
function smoothPathD(pts) {
  if (!pts.length) return '';
  if (pts.length === 1) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  if (pts.length === 2) return `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)} L${pts[1].x.toFixed(1)},${pts[1].y.toFixed(1)}`;
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

/** Same smooth line, closed down to a baseline y for a gradient area fill. */
function smoothFillPathD(pts, baselineY) {
  if (pts.length < 2) return '';
  const line = smoothPathD(pts);
  return `${line} L${pts[pts.length - 1].x.toFixed(1)},${baselineY.toFixed(1)} L${pts[0].x.toFixed(1)},${baselineY.toFixed(1)} Z`;
}

/** A soft glow filter def, reserved for the "wow" screens (Dashboard, Market Pulse) per the Option C split. */
function glowFilterDefs(id, color) {
  return `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
    <feGaussianBlur stdDeviation="4" result="blur"/>
    <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>`;
}

/** The pulsing "live" marker — only ever called when freshness genuinely says LIVE/RECENT, never on stale or backfilled data. */
function livePulseMarker(x, y, color) {
  return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}" class="live-pulse-dot"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="none" stroke="${color}" stroke-width="1.5" class="live-pulse-ring"/>`;
}

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

function fmtUsd(v) {
  if (v == null) return '—';
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// --- Standard Data State Renderer ------------------------------------
function renderDataState(container, state, message = '') {
  const states = {
    LOADING: '<div class="px-4 py-8 text-center text-sm text-faint font-mono">Loading data...</div>',
    INSUFFICIENT_DATA: `<div class="state-container bg-surface"><p class="text-xs font-mono text-warn">INSUFFICIENT_DATA</p><p class="text-xs text-faint mt-1">${escapeHtml(message || 'Historical observations are insufficient for this calculation.')}</p></div>`,
    EMPTY: `<div class="state-container bg-surface"><p class="text-xs font-mono text-faint">NO DATA</p><p class="text-xs text-faint mt-1">${escapeHtml(message || 'No records found.')}</p></div>`,
    DEGRADED: `<div class="state-container bg-surface"><p class="text-xs font-mono text-warn">DEGRADED</p><p class="text-xs text-faint mt-1">${escapeHtml(message || 'Telemetry or market feed degraded.')}</p></div>`,
    ERROR: `<div class="state-container bg-surface"><p class="text-xs font-mono text-down">ERROR</p><p class="text-xs text-faint mt-1">${escapeHtml(message)}</p></div>`,
  };
  container.innerHTML = states[state] || states.EMPTY;
}

// --- Theme toggle -----------------------------------------------------
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
  { href: 'market-pulse.html', label: 'Market Pulse' },
  { href: 'portfolio.html', label: 'My Assets' },
  { href: 'performance.html', label: 'Performance' },
  { href: 'health.html', label: 'Health' },
  { href: 'audit.html', label: 'Audit' },
  { href: 'settings.html', label: 'Settings' },
];

function renderNav(activeHref) {
  // Desktop Top Nav
  const topEl = document.getElementById('siteNav');
  if (topEl) {
    topEl.className = 'hidden md:flex items-center gap-1 mb-6 overflow-x-auto desktop-nav-only';
    topEl.innerHTML = NAV_PAGES.map((p) => {
      const active = p.href === activeHref;
      return `<a href="${p.href}" class="text-xs px-3 py-1.5 rounded-md font-mono transition-colors ${active ? 'bg-accent-soft text-accent border border-accent-30 font-medium' : 'text-faint hover-text-muted hover-bg-surface'}">${p.label}</a>`;
    }).join('');
  }

  // Mobile Bottom Nav
  let bottomNav = document.getElementById('mobileBottomNav');
  if (!bottomNav) {
    bottomNav = document.createElement('nav');
    bottomNav.id = 'mobileBottomNav';
    bottomNav.className = 'bottom-nav mobile-nav-only md:hidden';
    document.body.appendChild(bottomNav);
  }

  const isMoreActive = activeHref === 'audit.html' || activeHref === 'settings.html' || activeHref === 'asset.html' || activeHref === 'market-pulse.html';

  bottomNav.innerHTML = `
    <div class="grid grid-cols-5 h-full max-w-lg mx-auto">
      <a href="index.html" class="bottom-nav-item ${activeHref === 'index.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
        <span>Dashboard</span>
      </a>
      <a href="portfolio.html" class="bottom-nav-item ${activeHref === 'portfolio.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>
        <span>My Assets</span>
      </a>
      <a href="performance.html" class="bottom-nav-item ${activeHref === 'performance.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
        <span>Performance</span>
      </a>
      <a href="health.html" class="bottom-nav-item ${activeHref === 'health.html' ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
        <span>Health</span>
      </a>
      <button id="moreNavBtn" type="button" class="bottom-nav-item ${isMoreActive ? 'active' : ''}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
        <span>More</span>
      </button>
    </div>
    <div id="moreNavMenu" class="hidden fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex flex-col justify-end p-4">
      <div class="bg-surface border border-border rounded-xl p-4 max-w-sm w-full mx-auto space-y-3 shadow-2xl">
        <div class="flex items-center justify-between pb-2 border-b border-border">
          <span class="font-mono text-xs font-semibold uppercase text-faint">More Options</span>
          <button id="closeMoreNav" class="text-faint hover:text-ink text-sm p-1 font-mono">&times;</button>
        </div>
        <div class="space-y-1 font-mono text-xs">
          <a href="market-pulse.html" class="flex items-center justify-between p-2.5 rounded bg-accent-soft border border-accent-30 mb-1">
            <span class="font-medium text-accent">Market Pulse</span>
            <span class="text-accent">&rarr;</span>
          </a>
          <p class="text-[10px] text-faint uppercase tracking-wider py-1 font-semibold">Signals & Assets</p>
          <div class="grid grid-cols-3 gap-2">
            <a href="asset.html?asset=BTC" class="flex flex-col items-center justify-center p-2 rounded bg-elevated border border-border hover:border-accent">
              <span class="font-semibold text-accent">BTC</span>
              <span class="text-[9px] text-faint">Signal</span>
            </a>
            <a href="asset.html?asset=ETH" class="flex flex-col items-center justify-center p-2 rounded bg-elevated border border-border hover:border-accent">
              <span class="font-semibold text-accent">ETH</span>
              <span class="text-[9px] text-faint">Signal</span>
            </a>
            <a href="asset.html?asset=LINK" class="flex flex-col items-center justify-center p-2 rounded bg-elevated border border-border hover:border-accent">
              <span class="font-semibold text-accent">LINK</span>
              <span class="text-[9px] text-faint">Signal</span>
            </a>
          </div>
          <div class="pt-2 space-y-1">
            <a href="audit.html" class="flex items-center justify-between p-2.5 rounded bg-elevated hover-bg-surface border border-border">
              <span class="font-medium text-ink">Audit & Evidence Logs</span>
              <span class="text-faint">&rarr;</span>
            </a>
            <a href="settings.html" class="flex items-center justify-between p-2.5 rounded bg-elevated hover-bg-surface border border-border">
              <span class="font-medium text-ink">System Settings</span>
              <span class="text-faint">&rarr;</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  `;

  const moreBtn = document.getElementById('moreNavBtn');
  const moreMenu = document.getElementById('moreNavMenu');
  const closeBtn = document.getElementById('closeMoreNav');

  if (moreBtn && moreMenu) {
    moreBtn.addEventListener('click', () => {
      moreMenu.classList.remove('hidden');
    });
    closeBtn?.addEventListener('click', () => {
      moreMenu.classList.add('hidden');
    });
    moreMenu.addEventListener('click', (e) => {
      if (e.target === moreMenu) moreMenu.classList.add('hidden');
    });
  }
}

document.addEventListener('DOMContentLoaded', initThemeToggle);

// --- Visualization 1: Portfolio Value Equity Curve ----------------------
// --- Shared: touch/hover value inspection on line charts -----------------
// Every render*Chart function below builds a fixed-viewBox SVG; this wires a
// crosshair + tooltip onto it that works identically for mouse hover and
// touch, converting the pointer's real screen position into viewBox
// coordinates (since the SVG renders at whatever width its container is,
// not its viewBox width).
function wireChartTooltip(container, viewBoxW, viewBoxH, xPositions, formatFn) {
  const svg = container.querySelector('svg');
  if (!svg || !xPositions.length) return;
  const ns = 'http://www.w3.org/2000/svg';

  const guide = document.createElementNS(ns, 'line');
  guide.setAttribute('y1', '0');
  guide.setAttribute('y2', String(viewBoxH));
  guide.setAttribute('stroke', 'var(--faint)');
  guide.setAttribute('stroke-width', '1');
  guide.style.display = 'none';
  svg.appendChild(guide);

  const dot = document.createElementNS(ns, 'circle');
  dot.setAttribute('r', '3.5');
  dot.setAttribute('fill', 'var(--accent)');
  dot.setAttribute('stroke', 'var(--surface)');
  dot.setAttribute('stroke-width', '1.5');
  dot.style.display = 'none';
  svg.appendChild(dot);

  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  let tooltip = container.querySelector(':scope > .chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip absolute pointer-events-none z-10 bg-elevated border border-border rounded-md px-2 py-1 text-[10px] font-mono text-ink shadow-sm';
    container.appendChild(tooltip);
  }

  function nearestIndex(viewBoxX) {
    let nearest = 0, bestDiff = Infinity;
    for (let i = 0; i < xPositions.length; i++) {
      const d = Math.abs(xPositions[i] - viewBoxX);
      if (d < bestDiff) { bestDiff = d; nearest = i; }
    }
    return nearest;
  }

  function show(clientX) {
    const rect = svg.getBoundingClientRect();
    const relX = clientX - rect.left;
    if (relX < -5 || relX > rect.width + 5 || !rect.width) { hide(); return; }
    const i = nearestIndex((relX / rect.width) * viewBoxW);
    const info = formatFn(i);
    if (!info) { hide(); return; }

    const vx = xPositions[i];
    guide.setAttribute('x1', String(vx));
    guide.setAttribute('x2', String(vx));
    guide.style.display = '';
    if (info.y != null) {
      dot.setAttribute('cx', String(vx));
      dot.setAttribute('cy', String(info.y));
      dot.style.display = '';
    } else {
      dot.style.display = 'none';
    }

    tooltip.innerHTML = `<div class="font-semibold text-ink">${info.value}</div><div class="text-faint">${info.label}</div>`;
    const pxPerViewBoxUnit = rect.width / viewBoxW;
    const tooltipWidth = tooltip.offsetWidth || 90;
    let leftPx = vx * pxPerViewBoxUnit - tooltipWidth / 2;
    leftPx = Math.min(Math.max(leftPx, 2), rect.width - tooltipWidth - 2);
    tooltip.style.left = `${leftPx}px`;
    tooltip.style.top = '2px';
    tooltip.classList.add('tooltip-visible');
  }
  function hide() {
    guide.style.display = 'none';
    dot.style.display = 'none';
    tooltip.classList.remove('tooltip-visible');
  }

  svg.style.touchAction = 'pan-y';
  svg.addEventListener('mousemove', (e) => show(e.clientX));
  svg.addEventListener('mouseleave', hide);
  svg.addEventListener('touchstart', (e) => show(e.touches[0].clientX), { passive: true });
  svg.addEventListener('touchmove', (e) => show(e.touches[0].clientX), { passive: true });
  svg.addEventListener('touchend', hide);
}

function renderPortfolioValueChart(container, points, opts = {}) {
  const valid = (points || []).filter((p) => p.total_value_usd != null);
  if (valid.length < 2) {
    renderDataState(container, 'INSUFFICIENT_DATA', 'No verified portfolio snapshots prior to April 2026.');
    return;
  }
  const { W, H, isFullscreen } = getChartDimensions(600, 220);
  const pad = 12;
  const vals = valid.map((p) => p.total_value_usd);
  const rawMin = Math.min(...vals), rawMax = Math.max(...vals);
  const breathing = (rawMax - rawMin) * 0.12 || Math.abs(rawMax) * 0.02 || 1;
  const min = rawMin - breathing, max = rawMax + breathing;
  const range = (max - min) || 1;
  const n = valid.length;
  const x = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / range) * (H - pad * 2);

  const valuePts = valid.map((p, i) => ({ x: x(i), y: y(p.total_value_usd) }));
  const investedPoints = valid.filter((p) => p.invested_capital_usd != null);
  const investedPts = investedPoints.map((p) => ({ x: x(valid.indexOf(p)), y: y(p.invested_capital_usd) }));
  const lastInvested = investedPoints[investedPoints.length - 1]?.invested_capital_usd;
  const investedOffScale = lastInvested != null && (lastInvested < min || lastInvested > max);
  const clipId = `plotclip-${Math.random().toString(36).slice(2, 9)}`;
  const gradId = `plotgrad-${Math.random().toString(36).slice(2, 9)}`;

  const trendUp = vals[vals.length - 1] >= vals[0];
  const lineColor = trendUp ? 'var(--up)' : 'var(--down)';
  const fillPath = smoothFillPathD(valuePts, H - pad);
  const lastPt = valuePts[valuePts.length - 1];
  const showPulse = !!(opts.showLivePulse && opts.isLive);
  const gridSvg = isFullscreen ? yAxisGridSvg(min, max, pad, W, H, (v) => fmtUsd(v)) : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">
      <defs>
        <clipPath id="${clipId}"><rect x="${pad}" y="${pad}" width="${W - pad * 2}" height="${H - pad * 2}"/></clipPath>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridSvg}
      <path d="${fillPath}" fill="url(#${gradId})" clip-path="url(#${clipId})"/>
      ${investedPts.length ? `<path d="${smoothPathD(investedPts)}" fill="none" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="4 3" clip-path="url(#${clipId})"/>` : ''}
      <path d="${smoothPathD(valuePts)}" fill="none" stroke="${lineColor}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
      ${showPulse ? livePulseMarker(lastPt.x, lastPt.y, lineColor) : ''}
    </svg>
    <div class="flex justify-between items-center ${captionClass(isFullscreen)} font-mono text-faint mt-1 px-1">
      <span>${new Date(valid[0].ts).toLocaleDateString()}</span>
      <span><span class="${trendUp ? 'text-up' : 'text-down'}">— </span>value &nbsp; <span class="text-faint">- - </span>invested${investedOffScale ? ` (${fmtUsd(lastInvested)}, off-scale)` : ''}</span>
      <span>${new Date(valid[n - 1].ts).toLocaleDateString()}</span>
    </div>`;

  wireChartTooltip(container, W, H, valid.map((_, i) => x(i)), (i) => ({
    value: fmtUsd(valid[i].total_value_usd),
    label: new Date(valid[i].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: n < 40 ? '2-digit' : undefined, minute: n < 40 ? '2-digit' : undefined }),
    y: y(valid[i].total_value_usd),
  }));
}

// --- Visualization 2: Cumulative P/L History ---------------------------
function renderCumulativePnlChart(container, points) {
  const valid = (points || []).filter((p) => p.unrealized_pnl_usd != null);
  if (valid.length < 2) {
    renderDataState(container, 'INSUFFICIENT_DATA', 'Insufficient snapshot history to plot cumulative P/L.');
    return;
  }
  const { W, H, isFullscreen } = getChartDimensions(600, 200);
  const pad = 12;
  // Scale to the P/L series' own range — do NOT force 0 into it. A portfolio
  // sitting consistently around -$700 gets squashed near one edge if the
  // range is forced to span all the way up to 0; the day-to-day P/L movement
  // that's actually the point of this chart is what should fill the space.
  const pnls = valid.map((p) => p.unrealized_pnl_usd);
  const rawMin = Math.min(...pnls), rawMax = Math.max(...pnls);
  const breathing = (rawMax - rawMin) * 0.12 || Math.abs(rawMax) * 0.02 || 1;
  const min = rawMin - breathing, max = rawMax + breathing;
  const range = (max - min) || 1;
  const n = valid.length;
  const x = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / range) * (H - pad * 2);
  const zeroY = y(0);
  const zeroInRange = zeroY >= pad && zeroY <= H - pad;

  const pnlPts = valid.map((p, i) => ({ x: x(i), y: y(p.unrealized_pnl_usd) }));
  const lastPnl = pnls[pnls.length - 1];
  const strokeColor = lastPnl >= 0 ? 'var(--up)' : 'var(--down)';
  const gradId = `plotgrad-${Math.random().toString(36).slice(2, 9)}`;
  const fillPath = smoothFillPathD(pnlPts, H - pad);
  const gridSvg = isFullscreen ? yAxisGridSvg(min, max, pad, W, H, (v) => `${v >= 0 ? '+' : ''}${fmtUsd(v)}`) : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${strokeColor}" stop-opacity="0.28"/>
          <stop offset="100%" stop-color="${strokeColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridSvg}
      <path d="${fillPath}" fill="url(#${gradId})"/>
      ${zeroInRange ? `<line x1="${pad}" y1="${zeroY}" x2="${W - pad}" y2="${zeroY}" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="2 2" />` : ''}
      <path d="${smoothPathD(pnlPts)}" fill="none" stroke="${strokeColor}" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div class="flex justify-between items-center ${captionClass(isFullscreen)} font-mono text-faint mt-1 px-1">
      <span>${new Date(valid[0].ts).toLocaleDateString()}</span>
      <span class="${lastPnl >= 0 ? 'text-up' : 'text-down'} font-medium">Net P/L: ${fmtUsd(lastPnl)}</span>
      <span>${new Date(valid[n - 1].ts).toLocaleDateString()}</span>
    </div>`;

  wireChartTooltip(container, W, H, valid.map((_, i) => x(i)), (i) => ({
    value: `${valid[i].unrealized_pnl_usd >= 0 ? '+' : ''}${fmtUsd(valid[i].unrealized_pnl_usd)}`,
    label: new Date(valid[i].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: n < 40 ? '2-digit' : undefined, minute: n < 40 ? '2-digit' : undefined }),
    y: y(valid[i].unrealized_pnl_usd),
  }));
}

// --- Visualization 3: Portfolio Allocation Donut -----------------------
function renderAllocationDonut(container, allocation) {
  const filtered = (allocation || []).filter((a) => a.value != null && a.value > 0);
  if (!filtered.length) {
    renderDataState(container, 'EMPTY', 'No active portfolio asset balances.');
    return;
  }
  const total = filtered.reduce((s, a) => s + a.value, 0);
  const colors = ['var(--accent)', 'var(--up)', 'var(--warn)', 'var(--down)', 'var(--accent-blue)'];
  const R = 60, C = 2 * Math.PI * R, CX = 80, CY = 80;
  let offset = 0;
  const circles = filtered.map((a, i) => {
    const frac = a.value / total;
    const dash = frac * C;
    const circle = `<circle data-asset="${a.asset}" class="donut-slice" cx="${CX}" cy="${CY}" r="${R}" fill="none" stroke="${colors[i % colors.length]}" stroke-width="20" stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-offset).toFixed(2)}"/>`;
    offset += dash;
    return circle;
  }).join('');
  const legend = filtered.map((a, i) => `
    <a href="asset.html?asset=${a.asset}" data-asset="${a.asset}" class="donut-legend-item flex items-center gap-2 text-xs font-mono hover-text-muted">
      <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${colors[i % colors.length]}"></span>
      <span class="font-medium">${a.asset}</span>
      <span class="text-faint">${((a.allocationPct ?? 0) * 100).toFixed(1)}%</span>
    </a>`).join('');
  container.innerHTML = `
    <div class="flex items-center gap-6 flex-wrap justify-center sm:justify-start">
      <svg viewBox="0 0 160 160" class="w-32 h-32 shrink-0" style="transform: rotate(-90deg)">${circles}</svg>
      <div class="flex flex-col gap-2">${legend}</div>
    </div>`;

  const slices = container.querySelectorAll('.donut-slice');
  const legendItems = container.querySelectorAll('.donut-legend-item');
  const setActive = (asset) => {
    slices.forEach((s) => {
      const match = !asset || s.dataset.asset === asset;
      s.style.opacity = match ? '1' : '0.3';
      s.style.strokeWidth = asset && match ? '23' : '20';
    });
    legendItems.forEach((l) => l.style.opacity = (!asset || l.dataset.asset === asset) ? '1' : '0.5');
  };
  [...slices, ...legendItems].forEach((el) => {
    el.addEventListener('mouseenter', () => setActive(el.dataset.asset));
    el.addEventListener('mouseleave', () => setActive(null));
    el.addEventListener('touchstart', () => setActive(el.dataset.asset), { passive: true });
  });
}

// --- Visualization 4: Asset Performance Comparison ---------------------
function renderAssetPerformanceChart(container, assetsSummary) {
  if (!assetsSummary || !assetsSummary.length) {
    renderDataState(container, 'EMPTY', 'No asset performance metrics available.');
    return;
  }
  const valid = assetsSummary.filter((a) => a.pnlPct != null);
  const bars = valid.map((a) => {
    const pnl = a.pnlPct * 100;
    const isUp = pnl >= 0;
    const barColor = isUp ? 'bg-up' : 'bg-down';
    const widthPct = Math.min(100, Math.abs(pnl) * 2).toFixed(1);
    return `
      <div class="flex items-center gap-3 text-xs font-mono">
        <span class="w-12 shrink-0 font-medium">${a.asset}</span>
        <div class="flex-1 bg-surface h-4 rounded overflow-hidden flex items-center relative border border-border">
          <div class="${barColor} h-full transition-all duration-300" style="width: ${widthPct}%"></div>
        </div>
        <span class="${isUp ? 'text-up' : 'text-down'} w-16 text-right shrink-0">${fmtPct(a.pnlPct)}</span>
      </div>`;
  }).join('');

  container.innerHTML = `<div class="space-y-2.5">${bars}</div>`;
}

// --- Visualization 5: Portfolio vs BTC Normalized Benchmark --------------
function renderBenchmarkChart(container, benchmarkData) {
  if (!benchmarkData || benchmarkData.status !== 'OK' || !benchmarkData.points || benchmarkData.points.length < 2) {
    renderDataState(container, 'INSUFFICIENT_DATA', benchmarkData?.message || 'Insufficient overlapping data for benchmark chart.');
    return;
  }
  const points = benchmarkData.points;
  const { W, H, isFullscreen } = getChartDimensions(600, 180);
  const pad = 12;
  const allVals = points.flatMap((p) => [p.portfolioNormalized, p.btcNormalized]).filter((v) => v != null);
  const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
  const breathing = (rawMax - rawMin) * 0.08 || 1;
  const min = rawMin - breathing, max = rawMax + breathing;
  const range = (max - min) || 1;
  const n = points.length;
  const x = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / range) * (H - pad * 2);

  const portPts = points.map((p, i) => ({ x: x(i), y: y(p.portfolioNormalized) }));
  const btcPoints = points.filter((p) => p.btcNormalized != null);
  const btcPts = btcPoints.map((p) => ({ x: x(points.indexOf(p)), y: y(p.btcNormalized) }));
  const gradId = `plotgrad-${Math.random().toString(36).slice(2, 9)}`;
  const trendUp = points[n - 1].portfolioNormalized >= points[0].portfolioNormalized;
  const fillColor = trendUp ? 'var(--up)' : 'var(--down)';
  const gridSvg = isFullscreen ? yAxisGridSvg(min, max, pad, W, H, (v) => v.toFixed(0)) : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${fillColor}" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="${fillColor}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${gridSvg}
      <path d="${smoothFillPathD(portPts, H - pad)}" fill="url(#${gradId})"/>
      ${btcPts.length ? `<path d="${smoothPathD(btcPts)}" fill="none" stroke="var(--warn)" stroke-width="1.5" stroke-dasharray="3 3"/>` : ''}
      <path d="${smoothPathD(portPts)}" fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>
    <div class="flex justify-between items-center ${captionClass(isFullscreen)} font-mono text-faint mt-1 px-1">
      <span>${new Date(points[0].ts).toLocaleDateString()} (Base=100)</span>
      <span><span class="text-accent">— </span>Portfolio &nbsp; <span class="text-warn">- - </span>BTC Benchmark</span>
      <span>${new Date(points[n - 1].ts).toLocaleDateString()}</span>
    </div>`;

  wireChartTooltip(container, W, H, points.map((_, i) => x(i)), (i) => ({
    value: `Portfolio ${points[i].portfolioNormalized.toFixed(1)}${points[i].btcNormalized != null ? ` &middot; BTC ${points[i].btcNormalized.toFixed(1)}` : ''}`,
    label: new Date(points[i].ts).toLocaleDateString(),
    y: y(points[i].portfolioNormalized),
  }));
}

// --- Visualization 6: Asset Position Value History -----------------------
function renderAssetPositionChart(container, positionHistory) {
  if (!positionHistory || positionHistory.length < 2) {
    renderDataState(container, 'INSUFFICIENT_DATA', 'No historical position snapshots for this asset.');
    return;
  }
  renderPortfolioValueChart(container, positionHistory);
}

// --- Visualization 7: Price + Signal Timeline Chart --------------------
// `requestedRange` (optional) lets this flag when the selected timeframe
// button (e.g. "30d") shows the exact same points as a shorter one would —
// not a bug, just genuinely less signal history than that button implies
// yet, and worth saying so instead of silently looking identical.
function renderPriceSignalChart(container, points, requestedRange = null) {
  if (!points || points.length < 2) {
    renderDataState(container, 'INSUFFICIENT_DATA', 'Not enough historical signal observations for chart.');
    return;
  }
  const RANGE_MS = { '12h': 12, '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };
  const { W, H, isFullscreen } = getChartDimensions(600, 240);
  const scaleK = H / 240;
  const priceH = 150 * scaleK, scoreTop = 165 * scaleK, scoreH = 45 * scaleK, pad = 8;
  const prices = points.map((p) => p.price).filter((p) => p != null);
  const minP = Math.min(...prices), maxP = Math.max(...prices);
  const rangeP = (maxP - minP) || 1;
  const n = points.length;
  const x = (i) => pad + (i / (n - 1)) * (W - pad * 2);
  const yPrice = (p) => priceH - pad - ((p - minP) / rangeP) * (priceH - pad * 2);

  const pricePts = points.map((p, i) => (p.price != null ? { x: x(i), y: yPrice(p.price) } : null)).filter(Boolean);
  const gradId = `plotgrad-${Math.random().toString(36).slice(2, 9)}`;
  const priceGrid = isFullscreen ? yAxisGridSvg(minP, maxP, pad, W, priceH, (v) => fmtUsd(v), 3) : '';

  const maxScore = Math.max(6, ...points.map((p) => Math.abs(p.score || 0)));
  const barW = Math.max(1.5, ((W - pad * 2) / n) * 0.6);
  const scoreMid = scoreTop + scoreH / 2;
  const bars = points.map((p, i) => {
    const h = (Math.abs(p.score || 0) / maxScore) * (scoreH / 2);
    const color = p.direction === 'BULLISH' ? 'var(--up)' : p.direction === 'BEARISH' ? 'var(--down)' : 'var(--faint)';
    const yTop = (p.score || 0) >= 0 ? scoreMid - h : scoreMid;
    return `<rect x="${(x(i) - barW / 2).toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" fill="${color}" />`;
  }).join('');

  const actualSpanMs = points[n - 1].ts - points[0].ts;
  const requestedMs = requestedRange ? RANGE_MS[requestedRange.toLowerCase()] * 3_600_000 : null;
  const sparseNote = requestedMs && actualSpanMs < requestedMs * 0.9
    ? `<p class="${captionClass(isFullscreen)} text-faint mt-1.5 px-1">Only ${Math.max(1, Math.round(actualSpanMs / 3_600_000))}h of signal history exists yet — shorter than the selected ${requestedRange} range, so every range showing the same points here isn't a bug, it'll fill in as more hourly cycles run.</p>`
    : '';

  container.innerHTML = `
    <p class="${captionClass(isFullscreen)} text-faint mb-1 px-1">Top: hourly price. Bottom: signal strength each cycle (green=bullish, red=bearish, gray=neutral) &mdash; taller bar means stronger conviction, not bigger price move.</p>
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.18"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${priceGrid}
      <path d="${smoothFillPathD(pricePts, priceH - pad)}" fill="url(#${gradId})"/>
      <path d="${smoothPathD(pricePts)}" fill="none" stroke="var(--accent)" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round" />
      <line x1="${pad}" y1="${scoreMid}" x2="${W - pad}" y2="${scoreMid}" stroke="var(--border)" stroke-width="1" />
      ${bars}
    </svg>
    <div class="flex justify-between font-mono ${captionClass(isFullscreen)} text-faint mt-1 px-1">
      <span>${new Date(points[0].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })}</span>
      <span class="text-accent">— price</span>
      <span>${new Date(points[n - 1].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' })}</span>
    </div>
    ${sparseNote}`;

  wireChartTooltip(container, W, H, points.map((_, i) => x(i)), (i) => {
    const p = points[i];
    if (p.price == null) return null;
    return {
      value: `${fmtUsd(p.price)}${p.direction ? ` &middot; ${p.direction} (${p.score >= 0 ? '+' : ''}${p.score})` : ''}`,
      label: new Date(p.ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      y: yPrice(p.price),
    };
  });
}

// --- Shared: fullscreen chart modal --------------------------------------
// Re-invokes the SAME render function against a larger container rather than
// maintaining a separate "big" chart implementation — every render*Chart
// function above already produces responsive, full-width SVG, so this is
// just "the same chart, more room."
function ensureFullscreenModal() {
  let modal = document.getElementById('chartFullscreenModal');
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'chartFullscreenModal';
  modal.className = 'fixed inset-0 z-50 hidden items-center justify-center';
  modal.style.background = 'rgba(0,0,0,0.6)';
  modal.innerHTML = `
    <div class="fs-card bg-surface overflow-auto relative flex flex-col">
      <div class="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 id="chartFullscreenTitle" class="text-xs font-mono font-semibold text-faint uppercase tracking-wider"></h3>
        <button id="chartFullscreenClose" class="text-faint hover-text-ink w-9 h-9 flex items-center justify-center rounded hover-bg-elevated text-lg leading-none touch-target" aria-label="Close">&#10005;</button>
      </div>
      <div id="chartFullscreenBody" class="p-4 flex-1 flex flex-col justify-center"></div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeChartFullscreen(); });
  modal.querySelector('#chartFullscreenClose').addEventListener('click', closeChartFullscreen);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChartFullscreen(); });
  return modal;
}

function closeChartFullscreen() {
  const modal = document.getElementById('chartFullscreenModal');
  if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
}

// Set only while a chart is rendering inside the fullscreen modal; read by
// getChartDimensions() below so every chart automatically fills the real
// available space there instead of using its compact embedded size — with
// zero changes needed to any chart function's signature or any call site.
let _fullscreenSizeHint = null;

/**
 * Every chart calls this instead of hardcoding `const W = 600, H = 220`.
 * Outside fullscreen, returns the given defaults unchanged (zero behavior
 * change for every existing inline/embedded chart). Inside fullscreen,
 * scales H (viewBox height, at the same W=600 convention) to fill the
 * actual measured available height, clamped so it can't go absurdly tall
 * on very tall screens or shrink below the normal minimum.
 */
function getChartDimensions(defaultW, defaultH, reserveForCaptionPx = 36) {
  if (!_fullscreenSizeHint || !_fullscreenSizeHint.width) return { W: defaultW, H: defaultH, isFullscreen: false };
  const availW = _fullscreenSizeHint.width;
  const availH = Math.max(defaultH, _fullscreenSizeHint.height - reserveForCaptionPx);
  const scaledH = defaultW * (availH / availW);
  const H = Math.max(defaultH, Math.min(scaledH, defaultH * 2.6));
  return { W: defaultW, H, isFullscreen: true };
}

/** Real Y-axis gridlines + value labels — only drawn in fullscreen (see
 * getChartDimensions) since the compact embedded charts don't have room
 * for them without cluttering the small view. yOffset shifts the whole
 * grid down for a lower panel in a multi-panel chart. */
function yAxisGridSvg(min, max, pad, W, panelH, formatFn, count = 4, yOffset = 0) {
  const step = (max - min) / (count - 1) || 1;
  let out = '';
  for (let i = 0; i < count; i++) {
    const val = min + step * i;
    const y = yOffset + panelH - pad - ((val - min) / (max - min || 1)) * (panelH - pad * 2);
    out += `<line x1="0" y1="${y.toFixed(1)}" x2="${W}" y2="${y.toFixed(1)}" stroke="var(--border)" stroke-width="0.75" stroke-dasharray="2 3"/>`;
    out += `<text x="4" y="${(y - 4).toFixed(1)}" font-size="11" fill="var(--faint)" class="font-mono">${formatFn(val)}</text>`;
  }
  return out;
}

/** Caption/legend text size — bumped up in fullscreen where there's room,
 * since the same 10px caption that's fine embedded reads as "too small"
 * when the chart around it has grown to fill a whole phone screen. */
function captionClass(isFullscreen) {
  return isFullscreen ? 'text-sm' : 'text-[10px]';
}

function openChartFullscreen(title, renderFn, ...args) {
  const modal = ensureFullscreenModal();
  modal.querySelector('#chartFullscreenTitle').textContent = title;
  const body = modal.querySelector('#chartFullscreenBody');
  body.innerHTML = '';
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  // getBoundingClientRect forces a synchronous layout, so this reads the
  // real available space now that the modal is actually visible (a hidden
  // element always measures 0x0).
  const rect = body.getBoundingClientRect();
  _fullscreenSizeHint = (rect.width > 0 && rect.height > 0) ? { width: rect.width, height: rect.height } : null;
  renderFn(body, ...args);
  _fullscreenSizeHint = null; // never leak into a later inline re-render of the same chart function
}

/**
 * Fullscreen with a working range selector inside it — tapping a range
 * re-fetches and re-renders without closing the modal. `fetchAndRender(range,
 * chartEl)` owns the fetch + render call for whatever chart this is; this
 * function only owns the modal chrome, the range-button row, and correctly
 * re-measuring available space (which shrinks by the range row's own height)
 * before each render.
 */
function openChartFullscreenWithRange(title, ranges, activeRange, fetchAndRender) {
  const modal = ensureFullscreenModal();
  modal.querySelector('#chartFullscreenTitle').textContent = title;
  const body = modal.querySelector('#chartFullscreenBody');
  body.innerHTML = '<div id="fsRangeButtons" class="flex gap-1 overflow-x-auto no-scrollbar mb-3"></div><div id="fsChartBody" class="flex-1"></div>';
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  let currentRange = activeRange;
  const chartEl = body.querySelector('#fsChartBody');

  async function draw() {
    renderRangeButtons('fsRangeButtons', ranges, currentRange, (r) => { currentRange = r; draw(); });
    const rangeRowH = body.querySelector('#fsRangeButtons').getBoundingClientRect().height;
    const rect = body.getBoundingClientRect();
    _fullscreenSizeHint = (rect.width > 0 && rect.height > 0)
      ? { width: rect.width, height: Math.max(160, rect.height - rangeRowH - 12) }
      : null;
    try {
      await fetchAndRender(currentRange, chartEl);
    } finally {
      _fullscreenSizeHint = null;
    }
  }
  draw();
}

const EXPAND_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';

/** Renders an expand button into `buttonContainerId` that opens the same
 * chart, at the same data, in the fullscreen modal. Call this right after
 * the chart's normal (non-fullscreen) render, with the same args. */
/**
 * The one range-button renderer used everywhere. Previously duplicated
 * independently in asset.html, portfolio.html, market-pulse.html, and
 * performance.html — two of those four had actually-dead CSS
 * (hover:text-muted / hover:bg-elevated are Tailwind pseudo-class syntax,
 * but text-muted/bg-elevated are this app's own plain custom classes, not
 * Tailwind utilities, so Tailwind's CDN compiler never generated a hover
 * variant for them at all). Consolidating to one function fixes that as a
 * side effect, and guarantees identical spacing/styling everywhere from now on.
 */
/** Shimmering placeholder shaped like the chart about to appear — replaces
 * plain "Loading…" text, which was especially noticeable on mobile where
 * load times are more visible. `heightPx` should roughly match the chart's
 * eventual rendered height so nothing visibly jumps when real data arrives. */
function chartSkeletonHtml(heightPx = 180) {
  return `<div class="chart-skeleton w-full" style="height:${heightPx}px"></div>`;
}

function renderRangeButtons(containerId, ranges, activeRange, onSelect) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = ranges.map((r) => `<button data-range="${r}" class="text-[10px] font-mono px-2.5 py-1 rounded-md border transition-colors touch-target-sm ${r === activeRange ? 'border-accent-30 bg-accent-soft text-accent font-semibold' : 'border-border text-faint hover-text-muted hover-bg-elevated'}">${r}</button>`).join('');
  el.querySelectorAll('button').forEach((btn) => btn.addEventListener('click', () => onSelect(btn.dataset.range)));
}
function addFullscreenButton(buttonContainerId, title, renderFn, ...args) {
  const el = document.getElementById(buttonContainerId);
  if (!el) return;
  el.innerHTML = `<button class="touch-target text-faint hover-text-ink rounded hover-bg-elevated" aria-label="Expand chart" title="Expand">${EXPAND_ICON_SVG}</button>`;
  el.querySelector('button').addEventListener('click', () => openChartFullscreen(title, renderFn, ...args));
}

/** Same as addFullscreenButton, but the fullscreen view gets its own working
 * range selector instead of being frozen at whatever range was active when
 * the expand button was tapped. */
function addFullscreenButtonWithRange(buttonContainerId, title, ranges, getActiveRange, fetchAndRender) {
  const el = document.getElementById(buttonContainerId);
  if (!el) return;
  el.innerHTML = `<button class="touch-target text-faint hover-text-ink rounded hover-bg-elevated" aria-label="Expand chart" title="Expand">${EXPAND_ICON_SVG}</button>`;
  el.querySelector('button').addEventListener('click', () => openChartFullscreenWithRange(title, ranges, getActiveRange(), fetchAndRender));
}

// --- Market Pulse: the one gauge ----------------------------------------
// Semicircle arc, 0-100. Colored by label (BULLISH/NEUTRAL/BEARISH) — never
// a separate gauge per driver, per spec ("Cycle and Sentiment are
// supporting drivers, not competing gauges").
function renderMarketPulseGauge(container, marketPulse, label, regimeText) {
  if (marketPulse == null) {
    renderDataState(container, 'INSUFFICIENT_DATA', 'Insufficient evidence to determine the current Market Pulse.');
    return;
  }
  const W = 220, H = 130, cx = 110, cy = 110, r = 90;
  const fullLength = Math.PI * r;
  const fillLength = (marketPulse / 100) * fullLength;
  const color = label === 'BULLISH' ? 'var(--up)' : label === 'BEARISH' ? 'var(--down)' : 'var(--warn)';
  const startX = cx - r, endX = cx + r;

  const glowId = `glow-${Math.random().toString(36).slice(2, 9)}`;

  container.innerHTML = `
    <div class="flex flex-col items-center">
      <svg viewBox="0 0 ${W} ${H}" class="w-full max-w-[260px] h-auto">
        <defs>${glowFilterDefs(glowId, color)}</defs>
        <path d="M${startX},${cy} A${r},${r} 0 0,1 ${endX},${cy}" fill="none" stroke="var(--border)" stroke-width="14" stroke-linecap="round"/>
        <path d="M${startX},${cy} A${r},${r} 0 0,1 ${endX},${cy}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
          stroke-dasharray="${fillLength.toFixed(1)} ${fullLength.toFixed(1)}" filter="url(#${glowId})" opacity="0.95"/>
      </svg>
      <div class="-mt-10 text-center">
        <div class="text-4xl font-mono font-bold text-ink">${marketPulse}</div>
        <div class="text-sm font-mono font-semibold mt-0.5" style="color:${color}">${label}</div>
        ${regimeText ? `<div class="text-[10px] font-mono text-faint uppercase tracking-wider mt-0.5">${regimeText}</div>` : ''}
      </div>
    </div>`;
}

// --- Historical Regime timeline ------------------------------------------
// Groups consecutive same-regime rows into segments — shows V4's own actual
// classification (TRENDING_BULLISH/RANGE_BOUND/etc), never invented
// Wyckoff-style labels the underlying data doesn't support.
function renderRegimeTimeline(container, regimeRows, asset = 'BTC') {
  const rows = (regimeRows || []).filter((r) => r.regime && r.regime !== 'UNKNOWN').sort((a, b) => a.ts - b.ts);
  if (rows.length < 1) {
    renderDataState(container, 'INSUFFICIENT_DATA', `No historical regime classification available yet for ${asset}.`);
    return;
  }
  const segments = [];
  for (const row of rows) {
    const last = segments[segments.length - 1];
    if (last && last.regime === row.regime) last.endTs = row.ts;
    else segments.push({ regime: row.regime, startTs: row.ts, endTs: row.ts });
  }
  const REGIME_COLOR = {
    TRENDING_BULLISH: 'var(--up)', TRENDING_BEARISH: 'var(--down)',
    RANGE_BOUND: 'var(--faint)', HIGH_VOLATILITY: 'var(--warn)', LOW_VOLATILITY: 'var(--accent)',
    TRANSITION: 'var(--warn)',
  };
  const spanMs = segments[segments.length - 1].endTs - segments[0].startTs;
  const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  container.innerHTML = `
    <div class="flex h-6 rounded-md overflow-hidden border border-border">
      ${segments.map((s, i) => {
        const width = spanMs > 0 ? Math.max(2, ((s.endTs - s.startTs) / spanMs) * 100) : 100 / segments.length;
        return `<div data-seg="${i}" class="regime-segment" style="width:${width}%; background:${REGIME_COLOR[s.regime] || 'var(--faint)'}"></div>`;
      }).join('')}
    </div>
    <div class="flex justify-between text-[10px] font-mono text-faint mt-1">
      <span>${fmtDate(segments[0].startTs)}</span>
      <span>${fmtDate(segments[segments.length - 1].endTs)}</span>
    </div>
    <div id="regimeSegDetail" class="text-[10px] font-mono text-ink bg-elevated border border-border rounded px-2 py-1.5 mt-2 hidden"></div>
    <div class="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] font-mono">
      ${[...new Set(segments.map((s) => s.regime))].map((r) => `<span class="flex items-center gap-1"><span class="w-2 h-2 rounded-sm inline-block" style="background:${REGIME_COLOR[r] || 'var(--faint)'}"></span>${r.replaceAll('_', ' ')}</span>`).join('')}
    </div>
    ${spanMs < 24 * 3_600_000 ? `<p class="text-[10px] text-faint mt-2">Only ${(spanMs / 3_600_000).toFixed(0)}h of ${asset} regime history exists so far — this timeline will fill in as more hourly cycles run.</p>` : ''}`;

  // title= never fires on touch devices — tapping a segment shows the same
  // detail (regime + date range) as a real, visible row instead.
  const detailEl = container.querySelector('#regimeSegDetail');
  container.querySelectorAll('.regime-segment').forEach((el) => {
    el.addEventListener('click', () => {
      const s = segments[Number(el.dataset.seg)];
      detailEl.textContent = `${s.regime.replaceAll('_', ' ')} \u00b7 ${fmtDate(s.startTs)} \u2013 ${fmtDate(s.endTs)}`;
      detailEl.classList.remove('hidden');
    });
  });
}
// Deliberately NOT one shared normalized scale (spec: "do not create a
// misleading common normalized scale") — Market Pulse keeps its native
// 0-100 range, BTC is cumulative % return from the window start.
// --- Market Pulse vs BTC: single overlaid plot, dual y-axis -------------
// Scenario 2 rewrite: previously two stacked panels; now one plot area with
// Pulse on the left axis (0-100, fixed) and BTC cumulative return on the
// right axis (own auto-range) — the spec's own documented dual-axis
// alternative ("a clearly documented dual-axis chart may be used if it
// materially improves readability"). Colored background bands show how the
// Pulse/BTC relationship has shifted over time (Confirmation / divergence),
// computed server-side via classifyAlignmentSeries — this function only
// renders the alignmentLabel already attached to each point, never
// reclassifies anything itself, so there's exactly one implementation of
// this logic to keep correct.
const ALIGNMENT_BAND_COLOR = {
  'Confirmation': 'var(--faint)',
  'Bullish divergence': 'var(--up)',
  'Bearish divergence': 'var(--down)',
  'Market alignment': null, // no tint — nothing notable happening
};

function renderMarketPulseBtcChart(container, btcAlignment, isLive = false) {
  const points = btcAlignment?.points || [];
  if (points.length < 2) {
    renderDataState(container, 'INSUFFICIENT_DATA', btcAlignment?.message || 'Not enough overlapping Market Pulse and BTC data yet.');
    return;
  }
  const { W, H, isFullscreen } = getChartDimensions(600, 260);
  const pad = 14;
  const labelSize = isFullscreen ? 13 : 10;
  const n = points.length;
  const x = (i) => pad + (i / (n - 1)) * (W - pad * 2);

  const yPulse = (v) => H - pad - (v / 100) * (H - pad * 2);
  const pulsePts = points.map((p, i) => ({ x: x(i), y: yPulse(p.marketPulse) }));

  const btcVals = points.map((p) => p.btcCumReturnPct);
  const btcMin = Math.min(...btcVals), btcMax = Math.max(...btcVals);
  const btcBreath = (btcMax - btcMin) * 0.12 || 1;
  const bMin = btcMin - btcBreath, bMax = btcMax + btcBreath;
  const bRange = (bMax - bMin) || 1;
  const yBtc = (v) => H - pad - ((v - bMin) / bRange) * (H - pad * 2);
  const btcPts = points.map((p, i) => ({ x: x(i), y: yBtc(p.btcCumReturnPct) }));

  const lastBtc = btcVals[btcVals.length - 1];
  const btcColor = lastBtc >= 0 ? 'var(--up)' : 'var(--down)';
  const pulseGradId = `plotgrad-${Math.random().toString(36).slice(2, 9)}`;
  const lastPulsePt = pulsePts[pulsePts.length - 1];
  const lastBtcPt = btcPts[btcPts.length - 1];

  // Group consecutive same-label points into bands, same pattern as
  // renderRegimeTimeline. Only the ones with an actual tint color get drawn.
  const bands = [];
  for (let i = 0; i < points.length; i++) {
    const label = points[i].alignmentLabel;
    const last = bands[bands.length - 1];
    if (last && last.label === label) last.endI = i;
    else bands.push({ label, startI: i, endI: i });
  }
  const bandRects = bands.map((b) => {
    const color = ALIGNMENT_BAND_COLOR[b.label];
    if (!color) return '';
    const x1 = x(b.startI), x2 = x(Math.min(b.endI + 1, n - 1));
    return `<rect x="${x1.toFixed(1)}" y="0" width="${Math.max(1, x2 - x1).toFixed(1)}" height="${H}" fill="${color}" opacity="0.08"/>`;
  }).join('');

  const pulseGrid = isFullscreen ? yAxisGridSvg(0, 100, pad, W, H, (v) => v.toFixed(0), 3) : '';
  // Right-axis BTC labels — text only (no second gridline set, which would
  // visually clash with the Pulse grid at a different scale).
  const btcAxisLabels = isFullscreen ? [0, 0.5, 1].map((frac) => {
    const val = bMin + frac * (bMax - bMin);
    const yPos = yBtc(val);
    return `<text x="${W - pad}" y="${(yPos - 4).toFixed(1)}" font-size="11" fill="${btcColor}" text-anchor="end" class="font-mono">${val >= 0 ? '+' : ''}${val.toFixed(0)}%</text>`;
  }).join('') : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">
      <defs>
        <linearGradient id="${pulseGradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${bandRects}
      ${pulseGrid}
      <path d="${smoothFillPathD(pulsePts, H - pad)}" fill="url(#${pulseGradId})"/>
      <path d="${smoothPathD(btcPts)}" fill="none" stroke="${btcColor}" stroke-width="2" stroke-dasharray="4 3" stroke-linejoin="round" stroke-linecap="round"/>
      ${isLive ? livePulseMarker(lastBtcPt.x, lastBtcPt.y, btcColor) : ''}
      <path d="${smoothPathD(pulsePts)}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${isLive ? livePulseMarker(lastPulsePt.x, lastPulsePt.y, 'var(--accent)') : ''}
      ${btcAxisLabels}
    </svg>
    <div class="flex items-center justify-center gap-4 ${captionClass(isFullscreen)} font-mono mt-1.5">
      <span class="flex items-center gap-1"><span class="w-2.5 h-0.5 rounded-full inline-block" style="background:var(--accent)"></span><span class="text-faint">Pulse (0&ndash;100)</span></span>
      <span class="flex items-center gap-1"><span class="w-2.5 h-0.5 rounded-full inline-block" style="background:${btcColor}"></span><span class="text-faint">BTC cumulative return</span></span>
    </div>
    <div class="flex items-center justify-center flex-wrap gap-x-4 gap-y-1 ${captionClass(isFullscreen)} font-mono mt-1">
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:color-mix(in srgb, var(--up) 35%, transparent)"></span><span class="text-faint">Bullish divergence</span></span>
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:color-mix(in srgb, var(--down) 35%, transparent)"></span><span class="text-faint">Bearish divergence</span></span>
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block border border-border" style="background:color-mix(in srgb, var(--faint) 25%, transparent)"></span><span class="text-faint">Confirmation</span></span>
    </div>
    <div class="flex justify-between items-center ${captionClass(isFullscreen)} font-mono text-faint mt-1 px-1">
      <span>${new Date(points[0].ts).toLocaleDateString()}</span>
      <span>BTC: ${lastBtc >= 0 ? '+' : ''}${lastBtc.toFixed(1)}%</span>
      <span>${new Date(points[n - 1].ts).toLocaleDateString()}</span>
    </div>`;

  wireChartTooltip(container, W, H, points.map((_, i) => x(i)), (i) => ({
    value: `Pulse ${points[i].marketPulse} &middot; BTC ${points[i].btcCumReturnPct >= 0 ? '+' : ''}${points[i].btcCumReturnPct.toFixed(1)}%${points[i].alignmentLabel ? ` &middot; ${points[i].alignmentLabel}` : ''}`,
    label: new Date(points[i].ts).toLocaleDateString(),
    y: yPulse(points[i].marketPulse),
  }));
}

// --- Portfolio Prediction Funnel: real history + a widening projection ---
// Reuses V2's existing k-NN/TimesFM models (never a new one built here).
// The projected region is drawn as a visually distinct widening cone — never
// the same solid-line weight as real history — because a confident-looking
// single line into the future would misrepresent genuine uncertainty this
// project's own evidence (see the accuracy figures in the details panel)
// says is real. Green/red is the median direction only; the actual per-model
// accuracy lives in the details panel below (deliberately not printed on the
// chart itself, so it doesn't get lost in a data-dense image, but always
// one tap away, never hidden by default).
function renderPortfolioFunnelChart(container, historyPoints, funnelData) {
  const hist = (historyPoints || []).filter((p) => p.total_value_usd != null);
  const funnel = funnelData?.funnel;
  if (hist.length < 2 || !funnel) {
    renderDataState(container, 'INSUFFICIENT_DATA', funnelData?.message || 'Not enough data for a prediction funnel yet.');
    return;
  }

  const { W, H, isFullscreen } = getChartDimensions(600, 240);
  const pad = 14;
  const n = hist.length;
  // One extra x-slot reserved for the projected point, so the cone has
  // somewhere to widen toward — proportional to the horizon relative to the
  // history window shown, capped so it never dwarfs the real data.
  const futureSlot = Math.max(2, Math.round(n * 0.25));
  const totalSlots = n - 1 + futureSlot;

  const allVals = [...hist.map((p) => p.total_value_usd), funnel.p25Value, funnel.medianValue, funnel.p75Value];
  const rawMin = Math.min(...allVals), rawMax = Math.max(...allVals);
  const breathing = (rawMax - rawMin) * 0.12 || Math.abs(rawMax) * 0.02 || 1;
  const min = rawMin - breathing, max = rawMax + breathing;
  const range = (max - min) || 1;

  const x = (i) => pad + (i / totalSlots) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / range) * (H - pad * 2);

  const histPts = hist.map((p, i) => ({ x: x(i), y: y(p.total_value_usd) }));
  const nowPt = histPts[histPts.length - 1];
  const futureX = x(n - 1 + futureSlot);
  const trendUp = funnel.medianValue >= funnel.currentValue;
  const color = trendUp ? 'var(--up)' : 'var(--down)';
  const gradId = `plotgrad-${Math.random().toString(36).slice(2, 9)}`;

  const conePath = `M${nowPt.x.toFixed(1)},${nowPt.y.toFixed(1)} L${futureX.toFixed(1)},${y(funnel.p75Value).toFixed(1)} L${futureX.toFixed(1)},${y(funnel.p25Value).toFixed(1)} Z`;
  const medianLine = `M${nowPt.x.toFixed(1)},${nowPt.y.toFixed(1)} L${futureX.toFixed(1)},${y(funnel.medianValue).toFixed(1)}`;
  const upperEdge = `M${nowPt.x.toFixed(1)},${nowPt.y.toFixed(1)} L${futureX.toFixed(1)},${y(funnel.p75Value).toFixed(1)}`;
  const lowerEdge = `M${nowPt.x.toFixed(1)},${nowPt.y.toFixed(1)} L${futureX.toFixed(1)},${y(funnel.p25Value).toFixed(1)}`;

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" class="w-full h-auto">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <path d="${smoothFillPathD(histPts, H - pad)}" fill="url(#${gradId})"/>
      <line x1="${nowPt.x.toFixed(1)}" y1="${pad}" x2="${nowPt.x.toFixed(1)}" y2="${H - pad}" stroke="var(--border-strong)" stroke-width="1" stroke-dasharray="2 2"/>
      <path d="${conePath}" fill="${color}" opacity="0.12"/>
      <path d="${upperEdge}" fill="none" stroke="${color}" stroke-width="1.25" stroke-dasharray="3 3" opacity="0.7"/>
      <path d="${lowerEdge}" fill="none" stroke="${color}" stroke-width="1.25" stroke-dasharray="3 3" opacity="0.7"/>
      <path d="${medianLine}" fill="none" stroke="${color}" stroke-width="2" stroke-dasharray="5 3"/>
      <path d="${smoothPathD(histPts)}" fill="none" stroke="var(--accent)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${nowPt.x.toFixed(1)}" cy="${nowPt.y.toFixed(1)}" r="3" fill="var(--accent)"/>
    </svg>
    <div class="flex items-center justify-center gap-4 ${captionClass(isFullscreen)} font-mono mt-1.5">
      <span class="flex items-center gap-1"><span class="w-2.5 h-0.5 rounded-full inline-block" style="background:var(--accent)"></span><span class="text-faint">History</span></span>
      <span class="flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-sm inline-block" style="background:${color}; opacity:0.4"></span><span class="text-faint">Projected range (${trendUp ? '+' : ''}${(((funnel.medianValue / funnel.currentValue) - 1) * 100).toFixed(1)}% median)</span></span>
    </div>
    <p class="${captionClass(isFullscreen)} text-faint text-center mt-1 px-2">Reuses V2's existing prediction models \u2014 not a new one built for this chart. See Model Details below for real accuracy and coverage before reading too much into this.</p>`;

  wireChartTooltip(container, W, H, [...histPts.map((p) => p.x), futureX], (i) => {
    if (i < histPts.length) {
      return {
        value: fmtUsd(hist[i].total_value_usd),
        label: new Date(hist[i].ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit' }),
        y: histPts[i].y,
      };
    }
    return {
      value: `${fmtUsd(funnel.p25Value)} \u2013 ${fmtUsd(funnel.p75Value)} (median ${fmtUsd(funnel.medianValue)})`,
      label: `Projected \u2014 ${funnelData.horizonHours}h from now`,
      y: y(funnel.medianValue),
    };
  });
}
