// CLI entry point for `watchdog.sh`: `npx tsx src/recordRestart.ts <bot> <reason>`.
// Bash itself can't write SQLite (the host has no `sqlite3` CLI installed), so
// the watchdog runs this script on every restart instead of writing to the DB directly.
import { recordRestart } from "./db.js";

const [bot, reason] = process.argv.slice(2);

if (!bot || !reason) {
  console.error("Použití: tsx src/recordRestart.ts <bot> <reason>");
  process.exit(1);
}

recordRestart(bot, reason);
