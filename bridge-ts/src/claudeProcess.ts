import { spawn, ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { openSync } from "node:fs";
import { CLAUDE_CWD, STDERR_LOG, CLAUDE_TURN_TIMEOUT_MS, CONTEXT_CYCLE_THRESHOLD_TOKENS, CLAUDE_MODEL } from "./config.js";
import { getSessionId, saveSessionId } from "./session.js";
import { getHistory, appendHistory } from "./history.js";
import { looksLikeRateLimitText, parseResetsAtFromText, normalizeResetsAt } from "./rateLimit.js";
import { logTurn } from "./turnLog.js";

interface ClaudeResult {
  result: string;
  isError: boolean;
  /** Set if this turn hit the Claude usage limit (5h/weekly quota) instead of
   * a real reply — `resetsAtMs` is the epoch ms when the quota resets
   * (null if the time couldn't be determined from either the structured event or the text). */
  rateLimitedAt: { resetsAtMs: number | null } | null;
}

export type RunClaudeOutcome =
  | { kind: "ok"; text: string }
  | { kind: "rate_limited"; resetsAtMs: number | null }
  | { kind: "auth_error"; text: string }
  | { kind: "error"; text: string }
  // Original attempt and post-restart retry both produced no clean result at all
  // (timeout or process death, no reply text) — an unconfirmed guess at quota
  // exhaustion, not a recognized rate_limit_event. See `isNoCleanResultError`.
  | { kind: "suspected_rate_limited" };

// The only known pattern so far (incident 14.9.): "Failed to authenticate: OAuth
// session expired and could not be refreshed" — both regexes must match together, so
// we don't catch other auth errors (e.g. a bad API key) that don't mention OAuth.
const OAUTH_ERROR_PATTERN = /oauth/i;
const AUTH_FAILURE_PATTERN = /expired|authenticat/i;

function looksLikeAuthError(text: string): boolean {
  return OAUTH_ERROR_PATTERN.test(text) && AUTH_FAILURE_PATTERN.test(text);
}

// Matches the two throw sites in `sendAndAwaitResult`: timeout (no `result` event) or
// the process dying mid-turn (EOF on stdout).
const NO_CLEAN_RESULT_PATTERN = /neodpověděl včas|EOF na stdout/;

function isNoCleanResultError(e: unknown): boolean {
  return e instanceof Error && NO_CLEAN_RESULT_PATTERN.test(e.message);
}

/** Prefix a bot can start an unsolicited turn's text with so it does NOT get sent
 * to Telegram (see `handleUnsolicitedLine`). Shared across all bot profiles. */
export const SILENT_MARKER = "[TICHO]";

// A permanently running `claude` process (stream-json on stdin/stdout), same pattern
// as bridge.py — one process holds context natively across messages, `--resume` only
// serves as a safety net after a crash, not as the normal path. See DECISIONS.md, 17.8.
export class ClaudeProcess {
  private proc: ChildProcess | null = null;
  private rl: ReturnType<typeof createInterface> | null = null;
  private lineQueue: string[] = [];
  private waiters: Array<(line: string | null) => void> = [];
  private lastContextTokens = 0;
  private cycleRequested = false;
  // True only between the stdin write in `send()` and its return — outside that
  // window nobody is spewing stdout on our behalf, so anything that arrives is from
  // a turn requested by someone other than `send()` (see `handleUnsolicitedLine`).
  private expectingResponse = false;
  private unsolicitedText = "";
  // Whether the current unsolicited turn has already sent its first live `assistant`
  // block (see `handleUnsolicitedLine`) — gates live sends to just the first block,
  // reset alongside `unsolicitedText` at the same two points (new process in `start()`,
  // end of turn in the `result` handler).
  private firstBlockSeen = false;

  /** `bridge-ts` calls `send()` only for messages coming from Telegram. Cross-session
   * messages (a `SendMessage` from another bot) are delivered by the runtime directly
   * into the running `claude` process outside this channel — the process replies on
   * its own with a turn whose JSON events land on the SAME stdout, but without an
   * active `send()` waiting for them. Without this distinction such lines would end up
   * in `lineQueue` and the next legitimate `send()` (for an actually new message from
   * Telegram) would mistakenly read them as the reply to ITS OWN question. The callback
   * then receives that turn's final text so the bridge can post it into the bot's own
   * Telegram chat — otherwise a cross-session task handled outside `send()` would never
   * be visible in Telegram at all. */
  constructor(private onUnsolicitedText?: (text: string) => void) {}

  /** Sum of cache_read + cache_creation + input tokens from the last `result`
   * event — a proxy for how much "recalling" the history so far "costs". */
  getLastContextTokens(): number {
    return this.lastContextTokens;
  }

  /** Schedules a fresh (non-`--resume`) session before the START of the next
   * message — not in the middle of the current one, so an in-progress reply isn't lost. */
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
    // `kill()` sends SIGTERM, but the old process actually terminates only a bit later —
    // its 'exit'/'line' events can therefore arrive AFTER `start()` has already set
    // `this.proc` to the new process. Without this identity check, such a late 'exit'
    // from the old process would grab a waiter belonging to the new process's reply,
    // and `send()` would throw a false "EOF" — this exact race caused EOF errors both
    // during proactive session cycling and during restart-after-crash, even though the
    // new process was running fine.
    this.lineQueue = [];
    this.waiters = [];
    this.expectingResponse = false;
    this.unsolicitedText = "";
    this.firstBlockSeen = false;
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

  /** Sends the text of a turn nobody requested through `send()` (typically a reaction
   * to a cross-session message) into the bot's own Telegram chat — live, but only the
   * FIRST `assistant` block and the FINAL `result` text, not every block in between.
   * Such a turn can have several steps (text → tool → text → ... → result); an earlier
   * version live-sent every intermediate `assistant` block, which meant every working
   * note in a multi-step turn landed in the user's Telegram as its own message —
   * confirmed spam of chopped-up, sometimes English mid-turn notes into an otherwise
   * Czech chat. Now only the opening block ("got a task from X", "working on: ...")
   * and the closing result are posted live; `firstBlockSeen` gates everything after the
   * first block. `unsolicitedText` still tracks every block regardless of whether it
   * was sent live — it's needed both for `result`-vs-last-block dedup below and as the
   * history fallback when `result.result` is empty/non-string.
   *
   * Exception: text starting with `SILENT_MARKER` is not sent to Telegram at all
   * (the marker is stripped, the rest discarded) — even if it's the first block, so a
   * silent first block still "consumes" the first-block slot without posting anything
   * live. This is for routine, repeated unsolicited turns (typically a `CronCreate`
   * wakeup in the middle of a bot's own batch loop, e.g. mailista's nightly mailbox
   * cleanup), where live-posting EVERY wakeup to Telegram would just be spam — unlike
   * genuine cross-session visibility (a SendMessage from another bot, start/end of
   * batch work, escalation), which should keep going out live unchanged. Nothing
   * forces a bot to use the marker — it's a tool for the bot, not a security
   * mechanism. See META_BOT.md. */
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
        const isFirstBlock = !this.firstBlockSeen;
        this.firstBlockSeen = true;
        if (isFirstBlock && !text.trimStart().startsWith(SILENT_MARKER)) {
          try {
            this.onUnsolicitedText?.(text);
          } catch (err) {
            console.error("Telegram broadcast unsolicited textu selhal:", err);
          }
        }
      }
    }
    if (obj.type === "result") {
      // `obj.result` is sometimes non-string too (observed in practice) — in that
      // case nothing gets broadcast (the earlier `assistant` block already went out
      // live), but for the history write the last streamed `assistant` text
      // (`this.unsolicitedText`) is used as a fallback, same as the `send()` path
      // below falling back to `lastAssistantText` — otherwise this turn would be lost
      // from history entirely, exactly the incident this iteration fixes.
      const rawText = typeof obj.result === "string" ? obj.result : "";
      const historyText = rawText || this.unsolicitedText;
      const isSilent = historyText.trimStart().startsWith(SILENT_MARKER);
      const shouldNotify = Boolean(rawText) && rawText !== this.unsolicitedText && !isSilent;
      // The reset happens first and is purely in-memory (can't fail) — the Telegram
      // broadcast and the history write below both do I/O independently of each other,
      // so a failure in one (Telegram API outage; the file write already guards itself
      // inside `appendHistory`) doesn't take down the other or leave the dedup state
      // stuck on the old text.
      this.unsolicitedText = "";
      this.firstBlockSeen = false;
      if (shouldNotify) {
        try {
          this.onUnsolicitedText?.(rawText);
        } catch (err) {
          console.error("Telegram broadcast unsolicited textu selhal:", err);
        }
      }
      if (historyText && !isSilent) {
        // Writing to `chat_history.txt` is INDEPENDENT of the dedup condition above
        // (that one only prevents sending the same text to Telegram twice when
        // `result.result` repeats the last `assistant` block) — the final text of
        // EVERY non-silent unsolicited turn must always go into history, otherwise
        // the agent knows nothing about it after a later context cycle (seeded only
        // from `chat_history.txt`) — incident: this is how an entire approved spec
        // got lost. Only this final message is written, not the streamed intermediate
        // steps above, so history doesn't bloat with duplicates. `logTurn`/turn
        // statistics are deliberately not included here — this turn has no `usage`
        // data from `runClaude`.
        appendHistory("[cross-session/background událost]", historyText);
      }
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
      // process already isn't running, nothing to handle
    }
  }

  /** Sends one message and waits for {"type":"result"}. Also returns the last
   * captured partial assistant text, in case the process crashes before result arrives. */
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
        // A timeout here just means the BRIDGE stopped waiting — the `claude` process
        // itself keeps running and will eventually produce a `result` anyway. Without
        // killing it, that result would stay stuck in `lineQueue`/`waiters` and get
        // "stolen" by a completely DIFFERENT, later `send()` call for the NEXT
        // (unrelated) message from the user — the reply would then get paired with the
        // wrong question (and `isAlive()` would falsely report a live process, so no
        // fresh session would be started for that next message at all). Killing it here
        // makes `isAlive()` reliably return `false` after a timeout.
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

      // A structured signal that this turn hit the quota (5h/weekly) — more reliable
      // than parsing text, contains the exact `resetsAt` (epoch, see normalizeResetsAt).
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

/** Sends messages to the permanently running process. Three paths to a "new" session:
 * (1) proactive cycling — the previous turn's `usage` exceeded
 * `CONTEXT_CYCLE_THRESHOLD_TOKENS`, a fresh session is started BEFORE this message
 * (not in the middle of the previous one), so the cost/quota per turn doesn't grow
 * forever;
 * (2) crash/timeout — one restart attempt with `--resume`;
 * (3) if that fails too, a completely new session with the text history as a context
 * fallback (same mechanism as `bridge.py`). In all three cases where `--resume` isn't
 * preserved, the prompt is seeded from `chat_history.txt`, so nothing is lost from the
 * outside — persistent knowledge (`DECISIONS.md`/`TASKS.md`) lives in files anyway. */
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

  let firstAttemptNoCleanResult = false;
  try {
    const { result, isError, rateLimitedAt } = await cp.send(prompt);
    // The quota doesn't come back just because we try again right away — unlike real
    // errors, restart/retry is skipped for this state, so we don't hit the limit a
    // second time for nothing; the caller (processQueue) leaves the task in the queue
    // and retries it itself after the reset.
    if (rateLimitedAt) return { kind: "rate_limited", resetsAtMs: rateLimitedAt.resetsAtMs };
    if (!isError) return { kind: "ok", text: result };
  } catch (e) {
    console.error("Chyba komunikace s claude procesem:", e);
    firstAttemptNoCleanResult = isNoCleanResultError(e);
  }

  cp.kill();
  cp.start(null);
  try {
    const { result, isError, rateLimitedAt } = await cp.send(buildSeedPrompt(userText, downloadedFileInfo));
    if (rateLimitedAt) return { kind: "rate_limited", resetsAtMs: rateLimitedAt.resetsAtMs };
    if (isError) return looksLikeAuthError(result) ? { kind: "auth_error", text: result } : { kind: "error", text: result };
    return { kind: "ok", text: result };
  } catch (e) {
    console.error("Chyba i po restartu claude procesu:", e);
    // Only flag as suspected rate limit if both attempts failed the same way — a
    // single isolated timeout stays a plain `error`.
    if (firstAttemptNoCleanResult && isNoCleanResultError(e)) {
      return { kind: "suspected_rate_limited" };
    }
    return { kind: "error", text: `Nepodařilo se spojit s Claude procesem: ${e}` };
  }
}
