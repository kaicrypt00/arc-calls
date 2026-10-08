// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Profile
 * @author kaicrypt00
 * @notice Manages on-chain user profiles and achievement badges for Arc Calls.
 * @dev Profiles are stored on-chain and linked to wallet addresses.
 *      Achievement badges are ERC-1155 NFTs minted by the contract owner (or authorized minters).
 */
contract Profile is ERC1155, Ownable {

    // ─────────────────────────────────────────────────────────────
    // Types
    // ─────────────────────────────────────────────────────────────

    struct UserProfile {
        string username;
        string avatarCID;       // IPFS CID for avatar image
        uint256 totalBets;
        uint256 correctBets;
        uint256 totalWinnings;  // in USDC (6 decimals)
        uint256 createdAt;
        bool exists;
    }

    struct Badge {
        string name;
        string description;
        string imageCID;
        bool active;
    }

    // ─────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────

    mapping(address => UserProfile) public profiles;
    mapping(uint256 => Badge) public badges;
    mapping(address => bool) public authorizedMinters;

    uint256 public badgeCount;
    uint256 public totalUsers;

    // Badge IDs (predefined)
    uint256 public constant BADGE_FIRST_CALL    = 1; // Placed first ever prediction
    uint256 public constant BADGE_CORRECT_3     = 2; // 3 correct calls in a row
    uint256 public constant BADGE_WHALE         = 3; // Staked over 1000 USDC total
    uint256 public constant BADGE_COMMUNITY_TOP = 4; // Top 3 in community poll
    uint256 public constant BADGE_EARLY_BUILDER = 5; // Joined in first 30 days

    // ─────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────

    event ProfileCreated(address indexed user, string username);
    event ProfileUpdated(address indexed user);
    event BadgeAwarded(address indexed user, uint256 badgeId);
    event BadgeCreated(uint256 badgeId, string name);
    event MinterAuthorized(address minter);
    event MinterRevoked(address minter);

    // ─────────────────────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────────────────────

    error ProfileAlreadyExists();
    error ProfileNotFound();
    error UsernameTooShort();
    error UsernameTooLong();
    error NotAuthorized();
    error BadgeNotActive();

    // ─────────────────────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────────────────────

    constructor() ERC1155("https://arc-calls.xyz/api/badges/{id}.json") Ownable(msg.sender) {
        _initializeBadges();
    }

    // ─────────────────────────────────────────────────────────────
    // Profile Functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Create a new user profile.
     * @param _username Display name (3-24 characters).
     * @param _avatarCID IPFS CID of the user's avatar.
     */
    function createProfile(string calldata _username, string calldata _avatarCID) external {
        if (profiles[msg.sender].exists) revert ProfileAlreadyExists();
        if (bytes(_username).length < 3)  revert UsernameTooShort();
        if (bytes(_username).length > 24) revert UsernameTooLong();

        profiles[msg.sender] = UserProfile({
            username:      _username,
            avatarCID:     _avatarCID,
            totalBets:     0,
            correctBets:   0,
            totalWinnings: 0,
            createdAt:     block.timestamp,
            exists:        true
        });

        totalUsers++;

        emit ProfileCreated(msg.sender, _username);
    }

    /**
     * @notice Update username and/or avatar.
     */
    function updateProfile(string calldata _username, string calldata _avatarCID) external {
        if (!profiles[msg.sender].exists) revert ProfileNotFound();
        if (bytes(_username).length < 3)  revert UsernameTooShort();
        if (bytes(_username).length > 24) revert UsernameTooLong();

        profiles[msg.sender].username  = _username;
        profiles[msg.sender].avatarCID = _avatarCID;

        emit ProfileUpdated(msg.sender);
    }

    /**
     * @notice Called by BettingPool contract to update stats after a resolved market.
     * @dev Only callable by authorized minters (BettingPool contract address).
     */
    function recordBetResult(address _user, bool _correct, uint256 _winnings) external {
        if (!authorizedMinters[msg.sender]) revert NotAuthorized();
        if (!profiles[_user].exists) return; // silently skip if no profile

        profiles[_user].totalBets++;
        if (_correct) {
            profiles[_user].correctBets++;
            profiles[_user].totalWinnings += _winnings;
        }
    }

    /**
     * @notice Get a user's prediction accuracy as a percentage (0-100).
     */
    function getAccuracy(address _user) external view returns (uint256) {
        UserProfile memory p = profiles[_user];
        if (p.totalBets == 0) return 0;
        return (p.correctBets * 100) / p.totalBets;
    }

    // ─────────────────────────────────────────────────────────────
    // Badge Functions
    // ─────────────────────────────────────────────────────────────

    /**
     * @notice Award a badge to a user. Only authorized minters can call this.
     */
    function awardBadge(address _user, uint256 _badgeId) external {
        if (!authorizedMinters[msg.sender] && msg.sender != owner()) revert NotAuthorized();
        if (!badges[_badgeId].active) revert BadgeNotActive();

        _mint(_user, _badgeId, 1, "");

        emit BadgeAwarded(_user, _badgeId);
    }

    /**
     * @notice Create a new badge type. Owner only.
     */
    function createBadge(
        string calldata _name,
        string calldata _description,
        string calldata _imageCID
    ) external onlyOwner returns (uint256) {
        badgeCount++;
        badges[badgeCount] = Badge({
            name:        _name,
            description: _description,
            imageCID:    _imageCID,
            active:      true
        });

        emit BadgeCreated(badgeCount, _name);
        return badgeCount;
    }

    // ─────────────────────────────────────────────────────────────
    // Access Control
    // ─────────────────────────────────────────────────────────────

    function authorizeMinter(address _minter) external onlyOwner {
        authorizedMinters[_minter] = true;
        emit MinterAuthorized(_minter);
    }

    function revokeMinter(address _minter) external onlyOwner {
        authorizedMinters[_minter] = false;
        emit MinterRevoked(_minter);
    }

    // ─────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────

    function _initializeBadges() internal {
        badges[BADGE_FIRST_CALL]    = Badge("First Call",       "Placed your first prediction",              "QmFirstCall",    true);
        badges[BADGE_CORRECT_3]     = Badge("Hat Trick",        "3 correct predictions in a row",            "QmHatTrick",     true);
        badges[BADGE_WHALE]         = Badge("Whale",            "Staked over 1,000 USDC lifetime",           "QmWhale",        true);
        badges[BADGE_COMMUNITY_TOP] = Badge("Community Choice", "Top 3 in a community poll round",           "QmCommunity",    true);
        badges[BADGE_EARLY_BUILDER] = Badge("Early Builder",    "Joined Arc Calls in the first 30 days",     "QmEarlyBuilder", true);
        badgeCount = 5;
    }
}
