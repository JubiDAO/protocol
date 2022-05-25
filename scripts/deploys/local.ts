import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { FakeERC20__factory, Presale__factory  } from '../../typechain';
import { DeployedContracts } from './contract-addresses';
import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';

import { blockTimestamp, toAtto } from '../../shared/utils';

const EPOCH_SIZE_SECONDS = 60; // Every minute for local testing
const EPOCH_REWARD = toAtto(6849315 / 24);   // Daily rewards per hour 

async function main() {
  const [owner] = await ethers.getSigners();

  const fakeUSD = await new FakeERC20__factory(owner).deploy("USD", "USD");
  const fakeSaftelyToken = await new FakeERC20__factory(owner).deploy("Saftley", "SAFTELY");

  const inviteCodes = [
    "asdf12", 
    "123asdf", 
    "SLKJ3n1", 
    "098123AS", 
    "09lkmqwe", 
    "S3JOInsa",
    "1auwwizf",
    "1960nkp7",
    "t9x1gWXF",
    "CLEQudf8l3",
    "16a1v5vUug",
    "nswe90XVqy"
  ];
  const inviteMerkleTree = new MerkleTree(inviteCodes.map(c => keccak256(c)), keccak256, {sortPairs: true});

  const presale = await new Presale__factory(owner).deploy(
    inviteMerkleTree.getRoot(),
    await blockTimestamp() + 10000,
    await blockTimestamp(),
    100000,
    fakeUSD.address,
    await owner.getAddress(),
  );

  await presale.setIssuedToken(fakeSaftelyToken.address);

  // Print config required to run dApp
  const deployedContracts: DeployedContracts = {
    USDC:    fakeUSD.address,
    PRESALE: presale.address,
    OWNER: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Account #0
  };

  await fakeUSD.connect(owner).mint(deployedContracts.OWNER, "50000000000000000000000");

  const contractAddressAsMapping = deployedContracts as unknown as {[key: string]: string}
  
  console.log();
  console.log('=========================================');
  for (const envvar in contractAddressAsMapping) {
    console.log(`${envvar}=${contractAddressAsMapping[envvar]}`);
  }
  console.log('=========================================');

  console.log();
  console.log();
  console.log('*** INVITE CODES ***');
  inviteCodes.forEach(c => console.log(c));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });