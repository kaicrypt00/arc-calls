// agent/claim.js
// Arc Agent 001 — Claim Script
// Triggered by GitHub Actions at 8:00 PM UTC daily (workflow: agent-claim.yml)
// or manually from GitHub Actions tab.
// Scans pending bets for Arc Agent 001. For each settled market:
//   WIN    → claimWinnings on-chain, update bets to 'won', update leaderboard & wallet_transactions
//   LOSS   → update bets to 'lost', update leaderboard (no on-chain tx needed)
//   REFUND → claimRefund on-chain, update bets to 'refunded' & wallet_transactions

import { createPublicClient, createWalletClient, http, formatUnits, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createClient } from '@supabase/supabase-js'

// ─── ENVIRONMENT ──────────────────────────────────────────────────────────────
const RAW_KEY = process.env.AGENT_WALLET_KEY || process.env.AGENT_PRIVATE_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zxmfdvzkmeybujoowzgh.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const RPC_URL = 'https://rpc.mainnet.arc.io'
const BETTING_POOL_ADDRESS = process.env.BETTING_POOL_ADDRESS || '0xD7b60891729bC02F8C786Dafb479CD6152f57925'
const MIN_GAS_GWEI = 20n

// Arc Mainnet
const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

const BETTING_POOL_ABI = [
  {
    name: 'getUserBet', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [
      { name: 'side', type: 'uint8' },
      { name: 'amount', type: 'uint256' },
      { name: 'claimed', type: 'bool' },
    ],
  },
  {
    name: 'getClaimableAmount', type: 'function', stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'uint256' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'claimWinnings', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'claimRefund', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
]

async function getMaxFeePerGas(publicClient) {
  try {
    const fee = await publicClient.estimateFeesPerGas()
    const base = fee.maxFeePerGas ?? MIN_GAS_GWEI * 10n ** 9n
    const min = MIN_GAS_GWEI * 10n ** 9n
    return base < min ? min : base * 2n
  } catch {
    return MIN_GAS_GWEI * 10n ** 9n
  }
}

if (!RAW_KEY || !SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing required secrets: AGENT_WALLET_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const cleanKey = RAW_KEY.trim().startsWith('0x') ? RAW_KEY.trim() : `0x${RAW_KEY.trim()}`
const account = privateKeyToAccount(cleanKey)
const publicClient = createPublicClient({ chain: arc, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: arc, transport: http(RPC_URL) })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

console.log('\n🤖 Arc Agent 001 — Claim Run')
console.log(`   Wallet: ${account.address}\n`)

async function main() {
  const wallet = account.address.toLowerCase()

  const { data: pending, error } = await supabase
    .from('bets')
    .select('prediction_id, side, amount, result')
    .eq('wallet_address', wallet)
    .eq('result', 'pending')

  if (error) {
    console.error('❌ Supabase error fetching pending bets:', error.message)
    return
  }

  if (!pending?.length) {
    console.log('✓ No pending bets. Nothing to claim.')
    return
  }

  console.log(`📋 Checking ${pending.length} pending bet(s)...\n`)

  for (const bet of pending) {
    try {
      await checkAndClaim(bet, wallet)
      await new Promise(r => setTimeout(r, 1500))
    } catch (err) {
      console.error(`❌ Error on market #${bet.prediction_id}: ${err.message}`)
    }
  }

  console.log('\n🏁 Claim run complete.')
}

async function checkAndClaim(bet, wallet) {
  const { data: market } = await supabase
    .from('predictions_display')
    .select('status, title')
    .eq('id', bet.prediction_id)
    .single()

  if (!market) {
    console.log(`⚠️ Market #${bet.prediction_id} not found in DB. Skipping.`)
    return
  }

  const isSettled = ['yes_wins', 'no_wins'].includes(market.status)
  const isRefunded = market.status === 'refunded'

  if (!isSettled && !isRefunded) {
    console.log(`⏳ Market #${bet.prediction_id} ("${market.title.slice(0, 35)}..."): status=${market.status} — not yet settled.`)
    return
  }

  const id = BigInt(bet.prediction_id)

  let onChainSide = 0
  let onChainAmount = 0n
  let alreadyClaimed = false

  try {
    const res = await publicClient.readContract({
      address: BETTING_POOL_ADDRESS,
      abi: BETTING_POOL_ABI,
      functionName: 'getUserBet',
      args: [id, account.address],
    })
    onChainSide = Number(res[0])
    onChainAmount = res[1]
    alreadyClaimed = Boolean(res[2])
  } catch (err) {
    console.warn(`⚠️ Could not read on-chain bet for market #${bet.prediction_id}: ${err.message}`)
    return
  }

  if (onChainSide === 0) {
    console.log(`⚠️ No on-chain bet found for market #${bet.prediction_id}. Skipping.`)
    return
  }

  if (alreadyClaimed) {
    await supabase.from('bets')
      .update({ result: 'claimed' })
      .eq('prediction_id', bet.prediction_id)
      .eq('wallet_address', wallet)
    console.log(`✓ "${market.title.slice(0, 35)}...": already claimed on-chain — synced with DB`)
    return
  }

  const maxFeePerGas = await getMaxFeePerGas(publicClient)

  // ── REFUND ─────────────────────────────────────────────────────────────
  if (isRefunded) {
    console.log(`↩️ "${market.title.slice(0, 35)}...": claiming refund...`)
    const txHash = await walletClient.writeContract({
      address: BETTING_POOL_ADDRESS,
      abi: BETTING_POOL_ABI,
      functionName: 'claimRefund',
      args: [id],
      maxFeePerGas,
    })
    await publicClient.waitForTransactionReceipt({ hash: txHash })
    await supabase.from('bets')
      .update({ result: 'refunded' })
      .eq('prediction_id', bet.prediction_id)
      .eq('wallet_address', wallet)

    const refundAmt = parseFloat(formatUnits(onChainAmount, 6))
    await supabase.from('wallet_transactions').insert({
      wallet_address: wallet,
      type: 'refund',
      label: `Claimed refund — ${market.title.slice(0, 40)}`,
      amount: refundAmt,
      tx_hash: txHash,
      created_at: new Date().toISOString(),
    }).catch(() => {})

    console.log(`✅ Refund claimed! Tx: ${txHash}`)
    return
  }

  // ── WIN OR LOSS ────────────────────────────────────────────────────────
  const winningSide = market.status === 'yes_wins' ? 1 : 2
  const agentWon = onChainSide === winningSide
  const betAmt = parseFloat(formatUnits(onChainAmount, 6))

  if (!agentWon) {
    await supabase.from('bets')
      .update({ result: 'lost', payout: 0 })
      .eq('prediction_id', bet.prediction_id)
      .eq('wallet_address', wallet)
    await updateLeaderboardLoss(wallet, betAmt)
    console.log(`📉 "${market.title.slice(0, 35)}...": LOST — ${betAmt} USDC`)
    return
  }

  // Claimable winnings
  const claimable = await publicClient.readContract({
    address: BETTING_POOL_ADDRESS,
    abi: BETTING_POOL_ABI,
    functionName: 'getClaimableAmount',
    args: [id, account.address],
  })

  if (claimable === 0n) {
    console.log(`⚠️ "${market.title.slice(0, 35)}...": won but 0 claimable.`)
    return
  }

  const payout = parseFloat(formatUnits(claimable, 6))
  console.log(`🏆 "${market.title.slice(0, 35)}...": WON! Claiming ${payout.toFixed(4)} USDC...`)

  const txHash = await walletClient.writeContract({
    address: BETTING_POOL_ADDRESS,
    abi: BETTING_POOL_ABI,
    functionName: 'claimWinnings',
    args: [id],
    maxFeePerGas,
  })
  await publicClient.waitForTransactionReceipt({ hash: txHash })
  console.log(`✅ Winnings claimed! Tx: ${txHash}`)

  await supabase.from('bets')
    .update({ result: 'won', payout })
    .eq('prediction_id', bet.prediction_id)
    .eq('wallet_address', wallet)

  await updateLeaderboardWin(wallet, payout, betAmt)

  await supabase.from('wallet_transactions').insert({
    wallet_address: wallet,
    type: 'claim',
    label: `Claimed ${payout.toFixed(2)} USDC winnings — ${market.title.slice(0, 40)}`,
    amount: payout,
    tx_hash: txHash,
    created_at: new Date().toISOString(),
  }).catch(() => {})
}

async function updateLeaderboardWin(wallet, payout, betAmt) {
  const { data: row } = await supabase
    .from('leaderboard')
    .select('wins, losses, total_pnl')
    .eq('wallet_address', wallet)
    .single()
  if (!row) return

  const wins = (row.wins || 0) + 1
  const losses = row.losses || 0
  const winRate = (wins + losses) > 0
    ? parseFloat(((wins / (wins + losses)) * 100).toFixed(2))
    : 0

  await supabase.from('leaderboard').update({
    wins,
    win_rate: winRate,
    total_pnl: parseFloat(((row.total_pnl || 0) + (payout - betAmt)).toFixed(6)),
    updated_at: new Date().toISOString(),
  }).eq('wallet_address', wallet)
}

async function updateLeaderboardLoss(wallet, betAmt) {
  const { data: row } = await supabase
    .from('leaderboard')
    .select('wins, losses, total_pnl')
    .eq('wallet_address', wallet)
    .single()
  if (!row) return

  const losses = (row.losses || 0) + 1
  const wins = row.wins || 0
  const winRate = (wins + losses) > 0
    ? parseFloat(((wins / (wins + losses)) * 100).toFixed(2))
    : 0

  await supabase.from('leaderboard').update({
    losses,
    win_rate: winRate,
    total_pnl: parseFloat(((row.total_pnl || 0) - betAmt).toFixed(6)),
    updated_at: new Date().toISOString(),
  }).eq('wallet_address', wallet)
}

main().catch(err => {
  console.error('\n💥 Claim fatal error:', err.message)
  process.exit(1)
})
