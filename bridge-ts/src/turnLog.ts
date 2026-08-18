import { appendFileSync } from "node:fs";
import { TURN_LOG_FILE } from "./config.js";

// Cena (`total_cost_usd`) se záměrně neloguje — uživatel má Claude Pro paušál,
// útrata za tah ho nezajímá (viz DECISIONS.md, 18.8.).
export type TurnLogEntry =
  | {
      type: "turn";
      ts: string;
      contextTokens: number;
      // `input + cache_creation` bez `cache_read` — proxy pro "čerstvé" tokeny
      // spotřebované tímhle tahem (cache_read jsou recyklované/levné). Slouží
      // k odhadu, kolik tokenů se "propálilo" v rámci jednoho rate-limit okna
      // (viz `resetsAtMs`/`rateLimited` níž a dashboard `usage.ts`).
      newTokens: number;
      durationMs: number | null;
      durationApiMs: number | null;
      isError: boolean;
      // Tenhle tah narazil na Claude usage limit (5h/týdenní kvóta) místo
      // skutečné odpovědi — viz rateLimit.ts.
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
