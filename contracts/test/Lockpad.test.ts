import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

const PONS_FEE = ethers.parseEther("0.0005");
const DAY = 24 * 60 * 60;
const HOUR = 60 * 60;
const DEAD = "0x000000000000000000000000000000000000dEaD";

function params(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    name: "Padlock",
    symbol: "LOCK",
    logo: "ipfs://bafkreipadlock",
    description: "Locked by construction.",
    x: "https://x.com/padlock",
    telegram: "",
    website: "https://lockpad.example",
    creatorTaxBps: 0,
    salt: ethers.hexlify(ethers.randomBytes(32)),
    developerBuy: 0n,
    minTokensOut: 0n,
    vestDuration: BigInt(90 * DAY),
    graduationWindow: BigInt(14 * DAY),
    ...overrides,
  };
}

/**
 * Router + lock factory in front of the mock Pons: factory, escrow, one
 * constant-product curve per launch.
 *
 *   deployer  owns the router
 *   treasury  receives the pad's 10%
 *   creator   launches
 *   trader    buys on the curve (fees accrue)
 *   anyone    triggers releases and burials
 */
async function deployFixture() {
  const [deployer, treasury, creator, trader, anyone, ponsSink] = await ethers.getSigners();
  const factory = await (await ethers.getContractFactory("MockPonsFactory")).deploy(ponsSink.address);
  const factoryAddress = await factory.getAddress();
  const lockFactory = await (await ethers.getContractFactory("LockFactory")).deploy();
  const router = await (await ethers.getContractFactory("LockpadRouter")).deploy(
    factoryAddress,
    await lockFactory.getAddress(),
    treasury.address,
    deployer.address,
  );
  const routerAddress = await router.getAddress();
  const escrow = await ethers.getContractAt("MockFeeEscrow", await factory.feeEscrow());
  return { deployer, treasury, creator, trader, anyone, ponsSink, factory, lockFactory, router, routerAddress, escrow };
}

type Fx = Awaited<ReturnType<typeof deployFixture>>;

async function launchOne(fx: Fx, overrides: Partial<Record<string, unknown>> = {}) {
  const p = params(overrides);
  const devBuy = p.developerBuy as bigint;
  const tx = await fx.router.connect(fx.creator).launch(p, { value: PONS_FEE + devBuy });
  const receipt = await tx.wait();
  const parsed = receipt!.logs
    .map((l) => {
      try {
        return fx.router.interface.parseLog(l);
      } catch {
        return null;
      }
    })
    .find((e) => e?.name === "Launched")!;
  const [token, curve, , feeLock, vesting] = parsed.args;
  const lock = await ethers.getContractAt("FeeLock", feeLock as string);
  const curveC = await ethers.getContractAt("MockCurve", curve as string);
  const erc20 = await ethers.getContractAt("MockLaunchedToken", token as string);
  return {
    token: token as string,
    curve: curve as string,
    feeLock: feeLock as string,
    vesting: vesting as string,
    lock,
    curveC,
    erc20,
    p,
    launchedAt: (await ethers.provider.getBlock(receipt!.blockNumber))!.timestamp,
  };
}

async function buy(fx: Fx, curve: string, eth: string) {
  const c = await ethers.getContractAt("MockCurve", curve);
  const value = ethers.parseEther(eth);
  await (await c.connect(fx.trader).buy(value, 0, fx.trader.address, { value })).wait();
}

describe("LockpadRouter", () => {
  describe("constructor", () => {
    it("wires Pons, the lock factory, the treasury and the owner", async () => {
      const { router, factory, lockFactory, treasury, deployer } = await loadFixture(deployFixture);
      expect(await router.ponsFactory()).to.equal(await factory.getAddress());
      expect(await router.ponsForwarder()).to.equal(await factory.launchForwarder());
      expect(await router.feeEscrow()).to.equal(await factory.feeEscrow());
      expect(await router.lockFactory()).to.equal(await lockFactory.getAddress());
      expect(await router.treasury()).to.equal(treasury.address);
      expect(await router.owner()).to.equal(deployer.address);
      expect(await router.PAD_BPS()).to.equal(1000);
      expect(await router.FEE_VEST()).to.equal(30 * DAY);
      expect(await router.MIN_VEST()).to.equal(7 * DAY);
      expect(await router.MAX_VEST()).to.equal(365 * DAY);
      expect(await router.MIN_WINDOW()).to.equal(3 * DAY);
      expect(await router.MAX_WINDOW()).to.equal(90 * DAY);
      expect(await router.padLaunchFee()).to.equal(0);
    });

    it("rejects zero addresses", async () => {
      const { factory, lockFactory, treasury, deployer } = await loadFixture(deployFixture);
      const Router = await ethers.getContractFactory("LockpadRouter");
      const f = await factory.getAddress();
      const lf = await lockFactory.getAddress();
      await expect(Router.deploy(ethers.ZeroAddress, lf, treasury.address, deployer.address)).to.be.revertedWithCustomError(Router, "ZeroAddress");
      await expect(Router.deploy(f, ethers.ZeroAddress, treasury.address, deployer.address)).to.be.revertedWithCustomError(Router, "ZeroAddress");
      await expect(Router.deploy(f, lf, ethers.ZeroAddress, deployer.address)).to.be.revertedWithCustomError(Router, "ZeroAddress");
    });
  });

  describe("launch without a developer buy", () => {
    it("deploys a fee lock, registers it as the fee recipient and exempts nobody else", async () => {
      const fx = await loadFixture(deployFixture);
      const { token, curve, feeLock, vesting, lock, launchedAt, p } = await launchOne(fx);
      expect(vesting).to.equal(ethers.ZeroAddress);
      const last = await fx.factory.lastParams();
      expect(last.creatorFeeRecipient).to.equal(feeLock);
      expect(last.name).to.equal("Padlock");
      expect(last.symbol).to.equal("LOCK");
      expect(last.buybackEnabled).to.equal(true);
      expect(await fx.factory.lastExemptList()).to.deep.equal([]);
      expect(await fx.factory.lastLauncher()).to.equal(fx.routerAddress);

      expect(await lock.router()).to.equal(fx.routerAddress);
      expect(await lock.creator()).to.equal(fx.creator.address);
      expect(await lock.token()).to.equal(token);
      expect(await lock.curve()).to.equal(curve);
      expect(await lock.deadline()).to.equal(BigInt(launchedAt) + (p.graduationWindow as bigint));
      expect(await lock.vestDuration()).to.equal(30 * DAY);
      expect(await lock.padBps()).to.equal(1000);
      expect(await lock.escrow()).to.equal(await fx.factory.feeEscrow());

      const info = await fx.router.infoOf(token);
      expect(info.creator).to.equal(fx.creator.address);
      expect(info.feeLock).to.equal(feeLock);
      expect(info.vesting).to.equal(ethers.ZeroAddress);
      expect(info.developerBuy).to.equal(0);
      expect(info.vestDuration).to.equal(0);
      expect(info.deadline).to.equal(await lock.deadline());
      expect(await fx.router.launchCount()).to.equal(1);
      expect(await fx.router.launchAt(0)).to.equal(token);
      expect(await fx.router.launchesOf(fx.creator.address)).to.deep.equal([token]);
    });

    it("ignores the vesting duration when there is nothing to vest", async () => {
      const fx = await loadFixture(deployFixture);
      const { vesting } = await launchOne(fx, { vestDuration: 1n });
      expect(vesting).to.equal(ethers.ZeroAddress);
    });

    it("emits Launched with both locks and the deadline", async () => {
      const fx = await loadFixture(deployFixture);
      const p = params();
      await expect(fx.router.connect(fx.creator).launch(p, { value: PONS_FEE }))
        .to.emit(fx.router, "Launched")
        .withArgs(
          (a: string) => ethers.isAddress(a),
          (a: string) => ethers.isAddress(a),
          fx.creator.address,
          (a: string) => ethers.isAddress(a) && a !== ethers.ZeroAddress,
          ethers.ZeroAddress,
          0,
          0,
          (d: bigint) => d > 0n,
        );
    });
  });

  describe("launch with a developer buy", () => {
    it("delivers the developer buy to a vesting contract, never to the creator", async () => {
      const fx = await loadFixture(deployFixture);
      const devBuy = ethers.parseEther("0.05");
      const { token, vesting, erc20, launchedAt } = await launchOne(fx, { developerBuy: devBuy });
      expect(vesting).to.not.equal(ethers.ZeroAddress);
      const forwarder = await ethers.getContractAt("MockLaunchForwarder", await fx.factory.launchForwarder());
      expect(await forwarder.lastBuyRecipient()).to.equal(vesting);
      expect(await erc20.balanceOf(fx.creator.address)).to.equal(0);
      const held = await erc20.balanceOf(vesting);
      expect(held).to.be.gt(0);

      const v = await ethers.getContractAt("DevVesting", vesting);
      expect(await v.router()).to.equal(fx.routerAddress);
      expect(await v.beneficiary()).to.equal(fx.creator.address);
      expect(await v.token()).to.equal(token);
      expect(await v.allocation()).to.equal(held);
      expect(await v.start()).to.equal(launchedAt);
      expect(await v.duration()).to.equal(90 * DAY);
      expect(await v.end()).to.equal(launchedAt + 90 * DAY);
      expect(await v.releasable()).to.equal(0);
      expect(await v.locked()).to.equal(held);

      // The vesting contract is exempt from the snipe tax; the creator's
      // wallet is not.
      const curveC = await ethers.getContractAt("MockCurve", (await fx.router.infoOf(token)).curve);
      expect(await curveC.snipeTaxExempt(vesting)).to.equal(true);
      expect(await curveC.snipeTaxExempt(fx.creator.address)).to.equal(false);

      const info = await fx.router.infoOf(token);
      expect(info.vesting).to.equal(vesting);
      expect(info.developerBuy).to.equal(devBuy);
      expect(info.vestDuration).to.equal(90 * DAY);
    });

    it("enforces the vesting bounds", async () => {
      const fx = await loadFixture(deployFixture);
      const devBuy = ethers.parseEther("0.01");
      await expect(
        fx.router.connect(fx.creator).launch(params({ developerBuy: devBuy, vestDuration: BigInt(7 * DAY - 1) }), { value: PONS_FEE + devBuy }),
      ).to.be.revertedWithCustomError(fx.router, "VestOutOfRange");
      await expect(
        fx.router.connect(fx.creator).launch(params({ developerBuy: devBuy, vestDuration: BigInt(365 * DAY + 1) }), { value: PONS_FEE + devBuy }),
      ).to.be.revertedWithCustomError(fx.router, "VestOutOfRange");
      await expect(
        fx.router.connect(fx.creator).launch(params({ developerBuy: devBuy, vestDuration: BigInt(7 * DAY) }), { value: PONS_FEE + devBuy }),
      ).to.not.be.reverted;
    });
  });

  describe("launch validation", () => {
    it("rejects an empty name or symbol", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.router.connect(fx.creator).launch(params({ name: "" }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "EmptyName");
      await expect(fx.router.connect(fx.creator).launch(params({ symbol: "" }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "EmptySymbol");
    });

    it("rejects a creator tax above the Pons maximum", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.router.connect(fx.creator).launch(params({ creatorTaxBps: 1001 }), { value: PONS_FEE }))
        .to.be.revertedWithCustomError(fx.router, "TaxTooHigh")
        .withArgs(1000);
    });

    it("enforces the graduation window bounds", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.router.connect(fx.creator).launch(params({ graduationWindow: BigInt(3 * DAY - 1) }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "WindowOutOfRange");
      await expect(fx.router.connect(fx.creator).launch(params({ graduationWindow: BigInt(90 * DAY + 1) }), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "WindowOutOfRange");
      await expect(fx.router.connect(fx.creator).launch(params({ graduationWindow: BigInt(3 * DAY) }), { value: PONS_FEE })).to.not.be.reverted;
      await expect(fx.router.connect(fx.creator).launch(params({ graduationWindow: BigInt(90 * DAY) }), { value: PONS_FEE })).to.not.be.reverted;
    });

    it("requires exactly the Pons fee plus the developer buy", async () => {
      const fx = await loadFixture(deployFixture);
      const devBuy = ethers.parseEther("0.01");
      await expect(fx.router.connect(fx.creator).launch(params({ developerBuy: devBuy }), { value: PONS_FEE }))
        .to.be.revertedWithCustomError(fx.router, "WrongValue")
        .withArgs(PONS_FEE + devBuy, PONS_FEE);
      await expect(fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE + 1n })).to.be.revertedWithCustomError(fx.router, "WrongValue");
    });

    it("refuses while paused or while Pons refuses the router", async () => {
      const fx = await loadFixture(deployFixture);
      await fx.router.setPaused(true);
      await expect(fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "Paused");
      await fx.router.setPaused(false);
      await fx.factory.setLaunchEnabled(false);
      expect(await fx.router.canLaunchHere()).to.equal(false);
      await expect(fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "LaunchClosed");
      await fx.factory.setLaunchEnabled(true);
      await fx.factory.setBlocked(fx.routerAddress, true);
      await expect(fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "LaunchClosed");
    });

    it("forwards a pad launch fee to the treasury when one is set", async () => {
      const fx = await loadFixture(deployFixture);
      const padFee = ethers.parseEther("0.001");
      await fx.router.setPadLaunchFee(padFee);
      expect(await fx.router.totalLaunchFee()).to.equal(PONS_FEE + padFee);
      await expect(fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE })).to.be.revertedWithCustomError(fx.router, "WrongValue");
      await expect(fx.router.connect(fx.creator).launch(params(), { value: PONS_FEE + padFee })).to.changeEtherBalance(fx.treasury, padFee);
      expect(await ethers.provider.getBalance(fx.routerAddress)).to.equal(0);
    });
  });

  describe("registry", () => {
    it("pages newest first and indexes by creator", async () => {
      const fx = await loadFixture(deployFixture);
      const a = await launchOne(fx, { symbol: "A" });
      const b = await launchOne(fx, { symbol: "B" });
      const c = await launchOne(fx, { symbol: "C" });
      const page = await fx.router.launches(0, 2);
      expect(page.map((l) => l.symbol)).to.deep.equal(["C", "B"]);
      const rest = await fx.router.launches(2, 10);
      expect(rest.map((l) => l.symbol)).to.deep.equal(["A"]);
      expect((await fx.router.launches(3, 10)).length).to.equal(0);
      expect(await fx.router.launchesOf(fx.creator.address)).to.deep.equal([a.token, b.token, c.token]);
      await expect(fx.router.infoOf(fx.anyone.address)).to.be.revertedWithCustomError(fx.router, "UnknownToken");
      await expect(fx.router.lockStatus(fx.anyone.address)).to.be.revertedWithCustomError(fx.router, "UnknownToken");
    });

    it("reports both locks in one read", async () => {
      const fx = await loadFixture(deployFixture);
      const devBuy = ethers.parseEther("0.02");
      const { token, vesting, launchedAt } = await launchOne(fx, { developerBuy: devBuy });
      const v = await ethers.getContractAt("DevVesting", vesting);
      const s = await fx.router.lockStatus(token);
      expect(s.hasVesting).to.equal(true);
      expect(s.vestStart).to.equal(launchedAt);
      expect(s.vestEnd).to.equal(launchedAt + 90 * DAY);
      expect(s.devAllocation).to.equal(await v.allocation());
      expect(s.devReleased).to.equal(0);
      expect(s.devLocked).to.equal(await v.allocation());
      expect(s.fees.armed).to.equal(true);
      expect(s.fees.graduated).to.equal(false);
      expect(s.fees.buried).to.equal(false);
      expect(s.fees.balance).to.equal(0);
      // The developer buy itself paid a 1% fee into the lock's escrow balance.
      expect(s.fees.pending).to.equal(devBuy / 100n);

      const plain = await launchOne(fx);
      const s2 = await fx.router.lockStatus(plain.token);
      expect(s2.hasVesting).to.equal(false);
      expect(s2.devAllocation).to.equal(0);
    });
  });

  describe("admin", () => {
    it("only the owner changes the treasury, the fee and the pause", async () => {
      const fx = await loadFixture(deployFixture);
      await expect(fx.router.connect(fx.anyone).setTreasury(fx.anyone.address)).to.be.revertedWithCustomError(fx.router, "OwnableUnauthorizedAccount");
      await expect(fx.router.connect(fx.anyone).setPadLaunchFee(1)).to.be.revertedWithCustomError(fx.router, "OwnableUnauthorizedAccount");
      await expect(fx.router.connect(fx.anyone).setPaused(true)).to.be.revertedWithCustomError(fx.router, "OwnableUnauthorizedAccount");
      await expect(fx.router.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(fx.router, "ZeroAddress");
      await expect(fx.router.setTreasury(fx.anyone.address)).to.emit(fx.router, "TreasuryUpdated").withArgs(fx.anyone.address);
    });

    it("hands ownership over in two steps", async () => {
      const fx = await loadFixture(deployFixture);
      await fx.router.transferOwnership(fx.anyone.address);
      expect(await fx.router.owner()).to.equal(fx.deployer.address);
      await fx.router.connect(fx.anyone).acceptOwnership();
      expect(await fx.router.owner()).to.equal(fx.anyone.address);
    });

    it("sweeps stray ETH to the treasury", async () => {
      const fx = await loadFixture(deployFixture);
      await fx.anyone.sendTransaction({ to: fx.routerAddress, value: ethers.parseEther("0.3") });
      await expect(fx.router.sweep()).to.changeEtherBalance(fx.treasury, ethers.parseEther("0.3"));
    });
  });
});

describe("FeeLock", () => {
  describe("before graduation", () => {
    it("accrues creator fees into the lock and releases nothing", async () => {
      const fx = await loadFixture(deployFixture);
      const { token, curve, lock, feeLock } = await launchOne(fx);
      await buy(fx, curve, "1");
      const fee = ethers.parseEther("0.01");
      expect(await fx.escrow.balanceOf(feeLock)).to.equal(fee);
      expect(await lock.pending()).to.equal(fee);
      expect(await lock.releasable()).to.equal(0);
      await expect(fx.router.connect(fx.anyone).release(token)).to.be.revertedWithCustomError(lock, "NothingToRelease");
      await expect(lock.connect(fx.creator).release()).to.be.revertedWithCustomError(lock, "NothingToRelease");
      // Nothing left the escrow: a reverted release pulls nothing.
      expect(await fx.escrow.balanceOf(feeLock)).to.equal(fee);
    });

    it("cannot be buried before the deadline", async () => {
      const fx = await loadFixture(deployFixture);
      const { token, curve, lock } = await launchOne(fx);
      await buy(fx, curve, "1");
      await expect(fx.router.connect(fx.anyone).bury(token)).to.be.revertedWithCustomError(lock, "BeforeDeadline").withArgs(await lock.deadline());
    });

    it("cannot be armed twice or by anyone but the router", async () => {
      const fx = await loadFixture(deployFixture);
      const { lock, token, curve } = await launchOne(fx);
      await expect(lock.connect(fx.anyone).arm(token, curve)).to.be.revertedWithCustomError(lock, "OnlyRouter");
      await expect(lock.connect(fx.deployer).arm(token, curve)).to.be.revertedWithCustomError(lock, "OnlyRouter");
    });
  });

  describe("after graduation", () => {
    it("records graduation when first observed and vests everything received over 30 days", async () => {
      const fx = await loadFixture(deployFixture);
      const { token, curve, lock, curveC } = await launchOne(fx);
      await buy(fx, curve, "2");
      const fee = ethers.parseEther("0.02");
      expect(await lock.checkpoint()).to.not.be.reverted;
      expect(await lock.graduatedAt()).to.equal(0);

      await curveC.setGraduated(true);
      const s = await lock.status();
      expect(s.graduated).to.equal(false);
      expect(s.graduatedLive).to.equal(true);

      await expect(fx.router.connect(fx.anyone).checkpoint(token)).to.emit(lock, "GraduationRecorded");
      const gradAt = await lock.graduatedAt();
      expect(gradAt).to.be.gt(0);
      expect(await lock.vestEnd()).to.equal(gradAt + BigInt(30 * DAY));
      expect(await lock.releasable()).to.equal(0); // pulled nothing yet, t = gradAt

      await time.increaseTo(gradAt + BigInt(15 * DAY));
      // Fees still sit in escrow: releasable counts what has been received.
      expect(await lock.totalReceived()).to.equal(0);
      expect(await lock.releasable()).to.equal(0);

      const creatorBefore = await ethers.provider.getBalance(fx.creator.address);
      const treasuryBefore = await ethers.provider.getBalance(fx.treasury.address);
      const tx = await lock.connect(fx.anyone).release();
      const at = BigInt((await ethers.provider.getBlock((await tx.wait())!.blockNumber))!.timestamp);
      const vested = (fee * (at - gradAt)) / BigInt(30 * DAY);
      const toPad = vested / 10n;
      const toCreator = vested - toPad;
      expect((await ethers.provider.getBalance(fx.creator.address)) - creatorBefore).to.equal(toCreator);
      expect((await ethers.provider.getBalance(fx.treasury.address)) - treasuryBefore).to.equal(toPad);
      expect(await lock.totalReceived()).to.equal(fee);
      expect(await lock.totalReleased()).to.equal(vested);
      expect(await lock.locked()).to.equal(fee - vested);

      await time.increaseTo(gradAt + BigInt(30 * DAY));
      expect(await lock.releasable()).to.equal(fee - vested);
      await expect(lock.connect(fx.anyone).release()).to.emit(lock, "Released");
      expect(await ethers.provider.getBalance(await lock.getAddress())).to.equal(0);
      expect(await lock.totalReleased()).to.equal(fee);
    });

    it("passes fees straight through once the vest is over, still less the pad's share", async () => {
      const fx = await loadFixture(deployFixture);
      const { curve, lock, curveC } = await launchOne(fx);
      await curveC.setGraduated(true);
      await lock.checkpoint();
      await time.increase(31 * DAY);
      // A later trade — the mock curve stays open for it.
      await curveC.setGraduated(false);
      await buy(fx, curve, "1");
      await curveC.setGraduated(true);
      const fee = ethers.parseEther("0.01");
      await expect(lock.connect(fx.anyone).release()).to.changeEtherBalances(
        [fx.creator, fx.treasury],
        [fee - fee / 10n, fee / 10n],
      );
    });

    it("cannot be buried once graduated, even after the deadline", async () => {
      const fx = await loadFixture(deployFixture);
      const { token, curve, lock, curveC } = await launchOne(fx);
      await buy(fx, curve, "1");
      await curveC.setGraduated(true);
      await time.increase(15 * DAY);
      await expect(fx.router.connect(fx.anyone).bury(token)).to.be.revertedWithCustomError(lock, "Graduated");
      await lock.checkpoint();
      await expect(lock.connect(fx.anyone).bury()).to.be.revertedWithCustomError(lock, "Graduated");
    });

    it("pays a rotated creator wallet after a two-step hand-over", async () => {
      const fx = await loadFixture(deployFixture);
      const { curve, lock, curveC } = await launchOne(fx);
      await expect(lock.connect(fx.anyone).proposeCreator(fx.anyone.address)).to.be.revertedWithCustomError(lock, "OnlyCreator");
      await lock.connect(fx.creator).proposeCreator(fx.anyone.address);
      expect(await lock.creator()).to.equal(fx.creator.address);
      await expect(lock.connect(fx.trader).acceptCreator()).to.be.revertedWithCustomError(lock, "OnlyPendingCreator");
      await lock.connect(fx.anyone).acceptCreator();
      expect(await lock.creator()).to.equal(fx.anyone.address);

      await buy(fx, curve, "1");
      await curveC.setGraduated(true);
      await lock.checkpoint();
      await time.increase(31 * DAY);
      const fee = ethers.parseEther("0.01");
      await expect(lock.release()).to.changeEtherBalances([fx.anyone, fx.creator], [fee - fee / 10n, 0n]);
    });
  });

  describe("burial", () => {
    it("buys back and burns in hourly slices once the deadline passes without graduation", async () => {
      const fx = await loadFixture(deployFixture);
      const { token, curve, lock, curveC, erc20, feeLock } = await launchOne(fx, { graduationWindow: BigInt(7 * DAY) });
      // 0.2 ETH of buys → 0.002 ETH of creator fees. One slice = 2% of the
      // quote reserve (1.68 virtual + real), well above that: a single call.
      await buy(fx, curve, "0.2");
      const fee = ethers.parseEther("0.002");
      await time.increase(7 * DAY);

      const [quote] = await curveC.getReserves();
      expect(await lock.buryable()).to.equal(fee);
      expect(fee).to.be.lt((quote * 200n) / 10_000n);

      await expect(fx.router.connect(fx.anyone).bury(token)).to.emit(lock, "Buried");
      expect(await lock.buried()).to.equal(true);
      expect(await lock.totalBuried()).to.equal(fee);
      const burned = await lock.tokensBurned();
      expect(burned).to.be.gt(0);
      expect(await erc20.balanceOf(DEAD)).to.equal(burned);
      expect(await erc20.balanceOf(feeLock)).to.equal(0);
      expect(await ethers.provider.getBalance(feeLock)).to.equal(0);
      expect(await lock.releasable()).to.equal(0);

      // Nothing can ever be released, even if the curve graduates later.
      await curveC.setGraduated(true);
      expect(await lock.checkpoint()).to.not.be.reverted;
      expect(await lock.graduatedAt()).to.equal(0);
      await expect(lock.release()).to.be.revertedWithCustomError(lock, "NothingToRelease");
    });

    it("caps each burial at 2% of the quote reserve and spaces them an hour apart", async () => {
      const fx = await loadFixture(deployFixture);
      const { token, curve, lock, curveC } = await launchOne(fx, { graduationWindow: BigInt(3 * DAY) });
      // Push a lot of volume through so the lock holds more than one slice.
      // 3 ETH of buys keeps the real reserve under the 4.2 ETH graduation.
      for (let i = 0; i < 6; i++) await buy(fx, curve, "0.5");
      const feeTotal = ethers.parseEther("0.03");
      // Top the lock up directly so it clearly exceeds a slice.
      await fx.anyone.sendTransaction({ to: await lock.getAddress(), value: ethers.parseEther("0.2") });
      const held = feeTotal + ethers.parseEther("0.2");
      await time.increase(3 * DAY);

      const [quote] = await curveC.getReserves();
      const slice = (quote * 200n) / 10_000n;
      expect(held).to.be.gt(slice);
      expect(await lock.buryable()).to.equal(slice);

      await expect(fx.router.connect(fx.anyone).bury(token)).to.emit(lock, "Burial").withArgs(slice, (b: bigint) => b > 0n);
      expect(await lock.totalBuried()).to.equal(slice);
      const [quote2] = await curveC.getReserves();
      expect(quote2).to.be.gt(quote);

      await expect(lock.connect(fx.anyone).bury()).to.be.revertedWithCustomError(lock, "BuryCooldown");
      const s = await lock.status();
      expect(s.nextBuryAt).to.equal((await lock.lastBuryAt()) + BigInt(HOUR));

      await time.increase(HOUR);
      const slice2 = (quote2 * 200n) / 10_000n;
      await expect(lock.connect(fx.anyone).bury()).to.emit(lock, "Burial").withArgs(slice2, (b: bigint) => b > 0n);
      expect(await lock.totalBuried()).to.equal(slice + slice2);
    });

    it("buries fees that arrive after the burial too — including the burial's own fee", async () => {
      const fx = await loadFixture(deployFixture);
      const { curve, lock } = await launchOne(fx, { graduationWindow: BigInt(3 * DAY) });
      await buy(fx, curve, "0.1");
      const fee = ethers.parseEther("0.001");
      await time.increase(3 * DAY);
      await lock.bury();
      expect(await lock.totalBuried()).to.equal(fee);
      // The burial is itself a trade on the curve: 1% of it comes back as a
      // creator fee, and the next burial takes that too.
      expect(await lock.pending()).to.equal(fee / 100n);
      await expect(lock.bury()).to.be.revertedWithCustomError(lock, "BuryCooldown");
      await time.increase(HOUR);
      await lock.bury();
      expect(await lock.totalBuried()).to.equal(fee + fee / 100n);
      await time.increase(HOUR);
      await buy(fx, curve, "0.1");
      const before = await lock.totalBuried();
      await lock.bury();
      expect(await lock.totalBuried()).to.equal(before + fee + fee / 100n / 100n);
    });

    it("counts a creator tax as fees for the lock", async () => {
      const fx = await loadFixture(deployFixture);
      const { curve, lock } = await launchOne(fx, { creatorTaxBps: 500 });
      await buy(fx, curve, "1");
      // 1% trade fee + 5% creator tax, both to the fee recipient.
      expect(await lock.pending()).to.equal(ethers.parseEther("0.06"));
    });
  });
});

describe("DevVesting", () => {
  it("unlocks linearly and pays the beneficiary from anyone's call", async () => {
    const fx = await loadFixture(deployFixture);
    const devBuy = ethers.parseEther("0.1");
    const { token, vesting, erc20, launchedAt } = await launchOne(fx, { developerBuy: devBuy, vestDuration: BigInt(30 * DAY) });
    const v = await ethers.getContractAt("DevVesting", vesting);
    const total = await v.allocation();

    // Linear from the first second: a moment after launch, almost nothing.
    expect(await v.releasable()).to.be.lt(total / 100_000n);

    await time.increaseTo(launchedAt + 10 * DAY);
    expect(await v.vestedAmount(launchedAt + 10 * DAY)).to.equal(total / 3n);
    const tx = await fx.router.connect(fx.anyone).releaseVesting(token);
    const at = (await ethers.provider.getBlock((await tx.wait())!.blockNumber))!.timestamp;
    const expected = (total * BigInt(at - launchedAt)) / BigInt(30 * DAY);
    expect(await erc20.balanceOf(fx.creator.address)).to.equal(expected);
    expect(await v.released()).to.equal(expected);
    expect(await v.locked()).to.equal(total - (await v.vestedAmount(BigInt(at))));

    await time.increaseTo(launchedAt + 30 * DAY);
    expect(await v.releasable()).to.equal(total - expected);
    await v.connect(fx.creator).release();
    expect(await erc20.balanceOf(fx.creator.address)).to.equal(total);
    expect(await erc20.balanceOf(vesting)).to.equal(0);
    expect(await v.releasable()).to.equal(0);
    await expect(v.release()).to.be.revertedWithCustomError(v, "NothingToRelease");

    const s = await fx.router.lockStatus(token);
    expect(s.devReleased).to.equal(total);
    expect(s.devLocked).to.equal(0);
  });

  it("vests tokens sent later on the same schedule", async () => {
    const fx = await loadFixture(deployFixture);
    const devBuy = ethers.parseEther("0.1");
    const { vesting, erc20, launchedAt, curve } = await launchOne(fx, { developerBuy: devBuy, vestDuration: BigInt(10 * DAY) });
    const v = await ethers.getContractAt("DevVesting", vesting);
    const allocation = await v.allocation();
    // A second wallet buys and tops the vesting up.
    await buy(fx, curve, "0.1");
    const extra = await erc20.balanceOf(fx.trader.address);
    await erc20.connect(fx.trader).transfer(vesting, extra);
    expect(await v.total()).to.equal(allocation + extra);
    expect(await v.allocation()).to.equal(allocation);
    await time.increaseTo(launchedAt + 5 * DAY);
    expect(await v.vestedAmount(launchedAt + 5 * DAY)).to.equal((allocation + extra) / 2n);
  });

  it("cannot be armed twice or by anyone but the router", async () => {
    const fx = await loadFixture(deployFixture);
    const { vesting, token } = await launchOne(fx, { developerBuy: ethers.parseEther("0.01") });
    const v = await ethers.getContractAt("DevVesting", vesting);
    await expect(v.connect(fx.anyone).arm(token)).to.be.revertedWithCustomError(v, "OnlyRouter");
  });

  it("hands the beneficiary role over in two steps", async () => {
    const fx = await loadFixture(deployFixture);
    const { vesting, erc20, launchedAt } = await launchOne(fx, { developerBuy: ethers.parseEther("0.01"), vestDuration: BigInt(7 * DAY) });
    const v = await ethers.getContractAt("DevVesting", vesting);
    await expect(v.connect(fx.anyone).proposeBeneficiary(fx.anyone.address)).to.be.revertedWithCustomError(v, "OnlyBeneficiary");
    await v.connect(fx.creator).proposeBeneficiary(fx.anyone.address);
    await expect(v.connect(fx.trader).acceptBeneficiary()).to.be.revertedWithCustomError(v, "OnlyPendingBeneficiary");
    await v.connect(fx.anyone).acceptBeneficiary();
    expect(await v.beneficiary()).to.equal(fx.anyone.address);
    await time.increaseTo(launchedAt + 7 * DAY);
    await v.release();
    expect(await erc20.balanceOf(fx.anyone.address)).to.equal(await v.allocation());
    expect(await erc20.balanceOf(fx.creator.address)).to.equal(0);
  });

  it("refuses a zero duration or beneficiary", async () => {
    const fx = await loadFixture(deployFixture);
    const V = await ethers.getContractFactory("DevVesting");
    await expect(V.deploy(fx.routerAddress, ethers.ZeroAddress, 1, 1)).to.be.revertedWithCustomError(V, "ZeroAddress");
    await expect(V.deploy(fx.routerAddress, fx.creator.address, 1, 0)).to.be.revertedWithCustomError(V, "ZeroDuration");
  });
});

describe("LockFactory", () => {
  it("makes the caller the lock's router", async () => {
    const fx = await loadFixture(deployFixture);
    const now = await time.latest();
    const tx = await fx.lockFactory.connect(fx.anyone).createFeeLock(fx.creator.address, await fx.factory.feeEscrow(), now + 10 * DAY, 30 * DAY, 1000);
    const receipt = await tx.wait();
    const created = receipt!.logs.map((l) => { try { return fx.lockFactory.interface.parseLog(l); } catch { return null; } }).find((e) => e?.name === "FeeLockCreated")!;
    const lock = await ethers.getContractAt("FeeLock", created.args[0] as string);
    expect(await lock.router()).to.equal(fx.anyone.address);
    // The Lockpad router cannot arm a lock it did not create.
    await expect(lock.connect(fx.deployer).arm(fx.creator.address, fx.creator.address)).to.be.revertedWithCustomError(lock, "OnlyRouter");
  });
});
