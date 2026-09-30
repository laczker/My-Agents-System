import { Bot, GrammyError } from "grammy";
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_CHAT_IDS, STARTUP_MESSAGE, RATE_LIMIT_FALLBACK_WAIT_MS, RATE_LIMIT_RESUME_BUFFER_MS } from "./config.js";
import { ClaudeProcess, runClaude } from "./claudeProcess.js";
import { getSessionId } from "./session.js";
import { appendHistory } from "./history.js";
import { Outbox } from "./outbox.js";
import { startHeartbeatLoop, touchHeartbeat } from "./heartbeat.js";
import { downloadAttachment } from "./attachments.js";
import { Job, loadQueueState, saveQueueState } from "./queue.js";
import { formatResetTimeLocal } from "./rateLimit.js";

const bot = new Bot(TELEGRAM_BOT_TOKEN);

async function sendRaw(text: string, chatId: string): Promise<void> {
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (const chunk of chunks) {
    try {
      await bot.api.sendMessage(chatId, chunk, { parse_mode: "Markdown" });
    } catch (e) {
      // Claude doesn't generate text strictly for legacy Telegram Markdown (unbalanced/
      // unpaired entities) — better to deliver the raw text than let it fall into the
      // outbox, where the new 400-permanent-error logic would silently drop it (see
      // DECISIONS.md).
      if (e instanceof GrammyError && e.error_code === 400 && e.description.includes("can't parse entities")) {
        await bot.api.sendMessage(chatId, chunk);
      } else {
        throw e;
      }
    }
  }
}

const outbox = new Outbox(sendRaw);

/** A reply to a specific message/task — belongs to whoever asked, not to all allowed
 * chats (relevant only for bots with more than one chat ID). */
function sendMsg(text: string, chatId: string = TELEGRAM_CHAT_ID): void {
  outbox.enqueue(text, chatId);
}

/** System messages not tied to a specific query (start, rate limit, cross-session
 * notifications) — these concern everyone who talks to the bot, so they go to all
 * allowed chats. For a single-chat bot (`TELEGRAM_CHAT_IDS_EXTRA` unset) that's just
 * one chat, no change in behavior. */
function broadcastMsg(text: string): void {
  for (const chatId of TELEGRAM_CHAT_IDS) sendMsg(text, chatId);
}

const jobQueue: Job[] = [];
let processing = false;
// null = the queue isn't waiting on the quota. Otherwise epoch ms until which
// `processQueue()` refuses a new attempt (the timer below unblocks it on its own) —
// set only when `runClaude` reports `rate_limited`, not for regular errors.
let rateLimitResumeAtMs: number | null = null;
let rateLimitTimer: NodeJS.Timeout | null = null;

function persistQueue(): void {
  saveQueueState({ jobs: jobQueue, rateLimitResumeAtMs });
}

/** Schedules automatic continuation of the queue once the Claude usage limit resets,
 * and immediately tells the user about it (with the local reset time) — before this,
 * an in-progress task just silently got lost as soon as the limit message came back
 * as a "result". With `isRestore` (the watchdog restarted the process, the limit
 * still hasn't lapsed) the new message is NOT sent — the user was already informed
 * on the first hit of the limit, and the watchdog can restart more than once per
 * hour, which would otherwise lead to duplicate "still waiting" messages (see
 * `watchdog.log`, historically spammed the user). */
function enterRateLimitWait(resetsAtMs: number | null, isRestore = false): void {
  const resumeAt = resetsAtMs ?? Date.now() + RATE_LIMIT_FALLBACK_WAIT_MS;
  rateLimitResumeAtMs = resumeAt;
  persistQueue();

  if (!isRestore) {
    const when = resetsAtMs ? formatResetTimeLocal(resumeAt) : "zkusím to znovu za chvíli, přesný čas obnovení kvóta nehlásila";
    broadcastMsg(
      `⏳ Narazil jsem na Claude usage limit. Rozpracovaný úkol zůstává ve frontě, dokončím ho automaticky po obnovení kvóty — ${when}.`,
    );
  }

  if (rateLimitTimer) clearTimeout(rateLimitTimer);
  const delay = Math.max(resumeAt - Date.now(), 0) + RATE_LIMIT_RESUME_BUFFER_MS;
  rateLimitTimer = setTimeout(() => {
    rateLimitResumeAtMs = null;
    persistQueue();
    broadcastMsg("🔄 Kvóta by měla být zpět, pokračuji v rozpracovaném úkolu...");
    void processQueue();
  }, delay);
}

// The Telegram "typing..." animation disappears for the user after ~5s, so it has to
// be repeated for as long as `runClaude` runs (easily tens of minutes). An error
// (network outage etc.) is silently ignored — it's cosmetic, must not crash/delay
// task processing.
function startTypingIndicator(chatId: string): NodeJS.Timeout {
  const tick = () => void bot.api.sendChatAction(chatId, "typing").catch(() => {});
  tick();
  return setInterval(tick, 4_000);
}

async function processQueue(): Promise<void> {
  if (processing) return;
  // Still waiting for the quota reset — the timer above unblocks this on its own,
  // this early return just prevents new incoming messages from hammering the limit
  // again in the meantime.
  if (rateLimitResumeAtMs !== null && Date.now() < rateLimitResumeAtMs) return;
  processing = true;
  try {
    while (jobQueue.length > 0) {
      const job = jobQueue[0];
      const jobChatId = job.chatId ?? TELEGRAM_CHAT_ID;
      let outcome: Awaited<ReturnType<typeof runClaude>>;
      const typingTimer = startTypingIndicator(jobChatId);
      try {
        outcome = await runClaude(claudeProcess, job.userText, job.downloadedFileInfo);
      } catch (e) {
        // Previously this ended up as an unhandledRejection from `void processQueue()`
        // — it just got logged, the user never found out, and the in-progress result
        // (see `neodpověděl včas (částečný text: ...)`) disappeared without a trace.
        // The job stays at the head of the queue (not shifted off), so it's retried
        // on the next message.
        const msg = e instanceof Error ? e.message : String(e);
        sendMsg(`⚠️ Tah selhal (${msg}). Úkol zůstává ve frontě, zkusím to znovu při další zprávě.`, jobChatId);
        return;
      } finally {
        clearInterval(typingTimer);
      }
      if (outcome.kind === "rate_limited") {
        enterRateLimitWait(outcome.resetsAtMs);
        return;
      }
      jobQueue.shift();
      persistQueue();
      if (outcome.kind === "auth_error") {
        // Doesn't just concern the one who asked — as long as auth is broken, it won't
        // respond to other messages either, hence broadcast to all allowed chats, same
        // as for rate limiting.
        broadcastMsg(`🔐 Claude autentizace vypadla (OAuth session expired), úkol nedokončen: ${outcome.text}`);
        touchHeartbeat();
        // Unlike rate_limited, there's no timer to resume here — without this return
        // the queue would immediately try the remaining tasks too, each with its own
        // restart+retry (~30 min) and duplicate broadcast, even though auth doesn't
        // work for any of them.
        return;
      }
      if (outcome.kind === "error") {
        sendMsg(`⚠️ Úkol selhal: ${outcome.text}`, jobChatId);
      } else {
        appendHistory(job.userText + job.downloadedFileInfo, outcome.text);
        sendMsg(`✅ Výsledek:\n${outcome.text}`, jobChatId);
      }
      touchHeartbeat();
    }
  } finally {
    processing = false;
  }
}

// `onUnsolicitedText`: reaction to a cross-session message (a SendMessage from
// another bot) that the runtime delivered outside `send()` — without this, such a
// reaction (e.g. "Working on your task...") wouldn't be visible anywhere in
// Telegram. It's not tied to a specific chat that asked, hence broadcast to all
// allowed ones.
const claudeProcess = new ClaudeProcess((text) => broadcastMsg(text));

bot.on("message", async (ctx) => {
  const chatId = String(ctx.chat.id);
  if (!TELEGRAM_CHAT_IDS.includes(chatId)) return;

  const msg = ctx.message;
  let userText = msg.text ?? msg.caption ?? "";
  let downloadedFileInfo = "";

  if (msg.document) {
    const fileName = msg.document.file_name ?? "uploaded_file";
    const res = await downloadAttachment(bot, msg.document.file_id, fileName);
    if ("path" in res) {
      downloadedFileInfo = `\n[PŘIPOJEN SOUBOR: ${res.path}]\n`;
    } else {
      sendMsg(`⚠️ Nepodařilo se stáhnout přílohu '${fileName}': ${res.error}`, chatId);
    }
  } else if (msg.photo && msg.photo.length > 0) {
    const photo = msg.photo[msg.photo.length - 1];
    const fileName = `${photo.file_unique_id}.jpg`;
    const res = await downloadAttachment(bot, photo.file_id, fileName);
    if ("path" in res) {
      downloadedFileInfo = `\n[PŘIPOJEN SOUBOR: ${res.path}]\n`;
    } else {
      sendMsg(`⚠️ Nepodařilo se stáhnout přílohu '${fileName}': ${res.error}`, chatId);
    }
  }

  if (!userText && !downloadedFileInfo) return;

  const wasIdle = jobQueue.length === 0 && !processing;
  jobQueue.push({ userText, downloadedFileInfo, chatId });
  persistQueue();
  // The typing indicator (startTypingIndicator, started right at the beginning of
  // processQueue) doesn't show up in an open conversation on some clients (only in
  // the chat list), so a text message runs alongside it as reliable feedback.
  if (wasIdle) {
    sendMsg(`⏳ Zpracovávám...`, chatId);
  } else {
    sendMsg(`📥 Přijato, ve frontě (pozice ${jobQueue.length}), zpracuji hned po předchozí zprávě.`, chatId);
  }

  // Not waiting for completion — the handler returns immediately, so grammY can accept
  // the next message right away even while this one is still running (fixes "you don't
  // reply when I send several messages").
  void processQueue();
});

bot.catch((err) => {
  console.error("Chyba v grammY handleru:", err);
});

// Shortly after a restart (the old process just killed by the watchdog/a redeploy),
// Telegram still holds the previous long-poll connection on the same token for a
// while — the first getUpdates then gets a 409 Conflict. grammY deliberately doesn't
// retry this itself (409 is rethrown, see bot.js handlePollingError) — for a real
// collision between two different bots, silent retrying would just mask the problem.
// Here, though, we know it's our own restart, not another instance, so a few quick
// attempts with growing backoff are usually enough instead of waiting up to a minute
// for the cron watchdog.
const STARTUP_409_RETRY_DELAYS_MS = [2_000, 4_000, 8_000, 16_000, 30_000];

async function startPollingWithRetry(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await bot.start({
        drop_pending_updates: true,
        onStart: () => console.log("Bot spuštěn, dlouhé pollování běží."),
      });
      return;
    } catch (err) {
      const is409 = err instanceof GrammyError && err.error_code === 409;
      const delay = STARTUP_409_RETRY_DELAYS_MS[attempt];
      if (!is409 || delay === undefined) throw err;
      console.error(`409 Conflict při startu pollování (pokus ${attempt + 1}), zkouším znovu za ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

function restoreQueueState(): void {
  const state = loadQueueState();
  jobQueue.push(...state.jobs);
  if (state.rateLimitResumeAtMs === null) return;

  if (Date.now() >= state.rateLimitResumeAtMs) {
    // The limit reset while the bridge wasn't running (crash/redeploy) — process right away.
    return;
  }
  // Still waiting — restore the timer too; `main()` calls `processQueue()` at the end,
  // which, thanks to `rateLimitResumeAtMs`, waits on its own until this timer fires.
  enterRateLimitWait(state.rateLimitResumeAtMs, true);
}

async function main() {
  await outbox.flush(); // delivers whatever didn't get sent before the last crash/restart
  outbox.startRetryLoop();
  startHeartbeatLoop();
  claudeProcess.start(getSessionId());
  restoreQueueState();

  broadcastMsg(STARTUP_MESSAGE);

  if (jobQueue.length > 0) void processQueue();

  await startPollingWithRetry();
}

process.on("SIGTERM", () => {
  claudeProcess.kill();
  process.exit(0);
});
process.on("SIGINT", () => {
  claudeProcess.kill();
  process.exit(0);
});

// Previously without this: any uncaught error (e.g. a rejected promise somewhere
// outside the main handler) crashed the entire process (see DECISIONS.md, crash on
// 17.8. after setting up mailista) — even in the middle of an hours-long wait for the
// usage limit reset, which would have wiped the unsaved queue. Now it's just logged
// and the process keeps running; `jobQueue`/`rateLimitResumeAtMs` also survive in
// `job_queue_ts.json`, so even if it crashed anyway, the watchdog (cron, within a
// minute) restarts it with its state intact.
process.on("unhandledRejection", (reason) => {
  console.error("Nezachycené odmítnutí promise:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Nezachycená výjimka:", err);
});

main().catch((e) => {
  console.error("Fatální chyba při startu:", e);
  // `claudeProcess.start()` in main() runs BEFORE polling Telegram — if polling
  // ultimately fails (409 persists even after retrying), without this the `claude`
  // subprocess would be left orphaned (ppid 1) and keep running for nothing, because
  // the SIGTERM handler isn't reached here, only this catch.
  claudeProcess.kill();
  process.exit(1);
});
