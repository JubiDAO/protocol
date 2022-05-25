//SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @dev Little 'm' mVP Presale contract
 *
 * Designed to capture the expected investor user flow (including vesting).
 */
contract Presale is Ownable {
    /// @dev Is the round open
    bool public isOpen = true;

    /// @dev Hard cap on round
    uint256 public immutable hardCap;

    /// @dev when the vesting starts
    uint256 public immutable vestingStartTimestamp;

    /// @dev when the vesting starts
    uint256 public immutable vestingDuration;

    /// @dev what token are we accepting as part of the raise
    IERC20 public immutable raiseToken;

    /// @dev Where do funds raised get sent
    address public immutable daoMultisig;

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
        uint256 _hardCap,
        uint256 _vestingStartTimestamp,
        uint256 _vestingDuration,
        IERC20 _raiseToken,
        address _daoMultisig
    ) {
        hardCap = _hardCap;
        vestingStartTimestamp = _vestingStartTimestamp;
        vestingDuration = _vestingDuration;
        raiseToken = _raiseToken;
        daoMultisig = _daoMultisig;
    }

    function depositFor(address account, uint256 amount) external {
        require(account != address(0), "Presale: Address cannot be 0x0");
        require(isOpen, "Presale: Round closed");
        require(hardCap > totalAllocated, "Presale: Round closed, goal reached");

        uint256 remainingAllocation = hardCap - totalAllocated;
        if (remainingAllocation < amount) {
            amount = remainingAllocation;
        }

        allocation[account] += amount;
        totalAllocated += amount;

        SafeERC20.safeTransferFrom(raiseToken, msg.sender, daoMultisig, amount);
        emit Deposited(account, amount);
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
        emit Claimed(account, claimable);
    }

    /// @dev owner only. set issued token, needs to be created before
    /// vest start date
    function setIssuedToken(IERC20 _issuedToken) external onlyOwner {
        issuedToken = _issuedToken;
    }

    /// @dev owner only. Close round
    function closeRound() external onlyOwner {
        isOpen = false;
    }
}