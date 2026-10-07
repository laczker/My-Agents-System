import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BusyTracker, clearBusy, markBusy } from "./busy.js";

const dir = mkdtempSync(join(tmpdir(), "busy-"));
const file = join(dir, "busy_ts.txt");

test("markBusy writes a fresh timestamp atomically (no tmp left)", () => {
  const before = Date.now();
  markBusy(file);
  const { ts } = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(ts >= before && ts <= Date.now());
  assert.equal(existsSync(`${file}.tmp`), false);
});

test("clearBusy removes the marker and tolerates a missing one", () => {
  clearBusy(file);
  assert.equal(existsSync(file), false);
  clearBusy(file);
});

test("markBusy on an unwritable path does not throw", () => {
  assert.doesNotThrow(() => markBusy("/nonexistent-dir/busy_ts.txt"));
});

test("overlapping turns: marker stays until the last source ends", () => {
  const t = new BusyTracker(file);
  t.set("send", true);
  t.set("unsolicited", true);
  assert.equal(existsSync(file), true);
  t.set("unsolicited", false); // e.g. start()/onExit/result while send() in flight
  assert.equal(existsSync(file), true);
  assert.equal(t.isBusy(), true);
  t.set("send", false);
  assert.equal(existsSync(file), false);
  assert.equal(t.isBusy(), false);
});

test("idle set(false) sweeps a leftover marker; repeated set(true) does not rewrite", async () => {
  markBusy(file);
  const t = new BusyTracker(file);
  t.set("unsolicited", false);
  assert.equal(existsSync(file), false);
  t.set("unsolicited", true);
  const first = readFileSync(file, "utf8");
  await new Promise((r) => setTimeout(r, 5));
  t.set("unsolicited", true);
  assert.equal(readFileSync(file, "utf8"), first);
  t.set("unsolicited", false);
});

test("timestamp is refreshed while busy", async () => {
  const t = new BusyTracker(file, 10);
  t.set("send", true);
  const first = JSON.parse(readFileSync(file, "utf8")).ts;
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(JSON.parse(readFileSync(file, "utf8")).ts > first);
  t.set("send", false);
});
