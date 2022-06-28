import '@nomiclabs/hardhat-ethers';
import { ethers, network } from 'hardhat';

import { Presale, Presale__factory  } from '../../../typechain';
import { DEPLOYED_CONTRACTS } from '../contract-addresses';

import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';
import fs from 'fs';

import { toAtto } from '../../../shared/utils';

import { deployAndMine, ensureExpectedEnvvars, mine } from '../helpers';
import { BigNumber } from 'ethers';

async function main() {
  const deployedContracts = DEPLOYED_CONTRACTS[network.name];
  const args: {
    HARD_CAP: string;
    HURDLE: string;
    HASHED_INVITE_CODES_JSON: string; // filename containing a json array of  keccak256 hashed invite codes
    VESTING_CLIFF_DURATION: string;   // Vesting cliff for presale participants post token launch
    VESTING_DURATION: string;         // How long do presale participants vest (post cliff)
  } = {
    HARD_CAP: '',
    HURDLE: '',
    HASHED_INVITE_CODES_JSON: '',
    VESTING_CLIFF_DURATION: '',
    VESTING_DURATION: '',
  }
  ensureExpectedEnvvars(args);

  const [owner] = await ethers.getSigners();

  const hashedInviteCodes = JSON.parse(fs.readFileSync(args.HASHED_INVITE_CODES_JSON, 'utf8'));
  const inviteMerkleTree = new MerkleTree(hashedInviteCodes, keccak256, {sortPairs: true});

  const presaleFactory = new Presale__factory(owner)
  const presale: Presale = await deployAndMine("PRESALE", presaleFactory, presaleFactory.deploy,
    BigNumber.from(args.HARD_CAP),
    BigNumber.from(args.HURDLE),
    inviteMerkleTree.getRoot(),
    BigNumber.from(args.VESTING_CLIFF_DURATION),
    BigNumber.from(args.VESTING_DURATION),
    deployedContracts.USDC,
    deployedContracts.DAO_MULTISIG,
  );

  await mine(presale.transferOwnership(deployedContracts.DAO_MULTISIG));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });