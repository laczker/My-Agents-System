// Čte `turn_log_ts.jsonl`, který si každý bot sám plní (bridge-ts/src/turnLog.ts).
// Dashboard soubor jen čte a shrnuje — žádný zápis odsud.
import { readFileSync } from "node:fs";
import type { BotDef } from "./config.js";

export interface TurnSummary {
  turns24h: number;
  errors24h: number;
  avgDurationMs: number | null;
  lastCycleTs: number | null;
}

function logPath(bot: BotDef): string {
  return `${bot.dir}/turn_log_ts.jsonl`;
}

function readLines(path: string): string[] {
  try {
    return readFileSync(path, "utf-8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function summarize(bot: BotDef, sinceTs: number): TurnSummary {
  let turns = 0;
  let errors = 0;
  let durationSum = 0;
  let lastCycleTs: number | null = null;

  for (const line of readLines(logPath(bot))) {
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Date.parse(String(ev.ts));
    if (ev.type === "cycle") {
      if (lastCycleTs === null || ts > lastCycleTs) lastCycleTs = ts;
    } else if (ev.type === "turn" && ts >= sinceTs) {
      turns++;
      if (ev.isError) errors++;
      durationSum += Number(ev.durationMs) || 0;
    }
  }

  return {
    turns24h: turns,
    errors24h: errors,
    avgDurationMs: turns > 0 ? Math.round(durationSum / turns) : null,
    lastCycleTs,
  };
}

export function tailRaw(bot: BotDef, n: number): string {
  const lines = readLines(logPath(bot));
  return lines.slice(-n).join("\n");
}
