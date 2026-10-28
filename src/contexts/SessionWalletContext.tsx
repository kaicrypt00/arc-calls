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
  ensureUSDCApproval: (requiredRaw?: bigint) => Promise<void>
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

/**
 * Returns the maximum sendable USDC amount (as a display string with 4 decimal places)
 * after reserving enough native balance to cover the gas fee for the ERC20 transfer.
 *
 * On Arc Mainnet, native gas and ERC20 USDC share the same underlying balance.
 * Sending 100% of the balance leaves nothing for gas, causing a revert.
 *
 * Gas reserve calculation:
 *   - ERC20 transfer ~65 000 gas units
 *   - Convert native wei cost → ERC20 USDC units (÷ 1e12, since 18-dec native vs 6-dec ERC20)
 *   - Add 50% safety buffer for gas price spikes
 */
export async function getMaxSendableUSDC(walletAddress: `0x${string}`): Promise<string> {
  try {
    const balanceRaw = await publicClient.readContract({
      address: '0x3600000000000000000000000000000000000000' as `0x${string}`,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [walletAddress],
    })
    const maxFeePerGas = await getMaxFeePerGas()
    const GAS_UNITS = 65_000n
    const gasCostNativeWei = GAS_UNITS * maxFeePerGas
    // Convert from 18-dec native to 6-dec ERC20 USDC units (÷ 1e12)
    const gasCostUSDCRaw = gasCostNativeWei / 10n ** 12n
    const gasReserve = gasCostUSDCRaw + gasCostUSDCRaw / 2n // +50% buffer
    const maxSendableRaw = balanceRaw > gasReserve ? balanceRaw - gasReserve : 0n
    return parseFloat(formatUnits(maxSendableRaw, 6)).toFixed(4)
  } catch {
    return '0'
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

  const ensureUSDCApproval = useCallback(async (requiredRaw?: bigint) => {
    if (!sessionWallet || !BETTING_POOL_ADDRESS) return
    const minAllowance = requiredRaw ?? parseUnits('1000', USDC_DECIMALS)
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [sessionWallet.address, BETTING_POOL_ADDRESS],
    })
    if (allowance < minAllowance) {
      const maxFeePerGas = await getMaxFeePerGas()
      const hash = await writeContract(sessionWallet.client, {
        address: USDC_ADDRESS,
        abi: ERC20_ABI as never,
        functionName: 'approve',
        args: [BETTING_POOL_ADDRESS, MAX_UINT256],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash })
    }
  }, [sessionWallet])

  const sendUSDC = useCallback(async (to: `0x${string}`, amount: string): Promise<`0x${string}`> => {
    if (!sessionWallet) throw new Error('No session wallet')

    const amountRaw = parseUnits(amount, USDC_DECIMALS)

    // Pre-flight balance check: verify user has enough ERC20 USDC to cover the transfer amount.
    // On Arc Mainnet, native gas and ERC20 USDC share the same underlying balance.
    // We read the live on-chain balance (not the stale UI state) to catch edge cases.
    const balanceRaw = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [sessionWallet.address],
    })

    // Estimate the gas cost of this transfer in ERC20 USDC units (6 dec).
    // Arc uses a 12-decimal bridge between native wei (18 dec) and ERC20 USDC (6 dec).
    // Gas estimate: ~65 000 gas units for an ERC20 transfer.
    const maxFeePerGas = await getMaxFeePerGas()
    const GAS_UNITS = 65_000n
    const gasCostNativeWei = GAS_UNITS * maxFeePerGas
    // Convert from native wei (18 dec) to ERC20 USDC units (6 dec): divide by 1e12
    const gasCostUSDCRaw = gasCostNativeWei / 10n ** 12n
    // Add 50% safety buffer so we always leave room even if gas spikes
    const gasReserve = gasCostUSDCRaw + gasCostUSDCRaw / 2n

    if (amountRaw + gasReserve > balanceRaw) {
      const maxSendable = balanceRaw > gasReserve ? balanceRaw - gasReserve : 0n
      const maxSendableDisplay = parseFloat(formatUnits(maxSendable, USDC_DECIMALS)).toFixed(4)
      throw new Error(
        `Insufficient balance for transfer + gas fee. Maximum sendable: ${maxSendableDisplay} USDC (gas reserve kept).`
      )
    }

    const hash = await writeContract(sessionWallet.client, {
      address: USDC_ADDRESS,
      abi: ERC20_ABI as never,
      functionName: 'transfer',
      args: [to, amountRaw],
      maxFeePerGas,
    })

    // Wait for on-chain confirmation before recording in history.
    // This prevents phantom history entries when a tx is submitted but reverts on-chain.
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status === 'reverted') {
      throw new Error('Transfer transaction reverted on-chain. No USDC was sent.')
    }

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
