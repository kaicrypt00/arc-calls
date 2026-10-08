/**
 * Session Wallet Hook — Arc Calls
 *
 * Wraps ZeroDev's ERC-4337 session key SDK to provide a persistent,
 * user-controlled in-app wallet for one-click prediction betting.
 *
 * STATUS: 🔨 In Progress
 *
 * What's done:
 *  - State management (connected / disconnected / loading)
 *  - Wallet address exposure
 *  - Balance fetch stub
 *
 * What's TODO:
 *  - ZeroDev SDK integration for actual session key creation
 *  - UserOperation signing and submission
 *  - Persistent session storage (localStorage + smart contract)
 *  - Send / Receive USDC implementation
 */

"use client";

import { useState, useCallback } from "react";
import { useWalletClient } from "wagmi";

export type SessionWalletState = {
  address:    string | null;
  balance:    bigint;           // USDC balance (6 decimals)
  isLoading:  boolean;
  isConnected: boolean;
};

export type UseSessionWallet = SessionWalletState & {
  connect:    () => Promise<void>;
  disconnect: () => Promise<void>;
  send:       (to: string, amount: bigint) => Promise<`0x${string}`>;
  receive:    () => string | null; // returns session wallet address for QR
};

export function useSessionWallet(): UseSessionWallet {
  const { data: walletClient } = useWalletClient();

  const [state, setState] = useState<SessionWalletState>({
    address:     null,
    balance:     0n,
    isLoading:   false,
    isConnected: false,
  });

  /**
   * Create or restore a session wallet for the connected main wallet.
   * TODO: implement with ZeroDev createKernelAccount + session key plugin
   */
  const connect = useCallback(async () => {
    if (!walletClient) return;

    setState((s) => ({ ...s, isLoading: true }));

    try {
      // TODO: ZeroDev session key creation flow
      // const kernelClient = await createKernelAccountClient({ ... })
      // const sessionKey   = await createSessionKey(kernelClient, { ... })

      // Placeholder until SDK integration complete
      await new Promise((r) => setTimeout(r, 1000));

      setState({
        address:     "0x...session_wallet_address", // TODO: real address
        balance:     0n,
        isLoading:   false,
        isConnected: true,
      });
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false }));
      throw err;
    }
  }, [walletClient]);

  /**
   * Manually disconnect (revoke) the session wallet.
   * User-initiated only — no auto-expiry.
   */
  const disconnect = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      // TODO: revoke session key on-chain
      setState({ address: null, balance: 0n, isLoading: false, isConnected: false });
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false }));
      throw err;
    }
  }, []);

  /**
   * Send USDC from session wallet to any address.
   * TODO: implement UserOperation via ZeroDev bundler
   */
  const send = useCallback(async (to: string, amount: bigint): Promise<`0x${string}`> => {
    if (!state.isConnected) throw new Error("Session wallet not connected");
    // TODO: build and submit UserOperation
    throw new Error("Not implemented yet");
  }, [state.isConnected]);

  const receive = useCallback(() => state.address, [state.address]);

  return { ...state, connect, disconnect, send, receive };
}
