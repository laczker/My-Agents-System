// CLI pro bash skripty (daily_digest.sh, ai_news_digest.sh): uloží digest a
// vytiskne jeho URL na stdout (jediný řádek), ať ho skript může poslat do Telegramu.
//
// Použití: npx tsx src/addDigest.ts <type: daily|ai_news> <title> <teaser-file> <body-file>
import { readFileSync } from "node:fs";
import { addDigest, type DigestType } from "./store.js";
import { HOST, PORT } from "./config.js";

const [type, title, teaserFile, bodyFile] = process.argv.slice(2);

if (!type || !title || !teaserFile || !bodyFile) {
  console.error("Použití: addDigest.ts <daily|ai_news> <title> <teaser-file> <body-file>");
  process.exit(1);
}
if (type !== "daily" && type !== "ai_news") {
  console.error(`Neplatný type: ${type}`);
  process.exit(1);
}

const teaser = readFileSync(teaserFile, "utf-8").trim();
const body = readFileSync(bodyFile, "utf-8").trim();

const digest = addDigest(type as DigestType, title, teaser, body);
console.log(`http://${HOST}:${PORT}/#/digest/${digest.id}`);
