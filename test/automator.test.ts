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
import { createAutoCompounder, logW3fRunStats, seedRelayWithBalances, setBalanceOf, storageSlots } from "./utils";
import { IVotingEscrow } from "../typechain/relay-private/lib/contracts/contracts/interfaces/IVotingEscrow";
import { IERC20 } from "../typechain/openzeppelin-contracts/contracts/token/ERC20/IERC20";
import { AutoCompounderFactory } from "../typechain/relay-private/src/autoCompounder";
import { abi as erc20Abi } from "../web3-functions/relay-automation/abis/erc20.json";
import lpSugarAbi from "../web3-functions/relay/abis/lp_sugar.json";
import { Registry } from "../typechain/relay-private/src";

import {
  KEEPER_REGISTRY_ADDRESS,
  RELAY_REGISTRY_ADDRESS,
  LP_SUGAR_ADDRESS,
  HOUR,
  DAY,
} from "../web3-functions/relay-automation/utils/constants";

async function logRelayBalances(relays, tokensToCompound, mTokens, escrow) {
    for (const i in relays) {
      console.log("========================= // RESULTS // =========================");
      console.log(`Current Relay: ${relays[i]}`);
      for (const token of tokensToCompound) {
        console.log(`TOKEN: ${token.address}, Amount: ${await token.balanceOf(relays[i])}`)
      }
      console.log("-----------------------------------------------------------------");
      console.log(`VE Amount: ${await escrow.balanceOfNFT(mTokens[i])}`);
    }
    console.log("=========================-//-=======-//-=========================");
}

describe("Automation Script Tests", function () {
  let relayW3f: Web3FunctionHardhat;
  let owner: SignerWithAddress;
  const RELAYS_TO_TEST = 1;

  let dai: IERC20;
  let usdc: IERC20;
  let weth: IERC20;
  let velo: IERC20;
  let relays: string[];
  let tokenNames: string[];
  let tokensToCompound: Contract[] = [];
  let escrow: IVotingEscrow;
  let keeperRegistry: Registry;
  let mTokens: BigNumber[] = [];
  let relayFactoryRegistry: Registry;

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
    const autoCompounderFactory: AutoCompounderFactory =
      await ethers.getContractAt("AutoCompounderFactory", factories[0]);

    tokenNames = ["dai", "usdc", "weth", "velo"]; // Tokens to be Compounded while testing Relays
    tokensToCompound = await Promise.all(tokenNames.map(name => ethers.getContractAt(erc20Abi, storageSlots[name].address)));
    [dai, usdc, weth, velo] = tokensToCompound;

    escrow = await ethers.getContractAt(
      "IVotingEscrow",
      jsonOutput.VotingEscrow
    );

    // Mint VELO to test user
    await setBalanceOf(owner.address, storageSlots["velo"], 10_000); //TODO: this bal could be smaller

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
    //TODO: Move AutoCompounderId to constants
    mTokens.push(BigNumber.from(19041)); // On-Chain AutoCompounder's TokenID from current block 
    for (let i = 0; i < RELAYS_TO_TEST; i++)
      mTokens.push(
        await createAutoCompounder(autoCompounderFactory, velo, escrow, owner)
      );

    // Fetch all the AutoCompounders and seed them with Tokens
    relays = await autoCompounderFactory.relays();
    console.log("THESE ARE THE TESTING RELAYS");
    console.log(relays);
    for (const relay of relays.slice(1)) { // Only seed created Relays
      await seedRelayWithBalances(relay, storageSlots);
    }

    // TODO: Should warp to last timestamp of First Day's Hour
    // Warp to the last timestamp of the First Hour of Epoch
    let timestamp = await time.latest();
    // TODO: Uncomment this when Relay Lib is updated
    // let endOfFirstHour = timestamp - (timestamp % (7 * DAY)) + HOUR;
    let endOfFirstHour = timestamp - (timestamp % (7 * DAY)) + DAY;
    let newTimestamp =
      endOfFirstHour >= timestamp ? endOfFirstHour : endOfFirstHour + 7 * DAY;
    time.increaseTo(newTimestamp);

    relayW3f = w3f.get("relay-automation");

    // // TODO: Should I uncomment this?
    // Warm up hardhat cache for lpSugar calls
    const lpSugarContract = await ethers.getContractAt(
      lpSugarAbi,
      LP_SUGAR_ADDRESS
    );
    // await lpSugarContract.forSwaps(150, 0);
    await lpSugarContract.rewards(BigNumber.from(100), BigNumber.from(0), BigNumber.from(19041));
  });
   it("Test Automator Flow", async () => {
     // All balances were minted correctly for all Relays
     let oldBalances = [];
     await logRelayBalances(relays, tokensToCompound, mTokens, escrow);
     for (const i in relays) {
       let oldBal = await escrow.balanceOfNFT(mTokens[i]);
       oldBalances.push(oldBal);

       if(!Number(i)) // ignore setup verification for first relay as no balances are being sent to it
         continue;
       expect(oldBal).to.equal(BigNumber.from(10).pow(18));
       for (const j in tokensToCompound) {
         const token = tokensToCompound[j];

         const bal = token === weth ? 10 : token === velo ? 100_000 : 10_000;
         const decimals = BigNumber.from(10).pow(storageSlots[tokenNames[j]].decimals);
         const expectedBalance = BigNumber.from(bal).mul(decimals);

         expect(await token.balanceOf(relays[i])).eq(expectedBalance);
       }
     }

     let storageBefore = relayW3f.getStorage();
     let currentStage = "claim";
     let result, storageAfter;
     let numberOfRuns = 0;
     let rpcCalls = 0;
     // Execute script until the automation is finished
     while(!storageBefore.lastRunTimestamp) {
         console.log("======================================== // NEW RUN // ========================================");
         // Executes Script
         let run = await relayW3f.run({storage: storageBefore});
         ({result, storage: storageAfter} = run);
         if(storageAfter.storage.currStage != currentStage) { // If state changes, Log Relay Balances
           await logRelayBalances([storageBefore.currRelay], tokensToCompound, mTokens, escrow);
           currentStage = storageAfter.storage.currStage ?? "";
         }

         // Logging Info
         rpcCalls += run.rpcCalls.total;
         numberOfRuns += 1;
         logW3fRunStats(run);

         // Sending Generated Transactions
         expect(result.canExec).to.equal(true);
         for (let call of result.callData) {
           await owner.sendTransaction({ to: call.to, data: call.data });
         }
         storageBefore = storageAfter.storage;
     }
     console.log(`ALL RPC CALLS: ${rpcCalls}`);
     console.log(`Number of Runs: ${numberOfRuns}`);
     console.log(storageAfter);

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
    let storageBefore = relayW3f.getStorage();
    // First Run With Empty Storage
    let run = await relayW3f.run({storage: storageBefore});
    let {result, storage: storageAfter} = run;
    logW3fRunStats(run);
    expect(result.canExec).to.equal(true);
    expect(JSON.parse(storageAfter.storage["relaysQueue"] as string).length).to.equal(RELAYS_TO_TEST); // The relay being processed is the one already on chain
  });
  it("Cannot execute if LastRun has happened in same epoch", async () => {
    let timestamp = await time.latest();
    // TODO: Refactor to endOfFirstHour when RelayLib is updated
    const endOfFirstDayCurrentEpoch = timestamp - (timestamp % (7 * DAY)) + DAY;

    let storageBefore = relayW3f.getStorage();
    // Cannot exec if last run happened in same epoch
    storageBefore["keeperLastRun"] = endOfFirstDayCurrentEpoch.toString(); 
    let run = await relayW3f.run();
    let result = run.result;
    logW3fRunStats(run);
    expect(result.canExec).to.equal(false);

    // Can exec if last run happened before the start of second day of current epoch
    storageBefore["keeperLastRun"] = (endOfFirstDayCurrentEpoch - 1).toString();
    run = await relayW3f.run();
    result = run.result;
    expect(result.canExec).to.equal(true);
    storageBefore["keeperLastRun"] = (endOfFirstDayCurrentEpoch - 7 * DAY).toString();
    run = await relayW3f.run();
    result = run.result;
    expect(result.canExec).to.equal(true);
  });
});
