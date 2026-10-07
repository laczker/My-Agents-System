import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearBusy, markBusy } from "./busy.js";

const file = join(mkdtempSync(join(tmpdir(), "busy-")), "busy_ts.txt");

test("markBusy writes a fresh timestamp", () => {
  const before = Date.now();
  markBusy(file);
  const { ts } = JSON.parse(readFileSync(file, "utf8"));
  assert.ok(ts >= before && ts <= Date.now());
});

test("clearBusy removes the marker and tolerates a missing one", () => {
  clearBusy(file);
  assert.equal(existsSync(file), false);
  clearBusy(file);
});

test("markBusy on an unwritable path does not throw", () => {
  assert.doesNotThrow(() => markBusy("/nonexistent-dir/busy_ts.txt"));
});
