# Arc Calls 🔮

> **The first community-powered prediction market built natively on [Arc by Circle](https://arc.io).**

![Status](https://img.shields.io/badge/status-in%20development-orange)
![Chain](https://img.shields.io/badge/chain-Arc%20(Circle)-blue)
![Gas](https://img.shields.io/badge/gas-USDC%20native-green)
![License](https://img.shields.io/badge/license-MIT-lightgrey)

---

## 📌 What is Arc Calls?

**Arc Calls** is a decentralized prediction market designed from the ground up for the Arc ecosystem. It lets the community put their convictions on-chain — in USDC — with no friction, no volatile gas tokens, and no signing popups every click.

Two prediction categories:
- 🎭 **Community Lore** — Culture, memes, community events, and Arc ecosystem happenings
- 🏗️ **Official** — Arc technical milestones, protocol upgrades, and ecosystem growth metrics

---

## ✨ Key Features

### 💳 Session Wallet (In-App Native Wallet)
Users sign once with their main wallet to create a **session wallet** — a persistent, scoped smart account owned by their main address. From that point:
- Place predictions with **one click**, no repeated signing
- Built-in **Send** and **Receive** buttons
- Stays connected until the user manually disconnects
- Fully non-custodial — owned by the user's main wallet at all times

### 💵 100% USDC Native
- All stakes and payouts denominated in **USDC**
- Gas fees paid in **USDC** (Arc's native gas token) — no extra token juggling
- Predictable, stable-denominated economics for every participant

### 🗳️ Community Poll → On-Chain Calls
Every **10 days**, the community votes on-chain for prediction ideas they want to see live:
- Anyone can submit a prediction idea
- Top 3 most-voted ideas get added as official Arc Calls
- Voting is on-chain — spam-resistant, transparent, immutable

### 🤖 AI Resolution Agent
An autonomous AI agent with its own Arc wallet resolves markets automatically:
- Fetches outcome data from APIs and on-chain sources
- Distributes USDC winnings to correct predictors
- Self-sustaining — uses its own USDC balance to pay gas

### 🏆 Profiles, Badges & Leaderboard
- On-chain **user profiles** tied to wallet address
- **Achievement badges** (NFT-based) earned through activity
- Global **leaderboard** ranked by prediction accuracy and winnings

---

## 🏗️ Architecture

```
arc-calls/
├── contracts/              # Solidity smart contracts (Arc EVM)
│   ├── Profile.sol         # ✅ User profiles + achievement badges
│   ├── BettingPool.sol     # 🔨 Core prediction pool logic
│   └── Poll.sol            # 🔨 Community voting & call submission
│
├── frontend/               # Next.js dApp
│   ├── src/app/            # App router pages
│   ├── src/components/     # UI components
│   └── src/lib/            # Arc, Supabase, session wallet clients
│
├── agent/                  # AI resolution agent (Node.js)
│   └── src/                # Resolver logic
│
└── docs/                   # Technical documentation
```

---

## 🔗 Arc Novel Features Leveraged

| Feature | Usage in Arc Calls |
|---|---|
| **USDC Gas** | All transactions — bets, votes, badge mints — paid in USDC |
| **ERC-4337 Session Wallets** | Persistent one-click betting without repeated signing |
| **Sub-Second Finality** | Instant bet confirmation, real-time leaderboard updates |
| **Circle Agent Stack** | AI agent autonomously resolves markets |
| **EVM Compatibility** | Standard Solidity + Hardhat/Foundry tooling |

---

## 📋 Smart Contracts

| Contract | Status | Description |
|---|---|---|
| `Profile.sol` | ✅ Complete | User profiles, badge minting, on-chain identity |
| `BettingPool.sol` | 🔨 In Progress | Prediction creation, USDC staking, payout logic |
| `Poll.sol` | 📋 Planned | Community idea submission and on-chain voting |

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Blockchain | Arc (EVM-compatible, Circle) |
| Smart Contracts | Solidity + Hardhat |
| Session Wallets | ERC-4337 (ZeroDev SDK) |
| Frontend | Next.js 14 (App Router) |
| Backend / DB | Supabase |
| AI Agent | Node.js + Circle Agent Stack |
| Wallet Connect | wagmi + viem |

---

## 🗺️ Roadmap

- [x] Project architecture & contract design
- [x] `Profile.sol` — user profiles and badges
- [ ] `BettingPool.sol` — prediction pool logic *(in progress)*
- [ ] `Poll.sol` — community voting contract *(in progress)*
- [ ] Session wallet integration (ZeroDev ERC-4337)
- [ ] Frontend — prediction cards and session wallet UI
- [ ] AI resolver agent
- [ ] Testnet deployment on Arc
- [ ] Mainnet launch

---

## 🚀 Getting Started

### Prerequisites
- Node.js v18+
- Git
- A wallet with USDC on Arc testnet

### Installation

```bash
git clone https://github.com/kaicrypt00/arc-calls.git
cd arc-calls

# Install contract dependencies
cd contracts && npm install

# Install frontend dependencies
cd ../frontend && npm install

# Install agent dependencies
cd ../agent && npm install
```

### Environment Variables

```bash
# frontend/.env.local
NEXT_PUBLIC_ARC_RPC_URL=https://rpc.arc.io
NEXT_PUBLIC_PROFILE_CONTRACT=<deployed_address>
NEXT_PUBLIC_BETTING_POOL_CONTRACT=<deployed_address>
NEXT_PUBLIC_POLL_CONTRACT=<deployed_address>
NEXT_PUBLIC_SUPABASE_URL=<your_supabase_url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your_supabase_anon_key>

# agent/.env
AGENT_PRIVATE_KEY=<agent_wallet_private_key>
ARC_RPC_URL=https://rpc.arc.io
```

---

## 🤝 Contributing

Arc Calls is being built in public. Contributions, ideas, and feedback are welcome.

1. Fork the repo
2. Create your feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to the branch: `git push origin feat/your-feature`
5. Open a Pull Request

---

## 📄 License

MIT — see [LICENSE](LICENSE) for details.

---

<p align="center">Built on <strong>Arc by Circle</strong> — the Economic OS for the internet.</p>
