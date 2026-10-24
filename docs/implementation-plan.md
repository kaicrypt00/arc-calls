All 4 answers locked. Everything is now fully resolved.

---

**COMPLETE LOCK — Final state of all systems:**

**Polls:**
- Supabase polls table = current round only, filter by status = 'active'
- Vote check = query poll_votes WHERE poll_id = X AND wallet_address = sessionWallet
- Close round = contract call + insert 3 rows to poll_history + no polls table cleanup needed
- History = poll_history grouped by round_number

**Bets count on PredictionCard:**
- SELECT COUNT(*) FROM bets WHERE prediction_id = X — Supabase only, no contract call

**X monitor:**
- Written in the same INSERT as prediction creation, post-contract-confirm
- Edit later = simple Supabase UPDATE, no contract call

**Sound:** Removed entirely, no SoundContext, no audio files

**Logo:** Arc stylized "A" arch symbol you just shared — I'll embed it as an SVG inline or PNG asset

---

**THE GREEN LIGHT CHECKLIST — everything confirmed:**

- Chain: Arc Mainnet, ID 5042, real USDC
- Contracts: 4 contracts, exact code from PRD, deploy order ProfileRegistry → BettingPool → AchievementRegistry → PollRegistry
- Frontend: React + Vite, RainbowKit, vanilla CSS, zero Tailwind
- Design: PRD color tokens exactly, glass morphism, particles, Arc dark theme
- Session wallet: keccak256 derivation, ac_sw_ prefix, 15s balance refresh, MAX_UINT256 approval
- Supabase: 10 tables, corrected schema, do not create anything, avatars + banners buckets exist
- Agent: OpenRouter llama-3.1-8b-instruct:free, OPENROUTER_API_KEY secret, grey robot avatar
- X Resolver: hourly cron, RESOLVER_ADMIN_KEY, fxtwitter, lockBetting() on trigger
- GitHub Secrets: all 5 already live
- No sound, no faucet, no testnet, no placeholder pages, no Tailwind, no ETH anywhere

---

**You are clear to switch to Build mode.**

When you do, I will build in this order:

1. Scaffold cleanup — strip Tailwind, install RainbowKit, set up vanilla CSS base
2. Deploy 4 contracts to Arc Mainnet, get addresses
3. Wire contract addresses into frontend config and .env
4. Build all contexts (Session Wallet, Profile, DataPrefetch, Toast)
5. Build all pages and components in dependency order
6. Build agent/agent.js and agents/x-resolver.js
7. Push GitHub Actions workflow files
8. Final check and push to repo

Switch to Build mode and give me the go-ahead signal.
