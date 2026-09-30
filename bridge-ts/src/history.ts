import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { HISTORY_FILE, HISTORY_EXCHANGES } from "./config.js";

export function getHistory(): string {
  if (!existsSync(HISTORY_FILE)) return "";
  const content = readFileSync(HISTORY_FILE, "utf-8");
  const exchanges = content.split("---\n").filter((e) => e.trim());
  return unescapeDelimiter(exchanges.slice(-HISTORY_EXCHANGES).join("---\n"));
}

// A written exchange block must not contain the exact delimiter sequence (`"---\n"`)
// that `getHistory()` uses to split blocks — otherwise markdown horizontal rules in
// the text (common in checkpoints/specs) would cut one exchange into several
// unlabeled fragments. An invisible zero-width space is inserted right after the
// triple dash, so the line doesn't visually change but stops matching the delimiter
// byte-for-byte. The escaping is applied to the WHOLE assembled body (`Uživatel: ...
// \nClaude: ...\n`), not to `userMsg`/`botMsg` separately before assembly — otherwise
// a collision created only by the concatenation would slip through, e.g. `userMsg`
// ending in `---` right before the template-inserted `\nClaude: `. `getHistory()`
// must undo the escaping again (`unescapeDelimiter`) — otherwise the zero-width space
// would permanently leak into the seeded context on every subsequent read, even for
// text that never had a real collision.
function escapeDelimiter(text: string): string {
  return text.replace(/---\n/g, "---​\n");
}

function unescapeDelimiter(text: string): string {
  return text.replace(/---​\n/g, "---\n");
}

// A write error (ENOSPC/EACCES) is handled here, not by the caller — same convention
// as `logTurn` (`turnLog.ts`). appendHistory has two callers (the normal Telegram
// reply in `index.ts`, the unsolicited turn in `claudeProcess.ts`), and without an
// internal try/catch each of them would have to duplicate the guard separately — one
// of them actually forgot to (index.ts, until this guard was added here).
export function appendHistory(userMsg: string, botMsg: string): void {
  const body = `Uživatel: ${userMsg}\nClaude: ${botMsg}\n`;
  try {
    appendFileSync(HISTORY_FILE, escapeDelimiter(body) + "---\n");
  } catch (err) {
    console.error("Zápis do chat_history.txt selhal:", err);
  }
}
