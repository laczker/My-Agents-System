import { writeFileSync } from "node:fs";
import path from "node:path";
import { Bot } from "grammy";
import { TELEGRAM_BOT_TOKEN, INBOX_DIR } from "./config.js";

/** Stáhne přílohu (dokument/foto) do inboxu, stejné chování jako download_file
 * v bridge.py — vrací uloženou cestu, nebo popis chyby. */
export async function downloadAttachment(
  bot: Bot,
  fileId: string,
  fileName: string
): Promise<{ path: string } | { error: string }> {
  try {
    const file = await bot.api.getFile(fileId);
    if (!file.file_path) {
      return { error: "neznámá chyba (Telegram nevrátil file_path)" };
    }
    const url = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${file.file_path}`;
    const res = await fetch(url);
    if (!res.ok) return { error: `stažení selhalo: HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const savePath = path.join(INBOX_DIR, fileName);
    writeFileSync(savePath, buf);
    return { path: savePath };
  } catch (e) {
    return { error: String(e) };
  }
}
