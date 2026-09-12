"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import { CopyButton } from "@/components/CopyButton";
import { Dial } from "@/components/Dial";
import { PILL_CLASS } from "@/components/LaunchCard";
import { PriceChart } from "@/components/PriceChart";
import { TokenLogo } from "@/components/TokenLogo";
import { explorer, ponsTradeUrl, robinhoodChain } from "@/lib/chain";
import { feeLockAbi, vestingAbi } from "@/lib/contracts";
import { formatCap, formatDateTime, formatPrice, formatTokenAmount, shortAddress } from "@/lib/format";
import { FEE_PHASE_LABEL, countdown, feePhase, formatSpan, formatUtc, fraction, ratio, vestPhase, weiToEth } from "@/lib/lockmath";
import type { ChartResponse, SummaryResponse, Trade, TradesResponse } from "@/lib/pons";
import { site } from "@/lib/site";
import { useNow } from "@/lib/useNow";

const ZERO = "0x0000000000000000000000000000000000000000";

type Summary = SummaryResponse;

export function TokenView({ token }: { token: `0x${string}` }) {
  const [summary, setSummary] = useState<Summary | null | undefined>(undefined);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [chart, setChart] = useState<ChartResponse | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const now = useNow(summary?.readAt);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/token/${token}/summary`);
      if (r.status === 404) {
        setSummary(null);
        return;
      }
      const j = (await r.json()) as SummaryResponse;
      if (j.ok) setSummary(j);
    } catch {
      /* keep the last good read */
    }
  }, [token]);

  useEffect(() => {
    const tick = () => {
      void load();
    };
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    if (!summary) return;
    let alive = true;
    fetch(`/api/token/${token}/trades`)
      .then((r) => r.json() as Promise<TradesResponse>)
      .then((j) => alive && j.ok && setTrades(j.trades))
      .catch(() => {});
    fetch(`/api/token/${token}/chart`)
      .then((r) => r.json() as Promise<ChartResponse>)
      .then((j) => alive && j.ok && setChart(j))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [token, summary?.readAt, summary]);

  const { isConnected, chainId } = useAccount();
  const { writeContractAsync, isPending } = useWriteContract();
  const onChain = isConnected && chainId === robinhoodChain.id;

  async function call(address: `0x${string}`, abi: typeof feeLockAbi, functionName: "release" | "bury" | "checkpoint", label: string) {
    setStatus(null);
    try {
      const hash = await writeContractAsync({ address, abi, functionName, chainId: robinhoodChain.id });
      setStatus(`${label} submitted: ${hash}`);
      setTimeout(load, 4000);
    } catch (err) {
      setStatus(err instanceof Error ? err.message.split("\n")[0] : `${label} failed`);
    }
  }

  if (summary === undefined) {
    return (
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="glass h-[420px] p-6">
          <div className="skeleton h-16 w-16 rounded-2xl" />
          <div className="skeleton mt-6 h-8 w-1/2" />
          <div className="skeleton mt-4 h-[220px] w-full" />
        </div>
        <div className="glass h-[420px] p-6">
          <div className="skeleton h-5 w-1/3" />
          <div className="skeleton mt-6 h-24 w-full" />
        </div>
      </div>
    );
  }

  if (summary === null) {
    return (
      <div className="glass p-10 text-center">
        <p className="display text-[26px] text-ink">Not a {site.name} launch.</p>
        <p className="mono mt-2 text-xs text-ink-3">{token}</p>
        <p className="mt-3 text-sm text-ink-2">This address was not launched through the router, so it carries no locks we can read.</p>
        <Link href="/tokens" className="btn btn-glass mt-6">
          Back to launches
        </Link>
      </div>
    );
  }

  const { launch, market } = summary;
  const { locks } = launch;
  const fees = locks.fees;
  const phase = feePhase(fees, now);
  const vest = vestPhase(locks, now);
  const devLockedFrac = locks.hasVesting ? 1 - fraction(now, locks.vestStart, locks.vestEnd) : 0;
  const feeLock = launch.feeLock as `0x${string}`;
  const vesting = launch.vesting as `0x${string}`;
  const canBury = phase === "buriable" || phase === "buried";
  const buryReady = canBury && BigInt(fees.buryable) > 0n && now >= fees.nextBuryAt;
  const releaseReady = (phase === "unlocking" || phase === "open") && (BigInt(fees.releasable) > 0n || BigInt(fees.pending) > 0n);
  // After graduation the curve's reserves move to the pool; the site reads
  // the curve only, so it has no price to show.
  const inPool = market.graduated && market.priceEth === 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      {/* ── Identity + market ─────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="glass p-6 sm:p-7">
          <div className="flex flex-wrap items-start gap-4">
            <TokenLogo logo={launch.logo} symbol={launch.symbol} size={64} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h1 className="display text-[32px] text-ink sm:text-[40px]">{launch.name}</h1>
                <span className="mono text-sm text-ink-3">${launch.symbol}</span>
              </div>
              <p className="mt-2 max-w-xl text-sm text-ink-2">{launch.description || "No description."}</p>
              <div className="mono mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
                <span className="inline-flex items-center gap-1">
                  {shortAddress(launch.token, 6)}
                  <CopyButton value={launch.token} variant="icon" />
                </span>
                <a href={explorer.token(launch.token)} target="_blank" rel="noreferrer" className="hover:text-ink">
                  Explorer ↗
                </a>
                <a href={ponsTradeUrl(launch.token)} target="_blank" rel="noreferrer" className="hover:text-ink">
                  Trade on Pons ↗
                </a>
                <span>Launched {formatDateTime(launch.launchedAt)}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Price" value={inPool ? "In pool" : formatPrice(market.priceUsd, market.priceEth)} />
            <Stat label="Market cap" value={inPool ? "In pool" : formatCap(market.marketCapUsd, market.marketCapEth)} />
            <Stat label="Raised" value={market.graduated ? "Graduated" : `${market.raisedEth.toFixed(2)}/${market.graduationThresholdEth} ETH`} />
            <Stat label="Venue" value={market.graduated ? "Pool · graduated" : `Curve · ${Math.floor(market.graduationProgressPct)}%`} />
          </div>

          <div className="mt-6">
            {inPool ? (
              <div className="flex h-[220px] items-center justify-center rounded-[14px] border border-dashed border-edge px-6 text-center text-sm text-ink-3">
                Graduated — the market moved to the pool. This page reads the curve only; trade and price on Pons.
              </div>
            ) : chart ? (
              <PriceChart points={chart.points} launchSupply={chart.launchSupply} ethUsd={chart.ethUsd} />
            ) : (
              <div className="skeleton h-[220px] w-full" />
            )}
          </div>
        </div>

        <div className="glass p-6 sm:p-7">
          <div className="flex items-baseline justify-between">
            <h2 className="display text-[22px] text-ink">Curve trades</h2>
            <span className="mono text-xs text-ink-3">{trades.length} most recent</span>
          </div>
          {trades.length === 0 ? (
            <p className="mt-4 text-sm text-ink-3">No trades on the curve yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="label text-left">
                    <th className="pb-2 font-normal">Side</th>
                    <th className="pb-2 font-normal">ETH</th>
                    <th className="pb-2 font-normal">Tokens</th>
                    <th className="pb-2 font-normal">Account</th>
                    <th className="pb-2 text-right font-normal">When</th>
                  </tr>
                </thead>
                <tbody className="mono">
                  {trades.map((t) => (
                    <tr key={t.id} className="border-t border-edge">
                      <td className={`py-2 ${t.side === "buy" ? "text-up" : "text-down"}`}>{t.side}</td>
                      <td className="py-2 text-ink">{weiToEth(t.quoteAmount, 4)}</td>
                      <td className="py-2 text-ink-2">{formatTokenAmount(t.tokenAmount)}</td>
                      <td className="py-2 text-ink-3">
                        <a href={explorer.tx(t.transactionHash)} target="_blank" rel="noreferrer" className="hover:text-ink">
                          {shortAddress(t.account)}
                        </a>
                      </td>
                      <td className="py-2 text-right text-ink-3">{formatDateTime(t.timestamp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Locks ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        <div className="glass p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="display text-[22px] text-ink">Fee lock</h2>
            <span className={PILL_CLASS[phase]}>{FEE_PHASE_LABEL[phase]}</span>
          </div>
          <p className="mt-2 text-sm text-ink-3">
            {phase === "locked" && `Locked until graduation. Graduate within ${countdown(fees.deadline, now)} — by ${formatUtc(fees.deadline)} — or the lock can be buried.`}
            {phase === "checkpoint" && "The curve has graduated. Record it on the lock to start the 30-day unlock; anyone can."}
            {phase === "unlocking" && `Graduation recorded ${formatUtc(fees.graduatedAt)}. Fully unlocked in ${countdown(fees.vestEnd, now)}.`}
            {phase === "open" && "Vest complete. Every release pays out whatever has arrived, 90% to the creator, 10% to the pad."}
            {phase === "buriable" && `The deadline (${formatUtc(fees.deadline)}) passed without graduation. Anyone can bury the lock.`}
            {phase === "buried" && `Buried. ${weiToEth(fees.totalBuried, 5)} ETH spent buying back, ${formatTokenAmount(fees.tokensBurned)} tokens burned. Nobody is paid.`}
          </p>

          <dl className="mt-5 grid grid-cols-3 gap-3">
            <Figure label="On the curve" value={`${weiToEth(market.accruingWei, 5)}`} note="creator share, unswept" />
            <Figure label="In escrow" value={`${weiToEth(fees.pending, 5)}`} note="swept by Pons, not pulled" />
            <Figure label="Held by lock" value={`${weiToEth(fees.balance, 5)}`} note={`${weiToEth(fees.locked, 5)} locked`} tone={phase === "buried" ? "ash" : "amber"} />
          </dl>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Small label="Received" value={weiToEth(fees.totalReceived, 5)} />
            <Small label="Released" value={weiToEth(fees.totalReleased, 5)} />
            <Small label="Releasable" value={weiToEth(fees.releasable, 5)} />
            <Small label="Buried" value={weiToEth(fees.totalBuried, 5)} />
          </dl>

          <div className="mt-5 flex flex-wrap gap-2">
            {phase === "checkpoint" ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={!onChain || isPending} onClick={() => call(feeLock, feeLockAbi, "checkpoint", "Checkpoint")}>
                Record graduation
              </button>
            ) : null}
            {phase === "unlocking" || phase === "open" ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={!onChain || isPending || !releaseReady} onClick={() => call(feeLock, feeLockAbi, "release", "Release")}>
                Release {releaseReady ? "" : "· nothing unlocked"}
              </button>
            ) : null}
            {canBury ? (
              <button type="button" className="btn btn-glass btn-sm" disabled={!onChain || isPending || !buryReady} onClick={() => call(feeLock, feeLockAbi, "bury", "Bury")}>
                {buryReady ? `Bury ${weiToEth(fees.buryable, 5)} ETH` : fees.nextBuryAt > now ? `Next slice in ${countdown(fees.nextBuryAt, now)}` : "Nothing to bury"}
              </button>
            ) : null}
            {!onChain ? <span className="self-center text-xs text-ink-3">Connect on Robinhood Chain to call the lock. Anyone can.</span> : null}
          </div>
        </div>

        <div className="glass p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="display text-[22px] text-ink">Developer buy</h2>
            {locks.hasVesting ? <span className={vest === "done" ? "pill pill-released" : "pill pill-locked"}>{vest === "done" ? "Fully unlocked" : "Vesting"}</span> : <span className="pill pill-buried">None</span>}
          </div>
          {locks.hasVesting ? (
            <>
              <div className="mt-5 flex items-center gap-5">
                <Dial value={devLockedFrac} size={96} stroke={7} tone={vest === "done" ? "ink" : "amber"} label={`${Math.round(devLockedFrac * 100)}% still locked`}>
                  <div className="text-center">
                    <p className={`mono text-lg ${vest === "done" ? "text-ink" : "text-amber"}`}>{Math.round(devLockedFrac * 100)}%</p>
                    <p className="label text-[9px]">locked</p>
                  </div>
                </Dial>
                <div className="min-w-0 flex-1 text-sm">
                  <p className="text-ink">
                    {weiToEth(launch.developerBuy, 4)} ETH bought at launch → <span className="mono">{formatTokenAmount(locks.devAllocation)}</span> tokens
                  </p>
                  <p className="mt-1 text-ink-3">
                    Linear over {formatSpan(launch.vestDuration)} · {vest === "done" ? `ended ${formatUtc(locks.vestEnd)}` : `${countdown(locks.vestEnd, now)} to go`}
                  </p>
                  <p className="mt-1 text-ink-3">
                    Released {Math.round(ratio(locks.devReleased, locks.devAllocation) * 100)}% · releasable now <span className="mono">{formatTokenAmount(locks.devReleasable)}</span>
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <button type="button" className="btn btn-glass btn-sm" disabled={!onChain || isPending || BigInt(locks.devReleasable) === 0n} onClick={() => call(vesting, vestingAbi, "release", "Vesting release")}>
                  Release to creator
                </button>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-3">The creator bought nothing at launch. Their wallet started with zero tokens and no snipe-tax exemption.</p>
          )}
        </div>

        {status ? <p className="mono break-all text-xs text-ink-3">{status}</p> : null}

        <div className="panel p-5">
          <p className="label">Contracts</p>
          <dl className="mono mt-3 space-y-2 text-xs">
            <Addr k="Token" v={launch.token} />
            <Addr k="Curve" v={launch.curve} />
            <Addr k="Fee lock" v={launch.feeLock} />
            {launch.vesting !== ZERO ? <Addr k="Vesting" v={launch.vesting} /> : null}
            <Addr k="Creator" v={launch.creator} />
          </dl>
          <p className="mt-3 text-[11px] text-ink-4">Read at {formatDateTime(summary.readAt)} · refreshes every 15 s</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel px-4 py-3">
      <dt className="label">{label}</dt>
      <dd className="mono mt-1.5 truncate text-[15px] text-ink">{value}</dd>
    </div>
  );
}

function Figure({ label, value, note, tone = "ink" }: { label: string; value: string; note: string; tone?: "ink" | "amber" | "ash" }) {
  const color = tone === "amber" ? "locked-value" : tone === "ash" ? "text-ash" : "text-ink";
  return (
    <div className="panel px-3 py-3">
      <dt className="label">{label}</dt>
      <dd className={`mono mt-1.5 text-[15px] ${color}`}>{value} ETH</dd>
      <dd className="mt-0.5 text-[11px] text-ink-4">{note}</dd>
    </div>
  );
}

function Small({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="label text-[10px]">{label}</dt>
      <dd className="mono mt-1 text-sm text-ink-2">{value} ETH</dd>
    </div>
  );
}

function Addr({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-3">{k}</dt>
      <dd className="flex items-center gap-1 text-ink-2">
        <a href={explorer.address(v)} target="_blank" rel="noreferrer" className="hover:text-ink">
          {shortAddress(v, 6)}
        </a>
        <CopyButton value={v} variant="icon" />
      </dd>
    </div>
  );
}
