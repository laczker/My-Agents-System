import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DATA_FILE, MAX_DIGESTS } from "./config.js";

export type DigestType = "daily" | "ai_news";

export interface Digest {
  id: string;
  type: DigestType;
  createdAt: string; // ISO
  title: string;
  teaser: string;
  body: string;
}

function readAll(): Digest[] {
  if (!existsSync(DATA_FILE)) return [];
  const raw = readFileSync(DATA_FILE, "utf-8").trim();
  if (!raw) return [];
  return JSON.parse(raw) as Digest[];
}

function writeAll(digests: Digest[]): void {
  mkdirSync(dirname(DATA_FILE), { recursive: true });
  writeFileSync(DATA_FILE, JSON.stringify(digests, null, 2));
}

export function listDigests(type?: DigestType): Array<Omit<Digest, "body">> {
  const all = readAll()
    .filter((d) => !type || d.type === type)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return all.map(({ body, ...rest }) => rest);
}

export function getDigest(id: string): Digest | undefined {
  return readAll().find((d) => d.id === id);
}

export function addDigest(type: DigestType, title: string, teaser: string, body: string): Digest {
  const digest: Digest = {
    id: `${Date.now()}`,
    type,
    createdAt: new Date().toISOString(),
    title,
    teaser,
    body,
  };
  const all = readAll();
  all.push(digest);
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const trimmed = all.slice(-MAX_DIGESTS);
  writeAll(trimmed);
  return digest;
}
