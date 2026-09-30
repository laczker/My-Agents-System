// All three bots run under the same logged-in Claude account (no .env.<profile> has its
// own ANTHROPIC_API_KEY, see bridge-ts/src/config.ts) — so they share one usage
// quota. That's why turns from all `turn_log_ts.jsonl` files are merged here into
// a single timeline instead of counted per bot.
import { readFileSync } from "node:fs";
import type { BotDef } from "./config.js";

interface RawTurn {
  ts: number;
  bot: string;
  newTokens: number;
  rateLimited: boolean;
  resetsAtMs: number | null;
}

function readTurns(bot: BotDef): RawTurn[] {
  let lines: string[];
  try {
    lines = readFileSync(`${bot.dir}/turn_log_ts.jsonl`, "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
  const out: RawTurn[] = [];
  for (const line of lines) {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type !== "turn") continue;
    const ts = Date.parse(String(ev.ts));
    if (Number.isNaN(ts)) continue;
    out.push({
      ts,
      bot: bot.name,
      // Missing on lines logged before this counter was deployed — treated as 0.
      newTokens: Number(ev.newTokens) || 0,
      rateLimited: !!ev.rateLimited,
      resetsAtMs: typeof ev.resetsAtMs === "number" ? ev.resetsAtMs : null,
    });
  }
  return out;
}

export interface UsagePoint {
  ts: number;
  cumulative: number;
}

export interface TurnPoint {
  ts: number;
  bot: string;
  cumulative: number;
  newTokens: number;
}

export interface BurnPoint {
  ts: number;
  bot: string;
  cumulative: number;
  resetsAtMs: number | null;
}

export interface UsageWindow {
  series: UsagePoint[];
  turns: TurnPoint[];
  hits: BurnPoint[];
  /** Current cumulative sum at the end of the window (last point of `series`) — for the stat number. */
  total: number;
}

/** Cumulative sum of `newTokens` across bots since `sinceTs`, resetting to 0 on
 * every limit hit (`rateLimited: true`) — this produces a "sawtooth" curve:
 * grows until the quota is exhausted, then drops back to zero. */
export function buildUsageWindow(bots: BotDef[], sinceTs: number): UsageWindow {
  const rawTurns = bots
    .flatMap(readTurns)
    .filter((t) => t.ts >= sinceTs)
    .sort((a, b) => a.ts - b.ts);

  const series: UsagePoint[] = [{ ts: sinceTs, cumulative: 0 }];
  const turns: TurnPoint[] = [];
  const hits: BurnPoint[] = [];
  let cumulative = 0;

  for (const t of rawTurns) {
    cumulative += t.newTokens;
    series.push({ ts: t.ts, cumulative });
    turns.push({ ts: t.ts, bot: t.bot, cumulative, newTokens: t.newTokens });
    if (t.rateLimited) {
      hits.push({ ts: t.ts, bot: t.bot, cumulative, resetsAtMs: t.resetsAtMs });
      cumulative = 0;
      series.push({ ts: t.ts, cumulative });
    }
  }

  return { series, turns, hits, total: cumulative };
}
