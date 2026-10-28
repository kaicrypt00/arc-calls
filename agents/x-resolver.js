// agents/x-resolver.js
// Arc Calls — X Resolver Agent
// Runs every hour via GitHub Actions (workflow: x-resolver.yml)
// Monitors X (Twitter) accounts for conditions set on predictions.
// When a condition triggers → calls lockBetting(id) on BettingPool on Arc Mainnet.
// Uses fxtwitter API (no Twitter API key required).
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

const RPC_URL = 'https://rpc.mainnet.arc.io'
const MIN_GAS_GWEI = 20n

// ─── ENVIRONMENT — all from GitHub Secrets ────────────────────────────────────
const ADMIN_KEY    = process.env.RESOLVER_ADMIN_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://zxmfdvzkmeybujoowzgh.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY
const BETTING_POOL = process.env.BETTING_POOL_ADDRESS || '0xD7b60891729bC02F8C786Dafb479CD6152f57925'

// ─── VALIDATE ENV — fail fast with clear message ──────────────────────────────
const missing = []
if (!ADMIN_KEY)    missing.push('RESOLVER_ADMIN_KEY')
if (!SUPABASE_KEY) missing.push('SUPABASE_ANON_KEY')
if (missing.length > 0) {
  console.error('❌ Missing required GitHub Secrets:', missing.join(', '))
  console.error('   Add in: GitHub repo → Settings → Secrets and variables → Actions')
  process.exit(1)
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
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const account  = privateKeyToAccount(
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

// ─── FXTWITTER HELPERS ────────────────────────────────────────────────────────
const FX_HEADERS = {
  'User-Agent': 'ArcCallsResolver/1.0',
  'Accept': 'application/json',
}

async function fetchUserProfile(handle) {
  try {
    const res = await fetch(`https://api.fxtwitter.com/${handle.replace('@', '')}`, { headers: FX_HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data?.user ?? null
  } catch (e) {
    console.warn(`  ⚠️  fetchUserProfile(@${handle}) failed: ${e.message}`)
    return null
  }
}

async function fetchTweet(handle, tweetId) {
  try {
    const res = await fetch(`https://api.fxtwitter.com/${handle.replace('@', '')}/status/${tweetId}`, { headers: FX_HEADERS })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data?.tweet ?? null
  } catch (e) {
    console.warn(`  ⚠️  fetchTweet(${handle}/${tweetId}) failed: ${e.message}`)
    return null
  }
}

// ─── RSS FEED (only reliable way to get tweet list) ───────────────────────────
function parseRssTweets(xml, handle) {
  const items = []
  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match
  while ((match = itemRegex.exec(xml)) !== null) {
    const itemXml = match[1]
    const linkMatch  = itemXml.match(/<link>(https?:\/\/[^<]+)<\/link>/)
    const pubMatch   = itemXml.match(/<pubDate>([^<]+)<\/pubDate>/)
    const titleMatch = itemXml.match(/<title><!\[CDATA\[([^\]]*)\]\]><\/title>/) ||
                       itemXml.match(/<title>([^<]*)<\/title>/)

    if (!linkMatch) continue
    const url = linkMatch[1].trim()
    const urlLower = url.toLowerCase()
    if (!urlLower.includes(`x.com/${handle.toLowerCase()}/status/`)) continue

    const statusMatch = url.match(/\/status\/(\d+)/)
    if (!statusMatch) continue

    const id        = statusMatch[1]
    const pubDate   = pubMatch ? pubMatch[1].trim() : null
    const timestamp = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0
    const title     = titleMatch ? titleMatch[1].trim() : ''

    items.push({ id, url, title, pubDate, timestamp })
  }
  return items
}

async function fetchTweetsViaRss(handle) {
  try {
    const res = await fetch(`https://fxtwitter.com/${handle.replace('@', '')}/feed.xml`, {
      headers: { 'User-Agent': 'ArcCallsResolver/1.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const xml    = await res.text()
    const tweets = parseRssTweets(xml, handle.replace('@', ''))
    tweets.sort((a, b) => b.timestamp - a.timestamp)
    return tweets
  } catch (e) {
    console.warn(`  ⚠️  fetchTweetsViaRss(@${handle}) failed: ${e.message}`)
    return []
  }
}

// ─── CONDITION CHECKERS ───────────────────────────────────────────────────────
async function checkCondition(prediction, monitor) {
  const {
    condition_type,
    handle,
    threshold,
    tweet_id,
    last_tweet_id,
    last_pfp_url,
    last_verified,
    activation_timestamp,
  } = monitor

  // ── GROUP A: Account-level conditions ──────────────────────────────────────
  if (['follower_count', 'tweet_count', 'pfp_change', 'verification_change'].includes(condition_type)) {
    const user = await fetchUserProfile(handle)
    if (!user) return { error: `fxtwitter returned null profile for @${handle}` }

    if (condition_type === 'follower_count') {
      const current = user.followers ?? 0
      return {
        triggered: current >= parseInt(threshold),
        currentValue: `${current.toLocaleString()} followers`,
        rawData: { followers: current },
        updatedMonitor: monitor,
      }
    }

    if (condition_type === 'tweet_count') {
      const current = user.tweets ?? 0
      return {
        triggered: current >= parseInt(threshold),
        currentValue: `${current.toLocaleString()} tweets`,
        rawData: { tweets: current },
        updatedMonitor: monitor,
      }
    }

    if (condition_type === 'pfp_change') {
      const currentPfp = user.avatar_url ?? user.avatar ?? ''
      if (!last_pfp_url) {
        return {
          triggered: false,
          currentValue: 'Baseline PFP recorded',
          rawData: { pfp: currentPfp },
          updatedMonitor: { ...monitor, last_pfp_url: currentPfp },
        }
      }
      const changed = currentPfp !== last_pfp_url && currentPfp !== ''
      return {
        triggered: changed,
        currentValue: changed ? 'PFP changed' : 'No PFP change',
        rawData: { previous_pfp: last_pfp_url, current_pfp: currentPfp },
        updatedMonitor: changed ? { ...monitor, last_pfp_url: currentPfp } : monitor,
      }
    }

    if (condition_type === 'verification_change') {
      const currentVerified = user.verification?.verified ?? user.verified ?? false
      if (last_verified === null || last_verified === undefined) {
        return {
          triggered: false,
          currentValue: `Verified: ${currentVerified} (baseline recorded)`,
          rawData: { verified: currentVerified },
          updatedMonitor: { ...monitor, last_verified: currentVerified },
        }
      }
      const changed = currentVerified !== last_verified
      return {
        triggered: changed,
        currentValue: changed ? `Verification changed to ${currentVerified}` : `Verified: ${currentVerified} (no change)`,
        rawData: { previous: last_verified, current: currentVerified },
        updatedMonitor: changed ? { ...monitor, last_verified: currentVerified } : monitor,
      }
    }
  }

  // ── new_post: triggers when @handle posts any tweet after activation ────────
  if (condition_type === 'new_post') {
    const activationTs = activation_timestamp ?? 0
    const tweets = await fetchTweetsViaRss(handle)

    if (tweets.length === 0) {
      return { error: `No tweets found via RSS for @${handle}` }
    }

    const latestTweet = tweets[0]
    const latestId    = latestTweet.id

    if (!last_tweet_id) {
      console.log(`    📝 Baseline recorded: latest tweet ID = ${latestId} (${latestTweet.pubDate})`)
      return {
        triggered: false,
        currentValue: `Baseline recorded: ${latestId}`,
        rawData: { tweet_id: latestId, timestamp: latestTweet.timestamp },
        updatedMonitor: { ...monitor, last_tweet_id: latestId },
      }
    }

    const isNew = latestId !== last_tweet_id && latestTweet.timestamp >= activationTs
    console.log(`    📊 new_post: latest=${latestId} | baseline=${last_tweet_id} | activationTs=${activationTs} | tweetTs=${latestTweet.timestamp} | isNew=${isNew}`)

    return {
      triggered: isNew,
      currentValue: isNew ? `New tweet: ${latestId} (${latestTweet.pubDate})` : `No new post (latest: ${latestId})`,
      rawData: {
        latest_tweet_id: latestId,
        last_tweet_id,
        timestamp: latestTweet.timestamp,
        activation_timestamp: activationTs,
        title: latestTweet.title?.slice(0, 100),
      },
      updatedMonitor: isNew ? { ...monitor, last_tweet_id: latestId } : monitor,
    }
  }

  // ── GROUP B: Next tweet after activation ────────────────────────────────────
  if (['next_tweet_views', 'next_tweet_likes', 'next_tweet_reposts', 'next_tweet_replies'].includes(condition_type)) {
    const activationTs = activation_timestamp ?? 0
    let trackingId = monitor.tracking_tweet_id ?? null

    if (!trackingId) {
      const tweets = await fetchTweetsViaRss(handle)
      const afterActivation = tweets.filter(t => t.timestamp >= activationTs)
      if (afterActivation.length === 0) {
        return {
          triggered: false,
          currentValue: 'Waiting for new tweet after activation',
          rawData: { latest_tweet_id: tweets[0]?.id },
          updatedMonitor: monitor,
        }
      }
      const target = afterActivation[afterActivation.length - 1]
      trackingId = target.id
      console.log(`  Found target tweet for @${handle}: ${trackingId} (${target.pubDate})`)
    }

    const tweet = await fetchTweet(handle, trackingId)
    if (!tweet) return { error: `Could not fetch tweet ${trackingId}` }

    const metricMap = {
      next_tweet_views:   { key: 'views',    label: 'views'   },
      next_tweet_likes:   { key: 'likes',    label: 'likes'   },
      next_tweet_reposts: { key: 'retweets', label: 'reposts' },
      next_tweet_replies: { key: 'replies',  label: 'replies' },
    }
    const { key, label } = metricMap[condition_type]
    const current = tweet[key] ?? 0

    return {
      triggered: current >= parseInt(threshold),
      currentValue: `${current.toLocaleString()} ${label}`,
      rawData: { tweet_id: trackingId, [key]: current },
      updatedMonitor: { ...monitor, tracking_tweet_id: trackingId },
    }
  }

  // ── GROUP C: Specific tweet by URL ─────────────────────────────────────────
  if (['post_views', 'post_likes', 'post_reposts', 'post_replies'].includes(condition_type)) {
    if (!tweet_id) return { error: 'tweet_id missing for specific tweet condition' }

    const tweet = await fetchTweet(handle, tweet_id)
    if (!tweet) return { error: `Could not fetch tweet ${tweet_id} from @${handle}` }

    const metricMap = {
      post_views:   { key: 'views',    label: 'views'   },
      post_likes:   { key: 'likes',    label: 'likes'   },
      post_reposts: { key: 'retweets', label: 'reposts' },
      post_replies: { key: 'replies',  label: 'replies' },
    }
    const { key, label } = metricMap[condition_type]
    const current = tweet[key] ?? 0

    return {
      triggered: current >= parseInt(threshold),
      currentValue: `${current.toLocaleString()} ${label}`,
      rawData: { tweet_id, [key]: current },
      updatedMonitor: monitor,
    }
  }

  return { error: `Unknown condition_type: ${condition_type}` }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function run() {
  console.log('════════════════════════════════════════')
  console.log(' X RESOLVER — Arc Calls')
  console.log(` Started: ${new Date().toISOString()}`)
  console.log(`   Admin: ${account.address}`)
  console.log(`   Chain: Arc Mainnet (5042)`)
  console.log('════════════════════════════════════════\n')

  const { data: predictions, error: fetchError } = await supabase
    .from('predictions_display')
    .select('id, title, status, deadline, x_monitor')
    .eq('status', 'open')
    .not('x_monitor', 'is', null)

  if (fetchError) {
    console.error('Failed to fetch predictions:', fetchError.message)
    process.exit(1)
  }

  if (!predictions || predictions.length === 0) {
    console.log('No predictions with X monitoring active. Nothing to do.')
    return
  }

  console.log(`Found ${predictions.length} prediction(s) to monitor:\n`)

  for (const pred of predictions) {
    const monitor   = pred.x_monitor
    const handle    = monitor.handle    ?? 'unknown'
    const condition = monitor.condition_type ?? 'unknown'

    console.log(`─── Prediction #${pred.id}: ${pred.title.slice(0, 60)}`)
    console.log(`    @${handle} · ${condition}`)

    // Deadline check — skip predictions whose deadline has already passed
    if (pred.deadline) {
      const deadlineTs = new Date(pred.deadline).getTime()
      if (!isNaN(deadlineTs) && Date.now() > deadlineTs) {
        console.log('    ⏰ Deadline passed — bet is auto-locked, skipping resolver check')
        await supabase.from('x_monitor_logs').insert({
          prediction_id: pred.id,
          handle,
          condition_type: condition,
          current_value: 'Deadline passed — bet auto-locked',
          threshold: String(monitor.threshold ?? ''),
          triggered: true,
          action_taken: 'Deadline passed — bet auto-locked by contract',
          checked_at: new Date().toISOString(),
        })
        continue
      }
    }

    // Rate-limit: 1.5s between API calls to avoid fxtwitter blocks
    await new Promise(r => setTimeout(r, 1500))

    const result = await checkCondition(pred, monitor)

    if (result.error) {
      console.log(`    ⚠️  Error: ${result.error}`)
      await supabase.from('x_monitor_logs').insert({
        prediction_id: pred.id,
        handle,
        condition_type: condition,
        current_value: 'Error',
        threshold: String(monitor.threshold ?? ''),
        triggered: false,
        action_taken: null,
        error: result.error,
        checked_at: new Date().toISOString(),
      })
      continue
    }

    const thresholdDisplay = (monitor.threshold !== undefined && monitor.threshold !== null && monitor.threshold !== '')
      ? monitor.threshold
      : 'change detected'

    console.log(`    Current: ${result.currentValue}`)
    console.log(`    Target:  ${thresholdDisplay}`)
    console.log(`    Status:  ${result.triggered ? '🔒 TRIGGERED' : '👀 monitoring'}`)

    // Persist updated monitor state (last_tweet_id, tracking_tweet_id, last_pfp_url, etc.)
    if (result.updatedMonitor && JSON.stringify(result.updatedMonitor) !== JSON.stringify(monitor)) {
      const { error: updateErr } = await supabase
        .from('predictions_display')
        .update({ x_monitor: result.updatedMonitor })
        .eq('id', pred.id)
      if (updateErr) console.warn(`    ⚠️  Failed to update x_monitor state: ${updateErr.message}`)
    }

    // Always log the check result
    await supabase.from('x_monitor_logs').insert({
      prediction_id: pred.id,
      handle,
      condition_type: condition,
      current_value: result.currentValue,
      threshold: String(monitor.threshold ?? ''),
      triggered: result.triggered,
      action_taken: result.triggered ? 'Locked prediction on-chain' : null,
      raw_data: result.rawData ?? null,
      checked_at: new Date().toISOString(),
    })

    if (result.triggered) {
      try {
        console.log(`    🔒 Locking prediction #${pred.id} on Arc Mainnet...`)
        const maxFeePerGas = await getMaxFeePerGas()
        const txHash = await walletClient.writeContract({
          address: BETTING_POOL,
          abi: LOCK_ABI,
          functionName: 'lockBetting',
          args: [BigInt(pred.id)],
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
            prediction_id: pred.id,
            handle,
            condition_type: condition,
            current_value: result.currentValue,
            threshold: String(monitor.threshold ?? ''),
            triggered: true,
            action_taken: `Locked on-chain — tx: ${txHash}`,
            checked_at: new Date().toISOString(),
          })
        } else {
          console.error(`    ❌ Lock tx reverted: ${txHash}`)
          await supabase.from('x_monitor_logs').insert({
            prediction_id: pred.id,
            handle,
            condition_type: condition,
            current_value: result.currentValue,
            triggered: true,
            action_taken: null,
            error: `Lock tx reverted: ${txHash}`,
            checked_at: new Date().toISOString(),
          })
        }
      } catch (e) {
        const errMsg = e?.shortMessage ?? e?.message ?? 'Unknown error'
        console.error(`    ❌ Lock failed: ${errMsg}`)
        await supabase.from('x_monitor_logs').insert({
          prediction_id: pred.id,
          handle,
          condition_type: condition,
          current_value: result.currentValue,
          triggered: true,
          action_taken: null,
          error: `Lock tx failed: ${errMsg}`,
          checked_at: new Date().toISOString(),
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
