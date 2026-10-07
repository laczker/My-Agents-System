import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// config.ts reads env at import time, so point it at a temp dir before importing history.ts.
const dir = mkdtempSync(join(tmpdir(), "history-test-"));
process.env.TELEGRAM_BOT_TOKEN = "x";
process.env.TELEGRAM_CHAT_ID = "1";
process.env.BOT_DIR = dir;
const { appendHistory, getHistory } = await import("./history.js");
const file = join(dir, "chat_history.txt");

test("small history is not rotated", () => {
  appendHistory("hello", "world");
  appendHistory("second", "reply");
  assert.equal(readFileSync(file, "utf-8").split("---\n").filter((e) => e.trim()).length, 2);
  assert.match(getHistory(), /Uživatel: hello\nClaude: world/);
});

test("file past the size cap is trimmed to the newest exchanges, no tmp left", () => {
  const big = "x".repeat(5_000);
  for (let i = 0; i < 80; i++) appendHistory(`q${i} ${big}`, `a${i}`);
  assert.ok(statSync(file).size <= 200_000);
  const content = readFileSync(file, "utf-8");
  assert.ok(!content.includes("q0 "), "oldest exchange dropped");
  assert.ok(content.includes("q79 "), "newest exchange kept");
  assert.ok(content.split("---\n").filter((e) => e.trim()).length <= 100);
  assert.ok(content.includes("q70 "));
  assert.ok(content.endsWith("---\n"));
  assert.equal(existsSync(`${file}.tmp`), false);
});

test("rotation keeps escaped delimiters intact and exchanges whole", () => {
  const big = "y".repeat(5_000);
  for (let i = 0; i < 60; i++) appendHistory(`md ${i}\n---\n${big}`, "ok\n---\nend");
  const last = getHistory();
  assert.match(last, /Uživatel: md 59\n---\n/);
  assert.ok(!last.includes("\u200b"));
  assert.equal(last.split("Uživatel: ").length - 1, 10);
});

test("oversized exchanges are capped so rotation does not re-run on every append", () => {
  const huge = "z".repeat(30_000);
  for (let i = 0; i < 12; i++) appendHistory(`h${i} ${huge}`, "ok");
  const size = statSync(file).size;
  assert.ok(size <= 200_000, `size ${size}`);
  appendHistory("tail", "ok");
  const after = readFileSync(file, "utf-8");
  assert.ok(after.includes("Uživatel: tail"));
  assert.ok(statSync(file).size <= 200_000);
  assert.ok(after.includes("[truncated]"));
  assert.ok(after.split("---\n").filter((e) => e.trim()).length >= 10);
});
