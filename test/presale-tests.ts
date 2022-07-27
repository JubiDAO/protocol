import { BigNumber, Signer } from 'ethers';
import { expect } from 'chai';
import { ethers } from 'hardhat';
import { MerkleTree } from 'merkletreejs';

import { FakeERC20, FakeERC20__factory, Presale, Presale__factory } from '../typechain';
import { blockTimestamp, toAtto } from '../shared/utils';
import { advance } from '../shared/localdev-heplers';
import keccak256 from 'keccak256';
import { InviteCodeRange } from '../types/invite-code';
import {
  generateInviteCodes,
  getInviteCodeHashedLeaf,
  inviteCodesToMerkleTree,
} from '../utils/invite-code';

const SECONDS_IN_ONE_WEEK = 604800;
const SECONDS_IN_ONE_MONTH = 2628000;
const ONLY_OWNER_ERROR = 'Ownable: caller is not the owner';
const SINGLE_WALLET_PER_INVITE_CODE_ERROR =
  'Presale: You can only invest with one wallet per invite code';
const INVESTMENT_LIMIT_ERROR = 'Presale: You have invest up to your limit';
const MINIMUM_INVESTMENT_LIMIT_ERROR =
  'Presale: Can not invest less than minimum amount';
const HARD_CAP = toAtto(10000);
const HURDLE = toAtto(10000).div(2);

describe('Presale Tests', function () {
  let presale: Presale;
  let owner: Signer;
  let ash: Signer;
  let jeeva: Signer;
  let INVESTOR3: Signer;
  let INVESTOR4: Signer;
  let INVESTOR5: Signer;
  let nonInvestor: Signer;
  let venture: Signer;
  let purchaseToken: FakeERC20;
  let ventureToken: FakeERC20;
  let inviteCodes: string[];
  let inviteMerkleTree: MerkleTree
  let inviteCodesData: Map<string, InviteCodeRange>;

  const hashedInvite = (
    hashedInviteCode: string,
    min: number,
    max: number
  ): [Buffer, string[]] => {
    const leaf: string = getInviteCodeHashedLeaf(hashedInviteCode, min, max);
    return [
      Buffer.from(hashedInviteCode, "utf8"),
      inviteMerkleTree.getHexProof(leaf),
    ];
  };

  const nextInvite = (): [
    BigNumber,
    BigNumber,
    Buffer,
    string[]
  ] => {
    const inviteDataKeys = [...inviteCodesData.keys()];
    const nextKey = inviteDataKeys[0];
    const inviteData = inviteCodesData.get(nextKey);
    if (inviteCodesData.size === 0 || inviteData === undefined) {
      throw new Error("All invite code used");
    }
    const min = inviteData.minInvestment;
    const max = inviteData.maxInvestment;
    inviteCodesData.delete(nextKey);
    return [toAtto(min), toAtto(max), ...hashedInvite(nextKey, min, max)];
  };

  const skipNInvites = (invitesToSkip: number): void => {
    for (let i = 0; i < invitesToSkip; i++) {
      nextInvite();
    }
  }

  beforeEach(async function () {
    [owner, ash, jeeva, INVESTOR3, INVESTOR4, INVESTOR5, nonInvestor, venture] = await ethers.getSigners();

    purchaseToken = await new FakeERC20__factory(owner).deploy("Fake USDC", "USDC");
    ventureToken = await new FakeERC20__factory(owner).deploy("Fake Venture Token", "TOKEN");

    inviteCodesData = await generateInviteCodes([
      { qty: 10, minInvestment: 100, maxInvestment: 1000 },
      { qty: 10, minInvestment: 1000, maxInvestment: 10000 },
    ]);

    inviteMerkleTree = await inviteCodesToMerkleTree(inviteCodesData);

    presale = await new Presale__factory(owner).deploy(
      HARD_CAP,
      HURDLE,
      inviteMerkleTree.getRoot(),
      SECONDS_IN_ONE_WEEK,
      SECONDS_IN_ONE_MONTH,
      purchaseToken.address,
      await venture.getAddress()
    );

    await purchaseToken.mint(await owner.getAddress(), toAtto(10000000000));
    await purchaseToken.approve(presale.address, toAtto(10000000000));
    await ventureToken.mint(await owner.getAddress(), toAtto(10000000000));
  });

  describe('Deployment/Management', function () {
    it('should set the right owner', async function () {
      expect(await presale.owner()).to.equal(await owner.getAddress());
    });

    it('should allow owner to renounce', async function () {
      await presale.renounceOwnership();
      expect(await presale.owner()).to.equal(ethers.constants.AddressZero);
    });

    it('should allow owner to transfer ownership', async function () {
      await presale.transferOwnership(await jeeva.getAddress());
      expect(await presale.owner()).to.equal(await jeeva.getAddress());
    });

    it('should allow the setting the venture token', async function () {
      expect(await presale.ventureToken()).to.equal(ethers.constants.AddressZero);
      await presale.setVentureToken(ventureToken.address);
      expect(await presale.ventureToken()).to.equal(ventureToken.address);
    });

    it('only the owner can set the venture token', async function () {
      await expect(presale.connect(jeeva).setVentureToken(ventureToken.address))
        .to.revertedWith(ONLY_OWNER_ERROR);
    });

    it('only the owner can manually close the round', async function () {
      await expect(presale.connect(jeeva).closeRound())
        .to.revertedWith(ONLY_OWNER_ERROR);
    });
  });

  describe('Transactions', function () {
    it('should allow users to deposit, while round is open', async function () {
      await presale.depositFor(await jeeva.getAddress(), toAtto(100), ...nextInvite());
      await presale.depositFor(await ash.getAddress(), toAtto(500), ...nextInvite());

      expect(await presale.allocation(await jeeva.getAddress())).eql(toAtto(100));
      expect(await presale.allocation(await ash.getAddress())).eql(toAtto(500));
      expect(await presale.totalAllocated()).eql(toAtto(600));
    });

    it('should block deposits, once round is closed', async function () {
      await presale.closeRound();
      await expect(presale.depositFor(await ash.getAddress(), toAtto(100), ...nextInvite()))
        .to.revertedWith("Presale: Round closed");
    });

    it('should block deposits, once round hard cap is reached', async function () {
      skipNInvites(10);
      await presale.depositFor(await jeeva.getAddress(), HARD_CAP, ...nextInvite());
      await expect(presale.depositFor(await ash.getAddress(), toAtto(100), ...nextInvite()))
        .to.revertedWith("Presale: Round closed, goal reached");
    });

    it('should scale last deposit, as to not exceed hard cap', async function () {
      // skip the invites with maxInvestment of 1000
      skipNInvites(10);
      await presale.depositFor(await jeeva.getAddress(), toAtto(9900), ...nextInvite());
      await expect(async () => presale.depositFor(await ash.getAddress(), toAtto(1000), ...nextInvite()))
        .to.changeTokenBalance(purchaseToken, presale, toAtto(100))
      expect(await presale.totalAllocated()).eql(HARD_CAP);
    });

    it('No tokens claimable until vesting starts', async function () {
      await presale.depositFor(await jeeva.getAddress(), toAtto(100), ...nextInvite());
      await presale.depositFor(await ash.getAddress(), toAtto(300), ...nextInvite());

      expect(await presale.calculateClaimableNow(await jeeva.getAddress())).eql([0,0].map(BigNumber.from));
      expect(await presale.calculateClaimableNow(await ash.getAddress())).eql([0,0].map(BigNumber.from));
    });

    it('Can claim tokens instantly, when presale vestingDuration is 0 and vestingCliffDuration is 0', async function() {
      const investmentAmount = toAtto(1000);
      presale = await new Presale__factory(owner).deploy(
        HARD_CAP,
        investmentAmount,
        inviteMerkleTree.getRoot(),
        0,
        0,
        purchaseToken.address,
        await venture.getAddress()
      );
      await purchaseToken.approve(presale.address, toAtto(10000000000));

      await presale.depositFor(await jeeva.getAddress(), investmentAmount, ...nextInvite());
      await presale.depositFor(await ash.getAddress(), investmentAmount, ...nextInvite());

      await presale.setVentureToken(ventureToken.address);
      await ventureToken.transfer(presale.address, investmentAmount.mul(2));
      await presale.closeRound();

      await expect(async () => {
        await presale.claimFor(await jeeva.getAddress());
        await presale.claimFor(await ash.getAddress());
      }).to.changeTokenBalances(ventureToken, [jeeva, ash], [investmentAmount, investmentAmount]);
    });

    it('Can claim tokens, when presale vestingCliffDuration is 0', async function() {
      const investmentAmount = toAtto(1000);
      presale = await new Presale__factory(owner).deploy(
        HARD_CAP,
        investmentAmount,
        inviteMerkleTree.getRoot(),
        0,
        SECONDS_IN_ONE_WEEK,
        purchaseToken.address,
        await venture.getAddress()
      );
      await purchaseToken.approve(presale.address, toAtto(10000000000));

      await presale.depositFor(await jeeva.getAddress(), investmentAmount, ...nextInvite());
      await presale.depositFor(await ash.getAddress(), investmentAmount, ...nextInvite());

      await presale.setVentureToken(ventureToken.address);
      await ventureToken.transfer(presale.address, investmentAmount.mul(2));
      await presale.closeRound();

      // advance vesting duration
      await advance(SECONDS_IN_ONE_WEEK);

      await expect(async () => {
        await presale.claimFor(await jeeva.getAddress());
        await presale.claimFor(await ash.getAddress());
      }).to.changeTokenBalances(ventureToken, [jeeva, ash], [investmentAmount, investmentAmount]);
    });

    it('Can claim tokens, when presale vestingDuration is 0', async function() {
      const investmentAmount = toAtto(1000);
      presale = await new Presale__factory(owner).deploy(
        HARD_CAP,
        investmentAmount,
        inviteMerkleTree.getRoot(),
        SECONDS_IN_ONE_WEEK,
        0,
        purchaseToken.address,
        await venture.getAddress()
      );
      await purchaseToken.approve(presale.address, toAtto(10000000000));

      await presale.depositFor(await jeeva.getAddress(), investmentAmount, ...nextInvite());
      await presale.depositFor(await ash.getAddress(), investmentAmount, ...nextInvite());

      await presale.setVentureToken(ventureToken.address);
      await ventureToken.transfer(presale.address, investmentAmount.mul(2));
      await presale.closeRound();

      // advance vesting cliff duration
      await advance(SECONDS_IN_ONE_WEEK);

      await expect(async () => {
        await presale.claimFor(await jeeva.getAddress());
        await presale.claimFor(await ash.getAddress());
      }).to.changeTokenBalances(ventureToken, [jeeva, ash], [investmentAmount, investmentAmount]);
    });

    it('No tokens claimable during vesting cliff', async function () {
      await presale.setVentureToken(ventureToken.address)
      await presale.depositFor(await jeeva.getAddress(), toAtto(100), ...nextInvite());
      await presale.depositFor(await ash.getAddress(), toAtto(300), ...nextInvite());

      expect(await presale.calculateClaimableNow(await jeeva.getAddress())).eql([0,0].map(BigNumber.from));
      expect(await presale.calculateClaimableNow(await ash.getAddress())).eql([0,0].map(BigNumber.from));

      await advance(SECONDS_IN_ONE_WEEK / 2);
      expect(await presale.calculateClaimableNow(await jeeva.getAddress())).eql([0,0].map(BigNumber.from));
      expect(await presale.calculateClaimableNow(await ash.getAddress())).eql([0,0].map(BigNumber.from));
    });

    it('Can only set venture token once', async function () {
      await presale.setVentureToken(ventureToken.address)
      await expect(presale.setVentureToken(ventureToken.address))
        .to.revertedWith("Presale: Venture token already sent");

      expect(await presale.calculateClaimableNow(await jeeva.getAddress())).eql([0,0].map(BigNumber.from));
      expect(await presale.calculateClaimableNow(await ash.getAddress())).eql([0,0].map(BigNumber.from));

      await advance(SECONDS_IN_ONE_WEEK / 2);
      expect(await presale.calculateClaimableNow(await jeeva.getAddress())).eql([0,0].map(BigNumber.from));
      expect(await presale.calculateClaimableNow(await ash.getAddress())).eql([0,0].map(BigNumber.from));
    });

    it('Single Account claims fair share by end of vesting, if they make multiple claims', async function () {
      await presale.setVentureToken(ventureToken.address)
      await ventureToken.mint(presale.address, HARD_CAP)

      // skip the invites with maxInvestment of 1000
      skipNInvites(10);

      // Need to invest up to hurdle to be claimable
      await presale.depositFor(await jeeva.getAddress(), toAtto(1000), ...nextInvite());
      await presale.depositFor(await ash.getAddress(), toAtto(1000), ...nextInvite());
      await presale.depositFor(await INVESTOR3.getAddress(), toAtto(1000), ...nextInvite());
      await presale.depositFor(await INVESTOR4.getAddress(), toAtto(1000), ...nextInvite());
      await presale.depositFor(await INVESTOR5.getAddress(), toAtto(1000), ...nextInvite());

      await presale.closeRound();

      await expect(async () => {
        for (let i = 0; i < 10; i++) {
          await advance(SECONDS_IN_ONE_WEEK);
          await presale.claimFor(await jeeva.getAddress());
        }
      }).to.changeTokenBalance(ventureToken, jeeva, toAtto(10000 / 5))
    });

    it('Interleaved claims all result in the expected token amount', async function () {
      await presale.setVentureToken(ventureToken.address)
      await ventureToken.mint(presale.address, toAtto(10000))

      await presale.depositFor(await jeeva.getAddress(), toAtto(100), ...nextInvite());
      await presale.depositFor(await ash.getAddress(), toAtto(300), ...nextInvite());

      // Ensure Hurdle is met
      skipNInvites(8);

      await presale.depositFor(
        await INVESTOR3.getAddress(),
        HURDLE,
        ...nextInvite()
      );

      await presale.closeRound();

      for (let i = 0; i < 10; i++) {
        await advance(SECONDS_IN_ONE_WEEK);
        for (const signer of [jeeva, ash, INVESTOR3]) {
          const wallet = await signer.getAddress();
          const timestamp = await blockTimestamp();
          // Sends timestamp of a second ahead soo it pulls the same data as the following claimFor call
          const [_1, amount] = await presale.calculateClaimable(
            wallet,
            timestamp + 1
          );

          await expect(presale.claimFor(wallet))
            .to.emit(presale, "Claimed")
            .withArgs(wallet, amount);
        }
      }

      expect(await ventureToken.balanceOf(presale.address)).eq(0);
    });

    it('Should allow entire allocation to be claimed on round completion', async function () {
      await presale.setVentureToken(ventureToken.address)
      ventureToken.mint(presale.address, toAtto(10000))

      await presale.depositFor(await jeeva.getAddress(), toAtto(100), ...nextInvite());
      await presale.depositFor(await ash.getAddress(), toAtto(300), ...nextInvite());

      skipNInvites(8);
      await presale.depositFor(
        await INVESTOR3.getAddress(),
        HURDLE,
        ...nextInvite()
      );

      await presale.closeRound();

      await advance(SECONDS_IN_ONE_MONTH * 2);

      for (const signer of [jeeva, ash, INVESTOR3]) {
        const [_1, amount] = await presale.calculateClaimableNow(await signer.getAddress());

        await expect(presale.claimFor(await signer.getAddress()))
          .to.emit(presale, "Claimed")
          .withArgs(await signer.getAddress(), amount);

        expect(await ventureToken.balanceOf(await signer.getAddress())).eq(
          amount
        );
      }

      expect(await ventureToken.balanceOf(presale.address)).eq(0);
    });

    it("Invite code can only be used by a single wallet", async function () {
      await presale.setVentureToken(ventureToken.address);
      await ventureToken.mint(presale.address, toAtto(10000));

      const [min, max, hashedCode, merkleProof] =
        nextInvite();
      await presale.depositFor(
        await jeeva.getAddress(),
        toAtto(100),
        min,
        max,
        hashedCode,
        merkleProof
      );
      await expect(
        presale.depositFor(
          await ash.getAddress(),
          toAtto(300),
          min,
          max,
          hashedCode,
          merkleProof
        )
      ).to.revertedWith(SINGLE_WALLET_PER_INVITE_CODE_ERROR);
    });

    it("Investor investment can not exceed Invite Code maxInvestment", async () => {
      const [min, max, inviteCode, proof] =
        nextInvite();

      await expect(
        presale.depositFor(
          await jeeva.getAddress(),
          min,
          min,
          max,
          inviteCode,
          proof
        )
      ).to.emit(presale, "Deposited").withArgs(await jeeva.getAddress(), min);

      expect(await presale.allocation(await jeeva.getAddress())).eql(min);

      await expect(
        presale.depositFor(
          await jeeva.getAddress(),
          max,
          min,
          max,
          inviteCode,
          proof
        )
      ).to.emit(presale, "Deposited").withArgs(await jeeva.getAddress(), max.sub(min));

      expect(await presale.allocation(await jeeva.getAddress())).eql(max);

      await expect(
        presale.depositFor(
          await jeeva.getAddress(),
          toAtto(1),
          min,
          max,
          inviteCode,
          proof
        )
      ).to.emit(presale, "Deposited").withArgs(await jeeva.getAddress(), 0)

      expect(await presale.allocation(await jeeva.getAddress())).eql(max);
    });

    it('Invalid invite codes are not accepted', async function () {
      await presale.setVentureToken(ventureToken.address)
      ventureToken.mint(presale.address, toAtto(10000))

      const [hashedCode, merkleProof] = hashedInvite("invalid123", 10, 100);
      await expect(presale.depositFor(await ash.getAddress(), toAtto(300), toAtto(10), toAtto(100), hashedCode, merkleProof))
        .to.revertedWith("Presale: Invalid invite code")
    });

    it('Mismatched invite hash and merkle proof should fail', async function () {
      await presale.setVentureToken(ventureToken.address)
      ventureToken.mint(presale.address, toAtto(10000))

      const [min,max,hashedCode, _1] = nextInvite()
      const [_min,_max,_2, merkleProof] = nextInvite()
      await expect(presale.depositFor(await ash.getAddress(), toAtto(300),min,max, hashedCode, merkleProof))
        .to.revertedWith("Presale: Invalid invite code")
    });

    it("Not allowed to invest less than minimum investment", async () => {
      const [min, max, hashedCode, merkleProof] =
        nextInvite();
      await expect(
        presale.depositFor(
          await jeeva.getAddress(),
          min.sub(toAtto(1)),
          min,
          max,
          hashedCode,
          merkleProof
        )
      ).to.revertedWith(MINIMUM_INVESTMENT_LIMIT_ERROR);
    });

    it("Allowed to invest less than minimum at the time as long as, all up is more than minInvestment", async () => {
      const [min, max, hashedCode, merkleProof] =
        nextInvite();
      await expect(
        presale.depositFor(
          await jeeva.getAddress(),
          min.sub(toAtto(1)),
          min,
          max,
          hashedCode,
          merkleProof
        )
      ).to.revertedWith(MINIMUM_INVESTMENT_LIMIT_ERROR);

      await presale.depositFor(
        await jeeva.getAddress(),
        min,
        min,
        max,
        hashedCode,
        merkleProof
      );

      expect(await presale.allocation(await jeeva.getAddress())).eql(min);

      await presale.depositFor(
        await jeeva.getAddress(),
        min.div(2),
        min,
        max,
        hashedCode,
        merkleProof
      );

      expect(await presale.allocation(await jeeva.getAddress())).eql(
        min.add(min.div(2))
      );
    });

    it("Token are swap after round is closed and hurdle is not met", async () => {
      await presale.setVentureToken(ventureToken.address);
      await presale.depositFor(
        await jeeva.getAddress(),
        toAtto(100),
        ...nextInvite()
      );

      await presale.closeRound();
      expect(await presale.ventureToken()).eq(purchaseToken.address);
    });

    it("Investor can get refunds after round close and hurdle is not met", async () => {
      await presale.setVentureToken(ventureToken.address);
      await presale.depositFor(
        await jeeva.getAddress(),
        toAtto(100),
        ...nextInvite()
      );
      await presale.depositFor(
        await ash.getAddress(),
        toAtto(500),
        ...nextInvite()
      );

      await presale.depositFor(
        await INVESTOR3.getAddress(),
        toAtto(1000),
        ...nextInvite()
      );

      await presale.closeRound();
      expect(await presale.ventureToken()).eq(purchaseToken.address);

      await expect(presale.claimFor(await jeeva.getAddress()))
        .to.emit(presale, "Claimed")
        .withArgs(await jeeva.getAddress(), toAtto(100));
      await expect(presale.claimFor(await ash.getAddress()))
        .to.emit(presale, "Claimed")
        .withArgs(await ash.getAddress(), toAtto(500));
      await expect(presale.claimFor(await INVESTOR3.getAddress()))
        .to.emit(presale, "Claimed")
        .withArgs(await INVESTOR3.getAddress(), toAtto(1000));
    });

    it("Investor can get refunds when investing multiple times after round close and hurdle is not met", async () => {
      await presale.setVentureToken(ventureToken.address);
      await presale.depositFor(
        await jeeva.getAddress(),
        toAtto(100),
        ...nextInvite()
      );
      await presale.depositFor(
        await jeeva.getAddress(),
        toAtto(100),
        ...nextInvite()
      );
      await presale.depositFor(
        await ash.getAddress(),
        toAtto(500),
        ...nextInvite()
      );
      await presale.depositFor(
        await ash.getAddress(),
        toAtto(500),
        ...nextInvite()
      );

      await presale.depositFor(
        await INVESTOR3.getAddress(),
        toAtto(300),
        ...nextInvite()
      );
      await presale.depositFor(
        await INVESTOR3.getAddress(),
        toAtto(300),
        ...nextInvite()
      );

      await presale.closeRound();
      expect(await presale.ventureToken()).eq(purchaseToken.address);

      await expect(presale.claimFor(await jeeva.getAddress()))
        .to.emit(presale, "Claimed")
        .withArgs(await jeeva.getAddress(), toAtto(200));
      await expect(presale.claimFor(await ash.getAddress()))
        .to.emit(presale, "Claimed")
        .withArgs(await ash.getAddress(), toAtto(1000));
      await expect(presale.claimFor(await INVESTOR3.getAddress()))
        .to.emit(presale, "Claimed")
        .withArgs(await INVESTOR3.getAddress(), toAtto(600));
    });
  });
});
