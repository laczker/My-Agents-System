// Reads `job_queue_ts.json`, which each bot fills in on its own (bridge-ts/src/queue.ts).
// A non-empty queue = the bot is currently processing (or waiting to process) a job —
// no extra instrumentation added, just reading the existing queue state.
import { readFileSync } from "node:fs";
import type { BotDef } from "./config.js";

export interface ProcessingState {
  isProcessing: boolean;
  queueLength: number;
  currentJobPreview: string | null;
}

function queuePath(bot: BotDef): string {
  return `${bot.dir}/job_queue_ts.json`;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

export function readProcessingState(bot: BotDef): ProcessingState {
  try {
    const raw = readFileSync(queuePath(bot), "utf-8");
    const parsed = JSON.parse(raw) as { jobs?: { userText: string }[] };
    const jobs = parsed.jobs ?? [];
    const currentJobPreview = jobs.length > 0 ? truncate(jobs[0].userText, 80) : null;
    return { isProcessing: jobs.length > 0, queueLength: jobs.length, currentJobPreview };
  } catch {
    return { isProcessing: false, queueLength: 0, currentJobPreview: null };
  }
}
