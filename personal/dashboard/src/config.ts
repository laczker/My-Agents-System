import { readFileSync } from "node:fs";

// Bots the dashboard watches — manually maintained list matching `bridge-ts/src/config.ts`
// (BOT_DIR/heartbeat_ts.txt per bot) and `watchdog.sh` (pgrep pattern per bot). A new bot
// = a new line here + a new block in `watchdog.sh`.
export interface BotDef {
  name: string;
  dir: string;
  // Exactly the same pgrep/pkill pattern as in `watchdog.sh` — the restart button
  // sends SIGTERM to matching processes and relies on the cron watchdog bringing
  // it back up within a minute (same safe procedure as the manual restart on 18.8.).
  killPattern: string;
  // `.env.<profile>` for the bot (see bridge-ts/src/config.ts) — read at runtime to
  // get CLAUDE_MODEL, so the dashboard shows the actual value instead of a manually
  // duplicated copy that would drift from reality on the next env file change.
  envFile: string;
  // Set for bots running inside the daily-bots container (canary cutover, iterace 6 —
  // see personal/devbot/TASKS.md). The process lives in the container's own PID
  // namespace, so the restart button must `docker compose exec` into it instead of
  // signaling the host — a plain host pkill matches nothing and silently no-ops.
  inContainer?: "daily-bots" | "project-bots";
}

const BOT_LIST: BotDef[] = [
  { name: "assistant", dir: "/home/agent/agent-system/personal/assistant", killPattern: "tsx src/index.ts$", envFile: "/home/agent/agent-system/.env" },
  { name: "zpravodaj", dir: "/home/agent/agent-system/personal/zpravodaj", killPattern: "tsx src/index.ts zpravodaj", envFile: "/home/agent/agent-system/.env.zpravodaj" },
  { name: "mailista", dir: "/home/agent/agent-system/personal/mailista", killPattern: "tsx src/index.ts mailista", envFile: "/home/agent/agent-system/.env.mailista" },
  { name: "joby", dir: "/home/agent/agent-system/personal/joby", killPattern: "tsx src/index.ts joby", envFile: "/home/agent/agent-system/.env.joby" },
  { name: "nakup", dir: "/home/agent/agent-system/personal/nakup", killPattern: "tsx src/index.ts nakup", envFile: "/home/agent/agent-system/.env.nakup" },
  { name: "trener", dir: "/home/agent/agent-system/personal/trener", killPattern: "tsx src/index.ts trener", envFile: "/home/agent/agent-system/.env.trener" },
  { name: "fbalbums", dir: "/home/agent/agent-system/personal/fbalbums", killPattern: "tsx src/index.ts fbalbums", envFile: "/home/agent/agent-system/.env.fbalbums", inContainer: "project-bots" },
  { name: "devbot", dir: "/home/agent/agent-system/personal/devbot", killPattern: "tsx src/index.ts devbot", envFile: "/home/agent/agent-system/.env.devbot" },
];

// Single source of truth for the daily-bots container profiles: `daily-profiles.txt` in the
// repo root, also read by `watchdog.sh` and `start-daily.sh`. Read once at dashboard startup
// (changing the list needs a dashboard restart). Throws if missing/empty rather than silently
// treating every daily bot as a host process (the restart button would then no-op).
const DAILY_PROFILES_FILE = "/home/agent/agent-system/daily-profiles.txt";
const dailyProfiles = new Set(readFileSync(DAILY_PROFILES_FILE, "utf-8").split(/\s+/).filter(Boolean));
if (dailyProfiles.size === 0) throw new Error(`${DAILY_PROFILES_FILE} is empty`);

export const BOTS: BotDef[] = BOT_LIST.map((bot) =>
  dailyProfiles.has(bot.name) ? { ...bot, inContainer: "daily-bots" as const } : bot,
);

// Heartbeat is written every 15s (HEARTBEAT_INTERVAL_MS in bridge-ts/src/config.ts).
// Threshold is > 2x that interval, so a brief write hiccup doesn't render a bot as stuck.
export const STALE_AFTER_MS = 60_000;

export const DB_FILE = "/home/agent/agent-system/personal/dashboard/dashboard.sqlite";

// Tailscale interface (tailnet) only — the dashboard has no auth, see DECISIONS.md.
// The public interface (0.0.0.0) is deliberately omitted so the dashboard stays
// unreachable from the public internet even with a leaky/misconfigured firewall.
export const HOST = "100.108.179.97";
export const PORT = 8765;
