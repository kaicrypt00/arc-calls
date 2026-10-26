import {
  createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode
} from 'react'
import { createWalletClient, createPublicClient, http, formatUnits, parseUnits, keccak256, type Account } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { useAccount, useSignMessage } from 'wagmi'
import { arc } from '../config'
import {
  SESSION_WALLET_PREFIX, SIGN_MESSAGE, USDC_ADDRESS, USDC_DECIMALS,
  MAX_UINT256, EVENT_SESSION_WALLET_READY, MIN_GAS_GWEI, BETTING_POOL_ADDRESS
} from '../constants'
import { ERC20_ABI } from '../abis'

export const publicClient = createPublicClient({
  chain: arc,
  transport: http('https://rpc.mainnet.arc.io'),
})

type ArcWalletClient = ReturnType<typeof createWalletClient>

interface SessionWallet {
  client: ArcWalletClient
  address: `0x${string}`
  account: Account
}

// Helper: call writeContract on the session wallet with Arc chain pre-filled
export async function writeContract(
  client: ArcWalletClient,
  params: { address: `0x${string}`; abi: never; functionName: string; args?: unknown[]; maxFeePerGas?: bigint }
): Promise<`0x${string}`> {
  return client.writeContract({
    ...params,
    chain: arc,
    account: client.account!,
  })
}

interface SessionWalletContextValue {
  sessionWallet: SessionWallet | null
  hasSessionWallet: boolean
  isCreating: boolean
  usdcBalance: string
  isLoadingBalances: boolean
  createSessionWallet: () => Promise<void>
  clearSessionWallet: () => void
  loadBalances: () => Promise<void>
  ensureUSDCApproval: () => Promise<void>
  sendUSDC: (to: `0x${string}`, amount: string) => Promise<`0x${string}`>
}

const SessionWalletContext = createContext<SessionWalletContextValue | null>(null)

export async function getMaxFeePerGas(): Promise<bigint> {
  try {
    const feeData = await publicClient.estimateFeesPerGas()
    const base = feeData.maxFeePerGas ?? 20n * 10n ** 9n
    const min = MIN_GAS_GWEI * 10n ** 9n
    return base < min ? min : base * 2n
  } catch {
    return MIN_GAS_GWEI * 10n ** 9n
  }
}

export function SessionWalletProvider({ children }: { children: ReactNode }) {
  const { address: mainAddress } = useAccount()
  const { signMessageAsync } = useSignMessage()

  const [sessionWallet, setSessionWallet] = useState<SessionWallet | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [usdcBalance, setUsdcBalance] = useState('0.00')
  const [isLoadingBalances, setIsLoadingBalances] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Restore session wallet from localStorage on mount / account change
  useEffect(() => {
    if (!mainAddress) {
      setSessionWallet(null)
      return
    }
    const key = `${SESSION_WALLET_PREFIX}${mainAddress.toLowerCase()}`
    const stored = localStorage.getItem(key)
    if (stored) {
      try {
        const privKey = stored as `0x${string}`
        const account = privateKeyToAccount(privKey)
        const client = createWalletClient({ account, chain: arc, transport: http('https://rpc.mainnet.arc.io') })
        setSessionWallet({ client, address: account.address, account })
      } catch {
        localStorage.removeItem(key)
      }
    } else {
      setSessionWallet(null)
    }
  }, [mainAddress])

  // Load balances when session wallet is available
  const loadBalances = useCallback(async () => {
    if (!sessionWallet) return
    setIsLoadingBalances(true)
    try {
      const raw = await publicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [sessionWallet.address],
      })
      setUsdcBalance(parseFloat(formatUnits(raw, USDC_DECIMALS)).toFixed(2))
    } catch {
      // silently ignore
    } finally {
      setIsLoadingBalances(false)
    }
  }, [sessionWallet])

  // Auto-refresh every 15s
  useEffect(() => {
    if (sessionWallet) {
      loadBalances()
      intervalRef.current = setInterval(loadBalances, 15_000)
    } else {
      setUsdcBalance('0.00')
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [sessionWallet, loadBalances])

  const createSessionWallet = useCallback(async () => {
    if (!mainAddress) return
    setIsCreating(true)
    try {
      const sig = await signMessageAsync({ message: SIGN_MESSAGE })
      const privKey = keccak256(sig)
      const account = privateKeyToAccount(privKey)
      const client = createWalletClient({ account, chain: arc, transport: http('https://rpc.mainnet.arc.io') })
      const key = `${SESSION_WALLET_PREFIX}${mainAddress.toLowerCase()}`
      localStorage.setItem(key, privKey)
      setSessionWallet({ client, address: account.address, account })
      window.dispatchEvent(new Event(EVENT_SESSION_WALLET_READY))
    } finally {
      setIsCreating(false)
    }
  }, [mainAddress, signMessageAsync])

  const clearSessionWallet = useCallback(() => {
    if (!mainAddress) return
    const key = `${SESSION_WALLET_PREFIX}${mainAddress.toLowerCase()}`
    localStorage.removeItem(key)
    setSessionWallet(null)
  }, [mainAddress])

  const ensureUSDCApproval = useCallback(async () => {
    if (!sessionWallet || !BETTING_POOL_ADDRESS) return
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [sessionWallet.address, BETTING_POOL_ADDRESS],
    })
    if (allowance < parseUnits('1000', USDC_DECIMALS)) {
      const maxFeePerGas = await getMaxFeePerGas()
      await writeContract(sessionWallet.client, {
        address: USDC_ADDRESS,
        abi: ERC20_ABI as never,
        functionName: 'approve',
        args: [BETTING_POOL_ADDRESS, MAX_UINT256],
        maxFeePerGas,
      })
    }
  }, [sessionWallet])

  const sendUSDC = useCallback(async (to: `0x${string}`, amount: string): Promise<`0x${string}`> => {
    if (!sessionWallet) throw new Error('No session wallet')
    const maxFeePerGas = await getMaxFeePerGas()
    const hash = await writeContract(sessionWallet.client, {
      address: USDC_ADDRESS,
      abi: ERC20_ABI as never,
      functionName: 'transfer',
      args: [to, parseUnits(amount, USDC_DECIMALS)],
      maxFeePerGas,
    })
    await loadBalances()
    return hash
  }, [sessionWallet, loadBalances])

  return (
    <SessionWalletContext.Provider value={{
      sessionWallet,
      hasSessionWallet: !!sessionWallet,
      isCreating,
      usdcBalance,
      isLoadingBalances,
      createSessionWallet,
      clearSessionWallet,
      loadBalances,
      ensureUSDCApproval,
      sendUSDC,
    }}>
      {children}
    </SessionWalletContext.Provider>
  )
}

export function useSessionWallet() {
  const ctx = useContext(SessionWalletContext)
  if (!ctx) throw new Error('useSessionWallet must be used within SessionWalletProvider')
  return ctx
}
