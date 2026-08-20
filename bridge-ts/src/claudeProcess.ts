import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { openSync } from "node:fs";
import { CLAUDE_CWD, STDERR_LOG, CLAUDE_TURN_TIMEOUT_MS, CONTEXT_CYCLE_THRESHOLD_TOKENS, CLAUDE_MODEL } from "./config.js";
import { getSessionId, saveSessionId } from "./session.js";
import { getHistory } from "./history.js";
import { looksLikeRateLimitText, parseResetsAtFromText, normalizeResetsAt } from "./rateLimit.js";
import { logTurn } from "./turnLog.js";

interface ClaudeResult {
  result: string;
  isError: boolean;
  /** Vyplněno, pokud tenhle tah narazil na Claude usage limit (5h/týdenní kvóta)
   * místo skutečné odpovědi — `resetsAtMs` je epoch ms, kdy se kvóta obnoví
   * (null, pokud se čas nepodařilo zjistit ani ze strukturovaného eventu, ani z textu). */
  rateLimitedAt: { resetsAtMs: number | null } | null;
}

export type RunClaudeOutcome =
  | { kind: "ok"; text: string }
  | { kind: "rate_limited"; resetsAtMs: number | null };

/** Prefix, kterým bot může začít text unsolicited tahu, aby se NEODESLAL do
 * Telegramu (viz `handleUnsolicitedLine`). Sdílené napříč všemi profily bota. */
export const SILENT_MARKER = "[TICHO]";

// Trvale běžící `claude` proces (stream-json na stdin/stdout), stejný vzor jako
// bridge.py — jeden proces drží kontext nativně mezi zprávami, `--resume` slouží jen
// jako záchranná síť po pádu, ne jako běžná cesta. Viz DECISIONS.md, 17.8.
export class ClaudeProcess {
  private proc: ChildProcess | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private lineQueue: string[] = [];
  private waiters: Array<(line: string | null) => void> = [];
  private lastContextTokens = 0;
  private cycleRequested = false;
  // True jen mezi zápisem na stdin v `send()` a jejím vrácením — mimo tenhle
  // interval nikdo neplive stdout, takže cokoliv přijde, je z tahu, který si
  // vyžádal někdo jiný než `send()` (viz `handleUnsolicitedLine`).
  private expectingResponse = false;
  private unsolicitedText = "";

  /** `bridge-ts` volá `send()` jen pro zprávy z Telegramu. Cross-session zprávy
   * (`SendMessage` od jiného bota) doručuje runtime přímo do běžícího `claude`
   * procesu mimo tenhle kanál — proces na ně sám odpoví tahem, jehož JSON eventy
   * dorazí na STEJNÝ stdout, ale bez aktivního `send()`, co by na ně čekal. Bez
   * rozlišení by takové řádky skončily v `lineQueue` a příští legitimní `send()`
   * (pro doopravdy novou zprávu z Telegramu) by je mylně přečetl jako odpověď na
   * SVOU otázku. Callback pak dostane finální text takového tahu, aby ho bridge
   * mohl poslat do vlastního Telegram chatu bota — jinak by cross-session úkol
   * zpracovaný mimo `send()` nebyl v Telegramu vidět vůbec. */
  constructor(private onUnsolicitedText?: (text: string) => void) {}

  /** Součet cache_read + cache_creation + input tokenů z posledního `result`
   * eventu — proxy pro to, kolik "stojí" připomenutí dosavadní historie. */
  getLastContextTokens(): number {
    return this.lastContextTokens;
  }

  /** Naplánuje čerstvou (ne `--resume`) session před ZAČÁTKEM příští zprávy —
   * ne uprostřed aktuální, ať se neztratí rozpracovaná odpověď. */
  requestCycle(): void {
    this.cycleRequested = true;
  }

  consumeCycleRequest(): boolean {
    const v = this.cycleRequested;
    this.cycleRequested = false;
    return v;
  }

  start(resumeSessionId: string | null): void {
    const args = [
      "-p",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
      "--autocompact", "auto",
      "--model", CLAUDE_MODEL,
    ];
    if (resumeSessionId) args.push("--resume", resumeSessionId);

    const stderrFd = openSync(STDERR_LOG, "a");
    const proc = spawn("claude", args, {
      cwd: CLAUDE_CWD,
      stdio: ["pipe", "pipe", stderrFd],
    });
    this.proc = proc;
    // `kill()` posílá SIGTERM, ale starý proces doopravdy skončí až za chvíli —
    // jeho 'exit'/'line' eventy proto mohou dorazit PO tom, co `start()` už
    // nastavil `this.proc` na nový proces. Bez tyhle identity kontroly by
    // takový pozdní 'exit' ze starého procesu sebral čekatele (waiter) patřícího
    // odpovědi nového procesu a `send()` by vyhodil falešné "EOF" — přesně tahle
    // race způsobovala EOF chyby při proaktivním cyklení session i při restartu
    // po pádu, i když nový proces běžel v pořádku.
    this.lineQueue = [];
    this.waiters = [];
    this.expectingResponse = false;
    this.unsolicitedText = "";
    this.rl = createInterface({ input: proc.stdout! });
    this.rl.on("line", (line) => {
      if (this.proc === proc) this.onLine(line);
    });
    proc.on("exit", () => {
      if (this.proc === proc) this.onExit();
    });
  }

  private onExit(): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter(null);
  }

  private onLine(line: string | null): void {
    if (!this.expectingResponse) {
      this.handleUnsolicitedLine(line);
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(line);
    } else if (line !== null) {
      this.lineQueue.push(line);
    }
  }

  /** Posílá text z tahu, který nikdo přes `send()` nevyžádal (typicky reakce na
   * cross-session zprávu), do vlastního Telegram chatu bota — živě, po každém
   * `assistant` bloku, ne až na `result`. Jeden takový tah může mít víc kroků
   * (text → nástroj → text → ... → result) a dřívější verze posílala jen ten
   * poslední kus textu před `result` — mezikroky (např. "dostal jsem úkol od X",
   * "zpracovávám: ...") tiše zmizely. Dedupe přes `unsolicitedText` brání dvojímu
   * odeslání stejného textu, když `result.result` jen zopakuje poslední `assistant`
   * blok.
   *
   * Výjimka: text začínající `SILENT_MARKER` se do Telegramu neposílá vůbec
   * (marker se ořízne, zbytek zahodí). Slouží pro rutinní, opakované unsolicited
   * tahy (typicky `CronCreate` probuzení uprostřed vlastní dávkové smyčky, např.
   * mailistino noční čištění schránky), kde by živé posílání KAŽDÉHO probuzení
   * do Telegramu bylo jen spam — na rozdíl od genuinní cross-session viditelnosti
   * (SendMessage od jiného bota, začátek/konec dávkové práce, eskalace), která má
   * dál chodit živě beze změny. Bota nic nenutí marker použít — je to nástroj pro
   * bota, ne bezpečnostní mechanismus. Viz META_BOT.md. */
  private handleUnsolicitedLine(line: string | null): void {
    if (line === null) return;
    const trimmed = line.trim();
    if (!trimmed) return;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (obj.type === "assistant") {
      const blocks = obj.message?.content ?? [];
      const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
      if (text && text !== this.unsolicitedText) {
        this.unsolicitedText = text;
        if (!text.trimStart().startsWith(SILENT_MARKER)) this.onUnsolicitedText?.(text);
      }
    }
    if (obj.type === "result") {
      const text = obj.result;
      if (text && text !== this.unsolicitedText) {
        if (!text.trimStart().startsWith(SILENT_MARKER)) this.onUnsolicitedText?.(text);
      }
      this.unsolicitedText = "";
    }
  }

  private nextLine(): { promise: Promise<string | null>; cancel: () => void } {
    if (this.lineQueue.length > 0) {
      return { promise: Promise.resolve(this.lineQueue.shift()!), cancel: () => {} };
    }
    let resolver!: (line: string | null) => void;
    const promise = new Promise<string | null>((resolve) => {
      resolver = resolve;
      this.waiters.push(resolver);
    });
    const cancel = () => {
      const idx = this.waiters.indexOf(resolver);
      if (idx !== -1) this.waiters.splice(idx, 1);
    };
    return { promise, cancel };
  }

  isAlive(): boolean {
    return this.proc !== null && this.proc.exitCode === null && !this.proc.killed;
  }

  kill(): void {
    try {
      this.proc?.kill();
    } catch {
      // proces už neběží, nic k řešení
    }
  }

  /** Pošle jednu zprávu a čeká na {"type":"result"}. Vrací i poslední zachycený
   * dílčí text asistenta, pro případ, že proces spadne dřív, než dorazí result. */
  async send(promptText: string, timeoutMs = CLAUDE_TURN_TIMEOUT_MS): Promise<ClaudeResult> {
    if (!this.proc) throw new Error("claude proces není nastartovaný");
    this.expectingResponse = true;
    try {
      return await this.sendAndAwaitResult(promptText, timeoutMs);
    } finally {
      this.expectingResponse = false;
    }
  }

  private async sendAndAwaitResult(promptText: string, timeoutMs: number): Promise<ClaudeResult> {
    const msg = JSON.stringify({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: promptText }] },
    });
    this.proc!.stdin!.write(msg + "\n");

    let lastAssistantText = "";
    let structuredResetsAtMs: number | null = null;
    const deadline = Date.now() + timeoutMs;
    const TIMED_OUT = Symbol("timed_out");

    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const { promise, cancel } = this.nextLine();
      const line = await Promise.race([
        promise,
        new Promise<typeof TIMED_OUT>((resolve) => setTimeout(() => resolve(TIMED_OUT), remaining)),
      ]);

      if (line === TIMED_OUT) {
        cancel();
        // Timeout tady jen znamená, že BRIDGE přestal čekat — `claude` proces samotný
        // dál běží a časem stejně vyprodukuje `result`. Bez zabití by ten výsledek
        // zůstal viset v `lineQueue`/`waiters` a "ukradl" by ho úplně JINÝ, pozdější
        // `send()` volaný pro DALŠÍ (nesouvisející) zprávu od uživatele — odpověď by
        // se pak spárovala se špatnou otázkou (a `isAlive()` by mylně hlásil živý
        // proces, takže by se pro tu další zprávu vůbec nezaložila čerstvá session).
        // Zabitím tady se `isAlive()` po timeoutu spolehlivě vrátí `false`.
        this.kill();
        break;
      }
      if (line === null) throw new Error("claude proces skončil (EOF na stdout)");

      const trimmed = line.trim();
      if (!trimmed) continue;
      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        continue;
      }

      if (obj.session_id) saveSessionId(obj.session_id);

      if (obj.type === "assistant") {
        const blocks = obj.message?.content ?? [];
        const text = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
        if (text) lastAssistantText = text;
      }

      // Strukturovaný signál, že tenhle tah narazil na kvótu (5h/týdenní) — spolehlivější
      // než parsování textu, obsahuje přesný `resetsAt` (epoch, viz normalizeResetsAt).
      if (obj.type === "rate_limit_event" && obj.rate_limit_info?.status === "rejected") {
        const resetsAt = obj.rate_limit_info?.resetsAt;
        structuredResetsAtMs = typeof resetsAt === "number" ? normalizeResetsAt(resetsAt) : null;
      }

      if (obj.type === "result") {
        const usage = obj.usage ?? {};
        const cacheRead = usage.cache_read_input_tokens ?? 0;
        const cacheCreation = usage.cache_creation_input_tokens ?? 0;
        const inputTokens = usage.input_tokens ?? 0;
        this.lastContextTokens = cacheRead + cacheCreation + inputTokens;
        if (this.lastContextTokens > CONTEXT_CYCLE_THRESHOLD_TOKENS) this.requestCycle();

        const resultText = obj.result || lastAssistantText || "Úkol dokončen.";
        const rateLimited = structuredResetsAtMs !== null || looksLikeRateLimitText(resultText);
        const rateLimitedAt = rateLimited
          ? { resetsAtMs: structuredResetsAtMs ?? parseResetsAtFromText(resultText) }
          : null;

        logTurn({
          type: "turn",
          ts: new Date().toISOString(),
          contextTokens: this.lastContextTokens,
          newTokens: cacheCreation + inputTokens,
          durationMs: typeof obj.duration_ms === "number" ? obj.duration_ms : null,
          durationApiMs: typeof obj.duration_api_ms === "number" ? obj.duration_api_ms : null,
          isError: !!obj.is_error,
          rateLimited,
          resetsAtMs: rateLimitedAt?.resetsAtMs ?? null,
        });

        return { result: resultText, isError: !!obj.is_error, rateLimitedAt };
      }
    }
    throw new Error(lastAssistantText ? `claude proces neodpověděl včas (částečný text: ${lastAssistantText.slice(0, 200)})` : "claude proces neodpověděl včas");
  }
}

function buildSeedPrompt(userText: string, downloadedFileInfo: string): string {
  const historyContext = getHistory();
  return (
    `HISTORIE KONVERZACE:\n${historyContext}\n` +
    `${downloadedFileInfo}` +
    `AKTUÁLNÍ ZPRÁVA OD UŽIVATELE: ${userText}\n\n` +
    `Odpověz věcně. Pokud uživatel přiložil soubor, zkontroluj jeho obsah v inboxu.`
  );
}

/** Posílá zprávy do trvale běžícího procesu. Tři cesty na "novou" session:
 * (1) proaktivní cyklení — `usage` z předchozího tahu přesáhl
 * `CONTEXT_CYCLE_THRESHOLD_TOKENS`, založí se čerstvá session PŘED touhle zprávou
 * (ne uprostřed předchozí), ať neroste cena/kvóta za tah donekonečna;
 * (2) pád/timeout — jeden pokus o restart s `--resume`;
 * (3) pokud selže i to, čistě nová session s textovou historií jako fallback
 * kontextu (stejný mechanismus jako `bridge.py`). Ve všech třech případech, kde se
 * nezachovává `--resume`, se prompt seedne `chat_history.txt`, takže se navenek nic
 * neztrácí — trvalé znalosti (`DECISIONS.md`/`TASKS.md`) stejně žijí v souborech. */
export async function runClaude(cp: ClaudeProcess, userText: string, downloadedFileInfo: string): Promise<RunClaudeOutcome> {
  let prompt = `${downloadedFileInfo}${userText}`;

  if (!cp.isAlive()) {
    cp.start(getSessionId());
  } else if (cp.consumeCycleRequest()) {
    cp.kill();
    cp.start(null);
    prompt = buildSeedPrompt(userText, downloadedFileInfo);
    console.log(`Proaktivní cyklení session (kontext přesáhl práh, poslední tah: ${cp.getLastContextTokens()} tokenů).`);
    logTurn({ type: "cycle", ts: new Date().toISOString(), contextTokensAtCycle: cp.getLastContextTokens() });
  }

  try {
    const { result, isError, rateLimitedAt } = await cp.send(prompt);
    // Kvóta se neobnoví tím, že hned zkusíme znovu — na rozdíl od skutečných chyb
    // se restart/retry s tímhle stavem přeskakuje, ať se limit nezkouší zbytečně
    // podruhé; volající (processQueue) úkol nechá ve frontě a zkusí ho sám po resetu.
    if (rateLimitedAt) return { kind: "rate_limited", resetsAtMs: rateLimitedAt.resetsAtMs };
    if (!isError) return { kind: "ok", text: result };
  } catch (e) {
    console.error("Chyba komunikace s claude procesem:", e);
  }

  cp.kill();
  cp.start(null);
  try {
    const { result, rateLimitedAt } = await cp.send(buildSeedPrompt(userText, downloadedFileInfo));
    if (rateLimitedAt) return { kind: "rate_limited", resetsAtMs: rateLimitedAt.resetsAtMs };
    return { kind: "ok", text: result };
  } catch (e) {
    console.error("Chyba i po restartu claude procesu:", e);
    return { kind: "ok", text: `⚠️ Nepodařilo se spojit s Claude procesem: ${e}` };
  }
}
