import { ethers, network } from "hardhat";
import { blockTimestamp } from "./utils";

/**
 * Mine forward a given number of blocks
 * @param numBlocks 
 */
export async function mineNBlocks(numBlocks: number) {
  const blocks: Promise<any>[] = [];

  for (let i = 0; i < numBlocks; i++) {
    blocks.push(network.provider.send("evm_mine"));
  }

  await Promise.all(blocks);
}

/**
 * Mine to a specific block timestamp
 * @param timestamp 
 */
export const mineToTimestamp = async (timestamp: number) => {
  const currentTimestamp = (await ethers.provider.getBlock(await ethers.provider.getBlockNumber())).timestamp
  if (timestamp < currentTimestamp) {
    throw new Error("Cannot mine a timestamp in the past");
  }

  await network.provider.send("evm_increaseTime", [(timestamp - currentTimestamp)])
  await network.provider.send("evm_mine");
}

/**
 * Mine forward the given number of seconds
 * @param seconds 
 */
export const advance = async (seconds: number) => {
  await mineToTimestamp(await blockTimestamp() + seconds);
}