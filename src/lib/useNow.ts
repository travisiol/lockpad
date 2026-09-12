"use client";

import { useEffect, useRef, useState } from "react";

const nowSec = () => Math.floor(Date.now() / 1000);

/**
 * A ticking clock in unix seconds, re-anchored on the server's `readAt`
 * so a countdown computed against the chain's clock does not jump when the
 * visitor's clock is off. Ticks once a second while mounted.
 */
export function useNow(readAt?: number): number {
  const [now, setNow] = useState<number>(() => readAt ?? nowSec());
  const anchor = useRef({ base: 0, started: 0 });
  useEffect(() => {
    anchor.current = { base: readAt ?? nowSec(), started: Date.now() };
    const id = setInterval(() => setNow(anchor.current.base + Math.floor((Date.now() - anchor.current.started) / 1000)), 1000);
    return () => clearInterval(id);
  }, [readAt]);
  // Until the first tick after a new read lands, never sit behind the chain.
  return readAt !== undefined && now < readAt ? readAt : now;
}
