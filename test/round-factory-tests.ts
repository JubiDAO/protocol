import { expect } from "chai";
import { BigNumber, Signer } from "ethers";
import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
import { toAtto } from "../shared/utils";
import {
  FakeERC20,
  FakeERC20__factory,
  RoundFactory,
  RoundFactory__factory,
  Presale,
  Presale__factory,
} from "../typechain";
import { InviteCodeRange } from "../types/invite-code";
import {
  generateInviteCodes,
  getInviteCodeHashedLeaf,
  inviteCodesToMerkleTree,
} from "../utils/invite-code";
// @ts-ignore
import PresaleConfigStruct = RoundFactory.PresaleConfigStruct;

const SECONDS_IN_ONE_WEEK = 604800;
const SECONDS_IN_ONE_MONTH = 2628000;
const ONLY_OWNER_ERROR = "Ownable: caller is not the owner";
const HARD_CAP = toAtto(10000);
const HURDLE = toAtto(10000).div(2);

describe("Round Factory Tests", () => {
  let roundFactory: RoundFactory;
  let presale: Presale;
  let owner: Signer;
  let airTree: Signer;
  let blackbird: Signer;
  let jeeva: Signer;
  let ash: Signer;
  let daoMultisig: Signer;
  let owner_address: string;
  let airTree_address: string;
  let blackbird_address: string;
  let jeeva_address: string;
  let ash_address: string;
  let raisedToken: FakeERC20;
  let issuedToken: FakeERC20;
  let inviteMerkleTree: MerkleTree;
  let inviteMerkleRoot: Buffer;
  let inviteCodesData: Map<string, InviteCodeRange>;
  let roundConfig: PresaleConfigStruct;

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

  const nextInvite = (): [BigNumber, BigNumber, Buffer, string[]] => {
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
  };

  beforeEach(async () => {
    [owner, airTree, blackbird, jeeva, ash, daoMultisig] =
      await ethers.getSigners();

    owner_address = await owner.getAddress();
    airTree_address = await airTree.getAddress();
    blackbird_address = await blackbird.getAddress();
    jeeva_address = await jeeva.getAddress();
    ash_address = await ash.getAddress();
    raisedToken = await new FakeERC20__factory(owner).deploy(
      "RAISED_TOKEN",
      "RAISED_TOKEN"
    );
    issuedToken = await new FakeERC20__factory(owner).deploy(
      "ISSUED_TOKEN",
      "ISSUED_TOKEN"
    );

    roundFactory = await new RoundFactory__factory().connect(owner).deploy();

    inviteCodesData = await generateInviteCodes([
      { qty: 10, minInvestment: 100, maxInvestment: 1000 },
      { qty: 10, minInvestment: 1000, maxInvestment: 10000 },
    ]);

    inviteMerkleTree = await inviteCodesToMerkleTree(inviteCodesData);
    inviteMerkleRoot = inviteMerkleTree.getRoot();

    roundConfig = {
      daoMultisig: airTree_address,
      hardCap: HARD_CAP,
      hurdle: HURDLE,
      raiseToken: raisedToken.address,
      vestingCliffDuration: SECONDS_IN_ONE_WEEK,
      vestingDuration: SECONDS_IN_ONE_MONTH,
      inviteCodesMerkleRoot: inviteMerkleRoot,
    };
  });

  describe("Deployment/Management", () => {
    it("should set the right owner", async () => {
      expect(await roundFactory.owner()).to.equal(await owner.getAddress());
    });

    it("should allow owner to renounce", async () => {
      await roundFactory.renounceOwnership();
      expect(await roundFactory.owner()).to.equal(ethers.constants.AddressZero);
    });

    it("should allow owner to transfer ownership", async () => {
      await roundFactory.transferOwnership(await airTree.getAddress());
      expect(await roundFactory.owner()).to.equal(await airTree.getAddress());
    });

  });

  describe("TXNs", () => {
    describe("Round Creation", () => {
      it("should create a round", async () => {
        let rounds = await roundFactory.getRounds(owner_address);
        expect(rounds.length).eq(0);
        await roundFactory.createRound(roundConfig);

        rounds = await roundFactory.getRounds(owner_address);
        expect(rounds.length).eq(1);

        const eventFilters = roundFactory.filters.RoundCreated();
        const events = await roundFactory.queryFilter(eventFilters, "latest");
        const [ventureAddress, roundAddress] = events[0].args;

        expect(ventureAddress).to.equal(owner_address);

        expect(roundAddress.toLowerCase()).to.equal(rounds[0]);
      });

      it("should create multiple rounds for same Venture", async () => {
        let rounds = await roundFactory.getRounds(owner_address);
        expect(rounds.length).eq(0);
        for (let i = 0; i < 3; i++) {
          await roundFactory.createRound(roundConfig);
          rounds = await roundFactory.getRounds(owner_address);
          expect(rounds.length).eq(i + 1);

          const eventFilters = roundFactory.filters.RoundCreated();
          const events = await roundFactory.queryFilter(eventFilters, "latest");
          const [ventureAddress, roundAddress] = events[0].args;
          expect(ventureAddress).to.equal(owner_address);
          expect(roundAddress.toLowerCase()).to.equal(rounds[i]);
        }
      });

      it("should create multiple rounds for multiple Ventures", async () => {
        for (const venture of [airTree, blackbird]) {
          const ventureAddressCheck: string = await venture.getAddress();
          let rounds = await roundFactory.getRounds(ventureAddressCheck);
          for (let i = 0; i < 3; i++) {
            expect(rounds.length).eq(i);
            await roundFactory.connect(venture).createRound(roundConfig);
            rounds = await roundFactory.getRounds(ventureAddressCheck);

            const eventFilters = roundFactory.filters.RoundCreated();
            const events = await roundFactory.queryFilter(
              eventFilters,
              "latest"
            );

            const [ventureAddress, roundAddress] = events[0].args;
            expect(ventureAddress).to.equal(ventureAddressCheck);
            expect(roundAddress.toLowerCase()).to.equal(rounds[i]);
          }
        }
      });
    });

    describe("Rounds", () => {
      beforeEach(async () => {
        let rounds = await roundFactory.getRounds(owner_address);
        expect(rounds.length).eq(0);
        await roundFactory.createRound(roundConfig);

        rounds = await roundFactory.getRounds(owner_address);
        expect(rounds.length).eq(1);

        const eventFilters = roundFactory.filters.RoundCreated();
        const events = await roundFactory.queryFilter(eventFilters, "latest");
        const [ventureAddress, roundAddress] = events[0].args;
        expect(ventureAddress).to.equal(owner_address);
        expect(roundAddress.toLowerCase()).to.equal(rounds[0]);
        presale = new Presale__factory(owner).attach(roundAddress);

        await raisedToken.mint(owner_address, toAtto(10000000000));
        await raisedToken.approve(presale.address, toAtto(10000000000));
      });

      describe("Management", () => {
        it("should set the right owner", async () => {
          expect(await presale.owner()).to.equal(owner_address);
        });
        it("should only allow owner to close round", async () => {
          await expect(presale.connect(blackbird).closeRound())
            .to.revertedWith(ONLY_OWNER_ERROR);

          await presale.connect(owner).closeRound();
          expect(await presale.isOpen()).false;
        });
      });

      describe("Round Interactions", () => {
        it("should be able to interact with a created Round", async () => {
          await presale.depositFor(
            jeeva_address,
            toAtto(100),
            ...nextInvite()
          );
          await presale.depositFor(
            ash_address,
            toAtto(500),
            ...nextInvite()
          );

          expect(await presale.allocation(jeeva_address)).eql(toAtto(100));
          expect(await presale.allocation(ash_address)).eql(toAtto(500));
          expect(await presale.totalAllocated()).eql(toAtto(600));
        });
      });
    });
  });
});
