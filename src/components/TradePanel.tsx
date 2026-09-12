"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useBalance, useReadContracts, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { ConnectButton, useMounted } from "@/components/ConnectButton";
import { explorer, ponsTradeUrl, robinhoodChain } from "@/lib/chain";
import { curveAbi, erc20Abi } from "@/lib/ponsAbi";
import { BPS, formatUnitsTrim, parseDecimal, priceImpactBps, quoteBuy, quoteSell, sellImpactBps, withSlippage } from "@/lib/curvemath";
import { shortAddress } from "@/lib/format";

const SLIPPAGE_OPTIONS = [50n, 100n, 300n] as const;
const ZERO = "0x0000000000000000000000000000000000000000" as const;

type Side = "buy" | "sell";

/**
 * Buy and sell on the token's own Pons curve, from this page. Quotes are
 * the curve's constant product computed locally from its reserves (checked
 * to the wei against a real launch); the trade itself is a direct call to
 * the curve — the pad is not in the path and takes nothing from it. The
 * 1% trade fee is Pons', and 70% of it lands in this token's fee lock.
 */
export function TradePanel({ token, curve, symbol, graduated }: { token: `0x${string}`; curve: `0x${string}`; symbol: string; graduated: boolean }) {
  const [side, setSide] = useState<Side>("buy");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<bigint>(100n);
  const [note, setNote] = useState<{ kind: "info" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState<`0x${string}` | undefined>();
  const mounted = useMounted();

  const { address, isConnected, chainId } = useAccount();
  const onChain = isConnected && chainId === robinhoodChain.id;
  const account = address ?? ZERO;

  const { data: eth, refetch: refetchEth } = useBalance({ address, chainId: robinhoodChain.id, query: { enabled: Boolean(address) } });
  const { data: reads, refetch } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address: curve, abi: curveAbi, functionName: "getReserves", chainId: robinhoodChain.id },
      { address: curve, abi: curveAbi, functionName: "feeBps", chainId: robinhoodChain.id },
      { address: curve, abi: curveAbi, functionName: "creatorTaxBps", chainId: robinhoodChain.id },
      { address: curve, abi: curveAbi, functionName: "currentSnipeTaxBps", args: [account], chainId: robinhoodChain.id },
      { address: token, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId: robinhoodChain.id },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [account, curve], chainId: robinhoodChain.id },
    ],
    query: { refetchInterval: 8_000 },
  });

  const reserves = reads?.[0]?.status === "success" ? (reads[0].result as readonly [bigint, bigint]) : null;
  const feeBps = reads?.[1]?.status === "success" ? (reads[1].result as bigint) : 100n;
  const creatorTax = reads?.[2]?.status === "success" ? (reads[2].result as bigint) : 0n;
  const snipeTax = reads?.[3]?.status === "success" ? (reads[3].result as bigint) : 0n;
  const tokenBalance = reads?.[4]?.status === "success" ? (reads[4].result as bigint) : 0n;
  const allowance = reads?.[5]?.status === "success" ? (reads[5].result as bigint) : 0n;

  const { writeContractAsync, isPending } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: pending, chainId: robinhoodChain.id });
  // The receipt is keyed by the pending hash, so "in flight" is derived —
  // nothing to set when it lands, only balances to re-read.
  const inFlight = Boolean(pending) && !receipt;
  useEffect(() => {
    if (!receipt) return;
    refetch();
    refetchEth();
  }, [receipt, refetch, refetchEth]);
  const status = receipt
    ? {
        kind: receipt.status === "success" ? ("info" as const) : ("error" as const),
        text: receipt.status === "success" ? `Confirmed · ${shortAddress(receipt.transactionHash, 8)}` : "The transaction reverted.",
      }
    : note;

  const amountIn = useMemo(() => parseDecimal(amount), [amount]);

  const quote = useMemo(() => {
    if (!reserves || !amountIn || amountIn <= 0n) return null;
    const [q, t] = reserves;
    if (side === "buy") {
      const out = quoteBuy(q, t, amountIn, feeBps, creatorTax + snipeTax);
      const net = amountIn - (amountIn * (feeBps + creatorTax + snipeTax)) / BPS;
      return { out, impact: priceImpactBps(q, t, net, out), min: withSlippage(out, slippage) };
    }
    const out = quoteSell(q, t, amountIn, feeBps, creatorTax);
    return { out, impact: sellImpactBps(q, t, amountIn), min: withSlippage(out, slippage) };
  }, [reserves, amountIn, side, feeBps, creatorTax, snipeTax, slippage]);

  const needsApproval = side === "sell" && amountIn !== null && amountIn > 0n && allowance < amountIn;
  const insufficient = side === "buy" ? Boolean(eth && amountIn && amountIn > eth.value) : Boolean(amountIn && amountIn > tokenBalance);
  // A big trade is allowed — the curve accepts any size — but flagged.
  const heavy = quote !== null && quote.impact > 1_000n;
  const canTrade = mounted && onChain && amountIn !== null && amountIn > 0n && quote !== null && quote.out > 0n && !insufficient && !isPending && !inFlight;

  async function submit() {
    if (!address || !amountIn || !quote) return;
    setNote(null);
    try {
      if (side === "buy") {
        const hash = await writeContractAsync({ address: curve, abi: curveAbi, functionName: "buy", args: [amountIn, quote.min, address], value: amountIn, chainId: robinhoodChain.id });
        setPending(hash);
        setNote({ kind: "info", text: `Buy submitted · ${shortAddress(hash, 8)}` });
      } else if (needsApproval) {
        const hash = await writeContractAsync({ address: token, abi: erc20Abi, functionName: "approve", args: [curve, amountIn], chainId: robinhoodChain.id });
        setPending(hash);
        setNote({ kind: "info", text: `Approval submitted · ${shortAddress(hash, 8)} — then sell.` });
      } else {
        const hash = await writeContractAsync({ address: curve, abi: curveAbi, functionName: "sell", args: [amountIn, quote.min, address], chainId: robinhoodChain.id });
        setPending(hash);
        setNote({ kind: "info", text: `Sell submitted · ${shortAddress(hash, 8)}` });
      }
    } catch (err) {
      setNote({ kind: "error", text: err instanceof Error ? err.message.split("\n")[0] : "Transaction failed" });
    }
  }

  if (graduated) {
    return (
      <div className="glass p-6">
        <h2 className="display text-[22px] text-ink">Trade</h2>
        <p className="mt-2 text-sm text-ink-3">This token graduated: its market lives in the pool now, not on the curve this page reads.</p>
        <a href={ponsTradeUrl(token)} target="_blank" rel="noreferrer" className="btn btn-glass btn-sm mt-4">
          Trade on Pons ↗
        </a>
      </div>
    );
  }

  const balanceLine =
    side === "buy"
      ? eth
        ? `${formatUnitsTrim(eth.value, 18, 4)} ETH available`
        : "—"
      : `${formatUnitsTrim(tokenBalance, 18, 0)} ${symbol} in wallet`;

  return (
    <div className="glass p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="display text-[22px] text-ink">Trade on the curve</h2>
        <div className="seg !p-1" role="tablist" aria-label="Side">
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={side === s}
              className="seg-opt !px-4 !py-1.5"
              onClick={() => {
                setSide(s);
                setAmount("");
                setNote(null);
              }}
            >
              {s === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      </div>

      <label className="mt-5 block">
        <span className="mb-2 flex items-baseline justify-between">
          <span className="label">{side === "buy" ? "You pay (ETH)" : `You sell (${symbol})`}</span>
          <button
            type="button"
            className="text-[11px] text-ink-3 hover:text-ink"
            onClick={() => {
              if (side === "buy" && eth) {
                const spare = eth.value - 1_000_000_000_000_000n; // leave 0.001 for gas
                setAmount(spare > 0n ? formatUnitsTrim(spare, 18, 6) : "0");
              } else if (side === "sell") setAmount(formatUnitsTrim(tokenBalance, 18, 18));
            }}
          >
            {balanceLine} · max
          </button>
        </span>
        <input className="field mono text-lg" inputMode="decimal" placeholder="0.0" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={Boolean(amount && amountIn === null)} />
      </label>

      <dl className="mt-4 space-y-1.5 text-sm">
        <Row k={side === "buy" ? `You get (${symbol})` : "You get (ETH)"}>
          <span className="mono text-ink">{quote ? formatUnitsTrim(quote.out, 18, side === "buy" ? 0 : 6) : "—"}</span>
        </Row>
        <Row k="Minimum after slippage">
          <span className="mono text-ink-2">{quote ? formatUnitsTrim(quote.min, 18, side === "buy" ? 0 : 6) : "—"}</span>
        </Row>
        <Row k="Price impact">
          <span className={`mono ${heavy ? "text-amber" : "text-ink-2"}`}>{quote ? `${(Number(quote.impact) / 100).toFixed(2)}%${heavy ? " · large" : ""}` : "—"}</span>
        </Row>
        <Row k="Fees">
          <span className="mono text-ink-2">
            {(Number(feeBps + creatorTax) / 100).toFixed(2)}%{side === "buy" && snipeTax > 0n ? ` + ${(Number(snipeTax) / 100).toFixed(2)}% snipe tax` : ""}
          </span>
        </Row>
      </dl>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="label">Slippage</span>
        <div className="seg !p-1" role="radiogroup" aria-label="Slippage tolerance">
          {SLIPPAGE_OPTIONS.map((s) => (
            <button key={String(s)} type="button" role="radio" aria-checked={slippage === s} className="seg-opt !px-3 !py-1" onClick={() => setSlippage(s)}>
              {(Number(s) / 100).toFixed(1)}%
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        {!mounted || !isConnected || !onChain ? (
          <ConnectButton size="md" />
        ) : (
          <button type="button" className={`btn w-full py-3.5 ${side === "buy" ? "btn-primary" : "btn-glass"}`} disabled={!canTrade} onClick={submit}>
            {isPending
              ? "Confirm in wallet…"
              : inFlight
                ? "Waiting for the chain…"
                : insufficient
                  ? side === "buy"
                    ? "Not enough ETH"
                    : `Not enough ${symbol}`
                  : side === "buy"
                      ? `Buy ${symbol}`
                      : needsApproval
                        ? `Approve ${symbol}`
                        : `Sell ${symbol}`}
          </button>
        )}
      </div>

      {status ? (
        <p className={`mt-3 break-words text-xs ${status.kind === "error" ? "text-down" : "text-ink-3"}`}>
          {status.text}
          {pending && inFlight ? (
            <>
              {" · "}
              <a href={explorer.tx(pending)} target="_blank" rel="noreferrer" className="underline hover:text-ink">
                explorer
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="mt-3 text-[11px] text-ink-4">
        A direct call to the token&apos;s Pons curve — the pad is not in the path. Snipe tax applies to non-exempt buys in the first minutes after launch;{" "}
        <a href={ponsTradeUrl(token)} target="_blank" rel="noreferrer" className="underline hover:text-ink">
          the same market on Pons ↗
        </a>
        .
      </p>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
