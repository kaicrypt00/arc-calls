# Arc Calls — Architecture

Arc Calls is a community prediction market platform built on Arc Mainnet where USDC is the native gas token. Users connect their main wallet, derive a session wallet from a signature, place USDC bets on market outcomes, vote in community polls, and earn onchain achievement badges. An autonomous AI agent (ArcBot) participates as a community member, placing and claiming bets daily. An X Resolver monitors real-world Twitter/X signals and settles markets automatically.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BROWSER (React + Wagmi)                      │
│                                                                     │
│  Main Wallet (RainbowKit)                                           │
│    └─ Signs once → keccak256(sig) → Session Wallet (localStorage)  │
│         └─ Holds USDC float, signs all bet/poll/profile txs         │
│                                                                     │
│  Pages: Landing → Calls → Leaderboard → Profile → Admin            │
└────────────────────┬────────────────────────────────────────────────┘
                     │ reads / writes
          ┌──────────┴──────────┐
          │                     │
    ┌─────▼──────┐      ┌───────▼────────┐
    │ Supabase   │      │  Arc Mainnet   │
    │ (Postgres) │      │  Chain ID 5042 │
    │            │      │                │
    │ profiles   │      │ ProfileRegistry│
    │ predictions│      │ BettingPool    │
    │ bets       │      │ AchievementReg │
    │ leaderboard│      │ PollRegistry   │
    │ polls      │      └────────────────┘
    │ poll_votes │
    │ poll_history        ┌─────────────────────────┐
    │ templates  │        │   GitHub Actions (Cron)  │
    │ x_monitor  │        │                         │
    │  _logs     │◄───────┤ agent-bet.yml  (8 AM)   │
    └────────────┘        │ agent-claim.yml (8 PM)  │
                          │ agent-setup.yml (once)  │
                          │ x-resolver.yml (hourly) │
                          └─────────────────────────┘
```

---

## Chain

| Property | Value |
|---|---|
| Network | Arc Mainnet |
| Chain ID | 5042 |
| RPC | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.arc.io` |
| Gas token | USDC — native gas token and betting token (same pool) |
| USDC address | `0x3600000000000000000000000000000000000000` |
| USDC decimals | 6 (ERC-20 view) / 18 (native view) |
| Min bet | 0.01 USDC |
| Gas strategy | `maxFeePerGas = max(baseFee * 2n, 20 Gwei)` |
| Finality | Sub-second (single confirmation = final) |

**Important:** On Arc, `getBalance()` returns the native amount in 18 decimals. The ERC-20 `balanceOf()` returns 6 decimals. They represent the same pool of USDC. Never display or sum both.

---

## Smart Contracts

All four contracts are deployed on Arc Mainnet and are not upgradeable. ABIs live in `src/abis.ts`.

### ProfileRegistry — `0xBc199573Bfaea3c3Ee55c55B090C518ed82385Ce`
One profile per wallet address. Required to use the platform.

| Function | Access | Description |
|---|---|---|
| `mintProfile(name, bio, pfpUrl, xUsername)` | anyone | Creates profile record |
| `updateProfile(name, bio, pfpUrl, xUsername)` | profile owner | Updates own profile |
| `getProfile(address)` | view | Returns profile struct |
| `hasProfile(address)` | view | Bool check |
| `totalProfiles()` | view | Global count |

### BettingPool — `0xD7b60891729bC02F8C786Dafb479CD6152f57925`
Core prediction market engine. Holds and distributes USDC.

| Function | Access | Description |
|---|---|---|
| `createPrediction(title, desc, deadline, category, imageUri)` | admin | Creates market |
| `placeBet(id, side)` | anyone | Places bet (requires prior USDC approval) |
| `lockBetting(id)` | admin | Locks market before resolution |
| `unlockBetting(id)` | admin | Re-opens locked market |
| `declareWinner(id, side)` | admin | Settles market, enables claims |
| `refundPrediction(id)` | admin | Cancels market, enables refunds |
| `extendDeadline(id, newDeadline)` | admin | Extends deadline |
| `claimWinnings(id)` | winner | Claims proportional USDC payout |
| `claimRefund(id)` | bettor | Claims refund on cancelled market |
| `getPrediction(id)` | view | Full prediction struct |
| `getUserBet(id, address)` | view | User's bet on a prediction |
| `getClaimableAmount(id, address)` | view | Claimable USDC for address |
| `getBetCount(address)` | view | Total bets placed by address |
| `getAllIds()` | view | All prediction IDs |
| `isBettingLocked(id)` | view | Whether within 5-min lockout window |

**Status lifecycle:** `OPEN → LOCKED → SETTLED` or `OPEN/LOCKED → REFUNDED`

**Category values:** `community_calls` | `official_calls`

### AchievementRegistry — `0x9c703A763c81e74aE84DB3a7F6D88E87F0D60d91`
Issues onchain badges based on bet activity.

| Badge | ID | Trigger |
|---|---|---|
| Starter | 0 | First bet placed |
| Caller | 1 | 5 bets placed |
| Oracle | 2 | 10 bets placed |
| OG | 3 | Won a prediction |

| Function | Access | Description |
|---|---|---|
| `mintBadge(address, badgeType)` | admin | Mints badge to user |
| `hasBadge(address, badgeType)` | view | Bool check |
| `getBadges(address)` | view | All badge IDs for address |

### PollRegistry — `0xf100f704f00A9F44426d1Be16935b4Db11F8BFf2`
Community poll voting onchain.

| Function | Access | Description |
|---|---|---|
| `createPoll(title, description)` | admin | Creates poll |
| `vote(pollId)` | anyone | Casts one vote (one per address per poll) |
| `deletePoll(pollId)` | admin | Removes poll |
| `closeRound(winnerIds[3], descriptions[3])` | admin | Archives round winners to history |
| `getPoll(id)` | view | Poll struct |
| `getAllActivePolls()` | view | All active poll IDs |
| `getRoundHistory(round)` | view | Archived round entries |

---

## Frontend Architecture

```
src/
├── main.tsx                Provider tree:
│                           Wagmi → QueryClient → RainbowKit →
│                           BrowserRouter → Sonner → SessionWallet →
│                           DataPrefetch → Profile → App
│
├── App.tsx                 Route definitions + AdminGuard + CacheWarmer
├── config.ts               wagmi config — Arc Mainnet, WalletConnect
├── constants.ts            Contract addresses, admin wallets, gas constants
├── abis.ts                 ABIs: ProfileRegistry, BettingPool,
│                           AchievementRegistry, PollRegistry, ERC20
├── onchain-facts.ts        Chain registry, RPC URLs, USDC addresses (generated)
├── onchain-money.ts        USDC decimal helpers: parseUsdc, formatUsdc (generated)
├── onchain-wait.ts         Transaction state machine + poll loop (generated)
│
├── lib/
│   └── supabase.ts         Supabase JS client + all DB type definitions
│
├── contexts/
│   ├── SessionWalletContext.tsx   Wallet derivation, balance, approval, sendUSDC
│   ├── ProfileContext.tsx         Onchain profile state, mint modal, nav state
│   ├── DataPrefetchContext.tsx    5-min TTL cache: predictions, leaderboard, polls
│   ├── ToastContext.tsx           Pending / confirmed / failed notifications
│   └── SoundContext.tsx           Background audio + sound toggle state
│
├── components/
│   ├── ArcLogo.tsx               Loads /public/arc-logo.png
│   ├── AppLoader.tsx             Full-screen loader until appInitialized
│   ├── Navbar.tsx                Nav links, session wallet dropdown, profile pill
│   ├── Footer.tsx                Footer with Arc links
│   ├── ParticleBackground.tsx    3-tier floating particle system (105 particles)
│   ├── Ticker.tsx                Scrolling live bets strip (30s refresh)
│   ├── SoundToggleButton.tsx     Sound ON/OFF toggle (landing nav)
│   ├── MintProfileModal.tsx      Profile mint: avatar upload → mintProfile tx
│   ├── EditProfileModal.tsx      Profile edit: avatar + fields → updateProfile tx
│   ├── PredictionCard.tsx        Full bet card: approve → placeBet → claim/refund
│   ├── SettledTab.tsx            Settled markets grid with winner banners
│   ├── PollTab.tsx               Community poll list + vote flow
│   ├── RecentBetsFeed.tsx        Live bets feed with Supabase realtime
│   ├── BadgesTab.tsx             4 badge cards with progress bars + mint button
│   └── ErrorBoundary.tsx         React error boundary with retry button
│
├── pages/
│   ├── LandingPage.tsx     No-scroll hero: heading, CTA, live stats card
│   ├── CallsPage.tsx       5-tab market browser:
│   │                       All Calls / Community / Official / Settled / The Poll
│   ├── LeaderboardPage.tsx Arena stats + TOP CALLERS ranked by total P&L
│   ├── ProfilePage.tsx     3-state gate + profile hero + badges + bet history
│   └── AdminPage.tsx       3-tab admin: Predictions / Polls / X Resolver logs
│
└── utils/
    └── format.ts           shortAddress, calcOdds, formatCountdown, timeAgo,
                            copyToClipboard, buildXShareUrl, validateBetAmount
```

---

## Session Wallet

The session wallet is a deterministic EOA derived client-side. It removes the need to sign every transaction with the main wallet.

**Derivation:**
1. User connects main wallet via RainbowKit
2. User signs a fixed message: `"Sign to activate your Arc Calls session wallet. This does not cost gas."`
3. `keccak256(signature)` → 32-byte private key → `privateKeyToAccount(privKey)`
4. Key stored in `localStorage` under `ac_sw_<mainWalletAddress>`

**Capabilities:** Hold USDC float, approve BettingPool (`MAX_UINT256`), call `placeBet` / `claimWinnings` / `claimRefund` / `vote` / `mintProfile`

**Security model:** The session key lives only in the user's browser localStorage. It is intentionally designed to hold only a small USDC float topped up by the user. The main wallet key never touches localStorage or is used to sign transactions after session wallet activation.

**Gas preflight:** Before any transaction, the modal/card checks the session wallet's native USDC balance. If below 0.001 USDC, the action is blocked and the user sees a clear "fund your Arc Calls wallet" notice with the session wallet address.

---

## Data Flow — Placing a Bet

```
User clicks YES / NO on a PredictionCard
  1. Validate: amount ≥ 0.01 USDC, market not locked, user has profile
  2. Check session wallet USDC balance ≥ bet amount + gas
  3. Check USDC allowance for BettingPool — if < 1000 USDC, approve MAX_UINT256
  4. Call BettingPool.placeBet(predictionId, side) from session wallet
  5. Wait for tx receipt (single confirmation = final)
  6. INSERT into Supabase bets table (wallet, prediction_id, side, amount)
  7. Optimistically update yes_pool / no_pool in predictions_display
  8. Refresh PredictionCard state
  9. Toast: "Bet confirmed ✓"
```

---

## Data Flow — Settling a Market

```
Option A — X Resolver (automated, hourly):
  x-resolver.js fetches predictions with x_monitor JSONB config
    → Pulls tweets via fxtwitter API for configured X accounts
    → Evaluates 9 condition types against tweet data
    → If condition met: call BettingPool.declareWinner(id, side) from admin wallet
    → UPDATE predictions_display: status = 'settled', winner = side
    → INSERT x_monitor_logs row with result + raw tweet
    → UPDATE bets: set result = 'won'/'lost' for all bets on this prediction

Option B — Manual (AdminPage):
  Admin clicks Declare Winner in AdminPage Predictions tab
    → Call BettingPool.declareWinner(id, side) from connected admin wallet
    → Same Supabase updates as above
```

---

## Data Flow — Admin Creates a Prediction

```
Admin fills Create Prediction form in AdminPage
  1. Upload banner image to Supabase Storage (banners bucket) → get public URL
  2. Optionally select a template — prefills title + description
  3. Configure X Monitor: account, keyword, condition type, trigger value
  4. Call BettingPool.createPrediction(title, desc, deadline, category, imageUri)
  5. Wait for tx → read back predictionId
  6. INSERT into predictions_display:
       id, title, desc, deadline, category, banner_url,
       yes_pool=0, no_pool=0, status='open',
       x_monitor={account, keyword, condition, value} (JSONB)
  7. Toast: "Prediction created"
```

---

## Autonomous Agents

### ArcBot — Daily Bets (`agent/agent.js`)
- **Workflow:** `agent-bet.yml` — daily 8:00 AM UTC
- **AI model:** `meta-llama/llama-3.1-8b-instruct:free` via OpenRouter
- **Flow:** Fetch active predictions from Supabase → LLM picks prediction + side → `placeBet(id, side)` from agent wallet → INSERT bets row → log result

### ArcBot — Daily Claims (`agent/claim.js`)
- **Workflow:** `agent-claim.yml` — daily 8:00 PM UTC (12 h after bets)
- **Flow:** Fetch all settled predictions → call `getClaimableAmount(id, agentWallet)` → if > 0, call `claimWinnings(id)` → log result

### ArcBot — Profile Setup (`agent/setup.js`)
- **Workflow:** `agent-setup.yml` — manual trigger, run once
- **Flow:** Call `mintProfile` for agent wallet → INSERT into Supabase profiles + leaderboard rows

### X Resolver (`agents/x-resolver.js`)
- **Workflow:** `x-resolver.yml` — hourly
- **Condition types:** `price_above`, `price_below`, `price_reaches`, `mentions_keyword`, `mentions_count`, `retweet_count`, `account_posts`, `account_mentions`, `custom_regex`
- **Data source:** fxtwitter.com API (no auth required)
- **Settlement:** `BettingPool.declareWinner(id, side)` or `lockBetting(id)` depending on condition result

### Secrets Required

| Secret | Workflows |
|---|---|
| `AGENT_PRIVATE_KEY` / `AGENT_WALLET_KEY` | agent-bet, agent-claim, agent-setup |
| `OPENROUTER_API_KEY` | agent-bet |
| `SUPABASE_URL` | all |
| `SUPABASE_SERVICE_ROLE_KEY` | all |
| `SUPABASE_ANON_KEY` | x-resolver |
| `BETTING_POOL_ADDRESS` | agent-bet, agent-claim, agent-setup |
| `PROFILE_REGISTRY_ADDRESS` | agent-setup |
| `RESOLVER_ADMIN_KEY` | x-resolver |

---

## Supabase Schema

| Table | PK | Key columns |
|---|---|---|
| `profiles` | `wallet_address` | name, bio, pfp_url, x_username, minted_at |
| `predictions_display` | `id` | title, desc, deadline, category, banner_url, status, winner, yes_pool, no_pool, x_monitor (JSONB), settled_at |
| `bets` | `id` (bigserial) | prediction_id, wallet_address, side, amount, result, tx_hash |
| `leaderboard` | `wallet_address` | name, pfp_url, total_calls, wins, losses, win_rate, total_pnl, total_volume, is_agent |
| `polls` | `id` | title, description, status, created_by_wallet, created_by_name, vote_count |
| `poll_votes` | `id` (bigserial) | poll_id, wallet_address |
| `poll_history` | `id` | round_number, poll_title, submitted_by_name, final_vote_count |
| `templates` | `id` | title, description |
| `x_monitor_logs` | `id` | prediction_id, checked_at, result, raw_tweet, condition_met |
| `wallet_transactions` | `id` | wallet_address, type, label, tx_hash, amount |

**Storage buckets:** `avatars` (profile pictures), `banners` (prediction banner images)

---

## Deployment

| Component | Host | Notes |
|---|---|---|
| Frontend | Vercel | Auto-deploys on push to `master`. SPA rewrite via `vercel.json`. |
| Smart contracts | Arc Mainnet | Deployed, immutable. Addresses in `AGENTS.md`. |
| AI Agent + Claim | GitHub Actions | `agent/` directory, own `package.json`. Cron + manual trigger. |
| X Resolver | GitHub Actions | `agents/` directory. Hourly cron. |
| Database | Supabase | Managed Postgres. Storage buckets for media. |

---

## Environment Variables

### Frontend (`.env`)

| Variable | Required | Description |
|---|---|---|
| `VITE_SUPABASE_URL` | yes | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | yes | Supabase public anon key |
| `VITE_WALLETCONNECT_PROJECT_ID` | yes | WalletConnect project ID |
| `VITE_PROFILE_REGISTRY_ADDRESS` | yes | ProfileRegistry contract address |
| `VITE_BETTING_POOL_ADDRESS` | yes | BettingPool contract address |
| `VITE_ACHIEVEMENT_REGISTRY_ADDRESS` | yes | AchievementRegistry contract address |
| `VITE_POLL_REGISTRY_ADDRESS` | yes | PollRegistry contract address |
| `RPC_PROXY_BASE_URL` | no | Arc Studio RPC proxy (optional outside Arc Studio) |
| `RPC_PROXY_TOKEN` | no | Arc Studio RPC proxy token |
| `RPC_PROXY_CHAINS` | no | Arc Studio proxy chain keys |

### GitHub Actions Secrets

See [Secrets Required](#secrets-required) table in the Autonomous Agents section above.

---

*Built on Arc · Real USDC · Real Outcomes*
