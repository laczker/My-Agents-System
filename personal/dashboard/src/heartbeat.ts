import { readFileSync } from "node:fs";
import { BOTS, STALE_AFTER_MS, type BotDef } from "./config.js";

export type BotStatus = "running" | "stale" | "down";

export interface BotHeartbeat {
  bot: BotDef;
  status: BotStatus;
  lastSeenTs: number | null;
}

function readHeartbeat(dir: string): number | null {
  try {
    const raw = readFileSync(`${dir}/heartbeat_ts.txt`, "utf-8");
    const parsed = JSON.parse(raw) as { ts: number };
    return parsed.ts;
  } catch {
    return null;
  }
}

export function collectHeartbeats(): BotHeartbeat[] {
  const now = Date.now();
  return BOTS.map((bot) => {
    const lastSeenTs = readHeartbeat(bot.dir);
    let status: BotStatus;
    if (lastSeenTs === null) {
      status = "down";
    } else if (now - lastSeenTs > STALE_AFTER_MS) {
      status = "stale";
    } else {
      status = "running";
    }
    return { bot, status, lastSeenTs };
  });
}
