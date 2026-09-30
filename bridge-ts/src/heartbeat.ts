import { writeFileSync } from "node:fs";
import { HEARTBEAT_FILE, HEARTBEAT_INTERVAL_MS } from "./config.js";

// Touched periodically + after every processed turn. Closes a gap in Ludwig's pattern
// that our existing watchdog (pgrep on the process) doesn't cover: a process can be
// running and still be stuck (a hung claude subprocess, an infinite loop) — pgrep
// can't tell, but this file's age can. Reading/evaluating the age is up to a future
// watchdog, this module only writes.
export function touchHeartbeat(): void {
  writeFileSync(HEARTBEAT_FILE, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString() }));
}

export function startHeartbeatLoop(): NodeJS.Timeout {
  touchHeartbeat();
  return setInterval(touchHeartbeat, HEARTBEAT_INTERVAL_MS);
}
