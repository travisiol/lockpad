import { defineChain } from "viem";

/**
 * Robinhood Chain (Arbitrum Orbit), chain id 4663. The RPC answers
 * eth_chainId 0x1237; the explorer is Blockscout. Every value can be
 * overridden from the environment.
 */
export const ROBINHOOD_CHAIN_ID = Number(process.env.NEXT_PUBLIC_ROBINHOOD_CHAIN_ID ?? 4663);

const RPC_URL = process.env.NEXT_PUBLIC_ROBINHOOD_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

export const EXPLORER_URL = (
  process.env.NEXT_PUBLIC_ROBINHOOD_EXPLORER_URL ?? "https://robinhoodchain.blockscout.com"
).replace(/\/$/, "");

export const robinhoodChain = defineChain({
  id: ROBINHOOD_CHAIN_ID,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: {
    default: { name: "Robinhood Chain Explorer", url: EXPLORER_URL },
  },
  testnet: false,
});

export const explorer = {
  address: (a: string) => `${EXPLORER_URL}/address/${a}`,
  tx: (h: string) => `${EXPLORER_URL}/tx/${h}`,
  token: (a: string) => `${EXPLORER_URL}/token/${a}`,
};

/** Pons V2 front end, where the market itself is traded. */
export const ponsTradeUrl = (token: string) => `https://www.ponsfamily.com/launchpad/${token}`;
