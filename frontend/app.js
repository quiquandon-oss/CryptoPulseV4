// frontend/app.js
// Shared across all V4 pages. Set the deployed Worker URL once here.
window.V4_API_BASE = window.V4_API_BASE || 'https://cryptopulse-v4.YOUR-SUBDOMAIN.workers.dev';

async function v4Fetch(path) {
  const res = await fetch(`${window.V4_API_BASE}${path}`);
  if (!res.ok) throw new Error(`API ${path} -> HTTP ${res.status}`);
  return res.json();
}

const FRESHNESS_DOT = { LIVE: 'bg-live', RECENT: 'bg-recent', STALE: 'bg-stale', UNAVAILABLE: 'bg-unavailable', OK: 'bg-live', ERROR: 'bg-unavailable' };
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
