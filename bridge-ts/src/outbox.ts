import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { GrammyError } from "grammy";
import { OUTBOX_FILE, OUTBOX_RETRY_INTERVAL_MS, TELEGRAM_CHAT_ID } from "./config.js";

// 400 = error tied to this specific message/chat (e.g. "chat not found", text too
// long, bad Markdown) — a retry would turn out the same, so drop it.
// 403 = the bot is blocked/kicked from the chat — permanent for the whole chat, not
// just this message, but still no point blocking the queue over it.
const PERMANENT_ERROR_CODES = new Set([400, 403]);

interface OutboxItem {
  id: string;
  text: string;
  createdAt: number;
  /** Where to send the message. Old outbox items (from before this change) lack this
   * key — it falls back to `TELEGRAM_CHAT_ID`, same behavior as before. */
  chatId?: string;
  /** Telegram message ID to reply to (absent for old items and non-reply messages). */
  replyTo?: number;
}

// A persistent queue of outgoing messages (Ludwig's pattern). A message is written to
// disk BEFORE it's even attempted to be sent — so even if the bridge process
// crashes/restarts mid-send (or right after computing the reply, before sending), the
// message gets delivered on restart via flushOutbox() instead of disappearing. This
// replaces Ludwig's "grab the last text from the transcript" more reliably — it
// doesn't depend on parsing the transcript, only on the disk write happening before
// the network call.
export class Outbox {
  private items: OutboxItem[] = [];
  private sendFn: (text: string, chatId: string, replyTo?: number) => Promise<void>;
  private flushing = false;

  constructor(sendFn: (text: string, chatId: string, replyTo?: number) => Promise<void>) {
    this.sendFn = sendFn;
    this.load();
  }

  private load(): void {
    if (!existsSync(OUTBOX_FILE)) return;
    try {
      this.items = JSON.parse(readFileSync(OUTBOX_FILE, "utf-8"));
    } catch {
      this.items = [];
    }
  }

  private persist(): void {
    writeFileSync(OUTBOX_FILE, JSON.stringify(this.items));
  }

  enqueue(text: string, chatId: string = TELEGRAM_CHAT_ID, replyTo?: number): void {
    this.items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, createdAt: Date.now(), chatId, replyTo });
    this.persist();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.items.length > 0) {
        const item = this.items[0];
        try {
          await this.sendFn(item.text, item.chatId ?? TELEGRAM_CHAT_ID, item.replyTo);
        } catch (e) {
          if (e instanceof GrammyError && PERMANENT_ERROR_CODES.has(e.error_code)) {
            console.error(`Odeslání trvale selhalo (${e.error_code}), zahazuji zprávu ${item.id}:`, e);
            this.items.shift();
            this.persist();
            continue;
          }
          console.error(`Odeslání selhalo, zůstává ve frontě (zkusím znovu za ${OUTBOX_RETRY_INTERVAL_MS}ms):`, e);
          return;
        }
        this.items.shift();
        this.persist();
      }
    } finally {
      this.flushing = false;
    }
  }

  startRetryLoop(): NodeJS.Timeout {
    return setInterval(() => void this.flush(), OUTBOX_RETRY_INTERVAL_MS);
  }

  get pendingCount(): number {
    return this.items.length;
  }
}
