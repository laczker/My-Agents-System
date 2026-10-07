import { GrammyError } from "grammy";

/** The subset of the grammY API used here (keeps this module testable without a bot). */
export interface TelegramApi {
  sendMessage(chatId: string, text: string, other?: Record<string, unknown>): Promise<unknown>;
}

function isParseError(e: unknown): boolean {
  return e instanceof GrammyError && e.error_code === 400 && e.description.includes("can't parse entities");
}

function isBadRequest(e: unknown): boolean {
  return e instanceof GrammyError && e.error_code === 400;
}

/** Sends one chunk: Markdown first, plain text if Telegram can't parse the entities.
 * `replyTo` makes it a reply to the user's message; it is dropped if Telegram rejects
 * it with a 400 (e.g. the message was deleted), so a reply never blocks delivery. */
export async function sendChunk(api: TelegramApi, chatId: string, chunk: string, replyTo?: number): Promise<void> {
  const reply = replyTo === undefined ? {} : { reply_parameters: { message_id: replyTo, allow_sending_without_reply: true } };
  try {
    await api.sendMessage(chatId, chunk, { parse_mode: "Markdown", ...reply });
    return;
  } catch (e) {
    if (isParseError(e)) {
      // Claude doesn't generate text strictly for legacy Telegram Markdown — deliver
      // the raw text rather than dropping it.
      try {
        await api.sendMessage(chatId, chunk, reply);
        return;
      } catch (e2) {
        if (replyTo === undefined || !isBadRequest(e2)) throw e2;
      }
    } else if (replyTo === undefined || !isBadRequest(e)) {
      throw e;
    }
  }
  // The reply parameters were the likely culprit — retry once as a plain message.
  await sendChunk(api, chatId, chunk);
}

/** Splits to Telegram-sized chunks; only the first one is a reply. */
export async function sendText(api: TelegramApi, chatId: string, text: string, replyTo?: number): Promise<void> {
  const chunks = text.match(/[\s\S]{1,4000}/g) ?? [text];
  for (let i = 0; i < chunks.length; i++) {
    await sendChunk(api, chatId, chunks[i], i === 0 ? replyTo : undefined);
  }
}

export interface ReactionApi {
  setMessageReaction(chatId: string, messageId: number, reaction: { type: "emoji"; emoji: "👀" }[]): Promise<unknown>;
}

/** Acknowledges a received message with a reaction. Resolves true if it was set; false
 * on any API error, so the caller can fall back to a text acknowledgement. */
export async function reactTo(api: ReactionApi, chatId: string, messageId: number): Promise<boolean> {
  try {
    await api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji: "👀" }]);
    return true;
  } catch {
    return false;
  }
}
