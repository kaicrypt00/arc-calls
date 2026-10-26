// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ProfileRegistry
 * @notice Arc Calls — On-chain profile registry on Arc Mainnet
 * @dev    One profile per wallet. Stores name, bio, pfp hash, X username.
 *         Deployed on Arc Mainnet — Chain ID: 5042
 */
contract ProfileRegistry {
    struct Profile {
        string  name;
        string  bio;
        string  pfpHash;
        string  xUsername;
        uint256 mintedAt;
    }

    address public owner;

    address public constant ADMIN_ONE = 0x2e7497D98C8Cae22180773c92D07d96f4D42F8b6;
    address public constant ADMIN_TWO = 0xed3eb5A8adAee1954013468b5dBB6E36Aad93cd8;

    mapping(address => Profile) private profiles;
    mapping(address => bool)    public  hasProfile;
    uint256 public totalProfiles;

    event ProfileMinted(address indexed wallet, string name, uint256 mintedAt);
    event ProfileUpdated(address indexed wallet, string name);
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

    function mintProfile(
        string calldata _name,
        string calldata _bio,
        string calldata _pfpHash,
        string calldata _xUsername
    ) external {
        require(!hasProfile[msg.sender],      "Profile already exists");
        require(bytes(_name).length > 0,      "Name required");
        require(bytes(_name).length <= 32,    "Name too long");

        profiles[msg.sender] = Profile({
            name:      _name,
            bio:       _bio,
            pfpHash:   _pfpHash,
            xUsername: _xUsername,
            mintedAt:  block.timestamp
        });
        hasProfile[msg.sender] = true;
        totalProfiles++;

        emit ProfileMinted(msg.sender, _name, block.timestamp);
    }

    function updateProfile(
        string calldata _name,
        string calldata _bio,
        string calldata _pfpHash,
        string calldata _xUsername
    ) external {
        require(hasProfile[msg.sender],    "No profile");
        require(bytes(_name).length > 0,   "Name required");
        require(bytes(_name).length <= 32, "Name too long");

        Profile storage p = profiles[msg.sender];
        p.name      = _name;
        p.bio       = _bio;
        p.pfpHash   = _pfpHash;
        p.xUsername = _xUsername;

        emit ProfileUpdated(msg.sender, _name);
    }

    function getProfile(address wallet)
        external view
        returns (string memory name, string memory bio, string memory pfpHash, string memory xUsername, uint256 mintedAt)
    {
        Profile storage p = profiles[wallet];
        return (p.name, p.bio, p.pfpHash, p.xUsername, p.mintedAt);
    }

    function transferOwnership(address newOwner) external onlyAdmin {
        require(newOwner != address(0), "Zero address");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }
}
