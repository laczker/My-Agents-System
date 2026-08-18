import { writeFileSync } from "node:fs";
import { HEARTBEAT_FILE, HEARTBEAT_INTERVAL_MS } from "./config.js";

// Dotýkaný pravidelně + po každém zpracovaném tahu. Řeší mezeru z Ludwigova vzoru,
// kterou náš dosavadní watchdog (pgrep na proces) nepokrývá: proces může běžet a
// přitom být zaseknutý (visící claude subprocess, zacyklená smyčka) — pgrep to
// nepozná, stáří tohohle souboru ano. Čtení/vyhodnocení stáří je na budoucím
// watchdogu, tenhle modul jen zapisuje.
export function touchHeartbeat(): void {
  writeFileSync(HEARTBEAT_FILE, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString() }));
}

export function startHeartbeatLoop(): NodeJS.Timeout {
  touchHeartbeat();
  return setInterval(touchHeartbeat, HEARTBEAT_INTERVAL_MS);
}
