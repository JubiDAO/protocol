import "@nomiclabs/hardhat-ethers";
import { MerkleTree } from "merkletreejs";
import { toAtto } from "../shared/utils";
import { InviteCodeConfig, InviteCodeRange } from "../types/invite-code";
import { writeFile } from "../utils/file";
import {
  generateInviteCodes,
  inviteCodesToMerkleTree,
} from "../utils/invite-code";

const inviteCodesInputs: Array<InviteCodeConfig> = [
  {
    qty: 10,
    maxInvestment: toAtto(10000),
    minInvestment: toAtto(100),
  },
];

async function main() {
  const inviteCodes: Map<string, InviteCodeRange> = await generateInviteCodes(
    inviteCodesInputs,
    true
  );

  const inviteCodesKeys = [...inviteCodes.keys()];
  const inviteCodesValues = [...inviteCodes.values()];
  const inviteCodesSize = inviteCodes.size;

  let json: string = "{";
  for (let i = 0; i < inviteCodesSize; i++) {
    json = json.concat(
      `"${inviteCodesKeys[i]}": {"minInvestment": ${
        inviteCodesValues[i].minInvestment
      },
      "maxInvestment": ${inviteCodesValues[i].maxInvestment}}${
        i + 1 < inviteCodesSize ? "," : ""
      }`
    );
  }
  json = json.concat("}");
  await writeFile("invite-codes_local.json", json);

  const inviteMerkleTree: MerkleTree = inviteCodesToMerkleTree(inviteCodes);

  const leaves = inviteMerkleTree
    .getLeaves()
    .map((leaf) => leaf.toString("hex"));
  await writeFile("merkle_local.json", JSON.stringify(leaves, null, 2));

  console.info(`\n===== MERKLE TREE ROOT =====\n`);
  console.log(inviteMerkleTree.getRoot().toString("hex"));
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });