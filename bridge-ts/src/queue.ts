import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { QUEUE_FILE } from "./config.js";

export interface Job {
  userText: string;
  downloadedFileInfo: string;
  /** The Telegram chat the message came from — the result is sent back here, not
   * broadcast to all allowed chats (relevant only for bots with more than one chat
   * ID, see `TELEGRAM_CHAT_IDS_EXTRA`). Old queue items (from before this change)
   * lack this key — it falls back to `TELEGRAM_CHAT_ID`. */
  chatId?: string;
}

interface QueueState {
  jobs: Job[];
  /** epoch ms until which we're waiting for the Claude usage limit to reset (null =
   * not waiting). Survives a bridge process restart, so that during a crash/redeploy
   * while waiting for the quota reset, the queue isn't forgotten and doesn't
   * needlessly start hammering the limit again right away. */
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
