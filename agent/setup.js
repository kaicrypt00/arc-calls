// agent/setup.js
// Arc Agent 001 — Setup & Identity Script
// Run ONCE via GitHub Actions (workflow: agent-setup.yml → "Run workflow" button)
// or locally with: node setup.js
// Creates Arc Agent 001's on-chain profile and Supabase records.
// DO NOT log the private key.

import { createPublicClient, createWalletClient, http, defineChain } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ─── ENVIRONMENT (from GitHub Secrets / env) ──────────────────────────────
const RAW_KEY = process.env.AGENT_WALLET_KEY || process.env.AGENT_PRIVATE_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zxmfdvzkmeybujoowzgh.supabase.co'
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BETTING_POOL_ADDRESS = process.env.BETTING_POOL_ADDRESS || '0xD7b60891729bC02F8C786Dafb479CD6152f57925'
const PROFILE_REGISTRY_ADDRESS = process.env.PROFILE_REGISTRY_ADDRESS || '0xBc199573Bfaea3c3Ee55c55B090C518ed82385Ce'

// ─── AGENT PROFILE DETAILS ────────────────────────────────────────────────
const AGENT_NAME = 'Arc Agent 001'
const AGENT_BIO = 'Autonomous AI Prediction Market Trader on Arc Calls.'
const AGENT_X_USERNAME = 'arcagent001'
const AGENT_PFP_FALLBACK = 'https://arc-calls.vercel.app/agent-pfp.jpg'

// ─── ARC MAINNET CHAIN CONFIG ─────────────────────────────────────────────
const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

const RPC_URL = 'https://rpc.mainnet.arc.io'
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000'
const MIN_GAS_GWEI = 20n

// Minimal ABIs
const PROFILE_REGISTRY_ABI = [
  {
    name: 'mintProfile', type: 'function', stateMutability: 'nonpayable',
    inputs: [
      { name: '_name', type: 'string' },
      { name: '_bio', type: 'string' },
      { name: '_pfpHash', type: 'string' },
      { name: '_xUsername', type: 'string' },
    ],
    outputs: [],
  },
  {
    name: 'hasProfile', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ type: 'bool' }],
  },
]

const ERC20_ABI = [
  {
    name: 'balanceOf', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'allowance', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }],
    outputs: [{ type: 'bool' }],
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

if (!RAW_KEY) {
  console.error('❌ Missing AGENT_WALLET_KEY (or AGENT_PRIVATE_KEY) in GitHub Secrets.')
  process.exit(1)
}

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY in GitHub Secrets.')
  process.exit(1)
}

const cleanKey = RAW_KEY.trim().startsWith('0x') ? RAW_KEY.trim() : `0x${RAW_KEY.trim()}`
const account = privateKeyToAccount(cleanKey)
const publicClient = createPublicClient({ chain: arc, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: arc, transport: http(RPC_URL) })
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

console.log('\n🤖 Arc Agent 001 — Setup')
console.log(`   Agent wallet: ${account.address}`)
console.log(`   Name:         ${AGENT_NAME}`)
console.log(`   Bio:          ${AGENT_BIO}`)
console.log(`   X:            @${AGENT_X_USERNAME}`)
console.log()

async function main() {
  const wallet = account.address.toLowerCase()

  // ── STEP 0: Sync Agent Avatar to Supabase Storage ─────────────────────────
  let pfpUrl = AGENT_PFP_FALLBACK
  const localPfpPath = path.join(__dirname, 'agent-pfp.jpg')
  if (fs.existsSync(localPfpPath)) {
    console.log('0/5 Syncing agent PFP to Supabase storage...')
    try {
      const fileBuffer = fs.readFileSync(localPfpPath)
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload('agent-001.jpg', fileBuffer, {
          contentType: 'image/jpeg',
          upsert: true,
        })
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl('agent-001.jpg')
        if (urlData?.publicUrl) {
          pfpUrl = urlData.publicUrl
          console.log(`   ✓ Avatar uploaded to Supabase: ${pfpUrl}`)
        }
      } else {
        console.warn(`   ⚠️ Supabase avatar upload notice: ${uploadErr.message}`)
        console.log(`   Using fallback avatar: ${pfpUrl}`)
      }
    } catch (e) {
      console.warn(`   ⚠️ Local avatar sync notice: ${e.message}`)
    }
  }

  // ── STEP 1: Check On-Chain Profile Status ──────────────────────────────────
  console.log('1/5 Checking on-chain profile status on Arc Mainnet...')
  let alreadyMinted = false
  try {
    alreadyMinted = await publicClient.readContract({
      address: PROFILE_REGISTRY_ADDRESS,
      abi: PROFILE_REGISTRY_ABI,
      functionName: 'hasProfile',
      args: [account.address],
    })
  } catch (err) {
    console.warn(`   Notice checking profile: ${err.message}`)
  }

  let txHash = null
  if (alreadyMinted) {
    console.log('   ✓ Profile already exists on-chain. Skipping mint.')
  } else {
    console.log('2/5 Minting profile on-chain (ProfileRegistry)...')
    const maxFeePerGas = await getMaxFeePerGas(publicClient)
    try {
      txHash = await walletClient.writeContract({
        address: PROFILE_REGISTRY_ADDRESS,
        abi: PROFILE_REGISTRY_ABI,
        functionName: 'mintProfile',
        args: [AGENT_NAME, AGENT_BIO, '', AGENT_X_USERNAME],
        maxFeePerGas,
      })
      console.log(`   Transaction submitted: ${txHash}`)
      console.log(`   Waiting for confirmation...`)
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      if (receipt.status === 'reverted') {
        throw new Error(`Profile minting reverted on-chain. Tx: ${txHash}`)
      }
      console.log(`   ✓ Profile minted on-chain! Tx: ${txHash}`)
    } catch (err) {
      console.error(`   ❌ Mint failed: ${err.message}`)
      throw err
    }
  }

  // ── STEP 2: Upsert Supabase Profiles Table ─────────────────────────────────
  console.log('3/5 Saving profile to Supabase profiles table...')
  const { error: profileError } = await supabase.from('profiles').upsert({
    wallet_address: wallet,
    name: AGENT_NAME,
    bio: AGENT_BIO,
    pfp_url: pfpUrl,
    x_username: AGENT_X_USERNAME,
    minted_at: new Date().toISOString(),
  }, { onConflict: 'wallet_address' })

  if (profileError) {
    console.error(`   ❌ Supabase profiles error: ${profileError.message}`)
  } else {
    console.log('   ✓ Profile saved in Supabase')
  }

  // ── STEP 3: Upsert Supabase Leaderboard Table ──────────────────────────────
  console.log('4/5 Creating leaderboard entry with is_agent = true...')
  const { error: lbError } = await supabase.from('leaderboard').upsert({
    wallet_address: wallet,
    name: AGENT_NAME,
    pfp_url: pfpUrl,
    total_calls: 0,
    wins: 0,
    losses: 0,
    win_rate: 0,
    total_volume: 0,
    total_pnl: 0,
    is_agent: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'wallet_address' })

  if (lbError) {
    console.error(`   ❌ Supabase leaderboard error: ${lbError.message}`)
  } else {
    console.log('   ✓ Leaderboard entry initialized (is_agent: true)')
  }

  // ── STEP 4: Approve USDC for Betting Pool ──────────────────────────────────
  console.log('5/5 Checking USDC allowance for BettingPool...')
  try {
    const allowance = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, BETTING_POOL_ADDRESS],
    })

    const MIN_ALLOWANCE = 100_000_000n // 100 USDC (6 decimals)
    if (allowance < MIN_ALLOWANCE) {
      console.log('   Approving unlimited USDC spend for BettingPool...')
      const maxFeePerGas = await getMaxFeePerGas(publicClient)
      const MAX_UINT256 = 2n ** 256n - 1n
      const approveHash = await walletClient.writeContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [BETTING_POOL_ADDRESS, MAX_UINT256],
        maxFeePerGas,
      })
      await publicClient.waitForTransactionReceipt({ hash: approveHash })
      console.log(`   ✓ USDC Approved! Tx: ${approveHash}`)
    } else {
      console.log('   ✓ USDC already approved.')
    }
  } catch (err) {
    console.warn(`   ⚠️ USDC allowance check notice: ${err.message}`)
  }

  // Record profile creation in wallet_transactions
  try {
    await supabase.from('wallet_transactions').insert({
      wallet_address: wallet,
      type: 'profile_creation',
      label: `Minted Profile: ${AGENT_NAME}`,
      amount: null,
      tx_hash: txHash || 'pre-existing',
      created_at: new Date().toISOString(),
    })
    console.log('   ✓ Recorded in wallet_transactions history')
  } catch {
    // Non-fatal
  }

  console.log('\n✅ Setup complete!')
  console.log(`   Agent Address: ${account.address}`)
  console.log('   Arc Agent 001 is ready for autonomous daily betting and claiming.')
}

main().catch(err => {
  console.error('\n💥 Setup failed:', err.message)
  process.exit(1)
})
