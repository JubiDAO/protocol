import { BigNumber } from "ethers";
import { defaultAbiCoder } from "ethers/lib/utils";
import keccak256 from "keccak256";
import { MerkleTree } from "merkletreejs";
import ShortUniqueId from "short-unique-id";
import { fromAtto, toAtto } from '../shared/utils';
import { InviteCodeConfig, InviteCodeRange } from "../types/invite-code";
import { writeFile } from "./file";

export const genCode = new ShortUniqueId({ length: 8 });

export const generateInviteCodes = async (
  inviteCodeConfig: Array<InviteCodeConfig>,
  genCSV = false
): Promise<Map<string, InviteCodeRange>> => {
  const inviteCodes: Map<string, InviteCodeRange> = new Map<
    string,
    InviteCodeRange
  >();

  let data = "";
  if (genCSV) {
    data = data.concat("Invite Code, Minimum Investment, Maximum Investment\n");
  }

  inviteCodeConfig.map((config) => {
    for (let i = 0; i < config.qty; i++) {
      const code = genCode();
      inviteCodes.set(keccak256(code).toString("hex"), {
        maxInvestment: config.maxInvestment,
        minInvestment: config.minInvestment,
      });

      if (genCSV) {
        data = data.concat(
          `${code},${config.minInvestment},${config.maxInvestment}\n`
        );
      }
    }
  });

  if (genCSV) {
    await writeFile("invite-codes_local.csv", data);
  }

  return inviteCodes;
};

export const getInviteCodeHashedLeaf = (
  hashedInvitedCode: string,
  minInvestment: number,
  maxInvestment: number
) => {
  return keccak256(
    defaultAbiCoder.encode(
      ["string", "uint256", "uint256"],
      [hashedInvitedCode, toAtto(minInvestment), toAtto(maxInvestment)]
    )
  ).toString("hex");
};

export const inviteCodesToMerkleTree = (
  inviteCodes: Map<string, InviteCodeRange>
): MerkleTree => {
  const inviteCodesKeys = [...inviteCodes.keys()];
  const inviteCodesValues = [...inviteCodes.values()];
  const inviteCodesSize = inviteCodes.size;
  const merkleTreeLeaves: Array<string> = [];

  for (let i = 0; i < inviteCodesSize; i++) {
    const leaf = getInviteCodeHashedLeaf(
      inviteCodesKeys[i],
      inviteCodesValues[i].minInvestment,
      inviteCodesValues[i].maxInvestment
    );
    merkleTreeLeaves.push(leaf);
  }

  return new MerkleTree(merkleTreeLeaves, keccak256, { sortPairs: true });
};
