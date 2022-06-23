import { BigNumber } from "ethers";

export interface InviteCodeRange {
  minInvestment: BigNumber;
  maxInvestment: BigNumber;
}

export interface InviteCodeConfig extends InviteCodeRange {
  qty: number;
}
