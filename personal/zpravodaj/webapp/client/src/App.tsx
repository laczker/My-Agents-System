import { useEffect, useState } from "react";
import { fetchDigests, fetchDigest, type DigestSummary, type Digest, type DigestType } from "./api";
import "./App.css";

const TABS: { type: DigestType; label: string }[] = [
  { type: "daily", label: "Denní souhrn" },
  { type: "ai_news", label: "AI novinky" },
];

function digestIdFromHash(): string | null {
  const m = window.location.hash.match(/^#\/digest\/(.+)$/);
  return m ? m[1] : null;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("cs-CZ", { dateStyle: "medium", timeStyle: "short" });
}

function labelForType(type: DigestType): string {
  return TABS.find((t) => t.type === type)?.label ?? type;
}

const URL_RE = /(https?:\/\/\S+)/g;

function linkify(text: string) {
  return text.split(URL_RE).map((part, i) =>
    part.startsWith("http") ? (
      <a key={i} href={part} target="_blank" rel="noopener noreferrer">
        {part}
      </a>
    ) : (
      part
    )
  );
}

function renderBody(text: string) {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const isBullet = line.startsWith("• ");
      return (
        <p key={i} className={isBullet ? "bullet" : "section-heading"}>
          {isBullet ? linkify(line.slice(2)) : line}
        </p>
      );
    });
}

function DigestDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDigest(null);
    setError(null);
    fetchDigest(id).then(setDigest).catch((e) => setError(String(e)));
  }, [id]);

  return (
    <div className="detail">
      <button className="back" onClick={onBack}>
        ← Zpět na seznam
      </button>
      {error && <p className="error">{error}</p>}
      {!digest && !error && <p>Načítám…</p>}
      {digest && (
        <>
          <h1>{digest.title}</h1>
          <p className="meta">
            {labelForType(digest.type)} · {formatDate(digest.createdAt)}
          </p>
          <div className="body">{renderBody(digest.body)}</div>
        </>
      )}
    </div>
  );
}

function DigestList({ type }: { type: DigestType }) {
  const [digests, setDigests] = useState<DigestSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDigests(null);
    setError(null);
    fetchDigests(type).then(setDigests).catch((e) => setError(String(e)));
  }, [type]);

  if (error) return <p className="error">{error}</p>;
  if (!digests) return <p>Načítám…</p>;
  if (digests.length === 0) return <p className="empty">Zatím žádné vydání.</p>;

  return (
    <ul className="digest-list">
      {digests.map((d) => (
        <li key={d.id}>
          <a href={`#/digest/${d.id}`}>
            <div className="digest-title">{d.title}</div>
            <div className="meta">{formatDate(d.createdAt)}</div>
            <div className="teaser">{d.teaser}</div>
          </a>
        </li>
      ))}
    </ul>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState<DigestType>("daily");
  const [detailId, setDetailId] = useState<string | null>(digestIdFromHash());

  useEffect(() => {
    const onHashChange = () => setDetailId(digestIdFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="app">
      <header>
        <h1>🗞️ Zpravodaj</h1>
      </header>

      {detailId ? (
        <DigestDetail id={detailId} onBack={() => (window.location.hash = "")} />
      ) : (
        <>
          <nav className="tabs">
            {TABS.map((t) => (
              <button
                key={t.type}
                className={t.type === activeTab ? "active" : ""}
                onClick={() => setActiveTab(t.type)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <DigestList type={activeTab} />
        </>
      )}
    </div>
  );
}
