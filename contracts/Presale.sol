//SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title Token management for a funding round
 * @notice Funds `daoMultisig` with `raiseToken` once round is closed and `hurdle` is met.
 * Funders will get `issuedToken` on a round close, once vesting conditions are met.
 * If the `hurdle` isn't cleared, funders can claim back their initial investment.
 */
contract Presale is Ownable {
    /// @dev Is the round open
    bool public isOpen = true;

    /// @dev Hard cap on round
    uint256 public immutable hardCap;

    /// @dev Hurdle on round
    uint256 public immutable hurdle;

    /// @dev vesting cliff duration, kicks in after the token
    /// is created and set (ie, after setIssuedToken is called)
    uint256 public immutable vestingCliffDuration;

    /// @dev when the vesting starts
    uint256 public immutable vestingDuration;

    /// @dev what token are we accepting as part of the raise
    IERC20 public immutable raiseToken;

    /// @dev Where do funds raised get sent
    address public immutable daoMultisig;

    /// @dev merkle root that captures all valid invite codes
    bytes32 public immutable inviteCodesMerkleRoot;

    /// @dev maps invitesCodes => wallets
    mapping(bytes => address) public claimedInvites;

    /// @dev what token are we issuing as per vesting conditions
    /// not immutable as we expect to set this once we complete the presale
    IERC20 public issuedToken;

    /// @dev when the vesting starts
    uint256 public issuedTokenAtTimestamp;

    mapping(address => uint256) public allocation;
    uint256 public totalAllocated;

    mapping(address => uint256) public claimed;
    uint256 public totalClaimed;

    event Deposited(address account, uint256 amount);
    event Claimed(address account, uint256 amount);

    constructor(
        uint256 _hardCap,
        uint256 _hurdle,
        bytes32 _inviteCodesMerkleRoot,
        uint256 _vestingCliffDuration,
        uint256 _vestingDuration,
        IERC20 _raiseToken,
        address _daoMultisig
    ) {
        hardCap = _hardCap;
        hurdle = _hurdle;
        inviteCodesMerkleRoot = _inviteCodesMerkleRoot;
        vestingCliffDuration = _vestingCliffDuration;
        vestingDuration = _vestingDuration;
        raiseToken = _raiseToken;
        daoMultisig = _daoMultisig;
    }

    /**
     * @notice Deposit `amount` of token `raiseToken` for this Round. Requires valid `amount` as per `inviteCode`
     */
    function depositFor(address account, uint256 amount, uint256 minInvestment, uint256 maxInvestment, bytes memory inviteCode, bytes32[] calldata merkleProof) external {
        require(account != address(0), "Presale: Address cannot be 0x0");
        require(isOpen, "Presale: Round closed");
        require(hardCap > totalAllocated, "Presale: Round closed, goal reached");

        // We only check minInvestment as, if amount excedes maxInvestment it will be scale down.
        require(allocation[account] >= minInvestment || amount >= minInvestment, "Presale: Can not invest less than minimum amount");

        require(MerkleProof.verify(merkleProof, inviteCodesMerkleRoot, keccak256(abi.encode(inviteCode, minInvestment, maxInvestment))), "Presale: Invalid invite code");

        require(claimedInvites[inviteCode] == account || claimedInvites[inviteCode] == address(0) , "Presale: You can only invest with one wallet per invite code");

        uint256 remainingAllocation = hardCap - totalAllocated;
        if (remainingAllocation < amount) {
            amount = remainingAllocation;
        }

        uint256 remainingInvestment = maxInvestment - allocation[account];
        if (remainingInvestment < amount) {
            amount = remainingInvestment;
        }

        require(amount > 0, "Presale: You have invest up to your limit");

        allocation[account] += amount;
        totalAllocated += amount;
        claimedInvites[inviteCode] = account;

        SafeERC20.safeTransferFrom(raiseToken, msg.sender, address(this), amount);
        emit Deposited(account, amount);
    }

    /// @dev Calculates the claimable amount for a given account in a given timestamp
    /// @param account Account to get data from
    /// @param timestamp => can be used to calculate claimable amount in a time other than block.timestamp
    function calculateClaimable(address account, uint256 timestamp) public view returns (uint256 share, uint256 amount)
    {
        if (address(issuedToken) == address(0)) {
            return (0,0);
        }

        if (totalAllocated == totalClaimed) {
            return (0,0);
        }

        uint256 vestingStartTimestamp = issuedTokenAtTimestamp + vestingCliffDuration;
        if (timestamp < vestingStartTimestamp) {
            return (0,0);
        }

        uint256 currentVestingDuration = timestamp - vestingStartTimestamp;
        if (currentVestingDuration > vestingDuration) {
            currentVestingDuration = vestingDuration;
        }

        share = ((allocation[account] * currentVestingDuration) / vestingDuration) - claimed[account];
        amount = share * issuedToken.balanceOf(address(this)) / (totalAllocated - totalClaimed);
    }

    function calculateClaimableNow(address account) public view returns (uint256, uint256) {
        return calculateClaimable(account, block.timestamp);
    }

    /**
     *  @notice Claim available allocation of 'issuedToken' if round is closed ( 'isOpen'=false ) and  `hurdle` amount was met
     *  If the round is closed and `hurdle` was not met, claimFor will return invested amount of `raiseToken` to `account`
     */
    function claimFor(address account) external {
        require(!isOpen, "Presale: Can only claim once round is closed");
        (uint256 share, uint256 claimable) = calculateClaimableNow(account);

        claimed[account] += share;
        totalClaimed += share;

        SafeERC20.safeTransfer(issuedToken, account, claimable);
        emit Claimed(account, claimable);
    }

    /// @dev owner only. set issued token. Can only be called once
    /// and kicks of vesting
    function setIssuedToken(IERC20 _issuedToken) external onlyOwner {
        // check balance in the token is
        require(address(issuedToken) == address(0), "Presale: Issued token already sent");
        issuedToken = _issuedToken;
        issuedTokenAtTimestamp = block.timestamp;
    }

    /// @dev owner only. Close round
    function closeRound() external onlyOwner {
        isOpen = false;

        // when round is closed if Hurdle is meet transfer funds to daoMultisig
        if (hurdle <= totalAllocated) {
            SafeERC20.safeTransfer(raiseToken, daoMultisig, totalAllocated);
        } else {
            // when the round is closed if Hurdle is NOT met set the issuedToken to raiseToken and remove any vesting so
            // funders can call claimFor to refund their initial investment
            issuedToken = raiseToken;
            // This will make so allocation is claimable right away
            issuedTokenAtTimestamp = vestingCliffDuration;
        }
    }
}
