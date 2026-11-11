# Arc Calls — Autonomous Agents

Arc Calls runs three autonomous agent systems entirely through **GitHub Actions** — no external servers, no cloud functions. Each agent is a plain Node.js script that reads from Supabase, interacts with the Arc Mainnet smart contracts, and writes its results back to Supabase.

---

## Agent Overview

| Agent | Script | Schedule | Purpose |
|---|---|---|---|
| **ArcBot — Bet** | `agent/agent.js` | Daily · 8:00 AM UTC | AI picks a prediction and places a 0.1 USDC bet |
| **ArcBot — Claim** | `agent/claim.js` | Daily · 8:00 PM UTC | Claims any winnings from settled markets |
| **ArcBot — Setup** | `agent/setup.js` | Manual (run once) | Mints ArcBot's onchain profile |
| **X Resolver** | `agents/x-resolver.js` | Every 30 min | Monitors X/Twitter and auto-settles markets |
| **Ecosystem Resolver** | `agents/ecosystem-resolver.js` | Every hour | Reads Arc Mainnet on-chain stats and settles data-driven markets |

> **Why GitHub Actions?** Arc Calls is a public repository — public repos get **unlimited** free GitHub Actions minutes. All five workflows run entirely for free.

---

## Directory Layout

```
agent/                        ← ArcBot (AI betting agent)
│   agent.js                  ← Daily bet logic
│   claim.js                  ← Daily claim logic
│   setup.js                  ← One-time profile setup
│   package.json              ← Own dependencies (viem, @supabase/supabase-js)

agents/                       ← Resolver agents
│   x-resolver.js             ← X/Twitter condition resolver
│   ecosystem-resolver.js     ← On-chain stats resolver
│   package.json              ← Own dependencies

.github/workflows/
│   agent-bet.yml             ← Cron: 8 AM UTC daily
│   agent-claim.yml           ← Cron: 8 PM UTC daily
│   agent-setup.yml           ← Manual trigger only
│   x-resolver.yml            ← Cron: every 30 min
│   ecosystem-resolver.yml    ← Cron: every hour
```

> `agent/` and `agents/` are intentionally separate directories with separate `package.json` files. Each installs its own dependencies independently inside the GitHub Actions runner.

---

## ArcBot — AI Betting Agent

ArcBot is a fully autonomous market participant. It places one bet per day and claims its winnings automatically — it appears on the leaderboard alongside real users.

### How it works

```
1. Fetch all active predictions from Supabase (predictions_display)
2. Send prediction titles + pool sizes to LLM via OpenRouter
3. LLM returns: prediction ID + side (YES / NO) + reasoning
4. Call BettingPool.placeBet(predictionId, side) from agent wallet
5. INSERT row into bets table with result = 'pending'
6. Log outcome to Supabase
```

**AI model:** `meta-llama/llama-3.1-8b-instruct:free` via OpenRouter (free tier)  
**Bet size:** 0.1 USDC per bet  
**Agent wallet:** `0x50f7067035972795fc9970be26a6489b10065343`  
**Funding:** Top up the agent wallet with USDC on Arc Mainnet to keep it running (~0.1 USDC/day + minimal gas)

### Claim Flow

```
1. Fetch all predictions with status = 'settled' from Supabase
2. Call BettingPool.getClaimableAmount(id, agentWallet) for each
3. If claimable > 0 → call BettingPool.claimWinnings(id)
4. Log result
```

---

## X Resolver

The X Resolver monitors one or more X (Twitter) accounts and automatically settles prediction markets when real-world conditions are met — no human needed.

### How it works

```
1. Load all predictions that have an x_monitor JSONB config in Supabase
2. For each prediction, fetch the latest tweets from the configured account
   via fxtwitter.com RSS feed (no X API key required)
3. Evaluate the configured condition type against the tweet content
4. If condition is met:
     → Call BettingPool.declareWinner(predictionId, side) from admin wallet
     → UPDATE predictions_display: status = 'settled', winner = side
     → UPDATE bets: set result = 'won' or 'lost'
     → INSERT x_monitor_logs row with condition, raw tweet, timestamp
5. If condition not yet met:
     → INSERT x_monitor_logs row with result = 'pending'
     → Save last scanned tweet for display in AdminPage
```

### Condition Types

| Type | Description |
|---|---|
| `new_integration` | A new project integration with Arc is announced |
| `new_topic` | A new Arc House topic group goes live |
| `account_posts` | The monitored account reaches N total posts |
| `mentions_keyword` | A tweet contains a specific keyword |
| `mentions_count` | A keyword appears N or more times |
| `retweet_count` | A specific tweet reaches N retweets |
| `price_above` | Token price rises above a threshold |
| `price_below` | Token price falls below a threshold |
| `price_reaches` | Token price touches a specific level |
| `custom_regex` | Tweet matches a custom regular expression |

### Post URL History

When a condition match is confirmed (e.g. a new integration found), the resolver saves the matching tweet's URL to Supabase:

```json
{
  "found_integration_posts": [
    { "url": "https://x.com/arc/status/...", "entity": "Tolly", "text": "...", "date": "..." }
  ]
}
```

These are displayed as numbered, clickable links in the AdminPage so you can verify each match.

### Retry Logic

If the fxtwitter RSS feed fails (upstream X/Twitter connection blip), the resolver retries:
- **Attempts:** 2
- **Gap between retries:** 5 minutes
- **Workflow timeout:** 15 minutes

If both attempts fail, the run exits cleanly and the next scheduled run (30 min later) picks up automatically.

---

## Ecosystem Resolver

The Ecosystem Resolver reads **on-chain data directly from Arc Mainnet** via the [Blockscout API](https://explorer.arc.io) and settles prediction markets based on real blockchain metrics — no Twitter involved.

### How it works

```
1. Load predictions with ecosystem-type conditions from Supabase
2. Query Blockscout API for the target metric:
     → Total transaction count on Arc Mainnet
     → Total verified smart contracts count
3. Compare against each prediction's target threshold
4. If threshold reached → declareWinner(YES)
5. Log result to x_monitor_logs
```

### Retry Logic

Blockscout can experience API outages. The resolver retries aggressively:
- **Attempts:** 5
- **Gap between retries:** 2 minutes
- **Workflow timeout:** 25 minutes (worst case: 5 × 2 min + processing)

### API Key

Set `BLOCKSCOUT_API_KEY` in GitHub Actions secrets. Without it, the resolver falls back to the public endpoint (may be rate-limited).

---

## GitHub Actions Secrets

All secrets are set in the repository's **Settings → Secrets and variables → Actions**.

| Secret | Required by | Description |
|---|---|---|
| `AGENT_WALLET_KEY` | agent-bet, agent-claim, agent-setup | Private key of ArcBot's wallet |
| `OPENROUTER_API_KEY` | agent-bet | OpenRouter API key for LLM access |
| `RESOLVER_ADMIN_KEY` | x-resolver, ecosystem-resolver | Private key of admin wallet used to settle markets |
| `SUPABASE_URL` | all workflows | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | all workflows | Full Supabase access for writes |
| `SUPABASE_ANON_KEY` | x-resolver, ecosystem-resolver | Read-only Supabase access |
| `BETTING_POOL_ADDRESS` | all workflows | Deployed BettingPool contract address |
| `BLOCKSCOUT_API_KEY` | ecosystem-resolver | Blockscout Pro API key (optional but recommended) |

---

## Deployed Contracts (Arc Mainnet — Chain ID 5042)

| Contract | Address |
|---|---|
| ProfileRegistry | `0xBc199573Bfaea3c3Ee55c55B090C518ed82385Ce` |
| BettingPool | `0xa8e01ece16038D481f13a6AaAb692b2FD0Caa1d8` |
| AchievementRegistry | `0x9c703A763c81e74aE84DB3a7F6D88E87F0D60d91` |
| PollRegistry | `0xf100f704f00A9F44426d1Be16935b4Db11F8BFf2` |
| USDC (Arc native) | `0x3600000000000000000000000000000000000000` |

---

## Running Agents Locally

```bash
# Install agent dependencies
cd agent && npm install

# Run ArcBot betting agent
AGENT_WALLET_KEY=... OPENROUTER_API_KEY=... SUPABASE_URL=... \
SUPABASE_SERVICE_ROLE_KEY=... BETTING_POOL_ADDRESS=... \
node agent.js

# Install resolver dependencies
cd agents && npm install

# Run X Resolver
RESOLVER_ADMIN_KEY=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... BETTING_POOL_ADDRESS=... \
node x-resolver.js

# Run Ecosystem Resolver
RESOLVER_ADMIN_KEY=... SUPABASE_URL=... SUPABASE_ANON_KEY=... \
SUPABASE_SERVICE_ROLE_KEY=... BETTING_POOL_ADDRESS=... \
BLOCKSCOUT_API_KEY=... \
node ecosystem-resolver.js
```

---

## Supabase Tables Used by Agents

| Table | Access | Purpose |
|---|---|---|
| `predictions_display` | read + write | Source of markets to process; updated after settlement |
| `bets` | read + write | Updated with `result = 'won' / 'lost'` after settlement |
| `leaderboard` | read + write | ArcBot row tracked for wins/losses/P&L |
| `x_monitor_logs` | write | Full audit log of every resolver run |

---

*Arc Calls — Real predictions. Real USDC. Real outcomes.*
