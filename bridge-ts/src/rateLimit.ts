import { USER_TIMEZONE } from "./config.js";

// Když `claude` CLI narazí na 5hodinovou/týdenní kvótu, vrátí místo skutečné
// odpovědi text ve tvaru "You've hit your session limit · resets 3:50pm (UTC)"
// (viz DECISIONS.md, ověřeno ručně). Tenhle regex ho pozná bez ohledu na to,
// jestli jde o "session limit", "weekly limit" apod.
const HIT_LIMIT_PATTERN = /you'?ve hit your [a-z ]*limit/i;
const RESETS_TIME_PATTERN = /resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(UTC\)/i;

export function looksLikeRateLimitText(text: string): boolean {
  return HIT_LIMIT_PATTERN.test(text);
}

/** Rozparsuje "resets 3:50pm (UTC)" na epoch ms. Čas v hlášce je vždy nejbližší
 * budoucí výskyt té hodiny v UTC — pokud vyjde v minulosti, je to zítra. */
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

/** `resetsAt` z `rate_limit_event` je zod `int()` bez jednotky — API ho posílá
 * v sekundách (unix epoch), ale pro jistotu proti budoucí změně rozliš podle
 * řádu velikosti (ms epoch je ~1000x větší). */
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
