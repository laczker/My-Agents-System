export type DigestType = "daily" | "ai_news";

export interface DigestSummary {
  id: string;
  type: DigestType;
  createdAt: string;
  title: string;
  teaser: string;
}

export interface Digest extends DigestSummary {
  body: string;
}

export async function fetchDigests(type: DigestType): Promise<DigestSummary[]> {
  const res = await fetch(`/api/digests?type=${type}`);
  if (!res.ok) throw new Error(`Chyba načítání digestů: ${res.status}`);
  return res.json();
}

export async function fetchDigest(id: string): Promise<Digest> {
  const res = await fetch(`/api/digests/${id}`);
  if (!res.ok) throw new Error(`Digest nenalezen: ${res.status}`);
  return res.json();
}
