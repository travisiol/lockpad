"use client";

import { useEffect, useState } from "react";
import type { LaunchesResponse } from "@/lib/pons";

/**
 * The number of launches through the router, read from the chain by the
 * visitor's browser. Zero is a real zero — it is what the router says, or
 * what an unconfigured router amounts to. Never seeded.
 */
export function LiveCount() {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/launches?limit=100")
      .then((r) => r.json() as Promise<LaunchesResponse>)
      .then((j) => alive && setCount(j.ok ? j.launches.length : 0))
      .catch(() => alive && setCount(0));
    return () => {
      alive = false;
    };
  }, []);
  return count === null ? <span className="skeleton inline-block h-7 w-12" /> : <span className="mono text-2xl text-ink">{count}</span>;
}
