// agents/ecosystem-resolver.js
// Arc Calls — Ecosystem Resolver Agent
// Runs every hour via GitHub Actions (workflow: ecosystem-resolver.yml)
// Monitors Arc Mainnet on-chain stats for conditions set on predictions.
// When a condition triggers → calls lockBetting(id) on BettingPool on Arc Mainnet.
// Uses Blockscout API (chain 5042). No Twitter API required.
// DO NOT log the admin private key.

import { createWalletClient, createPublicClient, http, defineChain } from 'viem'
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
const MIN_GAS_GWEI  = 20n

// ─── BLOCKSCOUT API ───────────────────────────────────────────────────────────
const BLOCKSCOUT_BASE = 'https://api.blockscout.com/5042/api/v2'
const BLOCKSCOUT_KEY  = process.env.BLOCKSCOUT_API_KEY

// ─── ENVIRONMENT — all from GitHub Secrets ────────────────────────────────────
const ADMIN_KEY    = process.env.RESOLVER_ADMIN_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zxmfdvzkmeybujoowzgh.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
const BETTING_POOL = process.env.BETTING_POOL_ADDRESS || '0xD7b60891729bC02F8C786Dafb479CD6152f57925'

// ─── VALIDATE ENV — fail fast with clear message ──────────────────────────────
const missing = []
if (!ADMIN_KEY)    missing.push('RESOLVER_ADMIN_KEY')
if (!SUPABASE_KEY) missing.push('SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY')
if (missing.length > 0) {
  console.error('❌ Missing required GitHub Secrets:', missing.join(', '))
  console.error('   Add in: GitHub repo → Settings → Secrets and variables → Actions')
  process.exit(1)
}
if (!BLOCKSCOUT_KEY) {
  console.warn('⚠️  BLOCKSCOUT_API_KEY not set — using public API (rate limits may apply)')
}

// ─── MINIMAL ABI — only lockBetting needed ────────────────────────────────────
const LOCK_ABI = [
  {
    name: 'lockBetting', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [],
  },
]

// ─── CLIENTS ──────────────────────────────────────────────────────────────────
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
})
const account = privateKeyToAccount(
  ADMIN_KEY.trim().startsWith('0x') ? ADMIN_KEY.trim() : `0x${ADMIN_KEY.trim()}`
)
const walletClient = createWalletClient({ account, chain: arc, transport: http(RPC_URL) })
const publicClient = createPublicClient({ chain: arc, transport: http(RPC_URL) })

async function getMaxFeePerGas() {
  try {
    const fee  = await publicClient.estimateFeesPerGas()
    const base = fee.maxFeePerGas ?? MIN_GAS_GWEI * 10n ** 9n
    const min  = MIN_GAS_GWEI * 10n ** 9n
    return base < min ? min : base * 2n
  } catch {
    return MIN_GAS_GWEI * 10n ** 9n
  }
}

// ─── BLOCKSCOUT HELPERS ───────────────────────────────────────────────────────
const BS_HEADERS = {
  'User-Agent': 'ArcCallsEcoResolver/1.0',
  'Accept': 'application/json',
}

function bsUrl(path) {
  return BLOCKSCOUT_KEY
    ? `${BLOCKSCOUT_BASE}${path}?apikey=${BLOCKSCOUT_KEY}`
    : `${BLOCKSCOUT_BASE}${path}`
}

async function fetchArcStats() {
  const res = await fetch(bsUrl('/stats'), { headers: BS_HEADERS })
  if (!res.ok) throw new Error(`Blockscout /stats HTTP ${res.status}`)
  return res.json()
}

async function fetchVerifiedContractsCount() {
  const res = await fetch(bsUrl('/smart-contracts'), { headers: BS_HEADERS })
  if (!res.ok) throw new Error(`Blockscout /smart-contracts HTTP ${res.status}`)
  const d = await res.json()
  // next_page_params.smart_contract_id = cursor ID of the 51st item
  // adding 50 gives approximate total (IDs are sequential)
  return (d.next_page_params?.smart_contract_id ?? 0) + 50
}

// ─── CONDITION CHECKER ────────────────────────────────────────────────────────
// Supported condition_types:
//   total_transactions  — total_transactions field from /stats
//   total_addresses     — total_addresses field from /stats
//   daily_transactions  — transactions_today field from /stats
//   total_blocks        — total_blocks field from /stats
//   verified_contracts  — approximate count via /smart-contracts cursor
async function checkEcoCondition(monitor) {
  const { condition_type, threshold } = monitor
  const target = parseInt(threshold ?? '0', 10)

  if (['total_transactions', 'total_addresses', 'daily_transactions', 'total_blocks'].includes(condition_type)) {
    const stats = await fetchArcStats()

    const fieldMap = {
      total_transactions: 'total_transactions',
      total_addresses:    'total_addresses',
      daily_transactions: 'transactions_today',
      total_blocks:       'total_blocks',
    }

    const rawVal = stats[fieldMap[condition_type]]
    const current = parseInt(rawVal ?? '0', 10)
    const triggered = current >= target

    return {
      triggered,
      currentValue: current.toLocaleString(),
      rawData: { current, target, field: fieldMap[condition_type] },
      updatedMonitor: { ...monitor, last_value: current, last_checked_at: new Date().toISOString() },
    }
  }

  if (condition_type === 'verified_contracts') {
    const current = await fetchVerifiedContractsCount()
    const triggered = current >= target
    return {
      triggered,
      currentValue: current.toLocaleString(),
      rawData: { current, target },
      updatedMonitor: { ...monitor, last_value: current, last_checked_at: new Date().toISOString() },
    }
  }

  return { error: `Unknown eco condition_type: ${condition_type}` }
}

// ─── CONDITION DISPLAY LABELS ─────────────────────────────────────────────────
const ECO_CONDITION_LABELS = {
  total_transactions: 'Total Transactions',
  total_addresses:    'Total Unique Addresses',
  daily_transactions: 'Daily Transactions (24h)',
  total_blocks:       'Total Blocks',
  verified_contracts: 'Verified Smart Contracts',
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('════════════════════════════════════════')
  console.log(' ECOSYSTEM RESOLVER — Arc Calls')
  console.log(` Started: ${new Date().toISOString()}`)
  console.log(`   Admin: ${account.address}`)
  console.log(`   Chain: Arc Mainnet (5042)`)
  console.log('════════════════════════════════════════\n')

  const { data: predictions, error: fetchError } = await supabase
    .from('predictions_display')
    .select('id, title, status, deadline, eco_monitor')
    .eq('status', 'open')
    .not('eco_monitor', 'is', null)

  if (fetchError) {
    console.error('Failed to fetch predictions:', fetchError.message)
    process.exit(1)
  }

  if (!predictions || predictions.length === 0) {
    console.log('No predictions with Ecosystem monitoring active. Nothing to do.')
    return
  }

  console.log(`Found ${predictions.length} prediction(s) to monitor:\n`)

  for (const pred of predictions) {
    const monitor   = pred.eco_monitor
    const condition = monitor.condition_type ?? 'unknown'
    const condLabel = ECO_CONDITION_LABELS[condition] ?? condition.replace(/_/g, ' ')

    console.log(`─── Prediction #${pred.id}: ${pred.title.slice(0, 60)}`)
    console.log(`    Arc Mainnet · ${condLabel}`)

    // Deadline check — skip predictions whose deadline has already passed
    if (pred.deadline) {
      const deadlineTs = new Date(pred.deadline).getTime()
      if (!isNaN(deadlineTs) && Date.now() > deadlineTs) {
        console.log('    ⏰ Deadline passed — bet is auto-locked, skipping resolver check')
        await supabase.from('x_monitor_logs').insert({
          prediction_id:  pred.id,
          handle:         'arc-mainnet',
          condition_type: condition,
          current_value:  'Deadline passed — bet auto-locked',
          threshold:      String(monitor.threshold ?? ''),
          triggered:      true,
          action_taken:   'Deadline passed — bet auto-locked by contract',
          checked_at:     new Date().toISOString(),
        })
        continue
      }
    }

    // Rate limit: 1s between Blockscout calls
    await new Promise(r => setTimeout(r, 1000))

    const result = await checkEcoCondition(monitor).catch(e => ({ error: e.message }))

    if (result.error) {
      console.log(`    ⚠️  Error: ${result.error}`)
      await supabase.from('x_monitor_logs').insert({
        prediction_id:  pred.id,
        handle:         'arc-mainnet',
        condition_type: condition,
        current_value:  'Error',
        threshold:      String(monitor.threshold ?? ''),
        triggered:      false,
        action_taken:   null,
        error:          result.error,
        checked_at:     new Date().toISOString(),
      })
      continue
    }

    // ── Professional status display ──────────────────────────────────────────
    const target  = monitor.threshold ? parseInt(monitor.threshold) : null
    const tgtFmt  = target ? target.toLocaleString() : '—'
    const curNum  = parseInt((result.currentValue || '0').replace(/[^0-9]/g, ''))
    const pct     = target ? Math.min(100, Math.round((curNum / target) * 100)) : null

    console.log(`    Current:  ${result.currentValue}`)
    console.log(`    Target:   ${tgtFmt}`)
    if (pct !== null) console.log(`    Progress: ${pct}%`)
    console.log(`    Status:   ${result.triggered ? '🔒 TRIGGERED' : '👀 monitoring'}`)

    // Persist updated eco_monitor state (last_value, last_checked_at)
    if (result.updatedMonitor && JSON.stringify(result.updatedMonitor) !== JSON.stringify(monitor)) {
      const { error: updateErr } = await supabase
        .from('predictions_display')
        .update({ eco_monitor: result.updatedMonitor })
        .eq('id', pred.id)
      if (updateErr) console.warn(`    ⚠️  Failed to update eco_monitor state: ${updateErr.message}`)
    }

    // Always log the check result
    await supabase.from('x_monitor_logs').insert({
      prediction_id:  pred.id,
      handle:         'arc-mainnet',
      condition_type: condition,
      current_value:  result.currentValue,
      threshold:      String(monitor.threshold ?? ''),
      triggered:      result.triggered,
      action_taken:   result.triggered ? 'Locked prediction on-chain' : null,
      raw_data:       result.rawData ?? null,
      checked_at:     new Date().toISOString(),
    })

    if (result.triggered) {
      try {
        console.log(`    🔒 Locking prediction #${pred.id} on Arc Mainnet...`)
        const maxFeePerGas = await getMaxFeePerGas()
        const txHash = await walletClient.writeContract({
          address:         BETTING_POOL,
          abi:             LOCK_ABI,
          functionName:    'lockBetting',
          args:            [BigInt(pred.id)],
          maxFeePerGas,
        })
        console.log(`    ⏳ Waiting for lock tx: ${txHash}`)

        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 })

        if (receipt.status === 'success') {
          console.log(`    ✅ Locked! Block: ${receipt.blockNumber} Tx: ${txHash}`)
          console.log(`       https://explorer.arc.io/tx/${txHash}`)

          await supabase
            .from('predictions_display')
            .update({ status: 'locked' })
            .eq('id', pred.id)

          await supabase.from('x_monitor_logs').insert({
            prediction_id:  pred.id,
            handle:         'arc-mainnet',
            condition_type: condition,
            current_value:  result.currentValue,
            threshold:      String(monitor.threshold ?? ''),
            triggered:      true,
            action_taken:   `Locked on-chain — tx: ${txHash}`,
            checked_at:     new Date().toISOString(),
          })
        } else {
          console.error(`    ❌ Lock tx reverted: ${txHash}`)
          await supabase.from('x_monitor_logs').insert({
            prediction_id:  pred.id,
            handle:         'arc-mainnet',
            condition_type: condition,
            current_value:  result.currentValue,
            triggered:      true,
            action_taken:   null,
            error:          `Lock tx reverted: ${txHash}`,
            checked_at:     new Date().toISOString(),
          })
        }
      } catch (e) {
        const errMsg = e?.shortMessage ?? e?.message ?? 'Unknown error'
        console.error(`    ❌ Lock failed: ${errMsg}`)
        await supabase.from('x_monitor_logs').insert({
          prediction_id:  pred.id,
          handle:         'arc-mainnet',
          condition_type: condition,
          current_value:  result.currentValue,
          triggered:      true,
          action_taken:   null,
          error:          `Lock tx failed: ${errMsg}`,
          checked_at:     new Date().toISOString(),
        })
      }
    }

    console.log()
  }

  console.log('════════════════════════════════════════')
  console.log(` Done: ${new Date().toISOString()}`)
  console.log('════════════════════════════════════════')
}

run().catch(e => {
  console.error('Fatal error:', e)
  process.exit(1)
})

