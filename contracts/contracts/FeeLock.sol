// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPonsCurve, IPonsFeeEscrow} from "./interfaces/IPonsV2.sol";

/// The one thing a lock reads back from the router: where the pad's share goes.
interface ILockpadTreasury {
    function treasury() external view returns (address);
}

/**
 * One per launch. Pons pays the token's creator fees to this contract — it
 * is registered as the creator-fee recipient at launch — and the rule below
 * is fixed at deployment. There is no admin and no override; the router
 * only names the token and curve once, in the launch transaction.
 *
 *   1. Before graduation nothing leaves. Fees accumulate here.
 *   2. From the moment graduation is recorded, everything received — then
 *      and later — unlocks linearly over `vestDuration`; after that, fees
 *      pass straight through. Every release pays the creator, less the
 *      pad's share, which is only ever taken from what the creator unlocks.
 *   3. If the curve has not graduated by `deadline`, anyone can bury the
 *      lock: its ETH buys the token back on the curve and the tokens go to
 *      the dead address. A buried lock never pays the creator — or the
 *      pad — again; whatever arrives later is buried too.
 *
 * Burials are open calls, so they are sliced to stay sandwich-proof: one
 * call spends at most BURY_SLICE_BPS of the curve's quote reserve, and
 * calls are at least BURY_INTERVAL apart. Moving the price by p costs an
 * attacker about 2% of p × reserves in trade fees and wins them at most
 * p × slice, so a slice under 2% of reserves cannot be sandwiched at a
 * profit — whatever the caller's slippage setting, which is why there is
 * none.
 *
 * Graduation is recorded when first observed here (`checkpoint()`, or any
 * release). Anyone can call it, and the site does so on the token's page.
 */
contract FeeLock is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint16 public constant BPS = 10_000;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// One burial spends at most this share of the curve's quote reserve
    /// (virtual liquidity included) …
    uint16 public constant BURY_SLICE_BPS = 200;
    /// … and burials are at least this far apart.
    uint64 public constant BURY_INTERVAL = 1 hours;

    /// The router this lock was created for: the only address allowed to arm
    /// it, and where the pad's treasury address is read from.
    address public immutable router;
    IPonsFeeEscrow public immutable escrow;
    uint64 public immutable launchedAt;
    /// Graduate by this timestamp or the lock can be buried.
    uint64 public immutable deadline;
    /// How long fees take to unlock once graduation is recorded.
    uint64 public immutable vestDuration;
    /// The pad's share of every release, in basis points. Fixed here so the
    /// router's owner cannot change it for a lock that already exists.
    uint16 public immutable padBps;

    address public creator;
    address public pendingCreator;
    IPonsCurve public curve;
    IERC20 public token;

    /// When graduation was first observed here. Zero until then.
    uint64 public graduatedAt;
    bool public buried;
    uint64 public lastBuryAt;

    /// Every wei that ever arrived here.
    uint256 public totalReceived;
    /// Every wei paid out by releases, creator and pad together.
    uint256 public totalReleased;
    /// Every wei spent on burials.
    uint256 public totalBuried;
    uint256 public tokensBurned;

    struct Status {
        bool armed;
        /// Graduation as recorded here …
        bool graduated;
        /// … and as the curve reports it right now. When these differ, a
        /// `checkpoint()` is due.
        bool graduatedLive;
        uint64 graduatedAt;
        uint64 deadline;
        uint64 vestEnd;
        bool buried;
        /// What the next burial would spend, and when it can happen.
        uint256 buryable;
        uint64 nextBuryAt;
        /// ETH still in Pons' escrow, not yet pulled here.
        uint256 pending;
        uint256 balance;
        uint256 releasable;
        uint256 locked;
        uint256 totalReceived;
        uint256 totalReleased;
        uint256 totalBuried;
        uint256 tokensBurned;
    }

    event Armed(address indexed token, address indexed curve);
    event Received(uint256 amount);
    event GraduationRecorded(uint64 at);
    event Released(address indexed creator, uint256 toCreator, uint256 toPad);
    event Buried(uint64 at);
    event Burial(uint256 spent, uint256 burned);
    event CreatorProposed(address indexed current, address indexed proposed);
    event CreatorTransferred(address indexed previous, address indexed current);

    error OnlyRouter();
    error OnlyCreator();
    error OnlyPendingCreator();
    error AlreadyArmed();
    error NotArmed();
    error ZeroAddress();
    error BadSplit();
    error ZeroDuration();
    error DeadlineInPast();
    error NothingToRelease();
    error NothingToBury();
    error Graduated();
    error BeforeDeadline(uint64 deadline);
    error BuryCooldown(uint64 until);
    error TransferFailed();

    constructor(
        address router_,
        address creator_,
        IPonsFeeEscrow escrow_,
        uint64 deadline_,
        uint64 vestDuration_,
        uint16 padBps_
    ) {
        if (router_ == address(0) || creator_ == address(0) || address(escrow_) == address(0)) {
            revert ZeroAddress();
        }
        if (padBps_ > BPS) revert BadSplit();
        if (vestDuration_ == 0) revert ZeroDuration();
        if (deadline_ <= block.timestamp) revert DeadlineInPast();
        router = router_;
        creator = creator_;
        escrow = escrow_;
        launchedAt = uint64(block.timestamp);
        deadline = deadline_;
        vestDuration = vestDuration_;
        padBps = padBps_;
    }

    /// Called once by the router, in the launch transaction.
    function arm(IERC20 token_, IPonsCurve curve_) external {
        if (msg.sender != router) revert OnlyRouter();
        if (address(curve) != address(0)) revert AlreadyArmed();
        if (address(token_) == address(0) || address(curve_) == address(0)) revert ZeroAddress();
        token = token_;
        curve = curve_;
        emit Armed(address(token_), address(curve_));
    }

    /// The escrow pays in native ETH. Anything else that lands here follows
    /// the same rule.
    receive() external payable {
        totalReceived += msg.value;
        emit Received(msg.value);
    }

    // ───────────────────────────────────────────── schedule ──

    function vestEnd() public view returns (uint64) {
        return graduatedAt == 0 ? 0 : graduatedAt + vestDuration;
    }

    /// Wei unlocked by `timestamp`, released or not.
    function vestedAmount(uint64 timestamp) public view returns (uint256) {
        if (buried || graduatedAt == 0 || timestamp < graduatedAt) return 0;
        if (timestamp >= graduatedAt + vestDuration) return totalReceived;
        return (totalReceived * (timestamp - graduatedAt)) / vestDuration;
    }

    /// Unlocked, pulled here, and not yet paid out.
    function releasable() public view returns (uint256) {
        return vestedAmount(uint64(block.timestamp)) - totalReleased;
    }

    /// Here and still behind the rule.
    function locked() public view returns (uint256) {
        return address(this).balance - releasable();
    }

    /// Creator fees waiting in Pons' escrow, not yet pulled here.
    function pending() public view returns (uint256) {
        return escrow.balanceOf(address(this));
    }

    function status() external view returns (Status memory s) {
        s.armed = address(curve) != address(0);
        s.graduated = graduatedAt != 0;
        s.graduatedLive = s.armed && (s.graduated || curve.graduated());
        s.graduatedAt = graduatedAt;
        s.deadline = deadline;
        s.vestEnd = vestEnd();
        s.buried = buried;
        s.buryable = buryable();
        s.nextBuryAt = lastBuryAt == 0 ? 0 : lastBuryAt + BURY_INTERVAL;
        s.pending = pending();
        s.balance = address(this).balance;
        s.releasable = releasable();
        s.locked = s.balance - s.releasable;
        s.totalReceived = totalReceived;
        s.totalReleased = totalReleased;
        s.totalBuried = totalBuried;
        s.tokensBurned = tokensBurned;
    }

    /// What the next burial would spend: everything here and in escrow,
    /// capped at BURY_SLICE_BPS of the curve's quote reserve.
    function buryable() public view returns (uint256) {
        if (address(curve) == address(0)) return 0;
        uint256 held = address(this).balance + pending();
        (uint256 quote, ) = curve.getReserves();
        uint256 cap = (quote * BURY_SLICE_BPS) / BPS;
        return held < cap ? held : cap;
    }

    // ───────────────────────────────────────────── actions ──

    /// Records graduation the first time the curve reports it. Anyone.
    function checkpoint() public returns (bool) {
        if (graduatedAt != 0) return true;
        if (buried || address(curve) == address(0)) return false;
        if (!curve.graduated()) return false;
        graduatedAt = uint64(block.timestamp);
        emit GraduationRecorded(graduatedAt);
        return true;
    }

    /// Pulls fees from the escrow, records graduation if due, and pays out
    /// whatever the schedule has unlocked. Anyone can trigger; it always
    /// pays the creator and the treasury.
    function release() external nonReentrant returns (uint256 toCreator, uint256 toPad) {
        if (address(curve) == address(0)) revert NotArmed();
        _pull();
        checkpoint();
        uint256 amount = releasable();
        if (amount == 0) revert NothingToRelease();
        totalReleased += amount;
        toPad = (amount * padBps) / BPS;
        toCreator = amount - toPad;
        _pay(creator, toCreator);
        if (toPad > 0) _pay(ILockpadTreasury(router).treasury(), toPad);
        emit Released(creator, toCreator, toPad);
    }

    /// Once the deadline has passed without graduation: buy the token back
    /// with what is held here — one slice per call, one call per hour — and
    /// send it to the dead address. Anyone.
    function bury() external nonReentrant returns (uint256 spent, uint256 burned) {
        if (address(curve) == address(0)) revert NotArmed();
        _pull();
        if (!buried) {
            if (graduatedAt != 0 || curve.graduated()) revert Graduated();
            if (block.timestamp < deadline) revert BeforeDeadline(deadline);
            buried = true;
            emit Buried(uint64(block.timestamp));
        }
        if (lastBuryAt != 0 && block.timestamp < lastBuryAt + BURY_INTERVAL) {
            revert BuryCooldown(lastBuryAt + BURY_INTERVAL);
        }
        uint256 held = address(this).balance;
        (uint256 quote, ) = curve.getReserves();
        spent = (quote * BURY_SLICE_BPS) / BPS;
        if (spent > held) spent = held;
        if (spent == 0) revert NothingToBury();
        lastBuryAt = uint64(block.timestamp);
        totalBuried += spent;
        curve.buy{value: spent}(spent, 0, address(this));
        burned = token.balanceOf(address(this));
        token.safeTransfer(DEAD, burned);
        tokensBurned += burned;
        emit Burial(spent, burned);
    }

    /// Two-step hand-over of the creator role (a rotated wallet, a multisig).
    /// Changes who is paid, never when or how much.
    function proposeCreator(address proposed) external {
        if (msg.sender != creator) revert OnlyCreator();
        pendingCreator = proposed;
        emit CreatorProposed(creator, proposed);
    }

    function acceptCreator() external {
        if (msg.sender != pendingCreator || msg.sender == address(0)) revert OnlyPendingCreator();
        address previous = creator;
        creator = msg.sender;
        pendingCreator = address(0);
        emit CreatorTransferred(previous, msg.sender);
    }

    // ───────────────────────────────────────────── internals ──

    function _pull() private {
        if (escrow.balanceOf(address(this)) > 0) {
            escrow.claim();
        }
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
