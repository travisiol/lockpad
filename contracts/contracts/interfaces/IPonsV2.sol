// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Pons V2 on Robinhood Chain — the surface Lockpad touches.
 *
 * Layouts were read off the deployed contracts and confirmed by tracing a
 * real launch on a fork (scripts/trace-launch.ts): the factory at
 * 0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e, its launch forwarder, a live
 * curve and the fee escrow. Field NAMES inside the structs are ours; the
 * ORDER and TYPES are what the chain accepts.
 */
interface IPonsFactoryV2 {
    struct Socials {
        string x;
        string telegram;
        string website;
        string discord;
        string extra;
    }

    struct LaunchParams {
        string name;
        string symbol;
        string logo;
        string description;
        Socials socials;
        /// Receives the token's creator fees (our FeeLock).
        address creatorFeeRecipient;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        /// previewLaunchEconomics(configId, pairToken) at call time — the
        /// factory rejects a launch whose economics moved under it.
        bytes32 economicsHash;
        /// CREATE2 salt for the token address.
        bytes32 salt;
    }

    /// `pairToken` is address(0) for a native-ETH curve. The caller becomes
    /// the token's deployer; it and the fee recipient are exempted from the
    /// snipe tax, plus everyone in `snipeTaxExempt`.
    function launchToken(
        LaunchParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        address[] calldata snipeTaxExempt
    ) external payable returns (address token, address curve);

    function launchFee() external view returns (uint256);

    function launchEnabled() external view returns (bool);

    function canLaunch(address launcher) external view returns (bool);

    function feeEscrow() external view returns (address);

    function launchForwarder() external view returns (address);

    function maxCreatorTaxBps() external view returns (uint256);

    function previewLaunchEconomics(uint256 launchConfigId, address pairToken)
        external
        view
        returns (bytes32);
}

/// Pons' own helper: launch and buy the developer allocation atomically,
/// with the buyer exempted from the snipe tax first. Sends the launch fee
/// plus `buyAmount` as msg.value.
interface IPonsLaunchForwarder {
    function launchAndBuy(
        IPonsFactoryV2.LaunchParams calldata params,
        uint256 launchConfigId,
        address pairToken,
        uint256 buyAmount,
        uint256 minTokensOut,
        address buyRecipient,
        address[] calldata snipeTaxExempt
    ) external payable returns (address token, address curve);
}

/// The bonding curve deployed per token.
interface IPonsCurve {
    /// (quoteReserve, tokenReserve) — quote includes the virtual liquidity.
    function getReserves() external view returns (uint256 quote, uint256 tokens);

    /// ETH actually raised so far; graduation triggers at graduationThreshold.
    function realQuoteReserve() external view returns (uint256);

    function graduationThreshold() external view returns (uint256);

    function graduated() external view returns (bool);

    function token() external view returns (address);

    function launchSupply() external view returns (uint256);

    /// Spend `quoteAmount` (== msg.value on a native curve) on tokens for
    /// `recipient`.
    function buy(uint256 quoteAmount, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);
}

/// Creator fees accrue here, credited to the creator-fee recipient.
interface IPonsFeeEscrow {
    function balanceOf(address account) external view returns (uint256);

    function balanceOfToken(address token, address account) external view returns (uint256);

    /// Pays the caller its full native balance.
    function claim() external;

    /// Pays the caller its full balance of an ERC-20 pair token.
    function claimToken(address token) external;
}
