// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PollRegistry
 * @notice Arc Calls — Community Poll Registry on Arc Mainnet
 * @dev    Users submit poll ideas. Admin closes rounds with 3 winners.
 *         Deployed on Arc Mainnet — Chain ID: 5042
 */
contract PollRegistry {
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

    struct HistoryEntry {
        uint256 round;
        uint256 pollId;
        string  title;
        string  description;
        address submittedBy;
        uint256 voteCount;
        uint256 closedAt;
    }

    address public owner;

    address public constant ADMIN_ONE = 0x2e7497D98C8Cae22180773c92D07d96f4D42F8b6;
    address public constant ADMIN_TWO = 0xed3eb5A8adAee1954013468b5dBB6E36Aad93cd8;

    uint256 public currentRound = 1;
    uint256 private nextPollId  = 1;
    uint256 public totalPolls;

    mapping(uint256 => Poll)             private polls;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    uint256[]                            private activePollIds;
    HistoryEntry[]                       private history;

    event PollSubmitted(uint256 indexed pollId, address indexed submittedBy, string title, uint256 round, uint256 createdAt);
    event PollDeleted(uint256 indexed pollId);
    event Voted(uint256 indexed pollId, address indexed voter);
    event RoundClosed(uint256 indexed round, uint256[3] winnerIds);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

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

    constructor() {
        owner = msg.sender;
    }

    function submitPoll(string calldata _title, string calldata _description) external {
        require(bytes(_title).length > 0,       "Title required");
        require(bytes(_title).length <= 120,    "Title too long");
        require(bytes(_description).length > 0, "Description required");

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
        activePollIds.push(id);
        totalPolls++;

        emit PollSubmitted(id, msg.sender, _title, currentRound, block.timestamp);
    }

    function vote(uint256 pollId) external {
        Poll storage p = polls[pollId];
        require(p.createdAt > 0,            "Poll not found");
        require(!p.deleted,                 "Poll deleted");
        require(p.round == currentRound,    "Not current round");
        require(!hasVoted[pollId][msg.sender], "Already voted");

        hasVoted[pollId][msg.sender] = true;
        p.voteCount++;

        emit Voted(pollId, msg.sender);
    }

    function deletePoll(uint256 pollId) external onlyAdmin {
        Poll storage p = polls[pollId];
        require(p.createdAt > 0, "Poll not found");
        require(!p.deleted,      "Already deleted");
        p.deleted = true;
        emit PollDeleted(pollId);
    }

    function closeRound(uint256[3] calldata winnerIds) external onlyAdmin {
        for (uint256 w = 0; w < 3; w++) {
            Poll storage winner = polls[winnerIds[w]];
            require(winner.createdAt > 0, "Winner poll not found");
            history.push(HistoryEntry({
                round:       currentRound,
                pollId:      winnerIds[w],
                title:       winner.title,
                description: winner.description,
                submittedBy: winner.submittedBy,
                voteCount:   winner.voteCount,
                closedAt:    block.timestamp
            }));
        }
        emit RoundClosed(currentRound, winnerIds);
        currentRound++;
    }

    function getActivePolls() external view returns (Poll[] memory) {
        uint256 count = 0;
        for (uint256 i = 0; i < activePollIds.length; i++) {
            Poll storage p = polls[activePollIds[i]];
            if (!p.deleted && p.round == currentRound) count++;
        }
        Poll[] memory result = new Poll[](count);
        uint256 idx = 0;
        for (uint256 i = 0; i < activePollIds.length; i++) {
            Poll storage p = polls[activePollIds[i]];
            if (!p.deleted && p.round == currentRound) result[idx++] = p;
        }
        return result;
    }

    function getHistory() external view returns (HistoryEntry[] memory) {
        return history;
    }

    function transferOwnership(address newOwner) external onlyAdmin {
        require(newOwner != address(0), "Zero address");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }
}
