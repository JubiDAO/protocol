import '@nomiclabs/hardhat-ethers';
import { MerkleTree } from 'merkletreejs';
import keccak256 from 'keccak256';
import ShortUniqueId from 'short-unique-id';

async function main() {
  const genCode = new ShortUniqueId({length: 8});

  const inviteCodes: string[] = []
  for (let i = 0; i < parseInt(process.env.NUM_CODES || '100'); i++) {
    inviteCodes.push(genCode());
  }
    
  const inviteMerkleTree = new MerkleTree(inviteCodes.map(c => keccak256(c)), keccak256, {sortPairs: true});

  console.log('*** MERKLE TREE ROOT ***');
  console.log(inviteMerkleTree.getRoot().toString('hex'));
  console.log("Buffer.from('...', 'hex') // convert back to buffer for use in smart contract setup")
  console.log();
  console.log();
  console.log('*** INVITE CODES + keccak256 hash (tab seperated, copy/pastable into sheets)***');
  inviteCodes.forEach(c => console.log(`${c}\t${keccak256(c).toString('hex')}`));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });