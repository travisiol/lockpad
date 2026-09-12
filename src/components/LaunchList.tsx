"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LaunchCard } from "@/components/LaunchCard";
import { useNow } from "@/lib/useNow";
import type { Launch, LaunchesResponse } from "@/lib/pons";

type State = { status: "loading" } | { status: "ready"; launches: Launch[]; readAt: number } | { status: "error"; message: string };

/**
 * Launches through the router, newest first, straight from the chain.
 * Empty is a real state — nothing is seeded, nothing is sampled.
 */
export function LaunchList({ limit = 12, compact = false }: { limit?: number; compact?: boolean }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const now = useNow(state.status === "ready" ? state.readAt : undefined);

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch(`/api/launches?limit=${limit}`)
        .then(async (r) => {
          const j = (await r.json()) as LaunchesResponse & { error?: string };
          if (!alive) return;
          if (!j.ok) setState({ status: "error", message: j.error ?? "chain unreachable" });
          else setState({ status: "ready", launches: j.launches, readAt: j.readAt });
        })
        .catch((e) => alive && setState({ status: "error", message: e instanceof Error ? e.message : "chain unreachable" }));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [limit]);

  if (state.status === "loading") {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: compact ? 3 : 6 }).map((_, i) => (
          <div key={i} className="glass h-[280px] p-5">
            <div className="skeleton h-11 w-11 rounded-xl" />
            <div className="skeleton mt-4 h-5 w-2/3" />
            <div className="skeleton mt-3 h-4 w-full" />
            <div className="skeleton mt-8 h-14 w-14 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="panel p-8 text-center">
        <p className="display text-[22px] text-ink">The chain did not answer.</p>
        <p className="mono mt-2 text-xs text-ink-3">{state.message}</p>
      </div>
    );
  }

  if (state.launches.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-4 p-10 text-center">
        <p className="display text-[26px] text-ink">Nothing locked yet.</p>
        <p className="max-w-md text-sm text-ink-2">Yours could be first. Every launch here ships with both locks, and this list reads them straight from the chain.</p>
        <Link href="/launch" className="btn btn-primary">
          Launch a token
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {state.launches.map((l) => (
        <LaunchCard key={l.token} launch={l} now={now} />
      ))}
    </div>
  );
}
