// Boti, které dashboard sleduje — ručně udržovaný seznam podle `bridge-ts/src/config.ts`
// (BOT_DIR/heartbeat_ts.txt na bota) a `watchdog.sh` (pgrep pattern na bota). Nový bot
// = nový řádek zde + nový blok ve `watchdog.sh`.
export interface BotDef {
  name: string;
  dir: string;
  // Přesně stejný pgrep/pkill pattern jako v `watchdog.sh` — restart tlačítko posílá
  // SIGTERM matchujícím procesům a spoléhá na to, že je cron watchdog do minuty
  // zase nahodí (stejný bezpečný postup jako ruční restart 18.8.).
  killPattern: string;
  // `.env.<profil>` daného bota (viz bridge-ts/src/config.ts) — odsud se za běhu
  // čte CLAUDE_MODEL, ať dashboard ukazuje skutečnou hodnotu, ne ručně duplikovanou
  // kopii, která by se rozjela s realitou při příští změně env souboru.
  envFile: string;
}

export const BOTS: BotDef[] = [
  { name: "assistant", dir: "/home/agent/agent-system/personal/assistant", killPattern: "tsx src/index.ts$", envFile: "/home/agent/agent-system/.env" },
  { name: "zpravodaj", dir: "/home/agent/agent-system/personal/zpravodaj", killPattern: "tsx src/index.ts zpravodaj", envFile: "/home/agent/agent-system/.env.zpravodaj" },
  { name: "mailista", dir: "/home/agent/agent-system/personal/mailista", killPattern: "tsx src/index.ts mailista", envFile: "/home/agent/agent-system/.env.mailista" },
  { name: "joby", dir: "/home/agent/agent-system/personal/joby", killPattern: "tsx src/index.ts joby", envFile: "/home/agent/agent-system/.env.joby" },
  { name: "nakup", dir: "/home/agent/agent-system/personal/nakup", killPattern: "tsx src/index.ts nakup", envFile: "/home/agent/agent-system/.env.nakup" },
  { name: "fbalbums", dir: "/home/agent/agent-system/personal/fbalbums", killPattern: "tsx src/index.ts fbalbums", envFile: "/home/agent/agent-system/.env.fbalbums" },
  { name: "devops", dir: "/home/agent/agent-system/personal/devops", killPattern: "tsx src/index.ts devops", envFile: "/home/agent/agent-system/.env.devops" },
];

// Heartbeat se zapisuje každých 15s (HEARTBEAT_INTERVAL_MS v bridge-ts/src/config.ts).
// Práh > 2x ten interval, ať krátký zákmit při zápisu nevykreslí bota jako zaseknutého.
export const STALE_AFTER_MS = 60_000;

export const DB_FILE = "/home/agent/agent-system/personal/dashboard/dashboard.sqlite";

// Jen Tailscale rozhraní (tailnet) — dashboard nemá auth, viz DECISIONS.md.
// Veřejné rozhraní (0.0.0.0) záměrně vynecháno, ať i při děravém/změněném
// firewallu zůstane dashboard z veřejného internetu nedosažitelný.
export const HOST = "100.108.179.97";
export const PORT = 8765;
