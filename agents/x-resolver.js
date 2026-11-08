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
    // Also grab description — fxtwitter puts the FULL tweet text here (title may be truncated)
    const descMatch  = itemXml.match(/<description><!\[CDATA\[([^\]]*)\]\]><\/description>/) ||
                       itemXml.match(/<description>([^<]*)<\/description>/)

    if (!linkMatch) continue
    const url = linkMatch[1].trim()
    const urlLower = url.toLowerCase()
    // Keep all posts in the feed — including reposts from other accounts (@arc reposts show
    // the ORIGINAL author's URL, e.g. x.com/SomeProject/status/..., not x.com/arc/status/...)
    if (!urlLower.includes('x.com/') || !urlLower.includes('/status/')) continue

    const statusMatch = url.match(/\/status\/(\d+)/)
    if (!statusMatch) continue

    // Extract the original author handle from the URL (needed for fxtwitter API fetch)
    const authorMatch = url.match(/x\.com\/([^/]+)\/status\//)
    const tweetAuthor = authorMatch ? authorMatch[1] : handle.replace('@', '')

    const id          = statusMatch[1]
    const pubDate     = pubMatch ? pubMatch[1].trim() : null
    const timestamp   = pubDate ? Math.floor(new Date(pubDate).getTime() / 1000) : 0
    const title       = titleMatch ? titleMatch[1].trim() : ''
    // Use description (full body) when available — richer than title, includes full repost text
    const description = descMatch  ? descMatch[1].trim()  : ''
    // Combined full text — description tends to have more content on reposts
    const fullText    = description.length > title.length ? description : title

    items.push({ id, url, title, fullText, pubDate, timestamp, tweetAuthor })
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

// ─── PRE-FILTERS ──────────────────────────────────────────────────────────────
// These are QUICK CHECKS only — they decide whether to even attempt full analysis.
// They do NOT make the final live/not-live decision; that happens per-entity below.
// Pre-filter only checks: "does this post mention Arc + any live signal at all?"
// Contradiction words in other parts of the same post are handled per-entity.

function isLiveIntegration(text) {
  if (!text) return false
  const t = text.toLowerCase()
  if (!t.includes('arc')) return false
  return (
    /(?:is|are)\s+(?:now\s+)?live\s+on\s+arc/.test(t) ||
    /live\s+on\s+arc/.test(t)                          ||
    /now\s+live/.test(t)                               ||
    /fully\s+migrated.{0,40}arc/.test(t)               ||
    /now\s+supports.{0,60}arc/.test(t)                 ||
    /officially\s+live.{0,30}arc/.test(t)
  )
}

function isNewArcTopic(text) {
  if (!text) return false
  const t = text.toLowerCase()
  if (!t.includes('community.arc.io') && !t.includes('arc house')) return false
  return (
    /(?:is|are)\s+(?:now\s+)?live/i.test(t)        ||
    /live\s+on\s+arc|live!/i.test(t)               ||
    /new.*(?:group|community|club|topic)/i.test(t) ||
    /launched|announcing/i.test(t)
  )
}

// ─── PER-ENTITY CONTEXT HELPERS ───────────────────────────────────────────────
// After extracting entity names, we check the ~100 chars AROUND each entity
// in the full post to decide if THAT specific entity is live or coming-soon.
// This handles mixed posts like:
//   "X is live on Arc! And Y will be live soon." → X counts, Y does not.
//   "X is live on Arc and in between Y is live too" → both count.

// Get the surrounding text window (~100 chars) around where entityName appears
function getEntityContext(text, entityName) {
  if (entityName.startsWith('_')) return text // generic marker — use whole text
  const idx = text.toLowerCase().indexOf(entityName.toLowerCase())
  if (idx === -1) return text // fallback: use whole text
  const start = Math.max(0, idx - 100)
  const end   = Math.min(text.length, idx + entityName.length + 100)
  return text.slice(start, end)
}

// Check if a local context window contains contradiction words
// (entity is NOT live yet — it's coming soon or planned)
function hasContradiction(contextText) {
  const t = contextText.toLowerCase()
  return /coming soon|will be live|coming to arc|arc studio|soon on arc|launching soon|planned for|will launch|not yet live|expected to|upcoming|in the future|next week|next month/.test(t)
}

// ─── ENTITY EXTRACTORS ────────────────────────────────────────────────────────
// Extract ALL entity names that appear near a "live" signal in the post.
// Contradictions are NOT checked here — they are checked per-entity in the caller.

function extractIntegrationEntities(text) {
  const found = new Set()
  const t = text.replace(/https?:\/\/\S+/gi, ' ') // strip URLs first

  // Pattern: "@Handle is [now] live on Arc"
  for (const m of t.matchAll(/([@\w][\w.\-]{1,30})\s+is\s+(?:now\s+)?live\s+on\s+arc/gi)) {
    const name = m[1].replace(/^@/, '').trim().toLowerCase()
    if (name && !/^(it|this|that|the|officially|just)$/.test(name)) found.add(name)
  }
  // Pattern: "[Now] live on Arc [mainnet]: ProjectName" or "Live on Arc — ProjectName"
  for (const m of t.matchAll(/(?:now\s+)?live\s+on\s+arc[\w\s,-]{0,15}[:\-–—]\s*([\w@][\w.\-\s]{1,30})/gi)) {
    const name = m[1].replace(/@/g, '').trim().toLowerCase().split(/\s+and\s+|\s*[,&]\s*/)[0]
    if (name && name.length > 1) found.add(name)
  }
  // Pattern: "@A and @B are [both] [now] live on Arc" — multi-entity in one tweet
  for (const m of t.matchAll(/([@\w][\w.\-]{1,20})\s+and\s+([@\w][\w.\-]{1,20})\s+are\s+(?:both\s+)?(?:now\s+)?live\s+on\s+arc/gi)) {
    found.add(m[1].replace(/^@/, '').toLowerCase())
    found.add(m[2].replace(/^@/, '').toLowerCase())
  }
  // Pattern: "X, Y and Z are live on Arc" (3+ entities comma-separated)
  const multiMatch = t.match(/((?:[@\w][\w.\-]{1,20}(?:\s*[,&]\s*|\s+and\s+)){2,})are\s+(?:both\s+)?(?:now\s+)?live\s+on\s+arc/i)
  if (multiMatch) {
    for (const name of multiMatch[1].split(/\s*[,&]\s*|\s+and\s+/).map(n => n.replace(/@/g,'').trim().toLowerCase()).filter(n => n.length > 1)) {
      found.add(name)
    }
  }
  // Generic fallback if live pattern matched but no specific name extracted
  if (found.size === 0 && isLiveIntegration(text)) found.add('_arc_integration_')
  return [...found]
}

function extractTopicEntities(text) {
  const found = new Set()
  const t = text.replace(/https?:\/\/\S+/gi, ' ')

  // "New Arc House group: GroupName [is/are live]" / "Arc House topic: GroupName"
  for (const m of t.matchAll(/(?:new\s+)?arc\s+house\s+(?:group|topic|community|club|space)[:\-–—\s]+([^\n!.,?@]{2,40}?)(?:\s+(?:is|are)\s+(?:now\s+)?live|$)/gi)) {
    const name = m[1].trim().toLowerCase()
    if (name && name.length > 1) found.add(name)
  }
  // "GroupName is/are [now] live on Arc House" — split "and" into two entities
  for (const m of t.matchAll(/([^\n]{2,40}?)\s+(?:is|are)\s+(?:now\s+)?live\s+on\s+arc\s+house/gi)) {
    const raw = m[1].trim().toLowerCase()
    if (/\s+and\s+/.test(raw)) {
      for (const part of raw.split(/\s+and\s+/).map(s => s.trim()).filter(s => s.length > 1)) {
        if (!/^(it|this|that|the|a|an)$/.test(part)) found.add(part)
      }
    } else {
      if (raw.length > 1 && !/^(it|this|that|the|a|an)$/.test(raw)) found.add(raw)
    }
  }
  // "community.arc.io/groups/name" slug — most reliable signal if present
  for (const m of t.matchAll(/community\.arc\.io\/(?:groups?|topics?|clubs?)\/([^\s/?#"']+)/gi)) {
    found.add(m[1].toLowerCase())
  }
  // Generic fallback
  if (found.size === 0 && isNewArcTopic(text)) found.add('_arc_house_topic_')
  return [...found]
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

  // ── new_integration: counts @arc posts announcing live-on-mainnet launches ──
  if (condition_type === 'new_integration') {
    const target     = parseInt(threshold ?? '1', 10)
    const foundIds   = Array.isArray(monitor.found_integration_tweet_ids) ? monitor.found_integration_tweet_ids : []
    // Entity-level dedup: track which specific integrations we already counted (by name)
    const foundNames = new Set(Array.isArray(monitor.found_integration_names) ? monitor.found_integration_names : [])
    let   foundCount = typeof monitor.found_integration_count === 'number' ? monitor.found_integration_count : 0
    let   lastMatch  = monitor.last_integration_tweet ?? null

    const tweets = await fetchTweetsViaRss(handle)
    const activationTs = activation_timestamp ?? 0
    const candidateTweets = tweets.filter(t => t.timestamp >= activationTs && !foundIds.includes(t.id))
    const lastScanned = tweets[0] ? { id: tweets[0].id, text: (tweets[0].fullText ?? tweets[0].title ?? '').slice(0, 100), date: tweets[0].pubDate } : null

    const newlyFoundIds = []
    for (const tweet of candidateTweets) {
      // Use fullText (RSS description) as full post body — richer than title alone
      const postText = tweet.fullText ?? tweet.title ?? ''
      const isRepost = tweet.tweetAuthor && tweet.tweetAuthor.toLowerCase() !== handle.replace('@', '').toLowerCase()
      console.log(`    📄 Checking ${isRepost ? `repost from @${tweet.tweetAuthor}` : 'own tweet'} [${tweet.id}]: "${postText.slice(0, 60)}"`)

      // Step 1: Quick pre-filter — if full RSS text shows no live signal, skip fast
      if (!isLiveIntegration(postText)) {
        newlyFoundIds.push(tweet.id)
        continue
      }

      // Step 2: Fetch complete tweet body via fxtwitter API for deepest verification
      // Use tweetAuthor from URL — for reposts this is the ORIGINAL author, not @arc
      let verifiedText = postText
      try {
        await new Promise(r => setTimeout(r, 1500)) // rate limit
        const tweetHandle = tweet.tweetAuthor ?? handle.replace('@', '')
        const fullTweet = await fetchTweet(tweetHandle, tweet.id)
        if (fullTweet?.text) verifiedText = fullTweet.text
      } catch (_) { /* fall back to RSS text */ }

      // Step 3: Re-validate on 100% of the text — catches contradictions in later sentences
      if (!isLiveIntegration(verifiedText)) {
        console.log(`    ⚠️  Skipping — full post contradicts live claim: "${verifiedText.slice(0, 80)}"`)
        newlyFoundIds.push(tweet.id)
        continue
      }

      // Step 4: Extract specific integration names announced live in this post
      const entities = extractIntegrationEntities(verifiedText)
      console.log(`    🔍 Integration candidate entities: [${entities.join(', ')}] in: "${verifiedText.slice(0, 80)}"`)

      // Step 5: Per-entity dedup + local contradiction check
      // For each found entity, we look at the ~100 chars AROUND it in the full post.
      // This handles: "X is live on Arc! Y will be live soon." → X counts, Y does NOT.
      // If a repost or new tweet mentions the same entity again → skipped by foundNames dedup.
      for (const entity of entities) {
        if (foundNames.has(entity)) {
          console.log(`    ⏭️  Already counted integration "${entity}", skipping`)
          continue
        }
        // Check the LOCAL context of this specific entity — not the whole post
        const ctx = getEntityContext(verifiedText, entity)
        if (hasContradiction(ctx)) {
          console.log(`    ⚠️  "${entity}" context says coming-soon/not-live yet, skipping: "${ctx.slice(0, 80)}"`)
          continue
        }
        foundNames.add(entity)
        foundCount++
        if (!lastMatch) lastMatch = { id: tweet.id, text: verifiedText.slice(0, 100), date: tweet.pubDate, entity }
        console.log(`    🤝 New integration confirmed: "${entity}" · ${verifiedText.slice(0, 60)}`)
        if (foundCount >= target) break
      }

      newlyFoundIds.push(tweet.id)
      if (foundCount >= target) break
      if (candidateTweets.indexOf(tweet) < candidateTweets.length - 1) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    const allFoundIds = [...foundIds, ...newlyFoundIds]
    const triggered   = foundCount >= target
    const statusLine  = lastMatch
      ? `Found ${foundCount} of ${target} · Last: ${(lastMatch.text ?? '').slice(0, 60)}`
      : `Found ${foundCount} of ${target} · No integrations yet`

    return {
      triggered,
      currentValue: statusLine,
      rawData: { found_count: foundCount, target, last_match: lastMatch, last_scanned: lastScanned, found_names: [...foundNames] },
      updatedMonitor: {
        ...monitor,
        found_integration_count:     foundCount,
        found_integration_tweet_ids: allFoundIds,
        found_integration_names:     [...foundNames],
        last_integration_tweet:      lastMatch,
      },
    }
  }

  // ── new_topic: counts @arc posts (originals + reposts) announcing new Arc   ──
  // ── House community topics/groups that are LIVE right now                   ──
  if (condition_type === 'new_topic') {
    const target     = parseInt(threshold ?? '1', 10)
    const foundIds   = Array.isArray(monitor.found_topic_tweet_ids) ? monitor.found_topic_tweet_ids : []
    // Entity-level dedup: track which specific topic groups we already counted
    const foundNames = new Set(Array.isArray(monitor.found_topic_names) ? monitor.found_topic_names : [])
    let   foundCount = typeof monitor.found_topic_count === 'number' ? monitor.found_topic_count : 0
    let   lastMatch  = monitor.last_topic_tweet ?? null

    const tweets = await fetchTweetsViaRss(handle)
    const activationTs = activation_timestamp ?? 0
    const candidateTweets = tweets.filter(t => t.timestamp >= activationTs && !foundIds.includes(t.id))
    const lastScanned = tweets[0] ? { id: tweets[0].id, text: (tweets[0].fullText ?? tweets[0].title ?? '').slice(0, 100), date: tweets[0].pubDate } : null

    const newlyFoundIds = []
    for (const tweet of candidateTweets) {
      const postText = tweet.fullText ?? tweet.title ?? ''
      const isRepost = tweet.tweetAuthor && tweet.tweetAuthor.toLowerCase() !== handle.replace('@', '').toLowerCase()
      console.log(`    📄 Checking ${isRepost ? `repost from @${tweet.tweetAuthor}` : 'own tweet'} [${tweet.id}]: "${postText.slice(0, 60)}"`)

      // Step 1: Quick pre-filter on full RSS text
      if (!isNewArcTopic(postText)) {
        newlyFoundIds.push(tweet.id)
        continue
      }

      // Step 2: Fetch complete tweet body via API
      // Use tweetAuthor from URL — for reposts this is the ORIGINAL author, not @arc
      let verifiedText = postText
      try {
        await new Promise(r => setTimeout(r, 1500))
        const tweetHandle = tweet.tweetAuthor ?? handle.replace('@', '')
        const fullTweet = await fetchTweet(tweetHandle, tweet.id)
        if (fullTweet?.text) verifiedText = fullTweet.text
      } catch (_) { /* fall back to RSS text */ }

      // Step 3: Re-validate on complete text — full contradiction check
      if (!isNewArcTopic(verifiedText)) {
        console.log(`    ⚠️  Skipping — full post contradicts live topic claim: "${verifiedText.slice(0, 80)}"`)
        newlyFoundIds.push(tweet.id)
        continue
      }

      // Step 4: Extract specific group/topic names from full text
      const entities = extractTopicEntities(verifiedText)
      console.log(`    🔍 Topic candidate entities: [${entities.join(', ')}] in: "${verifiedText.slice(0, 80)}"`)

      // Step 5: Per-entity dedup + local contradiction check
      // For each found entity, we look at the ~100 chars AROUND it in the full post.
      // This handles: "X is live on Arc House! Y will be live soon." → X counts, Y does NOT.
      // If a repost or new tweet mentions the same group again → skipped by foundNames dedup.
      for (const entity of entities) {
        if (foundNames.has(entity)) {
          console.log(`    ⏭️  Already counted topic "${entity}", skipping`)
          continue
        }
        // Check the LOCAL context of this specific entity — not the whole post
        const ctx = getEntityContext(verifiedText, entity)
        if (hasContradiction(ctx)) {
          console.log(`    ⚠️  "${entity}" context says coming-soon/not-live yet, skipping: "${ctx.slice(0, 80)}"`)
          continue
        }
        foundNames.add(entity)
        foundCount++
        if (!lastMatch) lastMatch = { id: tweet.id, text: verifiedText.slice(0, 100), date: tweet.pubDate, entity }
        console.log(`    🏠 New Arc House topic confirmed: "${entity}" · ${verifiedText.slice(0, 60)}`)
        if (foundCount >= target) break
      }

      newlyFoundIds.push(tweet.id)
      if (foundCount >= target) break
      if (candidateTweets.indexOf(tweet) < candidateTweets.length - 1) {
        await new Promise(r => setTimeout(r, 1000))
      }
    }

    const allFoundIds = [...foundIds, ...newlyFoundIds]
    const triggered   = foundCount >= target
    const statusLine  = lastMatch
      ? `Found ${foundCount} of ${target} · Last: ${(lastMatch.text ?? '').slice(0, 60)}`
      : `Found ${foundCount} of ${target} · No topics yet`

    return {
      triggered,
      currentValue: statusLine,
      rawData: { found_count: foundCount, target, last_match: lastMatch, last_scanned: lastScanned, found_names: [...foundNames] },
      updatedMonitor: {
        ...monitor,
        found_topic_count:     foundCount,
        found_topic_tweet_ids: allFoundIds,
        found_topic_names:     [...foundNames],
        last_topic_tweet:      lastMatch,
      },
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

    // ── Professional status display per condition type ──────────────────────
    if (condition === 'follower_count' || condition === 'tweet_count') {
      const tgt    = monitor.threshold ? parseInt(monitor.threshold).toLocaleString() : '—'
      const curNum = parseInt((result.currentValue || '0').replace(/[^0-9]/g, ''))
      const pct    = monitor.threshold ? Math.round((curNum / parseInt(monitor.threshold)) * 100) : null
      console.log(`    Current:  ${result.currentValue}`)
      console.log(`    Target:   ${tgt}`)
      if (pct !== null) console.log(`    Progress: ${pct}%`)
    } else if (condition === 'new_post') {
      console.log(`    Status:   ${result.currentValue}`)
      if (monitor.last_tweet_id) console.log(`    Baseline: tweet ID ${monitor.last_tweet_id}`)
    } else if (condition === 'new_integration') {
      const rd = result.rawData ?? {}
      console.log(`    Found:    ${rd.found_count ?? 0} of ${rd.target ?? '?'} integrations live on mainnet`)
      if (rd.last_match) console.log(`    Last:     ${(rd.last_match.text ?? '').slice(0, 70)}`)
      else               console.log(`    Last:     none yet`)
    } else if (condition === 'new_topic') {
      const rd = result.rawData ?? {}
      console.log(`    Found:    ${rd.found_count ?? 0} of ${rd.target ?? '?'} Arc House topics live`)
      if (rd.last_match) console.log(`    Last:     ${(rd.last_match.text ?? '').slice(0, 70)}`)
      else               console.log(`    Last:     none yet`)
    } else if (condition === 'pfp_change' || condition === 'verification_change') {
      console.log(`    Status:   ${result.currentValue}`)
    } else if (condition.startsWith('next_tweet') || condition.startsWith('post_')) {
      const tgt = monitor.threshold ? parseInt(monitor.threshold).toLocaleString() : '—'
      console.log(`    Current:  ${result.currentValue}`)
      console.log(`    Target:   ${tgt}`)
      if (monitor.tracking_tweet_id) console.log(`    Tracking: tweet ID ${monitor.tracking_tweet_id}`)
    } else {
      console.log(`    Current:  ${result.currentValue}`)
      console.log(`    Target:   ${thresholdDisplay}`)
    }
    console.log(`    Status:   ${result.triggered ? '🔒 TRIGGERED' : '👀 monitoring'}`)

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
