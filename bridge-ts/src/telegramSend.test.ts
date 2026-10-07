import { test } from "node:test";
import assert from "node:assert/strict";
import { GrammyError } from "grammy";
import { sendText, reactTo } from "./telegramSend.js";

function err(code: number, description: string): GrammyError {
  return new GrammyError("x", { ok: false, error_code: code, description }, "sendMessage", {});
}

function fakeApi(fail: (opts: Record<string, unknown>, n: number) => Error | null) {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    async sendMessage(_c: string, _t: string, opts: Record<string, unknown> = {}) {
      calls.push(opts);
      const e = fail(opts, calls.length);
      if (e) throw e;
    },
  };
}

test("reply is attached to the first chunk only", async () => {
  const api = fakeApi(() => null);
  await sendText(api, "1", "a".repeat(4500), 7);
  assert.equal(api.calls.length, 2);
  assert.deepEqual(api.calls[0].reply_parameters, { message_id: 7, allow_sending_without_reply: true });
  assert.equal(api.calls[1].reply_parameters, undefined);
});

test("markdown parse error falls back to plain text, keeping the reply", async () => {
  const api = fakeApi((o) => (o.parse_mode ? err(400, "can't parse entities") : null));
  await sendText(api, "1", "x", 7);
  assert.equal(api.calls.length, 2);
  assert.equal(api.calls[1].parse_mode, undefined);
  assert.ok(api.calls[1].reply_parameters);
});

test("a rejected reply is dropped, message still delivered", async () => {
  const api = fakeApi((o) => (o.reply_parameters ? err(400, "Bad Request: message to be replied not found") : null));
  await sendText(api, "1", "x", 7);
  assert.equal(api.calls.at(-1)?.reply_parameters, undefined);
});

test("non-400 errors propagate so the outbox retries", async () => {
  const api = fakeApi(() => err(429, "Too Many Requests"));
  await assert.rejects(sendText(api, "1", "x", 7));
});

test("reactTo reports failure instead of throwing", async () => {
  assert.equal(await reactTo({ setMessageReaction: async () => {} }, "1", 5), true);
  assert.equal(
    await reactTo({ setMessageReaction: async () => { throw err(400, "REACTION_INVALID"); } }, "1", 5),
    false,
  );
});
