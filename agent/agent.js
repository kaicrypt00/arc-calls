/**
 * Arc Calls — Arc Agent 001 Autonomous Betting Agent
 * Runs daily at 8:00 AM UTC via GitHub Actions (workflow: agent-bet.yml).
 * Places 1 bet of 0.1 USDC per run on the open market with the earliest deadline.
 * Uses OpenRouter free models for strict YES/NO decision with fallback resilience.
 *
 * Gas strategy (Arc Mainnet): maxFeePerGas = max(baseFee × 2, 20 Gwei)
 * Arc is EIP-1559 compatible; fees change with network load — never hardcode.
 */

import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createClient } from '@supabase/supabase-js'

// ─── ARC MAINNET CONFIG ───────────────────────────────────────────────────────
const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

const RPC_URL       = 'https://rpc.mainnet.arc.io'
const USDC_ADDRESS  = '0x3600000000000000000000000000000000000000'
const BET_AMOUNT_USDC = '0.1'   // 0.1 USDC per bet
const BETS_PER_RUN  = 1
const MIN_GAS_GWEI  = 20n       // Arc Mainnet minimum gas (Gwei) — per ARCHITECTURE.md

// ─── ENVIRONMENT ──────────────────────────────────────────────────────────────
const RAW_KEY            = process.env.AGENT_WALLET_KEY || process.env.AGENT_PRIVATE_KEY
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY
const SUPABASE_URL       = process.env.SUPABASE_URL || 'https://zxmfdvzkmeybujoowzgh.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
// BettingPool address — redeployed contract (0xa8e01...), matches frontend + Arc Mainnet
// See AGENTS.md: "BettingPool | 0xa8e01ece16038D481f13a6AaAb692b2FD0Caa1d8 (redeployed)"
const BETTING_POOL = process.env.BETTING_POOL_ADDRESS || '0xa8e01ece16038D481f13a6AaAb692b2FD0Caa1d8'

// Side constants: 1 = YES, 2 = NO (matches BettingPool contract)
const SIDE = { YES: 1, NO: 2 }

const ERC20_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view',    inputs: [{ name: 'account', type: 'address' }],                                      outputs: [{ name: '', type: 'uint256' }] },
  { name: 'allowance', type: 'function', stateMutability: 'view',    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],  outputs: [{ name: '', type: 'uint256' }] },
  { name: 'approve',   type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
]

const BETTING_POOL_ABI = [
  { name: 'placeBet',      type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'side', type: 'uint8' }, { name: 'amount', type: 'uint256' }], outputs: [] },
  { name: 'isBettingLocked', type: 'function', stateMutability: 'view',    inputs: [{ name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  // getUserBet — used to verify on-chain whether agent already placed a bet on a market
  // Returns (side: uint8, amount: uint256, claimed: bool). side > 0 means already bet.
  { name: 'getUserBet',    type: 'function', stateMutability: 'view',       inputs: [{ name: 'id', type: 'uint256' }, { name: 'user', type: 'address' }], outputs: [{ name: 'side', type: 'uint8' }, { name: 'amount', type: 'uint256' }, { name: 'claimed', type: 'bool' }] },
]

// ─── GAS HELPER (Arc Mainnet: EIP-1559, fees fluctuate) ──────────────────────
// Strategy from ARCHITECTURE.md: maxFeePerGas = max(baseFee × 2, 20 Gwei)
// Never pass a fixed gas limit — let viem auto-estimate per transaction.
async function getMaxFeePerGas(publicClient) {
  try {
    const fee  = await publicClient.estimateFeesPerGas()
    const base = fee.maxFeePerGas ?? (MIN_GAS_GWEI * 10n ** 9n)
    const min  = MIN_GAS_GWEI * 10n ** 9n
    return base < min ? min : base * 2n
  } catch {
    return MIN_GAS_GWEI * 10n ** 9n
  }
}

// ─── AI DECISION ENGINE (OpenRouter Free Models) ──────────────────────────────
async function getAIDecision(market) {
  const yesPool = parseFloat(market.yes_pool || 0)
  const noPool  = parseFloat(market.no_pool  || 0)
  const total   = yesPool + noPool
  const yesPct  = total > 0 ? ((yesPool / total) * 100).toFixed(1) : '50.0'
  const noPct   = total > 0 ? ((noPool  / total) * 100).toFixed(1) : '50.0'

  const deadline = market.no_deadline
    ? 'No deadline'
    : new Date(market.deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

  const prompt =
    `You are Arc Agent 001, an autonomous AI prediction market trader on Arc Calls.\n` +
    `Analyze this prediction market:\n\n` +
    `Market: "${market.title}"\n` +
    `Description: "${market.description || 'No description provided.'}"\n` +
    `Current pool odds: ${yesPct}% YES (${yesPool} USDC), ${noPct}% NO (${noPool} USDC)\n` +
    `Deadline: ${deadline}\n\n` +
    `Evaluate market probability and odds.\n` +
    `Respond with strictly one word: YES or NO`

  const FREE_MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'meta-llama/llama-3.1-8b-instruct:free',
    'mistralai/mistral-7b-instruct:free',
    'google/gemini-2.0-flash-lite:free',
    'google/gemma-3-4b-it:free',
  ]

  if (OPENROUTER_API_KEY) {
    for (const model of FREE_MODELS) {
      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://arc-calls.vercel.app',
            'X-Title': 'Arc Agent 001',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 10,
            temperature: 0.2,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          const raw  = (data.choices?.[0]?.message?.content || '').trim().toUpperCase()
          if (raw === 'YES' || raw.startsWith('YES')) { console.log(`🤖 AI decision from [${model}]: YES`); return 'YES' }
          if (raw === 'NO'  || raw.startsWith('NO'))  { console.log(`🤖 AI decision from [${model}]: NO`);  return 'NO'  }
          console.warn(`⚠️ Model [${model}] returned "${raw}". Trying next fallback...`)
        } else {
          const errText = await res.text().catch(() => '')
          console.warn(`⚠️ OpenRouter notice for [${model}] (${res.status}): ${errText.slice(0, 100)}. Trying fallback...`)
        }
      } catch (e) {
        console.warn(`⚠️ Fetch failed for [${model}]: ${e.message}`)
      }
    }
  }

  // Heuristic fallback: bet where crowd is leaning, or YES when even
  console.log('📊 AI endpoints exhausted or API key not present. Using heuristic fallback.')
  const yp = parseFloat(market.yes_pool || 0)
  const np = parseFloat(market.no_pool  || 0)
  if (yp > np * 1.3) return 'YES'
  if (np > yp * 1.3) return 'NO'
  return yp <= np ? 'YES' : 'NO'
}

// ─── MAIN RUN ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🤖 Arc Agent 001 — Daily Bet Run')
  console.log(`   BettingPool: ${BETTING_POOL}`)

  if (!RAW_KEY) {
    console.error('❌ AGENT_WALLET_KEY (or AGENT_PRIVATE_KEY) not set in environment.')
    process.exit(1)
  }
  if (!SUPABASE_SERVICE_KEY) {
    console.error('❌ SUPABASE_SERVICE_ROLE_KEY not set in environment.')
    process.exit(1)
  }

  const cleanKey    = RAW_KEY.trim().startsWith('0x') ? RAW_KEY.trim() : `0x${RAW_KEY.trim()}`
  const account     = privateKeyToAccount(cleanKey)
  const publicClient  = createPublicClient({ chain: arc, transport: http(RPC_URL) })
  const walletClient  = createWalletClient({ account, chain: arc, transport: http(RPC_URL) })
  const supabase    = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  console.log(`   Wallet: ${account.address}`)
  console.log(`   Bet size: ${BET_AMOUNT_USDC} USDC\n`)

  // 1. Check USDC Balance
  const rawBalance = await publicClient.readContract({
    address: USDC_ADDRESS, abi: ERC20_ABI,
    functionName: 'balanceOf', args: [account.address],
  })
  const balance    = parseFloat(formatUnits(rawBalance, 6))
  const minRequired = parseFloat(BET_AMOUNT_USDC) * BETS_PER_RUN
  console.log(`💰 USDC Balance: ${balance.toFixed(4)} (Need at least ${minRequired} USDC)`)

  if (balance < minRequired) {
    console.error(`❌ Insufficient USDC balance (${balance.toFixed(4)} < ${minRequired}). Top up wallet ${account.address} on Arc Mainnet.`)
    process.exit(1)  // exit(1) so GitHub Actions flags it as FAILED — sends email notification
  }

  // 2. Fetch Open Markets from Supabase
  const { data: markets, error: mError } = await supabase
    .from('predictions_display')
    .select('id, title, description, status, yes_pool, no_pool, deadline, no_deadline')
    .eq('status', 'open')
    .order('deadline', { ascending: true })
    .limit(30)

  if (mError) {
    console.error(`❌ Supabase error loading markets: ${mError.message}`)
    process.exit(1)
  }

  if (!markets || markets.length === 0) {
    console.log('✓ No open markets found. Exiting.')
    process.exit(0)
  }

  console.log(`📋 Open markets in Supabase: ${markets.length}`)

  // 3. Filter out markets already bet on
  //    DUAL CHECK: Supabase bets table AND on-chain getUserBet
  //    The on-chain check is the source of truth — prevents TX reverts if
  //    Supabase bets table is out of sync with on-chain state.
  const { data: existingBets } = await supabase
    .from('bets')
    .select('prediction_id')
    .eq('wallet_address', account.address.toLowerCase())

  const supabaseBettedIds = new Set((existingBets || []).map(b => String(b.prediction_id)))
  console.log(`   Already bet (Supabase): ${supabaseBettedIds.size} market(s) → [${[...supabaseBettedIds].join(', ') || 'none'}]`)

  const now = Date.now()
  const eligible = []

  for (const m of markets) {
    // Skip if recorded in Supabase bets
    if (supabaseBettedIds.has(String(m.id))) {
      console.log(`   ⏭  Market #${m.id} — skipped (already in Supabase bets)`)
      continue
    }

    // Skip if too close to deadline (< 5 min)
    if (!m.no_deadline && m.deadline) {
      const dl = new Date(m.deadline).getTime()
      if (now >= dl - 5 * 60 * 1000) {
        console.log(`   ⏭  Market #${m.id} — skipped (deadline too close)`)
        continue
      }
    }

    // On-chain check 1: isBettingLocked
    try {
      const locked = await publicClient.readContract({
        address: BETTING_POOL, abi: BETTING_POOL_ABI,
        functionName: 'isBettingLocked', args: [BigInt(m.id)],
      })
      if (locked) {
        console.log(`   ⏭  Market #${m.id} — skipped (betting locked on-chain)`)
        continue
      }
    } catch {
      // If view call fails, still try — the write will revert if truly locked
    }

    // On-chain check 2: getUserBet — catches bets placed on-chain but missing from Supabase
    try {
      const [betSide] = await publicClient.readContract({
        address: BETTING_POOL, abi: BETTING_POOL_ABI,
        functionName: 'getUserBet', args: [BigInt(m.id), account.address],
      })
      if (Number(betSide) > 0) {
        console.log(`   ⏭  Market #${m.id} — skipped (bet exists on-chain, side=${betSide}, Supabase was out of sync)`)
        // Backfill Supabase so future runs don't repeat this check
        const { error: backfillErr } = await supabase.from('bets').insert({
          prediction_id:  m.id,
          wallet_address: account.address.toLowerCase(),
          side:           Number(betSide) === 1 ? 'YES' : 'NO',
          amount:         parseFloat(BET_AMOUNT_USDC),
          result:         'pending',
          payout:         0,
          tx_hash:        'backfilled-from-chain',
        })
        if (backfillErr) console.warn(`   ⚠️ Backfill insert failed: ${backfillErr.message}`)
        else             console.log(`   ✅ Backfilled Market #${m.id} bet into Supabase`)
        continue
      }
    } catch (e) {
      // getUserBet might not exist on older contract versions — proceed
      console.warn(`   ⚠️ getUserBet check failed for market #${m.id}: ${e.message}`)
    }

    eligible.push(m)
    console.log(`   ✅ Market #${m.id} — eligible`)
  }

  console.log(`\n📊 Eligible new markets: ${eligible.length}`)
  if (eligible.length === 0) {
    console.log('✓ All open markets already called by Arc Agent 001. Done.')
    process.exit(0)
  }

  // 4. Select earliest deadline market
  const targetMarket = eligible[0]
  console.log(`\n🎯 Target Market #${targetMarket.id}: "${targetMarket.title}"`)

  // 5. Get AI Decision
  const decision = await getAIDecision(targetMarket)
  const sideNum  = decision === 'YES' ? SIDE.YES : SIDE.NO
  console.log(`🤖 Arc Agent 001 Decision: ${decision}`)

  // 6. Ensure USDC Spend Allowance
  const rawBet    = parseUnits(BET_AMOUNT_USDC, 6)
  const allowance = await publicClient.readContract({
    address: USDC_ADDRESS, abi: ERC20_ABI,
    functionName: 'allowance', args: [account.address, BETTING_POOL],
  })

  if (allowance < rawBet) {
    console.log('📝 Approving USDC spend for BettingPool...')
    const maxFeePerGas = await getMaxFeePerGas(publicClient)
    const MAX_UINT256  = 2n ** 256n - 1n
    const approveTx = await walletClient.writeContract({
      address: USDC_ADDRESS, abi: ERC20_ABI,
      functionName: 'approve', args: [BETTING_POOL, MAX_UINT256],
      maxFeePerGas,
    })
    await publicClient.waitForTransactionReceipt({ hash: approveTx })
    console.log(`✓ Approved. Tx: ${approveTx}`)
  } else {
    console.log(`✓ USDC allowance sufficient (${formatUnits(allowance, 6)} USDC approved)`)
  }

  // 7. Execute Bet On-Chain
  //    Arc gas: maxFeePerGas = max(baseFee × 2, 20 Gwei) — dynamically computed.
  //    No hardcoded gas limit — viem auto-estimates per transaction.
  console.log(`💸 Placing ${BET_AMOUNT_USDC} USDC on ${decision} for Market #${targetMarket.id}...`)
  const maxFeePerGas = await getMaxFeePerGas(publicClient)
  console.log(`   maxFeePerGas: ${formatUnits(maxFeePerGas, 9)} Gwei`)

  const txHash = await walletClient.writeContract({
    address: BETTING_POOL, abi: BETTING_POOL_ABI,
    functionName: 'placeBet', args: [BigInt(targetMarket.id), sideNum, rawBet],
    maxFeePerGas,
  })

  console.log(`   Tx submitted: ${txHash}`)
  console.log(`   Waiting for confirmation...`)
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  if (receipt.status === 'reverted') {
    throw new Error(`Bet transaction reverted on-chain. Tx: ${txHash}\n   Explorer: https://explorer.arc.io/tx/${txHash}`)
  }

  console.log(`✅ Bet confirmed! Block: ${receipt.blockNumber}`)
  console.log(`   Explorer: https://explorer.arc.io/tx/${txHash}`)

  // 8. Record in Supabase — all three tables
  const wallet     = account.address.toLowerCase()
  const betAmtNum  = parseFloat(BET_AMOUNT_USDC)
  const timestamp  = new Date().toISOString()

  // 8a. Insert into bets table — FATAL on error (this is the source of truth)
  const { error: betError } = await supabase.from('bets').insert({
    prediction_id:  targetMarket.id,
    wallet_address: wallet,
    side:           decision,
    amount:         betAmtNum,
    result:         'pending',
    payout:         0,
    tx_hash:        txHash,
    created_at:     timestamp,
  })
  if (betError) {
    // Bet is already on-chain — throw so the error is visible in GitHub Actions logs
    throw new Error(`❌ bets table insert FAILED after confirmed on-chain tx ${txHash}: ${betError.message} (code: ${betError.code})`)
  }
  console.log('✅ Recorded in bets table')

  // 8b. Update leaderboard
  const { data: existingLB, error: lbReadErr } = await supabase
    .from('leaderboard')
    .select('total_volume, total_calls, wins, losses, win_rate, total_pnl')
    .eq('wallet_address', wallet)
    .single()

  if (lbReadErr && lbReadErr.code !== 'PGRST116') {
    console.warn(`⚠️ Leaderboard read error: ${lbReadErr.message}`)
  }

  const { error: lbErr } = await supabase.from('leaderboard').upsert({
    wallet_address: wallet,
    name:           'Arc Agent 001',
    pfp_url:        'https://arc-calls.vercel.app/agent-pfp.jpg',
    total_calls:    (existingLB?.total_calls  || 0) + 1,
    wins:           existingLB?.wins          || 0,
    losses:         existingLB?.losses        || 0,
    win_rate:       existingLB?.win_rate      || 0,
    total_pnl:      existingLB?.total_pnl     || 0,
    total_volume:   (existingLB?.total_volume || 0) + betAmtNum,
    is_agent:       true,
    updated_at:     timestamp,
  }, { onConflict: 'wallet_address' })
  if (lbErr) console.warn(`⚠️ Leaderboard upsert error: ${lbErr.message}`)
  else        console.log('✅ Leaderboard updated')

  // 8c. Update predictions_display pool
  const currentYes  = parseFloat(targetMarket.yes_pool || 0)
  const currentNo   = parseFloat(targetMarket.no_pool  || 0)
  const updatePayload = decision === 'YES'
    ? { yes_pool: currentYes + betAmtNum }
    : { no_pool:  currentNo  + betAmtNum }

  const { error: poolErr } = await supabase
    .from('predictions_display').update(updatePayload).eq('id', targetMarket.id)
  if (poolErr) console.warn(`⚠️ Pool update error: ${poolErr.message}`)
  else         console.log('✅ Pool updated in predictions_display')

  // 8d. wallet_transactions — best-effort, never fatal
  try {
    await supabase.from('wallet_transactions').insert({
      wallet_address: wallet,
      type:           'bet',
      label:          `Called ${BET_AMOUNT_USDC} USDC ${decision} — "${targetMarket.title.slice(0, 40)}..."`,
      amount:         betAmtNum,
      tx_hash:        txHash,
      created_at:     timestamp,
    })
  } catch (e) {
    console.warn(`⚠️ wallet_transactions insert skipped: ${e.message}`)
  }

  console.log('\n📊 All Supabase records written.')
  console.log('🏁 Arc Agent 001 run complete!')
}

main().catch(err => {
  console.error('\n💥 Fatal agent error:', err.message)
  process.exit(1)
})
