import { Bot, GrammyError } from "grammy";
import { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, STARTUP_MESSAGE, RATE_LIMIT_FALLBACK_WAIT_MS, RATE_LIMIT_RESUME_BUFFER_MS } from "./config.js";
import { ClaudeProcess, runClaude } from "./claudeProcess.js";
import { getSessionId } from "./session.js";
import { appendHistory } from "./history.js";
import { Outbox } from "./outbox.js";
import { startHeartbeatLoop, touchHeartbeat } from "./heartbeat.js";
import { downloadAttachment } from "./attachments.js";
import { Job, loadQueueState, saveQueueState } from "./queue.js";
import { formatResetTimeLocal } from "./rateLimit.js";

const bot = new Bot(TELEGRAM_BOT_TOKEN);

async function sendRaw(text: string): Promise<void> {
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (const chunk of chunks) {
    await bot.api.sendMessage(TELEGRAM_CHAT_ID, chunk);
  }
}

const outbox = new Outbox(sendRaw);

function sendMsg(text: string): void {
  outbox.enqueue(text);
}

const jobQueue: Job[] = [];
let processing = false;
// null = fronta se nečeká na kvótu. Jinak epoch ms, dokdy `processQueue()` odmítá
// nový pokus (timer níž ho sám odblokuje) — nastaví se, jen když `runClaude` nahlásí
// `rate_limited`, ne při běžných chybách.
let rateLimitResumeAtMs: number | null = null;
let rateLimitTimer: NodeJS.Timeout | null = null;

function persistQueue(): void {
  saveQueueState({ jobs: jobQueue, rateLimitResumeAtMs });
}

/** Naplánuje automatické pokračování fronty po obnovení Claude usage limitu a
 * hned o tom (s místním časem obnovení) informuje uživatele — dřív se rozpracovaný
 * úkol jen tiše ztratil, jakmile limit hlášku vydal jako "výsledek". */
function enterRateLimitWait(resetsAtMs: number | null, isRestore = false): void {
  const resumeAt = resetsAtMs ?? Date.now() + RATE_LIMIT_FALLBACK_WAIT_MS;
  rateLimitResumeAtMs = resumeAt;
  persistQueue();

  const when = resetsAtMs ? formatResetTimeLocal(resumeAt) : "zkusím to znovu za chvíli, přesný čas obnovení kvóta nehlásila";
  sendMsg(
    isRestore
      ? `⏳ Po restartu pořád čekám na obnovení Claude usage limitu (${when}), rozpracovaný úkol zůstává ve frontě.`
      : `⏳ Narazil jsem na Claude usage limit. Rozpracovaný úkol zůstává ve frontě, dokončím ho automaticky po obnovení kvóty — ${when}.`,
  );

  if (rateLimitTimer) clearTimeout(rateLimitTimer);
  const delay = Math.max(resumeAt - Date.now(), 0) + RATE_LIMIT_RESUME_BUFFER_MS;
  rateLimitTimer = setTimeout(() => {
    rateLimitResumeAtMs = null;
    persistQueue();
    sendMsg("🔄 Kvóta by měla být zpět, pokračuji v rozpracovaném úkolu...");
    void processQueue();
  }, delay);
}

async function processQueue(): Promise<void> {
  if (processing) return;
  // Ještě se čeká na reset kvóty — timer výš to sám odblokuje, tenhle časný
  // return jen brání tomu, aby nové příchozí zprávy mezitím bušily do limitu znovu.
  if (rateLimitResumeAtMs !== null && Date.now() < rateLimitResumeAtMs) return;
  processing = true;
  try {
    while (jobQueue.length > 0) {
      const job = jobQueue[0];
      let outcome: Awaited<ReturnType<typeof runClaude>>;
      try {
        outcome = await runClaude(claudeProcess, job.userText, job.downloadedFileInfo);
      } catch (e) {
        // Dřív tohle skončilo jako unhandledRejection z `void processQueue()` — jen
        // se to zalogovalo, uživatel se to nedozvěděl a rozpracovaný výsledek (viz
        // `neodpověděl včas (částečný text: ...)`) zmizel beze stopy. Job zůstává na
        // začátku fronty (neshiftnutý), takže se zkusí znovu při další zprávě.
        const msg = e instanceof Error ? e.message : String(e);
        sendMsg(`⚠️ Tah selhal (${msg}). Úkol zůstává ve frontě, zkusím to znovu při další zprávě.`);
        return;
      }
      if (outcome.kind === "rate_limited") {
        enterRateLimitWait(outcome.resetsAtMs);
        return;
      }
      jobQueue.shift();
      persistQueue();
      appendHistory(job.userText + job.downloadedFileInfo, outcome.text);
      sendMsg(`✅ Výsledek:\n${outcome.text}`);
      touchHeartbeat();
    }
  } finally {
    processing = false;
  }
}

// `onUnsolicitedText`: reakce na cross-session zprávu (SendMessage od jiného
// bota), kterou runtime doručil mimo `send()` — bez tohohle by taková reakce
// (např. "⏳ Zpracovávám úkol od tebe...") nešla vidět nikde v Telegramu.
const claudeProcess = new ClaudeProcess((text) => sendMsg(text));

bot.on("message", async (ctx) => {
  if (String(ctx.chat.id) !== String(TELEGRAM_CHAT_ID)) return;

  const msg = ctx.message;
  let userText = msg.text ?? msg.caption ?? "";
  let downloadedFileInfo = "";

  if (msg.document) {
    const fileName = msg.document.file_name ?? "uploaded_file";
    const res = await downloadAttachment(bot, msg.document.file_id, fileName);
    if ("path" in res) {
      downloadedFileInfo = `\n[PŘIPOJEN SOUBOR: ${res.path}]\n`;
    } else {
      sendMsg(`⚠️ Nepodařilo se stáhnout přílohu '${fileName}': ${res.error}`);
    }
  } else if (msg.photo && msg.photo.length > 0) {
    const photo = msg.photo[msg.photo.length - 1];
    const fileName = `${photo.file_unique_id}.jpg`;
    const res = await downloadAttachment(bot, photo.file_id, fileName);
    if ("path" in res) {
      downloadedFileInfo = `\n[PŘIPOJEN SOUBOR: ${res.path}]\n`;
    } else {
      sendMsg(`⚠️ Nepodařilo se stáhnout přílohu '${fileName}': ${res.error}`);
    }
  }

  if (!userText && !downloadedFileInfo) return;

  const wasIdle = jobQueue.length === 0 && !processing;
  jobQueue.push({ userText, downloadedFileInfo });
  persistQueue();
  sendMsg(wasIdle ? "⏳ Zpracovávám..." : `📥 Přijato, ve frontě (pozice ${jobQueue.length}), zpracuji hned po předchozí zprávě.`);

  // Nečeká se na dokončení — handler se vrátí hned, aby grammY mohl přijmout další
  // zprávu okamžitě, i když tahle ještě běží (řeší "neodpovídáš, když pošlu víc zpráv").
  void processQueue();
});

bot.catch((err) => {
  console.error("Chyba v grammY handleru:", err);
});

// Telegram krátce po restartu (starý proces právě zabitý watchdogem/redeployem)
// ještě chvíli drží předchozí long-poll spojení na stejný token — první getUpdates
// pak dostane 409 Conflict. grammY tohle záměrně nezkouší samo (409 rethrowne, viz
// bot.js handlePollingError) — u skutečné kolize dvou různých botů by tiché
// opakování jen maskovalo problém. Tady ale víme, že jde o náš vlastní restart, ne
// o cizí instanci, takže pár rychlých pokusů s narůstajícím čekáním obvykle stačí
// místo čekání až minutu na cron watchdog.
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
    // Limit se stihl obnovit, zatímco bridge neběžel (pád/redeploy) — zpracuje se hned.
    return;
  }
  // Pořád se čeká — obnov i časovač, `main()` na konci volá `processQueue()`,
  // který díky `rateLimitResumeAtMs` sám počká, dokud tenhle timer neodpálí.
  enterRateLimitWait(state.rateLimitResumeAtMs, true);
}

async function main() {
  await outbox.flush(); // doručí, co se nestihlo odeslat před posledním pádem/restartem
  outbox.startRetryLoop();
  startHeartbeatLoop();
  claudeProcess.start(getSessionId());
  restoreQueueState();

  sendMsg(STARTUP_MESSAGE);

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

// Dřív bez tohohle: jakákoliv nezachycená chyba (např. odmítnutý promise někde
// mimo hlavní handler) spadla celý proces (viz DECISIONS.md, pád 17.8. po
// zakládání mailisty) — i uprostřed vícehodinového čekání na reset usage limitu,
// kdy by to smazalo neuloženou frontu. Teď se jen zaloguje, proces běží dál;
// `jobQueue`/`rateLimitResumeAtMs` navíc přežívají v `job_queue_ts.json`, takže i
// kdyby přesto spadl, watchdog (cron, do minuty) ho nastartuje zpátky se stavem.
process.on("unhandledRejection", (reason) => {
  console.error("Nezachycené odmítnutí promise:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Nezachycená výjimka:", err);
});

main().catch((e) => {
  console.error("Fatální chyba při startu:", e);
  // `claudeProcess.start()` v main() proběhne PŘED pollováním Telegramu — pokud
  // pollování nakonec selže (409 přetrvá i po retry), bez tohohle by `claude`
  // subprocess zůstal osiřelý (ppid 1) a běžel dál naprázdno, protože sem
  // nedojde SIGTERM handler, jen tenhle catch.
  claudeProcess.kill();
  process.exit(1);
});
