import '@nomiclabs/hardhat-ethers';
import { ethers, network } from 'hardhat';

import { RoundFactory, RoundFactory__factory } from '../../../typechain';
import { DEPLOYED_CONTRACTS } from '../contract-addresses';

import { deployAndMine, mine } from '../helpers';

async function main() {
  const deployedContracts = DEPLOYED_CONTRACTS[network.name];

  const [owner] = await ethers.getSigners();

  const roundFactoryFactory = new RoundFactory__factory(owner);
  const roundFactory: RoundFactory = await deployAndMine("PRESALE", roundFactoryFactory, roundFactoryFactory.deploy);

  await mine(roundFactory.transferOwnership(deployedContracts.DAO_MULTISIG));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
