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
 *   1. Try to estimateGas the actual transfer call for this wallet — most accurate.
 *      Falls back to 80 000 units if estimate fails (wallet has zero balance, etc).
 *   2. Multiply by maxFeePerGas (already 2× baseFee from getMaxFeePerGas).
 *   3. Convert native wei → ERC20 USDC units (÷ 1e12, 18-dec → 6-dec bridge on Arc).
 *   4. Add an extra 2× multiplier on top so gas spikes between fetch and submit are covered.
 *      Arc gas can vary 2-3× in a block so a tight buffer causes intermittent failures.
 */
export async function getMaxSendableUSDC(walletAddress: `0x${string}`): Promise<string> {
  try {
    const USDC_CONTRACT = '0x3600000000000000000000000000000000000000' as const
    const balanceRaw = await publicClient.readContract({
      address: USDC_CONTRACT,
      abi: [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }],
      functionName: 'balanceOf',
      args: [walletAddress],
    })

    if (balanceRaw === 0n) return '0'

    const maxFeePerGas = await getMaxFeePerGas()

    // Try to estimate actual gas for a 1-unit transfer — most accurate for this wallet
    let gasUnits = 80_000n
    try {
      const estimated = await publicClient.estimateGas({
        account: walletAddress,
        to: USDC_CONTRACT,
        data: ('0xa9059cbb' +
          walletAddress.slice(2).padStart(64, '0') +
          '1'.padStart(64, '0')) as `0x${string}`,
      })
      gasUnits = estimated + estimated / 4n // +25% on top of real estimate
    } catch {
      // estimateGas can fail if balance is too low to simulate — keep fallback
    }

    const gasCostNativeWei = gasUnits * maxFeePerGas
    // Convert from 18-dec native wei to 6-dec ERC20 USDC units (Arc bridge: ÷ 1e12)
    const gasCostUSDCRaw = gasCostNativeWei / 10n ** 12n
    // +25% flat buffer — same formula as sendUSDC so MAX-filled amount always passes
    const gasReserve = gasCostUSDCRaw + gasCostUSDCRaw / 4n

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

    // Estimate gas cost for this transfer in ERC20 USDC units (6 dec).
    // On Arc: native gas token and ERC20 USDC share the same balance pool.
    // Arc bridge: 18-dec native wei → 6-dec ERC20 USDC = divide by 1e12.
    const maxFeePerGas = await getMaxFeePerGas()

    // Try real estimateGas for this exact call; fall back to 80k if it fails
    let gasUnits = 80_000n
    try {
      const est = await publicClient.estimateGas({
        account: sessionWallet.address,
        to: USDC_ADDRESS,
        data: ('0xa9059cbb' +
          (to as string).slice(2).padStart(64, '0') +
          amountRaw.toString(16).padStart(64, '0')) as `0x${string}`,
      })
      gasUnits = est + est / 4n // +25% on top of real estimate
    } catch { /* keep fallback */ }

    const gasCostNativeWei = gasUnits * maxFeePerGas
    const gasCostUSDCRaw = gasCostNativeWei / 10n ** 12n
    // +25% flat buffer — identical to getMaxSendableUSDC so MAX-filled amount always passes
    const gasReserve = gasCostUSDCRaw + gasCostUSDCRaw / 4n

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
