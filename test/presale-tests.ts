import { BigNumber, Signer } from 'ethers';
import { expect } from 'chai';
import { ethers } from 'hardhat';

import { FakeERC20, FakeERC20__factory, Presale, Presale__factory } from '../typechain';
import { blockTimestamp, toAtto } from '../shared/utils';
import { advance } from '../shared/localdev-heplers';

const SECONDS_IN_ONE_WEEK = 604800;
const SECONDS_IN_ONE_MONTH = 2628000;
const ONLY_OWNER_ERROR = 'Ownable: caller is not the owner';

describe('Dogfood Presale Tests', function () {
  let presale: Presale;
  let owner: Signer;
  let ash: Signer;
  let jeeva: Signer;
  let nonInvestor: Signer;
  let daoMultisig: Signer;
  let usdcToken: FakeERC20;
  let issuedToken: FakeERC20;

  beforeEach(async function () {
    [owner, ash, jeeva, nonInvestor, daoMultisig] = await ethers.getSigners();

    usdcToken = await new FakeERC20__factory(owner).deploy("Fake USDC", "USDC");
    issuedToken = await new FakeERC20__factory(owner).deploy("Fake Issued Token", "TOKEN");

    const now = await blockTimestamp()
    presale = await new Presale__factory(owner).deploy(
      toAtto(1000),
      now + SECONDS_IN_ONE_WEEK,
      SECONDS_IN_ONE_MONTH,
      usdcToken.address,
      await daoMultisig.getAddress()
    );

    await usdcToken.mint(await owner.getAddress(), toAtto(10000000000));
    await usdcToken.approve(presale.address, toAtto(10000000000));

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

    it('should allow the setting the token issued', async function () {
      expect(await presale.issuedToken()).to.equal(ethers.constants.AddressZero);
      await presale.setIssuedToken(issuedToken.address);
      expect(await presale.issuedToken()).to.equal(issuedToken.address);
    });

    it('only the owner can set the issued token', async function () {
      await expect(presale.connect(jeeva).setIssuedToken(issuedToken.address))
        .to.revertedWith(ONLY_OWNER_ERROR);
    });

    it('only the owner can manually close the round', async function () {
      await expect(presale.connect(jeeva).closeRound())
        .to.revertedWith(ONLY_OWNER_ERROR);
    });
  });

  describe('Transactions', function () {
    it('should allow users to deposit, while round is open', async function () {
      await expect(async () => {
        await presale.depositFor(await jeeva.getAddress(), toAtto(100));
        await presale.depositFor(await ash.getAddress(), toAtto(50));
      }).to.changeTokenBalance(usdcToken, daoMultisig, toAtto(150));

      expect(await presale.allocation(await jeeva.getAddress())).eql(toAtto(100));
      expect(await presale.allocation(await ash.getAddress())).eql(toAtto(50));
    });

    it('should block deposits, once round is closed', async function () {
      await presale.closeRound();
      await expect(presale.depositFor(await ash.getAddress(), toAtto(100)))
        .to.revertedWith("Presale: Round closed");
    });

    it('should block deposits, once round hard cap is reached', async function () {
      await presale.depositFor(await jeeva.getAddress(), toAtto(1000));
      await expect(presale.depositFor(await ash.getAddress(), toAtto(100)))
        .to.revertedWith("Presale: Round closed, goal reached");
    });

    it('should scale last deposit, as to not exceed round close', async function () {
      await presale.depositFor(await jeeva.getAddress(), toAtto(990));
      await expect(async () => presale.depositFor(await ash.getAddress(), toAtto(100)))
        .to.changeTokenBalance(usdcToken, daoMultisig, toAtto(10))
    });

    it('No tokens claimable until vesting starts', async function () {
      await presale.depositFor(await jeeva.getAddress(), toAtto(100));
      await presale.depositFor(await ash.getAddress(), toAtto(300));

      expect(await presale.calculateClaimable(await jeeva.getAddress())).eql([0,0].map(BigNumber.from));
      expect(await presale.calculateClaimable(await ash.getAddress())).eql([0,0].map(BigNumber.from));
    });

    it('Single Account claims fair share by end of vesting, if they make multiple claims', async function () {
      await presale.setIssuedToken(issuedToken.address)
      issuedToken.mint(presale.address, toAtto(10000))

      await presale.depositFor(await jeeva.getAddress(), toAtto(100));
      await presale.depositFor(await ash.getAddress(), toAtto(300));

      await expect(async () => {
        for (let i = 0; i < 10; i++) {
          await advance(SECONDS_IN_ONE_WEEK);
          await presale.claimFor(await jeeva.getAddress());
        }
      }).to.changeTokenBalance(issuedToken, jeeva, toAtto(10000 / 4))
    });

    it('Interleaved claims all result in the expected token amount', async function () {
      await presale.setIssuedToken(issuedToken.address)
      issuedToken.mint(presale.address, toAtto(10000))

      await presale.depositFor(await jeeva.getAddress(), toAtto(100));
      await presale.depositFor(await ash.getAddress(), toAtto(300));

      await expect(async () => {
        for (let i = 0; i < 10; i++) {
          await advance(SECONDS_IN_ONE_WEEK);
          await presale.claimFor(await jeeva.getAddress());
          await presale.claimFor(await ash.getAddress());
        }
      }).to.changeTokenBalances(issuedToken, [jeeva,ash], [toAtto(10000 / 4), toAtto(10000 * 3 / 4)])

      expect(await issuedToken.balanceOf(presale.address)).eq(0);
    });

    it('Should allow entire allocation to be claimed on round completion', async function () {
      await presale.setIssuedToken(issuedToken.address)
      issuedToken.mint(presale.address, toAtto(10000))

      await presale.depositFor(await jeeva.getAddress(), toAtto(100));
      await presale.depositFor(await ash.getAddress(), toAtto(300));

      await expect(async () => {
        await advance(SECONDS_IN_ONE_WEEK * 2 + SECONDS_IN_ONE_MONTH);
        await presale.claimFor(await jeeva.getAddress());
        await presale.claimFor(await ash.getAddress());
      }).to.changeTokenBalances(issuedToken, [jeeva,ash], [toAtto(10000 / 4), toAtto(10000 * 3 / 4)])

      expect(await issuedToken.balanceOf(presale.address)).eq(0);
    });
  });
});
