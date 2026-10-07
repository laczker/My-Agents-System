import { renameSync, rmSync, writeFileSync } from "node:fs";

// "Busy" marker: present while the bot is inside any turn -- a queued Telegram job
// (`send()`) as well as an unsolicited one (cross-session SendMessage, cron wakeup).
// `job_queue_ts.json` only covers the former, so scripts that must not kill a bot
// mid-turn (restart_devbot.sh) wait for this file to disappear. Content is the last
// refresh timestamp; readers ignore a marker older than their own cap (a hard crash
// can leave one behind).
export function markBusy(file: string): void {
  // Best effort: a failed marker write must never break turn processing.
  // Atomic (tmp + rename) so a reader never sees a half-written file.
  try {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify({ ts: Date.now(), iso: new Date().toISOString() }));
    renameSync(tmp, file);
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

export type BusySource = "send" | "unsolicited";

/** Single in-memory owner of the marker. Turns from different sources can overlap,
 * so the file is only removed once NO source is active. While busy, the timestamp is
 * refreshed on an unref'd interval so a long tool call never looks stale; repeated
 * `set(source, true)` calls do not rewrite the file. */
export class BusyTracker {
  private active = new Set<BusySource>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private file: string, private refreshMs = 30_000) {}

  isBusy(): boolean {
    return this.active.size > 0;
  }

  set(source: BusySource, on: boolean): void {
    const wasBusy = this.isBusy();
    if (on) this.active.add(source);
    else this.active.delete(source);
    if (this.isBusy()) {
      if (!wasBusy) {
        markBusy(this.file);
        this.timer = setInterval(() => markBusy(this.file), this.refreshMs);
        this.timer.unref();
      }
      return;
    }
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Also sweeps a leftover marker from a crashed previous process.
    clearBusy(this.file);
  }
}
