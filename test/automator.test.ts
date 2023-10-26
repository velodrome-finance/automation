import hre from "hardhat";
import { expect } from "chai";
import { before } from "mocha";
const { ethers, deployments, w3f } = hre;

import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";

import {
  time,
  setBalance,
  impersonateAccount,
  stopImpersonatingAccount,
} from "@nomicfoundation/hardhat-network-helpers";

import jsonOutput from "../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";
import {
  seedRelayWithBalances,
  createAutoCompounder,
  logW3fRunStats,
  setBalanceOf,
  storageSlots,
} from "./utils";
import { IVotingEscrow } from "../typechain/relay-private/lib/contracts/contracts/interfaces/IVotingEscrow";
import { IERC20 } from "../typechain/openzeppelin-contracts/contracts/token/ERC20/IERC20";
import { AutoCompounderFactory } from "../typechain/relay-private/src/autoCompounder";
import { abi as erc20Abi } from "../web3-functions/relay-automation/abis/erc20.json";
import { Registry } from "../typechain/relay-private/src";

import {
  KEEPER_REGISTRY_ADDRESS,
  RELAY_REGISTRY_ADDRESS,
  COMPOUNDER_TOKEN_ID,
  HOUR,
  DAY,
} from "../web3-functions/relay-automation/utils/constants";

async function logRelayBalances(relays, tokensToCompound, mTokens, escrow) {
  for (const i in relays) {
    console.log(
      "========================= // RESULTS // ========================="
    );
    console.log(`Current Relay: ${relays[i]}`);
    for (const token of tokensToCompound) {
      console.log(
        `TOKEN: ${token.address}, Amount: ${await token.balanceOf(relays[i])}`
      );
    }
    console.log(
      "-----------------------------------------------------------------"
    );
    console.log(`VE Amount: ${await escrow.balanceOfNFT(mTokens[i])}`);
  }
  console.log(
    "=========================-//-=======-//-========================="
  );
}

describe("AutoCompounder Automation Script Tests", function () {
  let relayW3f: Web3FunctionHardhat;
  let owner: SignerWithAddress;
  const RELAYS_TO_TEST = 1;

  let dai: IERC20;
  let usdc: IERC20;
  let weth: IERC20;
  let velo: IERC20;
  let relays: string[];
  let tokenNames: string[];
  let escrow: IVotingEscrow;
  let keeperRegistry: Registry;
  let mTokens: BigNumber[] = [];
  let relayFactoryRegistry: Registry;
  let tokensToCompound: Contract[] = [];
  let autoCompounderFactory: AutoCompounderFactory;

  before(async function () {
    await deployments.fixture();
    [owner] = await hre.ethers.getSigners();

    // Setting up Registries, Factories and Tokens to be Compounded in tests
    relayFactoryRegistry = await ethers.getContractAt(
      "Registry",
      RELAY_REGISTRY_ADDRESS
    );
    keeperRegistry = await ethers.getContractAt(
      "Registry",
      KEEPER_REGISTRY_ADDRESS
    );
    const factories: string[] = await relayFactoryRegistry.getAll();
    autoCompounderFactory = await ethers.getContractAt(
      "AutoCompounderFactory",
      factories[0]
    );

    tokenNames = ["dai", "usdc", "weth", "velo"]; // Tokens to be Compounded while testing Relays
    tokensToCompound = await Promise.all(
      tokenNames.map((name) =>
        ethers.getContractAt(erc20Abi, storageSlots[name].address)
      )
    );
    [dai, usdc, weth, velo] = tokensToCompound;

    escrow = await ethers.getContractAt(
      "IVotingEscrow",
      jsonOutput.VotingEscrow
    );

    // Mint VELO to test user
    await setBalanceOf(owner.address, storageSlots["velo"], 1000);

    // Setting owner as Keeper
    let allowedManager = await keeperRegistry.owner();
    await setBalance(allowedManager, 100e18);
    await impersonateAccount(allowedManager);
    let manager = await ethers.getSigner(allowedManager);

    // Approve test user as Keeper
    let tx = await keeperRegistry.populateTransaction.approve(owner.address);
    await manager.sendTransaction({ ...tx, from: allowedManager });
    await stopImpersonatingAccount(allowedManager);

    // Create multiple AutoCompounders and save their mTokenId's
    mTokens.push(BigNumber.from(COMPOUNDER_TOKEN_ID)); // On-Chain AutoCompounder's TokenID from current block
    for (let i = 0; i < RELAYS_TO_TEST; i++)
      mTokens.push(
        await createAutoCompounder(autoCompounderFactory, velo, escrow, owner)
      );

    // Fetch all the AutoCompounders and seed them with Tokens
    relays = await autoCompounderFactory.relays();
    for (const relay of relays.slice(1)) {
      // Only seed created Relays
      await seedRelayWithBalances(relay, storageSlots);
    }

    // Warp to the last timestamp of the First Hour of Epoch
    let timestamp = await time.latest();
    let endOfFirstHour = timestamp - (timestamp % (7 * DAY)) + HOUR;
    let newTimestamp =
      endOfFirstHour >= timestamp ? endOfFirstHour : endOfFirstHour + 6 * DAY; // cannot exceed current epoch
    time.increaseTo(newTimestamp);

    relayW3f = w3f.get("relay-automation");
  });
  it("Test AutoCompounder Automation Flow", async () => {
    // All balances were minted correctly for all Relays
    let oldBalances = [];
    await logRelayBalances(relays, tokensToCompound, mTokens, escrow);
    for (const i in relays) {
      let oldBal = await escrow.balanceOfNFT(mTokens[i]);
      oldBalances.push(oldBal);

      if (!Number(i))
        // ignore setup verification for first relay as no balances are being sent to it
        continue;
      expect(oldBal).to.equal(BigNumber.from(10).pow(19));
      for (const j in tokensToCompound) {
        const token = tokensToCompound[j];

        const bal = token === weth ? 10 : token === velo ? 100_000 : 10_000;
        const decimals = BigNumber.from(10).pow(
          storageSlots[tokenNames[j]].decimals
        );
        const expectedBalance = BigNumber.from(bal).mul(decimals);

        expect(await token.balanceOf(relays[i])).eq(expectedBalance);
      }
    }

    // Hardcoding Storage for this test to ignore AutoConverter Factory
    let storageBefore = {
      currRelay: relays[0],
      relaysQueue: JSON.stringify(relays.slice(1)),
      currFactory: autoCompounderFactory.address,
      factoriesQueue: "[]",
      isAutoCompounder: "true",
      currStage: "claim",
      offset: "0",
    };
    let currentStage = "claim";
    let result, storageAfter;
    let numberOfRuns = 0;
    let rpcCalls = 0;
    // Execute script until the automation is finished
    while (!storageBefore.lastRunTimestamp) {
      // Executes Script
      let run = await relayW3f.run({ storage: storageBefore });
      ({ result, storage: storageAfter } = run);
      if (storageAfter.storage.currStage != currentStage) {
        // If state changes, Log Relay Balances
        await logRelayBalances(
          [storageBefore.currRelay],
          tokensToCompound,
          mTokens,
          escrow
        );
        currentStage = storageAfter.storage.currStage ?? "";
      }

      // Logging Info
      rpcCalls += run.rpcCalls.total;
      numberOfRuns += 1;
      logW3fRunStats(run);

      // Sending Generated Transactions
      if (result.canExec) {
        expect(result.callData.length).to.gt(0);
        for (let call of result.callData) {
          await owner.sendTransaction({ to: call.to, data: call.data });
        }
      } else expect(result.message).to.equal("No transactions to broadcast.");
      storageBefore = storageAfter.storage;
    }

    // All balances were Swapped to VELO and compounded correctly for all Relays
    await logRelayBalances(relays, tokensToCompound, mTokens, escrow);
    for (const i in relays) {
      for (const token of tokensToCompound) {
        expect(await token.balanceOf(relays[i])).to.equal(0);
      }
      expect(await escrow.balanceOfNFT(mTokens[i])).to.above(oldBalances[i]);
    }
  });
  it("Loads storage with Relays to Process", async () => {
    // First Run With Empty Storage
    let timestamp = await time.latest();
    const endOfFirstHourCurrentEpoch =
      timestamp - (timestamp % (7 * DAY)) + HOUR;
    let storageBefore = relayW3f.getStorage(); // Setting LastRun timestamp
    storageBefore["keeperLastRun"] = endOfFirstHourCurrentEpoch.toString();
    // Forward to next Epoch and Run Automation
    await time.increaseTo(endOfFirstHourCurrentEpoch + 7 * DAY + 1);
    let run = await relayW3f.run({ storage: storageBefore });
    let { result, storage: storageAfter } = run;
    logW3fRunStats(run);
    expect(result.canExec).to.equal(true);
    expect(
      JSON.parse(storageAfter.storage["relaysQueue"] as string).length
    ).to.equal(RELAYS_TO_TEST); // The relay being processed is the one already on chain
  });
  it("Cannot execute if LastRun has happened in same epoch", async () => {
    let timestamp = await time.latest();
    const endOfFirstHourNextEpoch =
      timestamp - (timestamp % (7 * DAY)) + HOUR + 7 * DAY;

    let storageBefore = relayW3f.getStorage();
    // Setting Last run as the End of First day of Current Epoch
    storageBefore["keeperLastRun"] = endOfFirstHourNextEpoch.toString();
    await time.increaseTo(endOfFirstHourNextEpoch);
    let run = await relayW3f.run();
    let result = run.result;
    logW3fRunStats(run);
    // Cannot exec if last run happened in same epoch
    expect(result.canExec).to.equal(false);

    await time.increase(7 * DAY); // Skipping until the last Timestamp of the End of First day of Next Epoch
    run = await relayW3f.run();
    result = run.result;
    // Cannot exec for whole epoch, as previous execution happened in it
    expect(result.canExec).to.equal(false);

    // Can exec if last run happened before the start of second hour of current epoch
    await time.increase(1); // Skipping to start of Second day
    run = await relayW3f.run();
    result = run.result;
    // Can exec from the start of Second Day
    expect(result.canExec).to.equal(true);
  });
});
