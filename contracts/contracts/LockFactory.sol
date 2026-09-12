// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPonsFeeEscrow} from "./interfaces/IPonsV2.sol";
import {FeeLock} from "./FeeLock.sol";
import {DevVesting} from "./DevVesting.sol";

/**
 * Deploys the two locks for the router. It lives in its own contract only
 * because a router that embeds both locks' creation code is over the
 * contract size limit. Anyone can call it; a lock created here belongs to
 * whoever called (that caller is the lock's `router`), so a lock created
 * outside the Lockpad router is simply not in the Lockpad registry.
 */
contract LockFactory {
    event FeeLockCreated(address indexed lock, address indexed router, address indexed creator);
    event DevVestingCreated(address indexed lock, address indexed router, address indexed beneficiary);

    function createFeeLock(
        address creator,
        IPonsFeeEscrow escrow,
        uint64 deadline,
        uint64 vestDuration,
        uint16 padBps
    ) external returns (FeeLock lock) {
        lock = new FeeLock(msg.sender, creator, escrow, deadline, vestDuration, padBps);
        emit FeeLockCreated(address(lock), msg.sender, creator);
    }

    function createDevVesting(address beneficiary, uint64 start, uint64 duration)
        external
        returns (DevVesting lock)
    {
        lock = new DevVesting(msg.sender, beneficiary, start, duration);
        emit DevVestingCreated(address(lock), msg.sender, beneficiary);
    }
}
