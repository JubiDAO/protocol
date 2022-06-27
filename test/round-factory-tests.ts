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
  let PRESALE: Presale;
  let OWNER: Signer;
  let VENTURE1: Signer;
  let VENTURE2: Signer;
  let INVESTOR1: Signer;
  let INVESTOR2: Signer;
  let INVESTOR3: Signer;
  let daoMultisig: Signer;
  let OWNER_ADDRESS: string;
  let VENTURE1_ADDRESS: string;
  let VENTURE2_ADDRESS: string;
  let INVESTOR1_ADDRESS: string;
  let INVESTOR2_ADDRESS: string;
  let RAISED_TOKEN: FakeERC20;
  let ISSUED_TOKEN: FakeERC20;
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
    [OWNER, VENTURE1, VENTURE2, INVESTOR1, INVESTOR2, INVESTOR3, daoMultisig] =
      await ethers.getSigners();

    OWNER_ADDRESS = await OWNER.getAddress();
    VENTURE1_ADDRESS = await VENTURE1.getAddress();
    VENTURE2_ADDRESS = await VENTURE2.getAddress();
    INVESTOR1_ADDRESS = await INVESTOR1.getAddress();
    INVESTOR2_ADDRESS = await INVESTOR2.getAddress();
    RAISED_TOKEN = await new FakeERC20__factory(OWNER).deploy(
      "RAISED_TOKEN",
      "RAISED_TOKEN"
    );
    ISSUED_TOKEN = await new FakeERC20__factory(OWNER).deploy(
      "ISSUED_TOKEN",
      "ISSUED_TOKEN"
    );

    roundFactory = await new RoundFactory__factory().connect(OWNER).deploy();

    inviteCodesData = await generateInviteCodes([
      { qty: 10, minInvestment: 100, maxInvestment: 1000 },
      { qty: 10, minInvestment: 1000, maxInvestment: 10000 },
    ]);

    inviteMerkleTree = await inviteCodesToMerkleTree(inviteCodesData);
    inviteMerkleRoot = inviteMerkleTree.getRoot();

    roundConfig = {
      daoMultisig: VENTURE1_ADDRESS,
      hardCap: HARD_CAP,
      hurdle: HURDLE,
      raiseToken: RAISED_TOKEN.address,
      vestingCliffDuration: SECONDS_IN_ONE_WEEK,
      vestingDuration: SECONDS_IN_ONE_MONTH,
      inviteCodesMerkleRoot: inviteMerkleRoot,
    };
  });

  describe("Deployment/Management", () => {
    it("should set the right owner", async () => {
      expect(await roundFactory.owner()).to.equal(await OWNER.getAddress());
    });

    it("should allow owner to renounce", async () => {
      await roundFactory.renounceOwnership();
      expect(await roundFactory.owner()).to.equal(ethers.constants.AddressZero);
    });

    it("should allow owner to transfer ownership", async () => {
      await roundFactory.transferOwnership(await VENTURE1.getAddress());
      expect(await roundFactory.owner()).to.equal(await VENTURE1.getAddress());
    });

  });

  describe("TXNs", () => {
    describe("Round Creation", () => {
      it("should create a round", async () => {
        let rounds = await roundFactory.getRounds(OWNER_ADDRESS);
        expect(rounds.length).eq(0);
        await roundFactory.createRound(roundConfig);

        rounds = await roundFactory.getRounds(OWNER_ADDRESS);
        expect(rounds.length).eq(1);

        const eventFilters = roundFactory.filters.RoundCreated();
        const events = await roundFactory.queryFilter(eventFilters, "latest");
        const [ventureAddress, roundAddress] = events[0].args;

        expect(ventureAddress).to.equal(OWNER_ADDRESS);

        expect(roundAddress.toLowerCase()).to.equal(rounds[0]);
      });

      it("should create multiple rounds for same Venture", async () => {
        let rounds = await roundFactory.getRounds(OWNER_ADDRESS);
        expect(rounds.length).eq(0);
        for (let i = 0; i < 3; i++) {
          await roundFactory.createRound(roundConfig);
          rounds = await roundFactory.getRounds(OWNER_ADDRESS);
          expect(rounds.length).eq(i + 1);

          const eventFilters = roundFactory.filters.RoundCreated();
          const events = await roundFactory.queryFilter(eventFilters, "latest");
          const [ventureAddress, roundAddress] = events[0].args;
          expect(ventureAddress).to.equal(OWNER_ADDRESS);
          expect(roundAddress.toLowerCase()).to.equal(rounds[i]);
        }
      });

      it("should create multiple rounds for multiple Ventures", async () => {
        for (const venture of [VENTURE1, VENTURE2]) {
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
        let rounds = await roundFactory.getRounds(OWNER_ADDRESS);
        expect(rounds.length).eq(0);
        await roundFactory.createRound(roundConfig);

        rounds = await roundFactory.getRounds(OWNER_ADDRESS);
        expect(rounds.length).eq(1);

        const eventFilters = roundFactory.filters.RoundCreated();
        const events = await roundFactory.queryFilter(eventFilters, "latest");
        const [ventureAddress, roundAddress] = events[0].args;
        expect(ventureAddress).to.equal(OWNER_ADDRESS);
        expect(roundAddress.toLowerCase()).to.equal(rounds[0]);
        PRESALE = new Presale__factory(OWNER).attach(roundAddress);

        await RAISED_TOKEN.mint(OWNER_ADDRESS, toAtto(10000000000));
        await RAISED_TOKEN.approve(PRESALE.address, toAtto(10000000000));
      });

      describe("Management", () => {
        it("should set the right owner", async () => {
          expect(await PRESALE.owner()).to.equal(OWNER_ADDRESS);
        });
        it("should only allow owner to close round", async () => {
          await expect(PRESALE.connect(VENTURE2).closeRound())
            .to.revertedWith(ONLY_OWNER_ERROR);

          await PRESALE.connect(OWNER).closeRound();
          expect(await PRESALE.isOpen()).false;
        });
      });

      describe("Round Interactions", () => {
        it("should be able to interact with a created Round", async () => {
          await PRESALE.depositFor(
            INVESTOR1_ADDRESS,
            toAtto(100),
            ...nextInvite()
          );
          await PRESALE.depositFor(
            INVESTOR2_ADDRESS,
            toAtto(500),
            ...nextInvite()
          );

          expect(await PRESALE.allocation(INVESTOR1_ADDRESS)).eql(toAtto(100));
          expect(await PRESALE.allocation(INVESTOR2_ADDRESS)).eql(toAtto(500));
          expect(await PRESALE.totalAllocated()).eql(toAtto(600));
        });
      });
    });
  });
});
