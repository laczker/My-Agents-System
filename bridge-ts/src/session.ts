import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { SESSION_FILE } from "./config.js";

export function getSessionId(): string | null {
  if (!existsSync(SESSION_FILE)) return null;
  const content = readFileSync(SESSION_FILE, "utf-8").trim();
  return content || null;
}

export function saveSessionId(sessionId: string): void {
  writeFileSync(SESSION_FILE, sessionId);
}
