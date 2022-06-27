
export interface InviteCodeRange {
  minInvestment: number;
  maxInvestment: number;
}

export interface InviteCodeConfig extends InviteCodeRange {
  qty: number;
}
