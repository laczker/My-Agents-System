import { rmSync, writeFileSync } from "node:fs";

// "Busy" marker: present while the bot is inside any turn -- a queued Telegram job
// (`send()`) as well as an unsolicited one (cross-session SendMessage, cron wakeup).
// `job_queue_ts.json` only covers the former, so scripts that must not kill a bot
// mid-turn (restart_devbot.sh) wait for this file to disappear. Content is the start
// timestamp; readers must ignore a marker older than their own cap (a crash can
// leave one behind, see `clearBusy` in `ClaudeProcess.start`).
export function markBusy(file: string): void {
  // Best effort: a failed marker write must never break turn processing.
  try {
    writeFileSync(file, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString() }));
  } catch (err) {
    console.error("markBusy failed:", err);
  }
}

export function clearBusy(file: string): void {
  try {
    rmSync(file, { force: true });
  } catch (err) {
    console.error("clearBusy failed:", err);
  }
}
