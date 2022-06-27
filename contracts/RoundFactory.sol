//SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./Presale.sol";

/**
 * @title Contract factory to manage rounds
 * @notice You can use this Contract to create new funding rounds
 */
contract RoundFactory is Ownable {

    struct PresaleConfig {
        uint256 hardCap;
        uint256 hurdle;
        bytes32 inviteCodesMerkleRoot;
        uint256 vestingCliffDuration;
        uint256 vestingDuration;
        IERC20 raiseToken;
        address daoMultisig;
    }

    /* TODO: Update Presale.sol to an interface once we have Rounds~ */
    /// @dev mapping from venture => rounds
    mapping(address => Presale[]) public ventureRounds;

    event RoundCreated(address venture, Presale round);

    constructor() {}

    /// @notice Creates a Round with `config` as params
    function createRound(PresaleConfig memory config) external {
        uint256 hardCap = config.hardCap;
        uint256 hurdle = config.hurdle;
        bytes32 inviteCodesMerkleRoot = config.inviteCodesMerkleRoot;
        uint256 vestingCliffDuration = config.vestingCliffDuration;
        uint256 vestingDuration = config.vestingDuration;
        IERC20 raiseToken = config.raiseToken;
        address daoMultisig = config.daoMultisig;

        Presale Round = new Presale(hardCap, hurdle, inviteCodesMerkleRoot, vestingCliffDuration, vestingDuration, raiseToken, daoMultisig);
        Round.transferOwnership(msg.sender);

        ventureRounds[msg.sender].push(Round);

        emit RoundCreated(msg.sender, Round);
    }

    /// @notice Retrieves the list of rounds for the Venture: `venture`
    function getRounds(address venture) public view returns (bytes[] memory rounds) {
        uint256 length = ventureRounds[venture].length;
        rounds = new bytes[](length);
        for (uint i = 0; i < length; i++) {
            rounds[i] = abi.encodePacked(ventureRounds[venture][i]);
        }
    }

}

