import { config } from "dotenv";

// One `bridge-ts` engine serves several independent bots (assistant, zpravodaj, ...).
// Which bot starts is determined by the profile on the command line (`tsx src/index.ts
// zpravodaj`); with no argument it behaves as before (assistant, `.env`) for backward
// compatibility. Each profile has its own `.env.<profile>` with its own
// token/chat_id/BOT_DIR, so bots run side by side without colliding on Telegram
// getUpdates or on session_id.txt.
const profile = process.argv[2];
const envFile = profile
  ? `/home/agent/agent-system/.env.${profile}`
  : "/home/agent/agent-system/.env";

config({ path: envFile, quiet: true });

export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID ?? "";

if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
  throw new Error(`TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID chybí v ${envFile}`);
}

// Optional list of ADDITIONAL allowed chat IDs (comma-separated in `.env.<profile>`),
// for bots that more than one person needs to talk to (e.g. a shared shopping list for
// two Telegram accounts). Without `TELEGRAM_CHAT_IDS_EXTRA` behavior is the same as
// before — just `TELEGRAM_CHAT_ID`. `TELEGRAM_CHAT_ID` stays primary/first in the list.
const extraChatIds = (process.env.TELEGRAM_CHAT_IDS_EXTRA ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const TELEGRAM_CHAT_IDS: string[] = [TELEGRAM_CHAT_ID, ...extraChatIds];

// Directory with the bot's persistent state (session, history, inbox, CLAUDE.md) —
// the `cwd` that `claude` is spawned with, so the bot's own CLAUDE.md gets loaded
// automatically from here too. Assistant has a default path for backward compatibility
// with bridge.py's shared state; every other bot has BOT_DIR in its own `.env.<profile>`.
export const BOT_DIR = process.env.BOT_DIR ?? "/home/agent/agent-system/personal/assistant";
export const HISTORY_FILE = `${BOT_DIR}/chat_history.txt`;
export const INBOX_DIR = `${BOT_DIR}/inbox`;
export const SESSION_FILE = `${BOT_DIR}/session_id.txt`;
export const HEARTBEAT_FILE = `${BOT_DIR}/heartbeat_ts.txt`;
export const OUTBOX_FILE = `${BOT_DIR}/outbox_ts.json`;
export const QUEUE_FILE = `${BOT_DIR}/job_queue_ts.json`;
export const TURN_LOG_FILE = `${BOT_DIR}/turn_log_ts.jsonl`;

// Static model per bot (Ludwig's pattern — no dynamic switching by task, just a
// fixed value in `.env.<profile>`). Without `CLAUDE_MODEL` in the env file it defaults
// to "sonnet" — matches prior behavior (CLI default), so adding this switch alone
// changes nothing until someone overrides it for a specific bot.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";

export const CLAUDE_CWD = BOT_DIR;
export const STDERR_LOG = profile
  ? `/home/agent/agent-system/bridge_ts_${profile}_claude_stderr.log`
  : "/home/agent/agent-system/bridge_ts_claude_stderr.log";

export const STARTUP_MESSAGE =
  process.env.STARTUP_MESSAGE ?? "🚀 AI Centrální Správce je aktivní (TS/grammY build, testováno)!";

export const HISTORY_EXCHANGES = 10;
// Previously 280_000 (4:40) — too short for long batches (e.g. mailista processing
// dozens of threads in one turn); the timeout killed the turn mid-work and the result
// was lost (see DECISIONS.md, finding from 19.8.).
export const CLAUDE_TURN_TIMEOUT_MS = 900_000;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const OUTBOX_RETRY_INTERVAL_MS = 10_000;

// Above how many context tokens (cache_read + cache_creation + input from the last
// `result` event) a fresh session is proactively started before the NEXT message,
// instead of `--resume`. `--resume`-ing the same session forever means the entire
// history so far gets "re-reminded" on every turn (even if through cache) — the cost
// and consumption of the five-hour quota per message therefore grows the longer a
// session lives (see DECISIONS.md, hitting the limit on 17.8.). The threshold is
// chosen with a large margin below the 1M token context window (sonnet-5) — this is
// primarily about limiting the growing cost/quota per turn, not the risk of context
// overflow. Persistent knowledge (DECISIONS.md/TASKS.md/CLAUDE.md) survives in files
// either way, not in the conversation — so cycling the session loses nothing.
export const CONTEXT_CYCLE_THRESHOLD_TOKENS = 150_000;

// The server runs in UTC (see `timedatectl`) — for messages to the user about when
// the quota resets, we need their local time, not UTC.
export const USER_TIMEZONE = process.env.USER_TIMEZONE ?? "Europe/Prague";

// When `resetsAt` is missing from `rate_limit_event` (just a text message with no
// parseable time), how long to wait before retrying — with a large margin below the
// 5-hour quota.
export const RATE_LIMIT_FALLBACK_WAIT_MS = 30 * 60_000;
// A small extra buffer after the reported reset time, so we don't retry right on the edge.
export const RATE_LIMIT_RESUME_BUFFER_MS = 30_000;
