import { formatEther, parseAbiItem, type Address } from "viem";
import { chainClient } from "@/lib/chainClient";
import { cached } from "@/lib/cache";
import { ROUTER_ADDRESS, routerAbi } from "@/lib/contracts";
import { curveAbi } from "@/lib/ponsAbi";
import type { LockStatusJson } from "@/lib/lockmath";
import type { ChartPoint, Launch, LaunchMarket, MarketSummary, Trade } from "@/lib/pons";

/**
 * Everything the site knows about a launch, read from the chain: the
 * router for the list, the metadata and both locks, the Pons curve for
 * reserves and graduation. No indexer, no database.
 */

const ETH_USD_TTL = 60_000;
const LIST_TTL = 12_000;
const SUMMARY_TTL = 10_000;
const TRADES_TTL = 15_000;

const wei = (v: bigint) => Number(formatEther(v));

/**
 * The chain's clock, not the server's: every deadline and vest end is a
 * block timestamp, so countdowns are measured from the latest block. Falls
 * back to the wall clock if the read fails.
 */
function chainNow(): Promise<number> {
  return cached("chainNow", 5_000, async () => {
    try {
      const block = await chainClient().getBlock({ blockTag: "latest" });
      return Number(block.timestamp);
    } catch {
      return Math.floor(Date.now() / 1000);
    }
  });
}

/** ETH/USD from Coinbase's public spot endpoint; null when unreachable. */
export function ethUsd(): Promise<number | null> {
  return cached("ethUsd", ETH_USD_TTL, async () => {
    try {
      const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { next: { revalidate: 60 } });
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { amount?: string } };
      const n = Number(json.data?.amount);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  });
}

type CurveState = {
  quote: bigint;
  tokens: bigint;
  realQuote: bigint;
  threshold: bigint;
  graduated: boolean;
  launchSupply: bigint;
};

async function readCurves(curves: Address[]): Promise<CurveState[]> {
  if (curves.length === 0) return [];
  const results = await chainClient().multicall({
    allowFailure: true,
    contracts: curves.flatMap((address) => [
      { address, abi: curveAbi, functionName: "getReserves" } as const,
      { address, abi: curveAbi, functionName: "realQuoteReserve" } as const,
      { address, abi: curveAbi, functionName: "graduationThreshold" } as const,
      { address, abi: curveAbi, functionName: "graduated" } as const,
      { address, abi: curveAbi, functionName: "launchSupply" } as const,
    ]),
  });
  return curves.map((_, i) => {
    const r = results.slice(i * 5, i * 5 + 5);
    const reserves = (r[0].status === "success" ? r[0].result : [0n, 0n]) as readonly [bigint, bigint];
    return {
      quote: reserves[0],
      tokens: reserves[1],
      realQuote: r[1].status === "success" ? (r[1].result as bigint) : 0n,
      threshold: r[2].status === "success" ? (r[2].result as bigint) : 0n,
      graduated: r[3].status === "success" ? (r[3].result as boolean) : false,
      launchSupply: r[4].status === "success" ? (r[4].result as bigint) : 0n,
    };
  });
}

/** ETH per token from the curve's (virtual) reserves. */
function priceEth(c: CurveState): number {
  if (c.tokens === 0n) return 0;
  return wei(c.quote) / wei(c.tokens);
}

function marketOf(c: CurveState, usd: number | null): LaunchMarket {
  const p = priceEth(c);
  const supply = wei(c.launchSupply);
  const raised = wei(c.realQuote);
  const threshold = wei(c.threshold);
  const progress = c.graduated ? 100 : threshold > 0 ? Math.min(100, (raised / threshold) * 100) : 0;
  return {
    priceEth: p,
    priceUsd: usd === null ? null : p * usd,
    marketCapEth: p * supply,
    marketCapUsd: usd === null ? null : p * supply * usd,
    raisedEth: raised,
    graduationProgressPct: progress,
    graduated: c.graduated,
  };
}

type RouterInfo = {
  token: Address;
  curve: Address;
  creator: Address;
  feeLock: Address;
  vesting: Address;
  creatorTaxBps: number;
  developerBuy: bigint;
  vestDuration: bigint;
  deadline: bigint;
  launchedAt: bigint;
  launchBlock: bigint;
  name: string;
  symbol: string;
  logo: string;
  description: string;
};

type FeeStatusRaw = {
  armed: boolean;
  graduated: boolean;
  graduatedLive: boolean;
  graduatedAt: bigint;
  deadline: bigint;
  vestEnd: bigint;
  buried: boolean;
  buryable: bigint;
  nextBuryAt: bigint;
  pending: bigint;
  balance: bigint;
  releasable: bigint;
  locked: bigint;
  totalReceived: bigint;
  totalReleased: bigint;
  totalBuried: bigint;
  tokensBurned: bigint;
};

type LockStatusRaw = {
  fees: FeeStatusRaw;
  hasVesting: boolean;
  vestStart: bigint;
  vestEnd: bigint;
  devAllocation: bigint;
  devReleased: bigint;
  devReleasable: bigint;
  devLocked: bigint;
};

const EMPTY_LOCKS: LockStatusJson = {
  fees: {
    armed: false,
    graduated: false,
    graduatedLive: false,
    graduatedAt: 0,
    deadline: 0,
    vestEnd: 0,
    buried: false,
    buryable: "0",
    nextBuryAt: 0,
    pending: "0",
    balance: "0",
    releasable: "0",
    locked: "0",
    totalReceived: "0",
    totalReleased: "0",
    totalBuried: "0",
    tokensBurned: "0",
  },
  hasVesting: false,
  vestStart: 0,
  vestEnd: 0,
  devAllocation: "0",
  devReleased: "0",
  devReleasable: "0",
  devLocked: "0",
};

function locksJson(raw: LockStatusRaw): LockStatusJson {
  const f = raw.fees;
  return {
    fees: {
      armed: f.armed,
      graduated: f.graduated,
      graduatedLive: f.graduatedLive,
      graduatedAt: Number(f.graduatedAt),
      deadline: Number(f.deadline),
      vestEnd: Number(f.vestEnd),
      buried: f.buried,
      buryable: f.buryable.toString(),
      nextBuryAt: Number(f.nextBuryAt),
      pending: f.pending.toString(),
      balance: f.balance.toString(),
      releasable: f.releasable.toString(),
      locked: f.locked.toString(),
      totalReceived: f.totalReceived.toString(),
      totalReleased: f.totalReleased.toString(),
      totalBuried: f.totalBuried.toString(),
      tokensBurned: f.tokensBurned.toString(),
    },
    hasVesting: raw.hasVesting,
    vestStart: Number(raw.vestStart),
    vestEnd: Number(raw.vestEnd),
    devAllocation: raw.devAllocation.toString(),
    devReleased: raw.devReleased.toString(),
    devReleasable: raw.devReleasable.toString(),
    devLocked: raw.devLocked.toString(),
  };
}

async function readLocks(router: Address, tokens: Address[]): Promise<LockStatusJson[]> {
  if (tokens.length === 0) return [];
  const results = await chainClient().multicall({
    allowFailure: true,
    contracts: tokens.map((token) => ({ address: router, abi: routerAbi, functionName: "lockStatus", args: [token] }) as const),
  });
  return results.map((r) => (r.status === "success" ? locksJson(r.result as unknown as LockStatusRaw) : EMPTY_LOCKS));
}

function launchOf(l: RouterInfo, market: LaunchMarket, locks: LockStatusJson): Launch {
  return {
    token: l.token,
    curve: l.curve,
    creator: l.creator,
    feeLock: l.feeLock,
    vesting: l.vesting,
    creatorTaxBps: l.creatorTaxBps,
    developerBuy: l.developerBuy.toString(),
    vestDuration: Number(l.vestDuration),
    deadline: Number(l.deadline),
    name: l.name,
    symbol: l.symbol,
    logo: l.logo,
    description: l.description,
    launchBlock: Number(l.launchBlock),
    launchedAt: Number(l.launchedAt),
    market,
    locks,
  };
}

/** Newest first. Empty until the router exists and someone launches. */
export function listLaunches(limit: number): Promise<{ launches: Launch[]; readAt: number }> {
  if (!ROUTER_ADDRESS) return Promise.resolve({ launches: [], readAt: Math.floor(Date.now() / 1000) });
  const router = ROUTER_ADDRESS;
  return cached(`launches:${limit}`, LIST_TTL, async () => {
    const [page, usd, readAt] = await Promise.all([
      chainClient().readContract({ address: router, abi: routerAbi, functionName: "launches", args: [0n, BigInt(limit)] }) as Promise<readonly RouterInfo[]>,
      ethUsd(),
      chainNow(),
    ]);
    const [curves, locks] = await Promise.all([readCurves(page.map((l) => l.curve)), readLocks(router, page.map((l) => l.token))]);
    return { launches: page.map((l, i) => launchOf(l, marketOf(curves[i], usd), locks[i])), readAt };
  });
}

export function launchCount(): Promise<number> {
  if (!ROUTER_ADDRESS) return Promise.resolve(0);
  const router = ROUTER_ADDRESS;
  return cached("launchCount", LIST_TTL, async () => {
    const n = (await chainClient().readContract({ address: router, abi: routerAbi, functionName: "launchCount" })) as bigint;
    return Number(n);
  });
}

async function tokenInfo(token: Address): Promise<RouterInfo | null> {
  if (!ROUTER_ADDRESS) return null;
  const router = ROUTER_ADDRESS;
  return cached(`info:${token.toLowerCase()}`, 60_000, async () => {
    try {
      return (await chainClient().readContract({ address: router, abi: routerAbi, functionName: "infoOf", args: [token] })) as RouterInfo;
    } catch {
      return null;
    }
  });
}

export function tokenSummary(token: Address): Promise<{ launch: Launch; market: MarketSummary; readAt: number } | null> {
  return cached(`summary:${token.toLowerCase()}`, SUMMARY_TTL, async () => {
    const info = await tokenInfo(token);
    if (!info || !ROUTER_ADDRESS) return null;
    const client = chainClient();
    const [[curve], usd, [locks], onCurve, protocolShareBps, readAt] = await Promise.all([
      readCurves([info.curve]),
      ethUsd(),
      readLocks(ROUTER_ADDRESS, [token]),
      client.readContract({ address: info.curve, abi: curveAbi, functionName: "quoteFeeBalance" }).catch(() => 0n) as Promise<bigint>,
      client.readContract({ address: info.curve, abi: curveAbi, functionName: "protocolFeeShareBps" }).catch(() => 0n) as Promise<bigint>,
      chainNow(),
    ]);
    // Fees sit on the curve until Pons sweeps them; the creator's share is
    // whatever is left after the protocol's cut.
    const accruing = (onCurve * (10_000n - protocolShareBps)) / 10_000n;
    const m = marketOf(curve, usd);
    const market: MarketSummary = {
      ...m,
      graduationThresholdEth: wei(curve.threshold),
      launchSupply: wei(curve.launchSupply),
      ethUsd: usd,
      venue: m.graduated ? "pool" : "curve",
      accruingWei: accruing.toString(),
    };
    return { launch: launchOf(info, m, locks), market, readAt };
  });
}

const BUY = parseAbiItem(
  "event CurveBuy(address indexed sender, address indexed recipient, uint256 quoteIn, uint256 tokensOut, uint256 fee, uint256 snipeTax)",
);
const SELL = parseAbiItem(
  "event CurveSell(address indexed sender, address indexed recipient, uint256 tokensIn, uint256 quoteOut, uint256 fee, uint256 snipeTax)",
);

const TRADES_WANTED = 60;
const CHUNK = 100_000n;
const MAX_CHUNKS = 24;

/**
 * Curve trades, newest first, scanned backwards from the head in block
 * windows until enough are found or the launch block is reached. Trades
 * after graduation happen in the pool and are not listed here.
 */
export function tokenTrades(token: Address): Promise<Trade[]> {
  return cached(`trades:${token.toLowerCase()}`, TRADES_TTL, async () => {
    const info = await tokenInfo(token);
    if (!info) return [];
    const client = chainClient();
    const head = await client.getBlockNumber();
    const floor = info.launchBlock;
    const found: { log: { blockNumber: bigint; transactionHash: `0x${string}`; logIndex: number }; side: "buy" | "sell"; tokens: bigint; quote: bigint; account: Address }[] = [];
    let to = head;
    for (let i = 0; i < MAX_CHUNKS && to >= floor && found.length < TRADES_WANTED; i++) {
      const from = to - CHUNK + 1n > floor ? to - CHUNK + 1n : floor;
      const [buys, sells] = await Promise.all([
        client.getLogs({ address: info.curve, event: BUY, fromBlock: from, toBlock: to }),
        client.getLogs({ address: info.curve, event: SELL, fromBlock: from, toBlock: to }),
      ]);
      for (const l of buys) found.push({ log: l, side: "buy", tokens: l.args.tokensOut!, quote: l.args.quoteIn!, account: l.args.recipient! });
      for (const l of sells) found.push({ log: l, side: "sell", tokens: l.args.tokensIn!, quote: l.args.quoteOut!, account: l.args.sender! });
      to = from - 1n;
    }
    found.sort((a, b) => (a.log.blockNumber === b.log.blockNumber ? b.log.logIndex - a.log.logIndex : Number(b.log.blockNumber - a.log.blockNumber)));
    const top = found.slice(0, TRADES_WANTED);
    const blocks = [...new Set(top.map((t) => t.log.blockNumber))];
    const stamps = new Map<bigint, number>();
    await Promise.all(
      blocks.map(async (n) => {
        const b = await client.getBlock({ blockNumber: n });
        stamps.set(n, Number(b.timestamp));
      }),
    );
    return top.map((t) => ({
      id: `${t.log.transactionHash}:${t.log.logIndex}`,
      side: t.side,
      tokenAmount: t.tokens.toString(),
      quoteAmount: t.quote.toString(),
      account: t.account,
      transactionHash: t.log.transactionHash,
      blockNumber: Number(t.log.blockNumber),
      timestamp: stamps.get(t.log.blockNumber) ?? 0,
    }));
  });
}

/** One price point per trade, oldest first, ending on the live price. */
export async function tokenChart(token: Address): Promise<{ points: ChartPoint[]; ethUsd: number | null; launchSupply: number } | null> {
  const [trades, summary] = await Promise.all([tokenTrades(token), tokenSummary(token)]);
  if (!summary) return null;
  const points: ChartPoint[] = [...trades].reverse().map((t) => {
    const tokens = Number(t.tokenAmount) / 1e18;
    const quote = Number(t.quoteAmount) / 1e18;
    return { t: t.timestamp, price: tokens > 0 ? quote / tokens : 0 };
  });
  points.push({ t: summary.readAt, price: summary.market.priceEth });
  return { points, ethUsd: summary.market.ethUsd, launchSupply: summary.market.launchSupply };
}
