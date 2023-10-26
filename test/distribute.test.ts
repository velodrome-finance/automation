import hre from "hardhat";
const { ethers, w3f } = hre;
import { expect } from "chai";
import { before } from "mocha";
import { Contract } from "ethers";
import { BigNumber } from "@ethersproject/bignumber";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";

import jsonOutput from "../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";
import { abi as erc20Abi } from "../web3-functions/relay-automation/abis/erc20.json";
import { Minter } from "../typechain/relay-private/lib/contracts/contracts/Minter";
import { Voter } from "../typechain/relay-private/lib/contracts/contracts/Voter";
import jsonConstants from "../lib/relay-private/script/constants/Optimism.json";
import { HOUR, WEEK } from "../web3-functions/relay-automation/utils/constants";
import { VotingEscrow } from "../typechain";

// Fetches all Pools for a given Voter contract
async function getPools(voter: Contract): Promise<string[]> {
  const length = (await voter.length()).toNumber();
  return (
    await Promise.all([...Array(length).keys()].map((i) => voter.pools(i)))
  ).slice(0, 20);
}

// Fetches all data necessary to process V1 Distributions
async function getV1DistributionData(
  voter: Contract,
  pools: string[]
): Promise<[string[], Contract[][]]> {
  let gauges: string[] = [];
  let tokens: Contract[][] = [];
  for (const pool of pools) {
    // Fetching Gauge
    const gauge = await ethers.getContractAt(
      [
        "function rewardsListLength() external view returns (uint256)",
        "function rewards(uint256) external view returns (address)",
      ],
      await voter.gauges(pool)
    );
    gauges.push(gauge.address);

    // Fetching Reward Tokens
    const rewardsLength: BigNumber = await gauge.rewardsListLength();
    const rewardAddrs = await Promise.all(
      [...Array(rewardsLength.toNumber()).keys()].map((i) => gauge.rewards(i))
    );
    const rewardTokens: Contract[] = await Promise.all(
      rewardAddrs.map((addr) => ethers.getContractAt(erc20Abi, addr))
    );
    tokens.push(rewardTokens);
  }

  return [gauges, tokens];
}

// Fetches all data necessary to process V2 Distributions
async function getV2DistributionData(
  voter: Contract,
  pools: string[]
): Promise<[string[], Contract[][]]> {
  let gauges: string[] = [];
  let tokens: Contract[][] = [];
  let feeRewardsAddrs: string[] = [];
  for (const pool of pools) {
    // Fetching Gauge
    const gauge = await ethers.getContractAt("Gauge", await voter.gauges(pool));
    gauges.push(gauge.address);

    // Fetching Reward Contract
    const feeRewards: Contract = await ethers.getContractAt(
      "FeesVotingReward",
      await gauge.feesVotingReward()
    );
    feeRewardsAddrs.push(feeRewards.address);

    // Fetching Reward Tokens
    const rewardsLength: BigNumber = await feeRewards.rewardsListLength();
    const rewardAddrs = await Promise.all(
      [...Array(rewardsLength.toNumber()).keys()].map((i) =>
        feeRewards.rewards(i)
      )
    );
    const rewardTokens: Contract[] = await Promise.all(
      rewardAddrs.map((addr) => ethers.getContractAt(erc20Abi, addr))
    );
    tokens.push(rewardTokens);
  }

  return [feeRewardsAddrs, tokens];
}

// Gets all Balances for the Reward contracts, given their Addresses and Reward Tokens
async function getRewardBalances(
  rewardAddrs: string[],
  tokens: Contract[][]
): Promise<BigNumber[][]> {
  let prevBalances: BigNumber[][] = [];
  console.log("Will Log Reward Balances now");
  for (let i = 0; i < rewardAddrs.length; i++) {
    const rewardAddr: string = rewardAddrs[i];
    console.log(
      `=========== Current Reward: ${rewardAddr} [ Before Txs ] ===========`
    );
    const rewardTokens: Contract[] = tokens[i];
    console.log("REWARDS LENGTH %d", rewardTokens.length);
    // Fetch Balances on FeeRewards Contract
    let balances: BigNumber[] = await Promise.all(
      rewardTokens.map((token) => token.balanceOf(rewardAddr))
    );
    for (const i in rewardTokens) {
      const token = rewardTokens[i];
      const bal = balances[i];
      console.log(`TOKEN: ${token.address}; BALANCE ->> ${bal.toString()}`);
    }
    prevBalances.push(balances);
  }
  return prevBalances;
}

// Asserts that the balances have increased for some Reward Contracts after distribution has happened
async function assertRewardBalances(
  rewardAddrs: string[],
  tokens: Contract[][],
  prevBalances: BigNumber[][]
) {
  let counting = 0;
  let tokenCount = 0;
  for (let i = 0; i < rewardAddrs.length; i++) {
    const rewardAddr: string = rewardAddrs[i];
    const rewardTokens: Contract[] = tokens[i];
    console.log(
      `=========== Current Reward: ${rewardAddr} [ After Txs ]===========`
    );
    let oldBalances: BigNumber[] = prevBalances[i];
    let balances: BigNumber[] = await Promise.all(
      rewardTokens.map((token) => token.balanceOf(rewardAddr))
    );
    for (const i in balances) {
      const oldBal: BigNumber = oldBalances[i];
      const token: Contract = rewardTokens[i];
      const bal: BigNumber = balances[i];
      console.log(`TOKEN: ${token.address}; BALANCE ->> ${bal.toString()}`);
      tokenCount++;
      if (bal.gt(oldBal)) counting++;
      console.log(`IS EQUAL? ${bal.eq(oldBal)}`);
      expect(bal).to.gte(oldBal);
    }
    // Balances of some tokens have increased due to distribution
    console.log(counting);
    console.log(tokenCount);
  }
  expect(counting).to.gt(tokenCount / 3);
}

describe("Distribute Automation Tests", function () {
  let distributeScript: Web3FunctionHardhat;
  let owner: SignerWithAddress;
  let escrow: VotingEscrow;
  let v1Minter: Contract;
  let minter: Minter;
  let v1Voter: Voter;
  let voter: Voter;

  before(async function () {
    [owner] = await hre.ethers.getSigners();
    distributeScript = w3f.get("distribute");

    voter = await ethers.getContractAt("Voter", jsonOutput.Voter);
    minter = await ethers.getContractAt("Minter", jsonOutput.Minter);
    v1Voter = await ethers.getContractAt("Voter", jsonConstants.v1.Voter);
    escrow = await ethers.getContractAt(
      "VotingEscrow",
      jsonConstants.v1.VotingEscrow
    );
    v1Minter = await ethers.getContractAt(
      ["function active_period() view returns (uint256)"],
      jsonConstants.v1.Minter
    );
  });

  it("V1 and V2 Distribution Flow", async () => {
    // This test Saves all current balances of Reward contracts, then
    // broadcasts Distributions and assert that some Balances increased

    let v2Pools: string[] = await getPools(voter);
    let v1Pools: string[] = await getPools(v1Voter);

    let lastUpdate = await minter.activePeriod();
    let lastUpdateV1 = await v1Minter.active_period();
    await time.increaseTo(lastUpdate.toNumber() + WEEK + 1);

    // Gets Distribution data for Distributions
    const [v2FeeRewardsAddrs, v2Tokens]: [string[], Contract[][]] =
      await getV2DistributionData(voter, v2Pools);
    const [v1Gauges, v1Tokens]: [string[], Contract[][]] =
      await getV1DistributionData(v1Voter, v1Pools);

    // Gets Current Reward balances
    const prevV2Balances: BigNumber[][] = await getRewardBalances(
      v2FeeRewardsAddrs,
      v2Tokens
    );
    const prevV1Balances: BigNumber[][] = await getRewardBalances(
      v1Gauges,
      v1Tokens
    );
    const oldSinkManagerBalance: BigNumber = await escrow.balanceOfNFT(
      BigNumber.from(jsonOutput.ownedTokenId)
    );

    const { result } = await distributeScript.run();
    expect(result.canExec).to.equal(true);

    // Broadcasts Distribution Txs
    for (let call of result.callData)
      await owner.sendTransaction({ to: call.to, data: call.data });

    // Assert that Minter updates were done correctly
    let newUpdate = await minter.activePeriod();
    expect(newUpdate.toNumber()).to.gt(lastUpdate.toNumber());
    let newUpdateV1 = await v1Minter.active_period();
    expect(newUpdateV1.toNumber()).to.gt(lastUpdateV1.toNumber());
    expect(newUpdate.toNumber()).to.eq(newUpdateV1.toNumber());

    // Assert that Reward COntract's balances has changed after Distributions
    await assertRewardBalances(v2FeeRewardsAddrs, v2Tokens, prevV2Balances);
    await assertRewardBalances(v1Gauges, v1Tokens, prevV1Balances);
    const newSinkBal = await escrow.balanceOfNFT(
      BigNumber.from(jsonOutput.ownedTokenId)
    );
    expect(newSinkBal).to.gt(oldSinkManagerBalance);
  });
  it("Cannot execute if LastDistribution has happened in same epoch", async () => {
    let timestamp = await time.latest();
    const startOfNextEpoch = timestamp - (timestamp % WEEK) + WEEK;

    let storageBefore = distributeScript.getStorage();
    // Setting Last run as the start of Next Epoch
    storageBefore["lastDistribution"] = startOfNextEpoch.toString();
    await time.increaseTo(startOfNextEpoch);
    let run = await distributeScript.run({ storage: storageBefore });
    let result = run.result;
    // Cannot exec if last run happened in same epoch
    expect(result.canExec).to.equal(false);

    await time.increase(WEEK); // Skipping until the last Timestamp of the Epoch
    run = await distributeScript.run({ storage: storageBefore });
    result = run.result;
    // Cannot exec for whole epoch, as previous execution happened in it
    expect(result.canExec).to.equal(false);

    // Can exec if last run happened in Previous Epoch
    await time.increase(1); // Skipping to start of Second day
    run = await distributeScript.run({ storage: storageBefore });
    result = run.result;
    // Can exec from the start of Second Day
    expect(result.canExec).to.equal(true);

    // Cannot exec if after Epoch's first Hour
    await time.increase(HOUR); // Skipping to start of Second Hour
    run = await distributeScript.run({ storage: storageBefore });
    result = run.result;
    // Can no longer Execute as first Hour was missed
    expect(result.canExec).to.equal(false);
  });
});
