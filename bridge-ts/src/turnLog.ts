import { appendFileSync } from "node:fs";
import { TURN_LOG_FILE } from "./config.js";

// The cost (`total_cost_usd`) is deliberately not logged — the user has a flat Claude
// Pro subscription, spend per turn doesn't matter to them (see DECISIONS.md, 18.8.).
export type TurnLogEntry =
  | {
      type: "turn";
      ts: string;
      contextTokens: number;
      // `input + cache_creation` without `cache_read` — a proxy for "fresh" tokens
      // consumed by this turn (cache_read is recycled/cheap). Used to estimate how
      // many tokens got "burned" within one rate-limit window (see
      // `resetsAtMs`/`rateLimited` below and the `usage.ts` dashboard).
      newTokens: number;
      durationMs: number | null;
      durationApiMs: number | null;
      isError: boolean;
      // This turn hit the Claude usage limit (5h/weekly quota) instead of a real
      // reply — see rateLimit.ts.
      rateLimited: boolean;
      resetsAtMs: number | null;
    }
  | { type: "cycle"; ts: string; contextTokensAtCycle: number };

export function logTurn(entry: TurnLogEntry): void {
  try {
    appendFileSync(TURN_LOG_FILE, JSON.stringify(entry) + "\n");
  } catch (e) {
    console.error("Zápis do turn_log_ts.jsonl selhal:", e);
  }
}
