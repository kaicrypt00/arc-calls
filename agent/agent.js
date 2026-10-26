/**
 * Arc Calls — AI Trading Agent
 * Runs daily at 8AM UTC via GitHub Actions.
 * Places 1 bet of 0.1 USDC per run on the market with the earliest deadline.
 * Uses OpenRouter (meta-llama/llama-3.1-8b-instruct:free) for YES/NO decision.
 */

import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'
import { createClient } from '@supabase/supabase-js'

// Arc Mainnet
const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

const RPC_URL   = 'https://rpc.mainnet.arc.io'
const CHAIN_ID  = 5042
const BET_AMOUNT_USDC = '0.1'
const BETS_PER_RUN    = 1

const USDC_ADDRESS    = '0x3600000000000000000000000000000000000000'
const BETTING_POOL    = process.env.BETTING_POOL_ADDRESS ?? ''

const MIN_GAS_GWEI = 20n

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
]

const BETTING_POOL_ABI = [
  { name: 'placeBet', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'side', type: 'uint8' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'getBetCount', type: 'function', stateMutability: 'view', inputs: [{ name: 'user', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
]

async function getMaxFeePerGas(publicClient) {
  try {
    const fee = await publicClient.estimateFeesPerGas()
    const base = fee.maxFeePerGas ?? MIN_GAS_GWEI * 10n ** 9n
    const min  = MIN_GAS_GWEI * 10n ** 9n
    return base < min ? min : base * 2n
  } catch {
    return MIN_GAS_GWEI * 10n ** 9n
  }
}

async function getAIDecision(market) {
  if (!process.env.OPENROUTER_API_KEY) return fallbackDecision(market)
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://arc-calls.vercel.app',
        'X-Title': 'Arc Calls',
      },
      body: JSON.stringify({
        model: 'meta-llama/llama-3.1-8b-instruct:free',
        messages: [{
          role: 'user',
          content: `You are Arc Agent 001, an AI prediction market trader on Arc Calls.

Market: "${market.title}"
Description: "${market.description}"
YES Pool: ${market.yes_pool} USDC
NO Pool: ${market.no_pool} USDC
Deadline: ${market.deadline}

Analyze this prediction market carefully. Consider:
- The current odds implied by pool sizes
- The likelihood of the YES outcome based on the title/description
- Value betting (bet where the odds undervalue the true probability)

Respond with ONLY one word: YES or NO`
        }],
        max_tokens: 5,
        temperature: 0.3,
      }),
    })
    const data = await res.json()
    const content = data.choices?.[0]?.message?.content?.trim().toUpperCase()
    if (content === 'YES' || content === 'NO') return content
    return fallbackDecision(market)
  } catch (e) {
    console.warn('OpenRouter error:', e.message)
    return fallbackDecision(market)
  }
}

function fallbackDecision(market) {
  const yes = Number(market.yes_pool ?? 0)
  const no  = Number(market.no_pool ?? 0)
  const total = yes + no
  if (total === 0) return Math.random() > 0.5 ? 'YES' : 'NO'
  // Bet on the underdog (contrarian strategy)
  return yes <= no ? 'YES' : 'NO'
}

async function main() {
  console.log('[Arc Agent 001] Starting run...')

  const privateKey = process.env.AGENT_PRIVATE_KEY
  if (!privateKey) { console.error('AGENT_PRIVATE_KEY not set'); process.exit(1) }
  if (!BETTING_POOL) { console.error('BETTING_POOL_ADDRESS not set'); process.exit(1) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const account = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({ chain: arc, transport: http(RPC_URL) })
  const walletClient = createWalletClient({ account, chain: arc, transport: http(RPC_URL) })

  console.log('[Arc Agent 001] Wallet:', account.address)

  // Check USDC balance
  const rawBalance = await publicClient.readContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address],
  })
  const balance = parseFloat(formatUnits(rawBalance, 6))
  const minRequired = parseFloat(BET_AMOUNT_USDC) * BETS_PER_RUN
  console.log(`[Arc Agent 001] USDC Balance: ${balance.toFixed(6)}`)

  if (balance < minRequired) {
    console.warn(`[Arc Agent 001] Insufficient balance (${balance} < ${minRequired}). Exiting.`)
    process.exit(0)
  }

  // Fetch open markets from Supabase
  const { data: markets } = await supabase
    .from('predictions_display')
    .select('*')
    .eq('status', 'open')
    .order('deadline', { ascending: true })
    .limit(10)

  if (!markets || markets.length === 0) {
    console.log('[Arc Agent 001] No open markets. Exiting.')
    process.exit(0)
  }

  // Filter out markets the agent already bet on
  const { data: existingBets } = await supabase
    .from('bets')
    .select('prediction_id')
    .eq('wallet_address', account.address.toLowerCase())

  const bettedIds = new Set((existingBets ?? []).map(b => b.prediction_id))
  const eligible = markets.filter(m => {
    if (bettedIds.has(m.id)) return false
    // Check betting is not locked (5 min before deadline)
    const dl = new Date(m.deadline).getTime()
    if (Date.now() >= dl - 5 * 60 * 1000) return false
    return true
  })

  if (eligible.length === 0) {
    console.log('[Arc Agent 001] No eligible markets. Exiting.')
    process.exit(0)
  }

  const market = eligible[0]
  console.log(`[Arc Agent 001] Picked market #${market.id}: "${market.title}"`)

  // Get AI decision
  const side = await getAIDecision(market)
  console.log(`[Arc Agent 001] Decision: ${side}`)

  // Ensure USDC approval
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'allowance',
    args: [account.address, BETTING_POOL],
  })
  if (allowance < parseUnits(BET_AMOUNT_USDC, 6)) {
    console.log('[Arc Agent 001] Approving USDC...')
    const maxFeePerGas = await getMaxFeePerGas(publicClient)
    const appHash = await walletClient.writeContract({
      address: USDC_ADDRESS, abi: ERC20_ABI, functionName: 'approve',
      args: [BETTING_POOL, 2n ** 256n - 1n],
      maxFeePerGas,
    })
    await publicClient.waitForTransactionReceipt({ hash: appHash })
    console.log('[Arc Agent 001] Approval confirmed.')
  }

  // Place bet
  const rawAmount = parseUnits(BET_AMOUNT_USDC, 6)
  const sideNum = side === 'YES' ? 1 : 2
  const maxFeePerGas = await getMaxFeePerGas(publicClient)

  console.log(`[Arc Agent 001] Placing ${BET_AMOUNT_USDC} USDC on ${side} for market #${market.id}...`)
  const hash = await walletClient.writeContract({
    address: BETTING_POOL, abi: BETTING_POOL_ABI, functionName: 'placeBet',
    args: [BigInt(market.id), sideNum, rawAmount],
    maxFeePerGas,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  console.log('[Arc Agent 001] Bet confirmed:', hash)

  const now = new Date().toISOString()

  // Record in bets table
  await supabase.from('bets').insert({
    prediction_id: market.id,
    wallet_address: account.address.toLowerCase(),
    side,
    amount: parseFloat(BET_AMOUNT_USDC),
    result: 'pending',
    payout: 0,
    tx_hash: hash,
    created_at: now,
  })

  // Upsert leaderboard
  const { data: existing } = await supabase.from('leaderboard').select('total_calls,total_volume').eq('wallet_address', account.address.toLowerCase()).single()
  await supabase.from('leaderboard').upsert({
    wallet_address: account.address.toLowerCase(),
    name: 'Arc Agent 001',
    pfp_url: 'https://api.dicebear.com/7.x/bottts/svg?seed=arc-agent-001&backgroundColor=062a51',
    total_calls: (existing?.total_calls ?? 0) + 1,
    wins: existing?.wins ?? 0,
    losses: existing?.losses ?? 0,
    win_rate: existing?.win_rate ?? 0,
    total_pnl: existing?.total_pnl ?? 0,
    total_volume: (existing?.total_volume ?? 0) + parseFloat(BET_AMOUNT_USDC),
    is_agent: true,
    updated_at: now,
  }, { onConflict: 'wallet_address' })

  // Update predictions_display pool
  const newYes = side === 'YES' ? Number(market.yes_pool) + parseFloat(BET_AMOUNT_USDC) : Number(market.yes_pool)
  const newNo  = side === 'NO'  ? Number(market.no_pool)  + parseFloat(BET_AMOUNT_USDC) : Number(market.no_pool)
  await supabase.from('predictions_display').update({ yes_pool: newYes, no_pool: newNo }).eq('id', market.id)

  // Wallet transaction
  await supabase.from('wallet_transactions').insert({
    wallet_address: account.address.toLowerCase(),
    type: 'bet',
    label: `Agent bet ${BET_AMOUNT_USDC} USDC on ${side} — ${market.title.slice(0, 40)}`,
    amount: parseFloat(BET_AMOUNT_USDC),
    tx_hash: hash,
    created_at: now,
  })

  console.log('[Arc Agent 001] Run complete.')
}

main().catch(e => { console.error('[Arc Agent 001] Fatal:', e); process.exit(1) })
