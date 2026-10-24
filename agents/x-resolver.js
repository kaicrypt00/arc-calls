/**
 * Arc Calls — X Resolver Agent
 * Runs every hour via GitHub Actions.
 * Monitors X (Twitter) accounts for conditions set on predictions.
 * When a condition triggers, calls lockBetting(id) on BettingPool.
 * Uses fxtwitter API — no Twitter API key required.
 */

import { createWalletClient, createPublicClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { defineChain } from 'viem'
import { createClient } from '@supabase/supabase-js'

const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: { default: { http: ['https://rpc.mainnet.arc.io'] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' } },
})

const RPC_URL      = 'https://rpc.mainnet.arc.io'
const BETTING_POOL = process.env.BETTING_POOL_ADDRESS ?? ''
const MIN_GAS_GWEI = 20n
const DELAY_MS     = 1500

const BETTING_POOL_ABI = [
  { name: 'lockBetting', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }], outputs: [] },
]

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

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

// Fetch user data via fxtwitter (no API key required)
async function fetchUserData(handle) {
  await delay(DELAY_MS)
  const res = await fetch(`https://api.fxtwitter.com/user/${handle.replace('@', '')}`)
  if (!res.ok) throw new Error(`fxtwitter user error: ${res.status}`)
  return res.json()
}

async function fetchTweetData(tweetId) {
  await delay(DELAY_MS)
  const res = await fetch(`https://api.fxtwitter.com/status/${tweetId}`)
  if (!res.ok) throw new Error(`fxtwitter tweet error: ${res.status}`)
  return res.json()
}

async function checkCondition(prediction, config, supabase) {
  const { handle, condition_type, threshold, tweet_id, last_tweet_id, last_pfp_url, last_verified, activation_timestamp, tracking_tweet_id } = config

  let triggered = false
  let currentValue = ''
  let actionTaken = 'none'

  try {
    if (condition_type === 'follower_count') {
      const data = await fetchUserData(handle)
      currentValue = String(data.user?.followers_count ?? 0)
      triggered = parseInt(currentValue) >= parseInt(threshold)

    } else if (condition_type === 'tweet_count') {
      const data = await fetchUserData(handle)
      currentValue = String(data.user?.tweets_count ?? 0)
      triggered = parseInt(currentValue) >= parseInt(threshold)

    } else if (condition_type === 'new_post') {
      const data = await fetchUserData(handle)
      const latestId = data.user?.pinned_tweet_id ?? ''
      currentValue = latestId
      triggered = !!latestId && latestId !== last_tweet_id && new Date(data.user?.created_at ?? 0).getTime() > activation_timestamp * 1000
      if (triggered) {
        await supabase.from('predictions_display').update({ x_monitor: { ...config, last_tweet_id: latestId } }).eq('id', prediction.id)
      }

    } else if (condition_type === 'pfp_change') {
      const data = await fetchUserData(handle)
      currentValue = data.user?.avatar_url ?? ''
      triggered = !!last_pfp_url && currentValue !== last_pfp_url

    } else if (condition_type === 'verification_change') {
      const data = await fetchUserData(handle)
      currentValue = String(data.user?.is_verified ?? false)
      triggered = last_verified !== null && currentValue !== String(last_verified)

    } else if (condition_type.startsWith('next_tweet_')) {
      const metric = condition_type.replace('next_tweet_', '')
      if (!tracking_tweet_id) {
        // Find next tweet after activation
        const data = await fetchUserData(handle)
        const latestId = data.user?.pinned_tweet_id
        if (latestId) {
          await supabase.from('predictions_display').update({ x_monitor: { ...config, tracking_tweet_id: latestId } }).eq('id', prediction.id)
        }
        currentValue = 'tracking_started'
      } else {
        const data = await fetchTweetData(tracking_tweet_id)
        const tweet = data.tweet
        const metricMap = { views: tweet?.views, likes: tweet?.likes, reposts: tweet?.retweets, replies: tweet?.replies }
        currentValue = String(metricMap[metric] ?? 0)
        triggered = parseInt(currentValue) >= parseInt(threshold)
      }

    } else if (condition_type.startsWith('post_')) {
      const metric = condition_type.replace('post_', '')
      if (!tweet_id) { currentValue = 'no_tweet_id'; }
      else {
        const data = await fetchTweetData(tweet_id)
        const tweet = data.tweet
        const metricMap = { views: tweet?.views, likes: tweet?.likes, reposts: tweet?.retweets, replies: tweet?.replies }
        currentValue = String(metricMap[metric] ?? 0)
        triggered = parseInt(currentValue) >= parseInt(threshold)
      }
    }
  } catch (e) {
    return { triggered: false, currentValue: 'error', actionTaken: 'error', error: e.message }
  }

  return { triggered, currentValue, actionTaken, error: null }
}

async function main() {
  console.log('[X Resolver] Starting run...')

  const privateKey = process.env.RESOLVER_ADMIN_KEY
  if (!privateKey) { console.error('RESOLVER_ADMIN_KEY not set'); process.exit(1) }
  if (!BETTING_POOL) { console.error('BETTING_POOL_ADDRESS not set'); process.exit(1) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
  const account = privateKeyToAccount(privateKey)
  const publicClient = createPublicClient({ chain: arc, transport: http(RPC_URL) })
  const walletClient = createWalletClient({ account, chain: arc, transport: http(RPC_URL) })

  // Fetch predictions with x_monitor configured
  const { data: predictions } = await supabase
    .from('predictions_display')
    .select('*')
    .in('status', ['open', 'locked'])
    .not('x_monitor', 'is', null)

  if (!predictions || predictions.length === 0) {
    console.log('[X Resolver] No monitored predictions. Exiting.')
    process.exit(0)
  }

  console.log(`[X Resolver] Checking ${predictions.length} monitored predictions...`)

  for (const prediction of predictions) {
    const config = prediction.x_monitor
    if (!config?.handle || !config?.condition_type) continue

    console.log(`[X Resolver] Checking #${prediction.id}: ${config.condition_type} for @${config.handle}`)

    const { triggered, currentValue, error } = await checkCondition(prediction, config, supabase)

    let actionTaken = 'none'
    if (triggered && prediction.status === 'open') {
      try {
        const maxFeePerGas = await getMaxFeePerGas(publicClient)
        const hash = await walletClient.writeContract({
          address: BETTING_POOL, abi: BETTING_POOL_ABI, functionName: 'lockBetting',
          args: [BigInt(prediction.id)],
          maxFeePerGas,
        })
        await publicClient.waitForTransactionReceipt({ hash })
        console.log(`[X Resolver] Locked #${prediction.id}: ${hash}`)
        await supabase.from('predictions_display').update({ status: 'locked' }).eq('id', prediction.id)
        actionTaken = `locked:${hash}`
      } catch (e) {
        console.error(`[X Resolver] Lock failed #${prediction.id}:`, e.message)
        actionTaken = `lock_failed:${e.message}`
      }
    }

    // Log to x_monitor_logs
    await supabase.from('x_monitor_logs').insert({
      prediction_id: prediction.id,
      handle: config.handle,
      condition_type: config.condition_type,
      current_value: currentValue,
      threshold: config.threshold ?? '',
      triggered,
      action_taken: actionTaken,
      error: error ?? null,
      raw_data: null,
      checked_at: new Date().toISOString(),
    })

    await delay(DELAY_MS)
  }

  console.log('[X Resolver] Run complete.')
}

main().catch(e => { console.error('[X Resolver] Fatal:', e); process.exit(1) })
