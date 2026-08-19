// Všichni tři boti běží pod stejným přihlášeným Claude účtem (žádný .env.<profil>
// nemá vlastní ANTHROPIC_API_KEY, viz bridge-ts/src/config.ts) — sdílejí tedy jednu
// usage kvótu. Proto se tady tahy ze všech `turn_log_ts.jsonl` souborů slévají do
// jedné časové osy, ne počítají per bot.
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
      // Chybí u řádků zalogovaných před nasazením tohohle počítadla — bere se jako 0.
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
  /** Aktuální kumulativní součet na konci okna (poslední bod `series`) — pro stat number. */
  total: number;
}

/** Kumulativní součet `newTokens` napříč boty od `sinceTs`, s resetem na 0 při
 * každém naražení na limit (`rateLimited: true`) — tím vznikne "pilovitý" průběh:
 * roste, dokud se kvóta nevyčerpá, pak spadne zpátky na nulu. */
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
