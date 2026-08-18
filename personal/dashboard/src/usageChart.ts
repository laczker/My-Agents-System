import type { UsageWindow } from "./usage.js";

const WIDTH = 720;
const HEIGHT = 220;
const PAD_LEFT = 48;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

// Barvy podle dataviz skillu (dark mode): kategoriální slot 1 (modrá) pro
// kumulativní řadu, status "critical" (červená) pro naražení na limit — barva
// nikdy nenese význam sama, každá červená tečka má i textový <title> tooltip
// a řádek v tabulce pod grafem.
const COLOR_LINE = "#3987e5";
const COLOR_HIT = "#e66767";
const COLOR_GRID = "#2c2c2a";
const COLOR_AXIS = "#383835";
const COLOR_MUTED = "#898781";

function fmtTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

function fmtDay(ts: number): string {
  return new Date(ts).toLocaleDateString("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric" });
}

export function renderUsageChart(usage: UsageWindow, sinceTs: number, nowTs: number): string {
  if (usage.series.length < 2 && usage.hits.length === 0) {
    return `<p class="text-slate-500 text-sm">Zatím málo dat na graf (logování tokenů běží od 18.8.).</p>`;
  }

  const maxCumulative = Math.max(1, ...usage.series.map((p) => p.cumulative));
  const yMax = maxCumulative * 1.15;
  const span = Math.max(1, nowTs - sinceTs);

  const x = (ts: number) => PAD_LEFT + ((ts - sinceTs) / span) * (WIDTH - PAD_LEFT - PAD_RIGHT);
  const y = (v: number) => HEIGHT - PAD_BOTTOM - (v / yMax) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const linePoints = usage.series.map((p) => `${x(p.ts).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(" ");

  const gridLines = [0.25, 0.5, 0.75, 1]
    .map((frac) => {
      const value = yMax * frac;
      const yy = y(value).toFixed(1);
      return `<line x1="${PAD_LEFT}" y1="${yy}" x2="${WIDTH - PAD_RIGHT}" y2="${yy}" stroke="${COLOR_GRID}" stroke-width="1" />
      <text x="${PAD_LEFT - 6}" y="${Number(yy) + 3}" text-anchor="end" font-size="10" fill="${COLOR_MUTED}">${fmtTokens(value)}</text>`;
    })
    .join("");

  const dayCount = Math.min(7, Math.max(2, Math.round(span / (24 * 60 * 60 * 1000)) + 1));
  const dayLabels = Array.from({ length: dayCount }, (_, i) => {
    const ts = sinceTs + (i / (dayCount - 1)) * span;
    return `<text x="${x(ts).toFixed(1)}" y="${HEIGHT - 8}" text-anchor="middle" font-size="10" fill="${COLOR_MUTED}">${fmtDay(ts)}</text>`;
  }).join("");

  const hitMarkers = usage.hits
    .map((h) => {
      const cx = x(h.ts).toFixed(1);
      const cy = y(h.cumulative).toFixed(1);
      const when = new Date(h.ts).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
      const label = `${h.bot} · ${fmtTokens(h.cumulative)} tokenů · ${when}`;
      return `<circle cx="${cx}" cy="${cy}" r="4.5" fill="${COLOR_HIT}"><title>${label}</title></circle>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" class="w-full h-auto" role="img" aria-label="Kumulativní tokeny od posledního resetu kvóty, s vyznačením momentů naražení na limit">
      ${gridLines}
      <line x1="${PAD_LEFT}" y1="${HEIGHT - PAD_BOTTOM}" x2="${WIDTH - PAD_RIGHT}" y2="${HEIGHT - PAD_BOTTOM}" stroke="${COLOR_AXIS}" stroke-width="1" />
      ${dayLabels}
      <polyline points="${linePoints}" fill="none" stroke="${COLOR_LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${hitMarkers}
    </svg>
    <div class="flex gap-4 text-xs text-slate-400 mt-1">
      <span><span class="inline-block w-3 h-0.5 align-middle mr-1" style="background:${COLOR_LINE}"></span>tokeny od posledního resetu (součet přes všechny boty)</span>
      <span><span class="inline-block w-2 h-2 rounded-full align-middle mr-1" style="background:${COLOR_HIT}"></span>naražení na limit</span>
    </div>`;
}
