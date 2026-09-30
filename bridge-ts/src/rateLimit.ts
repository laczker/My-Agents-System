import { USER_TIMEZONE } from "./config.js";

// When the `claude` CLI hits the 5-hour/weekly quota, it returns text of the form
// "You've hit your session limit · resets 3:50pm (UTC)" instead of a real reply
// (see DECISIONS.md, verified manually). This regex recognizes it regardless of
// whether it says "session limit", "weekly limit", etc.
const HIT_LIMIT_PATTERN = /you'?ve hit your [a-z ]*limit/i;
const RESETS_TIME_PATTERN = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)/i;

export function looksLikeRateLimitText(text: string): boolean {
  return HIT_LIMIT_PATTERN.test(text);
}

/** Parses "resets 3:50pm (UTC)" into epoch ms. The time in the message is always the
 * nearest future occurrence of that hour in UTC — if it comes out in the past, it's tomorrow. */
export function parseResetsAtFromText(text: string, now: Date = new Date()): number | null {
  const m = RESETS_TIME_PATTERN.exec(text);
  if (!m) return null;
  let hour = parseInt(m[1], 10) % 12;
  if (/pm/i.test(m[3])) hour += 12;
  const minute = m[2] ? parseInt(m[2], 10) : 0;

  const candidate = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute, 0, 0,
  ));
  if (candidate.getTime() <= now.getTime() - 5 * 60_000) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  return candidate.getTime();
}

/** `resetsAt` from `rate_limit_event` is a unitless zod `int()` — the API sends it
 * in seconds (unix epoch), but as a safeguard against a future change, distinguish by
 * order of magnitude (ms epoch is ~1000x bigger). */
export function normalizeResetsAt(resetsAt: number): number {
  return resetsAt < 10_000_000_000 ? resetsAt * 1000 : resetsAt;
}

export function formatResetTimeLocal(resetsAtMs: number): string {
  const formatted = new Intl.DateTimeFormat("cs-CZ", {
    timeZone: USER_TIMEZONE,
    day: "numeric",
    month: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(resetsAtMs));
  return `${formatted} (${USER_TIMEZONE})`;
}
