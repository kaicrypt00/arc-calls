// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BettingPool
 * @author kaicrypt00
 * @notice Core prediction market contract for Arc Calls.
 *         All stakes and payouts are denominated in USDC.
 *         Gas is paid in USDC natively on Arc (Circle's L1).
 *
 * @dev STATUS: In Progress — payout distribution and auto-resolution hooks pending.
 *
 * Flow:
 *  1. Owner (or Poll contract) creates a market
 *  2. Users stake USDC on YES or NO before deadline
 *  3. Resolver (AI agent wallet) calls resolve() with outcome
 *  4. Winners claim proportional USDC payout
 */
contract BettingPool is ReentrancyGuard, Ownable {

    // ─────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────

    enum Category { CommunityLore, Official }
    enum Outcome  { Unresolved, Yes, No, Cancelled }

    struct Market {
        uint256 id;
        string  title;
        string  description;
        Category category;
        uint256 deadline;        // unix timestamp — no bets accepted after this
        uint256 resolutionTime;  // when the market was resolved
        Outcome outcome;
        uint256 totalYes;        // total USDC staked on YES (6 decimals)
        uint256 totalNo;         // total USDC staked on NO  (6 decimals)
        address creator;
        bool    exists;
    }

    struct Position {
        uint256 yesStake;
        uint256 noStake;
        bool    claimed;
    }

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    IERC20 public immutable USDC;

    mapping(uint256 => Market) public markets;
    mapping(uint256 => mapping(address => Position)) public positions;
    mapping(address => bool) public authorizedResolvers;

    uint256 public marketCount;
    uint256 public protocolFeesBps = 200; // 2% protocol fee
    address public feeRecipient;

    uint256 public constant MIN_STAKE = 1e6;   // 1 USDC minimum
    uint256 public constant MAX_STAKE = 1e10;  // 10,000 USDC maximum per position

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event MarketCreated(uint256 indexed marketId, string title, Category category, uint256 deadline);
    event PositionTaken(uint256 indexed marketId, address indexed user, bool isYes, uint256 amount);
    event MarketResolved(uint256 indexed marketId, Outcome outcome);
    event WinningsClaimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event MarketCancelled(uint256 indexed marketId);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error MarketNotFound();
    error MarketAlreadyResolved();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error StakeTooLow();
    error StakeTooHigh();
    error NothingToClaim();
    error NotAuthorized();
    error TransferFailed();

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(address _usdc, address _feeRecipient) Ownable(msg.sender) {
        USDC = IERC20(_usdc);
        feeRecipient = _feeRecipient;
    }

    // ─────────────────────────────────────────────────────────────
    // Market Management
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Create a new prediction market.
     * @param _title       Short title of the prediction.
     * @param _description Full description and resolution criteria.
     * @param _category    CommunityLore (0) or Official (1).
     * @param _deadline    Unix timestamp after which no new bets are accepted.
     */
    function createMarket(
        string calldata _title,
        string calldata _description,
        Category _category,
        uint256 _deadline
    ) external onlyOwner returns (uint256) {
        require(_deadline > block.timestamp, "Deadline must be in the future");

        marketCount++;
        markets[marketCount] = Market({
            id:             marketCount,
            title:          _title,
            description:    _description,
            category:       _category,
            deadline:       _deadline,
            resolutionTime: 0,
            outcome:        Outcome.Unresolved,
            totalYes:       0,
            totalNo:        0,
            creator:        msg.sender,
            exists:         true
        });

        emit MarketCreated(marketCount, _title, _category, _deadline);
        return marketCount;
    }

    // ─────────────────────────────────────────────────────────────
    // Betting
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Stake USDC on a prediction outcome.
     * @param _marketId Market to bet on.
     * @param _isYes    True = YES, False = NO.
     * @param _amount   USDC amount (6 decimals).
     */
    function placeBet(
        uint256 _marketId,
        bool _isYes,
        uint256 _amount
    ) external nonReentrant {
        Market storage market = markets[_marketId];

        if (!market.exists)                        revert MarketNotFound();
        if (market.outcome != Outcome.Unresolved)  revert MarketAlreadyResolved();
        if (block.timestamp >= market.deadline)    revert DeadlinePassed();
        if (_amount < MIN_STAKE)                   revert StakeTooLow();
        if (_amount > MAX_STAKE)                   revert StakeTooHigh();

        bool success = USDC.transferFrom(msg.sender, address(this), _amount);
        if (!success) revert TransferFailed();

        Position storage pos = positions[_marketId][msg.sender];

        if (_isYes) {
            market.totalYes  += _amount;
            pos.yesStake     += _amount;
        } else {
            market.totalNo   += _amount;
            pos.noStake      += _amount;
        }

        emit PositionTaken(_marketId, msg.sender, _isYes, _amount);
    }

    // ─────────────────────────────────────────────────────────────
    // Resolution — TODO: hook into AI agent resolver
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Resolve a market with its final outcome.
     * @dev Only authorized resolvers (AI agent wallet) can call this.
     *      Payout distribution logic is under development.
     */
    function resolve(uint256 _marketId, Outcome _outcome) external {
        if (!authorizedResolvers[msg.sender] && msg.sender != owner()) revert NotAuthorized();

        Market storage market = markets[_marketId];
        if (!market.exists)                       revert MarketNotFound();
        if (market.outcome != Outcome.Unresolved) revert MarketAlreadyResolved();
        if (block.timestamp < market.deadline)    revert DeadlineNotPassed();

        market.outcome        = _outcome;
        market.resolutionTime = block.timestamp;

        emit MarketResolved(_marketId, _outcome);

        // TODO: trigger batch payout or allow individual claims
    }

    // ─────────────────────────────────────────────────────────────
    // Claims — WIP
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Claim USDC winnings from a resolved market.
     * @dev Proportional payout: winner's stake / total winning side * total pool (minus fee).
     *      Full implementation in progress.
     */
    function claimWinnings(uint256 _marketId) external nonReentrant {
        Market storage market = markets[_marketId];
        Position storage pos  = positions[_marketId][msg.sender];

        if (!market.exists)                       revert MarketNotFound();
        if (market.outcome == Outcome.Unresolved) revert DeadlineNotPassed();
        if (pos.claimed)                          revert NothingToClaim();

        pos.claimed = true;

        uint256 payout = _calculatePayout(_marketId, msg.sender);
        if (payout == 0) revert NothingToClaim();

        bool success = USDC.transfer(msg.sender, payout);
        if (!success) revert TransferFailed();

        emit WinningsClaimed(_marketId, msg.sender, payout);
    }

    /**
     * @dev Internal payout calculation.
     *      TODO: handle Cancelled outcome (return original stakes).
     */
    function _calculatePayout(uint256 _marketId, address _user) internal view returns (uint256) {
        Market storage market = markets[_marketId];
        Position storage pos  = positions[_marketId][_user];

        uint256 totalPool = market.totalYes + market.totalNo;
        uint256 fee       = (totalPool * protocolFeesBps) / 10000;
        uint256 netPool   = totalPool - fee;

        if (market.outcome == Outcome.Yes && pos.yesStake > 0) {
            return (pos.yesStake * netPool) / market.totalYes;
        }
        if (market.outcome == Outcome.No && pos.noStake > 0) {
            return (pos.noStake * netPool) / market.totalNo;
        }
        if (market.outcome == Outcome.Cancelled) {
            return pos.yesStake + pos.noStake; // full refund
        }

        return 0;
    }

    // ─────────────────────────────────────────────────────────────
    // Access Control
    // ─────────────────────────────────────────────────────────────

    function authorizeResolver(address _resolver) external onlyOwner {
        authorizedResolvers[_resolver] = true;
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        feeRecipient = _recipient;
    }

    function setProtocolFee(uint256 _bps) external onlyOwner {
        require(_bps <= 500, "Fee too high"); // max 5%
        protocolFeesBps = _bps;
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────

    function getMarket(uint256 _marketId) external view returns (Market memory) {
        return markets[_marketId];
    }

    function getPosition(uint256 _marketId, address _user) external view returns (Position memory) {
        return positions[_marketId][_user];
    }
}
