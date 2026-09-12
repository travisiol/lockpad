import * as fs from "fs";
import * as path from "path";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

export const frontendAbiDir = path.resolve(__dirname, "../../../src/lib/abi");
export const deploymentsDir = path.resolve(__dirname, "../../deployments");

const EXPORTED = ["LockpadRouter", "FeeLock", "DevVesting", "LockFactory"] as const;

export type DeploymentRecord = {
  network: string;
  chainId: number;
  deployer: string;
  owner: string;
  treasury: string;
  ponsFactory: string;
  feeEscrow: string;
  lockFactory: string;
  router: string;
  padLaunchFeeWei: string;
  deployedAt: string;
  txHash: string | null;
};

/**
 * Writes each exported contract's ABI to ../src/lib/abi/<Name>.json as a
 * plain JSON array, so the front end imports them `as const` through a
 * typed wrapper and viem infers argument types.
 */
export async function exportAbis(hre: HardhatRuntimeEnvironment): Promise<void> {
  fs.mkdirSync(frontendAbiDir, { recursive: true });
  for (const name of EXPORTED) {
    const artifact = await hre.artifacts.readArtifact(name);
    const file = path.join(frontendAbiDir, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(artifact.abi, null, 2) + "\n");
  }
}
