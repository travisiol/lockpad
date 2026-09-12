"use client";

import Link from "next/link";
import { Dial } from "@/components/Dial";
import { TokenLogo } from "@/components/TokenLogo";
import { FEE_PHASE_LABEL, countdown, feePhase, fraction, ratio, vestPhase, weiToEth, type FeePhase } from "@/lib/lockmath";
import { formatCap } from "@/lib/format";
import type { Launch } from "@/lib/pons";

export const PILL_CLASS: Record<FeePhase, string> = {
  locked: "pill pill-locked",
  checkpoint: "pill pill-due",
  unlocking: "pill pill-released",
  open: "pill pill-released",
  buriable: "pill pill-due",
  buried: "pill pill-buried",
};

export function LaunchCard({ launch, now }: { launch: Launch; now: number }) {
  const { locks, market } = launch;
  const phase = feePhase(locks.fees, now);
  const vest = vestPhase(locks, now);
  const devLockedFrac = locks.hasVesting ? 1 - fraction(now, locks.vestStart, locks.vestEnd) : 0;
  const feeCountdown =
    phase === "locked"
      ? `graduate within ${countdown(locks.fees.deadline, now)}`
      : phase === "unlocking"
        ? `fully unlocked in ${countdown(locks.fees.vestEnd, now)}`
        : phase === "buriable"
          ? "anyone can bury"
          : phase === "buried"
            ? `${weiToEth(locks.fees.totalBuried, 4)} ETH buried`
            : phase === "checkpoint"
              ? "checkpoint to start the vest"
              : "fees pass through";

  return (
    <Link href={`/token/${launch.token}`} className="glass group flex flex-col gap-5 p-5 transition-colors hover:border-edge-2">
      <div className="flex items-start gap-3">
        <TokenLogo logo={launch.logo} symbol={launch.symbol} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="display truncate text-[20px] text-ink">{launch.name}</p>
            <span className="mono shrink-0 text-xs text-ink-3">${launch.symbol}</span>
          </div>
          <p className="mt-1 line-clamp-1 text-sm text-ink-3">{launch.description || "No description."}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="label">Market cap</p>
          <p className="mono mt-1 text-lg text-ink">{formatCap(market.marketCapUsd, market.marketCapEth)}</p>
        </div>
        <div>
          <p className="label">Graduation</p>
          <div className="mt-2 flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-glass-2">
              <div className="h-full rounded-full bg-ink" style={{ width: `${market.graduated ? 100 : market.graduationProgressPct}%` }} />
            </div>
            <span className="mono text-xs text-ink-2">{market.graduated ? "Done" : `${Math.floor(market.graduationProgressPct)}%`}</span>
          </div>
        </div>
      </div>

      <div className="hairline" />

      <div className="grid grid-cols-[auto_1fr] items-center gap-4">
        <Dial value={devLockedFrac} size={56} stroke={5} tone={locks.hasVesting ? "amber" : "ash"} label={locks.hasVesting ? `${Math.round(devLockedFrac * 100)}% of the developer buy still locked` : "no developer buy"}>
          <span className={`mono text-[11px] ${locks.hasVesting ? "text-amber" : "text-ash"}`}>{locks.hasVesting ? `${Math.round(devLockedFrac * 100)}%` : "—"}</span>
        </Dial>
        <div className="min-w-0">
          <p className="label">Developer buy</p>
          {locks.hasVesting ? (
            <p className="mt-1 truncate text-sm text-ink-2">
              {vest === "done" ? "Fully unlocked" : `${weiToEth(launch.developerBuy, 4)} ETH · unlocks over ${countdown(locks.vestEnd, now)}`}
              <span className="text-ink-4"> · {Math.round(ratio(locks.devReleased, locks.devAllocation) * 100)}% released</span>
            </p>
          ) : (
            <p className="mt-1 text-sm text-ink-3">None — the creator started with zero.</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={PILL_CLASS[phase]}>{FEE_PHASE_LABEL[phase]}</span>
        <span className="mono text-xs text-ink-3">{feeCountdown}</span>
      </div>
    </Link>
  );
}
