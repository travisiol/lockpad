import type { Abi } from "viem";
import routerJson from "@/lib/abi/LockpadRouter.json";
import feeLockJson from "@/lib/abi/FeeLock.json";
import vestingJson from "@/lib/abi/DevVesting.json";

/**
 * On-chain surface. Addresses come from the environment and are null until
 * deployed; the ABIs are exported by `contracts/` on every compile.
 */

function envAddress(value: string | undefined): `0x${string}` | null {
  const v = value?.trim();
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as `0x${string}`) : null;
}

/** The Lockpad router: launch → Pons V2 + a FeeLock and a DevVesting per token. */
export const ROUTER_ADDRESS = envAddress(process.env.NEXT_PUBLIC_LOCKPAD_ROUTER);

export const routerAbi = routerJson as Abi;
export const feeLockAbi = feeLockJson as Abi;
export const vestingAbi = vestingJson as Abi;
