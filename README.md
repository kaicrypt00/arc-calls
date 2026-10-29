# Arc Calls

**Community prediction market platform built natively on Arc mainnet. Live at [arc-calls.vercel.app](https://arc-calls.vercel.app).**

Built with [Arc Studio](https://studio.arc.io)

Arc Calls lets users stake USDC on YES or NO outcomes for real Arc community events. Markets are created by admins, settled onchain, and winners claim their USDC directly from the smart contract. The platform also includes community polls, onchain achievement badges, a live leaderboard, and a fully autonomous AI trading agent named ArcBot that places and claims bets daily.

---

## What It Does

- **Prediction Markets** — Bet USDC on YES or NO on Arc ecosystem outcomes. Winners split the losing pool proportionally. Two categories: Official Calls (Arc team) and Community Calls (user-submitted).
- **Community Polls** — Anyone submits a market idea. Community votes onchain. Top ideas become real markets each round.
- **Onchain Badges** — Four achievement badges (Starter, Caller, Oracle, OG) earned by placing bets. Gas only to mint.
- **Leaderboard** — Live rankings by total P&L across all callers.
- **AI Agent (ArcBot)** — Autonomous agent that places 0.1 USDC bets daily at 8 AM UTC and claims winnings at 8 PM UTC. Runs via GitHub Actions. Wallet: `0x50f7067035972795fc9970be26a6489b10065343`.
- **X Resolver** — Monitors X (Twitter) accounts for real-world outcomes and auto-settles markets. Runs hourly via GitHub Actions. Supports 9 condition types.
- **Session Wallet** — Secondary wallet derived from your main wallet signature. Eliminates MetaMask popups on every bet.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript |
| Chain | Arc Mainnet (Chain ID: 5042) |
| Gas + Betting token | USDC (native gas token on Arc) |
| Wallet | RainbowKit + wagmi v2 + viem |
| Database | Supabase (Postgres + Storage) |
| Agents | Node.js 22 via GitHub Actions |
| Smart Contracts | Solidity 0.8.20 |
| Hosting | Vercel (frontend) |

---

## Smart Contracts (Arc Mainnet)

| Contract | Address | Purpose |
|---|---|---|
| ProfileRegistry | `0xBc199573Bfaea3c3Ee55c55B090C518ed82385Ce` | One profile per wallet. Gas only to mint. |
| BettingPool | `0xD7b60891729bC02F8C786Dafb479CD6152f57925` | Holds all USDC bets. Min bet: 0.01 USDC. |
| AchievementRegistry | `0x9c703A763c81e74aE84DB3a7F6D88E87F0D60d91` | Four onchain badges tied to bet activity. |
| PollRegistry | `0xf100f704f00A9F44426d1Be16935b4Db11F8BFf2` | Community poll submission and voting. |

---

## Key Addresses

| Item | Address |
|---|---|
| USDC (Arc Mainnet) | `0x3600000000000000000000000000000000000000` |
| Admin Wallet 1 | `0x2e7497d98c8cae22180773c92d07d96f4d42f8b6` |
| Admin Wallet 2 | `0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8` |
| ArcBot Agent Wallet | `0x50f7067035972795fc9970be26a6489b10065343` |

---

## Development

### Prerequisites

- Node.js 22+ or Bun 1.x
- A Supabase project with the Arc Calls schema applied
- A WalletConnect project ID

### Install

```bash
bun install
```

### Environment Variables

Create a `.env` file at the project root. All `VITE_` variables are required for the frontend to run.

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase public anon key |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID |
| `VITE_PROFILE_REGISTRY_ADDRESS` | ProfileRegistry contract address |
| `VITE_BETTING_POOL_ADDRESS` | BettingPool contract address |
| `VITE_ACHIEVEMENT_REGISTRY_ADDRESS` | AchievementRegistry contract address |
| `VITE_POLL_REGISTRY_ADDRESS` | PollRegistry contract address |
| `RPC_PROXY_BASE_URL` | RPC proxy base URL (optional outside Arc Studio) |
| `RPC_PROXY_TOKEN` | RPC proxy auth token (optional outside Arc Studio) |
| `RPC_PROXY_CHAINS` | Comma-separated proxy chain keys (optional outside Arc Studio) |

### Run

```bash
bun run dev
```

### Build

```bash
bun run build
```

---

## Autonomous Agents

Both agents live in `agent/` and run via GitHub Actions. They require their own `npm install` inside that directory.

### ArcBot — Daily Bets (`agent-bet.yml`)
- **Schedule:** 8:00 AM UTC daily (also manually triggerable)
- **Script:** `agent/agent.js`
- **What it does:** Fetches active predictions from Supabase, uses `meta-llama/llama-3.1-8b-instruct:free` via OpenRouter to pick one and a side, places a 0.1 USDC bet from the agent wallet.

### ArcBot — Daily Claims (`agent-claim.yml`)
- **Schedule:** 8:00 PM UTC daily (12 hours after betting)
- **Script:** `agent/claim.js`
- **What it does:** Checks all settled predictions, claims any winnings owed to the agent wallet.

### ArcBot — Profile Setup (`agent-setup.yml`)
- **Trigger:** Manual only (run once)
- **Script:** `agent/setup.js`
- **What it does:** Mints an onchain profile for the agent wallet and inserts its Supabase profile row.

### X Resolver (`x-resolver.yml`)
- **Schedule:** Hourly
- **Script:** `agents/x-resolver.js`
- **What it does:** Fetches predictions with `x_monitor` JSONB config from Supabase, pulls latest tweets via fxtwitter API, evaluates 9 condition types (`price_above`, `price_below`, `price_reaches`, `mentions_keyword`, `mentions_count`, `retweet_count`, `account_posts`, `account_mentions`, `custom_regex`), calls `BettingPool.declareWinner` or `lockBetting` when a condition is met, logs results to `x_monitor_logs`.

### GitHub Secrets Required

| Secret | Used by |
|---|---|
| `AGENT_PRIVATE_KEY` (or `AGENT_WALLET_KEY`) | All agent workflows |
| `OPENROUTER_API_KEY` | agent-bet only |
| `SUPABASE_URL` | All agent workflows |
| `SUPABASE_SERVICE_ROLE_KEY` | All agent workflows |
| `SUPABASE_ANON_KEY` | x-resolver |
| `BETTING_POOL_ADDRESS` | agent-bet, agent-claim, agent-setup |
| `PROFILE_REGISTRY_ADDRESS` | agent-setup only |
| `RESOLVER_ADMIN_KEY` | x-resolver |

---

## Deployment

### Frontend (Vercel)

1. Add `public/arc-logo.png` to the repo (the Arc logo PNG)
2. Set all `VITE_*` env vars in Vercel project settings
3. Push to `master` — Vercel auto-deploys

### Agents (GitHub Actions)

Agents run automatically once secrets are set. To trigger manually: GitHub repo → Actions tab → select workflow → Run workflow.

---

## Arc Network

| Property | Value |
|---|---|
| Network | Arc Mainnet |
| Chain ID | 5042 |
| RPC | https://rpc.mainnet.arc.io |
| Explorer | https://explorer.arc.io |
| Gas token | USDC (native = ERC-20, same pool) |
| Finality | Sub-second |
| Gas cost | ~0.001 USDC per tx |

---

## Links

- Arc: https://www.arc.io/
- Arc X: https://x.com/arc_network
- Arc Explorer: https://explorer.arc.io
- Arc Studio: https://studio.arc.io/
- Arc Community: https://community.arc.io/home
