// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
    IBettingPool public bettingPool;

    address public constant ADMIN_ONE = 0x2e7497D98C8Cae22180773c92D07d96f4D42F8b6;
    address public constant ADMIN_TWO = 0xed3eb5A8adAee1954013468b5dBB6E36Aad93cd8;

    // wallet => badge => record
    mapping(address => mapping(Badge => BadgeRecord)) private badgeRecords;
    mapping(address => uint256) public badgeCount;
    uint256 public totalBadgesMinted;

    event BadgeMinted(address indexed wallet, Badge badge, uint256 betCount, uint256 mintedAt);
    event BettingPoolUpdated(address indexed newPool);
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

    constructor(address _bettingPool) {
        require(_bettingPool != address(0), "Invalid pool address");
        owner       = msg.sender;
        bettingPool = IBettingPool(_bettingPool);
    }

    function mintBadge(Badge badge) external {
        uint256 bets = bettingPool.getBetCount(msg.sender);
        uint256 threshold = _threshold(badge);
        require(bets >= threshold, "Not enough bets");
        require(!badgeRecords[msg.sender][badge].minted, "Already minted");

        badgeRecords[msg.sender][badge] = BadgeRecord({
            minted:      true,
            mintedAt:    block.timestamp,
            mintedAtBet: bets
        });
        badgeCount[msg.sender]++;
        totalBadgesMinted++;

        emit BadgeMinted(msg.sender, badge, bets, block.timestamp);
    }

    function hasBadge(address wallet, Badge badge) external view returns (bool) {
        return badgeRecords[wallet][badge].minted;
    }

    function getAllBadges(address wallet)
        external view
        returns (bool starter, bool caller, bool oracle, bool og)
    {
        return (
            badgeRecords[wallet][Badge.STARTER].minted,
            badgeRecords[wallet][Badge.CALLER].minted,
            badgeRecords[wallet][Badge.ORACLE].minted,
            badgeRecords[wallet][Badge.OG].minted
        );
    }

    function getEligibleBadges(address wallet)
        external view
        returns (uint256[] memory eligible)
    {
        uint256 bets = bettingPool.getBetCount(wallet);
        uint256[] memory temp = new uint256[](4);
        uint256 count = 0;
        Badge[4] memory all = [Badge.STARTER, Badge.CALLER, Badge.ORACLE, Badge.OG];
        for (uint256 i = 0; i < 4; i++) {
            if (bets >= _threshold(all[i]) && !badgeRecords[wallet][all[i]].minted) {
                temp[count++] = i;
            }
        }
        eligible = new uint256[](count);
        for (uint256 i = 0; i < count; i++) eligible[i] = temp[i];
    }

    function getBadgeRecord(address wallet, Badge badge)
        external view
        returns (bool minted, uint256 mintedAt, uint256 mintedAtBet)
    {
        BadgeRecord storage r = badgeRecords[wallet][badge];
        return (r.minted, r.mintedAt, r.mintedAtBet);
    }

    function getBetCount(address wallet) external view returns (uint256) {
        return bettingPool.getBetCount(wallet);
    }

    function setBettingPool(address _bettingPool) external onlyAdmin {
        require(_bettingPool != address(0), "Invalid pool address");
        bettingPool = IBettingPool(_bettingPool);
        emit BettingPoolUpdated(_bettingPool);
    }

    function transferOwnership(address newOwner) external onlyAdmin {
        require(newOwner != address(0), "Zero address");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    function _threshold(Badge badge) internal pure returns (uint256) {
        if (badge == Badge.STARTER) return STARTER_THRESHOLD;
        if (badge == Badge.CALLER)  return CALLER_THRESHOLD;
        if (badge == Badge.ORACLE)  return ORACLE_THRESHOLD;
        return OG_THRESHOLD;
    }
}
