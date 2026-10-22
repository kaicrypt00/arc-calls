# Arc Calls — Product Requirements Document
### Build Instructions for Arc Studio

---

> ## 📋 READ THIS FIRST — BEFORE WRITING A SINGLE LINE OF CODE
>
> This PRD is the complete specification for **Arc Calls** — a fully-featured onchain prediction market platform built on Arc mainnet. Everything you need is in this document. Study it in full detail before doing anything.
>
> **Your job before building:**
> 1. Read this entire PRD from top to bottom without skipping anything
> 2. Understand every section — contracts, frontend pages, session wallet, agents, Supabase schema, design system, and deployment
> 3. Lock in the complete flow in your context before writing any code
> 4. If anything is unclear, ambiguous, or seems to conflict — **ask me first before building**. Do not guess. Do not assume. Ask.
>
> **GitHub repository:** `https://github.com/kaicrypt00/arc-calls`
> GitHub is already connected to Arc Studio. When you push code, it goes directly to this repo. All GitHub Actions secrets are already set — the agents will activate automatically once the workflow files are in the repo.
>
> **What this project is:** This is a complete rebrand and rebuild of an existing working prediction market dApp, ported from Ethereum Sepolia to Arc mainnet. The logic, pages, flows, and features are all proven and working — your job is to build the Arc-native version exactly as specified here. Do not invent new features. Do not change anything not specified. Build exactly what is written.
>
> **When you are done reading and have no concerns — confirm you have studied the full PRD, summarize the key systems you will build, and tell me your deployment plan for the contracts. Then wait for my go-ahead before starting.**

---

## Overview

Arc Calls is a community-driven prediction market platform built natively on Arc mainnet. Users stake USDC on YES or NO outcomes for real-world events, watch the pools fill in real time, and claim winnings when the market settles. The platform includes community polls where anyone can propose market ideas, an onchain badge system tied to activity, a live leaderboard, and an AI trading agent that places one bet daily using onchain reasoning. All bets and settlements move real USDC through smart contracts on Arc mainnet.

The stack is React (Vite) on the frontend, Supabase for off-chain storage and display caching, and three Solidity contracts deployed on Arc mainnet. Two off-chain agents run on GitHub Actions: one settles markets by monitoring X, and one places AI-driven bets daily.

---

## 1. Chain and Token Configuration

**Network:** Arc Mainnet only. No testnet. No network switching.
**Chain ID:** 5042
**RPC HTTP:** `https://rpc.mainnet.arc.io`
**RPC WS:** `wss://rpc.mainnet.arc.io`
**Explorer:** `https://explorer.arc.io`
**Currency:** USDC — it is both the gas token and the betting token.

**USDC Contract Address on Arc Mainnet:** `0x3600000000000000000000000000000000000000`

This is the native USDC of Arc. It uses **6 decimal places** for token math and display. Never use 18 decimals for USDC amounts in pool math, bet amounts, or UI display. The native gas layer uses 18 decimals internally — this is separate and does not affect betting math.

**Gas:** Every transaction costs approximately $0.001 USDC. Always set `maxFeePerGas` to at least 20 Gwei. Use `baseFee * 2n` as a safe value. Show gas fees in USDC in UI, never in Gwei.

**No ETH anywhere.** There is no ETH on Arc. All references to ETH in old code must be replaced with USDC. The session wallet holds USDC for gas and USDC for betting — same balance, one asset.

---

## 2. Smart Contracts

Arc Studio must write, test, and deploy three contracts. All contract logic below is the exact specification. Do not deviate from these function signatures, modifiers, or storage structures.

---

### 2.1 ProfileRegistry

**Purpose:** One profile per wallet. Minting costs a gas fee only — the mint fee is paid in USDC (as gas). No separate fee transfer required from the user beyond gas. The profile stores name, bio, pfp hash (IPFS CID), and X username.

**Owner / Admin:** `0x2e7497d98c8cae22180773c92d07d96f4d42f8b6`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title ProfileRegistry
 * @notice Arc Calls — Community Prediction Platform on Arc Mainnet
 * @dev One profile per wallet. Gas fee only — no ETH/USDC fee transfer.
 *      Profile data: name, bio, pfpHash (IPFS CID), xUsername.
 *      Deployed on Arc Mainnet — Chain ID: 5042
 */
contract ProfileRegistry {

    address public owner;

    struct Profile {
        string  name;
        string  bio;
        string  pfpHash;
        string  xUsername;
        uint256 mintedAt;
        bool    exists;
    }

    mapping(address => Profile) private profiles;
    address[] private profileAddresses;

    event ProfileMinted(address indexed wallet, string name, string xUsername, uint256 timestamp);
    event ProfileUpdated(address indexed wallet, string name, string bio, string pfpHash, string xUsername);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier profileExists(address wallet) {
        require(profiles[wallet].exists, "Profile not found");
        _;
    }

    modifier noProfileYet() {
        require(!profiles[msg.sender].exists, "Profile already exists");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function mintProfile(
        string calldata _name,
        string calldata _bio,
        string calldata _pfpHash,
        string calldata _xUsername
    ) external noProfileYet {
        require(bytes(_name).length > 0,         "Name required");
        require(bytes(_name).length <= 50,       "Name too long");
        require(bytes(_bio).length <= 160,       "Bio too long");
        require(bytes(_xUsername).length > 0,    "X username required");
        require(bytes(_xUsername).length <= 15,  "X username too long");

        profiles[msg.sender] = Profile({
            name:      _name,
            bio:       _bio,
            pfpHash:   _pfpHash,
            xUsername: _xUsername,
            mintedAt:  block.timestamp,
            exists:    true
        });

        profileAddresses.push(msg.sender);
        emit ProfileMinted(msg.sender, _name, _xUsername, block.timestamp);
    }

    function updateProfile(
        string calldata _name,
        string calldata _bio,
        string calldata _pfpHash,
        string calldata _xUsername
    ) external profileExists(msg.sender) {
        require(bytes(_name).length > 0,         "Name required");
        require(bytes(_name).length <= 50,       "Name too long");
        require(bytes(_bio).length <= 160,       "Bio too long");
        require(bytes(_xUsername).length > 0,    "X username required");
        require(bytes(_xUsername).length <= 15,  "X username too long");

        Profile storage p = profiles[msg.sender];
        p.name      = _name;
        p.bio       = _bio;
        p.pfpHash   = _pfpHash;
        p.xUsername = _xUsername;

        emit ProfileUpdated(msg.sender, _name, _bio, _pfpHash, _xUsername);
    }

    function getProfile(address wallet)
        external view profileExists(wallet)
        returns (string memory name, string memory bio, string memory pfpHash, string memory xUsername, uint256 mintedAt)
    {
        Profile storage p = profiles[wallet];
        return (p.name, p.bio, p.pfpHash, p.xUsername, p.mintedAt);
    }

    function hasProfile(address wallet) external view returns (bool) {
        return profiles[wallet].exists;
    }

    function totalProfiles() external view returns (uint256) {
        return profileAddresses.length;
    }

    function getAllAddresses() external view returns (address[] memory) {
        return profileAddresses;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
```

> **Note on mint fee:** In the original version, `mintProfile` was payable with 0.001 ETH. On Arc, profile minting is gas-only. Remove the payable modifier and the fee requirement. The user pays only the USDC gas cost of the transaction. Same for badge minting below.

---

### 2.2 BettingPool

**Purpose:** Admin creates prediction markets. Users bet USDC on YES or NO. Winners split the losing pool proportionally. 5-minute lockout before deadline. Admin can also manually lock/unlock.

**Admins:** Both addresses below are admins — either can create, settle, lock, delete, refund, extend deadline.
- `0x2e7497d98c8cae22180773c92d07d96f4d42f8b6`
- `0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8`

**Betting token:** USDC at `0x3600000000000000000000000000000000000000`

**Minimum bet:** 0.1 USDC (expressed as `100_000` since USDC has 6 decimals on Arc — 0.1 × 10^6 = 100,000). This replaces the old 10 RLO minimum.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title BettingPool
 * @notice Arc Calls — Community Prediction Platform on Arc Mainnet
 * @dev    Admin creates predictions. Users bet YES or NO with USDC (6 decimals).
 *         Winners split the losing pool proportionally by bet size.
 *         5-minute lockout before deadline enforced onchain.
 *         Empty side = full refund to all bettors.
 *         Deployed on Arc Mainnet — Chain ID: 5042
 */
contract BettingPool {

    uint256 public constant MIN_BET        = 100_000;    // 0.1 USDC (6 decimals — 0.1 * 10**6)
    uint256 public constant LOCKOUT_PERIOD = 5 minutes;

    enum Side   { NONE, YES, NO }
    enum Status { OPEN, LOCKED, YES_WINS, NO_WINS, REFUNDED, DELETED }

    struct Prediction {
        uint256 id;
        string  title;
        string  description;
        string  bannerUrl;
        uint256 deadline;
        Status  status;
        uint256 yesPool;
        uint256 noPool;
        uint256 totalBettors;
        uint256 createdAt;
    }

    struct Bet {
        Side    side;
        uint256 amount;
        bool    claimed;
    }

    address public owner;
    IERC20  public immutable usdcToken;

    address public constant ADMIN_ONE = 0x2e7497d98c8cae22180773c92d07d96f4d42f8b6;
    address public constant ADMIN_TWO = 0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8;

    uint256 private nextId = 1;

    mapping(uint256 => Prediction)              public  predictions;
    mapping(uint256 => mapping(address => Bet)) private bets;
    mapping(uint256 => address[])               private bettors;
    uint256[]                                   private allIds;
    mapping(address => uint256)                 public  betCount;

    event PredictionCreated(uint256 indexed id, string title, uint256 deadline, uint256 createdAt);
    event PredictionDeleted(uint256 indexed id);
    event PredictionRefunded(uint256 indexed id);
    event BettingLocked(uint256 indexed id, uint256 lockedAt);
    event BettingUnlocked(uint256 indexed id, uint256 unlockedAt);
    event DeadlineExtended(uint256 indexed id, uint256 newDeadline);
    event BetPlaced(uint256 indexed predictionId, address indexed bettor, Side side, uint256 amount);
    event WinnerDeclared(uint256 indexed predictionId, Side winningSide, uint256 winningPool, uint256 losingPool);
    event WinningsClaimed(uint256 indexed predictionId, address indexed bettor, uint256 amount);
    event RefundClaimed(uint256 indexed predictionId, address indexed bettor, uint256 amount);

    modifier onlyAdmin() {
        require(
            msg.sender == owner     ||
            msg.sender == ADMIN_ONE ||
            msg.sender == ADMIN_TWO,
            "Not admin"
        );
        _;
    }

    modifier predictionExists(uint256 id) {
        require(predictions[id].createdAt > 0, "Prediction not found");
        _;
    }

    modifier notDeleted(uint256 id) {
        require(predictions[id].status != Status.DELETED, "Prediction deleted");
        _;
    }

    constructor(address _usdcToken) {
        require(_usdcToken != address(0), "Invalid USDC address");
        owner     = msg.sender;
        usdcToken = IERC20(_usdcToken);
    }

    function createPrediction(
        string calldata _title,
        string calldata _description,
        string calldata _bannerUrl,
        uint256 _deadline
    ) external onlyAdmin {
        require(bytes(_title).length > 0,       "Title required");
        require(bytes(_title).length <= 120,    "Title too long");
        require(bytes(_description).length > 0, "Description required");
        require(
            _deadline > block.timestamp + LOCKOUT_PERIOD + 1 minutes,
            "Deadline too soon"
        );

        uint256 id = nextId++;

        predictions[id] = Prediction({
            id:           id,
            title:        _title,
            description:  _description,
            bannerUrl:    _bannerUrl,
            deadline:     _deadline,
            status:       Status.OPEN,
            yesPool:      0,
            noPool:       0,
            totalBettors: 0,
            createdAt:    block.timestamp
        });

        allIds.push(id);
        emit PredictionCreated(id, _title, _deadline, block.timestamp);
    }

    function deletePrediction(uint256 id)
        external onlyAdmin predictionExists(id) notDeleted(id)
    {
        Prediction storage p = predictions[id];
        if (p.yesPool > 0 || p.noPool > 0) {
            p.status = Status.REFUNDED;
        } else {
            p.status = Status.DELETED;
        }
        emit PredictionDeleted(id);
    }

    function refundPrediction(uint256 id)
        external onlyAdmin predictionExists(id) notDeleted(id)
    {
        Prediction storage p = predictions[id];
        require(
            p.status == Status.OPEN || p.status == Status.LOCKED,
            "Already settled"
        );
        p.status = Status.REFUNDED;
        emit PredictionRefunded(id);
    }

    function extendDeadline(uint256 id, uint256 newDeadline)
        external onlyAdmin predictionExists(id) notDeleted(id)
    {
        Prediction storage p = predictions[id];
        require(
            p.status == Status.OPEN || p.status == Status.LOCKED,
            "Already settled"
        );
        require(newDeadline > p.deadline,      "Must be later than current");
        require(newDeadline > block.timestamp, "Must be in the future");
        p.deadline = newDeadline;
        emit DeadlineExtended(id, newDeadline);
    }

    function lockBetting(uint256 id)
        external onlyAdmin predictionExists(id) notDeleted(id)
    {
        Prediction storage p = predictions[id];
        require(p.status == Status.OPEN, "Can only lock an open prediction");
        p.status = Status.LOCKED;
        emit BettingLocked(id, block.timestamp);
    }

    function unlockBetting(uint256 id)
        external onlyAdmin predictionExists(id) notDeleted(id)
    {
        Prediction storage p = predictions[id];
        require(p.status == Status.LOCKED, "Can only unlock a locked prediction");
        p.status = Status.OPEN;
        emit BettingUnlocked(id, block.timestamp);
    }

    function declareWinner(uint256 id, Side winningSide)
        external onlyAdmin predictionExists(id) notDeleted(id)
    {
        require(
            winningSide == Side.YES || winningSide == Side.NO,
            "Invalid side"
        );
        Prediction storage p = predictions[id];
        require(
            p.status == Status.OPEN || p.status == Status.LOCKED,
            "Already settled"
        );
        if (p.status == Status.OPEN) {
            require(block.timestamp >= p.deadline, "Deadline not reached");
        }
        if (p.yesPool == 0 || p.noPool == 0) {
            p.status = Status.REFUNDED;
            emit PredictionRefunded(id);
            return;
        }
        if (winningSide == Side.YES) {
            p.status = Status.YES_WINS;
        } else {
            p.status = Status.NO_WINS;
        }
        emit WinnerDeclared(
            id, winningSide,
            winningSide == Side.YES ? p.yesPool : p.noPool,
            winningSide == Side.YES ? p.noPool  : p.yesPool
        );
    }

    function placeBet(uint256 id, Side side, uint256 amount)
        external predictionExists(id) notDeleted(id)
    {
        require(side == Side.YES || side == Side.NO,   "Invalid side");
        require(amount >= MIN_BET,                      "Below minimum 0.1 USDC");
        Prediction storage p = predictions[id];
        require(p.status == Status.OPEN,                "Prediction not open");
        require(
            block.timestamp < p.deadline - LOCKOUT_PERIOD,
            "Bets are locked"
        );
        require(
            bets[id][msg.sender].side == Side.NONE,
            "Already placed a bet"
        );
        bool received = usdcToken.transferFrom(msg.sender, address(this), amount);
        require(received, "USDC transfer failed - check approval");
        bets[id][msg.sender] = Bet({ side: side, amount: amount, claimed: false });
        bettors[id].push(msg.sender);
        p.totalBettors++;
        betCount[msg.sender]++;
        if (side == Side.YES) { p.yesPool += amount; }
        else                  { p.noPool  += amount; }
        emit BetPlaced(id, msg.sender, side, amount);
    }

    function claimWinnings(uint256 id)
        external predictionExists(id) notDeleted(id)
    {
        Prediction storage p = predictions[id];
        require(
            p.status == Status.YES_WINS || p.status == Status.NO_WINS,
            "Not settled yet"
        );
        Bet storage b = bets[id][msg.sender];
        require(b.side != Side.NONE, "No bet placed");
        require(!b.claimed,          "Already claimed");
        Side winningSide = p.status == Status.YES_WINS ? Side.YES : Side.NO;
        require(b.side == winningSide, "You are on the losing side");
        uint256 winningPool = winningSide == Side.YES ? p.yesPool : p.noPool;
        uint256 totalPool   = p.yesPool + p.noPool;
        uint256 payout      = (b.amount * totalPool) / winningPool;
        b.claimed = true;
        bool sent = usdcToken.transfer(msg.sender, payout);
        require(sent, "USDC transfer failed");
        emit WinningsClaimed(id, msg.sender, payout);
    }

    function claimRefund(uint256 id) external predictionExists(id) {
        Prediction storage p = predictions[id];
        require(
            p.status == Status.REFUNDED || p.status == Status.DELETED,
            "Not refunded"
        );
        Bet storage b = bets[id][msg.sender];
        require(b.side != Side.NONE, "No bet placed");
        require(!b.claimed,          "Already claimed");
        uint256 amount = b.amount;
        b.claimed = true;
        bool sent = usdcToken.transfer(msg.sender, amount);
        require(sent, "USDC refund failed");
        emit RefundClaimed(id, msg.sender, amount);
    }

    function getPrediction(uint256 id)
        external view predictionExists(id)
        returns (Prediction memory)
    {
        return predictions[id];
    }

    function getUserBet(uint256 id, address user)
        external view
        returns (Side side, uint256 amount, bool claimed)
    {
        Bet storage b = bets[id][user];
        return (b.side, b.amount, b.claimed);
    }

    function isBettingLocked(uint256 id)
        external view predictionExists(id)
        returns (bool)
    {
        Prediction storage p = predictions[id];
        if (p.status != Status.OPEN) return true;
        return block.timestamp >= p.deadline - LOCKOUT_PERIOD;
    }

    function getAllIds() external view returns (uint256[] memory) { return allIds; }
    function totalPredictions() external view returns (uint256) { return allIds.length; }
    function getBetCount(address user) external view returns (uint256) { return betCount[user]; }

    function getBettors(uint256 id)
        external view predictionExists(id)
        returns (address[] memory)
    {
        return bettors[id];
    }

    function getClaimableAmount(uint256 id, address user)
        external view predictionExists(id)
        returns (uint256)
    {
        Prediction storage p = predictions[id];
        if (p.status != Status.YES_WINS && p.status != Status.NO_WINS) return 0;
        Bet storage b = bets[id][user];
        if (b.side == Side.NONE || b.claimed) return 0;
        Side winningSide = p.status == Status.YES_WINS ? Side.YES : Side.NO;
        if (b.side != winningSide) return 0;
        uint256 winningPool = winningSide == Side.YES ? p.yesPool : p.noPool;
        uint256 totalPool   = p.yesPool + p.noPool;
        return (b.amount * totalPool) / winningPool;
    }

    function transferOwnership(address newOwner) external onlyAdmin {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
```

---

### 2.3 AchievementRegistry

**Purpose:** Four onchain badges tied to bet activity. Minting a badge costs gas only — no USDC fee beyond gas. The badge registry reads bet count from the BettingPool. One badge per tier per wallet.

**Badges:**
- Starter: 1 bet
- Caller: 10 bets
- Oracle: 100 bets
- OG: 500 bets

**Admins:** Same as BettingPool — `0x2e7497d98c8cae22180773c92d07d96f4d42f8b6` and `0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IBettingPool {
    function getBetCount(address user) external view returns (uint256);
}

/**
 * @title AchievementRegistry
 * @notice Arc Calls — Community Prediction Platform on Arc Mainnet
 * @dev Four achievement badges mintable onchain. Gas fee only.
 *        Starter: 1 bet | Caller: 10 bets | Oracle: 100 bets | OG: 500 bets
 *      Deployed on Arc Mainnet — Chain ID: 5042
 */
contract AchievementRegistry {

    uint256 public constant STARTER_THRESHOLD = 1;
    uint256 public constant CALLER_THRESHOLD  = 10;
    uint256 public constant ORACLE_THRESHOLD  = 100;
    uint256 public constant OG_THRESHOLD      = 500;

    enum Badge { STARTER, CALLER, ORACLE, OG }

    struct BadgeRecord {
        bool    minted;
        uint256 mintedAt;
        uint256 mintedAtBet;
    }

    address public owner;
    address public bettingPool;

    address public constant ADMIN_ONE = 0x2e7497d98c8cae22180773c92d07d96f4d42f8b6;
    address public constant ADMIN_TWO = 0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8;

    mapping(address => mapping(Badge => BadgeRecord)) private badges;
    mapping(address => uint256) public badgeCount;

    uint256 public totalBadgesMinted;

    event BadgeMinted(
        address indexed wallet,
        Badge   indexed badge,
        string  badgeName,
        uint256 betCountAtMint,
        uint256 timestamp
    );
    event BettingPoolUpdated(address indexed oldPool, address indexed newPool);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyAdmin() {
        require(
            msg.sender == owner     ||
            msg.sender == ADMIN_ONE ||
            msg.sender == ADMIN_TWO,
            "Not admin"
        );
        _;
    }

    constructor(address _bettingPool) {
        owner       = msg.sender;
        bettingPool = _bettingPool;
    }

    function mintBadge(Badge badge) external {
        require(!badges[msg.sender][badge].minted, "Badge already minted");

        uint256 betCountVal = IBettingPool(bettingPool).getBetCount(msg.sender);
        uint256 threshold   = _getThreshold(badge);
        require(betCountVal >= threshold, _getInsufficientMsg(badge));

        badges[msg.sender][badge] = BadgeRecord({
            minted:      true,
            mintedAt:    block.timestamp,
            mintedAtBet: betCountVal
        });

        badgeCount[msg.sender]++;
        totalBadgesMinted++;

        emit BadgeMinted(msg.sender, badge, _getBadgeName(badge), betCountVal, block.timestamp);
    }

    function hasBadge(address wallet, Badge badge) external view returns (bool) {
        return badges[wallet][badge].minted;
    }

    function getBadgeRecord(address wallet, Badge badge)
        external view
        returns (bool minted, uint256 mintedAt, uint256 mintedAtBet)
    {
        BadgeRecord storage b = badges[wallet][badge];
        return (b.minted, b.mintedAt, b.mintedAtBet);
    }

    function getAllBadges(address wallet)
        external view
        returns (bool starter, bool caller, bool oracle, bool og)
    {
        return (
            badges[wallet][Badge.STARTER].minted,
            badges[wallet][Badge.CALLER].minted,
            badges[wallet][Badge.ORACLE].minted,
            badges[wallet][Badge.OG].minted
        );
    }

    function getEligibleBadges(address wallet)
        external view
        returns (uint256[] memory eligible)
    {
        uint256 betCountVal = IBettingPool(bettingPool).getBetCount(wallet);
        uint256 count = 0;
        if (betCountVal >= STARTER_THRESHOLD && !badges[wallet][Badge.STARTER].minted) count++;
        if (betCountVal >= CALLER_THRESHOLD  && !badges[wallet][Badge.CALLER].minted)  count++;
        if (betCountVal >= ORACLE_THRESHOLD  && !badges[wallet][Badge.ORACLE].minted)  count++;
        if (betCountVal >= OG_THRESHOLD      && !badges[wallet][Badge.OG].minted)      count++;

        eligible = new uint256[](count);
        uint256 idx = 0;
        if (betCountVal >= STARTER_THRESHOLD && !badges[wallet][Badge.STARTER].minted) eligible[idx++] = 0;
        if (betCountVal >= CALLER_THRESHOLD  && !badges[wallet][Badge.CALLER].minted)  eligible[idx++] = 1;
        if (betCountVal >= ORACLE_THRESHOLD  && !badges[wallet][Badge.ORACLE].minted)  eligible[idx++] = 2;
        if (betCountVal >= OG_THRESHOLD      && !badges[wallet][Badge.OG].minted)      eligible[idx++] = 3;

        return eligible;
    }

    function getBetCount(address wallet) external view returns (uint256) {
        return IBettingPool(bettingPool).getBetCount(wallet);
    }

    function getBadgeName(Badge badge) external pure returns (string memory) {
        return _getBadgeName(badge);
    }

    function getThreshold(Badge badge) external pure returns (uint256) {
        return _getThreshold(badge);
    }

    function setBettingPool(address newPool) external onlyAdmin {
        require(newPool != address(0), "Zero address");
        emit BettingPoolUpdated(bettingPool, newPool);
        bettingPool = newPool;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    function _getThreshold(Badge badge) internal pure returns (uint256) {
        if (badge == Badge.STARTER) return STARTER_THRESHOLD;
        if (badge == Badge.CALLER)  return CALLER_THRESHOLD;
        if (badge == Badge.ORACLE)  return ORACLE_THRESHOLD;
        if (badge == Badge.OG)      return OG_THRESHOLD;
        revert("Invalid badge");
    }

    function _getBadgeName(Badge badge) internal pure returns (string memory) {
        if (badge == Badge.STARTER) return "Starter";
        if (badge == Badge.CALLER)  return "Caller";
        if (badge == Badge.ORACLE)  return "Oracle";
        if (badge == Badge.OG)      return "OG";
        revert("Invalid badge");
    }

    function _getInsufficientMsg(Badge badge) internal pure returns (string memory) {
        if (badge == Badge.STARTER) return "Place 1 bet to unlock Starter";
        if (badge == Badge.CALLER)  return "Place 10 bets to unlock Caller";
        if (badge == Badge.ORACLE)  return "Place 100 bets to unlock Oracle";
        if (badge == Badge.OG)      return "Place 500 bets to unlock OG";
        revert("Invalid badge");
    }
}
```

---

### 2.4 PollRegistry

**Purpose:** Users submit prediction ideas (polls). Community votes. Admin picks 3 winners per round and closes it. Fully onchain.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title PollRegistry
 * @notice Arc Calls — Community Poll System on Arc Mainnet
 * @dev    Users submit bet ideas. Community votes. Admin picks 3 winners per round.
 *         Fully onchain. Session wallet signs user transactions.
 *         Deployed on Arc Mainnet — Chain ID: 5042
 */
contract PollRegistry {

    address public owner;
    address public constant ADMIN_ONE = 0x2e7497d98c8cae22180773c92d07d96f4d42f8b6;
    address public constant ADMIN_TWO = 0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8;

    uint256 private nextPollId = 1;
    uint256 public currentRound = 1;
    uint256 public totalPolls;

    struct Poll {
        uint256 id;
        string  title;
        string  description;
        address submittedBy;
        uint256 voteCount;
        uint256 round;
        bool    deleted;
        uint256 createdAt;
    }

    struct RoundWinner {
        uint256 round;
        uint256 pollId;
        string  title;
        string  description;
        address submittedBy;
        uint256 voteCount;
        uint256 closedAt;
    }

    mapping(uint256 => Poll)                      public polls;
    mapping(uint256 => mapping(address => bool))  public hasVoted;
    mapping(uint256 => uint256[])                 private roundPollIds;
    RoundWinner[]                                 private history;

    event PollSubmitted(uint256 indexed pollId, address indexed submittedBy, string title, uint256 round, uint256 createdAt);
    event Voted(uint256 indexed pollId, address indexed voter, uint256 newVoteCount);
    event PollDeleted(uint256 indexed pollId, uint256 round);
    event RoundClosed(uint256 indexed round, uint256[3] winnerIds, uint256 closedAt);

    modifier onlyAdmin() {
        require(
            msg.sender == owner     ||
            msg.sender == ADMIN_ONE ||
            msg.sender == ADMIN_TWO,
            "Not admin"
        );
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function submitPoll(
        string calldata _title,
        string calldata _description
    ) external {
        require(bytes(_title).length > 0,          "Title required");
        require(bytes(_title).length <= 120,       "Title too long");
        require(bytes(_description).length <= 500, "Description too long");

        uint256 id = nextPollId++;

        polls[id] = Poll({
            id:          id,
            title:       _title,
            description: _description,
            submittedBy: msg.sender,
            voteCount:   0,
            round:       currentRound,
            deleted:     false,
            createdAt:   block.timestamp
        });

        roundPollIds[currentRound].push(id);
        totalPolls++;

        emit PollSubmitted(id, msg.sender, _title, currentRound, block.timestamp);
    }

    function vote(uint256 pollId) external {
        Poll storage p = polls[pollId];
        require(p.id != 0,                        "Poll not found");
        require(p.round == currentRound,           "Not in current round");
        require(!p.deleted,                        "Poll deleted");
        require(!hasVoted[pollId][msg.sender],     "Already voted");

        hasVoted[pollId][msg.sender] = true;
        p.voteCount++;

        emit Voted(pollId, msg.sender, p.voteCount);
    }

    function deletePoll(uint256 pollId) external onlyAdmin {
        Poll storage p = polls[pollId];
        require(p.id != 0,   "Poll not found");
        require(!p.deleted,  "Already deleted");
        p.deleted = true;
        emit PollDeleted(pollId, p.round);
    }

    function closeRound(uint256[3] calldata winnerIds) external onlyAdmin {
        for (uint i = 0; i < 3; i++) {
            Poll storage w = polls[winnerIds[i]];
            require(w.id != 0,               "Winner not found");
            require(w.round == currentRound, "Winner not in current round");
            require(!w.deleted,              "Winner is deleted");

            history.push(RoundWinner({
                round:       currentRound,
                pollId:      winnerIds[i],
                title:       w.title,
                description: w.description,
                submittedBy: w.submittedBy,
                voteCount:   w.voteCount,
                closedAt:    block.timestamp
            }));
        }

        emit RoundClosed(currentRound, winnerIds, block.timestamp);
        currentRound++;
    }

    function getActivePolls() external view returns (Poll[] memory) {
        uint256[] storage ids = roundPollIds[currentRound];
        uint256 count = 0;
        for (uint i = 0; i < ids.length; i++) {
            if (!polls[ids[i]].deleted) count++;
        }
        Poll[] memory result = new Poll[](count);
        uint256 idx = 0;
        for (uint i = 0; i < ids.length; i++) {
            if (!polls[ids[i]].deleted) result[idx++] = polls[ids[i]];
        }
        return result;
    }

    function getHistory() external view returns (RoundWinner[] memory) {
        return history;
    }

    function getPoll(uint256 pollId) external view returns (Poll memory) {
        return polls[pollId];
    }

    function getActivePollCount() external view returns (uint256) {
        uint256[] storage ids = roundPollIds[currentRound];
        uint256 count = 0;
        for (uint i = 0; i < ids.length; i++) {
            if (!polls[ids[i]].deleted) count++;
        }
        return count;
    }

    function getRoundPollIds(uint256 round) external view returns (uint256[] memory) {
        return roundPollIds[round];
    }

    function transferOwnership(address newOwner) external onlyAdmin {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }
}
```

---

## 3. Contract Addresses

After Arc Studio deploys these contracts to Arc mainnet, fill in the addresses here and use them throughout the app. Placeholder names used below — replace with real addresses after deployment.

```
CONTRACT_ADDRESSES = {
  USDC:                 '0x3600000000000000000000000000000000000000',  // native Arc USDC — never changes
  PROFILE_REGISTRY:     '<deployed address>',
  BETTING_POOL:         '<deployed address>',
  ACHIEVEMENT_REGISTRY: '<deployed address>',
  POLL_REGISTRY:        '<deployed address>',
}
```

```
ADMIN_WALLETS = [
  '0x2e7497d98c8cae22180773c92d07d96f4d42f8b6',
  '0xed3eb5a8adaee1954013468b5dbb6e36aad93cd8',
]
```

---

## 4. Frontend Tech Stack

- **Framework:** React + Vite
- **Routing:** React Router v6
- **Chain integration:** viem + wagmi v2
- **Wallet UI:** RainbowKit with a custom Arc-themed color override
- **Database:** Supabase (JS client)
- **Styling:** Vanilla CSS — no Tailwind

### wagmi / chain config

```javascript
// src/config/wagmi.js
import { createConfig, http } from 'wagmi'
import { defineChain } from 'viem'
import { injected, walletConnect } from 'wagmi/connectors'

export const arc = defineChain({
  id: 5042,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.arc.io'] },
  },
  blockExplorers: {
    default: { name: 'Arc Explorer', url: 'https://explorer.arc.io' },
  },
})

export const config = createConfig({
  chains: [arc],
  connectors: [
    injected(),
    walletConnect({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID }),
  ],
  transports: {
    [arc.id]: http('https://rpc.mainnet.arc.io'),
  },
})

export const EXPLORER_URL = 'https://explorer.arc.io'
```

> **Note:** Arc is already in viem/chains as `import { arc } from 'viem/chains'`. If that import works, prefer it. Otherwise define it manually as above.

### RainbowKit theme (Arc colors)

```javascript
const arcTheme = darkTheme({
  accentColor: '#E4E8EC',
  accentColorForeground: '#011029',
  borderRadius: 'small',
  fontStack: 'system',
  overlayBlur: 'small',
})
arcTheme.colors.connectButtonBackground = '#011029'
arcTheme.colors.connectButtonText = '#E4E8EC'
arcTheme.colors.modalBackground = '#011029'
arcTheme.colors.modalBorder = 'rgba(228,232,236,0.12)'
arcTheme.colors.profileForeground = '#011029'
arcTheme.colors.selectedOptionBorder = 'rgba(228,232,236,0.3)'
```

---

## 5. Color System & Design Tokens

Arc Calls uses the Arc brand palette. The primary background is near-black (`#011029`). Accent colors are steel blue and light grey-white. No cream colors anywhere — those belong to the old brand.

```css
:root {
  /* Backgrounds */
  --bg-primary:    #011029;
  --bg-secondary:  #062a51;
  --bg-card:       rgba(6, 42, 81, 0.6);
  --bg-glass:      rgba(6, 42, 81, 0.4);

  /* Text */
  --text-primary:   #E4E8EC;
  --text-secondary: #8E9FB0;
  --text-tertiary:  #4a5a6a;

  /* Accents */
  --accent-primary:  #E4E8EC;
  --accent-blue:     #366184;
  --accent-bright:   #5a8ab0;
  --accent-muted:    #B4BFC9;

  /* Status */
  --yes-color:    #4ade80;
  --no-color:     #f87171;
  --pending:      #fbbf24;
  --danger:       #ef4444;
  --success:      #22c55e;

  /* Borders */
  --border-subtle:  rgba(228, 232, 236, 0.08);
  --border-default: rgba(228, 232, 236, 0.15);
  --border-strong:  rgba(228, 232, 236, 0.25);

  /* Gold for special accents */
  --gold: #B4BFC9;
}
```

**Typography:**
- Display font: Inter or similar, weight 700, loaded from Google Fonts
- Body font: Inter, weight 400/500
- Mono font: JetBrains Mono or similar, for addresses and numbers

**Visual effects to include throughout:**
- Floating particle background (same as current — tiny dots/stars drifting slowly on the dark background)
- Glass morphism cards with `backdrop-filter: blur(20px)` and subtle border
- Navbar bottom sweep glow — a thin gradient line that glows below the navbar
- Hover effects on all cards — subtle lift (`translateY(-4px)`) and glow intensification
- Smooth CSS transitions on everything interactive (200ms ease)
- CTA button shimmer animation on landing page — a white gradient sweeping left to right
- Skeleton loading states for all async data — pulsing grey blocks

---

## 6. Supabase Configuration

**Project URL:** Set via `VITE_SUPABASE_URL` env var
**Anon Key:** Set via `VITE_SUPABASE_ANON_KEY` env var
**Publishable key (for reference):** `sb_publishable_nNHXP-5BH3fnfK0RwroZMw_YTCUiTDv`

The Supabase database schema matches exactly what the existing database has. Do not rename tables. The same 10 tables:

### `profiles`
Mirrors the on-chain ProfileRegistry. Populated by backend after a successful `mintProfile` call.
```
id                uuid (PK)
wallet_address    text (unique, lowercase)
name              text
bio               text
pfp_url           text          -- full URL resolved from IPFS hash
x_username        text
minted_at         timestamptz
created_at        timestamptz
```

### `leaderboard`
One row per participating wallet. Updated after every settled bet.
```
id               uuid (PK)
wallet_address   text (unique, lowercase)
name             text
pfp_url          text
total_calls      integer       -- total bets placed
wins             integer
losses           integer
win_rate         numeric       -- 0.0 to 1.0
total_pnl        numeric       -- net USDC gain/loss (6 decimals display)
total_volume     numeric       -- total USDC bet
is_agent         boolean       -- true for the AI trading agent
updated_at       timestamptz
```

### `predictions_display`
Denormalized cache of on-chain prediction data for fast UI reads.
```
id               integer (PK — matches on-chain prediction id)
title            text
description      text
banner_url       text
deadline         timestamptz
no_deadline      boolean       -- true for open-ended predictions
status           text          -- open | locked | yes_wins | no_wins | refunded | deleted
yes_pool         numeric       -- USDC amount, 6-decimal display value
no_pool          numeric
total_bettors    integer
created_at       timestamptz
x_monitor        jsonb         -- X resolver config (null if not monitored)
```

### `bets`
One row per bet placed.
```
id               uuid (PK)
prediction_id    integer       -- FK to predictions_display.id
wallet_address   text (lowercase)
side             text          -- YES | NO
amount           numeric       -- USDC amount (6-decimal display)
result           text          -- pending | won | lost | refunded
payout           numeric       -- USDC received (0 until settled)
tx_hash          text
created_at       timestamptz
```

### `polls`
Active and past polls — synced from on-chain PollRegistry.
```
id               integer (PK — on-chain poll id)
title            text
description      text
submitted_by     text (wallet address, lowercase)
vote_count       integer
round            integer
deleted          boolean
created_at       timestamptz
```

### `poll_votes`
Tracks who voted on what — synced from on-chain events.
```
id               uuid (PK)
poll_id          integer
voter_address    text (lowercase)
created_at       timestamptz
```

### `poll_history`
Closed rounds and their winners.
```
id               uuid (PK)
round            integer
poll_id          integer
title            text
description      text
submitted_by     text
vote_count       integer
closed_at        timestamptz
```

### `wallet_transactions`
Session wallet activity log for the wallet history panel.
```
id               uuid (PK)
wallet_address   text (lowercase)
type             text          -- bet | claim | refund | poll_submit | vote | deposit | withdrawal | profile_creation | admin_action
label            text          -- human-readable description
amount           numeric       -- USDC amount if applicable (null otherwise)
tx_hash          text
created_at       timestamptz
```

### `templates`
Saved prediction templates for the admin create form.
```
id               uuid (PK)
name             text
title            text
description      text
banner_url       text
created_at       timestamptz
```

### `x_monitor_logs`
Audit log of every X resolver check run.
```
id               uuid (PK)
prediction_id    integer
handle           text
condition_type   text
current_value    text
threshold        text
triggered        boolean
action_taken     text
error            text
raw_data         jsonb
created_at       timestamptz
```

---

## 7. App Architecture

### 7.1 Provider Tree (main.jsx)

Wrap in this exact order, outer to inner:
```
WagmiProvider
  QueryClientProvider
    RainbowKitProvider (arcTheme)
      BrowserRouter
        ToastProvider
          SessionWalletProvider
            DataPrefetchProvider
              ProfileProvider
                SoundProvider
                  App
```

### 7.2 Routes (App.jsx)

```
/              →  LandingPage
/calls         →  CallsPage
/leaderboard   →  LeaderboardPage
/profile       →  ProfilePage
/admin         →  AdminPage (AdminGuard — admin wallets only)
*              →  redirect to /
```

No faucet page. The old `/faucet` route is removed. There is no token faucet because Arc Calls uses real USDC on mainnet.

### 7.3 Global Components (always mounted)
- `ParticleBackground` — floating star particles, fixed position, renders behind everything
- `NavbarSweepGlow` — a `div.navbar-sweep-glow` fixed at the bottom of the navbar, a thin animated gradient line
- `AppLoader` — branded loading screen that covers the page until `appInitialized` is true
- `MintProfileModal` — undismissable modal, shown when connected wallet has no profile
- `CallsGuide` — lazy-loaded help drawer, always in the tree

---

## 8. Session Wallet System

This is one of the most important systems in the app. It must work exactly as described.

**What it is:** When a user connects their main wallet (MetaMask, Rainbow, etc.), they can activate an Arc Calls Wallet — a secondary wallet derived deterministically from a signature of their main wallet. This session wallet holds USDC for gas and USDC for betting. Users deposit USDC into it and bet directly from it without MetaMask popups on every transaction.

**Why it exists:** Prediction market UX dies if every bet requires a MetaMask popup. The session wallet signs transactions silently in the background using a private key stored in localStorage (encrypted by derivation from the user's signature).

**How it works:**

1. User connects main wallet → sees "Activate Arc Calls Wallet" button in the navbar
2. User clicks → app calls `signMessageAsync({ message: SIGN_MESSAGE })` on their main wallet
3. App derives session private key: `keccak256(signature)` 
4. Stores in localStorage keyed by main wallet address: `ac_sw_<mainAddress>`
5. Creates a viem `WalletClient` with this private key pointed at Arc mainnet
6. Session wallet is ready — all bets, poll submissions, and votes are signed by the session wallet

**SIGN_MESSAGE text** (exactly this, word for word):
```
Arc Calls: Activate your Arc Calls Wallet.

This creates a secure session wallet for seamless betting without transaction popups.

This signature is deterministic and costs no gas. Your main wallet funds and assets cannot be accessed through this signature.
```

**Balance display:** The session wallet holds USDC. Display it as USDC with 6 decimals. Label: "USDC · Gas & Betting". There is no separate gas token. USDC is the gas.

**Wallet UI — Arc Calls Wallet dropdown pill (shown in navbar when session wallet is active):**

The pill shows: colored dot indicator + USDC balance + "USDC" label + chevron

When clicked, opens a dropdown panel (300px wide, dark glass) containing:
- Header: "Arc Calls Wallet" label + refresh button
- Address row: truncated address (0x1234...5678) + Copy button + Send button
- Send USDC panel (toggles on Send click): recipient address input + amount input + Send button — calls USDC `transfer()` directly
- Balance section: two rows
  - Row 1: "USDC · Gas & Betting" — shows USDC balance (6 decimals, formatted)
  - Row 2: "USDC on Arc" — the same balance (USDC is the single asset, but two rows for clarity of purpose)
- Recent Activity: last 10 transactions from `wallet_transactions` table — type icon + label + timestamp + amount

**Deposit flow:** There must be a visible "Deposit" button (or section) in the wallet dropdown or profile page that shows the session wallet address with a QR code-style display and instructions: "Send USDC on Arc to this address to top up your Arc Calls Wallet."

**Withdraw flow:** The Send panel in the wallet dropdown serves as withdrawal — user can send USDC from session wallet to any address.

---

## 9. Pages and Components

### 9.1 LandingPage (`/`)

Full-screen hero page. No navbar — uses its own minimal nav with just the logo and a connect button.

**Layout:**
- Fixed top navbar: Arc Calls logo (left) + Music toggle button + RainbowKit connect button (right)
- Main content centered vertically
- Particle background active

**Content (top to bottom):**
1. Large headline: `Arc Calls` — gradient text from white to `#E4E8EC`, `clamp(52px, 10vw, 96px)`, Inter 700, `letter-spacing: -2px`
2. Sub-headline: `Where the Community Calls What Happens Next` — `#8E9FB0`, `clamp(18px, 3vw, 28px)`
3. Description paragraph: "Arc Calls is a community prediction platform on Arc mainnet. Stake USDC, forecast outcomes, and earn in the ultimate onchain arena." — muted grey, max-width 560px
4. CTA button: `ENTER THE ARENA` — dark background (`#062a51`), light text (`#E4E8EC`), 18px, uppercase, rounded corners, shimmer animation sweeping left to right, pulse shadow animation, scales up 8% on hover
5. Live stats card: glass-morphism card with two columns separated by a vertical gradient line
   - Left: number of Active Markets (from `predictions_display` count where status in `open`, `locked`)
   - Right: number of Total Callers (from `leaderboard` count)
   - Both numbers in mono font, large size, `#E4E8EC` color
   - Labels: "Active Markets" and "Total Callers" in uppercase mono

When user is connected and clicks CTA → navigate to `/calls`

---

### 9.2 CallsPage (`/calls`)

Main prediction markets page. This is where users browse markets and place bets.

**Layout:**
- Navbar at top
- Ticker strip (scrolling recent bets feed) below navbar
- Content area below ticker:
  - Stats bar: X Active · Y Settled · Z Total
  - Tab switcher: Active | Settled | Community Polls
  - Card grid (2 columns on desktop, 1 on mobile)
- Footer at bottom

**Tab: Active**
Shows predictions where status is `open` or `locked`. Sorted by deadline ascending. Each market is a `PredictionCard`.

**Tab: Settled**
Shows predictions where status is `yes_wins`, `no_wins`, or `refunded`. Sorted by most recently settled. Uses `SettledTab` component.

**Tab: Community Polls**
Shows `PollTab` — the poll submission and voting UI.

---

### 9.3 PredictionCard Component

One card per prediction market. This is the core interactive element of the app.

**Visual structure (top to bottom):**
1. Banner image (if `banner_url` exists) — full-width, 180px tall, `object-fit: cover`, soft rounded top corners
2. Status badge — top-right overlay on banner: `OPEN` (green), `LOCKED` (amber), `YES WINS` (green), `NO WINS` (red), `REFUNDED` (grey)
3. Title — bold, 16-18px, white
4. Description — 13px, muted grey, 2 lines max with ellipsis
5. Pool bars — visual odds display:
   - YES bar: green, width proportional to yes pool %
   - NO bar: red, width proportional to no pool %
   - Shows percentages and USDC totals on each bar
6. Stats row: total bettors count + deadline countdown (or "No deadline")
7. **Bet panel** (when status is OPEN and betting not locked):
   - YES button and NO button — toggle selection
   - Amount input: number input in USDC, min 0.1 USDC
   - Quick amount chips: +0.5, +1, +5, +10
   - Potential payout calculation shown live as user types
   - `Place Bet` button — disabled if no side selected, amount invalid, or pending
   - Shows user's current bet if they already have one (side + amount)
8. **Claim button** (when status is YES_WINS or NO_WINS and user is on winning side):
   - Shows claimable amount in USDC
   - `Claim USDC` button — triggers `claimWinnings` on contract
9. **Refund button** (when status is REFUNDED and user has a bet):
   - `Claim Refund` button — triggers `claimRefund` on contract
10. Explorer link — "View on Arc Explorer" → links to contract tx or prediction on explorer

**Bet flow:**
1. User selects YES or NO
2. User enters USDC amount (min 0.1 USDC = 100,000 in 6-decimal raw format)
3. App checks session wallet USDC allowance for BettingPool contract
4. If allowance < amount: call `approve(BETTING_POOL, MAX_UINT256)` first
5. Call `placeBet(id, side, parseUnits(amount, 6))` — always use `parseUnits(amount, 6)` for the raw value
6. Wait for tx receipt (Arc finalizes in under 1 second — show simple "confirming..." state)
7. Record bet in Supabase `bets` table
8. Update `predictions_display` pool amounts
9. Record in `wallet_transactions`
10. Show success toast with explorer link
11. Reload card data

**Key Arc-specific detail:** Arc has sub-second finality. Do not show long "waiting for confirmations" UI. Show a brief "confirming..." spinner, then immediately show success when the receipt arrives. One confirmation is final.

---

### 9.4 Ticker Component

A horizontal scrolling bar below the navbar showing the most recent bets in real time. Auto-scrolls left continuously. Each item shows: "🎯 @username bet X USDC on YES — Market Title". Pulls from Supabase `bets` table joined with `profiles` and `predictions_display`. Updates every 30 seconds.

---

### 9.5 Navbar Component

Fixed top, 64px height, dark glass background (`rgba(1, 16, 41, 0.95)`), `backdrop-filter: blur(20px)`, bottom border `rgba(228, 232, 236, 0.15)`.

**Left:** Arc Calls logo (SVG icon or image file) + "Arc Calls" text in display font

**Center links:**
- Markets → `/calls`
- Leaderboard → `/leaderboard`
- Profile → `/profile`
- Admin → `/admin` (only visible to admin wallets — check against ADMIN_WALLETS array)

Active link has bottom underline or background highlight in arc blue.

**Right side (states):**

State 1 — Not connected:
- RainbowKit `<ConnectButton>` — label "Connect Wallet", no balance shown, no chain status

State 2 — Connected, no session wallet:
- "Activate Arc Calls Wallet" button — dark blue background, light text, click triggers `createSessionWallet()`
- While `isCreating` is true → show "Activating..." disabled state

State 3 — Session wallet active, no profile:
- Arc Calls Wallet pill (USDC balance)
- "Set Up Profile" button

State 4 — Fully onboarded (session wallet + profile):
- Arc Calls Wallet pill
- Profile pill — avatar + username, click navigates to `/profile`

**Wrong network banner:** If user's main wallet is on wrong chain, show a banner below the navbar: "⚠ Switch to Arc to continue" + Switch Network button.

---

### 9.6 Footer Component

Simple footer with two sections:

**Left:** "Built on Arc"

**Right links:**
- Arc → `https://www.arc.io/`
- Arc X → `https://x.com/arc`
- Arc Studio → `https://studio.arc.io/`
- Arc Community → `https://community.arc.io/home`

Each link opens in new tab. Color: `#4a5a6a` default, `#E4E8EC` on hover, smooth 200ms transition.

---

### 9.7 ProfilePage (`/profile`)

Shows the connected user's profile, stats, bet history, and badges.

**Top section:**
- Profile avatar (from IPFS hash) — 80px circle with blue glow
- Name — bold, large
- Bio — muted text
- X username with link to their Twitter profile
- Copy wallet address button
- Edit Profile button (opens EditProfileModal)
- Disconnect button

**Stats row (4 cards):**
- Total Calls (bets placed)
- Wins
- Win Rate (percentage)
- P&L (USDC — positive green, negative red)

**Tabs:**
- My Calls — paginated list of their bets. Each row: market title + side + amount + status + result + payout. Click shows explorer link.
- Badges — the BadgesTab component

**BadgesTab:**
Shows 4 badge slots: Starter, Caller, Oracle, OG. Each badge shows:
- Badge name and icon
- Required bet threshold
- Lock/unlock state based on their bet count
- If eligible but not minted: "Mint Badge" button → calls `mintBadge(badgeIndex)` on AchievementRegistry contract
- If minted: shows "MINTED" with timestamp
- Gas fee note: "Gas only (paid in USDC)"

---

### 9.8 LeaderboardPage (`/leaderboard`)

**Layout:**
- Navbar + Footer
- Header: "Leaderboard" title + subtitle "The top callers on Arc"
- Stats bar: total players + total volume in USDC
- Table of leaderboard entries

**Table columns:**
- Rank (#1, #2, ...)
- Player (avatar + name + address truncated)
- Total Calls
- Wins
- Win Rate (%)
- Volume (USDC)
- P&L (USDC — colored green/red)
- AI tag badge for the agent row

Data from `leaderboard` table ordered by `total_calls DESC`. Top 3 have gold/silver/bronze visual treatment. The AI agent row has a distinctive "BOT" badge.

---

### 9.9 AdminPage (`/admin`)

Only accessible to admin wallets. Protected by AdminGuard.

Three tabs:

**Tab 1: Predictions**

Left column:
- Templates section — saved templates from Supabase. Click to load into create form.
- Create Prediction form with fields:
  - Title (text, max 120 chars, shows char count)
  - Description (textarea)
  - Banner URL (optional)
  - Deadline — date/time picker OR toggle for "No deadline" (uses year 2099 timestamp)
  - X Monitor toggle — when enabled, shows sub-form with:
    - X Handle (e.g. @elonmusk)
    - Condition type dropdown: follower_count | tweet_count | new_post | pfp_change | verification_change | next_tweet_views | next_tweet_likes | next_tweet_reposts | next_tweet_replies | post_views | post_likes | post_reposts | post_replies
    - Threshold value (required for count conditions)
    - Tweet URL (required for post_ conditions)
  - Submit button → calls `createPrediction()` on contract, then inserts row in `predictions_display` and optionally upserts to `templates`

Right column:
- Manage Predictions table — all predictions listed with:
  - ID, title, status, pool sizes, deadline
  - Action buttons per prediction:
    - Lock Betting / Unlock Betting
    - Declare YES Wins / Declare NO Wins
    - Refund
    - Delete
    - Extend Deadline (shows date input)
  - All buttons call the corresponding contract functions then sync Supabase

**Tab 2: Poll Management**

- Active polls list from `polls` table — all polls in current round, vote counts, submitted by, delete button
- Round history from `poll_history` — all closed rounds with their 3 winners each
- Close Round button — shows a form where admin picks the 3 winning poll IDs, then calls `closeRound()` on contract

**Tab 3: Resolver**

- Shows `x_monitor_logs` — a table of all recent X resolver check runs
- Columns: prediction ID + title, handle, condition type, current value, threshold, triggered (yes/no), action taken, timestamp
- Helps admin debug why a prediction did or did not lock

---

### 9.10 MintProfileModal

A full-screen undismissable modal shown to any connected wallet that does not have a profile. Cannot be closed — user must mint a profile to proceed.

**Form fields:**
- Display Name (required, max 50 chars)
- Bio (optional, max 160 chars)
- Profile Picture — file upload → uploads to Supabase Storage → stores the public URL as pfpHash in contract. If no upload, use a default avatar.
- X Username (required, @ prefix stripped, max 15 chars)

**Submit:**
1. Upload image to Supabase Storage if provided
2. Call `mintProfile(name, bio, ipfsHashOrUrl, xUsername)` on ProfileRegistry
3. Insert row in Supabase `profiles` table
4. Insert row in Supabase `leaderboard` table with initial zeroes
5. Show success state
6. Modal closes, app continues

**Note:** No ETH/USDC fee required beyond gas. The old 0.001 ETH fee is gone.

---

### 9.11 AppLoader

A branded loading screen shown from app mount until wagmi, contracts, and Supabase are all initialized. Shows Arc Calls logo + pulsing animation. Once `appInitialized = true`, fades out.

---

### 9.12 CallsGuide

A lazily loaded help/guide drawer. Can be opened from a help button. Contains instructions explaining how prediction markets work, how the session wallet works, how to deposit USDC, and how to claim winnings.

---

### 9.13 ParticleBackground

Fixed-position canvas covering the entire page background. Renders ~80 tiny white particles (3px max size) floating slowly in random directions. Slight opacity variation (0.2 to 0.6). Never blocks pointer events. Uses `requestAnimationFrame`. The background color underneath is `#011029`.

---

### 9.14 PollTab Component

Shown under the "Community Polls" tab on `/calls`.

**Two sub-sections:**

1. **Active Polls** (from `getActivePolls()` on PollRegistry):
   - Each poll card shows: title, description, submitter address (truncated), vote count
   - Vote button — calls `vote(pollId)` on contract via session wallet
   - Shows "Already voted" state if user has voted
   - Polls sorted by vote count descending

2. **Submit Idea** form (below the polls):
   - Title input (max 120 chars)
   - Description textarea (max 500 chars)
   - Submit button → calls `submitPoll(title, description)` on contract
   - Only accessible when session wallet is active

**Poll history** (accordion below):
- Shows previous rounds from `poll_history` — round number, 3 winning polls per round, vote counts

---

### 9.15 SettledTab Component

Shows settled predictions (yes_wins, no_wins, refunded status).

Each settled market card shows:
- Title + final result badge
- Final pool split (YES total vs NO total in USDC)
- Winner side highlighted
- "You won X USDC" or "You lost X USDC" for the connected user if they had a bet
- Claim button if unclaimed winnings exist

---

## 10. Session Wallet Context

This context provides session wallet state and methods to all components.

**State:**
- `sessionWallet` — `{ client: WalletClient, address: string, account: Account }` or null
- `hasSessionWallet` — boolean
- `isCreating` — boolean
- `usdcBalance` — formatted string (e.g. "12.50")
- `isLoadingBalances` — boolean

**Methods:**
- `createSessionWallet()` — signs message, derives key, creates wallet, saves to localStorage, dispatches `arc:session-wallet-ready` event
- `clearSessionWallet()` — removes from localStorage, resets state
- `loadBalances()` — reads USDC balance of session wallet via `publicClient.readContract({ functionName: 'balanceOf' })`
- `ensureUSDCApproval(wallet)` — checks USDC allowance for BettingPool, approves MAX_UINT256 if below threshold

**Arc-specific:** USDC has 6 decimals. Use `parseUnits(amount, 6)` and `formatUnits(balance, 6)` for all USDC math.

**Auto-refresh:** Balance refreshes every 15 seconds via `setInterval` when session wallet is active.

**localStorage key:** `ac_sw_<mainWalletAddressLowercase>` (prefix changed from `rc_sw_` to `ac_sw_`)

---

## 11. Profile Context

Manages the profile state for the connected wallet.

**State:**
- `profile` — profile data object from Supabase or null
- `showMintModal` — boolean
- `navState` — 1 (not connected), 2 (connected, no profile), 3 (connected, has profile)
- `appInitialized` — boolean — true once wagmi, session wallet detection, and profile check are all complete

**On session wallet ready:** Reads `hasProfile(sessionWalletAddress)` from ProfileRegistry on-chain. If false and user is connected → set `showMintModal = true`.

---

## 12. Data Prefetch Context

Warms the data cache during browser idle time after `appInitialized`.

**Prefetches:**
- `predictions_display` — all active predictions
- `leaderboard` — top 50 entries
- `polls` — active polls for current round
- `poll_history` — last 3 rounds of history

Stores results in localStorage with a 5-minute TTL. Components read from cache first, then refetch in background.

---

## 13. Toast Context

Global toast notification system (no page reloads, no alerts).

**Three toast types:**
- `showPending(message)` — amber spinner + message, persists until dismissed or replaced
- `showConfirmed(txHash, message)` — green checkmark + message + explorer link
- `showFailed(error)` — red X + error message

Toasts appear in bottom-right corner, slide in, auto-dismiss after 5 seconds.

---

## 14. Sound Context

Background music and sound effects toggle. Music is ambient/lo-fi. Plays when user interacts. Toggle button in landing page and potentially in navbar.

Sound effects:
- `playClaimSound()` — plays on successful claim or bet

---

## 15. Off-Chain Agents

### 15.1 AI Trading Agent (agent/agent.js)

Runs on GitHub Actions, triggered daily at 8AM UTC via cron.

**What it does:**
1. Checks its USDC balance on Arc mainnet
2. Fetches open markets from Supabase
3. Filters out markets it has already bet on
4. Picks 1 market (earliest deadline first)
5. Calls an AI API to get a YES or NO decision
6. Approves USDC for BettingPool if needed
7. Places 0.1 USDC bet on the decided side
8. Records the bet in Supabase

**Agent wallet:** `0x50f7067035972795fc9970be26a6489b10065343` — has 2 USDC on Arc mainnet to start. Fund this address with USDC on Arc to keep it running.

**Config:**
```javascript
const BET_AMOUNT_USDC = '0.1'       // 0.1 USDC per bet (matches contract MIN_BET)
const BETS_PER_RUN   = 1
const RPC_URL        = 'https://rpc.mainnet.arc.io'
const CHAIN_ID       = 5042
```

**USDC amounts:** Use `parseUnits('0.1', 6)` for 0.1 USDC = `100_000n`. The contract's `MIN_BET` is `100_000` (0.1 × 10^6).

**Environment variables (GitHub Secrets):**
- `AGENT_PRIVATE_KEY` — private key of the agent wallet
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- AI API key if needed

**No RLO token.** Remove all RLO references. Remove the faucet claim logic. The agent funds itself with USDC directly deposited to its wallet.

**Balance check:** If USDC balance < `BET_AMOUNT * BETS_PER_RUN`, log a warning and exit gracefully.

**AI decision:** The AI prompt and fallback heuristic logic stays the same. Replace OpenRouter/Latch calls with whatever AI API is available, or keep Latch if available.

**Supabase recording:** After a successful bet, record:
- In `bets` table (same fields)
- In `leaderboard` table (upsert)
- In `wallet_transactions` (type: 'bet')
- Update pool totals in `predictions_display`

**Agent leaderboard entry:**
```javascript
name: 'Arc Agent 001',
pfp_url: '<agent avatar image URL>',
is_agent: true,
```

---

### 15.2 X Resolver Agent (agents/x-resolver.js)

Runs on GitHub Actions every hour via cron.

**What it does:**
Monitors X (Twitter) accounts for conditions set on predictions. When a condition triggers, it calls `lockBetting(id)` on the BettingPool contract to lock the market.

**Environment variables:**
- `RESOLVER_ADMIN_KEY` — private key of one of the admin wallets
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

**Arc mainnet config:**
```javascript
const RPC_URL  = 'https://rpc.mainnet.arc.io'
const CHAIN_ID = 5042
```

Replace all Sepolia references with Arc mainnet. Replace `sepolia` chain import with the Arc chain definition.

**Condition types supported** (same as before — no changes needed):
- `follower_count` — triggers when follower count >= threshold
- `tweet_count` — triggers when tweet count >= threshold
- `new_post` — triggers when handle posts a new tweet after activation
- `pfp_change` — triggers when profile picture changes
- `verification_change` — triggers when verification status changes
- `next_tweet_views` / `next_tweet_likes` / `next_tweet_reposts` / `next_tweet_replies` — triggers on metrics of the next tweet after activation
- `post_views` / `post_likes` / `post_reposts` / `post_replies` — triggers on metrics of a specific tweet by URL

**X monitor config** stored in `predictions_display.x_monitor` JSONB column:
```json
{
  "handle": "username",
  "condition_type": "follower_count",
  "threshold": "100000",
  "tweet_id": null,
  "last_tweet_id": null,
  "last_pfp_url": null,
  "last_verified": null,
  "activation_timestamp": 1700000000,
  "tracking_tweet_id": null
}
```

When triggered: call `lockBetting(predictionId)` on BettingPool via admin wallet on Arc mainnet. Log result to `x_monitor_logs` table.

**Rate limiting:** 1.5 second delay between X API calls. Uses fxtwitter (no Twitter API key needed).

---

## 16. GitHub Actions Workflows

### `.github/workflows/agent.yml`
```yaml
name: Arc Calls Agent
on:
  schedule:
    - cron: '0 8 * * *'  # 8AM UTC daily
  workflow_dispatch:

jobs:
  agent:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
        working-directory: ./agent
      - run: node agent.js
        working-directory: ./agent
        env:
          AGENT_PRIVATE_KEY: ${{ secrets.AGENT_PRIVATE_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

### `.github/workflows/x-resolver.yml`
```yaml
name: X Resolver
on:
  schedule:
    - cron: '0 * * * *'  # every hour
  workflow_dispatch:

jobs:
  resolver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install
        working-directory: ./agents
      - run: node x-resolver.js
        working-directory: ./agents
        env:
          RESOLVER_ADMIN_KEY: ${{ secrets.RESOLVER_ADMIN_KEY }}
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_ANON_KEY: ${{ secrets.SUPABASE_ANON_KEY }}
```

---

## 17. Environment Variables

### Frontend (`.env`)
```
VITE_SUPABASE_URL=https://zxmfdvzkmeybujoowzgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp4bWZkdnprbWV5YnVqb293emdoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NDQ2ODEsImV4cCI6MjEwODIyMDY4MX0.a_eF330HCBRRb2XYexu_JJjrnE7l6rQBcpEvXbxLCYM
VITE_WALLETCONNECT_PROJECT_ID=0331a65ac151cee7bf56526470cdf3af
VITE_PROFILE_REGISTRY_ADDRESS=<deployed after Arc Studio deploy>
VITE_BETTING_POOL_ADDRESS=<deployed after Arc Studio deploy>
VITE_ACHIEVEMENT_REGISTRY_ADDRESS=<deployed after Arc Studio deploy>
VITE_POLL_REGISTRY_ADDRESS=<deployed after Arc Studio deploy>
```

### Agents (GitHub Secrets — already configured in https://github.com/kaicrypt00/arc-calls)
```
AGENT_PRIVATE_KEY          ✅ set — private key of 0x50f7067035972795fc9970be26a6489b10065343
RESOLVER_ADMIN_KEY         ✅ set — private key of admin wallet
SUPABASE_URL               ✅ set — https://zxmfdvzkmeybujoowzgh.supabase.co
SUPABASE_SERVICE_ROLE_KEY  ✅ set
SUPABASE_ANON_KEY          ✅ set
```

All 5 GitHub secrets are already live. The only values added after deployment are the
contract addresses — Arc Studio will provide these after deploying to Arc mainnet.
Add them to Vercel environment variables (not GitHub Secrets) once you have them.

---

## 18. Key Technical Details for Arc

These are the places where Arc differs from Ethereum. Every single one must be handled correctly.

### USDC Decimals
USDC on Arc uses 6 decimals for token operations (ERC-20 interface). Never use 18 decimals for USDC amounts in bets, pool math, or display. Use `parseUnits(amount, 6)` and `formatUnits(raw, 6)`.

Example — place a 5 USDC bet:
```javascript
const amount = parseUnits('5', 6)  // = 5_000_000n
await sessionWallet.client.writeContract({
  address: BETTING_POOL,
  abi: BETTING_POOL_ABI,
  functionName: 'placeBet',
  args: [BigInt(predictionId), 1n, amount],  // 1 = YES
  maxFeePerGas: baseFee * 2n,
})
```

### Gas — mandatory 20 Gwei minimum
Always set `maxFeePerGas` to at least 20 Gwei on every transaction. Below 20 Gwei = silently dropped, no receipt.
```javascript
const feeData = await publicClient.estimateFeesPerGas()
const maxFeePerGas = feeData.maxFeePerGas < parseGwei('20')
  ? parseGwei('20')
  : feeData.maxFeePerGas
```

### Single confirmation = final
Arc has sub-second deterministic finality. After `waitForTransactionReceipt` returns, the tx is permanent. Show a brief spinner, then immediately show success. Do not count confirmations. Do not add confirmation delays.

### USDC approval before first bet
Before `placeBet`, the session wallet must have approved the BettingPool to spend its USDC. Do this silently on session wallet creation and before any bet:
```javascript
const MAX_UINT256 = 2n ** 256n - 1n
await sessionWallet.client.writeContract({
  address: USDC_ADDRESS,
  abi: ERC20_ABI,
  functionName: 'approve',
  args: [BETTING_POOL, MAX_UINT256],
  maxFeePerGas: ...,
})
```

### Balance display
USDC balance from `balanceOf()` is in 6 decimals. Display as:
```javascript
parseFloat(formatUnits(balance, 6)).toFixed(2)  // "12.50"
```

### USDC is gas and betting token
The session wallet needs USDC for both gas fees and betting. Deposit instructions must make this clear. One address, one asset, two uses.

### No PREVRANDAO
If any random number logic exists, do not use `block.prevrandao` — it returns 0 on Arc. Replace with deterministic logic or VRF.

---

## 19. Naming Conventions

Every string, label, variable name, and comment that previously said "Rialo", "RLO", "rialocalls", or "Rialo Calls" must now say "Arc", "USDC", "arc-calls", or "Arc Calls" respectively. This is a full rebrand. Do not leave any old brand name in the code.

**Specific substitutions:**
- "Rialo Calls" → "Arc Calls"
- "RLO" → "USDC"
- "Rialo" → "Arc"
- "rialocalls" (in URLs or keys) → "arc-calls"
- "RialoBot" → "ArcBot"
- "Rialo Calls Wallet" → "Arc Calls Wallet"
- `rc_sw_` (localStorage prefix) → `ac_sw_`
- `rc_` (any other prefix) → `ac_`
- `rialo-symbol.png` (logo file) → `arc-logo.png` (a simple Arc-branded logo)
- `rialo:session-wallet-ready` (custom event) → `arc:session-wallet-ready`
- `rialo-bet-placed` (custom event) → `arc-bet-placed`
- "Built on Rialo" → "Built on Arc"
- "Arena" is fine to keep — it fits Arc Calls too

---

## 20. What NOT to Build

- No faucet page — removed entirely. Arc Calls runs on mainnet with real USDC.
- No RLO token — does not exist. All token references use USDC.
- No testnet toggle or network switching to anything other than Arc mainnet.
- No "coming soon" pages.
- No placeholder designs — everything shown must be functional.

---

## 21. GitHub Repository

**Repository:** https://github.com/kaicrypt00/arc-calls

GitHub is already connected to Arc Studio. Arc Studio will push the generated code directly
to this repository. All 5 GitHub Actions secrets are already set and live:
- `AGENT_PRIVATE_KEY` ✅
- `RESOLVER_ADMIN_KEY` ✅
- `SUPABASE_URL` ✅
- `SUPABASE_SERVICE_ROLE_KEY` ✅
- `SUPABASE_ANON_KEY` ✅

The GitHub Actions workflows (agent + x-resolver) will activate automatically once
the workflow YAML files are pushed to the repo by Arc Studio. No manual steps needed
for the agents after that — they run on their own schedule.

---

## 22. Deployment

Deploy frontend to Vercel. The `vercel.json` should include SPA fallback routing:
```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/" }]
}
```

Set environment variables in the Vercel dashboard (not in the repo):
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_WALLETCONNECT_PROJECT_ID`
- All `VITE_*_ADDRESS` values (contract addresses after deployment)

---

## 23. Contract Deployment Order

Deploy in this order — each contract may depend on the previous:

1. **ProfileRegistry** — no dependencies
2. **BettingPool** — constructor takes USDC address: `0x3600000000000000000000000000000000000000`
3. **AchievementRegistry** — constructor takes BettingPool address
4. **PollRegistry** — no dependencies

After deployment, update all address constants in the frontend and agents.

---

## 24. Design Summary

Arc Calls looks and feels like a premium, institutional-grade prediction platform. The aesthetic is:

- **Dark navy** background (`#011029`) — not black, navy. Arc's brand color.
- **Steel blue** accents (`#366184`, `#062a51`) for cards and panels
- **Light grey-white** (`#E4E8EC`) for primary text and interactive elements
- **Glass morphism** everywhere — cards float above the background with blur and transparency
- **Particle starfield** — the space aesthetic that makes the background feel alive
- **Micro-animations** — every hover, click, and state change has a smooth transition
- **Monospace numbers** — all token amounts, pool sizes, and stats use a monospace font
- **No clutter** — clean layouts with generous whitespace, max 2 columns on desktop
- **Mobile first** — every page works on a phone screen

The overall feel should suggest: "this is where serious prediction happens on the next generation of financial infrastructure."

---

*End of Arc Calls Product Requirements Document*
