import { http, createConfig } from "wagmi";
import { defineChain } from "viem";

/**
 * Arc (Circle) L1 chain definition for wagmi/viem.
 * Chain ID and RPC URLs will be updated once Arc mainnet details are finalized.
 */
export const arcMainnet = defineChain({
  id: 1234, // TODO: replace with official Arc chain ID
  name: "Arc",
  nativeCurrency: {
    decimals: 6,
    name: "USD Coin",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_ARC_RPC_URL || "https://rpc.arc.io"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.arc.io",
    },
  },
});

export const wagmiConfig = createConfig({
  chains: [arcMainnet],
  transports: {
    [arcMainnet.id]: http(),
  },
});

// Contract addresses — populated after testnet deploy
export const CONTRACT_ADDRESSES = {
  PROFILE:      process.env.NEXT_PUBLIC_PROFILE_CONTRACT      as `0x${string}` | undefined,
  BETTING_POOL: process.env.NEXT_PUBLIC_BETTING_POOL_CONTRACT  as `0x${string}` | undefined,
  POLL:         process.env.NEXT_PUBLIC_POLL_CONTRACT          as `0x${string}` | undefined,
  USDC:         process.env.NEXT_PUBLIC_USDC_ADDRESS           as `0x${string}` | undefined,
};
