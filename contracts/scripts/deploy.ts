import * as fs from "fs";
import * as path from "path";
import { ethers, network } from "hardhat";
import { deploymentsDir, type DeploymentRecord } from "./lib/exportAbi";

/** Pons V2 factory on Robinhood Chain (chain id 4663). */
const PONS_FACTORY_ROBINHOOD = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

function isLocal(): boolean {
  return network.name === "hardhat" || network.name === "localhost";
}

/**
 * Deploys the LockFactory, then the LockpadRouter against the Pons V2
 * factory. On the hardhat network a MockPonsFactory stands in so the script
 * can be rehearsed end to end.
 *
 *   PONS_FACTORY_ADDRESS   factory (defaults to the Robinhood Chain one)
 *   LOCK_FACTORY_ADDRESS   reuse an existing LockFactory instead of deploying one
 *   TREASURY_ADDRESS       receives the pad's 10% (defaults to the deployer)
 *   OWNER_ADDRESS          final owner, accepted via Ownable2Step (defaults to the deployer)
 *   PAD_LAUNCH_FEE_ETH     extra launch fee, "0" by default
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const treasury = env("TREASURY_ADDRESS") ?? deployer.address;
  const owner = env("OWNER_ADDRESS") ?? deployer.address;
  const padFee = ethers.parseEther(env("PAD_LAUNCH_FEE_ETH") ?? "0");

  console.log(`Network   : ${network.name} (chainId ${chainId})`);
  console.log(`Deployer  : ${deployer.address}`);
  console.log(`Treasury  : ${treasury}`);
  console.log(`Owner     : ${owner}`);

  let factory = env("PONS_FACTORY_ADDRESS");
  if (!factory) {
    if (isLocal()) {
      const mock = await (await ethers.getContractFactory("MockPonsFactory")).deploy(deployer.address);
      await mock.waitForDeployment();
      factory = await mock.getAddress();
      console.log(`MockPonsFactory : ${factory}`);
    } else if (chainId === 4663) {
      factory = PONS_FACTORY_ROBINHOOD;
    } else {
      throw new Error("PONS_FACTORY_ADDRESS is required on this network.");
    }
  }
  console.log(`Pons factory : ${factory}`);

  let lockFactory = env("LOCK_FACTORY_ADDRESS");
  if (!lockFactory) {
    const lf = await (await ethers.getContractFactory("LockFactory")).deploy();
    await lf.waitForDeployment();
    lockFactory = await lf.getAddress();
  }
  console.log(`LockFactory  : ${lockFactory}`);

  // Deployer owns it first so the fee can be set, then hands over.
  const router = await (await ethers.getContractFactory("LockpadRouter")).deploy(factory, lockFactory, treasury, deployer.address);
  const receipt = await router.deploymentTransaction()?.wait();
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  console.log(`LockpadRouter : ${routerAddress}`);

  if (padFee > 0n) {
    await (await router.setPadLaunchFee(padFee)).wait();
    console.log(`Pad launch fee : ${ethers.formatEther(padFee)} ETH`);
  }
  if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await router.transferOwnership(owner)).wait();
    console.log(`Ownership offered to ${owner} — call acceptOwnership() from that account.`);
  }

  const feeEscrow = await router.feeEscrow();
  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    deployer: deployer.address,
    owner,
    treasury,
    ponsFactory: factory,
    feeEscrow,
    lockFactory,
    router: routerAddress,
    padLaunchFeeWei: padFee.toString(),
    deployedAt: new Date().toISOString(),
    txHash: receipt?.hash ?? null,
  };
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const file = path.join(deploymentsDir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");
  console.log(`Saved ${file}`);
  console.log(`\nFront end: NEXT_PUBLIC_LOCKPAD_ROUTER=${routerAddress}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
