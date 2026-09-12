import * as fs from "node:fs";
import * as path from "node:path";
import type { NextConfig } from "next";

/**
 * The router address comes from NEXT_PUBLIC_LOCKPAD_ROUTER, or — when that is
 * unset — from the record `contracts/scripts/deploy.ts` writes, so
 * `npm run deploy:robinhood` followed by `npm run build` is the whole
 * hand-off. The record must be for the chain the site is configured for.
 */
function deployedRouter(): string | undefined {
  if (process.env.NEXT_PUBLIC_LOCKPAD_ROUTER?.trim()) return undefined;
  const chainId = Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID ?? 4663);
  const file = path.join(process.cwd(), "contracts", "deployments", "robinhood.json");
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8")) as { chainId?: number; router?: string };
    if (Number(record.chainId) === chainId && typeof record.router === "string" && /^0x[0-9a-fA-F]{40}$/.test(record.router)) {
      return record.router;
    }
  } catch {
    /* no deployment record yet */
  }
  return undefined;
}

const router = deployedRouter();

const nextConfig: NextConfig = {
  env: router ? { NEXT_PUBLIC_LOCKPAD_ROUTER: router } : {},
  images: {
    // Token logos come from IPFS gateways or the creator's own URL; plain
    // <img> is used for them (see TokenLogo), so nothing is listed here.
    remotePatterns: [],
  },
};

export default nextConfig;
