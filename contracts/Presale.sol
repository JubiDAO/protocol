//SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

/**
 * @dev Little 'm' mVP Presale contract
 *
 * Designed to capture the expected investor user flow (including vesting).
 */
contract Presale is Ownable {
    /// @dev when the round ends
    uint256 public immutable roundEndTimestamp;

    /// @dev when the vesting starts
    uint256 public immutable vestingStartTimestamp;

    /// @dev when the vesting starts
    uint256 public immutable vestingDuration;

    /// @dev what token are we accepting as part of the raise
    IERC20 public immutable raiseToken;

    /// @dev Where do funds raised get sent
    address public immutable daoMultisig;

    /// @dev merkle root that captures all valid invite codes
    bytes32 public immutable inviteCodesMerkleRoot;

    /// @dev Where do funds raised get sent
    /// TODO: discuss/decide if this should be a packed array bitMap for 
    ///       gas efficiency (may not matter if most presales have < 100 or
    ///       so participants). Needs some tests
    mapping(bytes32 => bool) public claimedInvites;

    /// @dev what token are we issueing as per vesting conditions
    /// not immutable as we expect to set this once we complete the presale
    IERC20 public issuedToken;

    mapping(address => uint256) public allocation;
    uint256 public totalAllocated;

    mapping(address => uint256) public claimed;
    uint256 public totalClaimed;

    event Deposited(address account, uint256 amount);
    event Claimed(address account, uint256 amount);

    constructor(
        bytes32 _inviteCodesMerkleRoot,
        uint256 _roundEndTimestamp,
        uint256 _vestingStartTimestamp,
        uint256 _vestingDuration,
        IERC20 _raiseToken,
        address _daoMultisig
    ) {
        inviteCodesMerkleRoot = _inviteCodesMerkleRoot;
        roundEndTimestamp = _roundEndTimestamp;
        vestingStartTimestamp = _vestingStartTimestamp;
        vestingDuration = _vestingDuration;
        raiseToken = _raiseToken;
        daoMultisig = _daoMultisig;
    }

    function setIssuedToken(IERC20 _issuedToken) external onlyOwner {
        issuedToken = _issuedToken;
    }

    function depositFor(address account, uint256 amount, bytes32 hashedInviteCode, bytes32[] calldata merkleProof) external {
        require(account != address(0), "Presale: Address cannot be 0x0");
        require(block.timestamp < roundEndTimestamp, "Presale: round closed");
        require(!claimedInvites[hashedInviteCode], "Presale: Invite code has been used");
        require(MerkleProof.verify(merkleProof, inviteCodesMerkleRoot, hashedInviteCode), "Presale: invalid invite code");

        allocation[account] += amount;
        totalAllocated += amount;
        claimedInvites[hashedInviteCode] = true;

        SafeERC20.safeTransferFrom(raiseToken, msg.sender, daoMultisig, amount);
    }

    function calculateClaimable(address account) public view returns (uint256 share, uint256 amount)
    {
        if (block.timestamp < vestingStartTimestamp) {
            return (0,0);
        }

        if (totalAllocated == totalClaimed) {
            return (0,0);
        }

        uint256 currentVestingDuration = block.timestamp - vestingStartTimestamp;
        if (currentVestingDuration > vestingDuration) {
            currentVestingDuration = vestingDuration;
        }

        share = ((allocation[account] * currentVestingDuration) / vestingDuration) - claimed[account];
        amount = share * issuedToken.balanceOf(address(this)) / (totalAllocated - totalClaimed);
    }

    function claimFor(address account) external {
        (uint256 share, uint256 claimable)  = calculateClaimable(account);

        claimed[account] += share;
        totalClaimed += share;
        
        SafeERC20.safeTransfer(issuedToken, account, claimable);
        emit Claimed(msg.sender, claimable);
    }
}
