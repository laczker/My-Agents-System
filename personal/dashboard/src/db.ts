import Database from "better-sqlite3";
import { DB_FILE } from "./config.js";

let db: Database.Database | undefined;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_FILE);
    db.exec(`
      CREATE TABLE IF NOT EXISTS restarts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bot TEXT NOT NULL,
        reason TEXT NOT NULL,
        ts INTEGER NOT NULL
      )
    `);
  }
  return db;
}

export function recordRestart(bot: string, reason: string): void {
  getDb().prepare("INSERT INTO restarts (bot, reason, ts) VALUES (?, ?, ?)").run(bot, reason, Date.now());
}

export interface RestartRow {
  bot: string;
  reason: string;
  ts: number;
}

export function recentRestarts(limit: number): RestartRow[] {
  return getDb()
    .prepare("SELECT bot, reason, ts FROM restarts ORDER BY ts DESC LIMIT ?")
    .all(limit) as RestartRow[];
}

export function restartCountSince(bot: string, sinceTs: number): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS c FROM restarts WHERE bot = ? AND ts >= ?")
    .get(bot, sinceTs) as { c: number };
  return row.c;
}
