// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPonsFactoryV2, IPonsLaunchForwarder, IPonsFeeEscrow, IPonsCurve} from "./interfaces/IPonsV2.sol";
import {FeeLock} from "./FeeLock.sol";
import {DevVesting} from "./DevVesting.sol";
import {LockFactory} from "./LockFactory.sol";

/**
 * Lockpad — launches on Pons V2 with the developer locked by construction.
 *
 * `launch()` deploys two locks for the creator and launches the token on
 * Pons with both wired in:
 *
 *   - a FeeLock, registered as the creator-fee recipient. Fees stay there
 *     until graduation, then unlock over FEE_VEST; if the curve has not
 *     graduated by the creator's deadline the lock is buried (bought back
 *     and burned) instead of paid;
 *   - a DevVesting, the recipient of the developer buy. Pons delivers the
 *     creator's tokens there in the launch transaction and they unlock
 *     linearly over the creator's chosen duration.
 *
 * The creator's own wallet is deliberately NOT exempted from the snipe tax:
 * the only exempt buyer is the vesting contract, so a second wallet pays
 * what everyone pays.
 *
 * The router never holds fees or tokens. The pad's share is taken by the
 * locks from what the creator unlocks, and nothing at all from a buried one.
 */
contract LockpadRouter is Ownable2Step, ReentrancyGuard {
    uint16 public constant BPS = 10_000;
    /// The pad's share of what a creator unlocks: 10%.
    uint16 public constant PAD_BPS = 1_000;
    /// Fees unlock over this long once graduation is recorded.
    uint64 public constant FEE_VEST = 30 days;
    /// Bounds for the developer-buy vesting the creator picks.
    uint64 public constant MIN_VEST = 7 days;
    uint64 public constant MAX_VEST = 365 days;
    /// Bounds for the graduation window the creator picks.
    uint64 public constant MIN_WINDOW = 3 days;
    uint64 public constant MAX_WINDOW = 90 days;
    /// Pons launch config used for every launch (the only one deployed today).
    uint256 public constant LAUNCH_CONFIG_ID = 0;
    /// Launches are paired with native ETH.
    address public constant NATIVE_PAIR = address(0);

    IPonsFactoryV2 public immutable ponsFactory;
    IPonsLaunchForwarder public immutable ponsForwarder;
    IPonsFeeEscrow public immutable feeEscrow;
    /// Deploys the two locks; kept separate so the router stays under the
    /// contract size limit.
    LockFactory public immutable lockFactory;

    address public treasury;
    /// Charged on top of the Pons launch fee. Zero: the pad earns only when
    /// a creator does.
    uint256 public padLaunchFee;
    bool public paused;

    struct LaunchParams {
        string name;
        string symbol;
        /// ipfs:// or https:// — stored here so the site can show it without
        /// an indexer.
        string logo;
        string description;
        string x;
        string telegram;
        string website;
        uint16 creatorTaxBps;
        /// CREATE2 salt for the token address. Any value; use a fresh one.
        bytes32 salt;
        /// Wei to spend on tokens for the creator in the same transaction.
        /// Delivered to the vesting contract, never to the creator.
        uint256 developerBuy;
        /// Slippage floor for that buy (0 accepts any fill).
        uint256 minTokensOut;
        /// How long the developer buy takes to unlock. Ignored without one.
        uint64 vestDuration;
        /// Graduate within this long or the fee lock can be buried.
        uint64 graduationWindow;
    }

    struct LaunchInfo {
        address token;
        address curve;
        address creator;
        address feeLock;
        /// address(0) when the launch had no developer buy.
        address vesting;
        uint16 creatorTaxBps;
        uint256 developerBuy;
        uint64 vestDuration;
        uint64 deadline;
        uint64 launchedAt;
        uint64 launchBlock;
        string name;
        string symbol;
        string logo;
        string description;
    }

    /// Everything the locks of one launch report, in one read.
    struct LockStatus {
        FeeLock.Status fees;
        bool hasVesting;
        uint64 vestStart;
        uint64 vestEnd;
        uint256 devAllocation;
        uint256 devReleased;
        uint256 devReleasable;
        uint256 devLocked;
    }

    address[] private _launches;
    mapping(address token => LaunchInfo) private _info;
    mapping(address creator => address[] tokens) private _byCreator;

    event Launched(
        address indexed token,
        address indexed curve,
        address indexed creator,
        address feeLock,
        address vesting,
        uint256 developerBuy,
        uint64 vestDuration,
        uint64 deadline
    );
    event TreasuryUpdated(address indexed treasury);
    event PadLaunchFeeUpdated(uint256 fee);
    event PausedUpdated(bool paused);

    error ZeroAddress();
    error Paused();
    error LaunchClosed();
    error WrongValue(uint256 expected, uint256 sent);
    error EmptyName();
    error EmptySymbol();
    error TaxTooHigh(uint256 max);
    error VestOutOfRange(uint64 min, uint64 max);
    error WindowOutOfRange(uint64 min, uint64 max);
    error UnknownToken();
    error TransferFailed();

    constructor(IPonsFactoryV2 factory_, LockFactory lockFactory_, address treasury_, address owner_)
        Ownable(owner_)
    {
        if (address(factory_) == address(0) || address(lockFactory_) == address(0) || treasury_ == address(0)) {
            revert ZeroAddress();
        }
        ponsFactory = factory_;
        lockFactory = lockFactory_;
        feeEscrow = IPonsFeeEscrow(factory_.feeEscrow());
        ponsForwarder = IPonsLaunchForwarder(factory_.launchForwarder());
        if (address(feeEscrow) == address(0) || address(ponsForwarder) == address(0)) {
            revert ZeroAddress();
        }
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    // ───────────────────────────────────────────── launch ──

    /**
     * Launch on Pons through the pad. Send exactly
     * `totalLaunchFee() + params.developerBuy` wei.
     */
    function launch(LaunchParams calldata params)
        external
        payable
        nonReentrant
        returns (address token, address curve, address feeLock, address vesting)
    {
        if (paused) revert Paused();
        if (!canLaunchHere()) revert LaunchClosed();
        _validate(params);

        uint256 ponsFee = ponsFactory.launchFee();
        uint256 expected = ponsFee + padLaunchFee + params.developerBuy;
        if (msg.value != expected) revert WrongValue(expected, msg.value);

        uint64 deadline = uint64(block.timestamp) + params.graduationWindow;
        feeLock = address(
            lockFactory.createFeeLock(msg.sender, feeEscrow, deadline, FEE_VEST, PAD_BPS)
        );
        if (params.developerBuy > 0) {
            vesting = address(lockFactory.createDevVesting(msg.sender, uint64(block.timestamp), params.vestDuration));
        }

        (token, curve) = _launchOnPons(params, feeLock, vesting, ponsFee);

        if (vesting != address(0)) DevVesting(vesting).arm(IERC20(token));
        FeeLock(payable(feeLock)).arm(IERC20(token), IPonsCurve(curve));

        _record(params, token, curve, feeLock, vesting, deadline);

        if (padLaunchFee > 0) {
            (bool ok, ) = treasury.call{value: padLaunchFee}("");
            if (!ok) revert TransferFailed();
        }

        emit Launched(
            token,
            curve,
            msg.sender,
            feeLock,
            vesting,
            params.developerBuy,
            vesting == address(0) ? 0 : params.vestDuration,
            deadline
        );
    }

    function _validate(LaunchParams calldata params) private view {
        if (bytes(params.name).length == 0) revert EmptyName();
        if (bytes(params.symbol).length == 0) revert EmptySymbol();
        uint256 maxTax = ponsFactory.maxCreatorTaxBps();
        if (params.creatorTaxBps > maxTax) revert TaxTooHigh(maxTax);
        if (params.graduationWindow < MIN_WINDOW || params.graduationWindow > MAX_WINDOW) {
            revert WindowOutOfRange(MIN_WINDOW, MAX_WINDOW);
        }
        if (params.developerBuy > 0 && (params.vestDuration < MIN_VEST || params.vestDuration > MAX_VEST)) {
            revert VestOutOfRange(MIN_VEST, MAX_VEST);
        }
    }

    /// The factory exempts the deployer (this router) and the fee recipient
    /// from the snipe tax itself, and the forwarder exempts the buy
    /// recipient (the vesting contract). Nobody else — not the creator's
    /// wallet — so the exempt list is always empty.
    function _launchOnPons(
        LaunchParams calldata params,
        address feeLock,
        address vesting,
        uint256 ponsFee
    ) private returns (address token, address curve) {
        IPonsFactoryV2.LaunchParams memory ponsParams = IPonsFactoryV2.LaunchParams({
            name: params.name,
            symbol: params.symbol,
            logo: params.logo,
            description: params.description,
            socials: IPonsFactoryV2.Socials({
                x: params.x,
                telegram: params.telegram,
                website: params.website,
                discord: "",
                extra: ""
            }),
            creatorFeeRecipient: feeLock,
            creatorTaxBps: params.creatorTaxBps,
            buybackEnabled: true,
            economicsHash: ponsFactory.previewLaunchEconomics(LAUNCH_CONFIG_ID, NATIVE_PAIR),
            salt: params.salt
        });
        address[] memory exempt = new address[](0);

        if (vesting != address(0)) {
            (token, curve) = ponsForwarder.launchAndBuy{value: ponsFee + params.developerBuy}(
                ponsParams,
                LAUNCH_CONFIG_ID,
                NATIVE_PAIR,
                params.developerBuy,
                params.minTokensOut,
                vesting,
                exempt
            );
        } else {
            (token, curve) = ponsFactory.launchToken{value: ponsFee}(
                ponsParams,
                LAUNCH_CONFIG_ID,
                NATIVE_PAIR,
                exempt
            );
        }
    }

    function _record(
        LaunchParams calldata params,
        address token,
        address curve,
        address feeLock,
        address vesting,
        uint64 deadline
    ) private {
        _launches.push(token);
        _byCreator[msg.sender].push(token);
        LaunchInfo storage info = _info[token];
        info.token = token;
        info.curve = curve;
        info.creator = msg.sender;
        info.feeLock = feeLock;
        info.vesting = vesting;
        info.creatorTaxBps = params.creatorTaxBps;
        info.developerBuy = params.developerBuy;
        info.vestDuration = vesting == address(0) ? 0 : params.vestDuration;
        info.deadline = deadline;
        info.launchedAt = uint64(block.timestamp);
        info.launchBlock = uint64(block.number);
        info.name = params.name;
        info.symbol = params.symbol;
        info.logo = params.logo;
        info.description = params.description;
    }

    // ───────────────────────────────────────────── locks ──

    /// Pays out whatever the fee lock has unlocked. Anyone can trigger.
    function release(address token) external returns (uint256 toCreator, uint256 toPad) {
        return FeeLock(payable(_lockOf(token))).release();
    }

    /// Buries a fee lock whose deadline passed without graduation. Anyone.
    function bury(address token) external returns (uint256 spent, uint256 burned) {
        return FeeLock(payable(_lockOf(token))).bury();
    }

    /// Records graduation on the fee lock if the curve reports it. Anyone.
    function checkpoint(address token) external returns (bool) {
        return FeeLock(payable(_lockOf(token))).checkpoint();
    }

    /// Pays the developer whatever the vesting has unlocked. Anyone.
    function releaseVesting(address token) external returns (uint256) {
        address vesting = _info[token].vesting;
        if (vesting == address(0)) revert UnknownToken();
        return DevVesting(vesting).release();
    }

    /// Both locks of a launch, in one read.
    function lockStatus(address token) external view returns (LockStatus memory s) {
        LaunchInfo storage info = _info[token];
        if (info.token == address(0)) revert UnknownToken();
        s.fees = FeeLock(payable(info.feeLock)).status();
        if (info.vesting != address(0)) {
            DevVesting v = DevVesting(info.vesting);
            s.hasVesting = true;
            s.vestStart = v.start();
            s.vestEnd = v.end();
            s.devAllocation = v.allocation();
            s.devReleased = v.released();
            s.devReleasable = v.releasable();
            s.devLocked = v.locked();
        }
    }

    // ───────────────────────────────────────────── views ──

    /// Pons will accept a launch from this router right now.
    function canLaunchHere() public view returns (bool) {
        return ponsFactory.launchEnabled() && ponsFactory.canLaunch(address(this));
    }

    /// Pons' own launch fee, read live.
    function ponsLaunchFee() public view returns (uint256) {
        return ponsFactory.launchFee();
    }

    /// What `launch()` must be sent, before the developer buy.
    function totalLaunchFee() external view returns (uint256) {
        return ponsLaunchFee() + padLaunchFee;
    }

    function launchCount() external view returns (uint256) {
        return _launches.length;
    }

    function launchAt(uint256 index) external view returns (address) {
        return _launches[index];
    }

    /// Newest first. `offset` counts from the newest launch.
    function launches(uint256 offset, uint256 limit)
        external
        view
        returns (LaunchInfo[] memory page)
    {
        uint256 n = _launches.length;
        if (offset >= n) return page;
        uint256 count = n - offset;
        if (count > limit) count = limit;
        page = new LaunchInfo[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = _info[_launches[n - 1 - offset - i]];
        }
    }

    function launchesOf(address creator) external view returns (address[] memory) {
        return _byCreator[creator];
    }

    function infoOf(address token) external view returns (LaunchInfo memory info) {
        info = _info[token];
        if (info.token == address(0)) revert UnknownToken();
    }

    // ───────────────────────────────────────────── admin ──

    /// Where the pad's share goes. Only ever affects the pad's own 10%.
    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryUpdated(treasury_);
    }

    function setPadLaunchFee(uint256 fee) external onlyOwner {
        padLaunchFee = fee;
        emit PadLaunchFeeUpdated(fee);
    }

    /// Stops new launches. Existing locks have no pause.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedUpdated(paused_);
    }

    /// ETH that ended up here by mistake goes to the treasury. The router is
    /// never meant to hold a balance.
    function sweep() external onlyOwner {
        uint256 amount = address(this).balance;
        if (amount == 0) return;
        (bool ok, ) = treasury.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    /// Refunds from the curve or factory land here.
    receive() external payable {}

    function _lockOf(address token) private view returns (address lock) {
        lock = _info[token].feeLock;
        if (lock == address(0)) revert UnknownToken();
    }
}
