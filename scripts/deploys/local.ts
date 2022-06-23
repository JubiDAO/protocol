import '@nomiclabs/hardhat-ethers';
import { ethers } from 'hardhat';
import { FakeERC20__factory, Presale__factory  } from '../../typechain';
import { DeployedContracts } from './contract-addresses';
import { MerkleTree } from 'merkletreejs';

import { toAtto } from '../../shared/utils';
import { InviteCodeRange } from '../../types/invite-code';
import { writeFile } from '../../utils/file';
import {
  generateInviteCodes,
  inviteCodesToMerkleTree,
} from '../../utils/invite-code';

const EPOCH_SIZE_SECONDS = 60; // Every minute for local testing
const EPOCH_REWARD = toAtto(6849315 / 24);   // Daily rewards per hour

async function main() {
  const [owner] = await ethers.getSigners();

  const fakeUSD = await new FakeERC20__factory(owner).deploy("USD", "USD");
  const fakeSaftelyToken = await new FakeERC20__factory(owner).deploy("Saftley", "SAFTELY");

  const inviteCodes: Map<string, InviteCodeRange> = await generateInviteCodes(
    [
      {
        qty: 10,
        maxInvestment: 10000,
        minInvestment: 100,
      },
    ],
    true
  );

  const inviteCodesKeys = [...inviteCodes.keys()];
  const inviteCodesValues = [...inviteCodes.values()];
  const inviteCodesSize = inviteCodes.size;

  const inviteCodesToRange: Record<string, InviteCodeRange> = {};
  for (let i = 0; i < inviteCodesSize; i++) {
    inviteCodesToRange[inviteCodesKeys[i]] = {
      maxInvestment: inviteCodesValues[i].maxInvestment,
      minInvestment: inviteCodesValues[i].minInvestment,
    };
  }
  await writeFile("invite-codes_local.json", JSON.stringify(inviteCodesToRange));

  const inviteMerkleTree: MerkleTree = inviteCodesToMerkleTree(inviteCodes);

  const leaves = inviteMerkleTree
    .getLeaves()
    .map((leaf) => leaf.toString('hex'));
  await writeFile('merkle_local.json', JSON.stringify(leaves, null, 2));

  const presale = await new Presale__factory(owner).deploy(
    toAtto(5000000), // 5 MIL
    toAtto(1000000), // 1 MIL
    inviteMerkleTree.getRoot(),
    (60 * 60), // 1 hour
    (60 * 60), // 1 hour
    fakeUSD.address,
    await owner.getAddress(),
  );

  await presale.setIssuedToken(fakeSaftelyToken.address);

  // Print config required to run dApp;
  const deployedContracts: DeployedContracts = {
    USDC:    fakeUSD.address,
    PRESALE: presale.address,
    DAO_MULTISIG: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // Account #0
  };

  await fakeUSD.connect(owner).mint(deployedContracts.DAO_MULTISIG, "50000000000000000000000");

  const contractAddressAsMapping = deployedContracts as unknown as {[key: string]: string}

  console.log();
  console.log('=========================================');
  for (const envvar in contractAddressAsMapping) {
    console.log(`${envvar}=${contractAddressAsMapping[envvar]}`);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
