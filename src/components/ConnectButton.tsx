"use client";

import { useSyncExternalStore } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { robinhoodChain } from "@/lib/chain";
import { shortAddress } from "@/lib/format";

const noop = () => () => {};
/** false during SSR and hydration, true once the client owns the tree. */
export const useMounted = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

/**
 * Injected-wallet connect. Three states: no wallet, wrong chain, connected.
 * Nothing here sends a transaction.
 */
export function ConnectButton({ className = "", size = "sm" }: { className?: string; size?: "sm" | "md" }) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const mounted = useMounted();
  const sz = size === "sm" ? "btn-sm" : "";

  // Before hydration wagmi has no idea what the wallet is; render the
  // resting state so the server and client markup match.
  if (!mounted) {
    return (
      <button type="button" className={`btn btn-glass ${sz} ${className}`} disabled>
        Connect wallet
      </button>
    );
  }

  if (!isConnected || !address) {
    const injected = connectors[0];
    return (
      <div className={`flex flex-wrap items-center gap-2 ${className}`}>
        <button
          type="button"
          className={`btn btn-glass ${sz}`}
          disabled={!injected || isPending}
          onClick={() => injected && connect({ connector: injected })}
        >
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {!injected ? (
          <span className="text-xs text-ink-3">No injected wallet found</span>
        ) : error ? (
          <span className="text-xs text-down">{error.message.split("\n")[0]}</span>
        ) : null}
      </div>
    );
  }

  const wrongChain = chainId !== robinhoodChain.id;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {wrongChain ? (
        <button type="button" className={`btn btn-primary ${sz}`} disabled={switching} onClick={() => switchChain({ chainId: robinhoodChain.id })}>
          {switching ? "Switching…" : "Switch to Robinhood Chain"}
        </button>
      ) : null}
      <span className="mono inline-flex items-center gap-2 rounded-full border border-edge-2 bg-glass px-3 py-2 text-xs text-ink">
        <span className={`inline-block h-2 w-2 rounded-full ${wrongChain ? "bg-down" : "bg-up"}`} />
        {shortAddress(address)}
      </span>
      <button type="button" className="btn btn-glass btn-sm" onClick={() => disconnect()}>
        Disconnect
      </button>
    </div>
  );
}
