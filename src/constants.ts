/**
 * Arc Calls — Contract addresses and constants
 * Arc Mainnet, Chain ID: 5042
 */

export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000' as const

export const PROFILE_REGISTRY_ADDRESS = (import.meta.env.VITE_PROFILE_REGISTRY_ADDRESS ?? '') as `0x${string}`
export const BETTING_POOL_ADDRESS     = (import.meta.env.VITE_BETTING_POOL_ADDRESS ?? '') as `0x${string}`
export const ACHIEVEMENT_REGISTRY_ADDRESS = (import.meta.env.VITE_ACHIEVEMENT_REGISTRY_ADDRESS ?? '') as `0x${string}`
export const POLL_REGISTRY_ADDRESS    = (import.meta.env.VITE_POLL_REGISTRY_ADDRESS ?? '') as `0x${string}`

export const ADMIN_WALLETS = [
  '0x2e7497d98c8cae22180773c92d07d96f4d42f8b6',
  '0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8',
] as const

export const AGENT_WALLET = '0x50f7067035972795fc9970be26a6489b10065343' as const

// Min bet: 0.1 USDC = 100_000 (6 decimals)
export const MIN_BET_RAW = 100_000n
export const MIN_BET_DISPLAY = '0.1'

// Gas
export const MIN_GAS_GWEI = 20n
export const MAX_UINT256 = 2n ** 256n - 1n

// Session wallet
export const SESSION_WALLET_PREFIX = 'ac_sw_'
export const SIGN_MESSAGE = `Arc Calls: Activate your Arc Calls Wallet.\nThis creates a secure session wallet for seamless betting without transaction popups.\nThis signature is deterministic and costs no gas. Your main wallet funds and assets cannot be accessed through this signature.`

// Events
export const EVENT_SESSION_WALLET_READY = 'arc:session-wallet-ready'
export const EVENT_BET_PLACED = 'arc-bet-placed'

// Supabase
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

// USDC decimals (ERC-20 view on Arc — always 6)
export const USDC_DECIMALS = 6

// Arc Mainnet chain ID
export const ARC_CHAIN_ID = 5042
