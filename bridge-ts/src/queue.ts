import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { QUEUE_FILE } from "./config.js";

export interface Job {
  userText: string;
  downloadedFileInfo: string;
  /** Telegram chat, odkud zpráva přišla — výsledek se posílá zpátky sem, ne
   * broadcastem na všechny povolené chaty (relevantní jen pro boty s víc než
   * jedním chat ID, viz `TELEGRAM_CHAT_IDS_EXTRA`). Staré položky ve frontě
   * (před touhle změnou) tenhle klíč nemají — dopočítá se na `TELEGRAM_CHAT_ID`. */
  chatId?: string;
}

interface QueueState {
  jobs: Job[];
  /** epoch ms, dokdy se čeká na obnovení Claude usage limitu (null = nečeká se).
   * Přežívá restart bridge procesu, ať se po pádu/redeployi během čekání na
   * reset kvóty fronta nezapomene a nezačne se zbytečně hned znovu bušit do limitu. */
  rateLimitResumeAtMs: number | null;
}

export function loadQueueState(): QueueState {
  if (!existsSync(QUEUE_FILE)) return { jobs: [], rateLimitResumeAtMs: null };
  try {
    const parsed = JSON.parse(readFileSync(QUEUE_FILE, "utf-8"));
    return { jobs: parsed.jobs ?? [], rateLimitResumeAtMs: parsed.rateLimitResumeAtMs ?? null };
  } catch {
    return { jobs: [], rateLimitResumeAtMs: null };
  }
}

export function saveQueueState(state: QueueState): void {
  writeFileSync(QUEUE_FILE, JSON.stringify(state));
}
