import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import { HOST, PORT, BOTS } from "./config.js";
import { collectHeartbeats, type BotStatus } from "./heartbeat.js";
import { recentRestarts, restartCountSince } from "./db.js";
import { summarize, tailRaw } from "./turnlog.js";
import { buildUsageWindow } from "./usage.js";
import { renderUsageChart } from "./usageChart.js";

const STATUS_LABEL: Record<BotStatus, string> = {
  running: "🟢 běží",
  stale: "🟡 zaseknutý?",
  down: "🔴 spadlý",
};

const STATUS_CLASS: Record<BotStatus, string> = {
  running: "text-green-400",
  stale: "text-yellow-400",
  down: "text-red-400",
};

function formatAge(ts: number | null, now: number): string {
  if (ts === null) return "nikdy";
  const seconds = Math.floor((now - ts) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function formatTs(ts: number): string {
  return new Date(ts).toLocaleString("cs-CZ", { timeZone: "Europe/Prague" });
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

function renderPage(): string {
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const twoWeeksAgo = now - 14 * 24 * 60 * 60 * 1000;
  const heartbeats = collectHeartbeats();
  const restarts = recentRestarts(30);
  const usage = buildUsageWindow(BOTS, twoWeeksAgo);

  const rows = heartbeats
    .map(({ bot, status, lastSeenTs }) => {
      const restartsToday = restartCountSince(bot.name, dayAgo);
      return `
        <tr class="border-b border-slate-700">
          <td class="py-2 px-3 font-medium">${bot.name}</td>
          <td class="py-2 px-3 ${STATUS_CLASS[status]}">${STATUS_LABEL[status]}</td>
          <td class="py-2 px-3 text-slate-300">${formatAge(lastSeenTs, now)}</td>
          <td class="py-2 px-3 text-slate-300">${restartsToday}</td>
          <td class="py-2 px-3">
            <form method="POST" action="/restart/${bot.name}" onsubmit="return confirm('Restartovat ${bot.name}? Proces dostane SIGTERM a cron watchdog ho do minuty nahodí zpět.');">
              <button type="submit" class="bg-red-900 hover:bg-red-800 text-red-100 text-sm px-3 py-1 rounded">Restartovat</button>
            </form>
          </td>
        </tr>`;
    })
    .join("");

  const activityRows = BOTS.map((bot) => {
    const s = summarize(bot, dayAgo);
    const errClass = s.errors24h > 0 ? "text-red-400" : "text-slate-300";
    return `
        <tr class="border-b border-slate-700">
          <td class="py-2 px-3 font-medium"><a href="/log/${bot.name}" class="underline hover:text-sky-400">${bot.name}</a></td>
          <td class="py-2 px-3 text-slate-300">${s.turns24h}</td>
          <td class="py-2 px-3 ${errClass}">${s.errors24h}</td>
          <td class="py-2 px-3 text-slate-300">${s.avgDurationMs !== null ? `${(s.avgDurationMs / 1000).toFixed(1)}s` : "—"}</td>
          <td class="py-2 px-3 text-slate-300">${s.lastCycleTs !== null ? formatTs(s.lastCycleTs) : "nikdy"}</td>
        </tr>`;
  }).join("");

  const hitRows = [...usage.hits]
    .reverse()
    .map(
      (h) => `
        <tr class="border-b border-slate-700">
          <td class="py-2 px-3 text-slate-300">${formatTs(h.ts)}</td>
          <td class="py-2 px-3 font-medium">${h.bot}</td>
          <td class="py-2 px-3 text-slate-300">${fmtTokens(h.cumulative)}</td>
          <td class="py-2 px-3 text-slate-300">${h.resetsAtMs !== null ? formatTs(h.resetsAtMs) : "—"}</td>
        </tr>`
    )
    .join("");

  const restartRows = restarts
    .map(
      (r) => `
        <tr class="border-b border-slate-700">
          <td class="py-2 px-3 text-slate-300">${formatTs(r.ts)}</td>
          <td class="py-2 px-3 font-medium">${r.bot}</td>
          <td class="py-2 px-3 text-slate-300">${r.reason}</td>
        </tr>`
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="cs">
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="15">
  <title>Agent dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="bg-slate-900 text-slate-100 font-sans p-8">
  <h1 class="text-2xl font-bold mb-6">Agent dashboard</h1>

  <h2 class="text-lg font-semibold mb-2">Stav botů</h2>
  <table class="w-full text-left mb-8 bg-slate-800 rounded overflow-hidden">
    <thead class="bg-slate-700">
      <tr>
        <th class="py-2 px-3">Bot</th>
        <th class="py-2 px-3">Stav</th>
        <th class="py-2 px-3">Poslední heartbeat</th>
        <th class="py-2 px-3">Restartů dnes</th>
        <th class="py-2 px-3"></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <h2 class="text-lg font-semibold mb-2">Aktivita (posledních 24h)</h2>
  <table class="w-full text-left mb-8 bg-slate-800 rounded overflow-hidden">
    <thead class="bg-slate-700">
      <tr>
        <th class="py-2 px-3">Bot</th>
        <th class="py-2 px-3">Tahů</th>
        <th class="py-2 px-3">Chyby</th>
        <th class="py-2 px-3">Ø délka tahu</th>
        <th class="py-2 px-3">Poslední cyklení kontextu</th>
      </tr>
    </thead>
    <tbody>${activityRows}</tbody>
  </table>
  <p class="text-slate-500 text-sm mb-8">Klikni na jméno bota v tabulce aktivity pro syrový log (posledních 200 řádků).</p>

  <h2 class="text-lg font-semibold mb-2">Vyčerpání kvóty (posledních 14 dní)</h2>
  <div class="bg-slate-800 rounded p-4 mb-2">
    ${renderUsageChart(usage, twoWeeksAgo, now)}
  </div>
  <p class="text-slate-500 text-sm mb-2">
    Modrá čára je součet "čerstvých" tokenů (input + cache creation, bez recyklovaného cache
    read) napříč všemi boty od posledního naražení na limit — boti sdílejí jeden Claude účet,
    takže i kvótu. Je to jen odhad reálného vzorce, kterým Anthropic kvótu počítá, ne přesné číslo.
  </p>
  <table class="w-full text-left mb-8 bg-slate-800 rounded overflow-hidden">
    <thead class="bg-slate-700">
      <tr>
        <th class="py-2 px-3">Kdy</th>
        <th class="py-2 px-3">Bot</th>
        <th class="py-2 px-3">Tokenů od resetu</th>
        <th class="py-2 px-3">Obnova kvóty</th>
      </tr>
    </thead>
    <tbody>${hitRows || `<tr><td class="py-2 px-3 text-slate-400" colspan="4">Zatím žádné naražení na limit</td></tr>`}</tbody>
  </table>

  <h2 class="text-lg font-semibold mb-2">Historie restartů (posledních 30)</h2>
  <table class="w-full text-left bg-slate-800 rounded overflow-hidden">
    <thead class="bg-slate-700">
      <tr>
        <th class="py-2 px-3">Kdy</th>
        <th class="py-2 px-3">Bot</th>
        <th class="py-2 px-3">Důvod</th>
      </tr>
    </thead>
    <tbody>${restartRows || `<tr><td class="py-2 px-3 text-slate-400" colspan="3">Zatím žádné restarty</td></tr>`}</tbody>
  </table>
</body>
</html>`;
}

export function startServer(): void {
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(renderPage());
      return;
    }

    const logMatch = req.method === "GET" && req.url?.match(/^\/log\/([^/]+)$/);
    if (logMatch) {
      const bot = BOTS.find((b) => b.name === logMatch[1]);
      if (!bot) {
        res.writeHead(404).end("Neznámý bot");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(tailRaw(bot, 200) || "(zatím žádné záznamy)");
      return;
    }

    const restartMatch = req.method === "POST" && req.url?.match(/^\/restart\/([^/]+)$/);
    if (restartMatch) {
      const bot = BOTS.find((b) => b.name === restartMatch[1]);
      if (!bot) {
        res.writeHead(404).end("Neznámý bot");
        return;
      }
      // Stejný bezpečný postup jako ruční restart 18.8.: SIGTERM matchujícím
      // procesům, skutečné nahození nechává na cron `watchdog.sh` (do minuty).
      // pkill vrací exit 1, když nic nenajde — to není chyba, jen no-op.
      try {
        execFileSync("pkill", ["-TERM", "-f", bot.killPattern]);
      } catch {
        // no-op: proces už neběžel
      }
      res.writeHead(303, { Location: "/" });
      res.end();
      return;
    }

    res.writeHead(404).end("Not found");
  });

  server.listen(PORT, HOST, () => {
    console.log(`Dashboard běží na http://${HOST}:${PORT}`);
  });
}
