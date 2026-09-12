/**
 * Pure schedule arithmetic for the two locks, shared by the token page, the
 * launch list and the rule preview on the launch form. No React, no chain —
 * `scripts/check-lockmath.mts` runs it in Node.
 *
 * Amounts are wei as decimal strings (they cross a JSON boundary); times
 * are unix seconds.
 */

export type FeeLockJson = {
  armed: boolean;
  /** Graduation as recorded on the lock … */
  graduated: boolean;
  /** … and as the curve reports it now. Differ → a checkpoint is due. */
  graduatedLive: boolean;
  graduatedAt: number;
  deadline: number;
  vestEnd: number;
  buried: boolean;
  buryable: string;
  nextBuryAt: number;
  pending: string;
  balance: string;
  releasable: string;
  locked: string;
  totalReceived: string;
  totalReleased: string;
  totalBuried: string;
  tokensBurned: string;
};

export type LockStatusJson = {
  fees: FeeLockJson;
  hasVesting: boolean;
  vestStart: number;
  vestEnd: number;
  devAllocation: string;
  devReleased: string;
  devReleasable: string;
  devLocked: string;
};

/**
 * What the fee lock is doing right now.
 *
 *   locked      before graduation, deadline ahead — fees pile up
 *   checkpoint  the curve says graduated, the lock has not recorded it yet
 *   unlocking   graduation recorded, inside the 30-day vest
 *   open        vest over — fees pass through on every release
 *   buriable    deadline passed, no graduation — anyone can bury
 *   buried      buried; whatever arrives is bought back and burned
 */
export type FeePhase = "locked" | "checkpoint" | "unlocking" | "open" | "buriable" | "buried";

export function feePhase(s: FeeLockJson, now: number): FeePhase {
  if (s.buried) return "buried";
  if (s.graduated) return now < s.vestEnd ? "unlocking" : "open";
  if (s.graduatedLive) return "checkpoint";
  if (now >= s.deadline) return "buriable";
  return "locked";
}

export const FEE_PHASE_LABEL: Record<FeePhase, string> = {
  locked: "Locked",
  checkpoint: "Graduated · checkpoint due",
  unlocking: "Unlocking",
  open: "Open",
  buriable: "Deadline passed · buriable",
  buried: "Buried",
};

/** 0 before `start`, 1 after `end`, linear between. */
export function fraction(now: number, start: number, end: number): number {
  if (end <= start) return now >= end ? 1 : 0;
  if (now <= start) return 0;
  if (now >= end) return 1;
  return (now - start) / (end - start);
}

/** What the dev vesting is doing right now. */
export type VestPhase = "none" | "vesting" | "done";

export function vestPhase(s: LockStatusJson, now: number): VestPhase {
  if (!s.hasVesting) return "none";
  return now >= s.vestEnd ? "done" : "vesting";
}

/** `12d 04h`, `3h 12m`, `45m`, `<1m`, `0`. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0";
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d > 0) return `${d}d ${h.toString().padStart(2, "0")}h`;
  if (h > 0) return `${h}h ${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

/** Time left until `to`, never negative. */
export function countdown(to: number, now: number): string {
  return formatDuration(to - now);
}

/** `90 days`, `1 day`, `12 hours`, `1 hour`. */
export function formatSpan(seconds: number): string {
  const d = Math.round(seconds / 86_400);
  if (d >= 1) return `${d} day${d === 1 ? "" : "s"}`;
  const h = Math.round(seconds / 3_600);
  return `${h} hour${h === 1 ? "" : "s"}`;
}

/** A wei string as ETH with `digits` decimals, no float in the middle. */
export function weiToEth(wei: string | bigint, digits = 4): string {
  const v = typeof wei === "bigint" ? wei : BigInt(wei || "0");
  const whole = v / 10n ** 18n;
  const frac = (v % 10n ** 18n).toString().padStart(18, "0").slice(0, digits);
  return digits > 0 ? `${whole}.${frac}` : whole.toString();
}

/** Ratio of two wei strings, 0 when the denominator is zero. */
export function ratio(part: string | bigint, whole: string | bigint): number {
  const p = typeof part === "bigint" ? part : BigInt(part || "0");
  const w = typeof whole === "bigint" ? whole : BigInt(whole || "0");
  if (w === 0n) return 0;
  // 1e6 of resolution is plenty for a dial.
  return Number((p * 1_000_000n) / w) / 1_000_000;
}

export type RuleInput = {
  /** ETH, as typed; empty or "0" means no developer buy. */
  devBuyEth: string;
  vestDays: number;
  windowDays: number;
  feeVestDays: number;
  /** Unix seconds the launch would happen at. */
  launchAt: number;
  padSharePct: number;
};

export type RuleLine = { key: string; text: string };

const DATE_FMT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
});

export function formatUtc(unix: number): string {
  return `${DATE_FMT.format(new Date(unix * 1000))} UTC`;
}

/**
 * The launch form's read-back: the rule the token will carry, in plain
 * words, from the fields as typed. Same shape as the "preview the rule"
 * step of a programmable launchpad, except every line is enforced by a
 * contract the creator cannot change afterwards.
 */
export function previewRule(input: RuleInput): RuleLine[] {
  const lines: RuleLine[] = [];
  const dev = Number.parseFloat(input.devBuyEth || "0");
  const deadline = input.launchAt + input.windowDays * 86_400;
  if (Number.isFinite(dev) && dev > 0) {
    lines.push({
      key: "dev",
      text: `Your ${trimEth(input.devBuyEth)} ETH developer buy is delivered to a vesting contract, not to your wallet. It unlocks linearly over ${input.vestDays} days, until ${formatUtc(input.launchAt + input.vestDays * 86_400)}.`,
    });
  } else {
    lines.push({
      key: "dev",
      text: "No developer buy. Your wallet starts with zero tokens, and it pays the snipe tax like any other buyer.",
    });
  }
  lines.push({
    key: "fees",
    text: `Your creator fees go to a fee lock. Nothing leaves it before the curve graduates.`,
  });
  lines.push({
    key: "graduate",
    text: `IF the curve graduates → your fees unlock linearly over ${input.feeVestDays} days from the moment graduation is recorded, then pass straight through. Each release pays you ${100 - input.padSharePct}%, the pad ${input.padSharePct}%.`,
  });
  lines.push({
    key: "bury",
    text: `IF the curve has not graduated by ${formatUtc(deadline)} → anyone can bury the lock: its ETH buys your token back on the curve and the tokens are burned. Nobody is paid — not you, not the pad.`,
  });
  return lines;
}

/** `0.0500` → `0.05`, `1.000` → `1`, `` → `0`. */
export function trimEth(value: string, max = 6): string {
  const n = Number.parseFloat(value || "0");
  if (!Number.isFinite(n)) return "0";
  return n.toFixed(max).replace(/\.?0+$/, "") || "0";
}
