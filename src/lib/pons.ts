import type { LockStatusJson } from "@/lib/lockmath";

/**
 * Shapes served by /api/launches and /api/token/<address>/*. Everything is
 * read from Robinhood Chain — the router for the list, the metadata and
 * both locks, the Pons curve for the market, the fee escrow for pending
 * creator fees. No indexer.
 */

export type LaunchMarket = {
  /** ETH per token, from the curve's (virtual) reserves. */
  priceEth: number;
  /** Null when no ETH/USD quote is available. */
  priceUsd: number | null;
  marketCapEth: number;
  marketCapUsd: number | null;
  /** ETH actually raised on the curve so far. */
  raisedEth: number;
  graduationProgressPct: number;
  graduated: boolean;
};

export type Launch = {
  token: string;
  curve: string;
  creator: string;
  feeLock: string;
  /** Zero address when the launch had no developer buy. */
  vesting: string;
  creatorTaxBps: number;
  /** Developer buy in wei, as a decimal string. */
  developerBuy: string;
  vestDuration: number;
  deadline: number;
  name: string;
  symbol: string;
  /** `ipfs://<cid>` or an https URL. Empty when the launch has no image. */
  logo: string;
  description: string;
  launchBlock: number;
  launchedAt: number;
  market: LaunchMarket;
  locks: LockStatusJson;
};

export type LaunchesResponse = {
  ok: boolean;
  launches: Launch[];
  /** Unix seconds the chain was read at, so countdowns start from the same clock. */
  readAt: number;
};

export type MarketSummary = LaunchMarket & {
  graduationThresholdEth: number;
  launchSupply: number;
  ethUsd: number | null;
  venue: "curve" | "pool";
  /** The creator's share of fees still on the curve, waiting for Pons' sweep, in wei. */
  accruingWei: string;
};

export type SummaryResponse = {
  ok: boolean;
  launch: Launch;
  market: MarketSummary;
  readAt: number;
};

export type Trade = {
  id: string;
  side: "buy" | "sell";
  /** Token amount in base units (18 decimals), decimal string. */
  tokenAmount: string;
  /** Quote amount in wei, decimal string. */
  quoteAmount: string;
  account: string;
  transactionHash: string;
  blockNumber: number;
  timestamp: number;
};

export type TradesResponse = { ok: boolean; trades: Trade[] };

export type ChartPoint = {
  t: number;
  /** Price in ETH per token. */
  price: number;
};

export type ChartResponse = {
  ok: boolean;
  token: string;
  ethUsd: number | null;
  launchSupply: number;
  points: ChartPoint[];
};

/** Resolve `ipfs://` logos through the Pons gateway, pass https through. */
export function logoUrl(logo: string | null | undefined): string | null {
  if (!logo) return null;
  if (logo.startsWith("ipfs://")) {
    const cid = logo.slice("ipfs://".length);
    return `https://www.ponsfamily.com/api/ipfs/content/${cid}?variant=card`;
  }
  if (/^https?:\/\//.test(logo)) return logo;
  return null;
}
