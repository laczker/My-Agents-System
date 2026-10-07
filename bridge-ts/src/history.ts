import { readFileSync, appendFileSync, existsSync, statSync, writeFileSync, renameSync, rmSync } from "node:fs";
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

// The file only grows on append, while `getHistory()` needs just the last few
// exchanges. Once it passes the size limit, it is rewritten with the newest
// HISTORY_KEEP_EXCHANGES blocks (tmp + rename, so a crash never leaves a half file).
// Each kept block is capped at HISTORY_MAX_BLOCK bytes, so the guaranteed minimum of
// HISTORY_EXCHANGES blocks always fits in half the byte cap and the rotated file is
// always below the trigger threshold (no rewrite on every append).
const HISTORY_MAX_BYTES = 200_000;
const HISTORY_KEEP_EXCHANGES = 100;
const HISTORY_MAX_BLOCK = HISTORY_MAX_BYTES / 2 / HISTORY_EXCHANGES;
const TRUNCATION_MARK = "…[truncated]\n";

// Cut an oversized block. The marker follows the cut on the same line, so a cut right
// after `---` cannot form the `"---\n"` delimiter.
function capBlock(block: string): string {
  if (block.length <= HISTORY_MAX_BLOCK) return block;
  return block.slice(0, HISTORY_MAX_BLOCK - TRUNCATION_MARK.length) + TRUNCATION_MARK;
}

function rotateHistory(): void {
  if (statSync(HISTORY_FILE).size <= HISTORY_MAX_BYTES) return;
  const exchanges = readFileSync(HISTORY_FILE, "utf-8").split("---\n").filter((e) => e.trim());
  // Keep at most HISTORY_KEEP_EXCHANGES blocks AND at most half the byte cap, but never
  // fewer than HISTORY_EXCHANGES, which is what getHistory() actually serves.
  const blocks = exchanges.slice(-HISTORY_KEEP_EXCHANGES).map((e) => capBlock(e) + "---\n");
  let total = 0;
  let from = blocks.length;
  while (from > 0 && (blocks.length - from < HISTORY_EXCHANGES || total + blocks[from - 1].length <= HISTORY_MAX_BYTES / 2)) {
    total += blocks[--from].length;
  }
  const tmp = `${HISTORY_FILE}.tmp`;
  try {
    writeFileSync(tmp, blocks.slice(from).join(""));
    renameSync(tmp, HISTORY_FILE);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
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
    return;
  }
  try {
    rotateHistory();
  } catch (err) {
    console.error("Rotace chat_history.txt selhala (zápis proběhl):", err);
  }
}
