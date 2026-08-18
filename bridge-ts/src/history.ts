import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { HISTORY_FILE, HISTORY_EXCHANGES } from "./config.js";

export function getHistory(): string {
  if (!existsSync(HISTORY_FILE)) return "";
  const content = readFileSync(HISTORY_FILE, "utf-8");
  const exchanges = content.split("---\n").filter((e) => e.trim());
  return exchanges.slice(-HISTORY_EXCHANGES).join("---\n");
}

export function appendHistory(userMsg: string, botMsg: string): void {
  appendFileSync(HISTORY_FILE, `Uživatel: ${userMsg}\nClaude: ${botMsg}\n---\n`);
}
