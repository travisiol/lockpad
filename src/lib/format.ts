/** `0xe06c…d0e7` — four hex chars each side, like the reference cards. */
export function shortAddress(address: string, chars = 4): string {
  if (!address || address.length < 2 + chars * 2) return address;
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

/** `$4.2k`, `$7.1k`, `$1.2m`, `$980`. */
export function formatUsdCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}b`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}m`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}k`;
  return `$${value.toFixed(abs < 10 ? 2 : 0)}`;
}

/** `$4.2e-6` for sub-cent prices, `$0.42` otherwise. */
export function formatPriceUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "$0";
  if (value < 0.001) {
    const exp = Math.floor(Math.log10(value));
    const mantissa = value / 10 ** exp;
    return `$${mantissa.toFixed(mantissa >= 9.95 ? 0 : 1)}e${exp}`;
  }
  return `$${value.toFixed(value < 1 ? 4 : 2)}`;
}

export function formatEth(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(digits)} ETH`;
}

/** An ETH amount that may be tiny (a per-token price) or large (a market cap). */
export function formatEthAuto(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value === 0) return "0 ETH";
  if (value < 0.001) return `${value.toExponential(1)} ETH`;
  if (value < 1) return `${value.toFixed(4)} ETH`;
  return `${value.toFixed(2)} ETH`;
}

/** USD when a quote is available, otherwise the ETH figure. */
export function formatCap(usd: number | null | undefined, eth: number): string {
  return usd == null ? formatEthAuto(eth) : formatUsdCompact(usd);
}

export function formatPrice(usd: number | null | undefined, eth: number): string {
  return usd == null ? formatEthAuto(eth) : formatPriceUsd(usd);
}

/** Wei → ETH string with `digits` decimals (bigint-safe, no float in the middle). */
export function formatWei(wei: string | bigint, digits = 5): string {
  const v = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  const whole = v / 10n ** 18n;
  const frac = v % 10n ** 18n;
  const fracStr = frac.toString().padStart(18, "0").slice(0, digits);
  return digits > 0 ? `${whole}.${fracStr}` : whole.toString();
}

/** Full-precision wei → ETH, trailing zeros trimmed, like the creator-fees panel. */
export function formatWeiExact(wei: string | bigint): string {
  const v = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

/** Token amounts in the trades list: `20 395 755` — thin-space thousands, no decimals. */
export function formatTokenAmount(raw: string, decimals = 18): string {
  const v = BigInt(raw || "0") / 10n ** BigInt(decimals);
  return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** `0%`, `1%`, `5%`, `Done`. */
export function formatGraduation(pct: number, graduated: boolean): string {
  if (graduated) return "Done";
  return `${Math.floor(pct)}%`;
}

export function formatPct(value: number, digits = 2): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(digits)}%`;
}

/** `07/09/2026 17:24:55` — the reference prints dd/mm/yyyy. */
export function formatDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatClock(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function isAddress(value: string): value is `0x${string}` {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}
