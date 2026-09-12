import * as http from "http";
import { ethers, network } from "hardhat";

/**
 * Front-end rehearsal without a live deployment: seeds the in-process fork
 * (FORK_URL) with the router and three launches in three states, then
 * serves that network over JSON-RPC on PORT (default 8546) so the site can
 * be pointed at it:
 *
 *   FORK_URL=https://rpc.mainnet.chain.robinhood.com npx hardhat run scripts/serve-fork.ts
 *
 *   NEXT_PUBLIC_LOCKPAD_ROUTER=<printed>
 *   NEXT_PUBLIC_ROBINHOOD_RPC_URL=http://127.0.0.1:8546
 *   NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=31337
 *
 * Why in-process rather than `hardhat node`: the public Robinhood RPC only
 * keeps recent state, and a forked node that runs for more than a couple of
 * minutes starts failing remote reads. Seeding in one go and warming every
 * slot the site reads keeps everything cached.
 *
 * States seeded:
 *   1. buried    — 3-day window, deadline passed, buried once
 *   2. graduated — bought past 4.2 ETH, checkpointed, six days into the vest
 *   3. fresh     — a developer buy vesting over 90 days
 */
const PONS_FACTORY = "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const DAY = 24 * 60 * 60;
const PORT = Number(process.env.PORT ?? 8546);

const CURVE_ABI = [
  "function graduated() view returns (bool)",
  "function buy(uint256,uint256,address) payable returns (uint256)",
  "function realQuoteReserve() view returns (uint256)",
  "function getReserves() view returns (uint256,uint256)",
  "function graduationThreshold() view returns (uint256)",
  "function launchSupply() view returns (uint256)",
  "function quoteFeeBalance() view returns (uint256)",
  "function protocolFeeShareBps() view returns (uint256)",
  "function feeBps() view returns (uint256)",
  "function creatorTaxBps() view returns (uint256)",
  "function currentSnipeTaxBps(address) view returns (uint256)",
  "function maxInternalPriceImpactBps() view returns (uint256)",
  "function sell(uint256,uint256,address) returns (uint256)",
];
const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

async function increaseTime(seconds: number) {
  await network.provider.send("evm_increaseTime", [seconds]);
  await network.provider.send("evm_mine", []);
}

async function main() {
  const [deployer, creator, trader, whale] = await ethers.getSigners();
  if ((await ethers.provider.getCode(PONS_FACTORY)) === "0x")
    throw new Error(
      "no Pons factory code — set FORK_URL to a Robinhood Chain RPC"
    );

  const lockFactory = await (
    await ethers.getContractFactory("LockFactory")
  ).deploy();
  await lockFactory.waitForDeployment();
  const router = await (
    await ethers.getContractFactory("LockpadRouter")
  ).deploy(
    PONS_FACTORY,
    await lockFactory.getAddress(),
    deployer.address,
    deployer.address
  );
  await router.waitForDeployment();
  const routerAddress = await router.getAddress();
  const ponsFee = await router.ponsLaunchFee();

  const launch = async (overrides: Record<string, unknown>) => {
    const p = {
      name: "Seed",
      symbol: "SEED",
      logo: "",
      description: "Seeded on a fork for the front end.",
      x: "https://x.com/lockpad_",
      telegram: "",
      website: "",
      creatorTaxBps: 0,
      salt: ethers.hexlify(ethers.randomBytes(32)),
      developerBuy: 0n,
      minTokensOut: 0n,
      vestDuration: BigInt(90 * DAY),
      graduationWindow: BigInt(14 * DAY),
      ...overrides,
    };
    const tx = await router
      .connect(creator)
      .launch(p, { value: ponsFee + (p.developerBuy as bigint) });
    const receipt = await tx.wait();
    const ev = receipt!.logs
      .map((l) => {
        try {
          return router.interface.parseLog({
            topics: [...l.topics],
            data: l.data,
          });
        } catch {
          return null;
        }
      })
      .find((e) => e?.name === "Launched")!;
    const [token, curve] = ev.args as unknown as [string, string];
    return {
      token,
      curve: new ethers.Contract(curve, CURVE_ABI, ethers.provider),
    };
  };

  const buy = async (
    curve: import("ethers").Contract,
    who: import("ethers").Signer,
    eth: string
  ) => {
    const v = ethers.parseEther(eth);
    await (
      await curve.connect(who).getFunction("buy")(
        v,
        0,
        await who.getAddress(),
        { value: v }
      )
    ).wait();
  };

  /** Touch every view the site reads so the fork has it cached. */
  const warm = async (token: string, curve: import("ethers").Contract) => {
    await router.lockStatus(token);
    await router.infoOf(token);
    await curve.getReserves();
    await curve.realQuoteReserve();
    await curve.graduationThreshold();
    await curve.launchSupply();
    await curve.graduated();
    await curve.quoteFeeBalance().catch(() => 0n);
    await curve.protocolFeeShareBps().catch(() => 0n);
    await curve.feeBps().catch(() => 0n);
    await curve.creatorTaxBps().catch(() => 0n);
    await curve.currentSnipeTaxBps(creator.address).catch(() => 0n);
    await curve.maxInternalPriceImpactBps().catch(() => 0n);
    const erc20 = new ethers.Contract(token, ERC20_ABI, ethers.provider);
    await erc20.balanceOf(creator.address);
    await erc20.allowance(creator.address, await curve.getAddress());
  };

  // SEED=fresh skips the buried and graduated launches: the public RPC's
  // state retention is short and the graduation alone is nine buys.
  const only = process.env.SEED?.trim();

  // 3. Fresh (first, so it is there even if the RPC gives up later)
  const c = await launch({
    name: "Padlock",
    symbol: "LOCK",
    description:
      "Fresh launch with a 0.03 ETH developer buy vesting over 90 days.",
    graduationWindow: BigInt(14 * DAY),
    developerBuy: ethers.parseEther("0.03"),
    vestDuration: BigInt(90 * DAY),
  });
  await buy(c.curve, trader, "0.15");
  await buy(c.curve, trader, "0.05");
  // The creator (hardhat account #1, the address the browser stub signs as)
  // buys and sells once too, so both paths are warm for the trade panel.
  await buy(c.curve, creator, "0.01");
  const cErc20 = new ethers.Contract(c.token, ERC20_ABI, ethers.provider);
  const cBal = (await cErc20.balanceOf(creator.address)) as bigint;
  await (
    await cErc20.connect(creator).getFunction("approve")(
      await c.curve.getAddress(),
      cBal / 4n
    )
  ).wait();
  await (
    await c.curve.connect(creator).getFunction("sell")(
      cBal / 4n,
      0,
      creator.address
    )
  ).wait();
  await warm(c.token, c.curve);
  console.log(
    "fresh    ",
    c.token,
    "(creator holds",
    ethers.formatEther(await cErc20.balanceOf(creator.address)),
    "tokens)"
  );

  if (only !== "fresh") {
    // 1. Buried
    const a = await launch({
      name: "Ghost Town",
      symbol: "GHOST",
      description:
        "Launched, traded a little, never graduated. Buried after its 3-day window.",
      graduationWindow: BigInt(3 * DAY),
      developerBuy: ethers.parseEther("0.02"),
      vestDuration: BigInt(30 * DAY),
    });
    await buy(a.curve, trader, "0.2");
    await buy(a.curve, trader, "0.1");
    await increaseTime(3 * DAY + 60);
    // Pons sweeps curve fees to its escrow on its own schedule and refuses the
    // call from outside, so on a fork the lock would hold nothing: send it the
    // fees it would have received by now.
    const aLock = (await router.infoOf(a.token)).feeLock;
    await (
      await trader.sendTransaction({
        to: aLock,
        value: ethers.parseEther("0.0021"),
      })
    ).wait();
    await (
      await (await ethers.getContractAt("FeeLock", aLock))
        .connect(trader)
        .bury()
    ).wait();
    await warm(a.token, a.curve);
    console.log("buried   ", a.token);

    // 2. Graduated
    const b = await launch({
      name: "Moonshot",
      symbol: "MOON",
      description:
        "Graduated for real on the fork; fees unlocking over 30 days.",
      graduationWindow: BigInt(14 * DAY),
      developerBuy: ethers.parseEther("0.05"),
      vestDuration: BigInt(180 * DAY),
    });
    for (let i = 0; i < 12 && !(await b.curve.graduated()); i++)
      await buy(b.curve, whale, "0.5");
    await (await router.connect(trader).checkpoint(b.token)).wait();
    await increaseTime(6 * DAY);
    await warm(b.token, b.curve);
    console.log("graduated", b.token, "graduated:", await b.curve.graduated());
  }

  // Multicall3 code, so viem's batched reads work.
  if ((await ethers.provider.getCode(MULTICALL3)) === "0x")
    console.log("warning: no Multicall3 on this fork");

  console.log(`\nNEXT_PUBLIC_LOCKPAD_ROUTER=${routerAddress}`);
  console.log(`NEXT_PUBLIC_ROBINHOOD_RPC_URL=http://127.0.0.1:${PORT}`);
  console.log("NEXT_PUBLIC_ROBINHOOD_CHAIN_ID=31337");

  const server = http.createServer((req, res) => {
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", "content-type");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400);
        res.end("bad json");
        return;
      }
      const handle = async (call: {
        id?: unknown;
        method: string;
        params?: unknown[];
      }) => {
        try {
          const result = await network.provider.request({
            method: call.method,
            params: call.params ?? [],
          });
          return { jsonrpc: "2.0", id: call.id ?? null, result };
        } catch (e) {
          const err = e as { code?: number; message?: string; data?: unknown };
          return {
            jsonrpc: "2.0",
            id: call.id ?? null,
            error: {
              code: typeof err.code === "number" ? err.code : -32000,
              message: err.message ?? "error",
              data: err.data,
            },
          };
        }
      };
      const out = Array.isArray(payload)
        ? await Promise.all(payload.map(handle))
        : await handle(payload as { method: string });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    });
  });
  server.listen(PORT, () =>
    console.log(
      `\nserving the seeded fork on http://127.0.0.1:${PORT} — Ctrl+C to stop`
    )
  );
  await new Promise(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
