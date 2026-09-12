import { createPublicClient, http } from "viem";
import { robinhoodChain } from "@/lib/chain";

/**
 * Server-side reader for Robinhood Chain. Multicall3 is deployed at the
 * canonical address there, so viem batches every view into one request.
 */
const chainWithMulticall = {
  ...robinhoodChain,
  contracts: {
    multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" as const },
  },
};

let client: ReturnType<typeof createPublicClient> | null = null;

export function chainClient() {
  if (!client) {
    client = createPublicClient({
      chain: chainWithMulticall,
      transport: http(undefined, { batch: true }),
      batch: { multicall: true },
    });
  }
  return client;
}
