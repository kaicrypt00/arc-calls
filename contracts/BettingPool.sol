// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

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
    uint256 public constant MIN_BET        = 100_000;    // 0.1 USDC (6 decimals)
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

    address public constant ADMIN_ONE = 0x2e7497D98C8Cae22180773c92D07d96f4D42F8b6;
    address public constant ADMIN_TWO = 0xed3eb5A8adAee1954013468b5dBB6E36Aad93cd8;

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

        uint256 payout = (b.amount * totalPool) / winningPool;
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
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }
}
