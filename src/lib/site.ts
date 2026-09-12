/**
 * Brand and copy that spells the name out. Everything that says "Lockpad"
 * reads from here, so a rename is a one-file change.
 */
export const site = {
  name: "Lockpad",
  /** The two halves of the wordmark: `Lock` in ink, `pad` in amber. */
  wordmark: ["Lock", "pad"] as const,
  domain: "lockpad.fun",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? "https://lockpad.fun",
  tagline: "Locked by construction",
  description:
    "A launchpad for Pons V2 on Robinhood Chain where the developer buy vests on a public schedule and creator fees stay locked until graduation — or get buried. Nothing to trust, everything to read.",
  keywords: ["Lockpad", "launchpad", "Robinhood Chain", "Pons V2", "vesting", "anti-rug", "token launch"],
  x: process.env.NEXT_PUBLIC_X_URL ?? "https://x.com/lockpad_",
  /** The pad's share of what a creator unlocks, in basis points. */
  padShareBps: 1000,
  creatorShareBps: 9000,
  /** Fees unlock over this long once graduation is recorded. */
  feeVestDays: 30,
  /** Bounds enforced by the router, mirrored here for the form. */
  vestDays: { min: 7, max: 365, options: [30, 90, 180] as const, default: 90 },
  windowDays: { min: 3, max: 90, options: [7, 14, 30] as const, default: 14 },
  /** Burial mechanics, mirrored from FeeLock. */
  burySliceBps: 200,
  buryIntervalHours: 1,
  /** Pons V2 numbers, display only; the chain is the source. */
  graduationEth: 4.2,
  tradeFeePct: "1%",
  launchFeeEth: process.env.NEXT_PUBLIC_LAUNCH_FEE_ETH ?? "0.0005",
  venue: "Pons V2",
  chain: "Robinhood Chain",
} as const;

export const percent = {
  creator: `${site.creatorShareBps / 100}%`,
  pad: `${site.padShareBps / 100}%`,
} as const;
