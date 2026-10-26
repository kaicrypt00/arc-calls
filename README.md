# Arc Calls

**Community prediction market platform built natively on Arc mainnet.**

Arc Calls lets users stake USDC on YES or NO outcomes for real-world events. Markets are created by admins, settled onchain, and winners claim their USDC directly from the smart contract. The platform also includes community polls, onchain achievement badges, a live leaderboard, and an AI trading agent that places one bet daily.

## What It Is

- **Prediction Markets** - Bet USDC on YES or NO. Winners split the losing pool proportionally.
- **Community Polls** - Anyone submits a market idea. Community votes. Top 3 per round become real markets.
- **Onchain Badges** - Four achievement badges (Starter, Caller, Oracle, OG) earned by placing bets. Gas only to mint.
- **Leaderboard** - Live rankings by total P&L, sourced from the prefetch cache.
- **AI Agent** - Places 0.1 USDC bets daily. Runs automatically via GitHub Actions.
- **X Resolver** - Monitors X accounts for conditions and auto-locks markets. Runs hourly via GitHub Actions.
- **Session Wallet** - Secondary wallet derived from your main wallet signature. No MetaMask popups on every bet.

## Tech Stack

- Frontend: React + Vite
- Chain: Arc Mainnet (Chain ID: 5042)
- Token: USDC - gas token and betting token
- Wallet: RainbowKit + wagmi v2 + viem
- Database: Supabase
- Agents: Node.js via GitHub Actions
- Contracts: Solidity 0.8.20

## Smart Contracts (Arc Mainnet)

| Contract | Purpose |
|---|---|
| ProfileRegistry | One profile per wallet. Gas only to mint. |
| BettingPool | Holds all USDC bets. Min bet: 0.1 USDC. |
| AchievementRegistry | Four onchain badges tied to bet activity. |
| PollRegistry | Community poll submission and voting. |

## Key Addresses

| Item | Address |
|---|---|
| USDC (Arc Mainnet) | 0x3600000000000000000000000000000000000000 |
| Admin Wallet 1 | 0x2e7497d98c8cae22180773c92d07d96f4d42f8b6 |
| Admin Wallet 2 | 0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8 |
| AI Agent Wallet | 0x50f7067035972795fc9970be26a6489b10065343 |

## Arc Network

- Chain ID: 5042
- RPC: https://rpc.mainnet.arc.io
- Explorer: https://explorer.arc.io
- Gas: USDC ~.001 per tx
- Finality: Sub-second

## Links

- Arc: https://www.arc.io/
- Arc X: https://x.com/arc
- Arc Studio: https://studio.arc.io/
- Arc Community: https://community.arc.io/home
