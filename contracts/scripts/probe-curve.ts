import { ethers, network } from "hardhat";

/**
 * What a Pons curve exposes, and how selling works — read off a fresh
 * launch on an in-process fork. Selectors are pulled from the bytecode
 * (PUSH4 … EQ) and named through openchain's signature database.
 *
 *   FORK_URL=https://rpc.mainnet.chain.robinhood.com npx hardhat run scripts/probe-curve.ts
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const DAY = 24 * 60 * 60;

async function main() {
  const [deployer, creator, trader] = await ethers.getSigners();
  console.log(`network ${network.name} block ${await ethers.provider.getBlockNumber()}`);
  const lockFactory = await (await ethers.getContractFactory("LockFactory")).deploy();
  const router = await (await ethers.getContractFactory("LockpadRouter")).deploy(PONS_FACTORY, await lockFactory.getAddress(), deployer.address, deployer.address);
  const ponsFee = await router.ponsLaunchFee();
  const tx = await router.connect(creator).launch(
    { name: "Probe", symbol: "PROBE", logo: "", description: "", x: "", telegram: "", website: "", creatorTaxBps: 0, salt: ethers.hexlify(ethers.randomBytes(32)), developerBuy: 0n, minTokensOut: 0n, vestDuration: BigInt(90 * DAY), graduationWindow: BigInt(14 * DAY) },
    { value: ponsFee },
  );
  const receipt = await tx.wait();
  const ev = receipt!.logs.map((l) => { try { return router.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; } }).find((e) => e?.name === "Launched")!;
  const [token, curve] = ev.args as unknown as [string, string];
  console.log("token", token, "curve", curve);

  // Selectors from the curve bytecode
  const code = await ethers.provider.getCode(curve);
  const selectors = new Set<string>();
  const re = /63([0-9a-f]{8})(?:14|8114|81 ?14)/g;
  let m: RegExpExecArray | null;
  const hex = code.slice(2);
  while ((m = re.exec(hex))) selectors.add("0x" + m[1]);
  console.log("selectors", selectors.size);
  const list = [...selectors];
  const names: Record<string, string> = {};
  for (let i = 0; i < list.length; i += 40) {
    const batch = list.slice(i, i + 40);
    const res = await fetch(`https://api.openchain.xyz/signature-database/v1/lookup?function=${batch.join(",")}&filter=true`);
    const json = (await res.json()) as { result?: { function?: Record<string, { name: string }[] | null> } };
    for (const [sel, entries] of Object.entries(json.result?.function ?? {})) {
      if (entries && entries.length) names[sel] = entries.map((e) => e.name).join(" | ");
    }
  }
  for (const s of list) console.log(" ", s, names[s] ?? "?");

  // Buy, then try to sell with and without approval.
  const curveC = new ethers.Contract(curve, [
    "function buy(uint256,uint256,address) payable returns (uint256)",
    "function sell(uint256,uint256,address) returns (uint256)",
    "function getReserves() view returns (uint256,uint256)",
    "function quoteBuy(uint256) view returns (uint256)",
    "function quoteSell(uint256) view returns (uint256)",
    "function getAmountOut(uint256,bool) view returns (uint256)",
    "function previewBuy(uint256) view returns (uint256)",
    "function previewSell(uint256) view returns (uint256)",
    "function feeBps() view returns (uint256)",
    "function snipeTaxBps() view returns (uint256)",
    "function snipeTaxWindow() view returns (uint256)",
    "function launchedAt() view returns (uint256)",
  ], ethers.provider);
  const erc20 = new ethers.Contract(token, [
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
  ], ethers.provider);

  const spend = ethers.parseEther("0.05");
  for (const fn of ["quoteBuy", "previewBuy"]) {
    try { console.log(fn, (await curveC.getFunction(fn)(spend)).toString()); } catch (e) { console.log(fn, "revert/absent"); }
  }
  try { console.log("getAmountOut(buy)", (await curveC.getAmountOut(spend, true)).toString()); } catch { console.log("getAmountOut absent"); }
  const [q0, t0] = await curveC.getReserves();
  console.log("reserves before", ethers.formatEther(q0), ethers.formatEther(t0));
  const buyTx = await curveC.connect(trader).buy(spend, 0, trader.address, { value: spend });
  const buyR = await buyTx.wait();
  const bal = await erc20.balanceOf(trader.address);
  const [q1, t1] = await curveC.getReserves();
  console.log("bought", ethers.formatEther(bal), "tokens for 0.05 ETH; reserves after", ethers.formatEther(q1), ethers.formatEther(t1), "gas", buyR?.gasUsed.toString());
  // constant-product estimate for 0.05 net of 1% fee
  const net = (spend * 9900n) / 10000n;
  const est = (t0 * net) / (q0 + net);
  console.log("cp estimate", ethers.formatEther(est), "ratio actual/est", Number(bal * 10000n / est) / 10000);

  for (const fn of ["quoteSell", "previewSell"]) {
    try { console.log(fn, ethers.formatEther(await curveC.getFunction(fn)(bal / 2n))); } catch { console.log(fn, "revert/absent"); }
  }
  const half = bal / 2n;
  try {
    await curveC.connect(trader).sell.staticCall(half, 0, trader.address);
    console.log("sell without approval: OK (no allowance needed)");
  } catch (e) {
    console.log("sell without approval reverts:", (e as Error).message.slice(0, 120));
    await (await erc20.connect(trader).approve(curve, half)).wait();
    console.log("allowance", (await erc20.allowance(trader.address, curve)).toString());
  }
  const before = await ethers.provider.getBalance(trader.address);
  const sellTx = await curveC.connect(trader).sell(half, 0, trader.address);
  const sellR = await sellTx.wait();
  const after = await ethers.provider.getBalance(trader.address);
  console.log("sold half: eth delta", ethers.formatEther(after - before + sellR!.gasUsed * sellR!.gasPrice), "gas", sellR?.gasUsed.toString());
  console.log("token balance now", ethers.formatEther(await erc20.balanceOf(trader.address)));
  // Which events did sell emit?
  for (const l of sellR!.logs) console.log("  log", l.address === curve ? "curve" : l.address === token ? "token" : l.address, l.topics[0].slice(0, 10));
}

main().catch((e) => { console.error(e); process.exit(1); });
