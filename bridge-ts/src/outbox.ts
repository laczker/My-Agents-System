import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { GrammyError } from "grammy";
import { OUTBOX_FILE, OUTBOX_RETRY_INTERVAL_MS, TELEGRAM_CHAT_ID } from "./config.js";

// 400 = chyba vázaná na tuhle konkrétní zprávu/chat (např. "chat not found", příliš
// dlouhý text, špatný Markdown) — retry by dopadl stejně, takže zahodit.
// 403 = bot je v chatu zablokovaný/vyhozený — trvalé pro celý chat, ne jen tuhle
// zprávu, ale pořád nemá smysl frontu blokovat kvůli němu.
const PERMANENT_ERROR_CODES = new Set([400, 403]);

interface OutboxItem {
  id: string;
  text: string;
  createdAt: number;
  /** Kam zprávu poslat. Staré položky z outboxu (před touhle změnou) klíč nemají —
   * dopočítá se na `TELEGRAM_CHAT_ID`, stejné chování jako dřív. */
  chatId?: string;
}

// Trvalá fronta odchozích zpráv (Ludwigův vzor). Zpráva se na disk zapíše DŘÍV, než
// se vůbec zkusí odeslat — takže i když bridge proces spadne/restartuje se uprostřed
// odesílání (nebo hned po dopočítání odpovědi, před odesláním), zpráva se po
// znovunastartování při flushOutbox() doručí, místo aby zmizela. Tohle nahrazuje
// Ludwigovo "grab poslední text z transkriptu" spolehlivěji — nezávisí na parsování
// transkriptu, jen na tom, že zápis na disk proběhl dřív než síťové volání.
export class Outbox {
  private items: OutboxItem[] = [];
  private sendFn: (text: string, chatId: string) => Promise<void>;
  private flushing = false;

  constructor(sendFn: (text: string, chatId: string) => Promise<void>) {
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

  enqueue(text: string, chatId: string = TELEGRAM_CHAT_ID): void {
    this.items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, text, createdAt: Date.now(), chatId });
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
          await this.sendFn(item.text, item.chatId ?? TELEGRAM_CHAT_ID);
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
