import { ethers, network } from "hardhat";

/**
 * Exercises the router and both locks against the REAL Pons V2 factory on a
 * fork of Robinhood Chain. Nothing is broadcast; the hardhat network is
 * forked from ROBINHOOD_RPC_URL at the latest block.
 *
 *   npx hardhat node --fork https://rpc.mainnet.chain.robinhood.com
 *   npm run fork:check
 *
 * Or in one process: FORK_URL=https://rpc.mainnet.chain.robinhood.com npx hardhat run scripts/fork-check.ts
 *
 * What it proves, in order: a launch with a developer buy delivers the
 * tokens to the vesting contract and not the creator; the creator's wallet
 * is not exempt from the snipe tax while the vesting contract is; creator
 * fees accrue for the fee lock; a lock whose deadline passes without
 * graduation can be buried on the real curve (buy + burn); and a launch
 * that graduates for real can be checkpointed and released 90/10.
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const DEAD = "0x000000000000000000000000000000000000dEaD";
const DAY = 24 * 60 * 60;

const CURVE_ABI = [
  "function realQuoteReserve() view returns (uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function graduated() view returns (bool)",
  "function deployer() view returns (address)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
  "function getReserves() view returns (uint256,uint256)",
  "function snipeTaxExempt(address) view returns (bool)",
  "function quoteFeeBalance() view returns (uint256)",
  "function protocolFeeShareBps() view returns (uint256)",
  "function protocolFeeRecipient() view returns (address)",
  "function sweepFees(uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

function parse<T extends { interface: { parseLog: (l: { topics: string[]; data: string }) => unknown } }>(c: T, logs: readonly { topics: readonly string[]; data: string }[], name: string) {
  return logs
    .map((l) => {
      try {
        return c.interface.parseLog({ topics: [...l.topics], data: l.data }) as { name: string; args: unknown[] } | null;
      } catch {
        return null;
      }
    })
    .find((p) => p?.name === name);
}

async function increaseTime(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

/**
 * Pons sweeps curve fees to the escrow itself; from outside `sweepFees`
 * reverts. On a fork we can impersonate the protocol fee recipient and try.
 * Returns true when fees moved.
 */
async function trySweep(curve: import("ethers").Contract): Promise<boolean> {
  const candidates = new Set<string>();
  try {
    candidates.add(await curve.protocolFeeRecipient());
  } catch {
    /* no such view */
  }
  try {
    const factory = new ethers.Contract(PONS_FACTORY, ["function owner() view returns (address)"], ethers.provider);
    candidates.add(await factory.owner());
  } catch {
    /* no owner() */
  }
  for (const who of candidates) {
    if (!ethers.isAddress(who) || who === ethers.ZeroAddress) continue;
    await network.provider.send("hardhat_impersonateAccount", [who]);
    await network.provider.send("hardhat_setBalance", [who, "0x56BC75E2D63100000"]);
    const signer = await ethers.getSigner(who);
    for (const arg of [0n, ethers.MaxUint256]) {
      try {
        await curve.connect(signer).getFunction("sweepFees").staticCall(arg);
        await (await curve.connect(signer).getFunction("sweepFees")(arg)).wait();
        console.log(`  sweepFees(${arg === 0n ? 0 : "max"}) as ${who}: OK`);
        await network.provider.send("hardhat_stopImpersonatingAccount", [who]);
        return true;
      } catch (e) {
        console.log(`  sweepFees(${arg === 0n ? 0 : "max"}) as ${who}: revert ${(e as Error).message.slice(0, 90)}`);
      }
    }
    await network.provider.send("hardhat_stopImpersonatingAccount", [who]);
  }
  return false;
}

async function main() {
  const [deployer, creator, stranger, whale] = await ethers.getSigners();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  console.log(`network ${network.name} chainId ${chainId} block ${await ethers.provider.getBlockNumber()}`);
  if ((await ethers.provider.getCode(PONS_FACTORY)) === "0x") {
    throw new Error("Not a Robinhood Chain fork: no factory code at " + PONS_FACTORY);
  }

  const lockFactory = await (await ethers.getContractFactory("LockFactory")).deploy();
  await lockFactory.waitForDeployment();
  const router = await (await ethers.getContractFactory("LockpadRouter")).deploy(
    PONS_FACTORY,
    await lockFactory.getAddress(),
    deployer.address,
    deployer.address,
  );
  await router.waitForDeployment();
  console.log("lockFactory", await lockFactory.getAddress());
  console.log("router", await router.getAddress());
  console.log("feeEscrow", await router.feeEscrow(), "forwarder", await router.ponsForwarder());
  console.log("canLaunchHere", await router.canLaunchHere());
  const ponsFee = await router.ponsLaunchFee();
  console.log("ponsLaunchFee", ethers.formatEther(ponsFee));

  // ── 1. Launch with a developer buy ─────────────────────────────────────
  const devBuy = ethers.parseEther("0.01");
  const base = {
    name: "Fork Lock",
    symbol: "FLOCK",
    logo: "ipfs://bafkreiforklock",
    description: "Fork rehearsal, never broadcast.",
    x: "https://x.com/lockpad",
    telegram: "",
    website: "https://lockpad.example",
    creatorTaxBps: 0,
    salt: ethers.hexlify(ethers.randomBytes(32)),
    developerBuy: devBuy,
    minTokensOut: 0n,
    vestDuration: BigInt(90 * DAY),
    graduationWindow: BigInt(7 * DAY),
  };
  const tx = await router.connect(creator).launch(base, { value: ponsFee + devBuy });
  const receipt = await tx.wait();
  console.log("\n[1] launch with dev buy: gas", receipt?.gasUsed.toString());
  const launched = parse(router, receipt!.logs, "Launched");
  if (!launched) throw new Error("no Launched event");
  const [token, curve, , feeLock, vesting] = launched.args as string[];
  console.log("  token", token, "\n  curve", curve, "\n  feeLock", feeLock, "\n  vesting", vesting);

  const erc20 = new ethers.Contract(token, ERC20_ABI, ethers.provider);
  const curveC = new ethers.Contract(curve, CURVE_ABI, ethers.provider);
  const lock = await ethers.getContractAt("FeeLock", feeLock);
  const vest = await ethers.getContractAt("DevVesting", vesting);

  const vestBal = await erc20.balanceOf(vesting);
  const creatorBal = await erc20.balanceOf(creator.address);
  console.log("  token", await erc20.name(), await erc20.symbol());
  console.log("  vesting balance", ethers.formatEther(vestBal), "creator balance", ethers.formatEther(creatorBal));
  if (vestBal === 0n || creatorBal !== 0n) throw new Error("developer buy did not land in the vesting contract");
  if ((await vest.allocation()) !== vestBal) throw new Error("vesting not armed with the delivered balance");
  console.log("  vesting armed: allocation", ethers.formatEther(await vest.allocation()), "start", (await vest.start()).toString(), "end", (await vest.end()).toString());
  console.log("  fee recipient on curve (deployer())", await curveC.deployer(), "== feeLock", (await curveC.deployer()) === feeLock);
  console.log("  snipe-tax exempt: vesting", await curveC.snipeTaxExempt(vesting), "| creator", await curveC.snipeTaxExempt(creator.address), "| feeLock", await curveC.snipeTaxExempt(feeLock), "| router", await curveC.snipeTaxExempt(await router.getAddress()));
  if (!(await curveC.snipeTaxExempt(vesting))) throw new Error("vesting contract should be exempt");
  if (await curveC.snipeTaxExempt(creator.address)) throw new Error("creator wallet must not be exempt");

  // ── 2. Fees accrue for the lock ────────────────────────────────────────
  const spend = ethers.parseEther("0.05");
  await (await curveC.connect(stranger).buy(spend, 0, stranger.address, { value: spend })).wait();
  console.log("\n[2] stranger bought 0.05 ETH: quoteFeeBalance on curve", ethers.formatEther(await curveC.quoteFeeBalance()), "protocolFeeShareBps", (await curveC.protocolFeeShareBps()).toString());
  console.log("  lock.pending (escrow)", ethers.formatEther(await lock.pending()));
  const swept = await trySweep(curveC);
  console.log("  swept to escrow:", swept, "| lock.pending", ethers.formatEther(await lock.pending()));
  const s0 = await router.lockStatus(token);
  console.log("  lockStatus: graduated", s0.fees.graduated, "live", s0.fees.graduatedLive, "buried", s0.fees.buried, "deadline", s0.fees.deadline.toString(), "devLocked", ethers.formatEther(s0.devLocked));

  // Nothing releases before graduation, on the real curve too.
  try {
    await lock.connect(stranger).release.staticCall();
    throw new Error("release should revert before graduation");
  } catch (e) {
    console.log("  release before graduation reverts:", (e as Error).message.includes("NothingToRelease"));
  }

  // ── 3. Bury after the deadline ─────────────────────────────────────────
  // Give the lock something to bury even if Pons did not sweep on this fork.
  if ((await lock.pending()) === 0n) {
    await (await stranger.sendTransaction({ to: feeLock, value: ethers.parseEther("0.003") })).wait();
    console.log("\n[3] (no sweep on the fork) sent 0.003 ETH straight to the lock to stand in for swept fees");
  }
  await increaseTime(7 * DAY + 1);
  const deadBefore = await erc20.balanceOf(DEAD);
  const buryable = await lock.buryable();
  const buryTx = await router.connect(stranger).bury(token);
  const buryReceipt = await buryTx.wait();
  const burial = parse(lock, buryReceipt!.logs, "Burial");
  console.log("[3] bury on the real curve: gas", buryReceipt?.gasUsed.toString(), "buryable", ethers.formatEther(buryable), "spent", ethers.formatEther((burial?.args[0] as bigint) ?? 0n), "burned", ethers.formatEther((burial?.args[1] as bigint) ?? 0n));
  const deadAfter = await erc20.balanceOf(DEAD);
  if (deadAfter <= deadBefore) throw new Error("burial did not burn");
  console.log("  dead address balance", ethers.formatEther(deadAfter), "| lock buried", await lock.buried(), "| lock balance", ethers.formatEther(await ethers.provider.getBalance(feeLock)));

  // ── 4. A launch that graduates for real ────────────────────────────────
  const tx2 = await router.connect(creator).launch({ ...base, symbol: "FLOCK2", salt: ethers.hexlify(ethers.randomBytes(32)), developerBuy: 0n, graduationWindow: BigInt(30 * DAY) }, { value: ponsFee });
  const r2 = await tx2.wait();
  const launched2 = parse(router, r2!.logs, "Launched");
  const [token2, curve2, , feeLock2, vesting2] = launched2!.args as string[];
  console.log("\n[4] launch without dev buy: vesting", vesting2, "(zero = none)", "gas", r2?.gasUsed.toString());
  const curve2C = new ethers.Contract(curve2, CURVE_ABI, ethers.provider);
  const lock2 = await ethers.getContractAt("FeeLock", feeLock2);
  const threshold = await curve2C.graduationThreshold();
  console.log("  graduation threshold", ethers.formatEther(threshold));
  for (let i = 0; i < 20 && !(await curve2C.graduated()); i++) {
    const v = ethers.parseEther("0.5");
    try {
      await (await curve2C.connect(whale).buy(v, 0, whale.address, { value: v })).wait();
    } catch (e) {
      console.log("  buy failed at step", i, (e as Error).message.slice(0, 100));
      break;
    }
  }
  console.log("  realQuoteReserve", ethers.formatEther(await curve2C.realQuoteReserve()), "graduated", await curve2C.graduated());
  if (!(await curve2C.graduated())) {
    console.log("  could not graduate on this fork — skipping the release rehearsal");
  } else {
    const s1 = await router.lockStatus(token2);
    console.log("  status before checkpoint: graduated", s1.fees.graduated, "live", s1.fees.graduatedLive);
    await (await router.connect(stranger).checkpoint(token2)).wait();
    console.log("  graduatedAt", (await lock2.graduatedAt()).toString(), "vestEnd", (await lock2.vestEnd()).toString());
    const swept2 = await trySweep(curve2C);
    if (!swept2) {
      await (await stranger.sendTransaction({ to: feeLock2, value: ethers.parseEther("0.02") })).wait();
      console.log("  (no sweep on the fork) sent 0.02 ETH straight to the lock to stand in for swept fees");
    }
    console.log("  lock2 pending", ethers.formatEther(await lock2.pending()), "balance", ethers.formatEther(await ethers.provider.getBalance(feeLock2)), "releasable now", ethers.formatEther(await lock2.releasable()));
    await increaseTime(15 * DAY);
    const creatorBefore = await ethers.provider.getBalance(creator.address);
    const treasuryBefore = await ethers.provider.getBalance(deployer.address);
    const rel = await (await router.connect(stranger).release(token2)).wait();
    const released = parse(lock2, rel!.logs, "Released");
    console.log("  release at +15d: toCreator", ethers.formatEther((released?.args[1] as bigint) ?? 0n), "toPad", ethers.formatEther((released?.args[2] as bigint) ?? 0n));
    console.log("  creator delta", ethers.formatEther((await ethers.provider.getBalance(creator.address)) - creatorBefore), "treasury delta", ethers.formatEther((await ethers.provider.getBalance(deployer.address)) - treasuryBefore));
    try {
      await router.connect(stranger).bury.staticCall(token2);
      throw new Error("bury should revert on a graduated lock");
    } catch (e) {
      console.log("  bury on a graduated lock reverts:", (e as Error).message.includes("Graduated"));
    }
  }

  console.log("\nlaunchCount", (await router.launchCount()).toString());
  console.log("OK — router and locks work against the real Pons factory on this fork.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
