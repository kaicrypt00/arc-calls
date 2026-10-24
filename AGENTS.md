# Arc Calls

> Built with Arc Studio - money-powered apps in minutes

This is the **project memory** for Arc Calls — a community prediction market platform on Arc Mainnet.

---

## What This App Does

Arc Calls is a community-driven prediction market platform on Arc Mainnet. Users stake USDC on YES or NO outcomes for real-world events, claim winnings when markets settle, submit community poll ideas, earn onchain badges, and compete on a live leaderboard. An AI agent places one bet daily and an X Resolver agent monitors Twitter conditions to auto-lock markets.

## Tech Stack

- Frontend: React 18 + Vite + TypeScript
- Routing: React Router v6
- Web3: wagmi v2 + viem v2
- Wallet UI: RainbowKit (Arc dark theme)
- Styling: Vanilla CSS (no Tailwind)
- Database: Supabase (off-chain caching + display)
- Contracts: Solidity 0.8.20 + Foundry
- Chain: Arc Mainnet (Chain ID: 5042)
- Token: USDC (6 decimals) — both gas and betting token
- Agents: GitHub Actions (daily AI agent + hourly X Resolver)

## Deployed Contract Addresses (Arc Mainnet — Chain ID 5042)

| Contract | Address |
|---|---|
| ProfileRegistry | `0xBc199573Bfaea3c3Ee55c55B090C518ed82385Ce` |
| BettingPool | `0xD7b60891729bC02F8C786Dafb479CD6152f57925` |
| AchievementRegistry | `0x9c703A763c81e74aE84DB3a7F6D88E87F0D60d91` |
| PollRegistry | `0xf100f704f00A9F44426d1Be16935b4Db11F8BFf2` |
| USDC (Arc native) | `0x3600000000000000000000000000000000000000` |

## Admin Wallets

- `0x2e7497d98c8cae22180773c92d07d96f4d42f8b6`
- `0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8`

## Agent Wallet

- AI Trading Agent: `0x50f7067035972795fc9970be26a6489b10065343`
- Fund this address with USDC on Arc Mainnet to keep the agent running (needs 0.1 USDC per day + gas)

## Key Files

- `src/constants.ts` — all contract addresses, admin wallets, constants
- `src/abis.ts` — all contract ABIs
- `src/config.ts` — wagmi/viem Arc Mainnet config
- `src/contexts/SessionWalletContext.tsx` — session wallet derivation + balance
- `src/contexts/ProfileContext.tsx` — profile state + mint modal trigger
- `src/lib/supabase.ts` — Supabase client + TypeScript types
- `agent/agent.js` — AI trading agent (GitHub Actions, daily 8AM UTC)
- `agents/x-resolver.js` — X Resolver agent (GitHub Actions, hourly)
- `.github/workflows/agent.yml` — AI agent workflow
- `.github/workflows/x-resolver.yml` — X Resolver workflow

## Supabase

- Project URL: https://zxmfdvzkmeybujoowzgh.supabase.co
- Tables: profiles, leaderboard, predictions_display, bets, polls, poll_votes, poll_history, wallet_transactions, templates, x_monitor_logs
- Storage buckets: avatars (public), banners (public)
- Do NOT create tables or buckets — they already exist

## Session Wallet

- localStorage key: `ac_sw_<mainWalletAddressLowercase>`
- Derived from: keccak256(signature of SIGN_MESSAGE)
- USDC is both gas and betting token — one balance, one asset

## GitHub Actions Secrets (all set in repo)

- `AGENT_PRIVATE_KEY` — private key of agent wallet
- `RESOLVER_ADMIN_KEY` — private key of admin wallet for X Resolver
- `SUPABASE_URL` — Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` — for AI agent Supabase writes
- `SUPABASE_ANON_KEY` — for X Resolver Supabase reads
- `OPENROUTER_API_KEY` — OpenRouter key for AI agent (model: meta-llama/llama-3.1-8b-instruct:free)

## To Run

```bash
bun install
bun run dev
```

## To Build

```bash
bun run build
```

## Environment Variables

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon key |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID |
| `VITE_PROFILE_REGISTRY_ADDRESS` | ProfileRegistry contract address |
| `VITE_BETTING_POOL_ADDRESS` | BettingPool contract address |
| `VITE_ACHIEVEMENT_REGISTRY_ADDRESS` | AchievementRegistry contract address |
| `VITE_POLL_REGISTRY_ADDRESS` | PollRegistry contract address |

## Deployment Notes

- Frontend: Deploy to Vercel with SPA fallback (`vercel.json` included)
- No testnet — mainnet only, real USDC
- After deploy, add all `VITE_*` env vars to Vercel dashboard
- GitHub Actions workflows auto-activate once `.github/workflows/` files are in the repo
