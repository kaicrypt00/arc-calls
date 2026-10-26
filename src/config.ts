/**
 * wagmi configuration — Arc Calls
 * Arc Mainnet only. Chain ID: 5042. USDC is both gas and betting token.
 */

import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { injected, walletConnect } from 'wagmi/connectors'

export const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
})

export const EXPLORER_URL = 'https://explorer.arc.io'

export const config = createConfig({
  chains: [arc],
  connectors: [
    injected(),
    walletConnect({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '' }),
  ],
  transports: {
    [arc.id]: http('https://rpc.mainnet.arc.io'),
  },
})
