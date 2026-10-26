# Arc Calls — Architecture

Arc Calls is a community prediction market platform built on Arc Mainnet where USDC is the native gas token. Users connect their main wallet, derive a session wallet from a signature, place USDC bets on market outcomes, vote in community polls, and earn onchain achievement badges.

---

## High-Level Overview

```
Browser (React + Wagmi + RainbowKit)
  │
  ├── Main Wallet (RainbowKit / WalletConnect)
  │     └── Signs one message → derives Session Wallet key
  │
  ├── Session Wallet (in-browser, localStorage ac_sw_*)
  │     ├── Holds small USDC float for gas + bets
  │     ├── Approves + calls BettingPool, PollRegistry
  │     └── Auto-refreshes balance every 15 s
  │
  ├── Supabase (Postgres)
  │     ├── profiles          (wallet_address PK, username, avatar_url, x_username)
  │     ├── predictions_display (mirrors onchain predictions + X monitor config)
  │     ├── bets              (bigserial id, prediction_id, wallet, side, amount)
  │     ├── leaderboard       (wallet_address PK, total_won, total_bet, wins, losses)
  │     ├── polls             (status, created_by_wallet, created_by_name)
  │     ├── poll_votes        (wallet_address, poll_id — dedup guardrail)
  │     ├── poll_history      (round_number, poll_title, submitted_by_name, final_vote_count)
  │     ├── templates         (id, title, description)
  │     └── x_monitor_logs    (checked_at, prediction_id, result, raw_tweet)
  │
  ├── Arc Mainnet (Chain ID 5042)
  │     ├── ProfileRegistry   0xBc199573Bfaea3c3Ee55c55B090C518ed82385Ce
  │     ├── BettingPool       0xD7b60891729bC02F8C786Dafb479CD6152f57925
  │     ├── AchievementRegistry 0x9c703A763c81e74aE84DB3a7F6D88E87F0D60d91
  │     └── PollRegistry      0xf100f704f00A9F44426d1Be16935b4Db11F8BFf2
  │
  └── GitHub Actions (Autonomous Agents)
        ├── agent.yml    — daily 8 AM UTC  → AI trading agent places 0.1 USDC bet
        └── x-resolver.yml — hourly        → X/Twitter resolver settles predictions
```

---

## Chain

| Property | Value |
|---|---|
| Network | Arc Mainnet |
| Chain ID | 5042 |
| RPC | https://rpc.mainnet.arc.io |
| Explorer | https://explorer.arc.io |
| Gas token | USDC (native = ERC-20, same pool) |
| USDC address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | 6 |
| Min bet | 0.1 USDC (100,000 raw) |
| Gas strategy | `maxFeePerGas = baseFee * 2n` (≥ 20 Gwei) |

---

## Smart Contracts

### ProfileRegistry
Stores onchain user profiles. One profile per wallet address.

| Function | Access | Description |
|---|---|---|
| `mintProfile(username, avatarUri, xUsername)` | anyone | Mints a profile NFT-style record |
| `updateProfile(username, avatarUri, xUsername)` | profile owner | Updates own profile |
| `getProfile(address)` | view | Returns profile struct |
| `hasProfile(address)` | view | Bool check |
| `totalProfiles()` | view | Global count |

### BettingPool
Core prediction market engine. Holds USDC, manages bet lifecycle.

| Function | Access | Description |
|---|---|---|
| `createPrediction(title, desc, deadline, category, imageUri)` | admin | Creates market |
| `placeBet(id, side)` | anyone | Places bet (requires USDC approval) |
| `lockBetting(id)` | admin | Locks market before resolution |
| `unlockBetting(id)` | admin | Re-opens locked market |
| `declareWinner(id, side)` | admin | Settles market, sets winner |
| `refundPrediction(id)` | admin | Cancels market, enables refunds |
| `extendDeadline(id, newDeadline)` | admin | Extends deadline |
| `claimWinnings(id)` | winner | Claims proportional payout |
| `claimRefund(id)` | bettor | Claims refund on cancelled market |
| `getPrediction(id)` | view | Full prediction struct |
| `getUserBet(id, address)` | view | User's bet on a prediction |
| `getBetCount(address)` | view | Total bets placed by address |
| `getAllIds()` | view | All prediction IDs |
| `isLocked(id)` | view | Whether within lockout window |

**Status lifecycle:** `OPEN → LOCKED → SETTLED` or `OPEN/LOCKED → REFUNDED`

**Lockout:** Betting closes 5 minutes before deadline.

### AchievementRegistry
Issues onchain achievement badges based on BettingPool activity.

| Function | Access | Description |
|---|---|---|
| `mintBadge(address, badgeType)` | admin | Mints badge to user |
| `hasBadge(address, badgeType)` | view | Bool check |
| `getBadges(address)` | view | All badge types for address |
| `setBettingPool(address)` | owner | Update BettingPool dependency |

**Badge types (uint8):** 0=First Bet, 1=Five Bets, 2=Ten Bets, 3=Winner, 4=Big Winner, 5=Veteran

### PollRegistry
Community poll voting onchain.

| Function | Access | Description |
|---|---|---|
| `createPoll(title, description)` | admin | Creates poll |
| `vote(pollId)` | anyone | Casts one vote (one per address per poll) |
| `deletePoll(pollId)` | admin | Removes poll |
| `closeRound(winnerIds[3], descriptions[3])` | admin | Archives current round to history |
| `getPoll(id)` | view | Poll struct |
| `getAllActivePolls()` | view | All active poll IDs |
| `getRoundHistory(round)` | view | Archived round entries |

---

## Frontend Architecture

```
src/
├── main.tsx              Provider tree (Wagmi → QueryClient → RainbowKit →
│                         BrowserRouter → Toast → SessionWallet → DataPrefetch → Profile → App)
├── App.tsx               Route definitions + AdminGuard
├── config.ts             wagmi config — Arc Mainnet only, WalletConnect
├── constants.ts          Contract addresses, admin wallets, gas constants, sign message
├── abis.ts               ABIs for all 4 contracts + ERC-20
├── onchain-facts.ts      Chain facts, RPC, USDC address (generated)
├── onchain-money.ts      USDC decimal helpers: parseUsdc, formatUsdc (generated)
├── onchain-wait.ts       Transaction state machine + poll loop (generated)
│
├── lib/
│   └── supabase.ts       Supabase JS client (URL + anon key from env)
│
├── contexts/
│   ├── SessionWalletContext.tsx   Session wallet derivation, USDC approval, balance
│   ├── ProfileContext.tsx         Onchain profile state, mint modal flag, nav state
│   ├── DataPrefetchContext.tsx    5-min TTL cache for predictions/leaderboard/polls
│   └── ToastContext.tsx           Pending / confirmed / failed toast notifications
│
├── components/
│   ├── ArcLogo.tsx               Arc arch-A logo — loads /arc-logo.png
│   ├── AppLoader.tsx             Branded loading screen until appInitialized
│   ├── MintProfileModal.tsx      Profile mint flow — avatar upload → mintProfile contract call
│   ├── Navbar.tsx                Navigation — session wallet dropdown, profile pill
│   ├── Footer.tsx                Footer links + "Built on Arc"
│   ├── ParticleBackground.tsx    Canvas particle animation
│   ├── Ticker.tsx                Scrolling recent bets ticker (30 s refresh)
│   └── PredictionCard.tsx        Full bet card — approve → placeBet → claim/refund
│
└── pages/
    ├── LandingPage.tsx     Hero, stats, ENTER ARENA CTA
    ├── CallsPage.tsx       6-tab market browser (Active/All/Community/Official/Settled/Poll)
    ├── LeaderboardPage.tsx THE ARENA — 5 stats + TOP CALLERS table
    ├── ProfilePage.tsx     3-state gate + profile card + session wallet card + badges
    └── AdminPage.tsx       3-tab admin panel (Predictions / Polls / Resolver logs)
```

---

## Session Wallet

The session wallet is a derived EOA stored client-side. It removes the need to sign every transaction with the main wallet.

**Derivation:**
1. User connects main wallet (RainbowKit)
2. User signs a fixed message: `"Sign to activate your Arc Calls session wallet. This does not cost gas."`
3. `keccak256(signature)` → 32-byte private key → `privateKeyToAccount`
4. Key stored in `localStorage` under `ac_sw_<mainWalletAddress>`

**Capabilities:** Hold USDC float, approve BettingPool, call `placeBet` / `claimWinnings` / `claimRefund` / `vote`

**Security note:** Key lives in localStorage. It holds only a small USDC float (user-controlled deposit). The main wallet key never touches localStorage.

---

## Data Flow — Placing a Bet

```
User clicks YES/NO on PredictionCard
  → Check session wallet USDC balance ≥ bet amount
  → Check + set USDC allowance for BettingPool (MAX_UINT256 approval if needed)
  → Call BettingPool.placeBet(predictionId, side) from session wallet
  → Wait for tx confirmation (single confirmation = final on Arc)
  → Insert row into Supabase bets table
  → Refresh card state from Supabase + onchain
  → Toast: "Bet confirmed"
```

---

## Data Flow — Admin Creates a Prediction

```
Admin fills Create Prediction form in AdminPage
  → Upload banner image to Supabase Storage (banners bucket) → get public URL
  → Select template (optional) — prefills title/description
  → Configure X Monitor (account, keyword, condition type, trigger value)
  → Call BettingPool.createPrediction(title, desc, deadline, category, imageUri) from main wallet
  → Wait for tx → read back predictionId from BetPlaced event or totalPredictions
  → INSERT into predictions_display: id, title, desc, deadline, category, image_url,
    yes_pool=0, no_pool=0, status='active', x_monitor={...JSONB config}
  → Toast: "Prediction created"
```

---

## Autonomous Agents (GitHub Actions)

### AI Trading Agent (`agent/agent.js`)
- **Schedule:** Daily at 8:00 AM UTC
- **Model:** `meta-llama/llama-3.1-8b-instruct:free` via OpenRouter
- **Flow:** Fetch active predictions from Supabase → ask LLM to pick one and a side → place 0.1 USDC bet from agent wallet (`0x50f7…343`)
- **Secrets required:** `AGENT_PRIVATE_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`

### X Resolver (`agents/x-resolver.js`)
- **Schedule:** Hourly
- **Flow:** Fetch predictions with `x_monitor` config → fetch latest tweets via fxtwitter → evaluate 9 condition types → call `BettingPool.declareWinner` or `lockBetting` if trigger met
- **Condition types:** price_above, price_below, price_reaches, mentions_keyword, mentions_count, retweet_count, account_posts, account_mentions, custom_regex
- **Secrets required:** `RESOLVER_ADMIN_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

---

## Environment Variables

| Variable | Used by | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | Frontend | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Frontend | Supabase public anon key |
| `VITE_WALLETCONNECT_PROJECT_ID` | Frontend | WalletConnect project ID |
| `VITE_PROFILE_REGISTRY_ADDRESS` | Frontend | ProfileRegistry contract address |
| `VITE_BETTING_POOL_ADDRESS` | Frontend | BettingPool contract address |
| `VITE_ACHIEVEMENT_REGISTRY_ADDRESS` | Frontend | AchievementRegistry contract address |
| `VITE_POLL_REGISTRY_ADDRESS` | Frontend | PollRegistry contract address |
| `RPC_PROXY_BASE_URL` | Frontend (Arc Studio) | RPC proxy base (optional outside Arc Studio) |
| `RPC_PROXY_TOKEN` | Frontend (Arc Studio) | RPC proxy auth token |
| `RPC_PROXY_CHAINS` | Frontend (Arc Studio) | Comma-separated proxy chain keys |
| `AGENT_PRIVATE_KEY` | GitHub Actions | AI agent wallet private key |
| `RESOLVER_ADMIN_KEY` | GitHub Actions | X resolver admin wallet private key |
| `SUPABASE_URL` | GitHub Actions | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub Actions | Supabase service role key (server-side) |
| `SUPABASE_ANON_KEY` | GitHub Actions | Supabase anon key |
| `OPENROUTER_API_KEY` | GitHub Actions | OpenRouter API key for LLM agent |

---

## Deployment

| Component | Host | Notes |
|---|---|---|
| Frontend | Vercel | `vercel.json` SPA rewrite included |
| Smart contracts | Arc Mainnet | Deployed, addresses in `AGENTS.md` |
| Agents | GitHub Actions | Cron-based, self-contained Node scripts |
| Database | Supabase | Managed Postgres, storage buckets: `avatars`, `banners` |

**Deploy steps:**
1. Add `public/arc-logo.png` to the repo
2. Set all `VITE_*` env vars in Vercel project settings
3. Push to `main` — Vercel auto-deploys
4. GitHub Actions pick up `AGENT_PRIVATE_KEY` etc. from repo secrets automatically

---

*Built on Arc · Real USDC · Real Outcomes*
