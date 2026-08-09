"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { STAGE_ORDER, STAGE_LABEL, STAGE_VAR, jsonFetch } from "@/lib/ui";

interface Summary {
  provider: string;
  model: string;
}
interface Config {
  backend: "sheet" | "sqlite";
  hasLLM: boolean;
  mode: "default" | "custom" | "chain";
  active: number;
  chain: Summary[];
}
interface Stats {
  words: { total: number; weak: number; stageCounts: Record<string, number> };
}

export default function Home() {
  // Home only needs the aggregate numbers, so it reads /api/stats (a small
  // payload) instead of downloading the full word list.
  const [stats, setStats] = useState<Stats | null>(null);
  const [config, setConfig] = useState<Config | null>(null);

  useEffect(() => {
    jsonFetch<Stats>("/api/stats").then(setStats);
    jsonFetch<Config>("/api/config").then(setConfig);
  }, []);

  const total = stats?.words.total ?? 0;
  const weak = stats?.words.weak ?? 0;
  const counts = STAGE_ORDER.map((s) => ({
    stage: s,
    n: stats?.words.stageCounts[s] ?? 0,
  }));

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Practice, don&apos;t just log.
        </h1>
        <p className="muted mt-1">
          Words climb from recognition to production. Weak ones resurface. The
          exercise changes every time.
        </p>
      </section>

      {config && !config.hasLLM && <SetupBanner config={config} />}

      {config && (
        <div className="flex flex-wrap items-center gap-2 text-xs muted">
          <span className="chip">
            storage: {config.backend === "sheet" ? "Google Sheet" : "SQLite"}
          </span>
          {config.hasLLM ? (
            <>
              <span className="chip">{config.mode} mode</span>
              {config.chain.map((c, i) => (
                <span
                  key={i}
                  title={
                    i === config.active
                      ? "active provider"
                      : i < config.active
                        ? "dropped (failed 3× in a row)"
                        : "fallback"
                  }
                  style={{
                    fontWeight: i === config.active ? 700 : 400,
                    textDecoration: i < config.active ? "line-through" : "none",
                    opacity: i < config.active ? 0.5 : 1,
                  }}
                >
                  {i > 0 && "→ "}
                  {c.provider}/{c.model}
                  {i === config.active && config.chain.length > 1 && " ✓"}
                </span>
              ))}
            </>
          ) : (
            <span>AI off — flashcards, cloze & type-the-word still work</span>
          )}
        </div>
      )}

      <section className="card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-4xl font-extrabold">{total}</div>
            <div className="muted text-sm">
              words {weak > 0 && <>· {weak} need work</>}
            </div>
          </div>
          <Link
            href={total > 0 ? "/practice" : "/add"}
            className="btn btn-primary"
          >
            {total > 0 ? "Start practice →" : "Add your first word"}
          </Link>
        </div>

        {total > 0 && (
          <div className="mt-5 space-y-2">
            {counts.map(({ stage, n }) => (
              <div key={stage} className="flex items-center gap-3">
                <div className="w-24 text-sm font-semibold">
                  {STAGE_LABEL[stage]}
                </div>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-black/5 dark:bg-white/10">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: total ? `${(n / total) * 100}%` : "0%",
                      background: STAGE_VAR[stage],
                    }}
                  />
                </div>
                <div className="w-8 text-right text-sm muted">{n}</div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Link href="/add" className="card p-4 hover:opacity-90">
          <div className="font-bold">＋ Add a word</div>
          <div className="muted text-sm">LLM fills meaning &amp; examples</div>
        </Link>
        <Link href="/import" className="card p-4 hover:opacity-90">
          <div className="font-bold">⇪ Import CSV</div>
          <div className="muted text-sm">Bulk-load your list once</div>
        </Link>
      </section>
    </div>
  );
}

function SetupBanner({ config }: { config: Config }) {
  return (
    <section
      className="card p-4 text-sm"
      style={{ background: "var(--warn-soft)", borderColor: "var(--warn)" }}
    >
      <div className="font-bold mb-1">Optional: turn on AI</div>
      <p className="muted">
        No LLM configured yet — word enrichment and sentence scoring are off.
        Flashcards, cloze and type-the-word still work fully. To enable enrichment
        and scoring, set up a provider: <code>docs/SETUP-LLM-PROVIDERS.md</code>.
      </p>
    </section>
  );
}
