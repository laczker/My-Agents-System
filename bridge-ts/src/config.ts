import { config } from "dotenv";

// Jeden `bridge-ts` engine obsluhuje víc nezávislých botů (assistant, zpravodaj, ...).
// Který bot se spustí, určuje profil na příkazové řádce (`tsx src/index.ts zpravodaj`);
// bez argumentu se chová jako dřív (assistant, `.env`) kvůli zpětné kompatibilitě.
// Každý profil má vlastní `.env.<profil>` s vlastním tokenem/chat_id/BOT_DIR, takže
// boti běží vedle sebe bez kolize na Telegram getUpdates ani na session_id.txt.
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

// Adresář s trvalým stavem bota (session, historie, inbox, CLAUDE.md) — `cwd`, se
// kterým se spouští `claude`, takže odsud se automaticky načte i CLAUDE.md daného
// bota. Assistant má výchozí cestu kvůli zpětné kompatibilitě se sdíleným stavem
// bridge.py; každý další bot má BOT_DIR ve svém `.env.<profil>`.
export const BOT_DIR = process.env.BOT_DIR ?? "/home/agent/agent-system/personal/assistant";
export const HISTORY_FILE = `${BOT_DIR}/chat_history.txt`;
export const INBOX_DIR = `${BOT_DIR}/inbox`;
export const SESSION_FILE = `${BOT_DIR}/session_id.txt`;
export const HEARTBEAT_FILE = `${BOT_DIR}/heartbeat_ts.txt`;
export const OUTBOX_FILE = `${BOT_DIR}/outbox_ts.json`;
export const QUEUE_FILE = `${BOT_DIR}/job_queue_ts.json`;
export const TURN_LOG_FILE = `${BOT_DIR}/turn_log_ts.jsonl`;

// Statický model per bot (Ludwigův vzor — žádné dynamické přepínání podle úkolu,
// jen pevná hodnota v `.env.<profil>`). Bez `CLAUDE_MODEL` v env souboru default
// "sonnet" — odpovídá dosavadnímu chování (CLI default), takže přidání tohohle
// přepínače samo o sobě nic nemění, dokud ho někdo u konkrétního bota nepřepíše.
export const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "sonnet";

export const CLAUDE_CWD = BOT_DIR;
export const STDERR_LOG = profile
  ? `/home/agent/agent-system/bridge_ts_${profile}_claude_stderr.log`
  : "/home/agent/agent-system/bridge_ts_claude_stderr.log";

export const STARTUP_MESSAGE =
  process.env.STARTUP_MESSAGE ?? "🚀 AI Centrální Správce je aktivní (TS/grammY build, testováno)!";

export const HISTORY_EXCHANGES = 10;
// Dřív 280_000 (4:40) — moc krátké na dlouhé dávky (např. mailista zpracovávající
// desítky vláken v jednom tahu), timeout tah zabil uprostřed práce a výsledek se
// ztratil (viz DECISIONS.md, zjištění 19.8.).
export const CLAUDE_TURN_TIMEOUT_MS = 900_000;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const OUTBOX_RETRY_INTERVAL_MS = 10_000;

// Nad kolika tokeny kontextu (cache_read + cache_creation + input z posledního
// `result` eventu) se před DALŠÍ zprávou proaktivně založí čerstvá session místo
// `--resume`. `--resume` na pořád stejnou session znamená, že se při každém tahu
// znovu "připomíná" celá dosavadní historie (byť přes cache) — cena i spotřeba
// pětihodinové kvóty za zprávu tím roste, čím déle session žije (viz DECISIONS.md,
// pád na limit 17.8.). Práh je zvolen s velkou rezervou pod 1M token context
// window (sonnet-5) — jde primárně o omezení rostoucí ceny/kvóty za tah, ne o
// riziko přetečení kontextu. Trvalé znalosti (DECISIONS.md/TASKS.md/CLAUDE.md) i
// tak přežívají v souborech, ne v konverzaci — cyklení session tedy nic neztrácí.
export const CONTEXT_CYCLE_THRESHOLD_TOKENS = 150_000;

// Server běží v UTC (viz `timedatectl`) — pro hlášky o čase obnovení kvóty
// uživateli potřebujeme jeho místní čas, ne UTC.
export const USER_TIMEZONE = process.env.USER_TIMEZONE ?? "Europe/Prague";

// Když `resetsAt` z `rate_limit_event` chybí (jen textová hláška bez rozparsovatelného
// času), po jak dlouho to zkusit znovu — s velkou rezervou pod 5hodinovou kvótou.
export const RATE_LIMIT_FALLBACK_WAIT_MS = 30 * 60_000;
// Malá rezerva navíc po nahlášeném čase obnovení, ať se nezkouší přesně na hraně.
export const RATE_LIMIT_RESUME_BUFFER_MS = 30_000;
