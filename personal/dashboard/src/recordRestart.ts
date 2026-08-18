// CLI vstup pro `watchdog.sh`: `npx tsx src/recordRestart.ts <bot> <reason>`.
// Bash sám SQLite psát neumí (na hostu není nainstalované `sqlite3` CLI), takže
// watchdog při každém restartu spustí tenhle skript místo přímého zápisu do DB.
import { recordRestart } from "./db.js";

const [bot, reason] = process.argv.slice(2);

if (!bot || !reason) {
  console.error("Použití: tsx src/recordRestart.ts <bot> <reason>");
  process.exit(1);
}

recordRestart(bot, reason);
