// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * One per launch with a developer buy. Pons delivers the developer's tokens
 * here in the launch transaction — this contract is the buy recipient, not
 * the creator's wallet — and they unlock linearly from `start` over
 * `duration`. There is no admin, no clawback and no way to speed it up: the
 * schedule is fixed at deployment and the router only names the token once.
 *
 * Anything sent here later vests on the same schedule, like an
 * OpenZeppelin VestingWallet.
 */
contract DevVesting {
    using SafeERC20 for IERC20;

    /// The router this lock was created for; the only address allowed to arm it.
    address public immutable router;
    uint64 public immutable start;
    uint64 public immutable duration;

    address public beneficiary;
    address public pendingBeneficiary;
    IERC20 public token;
    /// Tokens delivered by the launch, recorded when the router arms the lock.
    uint256 public allocation;
    uint256 public released;

    event Armed(address indexed token, uint256 allocation);
    event Released(address indexed to, uint256 amount);
    event BeneficiaryProposed(address indexed current, address indexed proposed);
    event BeneficiaryTransferred(address indexed previous, address indexed current);

    error OnlyRouter();
    error OnlyBeneficiary();
    error OnlyPendingBeneficiary();
    error AlreadyArmed();
    error NotArmed();
    error ZeroAddress();
    error ZeroDuration();
    error NothingToRelease();

    constructor(address router_, address beneficiary_, uint64 start_, uint64 duration_) {
        if (router_ == address(0) || beneficiary_ == address(0)) revert ZeroAddress();
        if (duration_ == 0) revert ZeroDuration();
        router = router_;
        beneficiary = beneficiary_;
        start = start_;
        duration = duration_;
    }

    /// Called once by the router, in the launch transaction, after Pons has
    /// delivered the developer buy here.
    function arm(IERC20 token_) external {
        if (msg.sender != router) revert OnlyRouter();
        if (address(token) != address(0)) revert AlreadyArmed();
        if (address(token_) == address(0)) revert ZeroAddress();
        token = token_;
        allocation = token_.balanceOf(address(this));
        emit Armed(address(token_), allocation);
    }

    // ───────────────────────────────────────────── schedule ──

    function end() public view returns (uint64) {
        return start + duration;
    }

    /// Everything this lock has ever held: paid out plus still here.
    function total() public view returns (uint256) {
        if (address(token) == address(0)) return 0;
        return released + token.balanceOf(address(this));
    }

    /// Tokens unlocked by `timestamp`, released or not.
    function vestedAmount(uint64 timestamp) public view returns (uint256) {
        uint256 t = total();
        if (timestamp < start) return 0;
        if (timestamp >= start + duration) return t;
        return (t * (timestamp - start)) / duration;
    }

    /// Unlocked and not yet paid out.
    function releasable() public view returns (uint256) {
        return vestedAmount(uint64(block.timestamp)) - released;
    }

    /// Still behind the schedule.
    function locked() external view returns (uint256) {
        return total() - vestedAmount(uint64(block.timestamp));
    }

    // ───────────────────────────────────────────── actions ──

    /// Anyone can trigger; it always pays the beneficiary.
    function release() external returns (uint256 amount) {
        if (address(token) == address(0)) revert NotArmed();
        amount = releasable();
        if (amount == 0) revert NothingToRelease();
        released += amount;
        token.safeTransfer(beneficiary, amount);
        emit Released(beneficiary, amount);
    }

    /// Two-step hand-over of the beneficiary role (a rotated wallet, a
    /// multisig). Changes who is paid, never when.
    function proposeBeneficiary(address proposed) external {
        if (msg.sender != beneficiary) revert OnlyBeneficiary();
        pendingBeneficiary = proposed;
        emit BeneficiaryProposed(beneficiary, proposed);
    }

    function acceptBeneficiary() external {
        if (msg.sender != pendingBeneficiary || msg.sender == address(0)) revert OnlyPendingBeneficiary();
        address previous = beneficiary;
        beneficiary = msg.sender;
        pendingBeneficiary = address(0);
        emit BeneficiaryTransferred(previous, msg.sender);
    }
}
