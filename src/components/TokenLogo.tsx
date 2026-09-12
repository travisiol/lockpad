/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { logoCandidates } from "@/lib/pons";

type Props = {
  logo: string | null | undefined;
  symbol: string;
  /** Square size in px. Cards use 44, the token page 64. */
  size?: number;
  className?: string;
};

/**
 * A launch's image, or — when it has none — its first letter on glass. An
 * ipfs:// image is tried on the Pons gateway first, then on public
 * gateways; when every candidate fails, the letter shows.
 */
export function TokenLogo({ logo, symbol, size = 44, className = "" }: Props) {
  const candidates = logoCandidates(logo);
  const [failed, setFailed] = useState(0);
  const url = candidates[failed] ?? null;
  const radius = Math.round(size * 0.28);
  if (url) {
    return (
      <img
        src={url}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 border border-edge-2 bg-void-3 object-cover ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
        onError={() => setFailed((n) => n + 1)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className={`display flex shrink-0 items-center justify-center border border-edge-2 bg-void-3 text-amber ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46), borderRadius: radius }}
    >
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  );
}
