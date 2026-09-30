import type { UsageWindow } from "./usage.js";

const WIDTH = 720;
const HEIGHT = 240;
const PAD_LEFT = 48;
const PAD_RIGHT = 16;
const PAD_TOP = 16;
const PAD_BOTTOM = 28;

// Colors per the dataviz skill (dark mode, palette.md): categorical slots 1-3
// (blue/orange/teal) for per-bot identity on individual turns — this triplet
// is the only one in the skill that passes all-pairs validation (a 4th slot
// would collide), so adding a bot beyond three needs a new slot plus a re-run
// of `validate_palette.js`, not just picking another color. Status "critical"
// (red) for hitting the rate limit — color never carries meaning on its own,
// every dot also has a text <title> tooltip and a row in the table below the chart.
const BOT_COLORS = ["#3987e5", "#d95926", "#199e70"];
const COLOR_LINE = "#c3c2b7"; // secondary ink — the line is the total, not an identity
const COLOR_HIT = "#e66767";
const COLOR_GRID = "#2c2c2a";
const COLOR_AXIS = "#383835";
const COLOR_MUTED = "#898781";
const COLOR_SURFACE_RING = "#1e293b"; // matches the chart panel's bg-slate-800

function fmtTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

function fmtDay(ts: number, spanMs: number): string {
  const opts: Intl.DateTimeFormatOptions =
    spanMs <= 36 * 60 * 60 * 1000
      ? { timeZone: "Europe/Prague", hour: "2-digit", minute: "2-digit" }
      : { timeZone: "Europe/Prague", day: "numeric", month: "numeric" };
  return new Date(ts).toLocaleString("cs-CZ", opts);
}

export function botColor(botNames: string[], bot: string): string {
  const idx = botNames.indexOf(bot);
  return BOT_COLORS[idx >= 0 ? idx % BOT_COLORS.length : 0];
}

export function renderUsageChart(usage: UsageWindow, sinceTs: number, nowTs: number, botNames: string[]): string {
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

  const tickCount = Math.min(7, Math.max(2, Math.round(span / (span > 36 * 60 * 60 * 1000 ? 24 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000)) + 1));
  const dayLabels = Array.from({ length: tickCount }, (_, i) => {
    const ts = sinceTs + (i / (tickCount - 1)) * span;
    return `<text x="${x(ts).toFixed(1)}" y="${HEIGHT - 8}" text-anchor="middle" font-size="10" fill="${COLOR_MUTED}">${fmtDay(ts, span)}</text>`;
  }).join("");

  // Hit-area per interaction.md — the visible dot is small (r=4), but the
  // hover target is a transparent circle 24px in diameter around it.
  const turnMarkers = usage.turns
    .map((t) => {
      const cx = x(t.ts).toFixed(1);
      const cy = y(t.cumulative).toFixed(1);
      const color = botColor(botNames, t.bot);
      const when = new Date(t.ts).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
      const label = `${t.bot} · +${fmtTokens(t.newTokens)} tokenů (celkem ${fmtTokens(t.cumulative)}) · ${when}`;
      return `<g><circle cx="${cx}" cy="${cy}" r="12" fill="transparent"><title>${label}</title></circle>
      <circle cx="${cx}" cy="${cy}" r="4" fill="${color}" stroke="${COLOR_SURFACE_RING}" stroke-width="2" /></g>`;
    })
    .join("");

  // Thin horizontal line across the whole chart width at the height of the limit
  // hit — acts as a threshold reference line that stays visible against later
  // points too (not just a short mark at the point itself), plus a dot at the
  // event location for the detail tooltip.
  const hitMarkers = usage.hits
    .map((h) => {
      const cx = Number(x(h.ts).toFixed(1));
      const cy = y(h.cumulative).toFixed(1);
      const when = new Date(h.ts).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
      const label = `Naražení na limit: ${h.bot} · ${fmtTokens(h.cumulative)} tokenů · ${when}`;
      return `<g><line x1="${PAD_LEFT}" y1="${cy}" x2="${WIDTH - PAD_RIGHT}" y2="${cy}" stroke="${COLOR_HIT}" stroke-width="0.5" stroke-dasharray="4 3" opacity="0.6" />
      <circle cx="${cx}" cy="${cy}" r="12" fill="transparent"><title>${label}</title></circle>
      <circle cx="${cx}" cy="${cy}" r="3.5" fill="${COLOR_HIT}" stroke="${COLOR_SURFACE_RING}" stroke-width="1.5" /></g>`;
    })
    .join("");

  const legendBots = botNames
    .map(
      (name, i) =>
        `<span><span class="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1" style="background:${BOT_COLORS[i % BOT_COLORS.length]}"></span>${name}</span>`
    )
    .join("");

  return `
    <svg viewBox="0 0 ${WIDTH} ${HEIGHT}" class="w-full h-auto" role="img" aria-label="Kumulativní tokeny od posledního resetu kvóty podle bota, s vyznačením momentů naražení na limit">
      ${gridLines}
      <line x1="${PAD_LEFT}" y1="${HEIGHT - PAD_BOTTOM}" x2="${WIDTH - PAD_RIGHT}" y2="${HEIGHT - PAD_BOTTOM}" stroke="${COLOR_AXIS}" stroke-width="1" />
      ${dayLabels}
      <polyline points="${linePoints}" fill="none" stroke="${COLOR_LINE}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      ${turnMarkers}
      ${hitMarkers}
    </svg>
    <div class="flex flex-wrap gap-4 text-xs text-slate-400 mt-1">
      <span><span class="inline-block w-3 h-0.5 align-middle mr-1" style="background:${COLOR_LINE}"></span>součet přes všechny boty</span>
      ${legendBots}
      <span><span class="inline-block w-3 h-0.5 align-middle mr-1" style="background:${COLOR_HIT}"></span>naražení na limit</span>
    </div>`;
}
