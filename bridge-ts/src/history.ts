import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { HISTORY_FILE, HISTORY_EXCHANGES } from "./config.js";

export function getHistory(): string {
  if (!existsSync(HISTORY_FILE)) return "";
  const content = readFileSync(HISTORY_FILE, "utf-8");
  const exchanges = content.split("---\n").filter((e) => e.trim());
  return unescapeDelimiter(exchanges.slice(-HISTORY_EXCHANGES).join("---\n"));
}

// Zápis exchange bloku nesmí obsahovat přesnou sekvenci delimiteru (`"---\n"`),
// kterým `getHistory()` bloky rozděluje — jinak markdownové horizontální linky
// v textu (běžné v checkpointech/specech) rozseknou jeden exchange na víc
// nelabelovaných fragmentů. Vloží se neviditelný zero-width space hned za
// trojici pomlček, ať se řádek vizuálně nezmění, ale přestane bajtově
// odpovídat delimiteru. Escapuje se až CELÉ sestavené tělo (`Uživatel: ...
// \nClaude: ...\n`), ne `userMsg`/`botMsg` zvlášť před sestavením — jinak by
// unikla kolize vzniklá až spojením, např. `userMsg` končící na `---` těsně
// před šablonou vloženým `\nClaude: `. `getHistory()` musí escapování zase
// odstranit (`unescapeDelimiter`) — jinak by se zero-width space natrvalo
// propsala do seedovaného kontextu při každém dalším čtení, i pro text, co
// žádnou skutečnou kolizi nikdy neměl.
function escapeDelimiter(text: string): string {
  return text.replace(/---\n/g, "---​\n");
}

function unescapeDelimiter(text: string): string {
  return text.replace(/---​\n/g, "---\n");
}

export function appendHistory(userMsg: string, botMsg: string): void {
  const body = `Uživatel: ${userMsg}\nClaude: ${botMsg}\n`;
  appendFileSync(HISTORY_FILE, escapeDelimiter(body) + "---\n");
}
