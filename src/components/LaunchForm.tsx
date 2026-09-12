/* eslint-disable @next/next/no-img-element */
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { decodeEventLog, formatEther, parseEther, toHex } from "viem";
import { useAccount, useBalance, useReadContract, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { site, percent } from "@/lib/site";
import { ROUTER_ADDRESS, routerAbi } from "@/lib/contracts";
import { explorer, robinhoodChain } from "@/lib/chain";
import { previewRule, trimEth } from "@/lib/lockmath";
import { useNow } from "@/lib/useNow";
import { ConnectButton, useMounted } from "@/components/ConnectButton";
import { TokenLogo } from "@/components/TokenLogo";
import { PadlockMark } from "@/components/PadlockMark";

const LINK_RE = /(https?:\/\/|www\.|t\.me\/|\.(com|io|xyz|fun|app|org|net)\b)/i;
const DAY = 86_400;

type Fields = {
  name: string;
  ticker: string;
  description: string;
  imageUrl: string;
  x: string;
  telegram: string;
  website: string;
  devBuy: string;
  vestDays: string;
  windowDays: string;
  creatorTaxBps: string;
};

const EMPTY: Fields = {
  name: "",
  ticker: "",
  description: "",
  imageUrl: "",
  x: "",
  telegram: "",
  website: "",
  devBuy: "",
  vestDays: String(site.vestDays.default),
  windowDays: String(site.windowDays.default),
  creatorTaxBps: "0",
};

function validate(f: Fields) {
  const errors: Partial<Record<keyof Fields, string>> = {};
  if (!f.name.trim()) errors.name = "Required";
  else if (f.name.length > 32) errors.name = "32 characters max";
  if (!f.ticker.trim()) errors.ticker = "Required";
  else if (!/^[A-Z0-9]{1,10}$/.test(f.ticker)) errors.ticker = "A–Z and 0–9 only";
  if (f.description.length > 256) errors.description = "256 characters max";
  else if (LINK_RE.test(f.description)) errors.description = "No links in the description";
  if (f.imageUrl.trim() && !/^https:\/\/\S+$/.test(f.imageUrl.trim())) errors.imageUrl = "An https:// URL";
  else if (f.imageUrl.length > 256) errors.imageUrl = "256 characters max";
  if (f.devBuy.trim() && !/^\d*\.?\d*$/.test(f.devBuy)) errors.devBuy = "Decimal ETH amount";
  const dev = Number.parseFloat(f.devBuy || "0");
  const vest = Number.parseInt(f.vestDays || "0", 10);
  if (dev > 0 && (!Number.isFinite(vest) || vest < site.vestDays.min || vest > site.vestDays.max)) {
    errors.vestDays = `${site.vestDays.min} to ${site.vestDays.max} days`;
  }
  const win = Number.parseInt(f.windowDays || "0", 10);
  if (!Number.isFinite(win) || win < site.windowDays.min || win > site.windowDays.max) {
    errors.windowDays = `${site.windowDays.min} to ${site.windowDays.max} days`;
  }
  const bps = Number.parseInt(f.creatorTaxBps || "0", 10);
  if (!Number.isFinite(bps) || bps < 0 || bps > 1000) errors.creatorTaxBps = "0 to 1000 bps";
  return errors;
}

function randomSalt(): `0x${string}` {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

function normalizeUrl(value: string, host: string): string {
  const v = value.trim();
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (v.startsWith("@")) return `https://${host}/${v.slice(1)}`;
  return `https://${v.replace(/^\/+/, "")}`;
}

type Submitted = { hash: `0x${string}` };

export function LaunchForm() {
  const [f, setF] = useState<Fields>(EMPTY);
  const [advanced, setAdvanced] = useState(false);
  const [customVest, setCustomVest] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  // Errors only show on fields the creator has touched (or all of them once
  // they tried to submit); the interlocks panel reads the full validation.
  const [touched, setTouched] = useState<Partial<Record<keyof Fields, boolean>>>({});
  // Whether this pad can pin images (a key on the server). Without it the
  // form still takes an image URL; nothing about launching needs a file.
  const [uploads, setUploads] = useState<boolean | null>(null);
  const mounted = useMounted();

  useEffect(() => {
    let alive = true;
    fetch("/api/upload")
      .then((r) => r.json() as Promise<{ enabled: boolean }>)
      .then((j) => alive && setUploads(Boolean(j.enabled)))
      .catch(() => alive && setUploads(false));
    return () => {
      alive = false;
    };
  }, []);

  // One object URL per picked file; revoked when the file changes or the
  // form unmounts.
  const filePreview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => {
    if (!filePreview) return;
    return () => URL.revokeObjectURL(filePreview);
  }, [filePreview]);
  const preview = filePreview ?? (/^https:\/\/\S+$/.test(f.imageUrl.trim()) ? f.imageUrl.trim() : null);

  const { address, isConnected, chainId } = useAccount();
  const { data: balance } = useBalance({ address, chainId: robinhoodChain.id });
  const routerLive = ROUTER_ADDRESS !== null;
  const { data: feeWei } = useReadContract({
    address: ROUTER_ADDRESS ?? undefined,
    abi: routerAbi,
    functionName: "totalLaunchFee",
    chainId: robinhoodChain.id,
    query: { enabled: routerLive, refetchInterval: 30_000 },
  });
  const { data: gateOpen } = useReadContract({
    address: ROUTER_ADDRESS ?? undefined,
    abi: routerAbi,
    functionName: "canLaunchHere",
    chainId: robinhoodChain.id,
    query: { enabled: routerLive, refetchInterval: 30_000 },
  });
  const { writeContractAsync, isPending } = useWriteContract();
  const { data: receipt } = useWaitForTransactionReceipt({ hash: submitted?.hash, chainId: robinhoodChain.id });

  const launchedToken = useMemo(() => {
    if (!receipt) return null;
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({ abi: routerAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Launched") return (ev.args as unknown as { token: `0x${string}` }).token;
      } catch {
        /* not ours */
      }
    }
    return null;
  }, [receipt]);

  const errors = useMemo(() => validate(f), [f]);
  const valid = Object.keys(errors).length === 0;
  const shown = (k: keyof Fields) => (touched[k] ? errors[k] : undefined);
  const onChain = isConnected && chainId === robinhoodChain.id;
  const fee = typeof feeWei === "bigint" ? feeWei : parseEther(site.launchFeeEth);
  const feeEth = trimEth(formatEther(fee));
  const devBuyWei = (() => {
    try {
      return parseEther(f.devBuy.trim() || "0");
    } catch {
      return 0n;
    }
  })();

  // Interlocks: every condition the button needs, each with the reason it
  // is open. The button reads this list; it cannot disagree with it.
  const interlocks = [
    { key: "router", label: "Router deployed", ok: routerLive, note: routerLive ? "reads and writes go to the chain" : "awaiting deployment" },
    { key: "gate", label: "Pons accepts launches", ok: gateOpen === true, note: gateOpen === undefined ? "reading the factory" : gateOpen ? "launchEnabled and canLaunch" : "closed on Pons' side" },
    { key: "wallet", label: "Wallet connected", ok: mounted && isConnected, note: mounted && isConnected ? "injected wallet" : "connect to sign" },
    { key: "chain", label: "On Robinhood Chain", ok: onChain, note: onChain ? `chain id ${robinhoodChain.id}` : "switch network" },
    { key: "fields", label: "Fields valid", ok: valid, note: valid ? "name, ticker, schedule" : Object.values(errors)[0] ?? "" },
    {
      key: "funds",
      label: "Balance covers it",
      ok: balance ? balance.value >= fee + devBuyWei : false,
      note: balance ? `${trimEth(formatEther(balance.value), 4)} ETH available` : "no balance read",
    },
  ] as const;
  const canSubmit = interlocks.every((i) => i.ok) && !isPending;

  const now = useNow();
  const rule = previewRule({
    devBuyEth: f.devBuy,
    vestDays: Number.parseInt(f.vestDays || "0", 10) || site.vestDays.default,
    windowDays: Number.parseInt(f.windowDays || "0", 10) || site.windowDays.default,
    feeVestDays: site.feeVestDays,
    launchAt: now,
    padSharePct: site.padShareBps / 100,
  });

  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setTouched((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
    setF((prev) => ({ ...prev, [k]: k === "ticker" ? e.target.value.toUpperCase() : e.target.value }));
  };

  const setMax = () => {
    if (!balance) return;
    // Leave the launch fee plus a little gas behind.
    const spare = balance.value - fee - parseEther("0.0005");
    setF((prev) => ({ ...prev, devBuy: spare > 0n ? trimEth(formatEther(spare), 4) : "0" }));
  };

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched({ name: true, ticker: true, description: true, imageUrl: true, devBuy: true, vestDays: true, windowDays: true, creatorTaxBps: true });
    if (!canSubmit || !ROUTER_ADDRESS) return;
    setStatus(null);
    try {
      let logo = f.imageUrl.trim();
      if (file && uploads) {
        const body = new FormData();
        body.append("file", file);
        const up = await fetch("/api/upload", { method: "POST", body });
        const json = (await up.json().catch(() => ({}))) as { uri?: string; error?: string };
        if (!up.ok || !json.uri) throw new Error(json.error ?? "Image upload failed. Remove the image or try again.");
        logo = json.uri;
      }
      const hash = await writeContractAsync({
        address: ROUTER_ADDRESS,
        abi: routerAbi,
        functionName: "launch",
        args: [
          {
            name: f.name.trim(),
            symbol: f.ticker.trim(),
            logo,
            description: f.description.trim(),
            x: normalizeUrl(f.x, "x.com"),
            telegram: normalizeUrl(f.telegram, "t.me"),
            website: normalizeUrl(f.website, ""),
            creatorTaxBps: Number.parseInt(f.creatorTaxBps || "0", 10),
            salt: randomSalt(),
            developerBuy: devBuyWei,
            minTokensOut: 0n,
            vestDuration: BigInt((Number.parseInt(f.vestDays || "0", 10) || site.vestDays.default) * DAY),
            graduationWindow: BigInt((Number.parseInt(f.windowDays || "0", 10) || site.windowDays.default) * DAY),
          },
        ],
        value: fee + devBuyWei,
        chainId: robinhoodChain.id,
      });
      setSubmitted({ hash });
    } catch (err) {
      setStatus(err instanceof Error ? err.message.split("\n")[0] : "Launch failed");
    }
  }

  const vestPreset = site.vestDays.options.some((d) => String(d) === f.vestDays) && !customVest;

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-6 lg:grid-cols-[1fr_380px]">
      <form className="glass p-6 sm:p-8" noValidate onSubmit={onSubmit}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="display text-[32px] text-ink sm:text-[40px]">Launch a token</h1>
            <p className="mt-1 text-sm text-ink-3">
              Via {site.name} → {site.venue} · creator fees {percent.creator} you / {percent.pad} pad, once unlocked
            </p>
          </div>
          <ConnectButton />
        </div>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Field label="Name" error={shown("name")}>
            <input className="field" maxLength={32} placeholder="Token name" value={f.name} onChange={set("name")} aria-invalid={Boolean(shown("name"))} />
          </Field>
          <Field label="Ticker" error={shown("ticker")}>
            <input className="field uppercase" maxLength={10} placeholder="SYMBOL" value={f.ticker} onChange={set("ticker")} aria-invalid={Boolean(shown("ticker"))} />
          </Field>
        </div>

        <Field label="Description" error={shown("description")} className="mt-4" hint={`${f.description.length}/256`}>
          <textarea className="field min-h-[96px] resize-y" maxLength={256} placeholder="Short description (no links)" value={f.description} onChange={set("description")} aria-invalid={Boolean(shown("description"))} />
        </Field>

        <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_1fr]">
          <div>
            <span className="label mb-2 block">Token image</span>
            {uploads ? (
              <label className="flex cursor-pointer items-center gap-4 rounded-[14px] border border-dashed border-edge-2 bg-black/20 px-4 py-4 transition-colors hover:border-amber hover:bg-black/30">
                {preview ? <img src={preview} alt="" className="h-14 w-14 rounded-xl object-cover" /> : <TokenLogo logo={null} symbol={f.ticker || "?"} size={56} />}
                <span className="text-sm text-ink-3">{file ? file.name : "Click to upload · pinned to IPFS"}</span>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </label>
            ) : (
              <div className="flex items-center gap-4 rounded-[14px] border border-edge bg-black/20 px-4 py-4">
                {preview ? <img src={preview} alt="" className="h-14 w-14 rounded-xl object-cover" onError={() => setTouched((t) => ({ ...t, imageUrl: true }))} /> : <TokenLogo logo={null} symbol={f.ticker || "?"} size={56} />}
                <span className="text-sm text-ink-3">{uploads === null ? "Checking uploads…" : "Paste an https:// image URL below. Optional."}</span>
              </div>
            )}
            <Field label={uploads ? "Or an image URL" : "Image URL"} error={shown("imageUrl")} className="mt-3" hint="https, optional">
              <input className="field" placeholder="https://…/token.png" value={f.imageUrl} onChange={set("imageUrl")} aria-invalid={Boolean(shown("imageUrl"))} />
            </Field>
          </div>
          <div className="grid gap-4">
            <Field label="X profile">
              <input className="field" placeholder="x.com/handle" value={f.x} onChange={set("x")} />
            </Field>
            <Field label="Telegram">
              <input className="field" placeholder="t.me/community" value={f.telegram} onChange={set("telegram")} />
            </Field>
          </div>
        </div>

        <div className="hairline my-8" />

        <div className="flex items-center gap-3">
          <PadlockMark className="h-6 w-6" />
          <h2 className="display text-[22px] text-ink">The locks</h2>
        </div>

        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Developer buy (ETH)" error={shown("devBuy")} hint="delivered to the vesting contract">
            <div className="flex gap-2">
              <input className="field" inputMode="decimal" placeholder="0.00" value={f.devBuy} onChange={set("devBuy")} aria-invalid={Boolean(shown("devBuy"))} />
              <button type="button" className="btn btn-glass btn-sm shrink-0" onClick={setMax} disabled={!balance}>
                Max
              </button>
            </div>
          </Field>
          <Field label="Vesting" error={shown("vestDays")} hint={`${site.vestDays.min}–${site.vestDays.max} days, linear`}>
            <div className="seg" role="radiogroup" aria-label="Developer buy vesting">
              {site.vestDays.options.map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={vestPreset && String(d) === f.vestDays}
                  className="seg-opt"
                  onClick={() => {
                    setCustomVest(false);
                    setF((p) => ({ ...p, vestDays: String(d) }));
                  }}
                >
                  {d}d
                </button>
              ))}
              <button type="button" role="radio" aria-checked={!vestPreset} className="seg-opt" onClick={() => setCustomVest(true)}>
                Custom
              </button>
            </div>
            {!vestPreset ? (
              <input className="field mt-2" inputMode="numeric" placeholder="days" value={f.vestDays} onChange={set("vestDays")} aria-invalid={Boolean(shown("vestDays"))} />
            ) : null}
          </Field>
        </div>

        <Field label="Graduation deadline" error={shown("windowDays")} className="mt-5" hint="miss it and anyone can bury the fee lock">
          <div className="seg" role="radiogroup" aria-label="Graduation deadline">
            {site.windowDays.options.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={String(d) === f.windowDays} className="seg-opt" onClick={() => setF((p) => ({ ...p, windowDays: String(d) }))}>
                {d} days
              </button>
            ))}
          </div>
        </Field>

        <button
          type="button"
          onClick={() => setAdvanced((v) => !v)}
          aria-expanded={advanced}
          className="mt-6 flex w-full items-center justify-between rounded-[14px] border border-edge bg-black/20 px-4 py-3 text-sm text-ink-2"
        >
          Advanced
          <span className="mono" aria-hidden="true">
            {advanced ? "−" : "+"}
          </span>
        </button>
        {advanced ? (
          <div className="mt-2 grid gap-4 rounded-[14px] border border-edge bg-black/20 p-4 sm:grid-cols-2">
            <Field label="Website">
              <input className="field" placeholder="yourtoken.fun" value={f.website} onChange={set("website")} />
            </Field>
            <Field label="Creator tax (bps)" error={shown("creatorTaxBps")} hint={`0–1000 · on top of the ${site.tradeFeePct} trade fee · goes to the fee lock too`}>
              <input className="field" inputMode="numeric" placeholder="0" value={f.creatorTaxBps} onChange={set("creatorTaxBps")} aria-invalid={Boolean(shown("creatorTaxBps"))} />
            </Field>
          </div>
        ) : null}

        <div className="hairline my-8" />

        <div className="rounded-[18px] border border-amber/30 bg-amber-soft p-5">
          <p className="label text-amber">Read it back</p>
          <ul className="mt-3 space-y-3">
            {rule.map((l) => (
              <li key={l.key} className="flex gap-3 text-[14px] leading-relaxed text-ink">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber" aria-hidden="true" />
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-ink-3">Dates assume the transaction confirms now. Everything above is enforced by contracts with no owner; nothing can be edited after launch.</p>
        </div>

        {submitted ? (
          <div className="mt-6 rounded-[18px] border border-edge-2 bg-glass-2 p-5">
            <p className="display text-[20px] text-ink">{launchedToken ? "Launched." : "Submitted — waiting for the chain."}</p>
            <p className="mono mt-2 break-all text-xs text-ink-3">
              <a href={explorer.tx(submitted.hash)} target="_blank" rel="noreferrer" className="hover:text-ink">
                {submitted.hash}
              </a>
            </p>
            {launchedToken ? (
              <Link href={`/token/${launchedToken}`} className="btn btn-primary mt-4">
                View the locks
              </Link>
            ) : null}
          </div>
        ) : (
          <button type="submit" className="btn btn-primary mt-6 w-full py-4 text-base" disabled={!canSubmit}>
            {isPending ? "Confirm in wallet…" : `Launch · ${feeEth} ETH${devBuyWei > 0n ? ` + ${trimEth(f.devBuy)} ETH dev buy` : ""}`}
          </button>
        )}
        {status ? <p className="mt-3 break-words text-center text-xs text-down">{status}</p> : null}
      </form>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-24 lg:self-start">
        <div className="glass p-5">
          <div className="flex items-center gap-3">
            {preview ? <img src={preview} alt="" className="h-12 w-12 rounded-xl object-cover" /> : <TokenLogo logo={null} symbol={f.ticker || "?"} size={48} />}
            <div className="min-w-0">
              <p className="display truncate text-[18px] text-ink">{f.name.trim() || "Your token"}</p>
              <p className="mono truncate text-xs text-ink-3">{f.ticker ? `$${f.ticker}` : "ticker"}</p>
            </div>
          </div>
          <dl className="mt-5 space-y-2.5 text-sm">
            <Row k="Launch fee">
              <span className="mono">{feeEth} ETH</span>
            </Row>
            <Row k="Developer buy">
              <span className="mono locked-value">{devBuyWei > 0n ? `${trimEth(f.devBuy)} ETH` : "none"}</span>
            </Row>
            <Row k="Dev vesting">
              <span className="mono">{devBuyWei > 0n ? `${f.vestDays || "—"} days` : "—"}</span>
            </Row>
            <Row k="Graduate within">
              <span className="mono">{f.windowDays} days</span>
            </Row>
            <Row k="Fee vest">
              <span className="mono">{site.feeVestDays} days</span>
            </Row>
            <Row k="Paired with">ETH</Row>
            <Row k="Graduation">{site.graduationEth} ETH</Row>
          </dl>
        </div>

        <div className="glass p-5">
          <p className="label">Interlocks</p>
          <ul className="mt-3 space-y-2.5">
            {interlocks.map((i) => (
              <li key={i.key} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.ok ? "bg-amber shadow-[0_0_8px_var(--amber)]" : "border border-edge-2"}`} aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-ink">{i.label}</span>
                    <span className="mono text-[10px] uppercase tracking-[0.12em] text-ink-3">{i.ok ? "closed" : "open"}</span>
                  </div>
                  <p className="truncate text-xs text-ink-3">{i.note}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Field({ label, error, hint, className = "", children }: { label: string; error?: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-2 flex items-baseline justify-between gap-3">
        <span className="label">{label}</span>
        {error ? <span className="mono text-[11px] text-down">{error}</span> : hint ? <span className="text-[11px] text-ink-4">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}
