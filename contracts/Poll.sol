// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title Poll
 * @author kaicrypt00
 * @notice Community-driven prediction idea submission and on-chain voting for Arc Calls.
 *
 * @dev STATUS: Planned — interface and storage layout defined. Full voting and
 *      winner selection logic coming in next sprint.
 *
 * Flow:
 *  1. Anyone submits a prediction idea (pays small USDC anti-spam deposit)
 *  2. Community votes on-chain for ideas they want to see as Arc Calls
 *  3. Every 10 days: top 3 voted ideas are passed to BettingPool as new markets
 *  4. Idea submitters of winning ideas earn the BADGE_COMMUNITY_TOP badge
 */
contract Poll is Ownable {

    // ─────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────

    struct Idea {
        uint256 id;
        address submitter;
        string  title;
        string  description;
        uint256 votes;
        uint256 submittedAt;
        bool    promoted;    // true if selected as an Arc Call
        bool    exists;
    }

    struct Round {
        uint256 id;
        uint256 startTime;
        uint256 endTime;       // startTime + 10 days
        uint256[] ideaIds;     // ideas submitted in this round
        uint256[3] winners;    // top 3 idea IDs after round ends
        bool finalized;
    }

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    IERC20 public immutable USDC;

    mapping(uint256 => Idea) public ideas;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => bool)) public hasVoted; // ideaId => voter => voted

    uint256 public ideaCount;
    uint256 public roundCount;
    uint256 public currentRoundId;

    uint256 public constant ROUND_DURATION    = 10 days;
    uint256 public constant SUBMISSION_DEPOSIT = 1e6; // 1 USDC anti-spam deposit

    address public bettingPool; // BettingPool contract address — set after deploy

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event IdeaSubmitted(uint256 indexed ideaId, address indexed submitter, string title);
    event VoteCast(uint256 indexed ideaId, address indexed voter);
    event RoundStarted(uint256 indexed roundId, uint256 endTime);
    event RoundFinalized(uint256 indexed roundId, uint256[3] winners);
    event IdeaPromoted(uint256 indexed ideaId, uint256 marketId);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error RoundNotActive();
    error AlreadyVoted();
    error IdeaNotFound();
    error RoundAlreadyFinalized();
    error RoundNotOver();
    error NotAuthorized();

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor(address _usdc) Ownable(msg.sender) {
        USDC = IERC20(_usdc);
        _startNewRound();
    }

    // ─────────────────────────────────────────────────────────────
    // Submission
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Submit a new prediction idea for community voting.
     * @param _title       Short title of the prediction idea.
     * @param _description Full description and criteria.
     */
    function submitIdea(string calldata _title, string calldata _description) external returns (uint256) {
        Round storage round = rounds[currentRoundId];
        if (block.timestamp > round.endTime) revert RoundNotActive();

        // Anti-spam: charge 1 USDC deposit (refundable if selected — TODO)
        USDC.transferFrom(msg.sender, address(this), SUBMISSION_DEPOSIT);

        ideaCount++;
        ideas[ideaCount] = Idea({
            id:          ideaCount,
            submitter:   msg.sender,
            title:       _title,
            description: _description,
            votes:       0,
            submittedAt: block.timestamp,
            promoted:    false,
            exists:      true
        });

        round.ideaIds.push(ideaCount);

        emit IdeaSubmitted(ideaCount, msg.sender, _title);
        return ideaCount;
    }

    // ─────────────────────────────────────────────────────────────
    // Voting — TODO: full implementation
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Cast a vote for an idea in the current round.
     * @dev One vote per address per idea. No token cost — only USDC gas on Arc.
     *      Full sybil-resistance mechanism TBD.
     */
    function vote(uint256 _ideaId) external {
        if (!ideas[_ideaId].exists)      revert IdeaNotFound();
        if (hasVoted[_ideaId][msg.sender]) revert AlreadyVoted();

        Round storage round = rounds[currentRoundId];
        if (block.timestamp > round.endTime) revert RoundNotActive();

        hasVoted[_ideaId][msg.sender] = true;
        ideas[_ideaId].votes++;

        emit VoteCast(_ideaId, msg.sender);
    }

    // ─────────────────────────────────────────────────────────────
    // Round Finalization — TODO: sorting + BettingPool integration
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Finalize the current round, select top 3 ideas, and start a new round.
     * @dev Sorting logic and BettingPool.createMarket() calls are TODO.
     *      Only callable after round duration has passed.
     */
    function finalizeRound() external onlyOwner {
        Round storage round = rounds[currentRoundId];

        if (round.finalized)                    revert RoundAlreadyFinalized();
        if (block.timestamp < round.endTime)    revert RoundNotOver();

        // TODO: sort ideaIds by vote count and pick top 3
        // TODO: call BettingPool.createMarket() for each winner
        // TODO: award BADGE_COMMUNITY_TOP to top 3 submitters via Profile contract

        round.finalized = true;

        emit RoundFinalized(currentRoundId, round.winners);

        _startNewRound();
    }

    // ─────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────

    function _startNewRound() internal {
        roundCount++;
        currentRoundId = roundCount;

        uint256[3] memory emptyWinners;
        rounds[currentRoundId] = Round({
            id:        currentRoundId,
            startTime: block.timestamp,
            endTime:   block.timestamp + ROUND_DURATION,
            ideaIds:   new uint256[](0),
            winners:   emptyWinners,
            finalized: false
        });

        emit RoundStarted(currentRoundId, rounds[currentRoundId].endTime);
    }

    // ─────────────────────────────────────────────────────────────
    // Config
    // ─────────────────────────────────────────────────────────────

    function setBettingPool(address _pool) external onlyOwner {
        bettingPool = _pool;
    }

    // ─────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────

    function getCurrentRound() external view returns (Round memory) {
        return rounds[currentRoundId];
    }

    function getIdea(uint256 _ideaId) external view returns (Idea memory) {
        return ideas[_ideaId];
    }

    function getRoundIdeas(uint256 _roundId) external view returns (uint256[] memory) {
        return rounds[_roundId].ideaIds;
    }
}
