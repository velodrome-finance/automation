import hre from "hardhat";
const { ethers, w3f } = hre;
import { expect } from "chai";
import { before } from "mocha";
import { Contract } from "ethers";
import { BigNumber } from "@ethersproject/bignumber";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";
import { time } from "@nomicfoundation/hardhat-network-helpers";

import jsonConstants from "../lib/relay-private/script/constants/Optimism.json";
import { Voter } from "../typechain/relay-private/lib/contracts/contracts/Voter";
import { Minter } from "../typechain/relay-private/lib/contracts/contracts/Minter";
import { abi as erc20Abi } from "../web3-functions/relay-automation/abis/erc20.json";
import jsonOutput from "../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";
import { WEEK } from "../web3-functions/relay-automation/utils/constants";

async function getPools(voter: Contract): Promise<string[]> {
    const length = (await voter.length()).toNumber();
    return (await Promise.all([...Array(length).keys()].slice(0,30).map((i) => voter.pools(i))));
}

async function getDistributionData(voter: Contract, pools: string[]): Promise<[string[], string[], Contract[][]]> {
    let gauges: string[] = [];
    let tokens: Contract[][] = [];
    let feeRewardsAddrs: string[] = [];
    for(const pool of pools) {
        // Fetching Gauge
        const gauge = await ethers.getContractAt("Gauge", await voter.gauges(pool));
        gauges.push(gauge.address);

        // Fetching Reward Contract
        const feeRewards: Contract = await ethers.getContractAt("FeesVotingReward", await gauge.feesVotingReward());
        feeRewardsAddrs.push(feeRewards.address);

        // Fetching Reward Tokens
        const rewardsLength: BigNumber = await feeRewards.rewardsListLength();
        const rewardAddrs = await Promise.all([...Array(rewardsLength.toNumber()).keys()].map((i) => feeRewards.rewards(i)));
        const rewardTokens: Contract[] = await Promise.all(rewardAddrs.map((addr) => ethers.getContractAt(erc20Abi, addr)));
        tokens.push(rewardTokens);
    }

    return [gauges, feeRewardsAddrs, tokens]
}

async function getV2RewardBalances(gauges: string[], feeRewardsAddrs: string[], tokens: Contract[][]): Promise<BigNumber[][]> {
    let prevBalances: BigNumber[][] = [];
    console.log(JSON.stringify(gauges));
    console.log("Will Log Gauge Balances now");
    for(let i = 0; i < gauges.length; i++) {
        const gauge: string = gauges[i];
        console.log(`=========== Current Gauge: ${gauge} [ Before Txs ] ===========`);
        const rewardTokens: Contract[] = tokens[i];
        console.log("REWARDS LENGTH %d", rewardTokens.length);
        const feeRewards: string = feeRewardsAddrs[i];
        // Fetch Balances on FeeRewards Contract
        let balances: BigNumber[] = await Promise.all(rewardTokens.map((token) => token.balanceOf(feeRewards)));
        for(const i in rewardTokens) {
            const token = rewardTokens[i];
            const bal = balances[i];
            console.log(`TOKEN: ${token.address}; BALANCE ->> ${bal.toString()}`);
        }
        prevBalances.push(balances);
    }
    return prevBalances;
}

async function assertAllV2GaugeBalances(gauges: string[], feeRewardsAddrs: string[], tokens: Contract[][], prevBalances: BigNumber[][]) {
  let counting = 0;
  let tokenCount = 0;
  for(let i = 0; i < gauges.length; i++) {
      const gauge: string = gauges[i];
      const rewardTokens: Contract[] = tokens[i]
      const feeRewards: string = feeRewardsAddrs[i];
      console.log(`=========== Current Gauge: ${gauge} [ After Txs ]===========`);
      let oldBalances: BigNumber[] = prevBalances[i];
      let balances: BigNumber[] = await Promise.all(rewardTokens.map((token) => token.balanceOf(feeRewards)));
      for(const i in balances) {
          const token: Contract = rewardTokens[i];
          const oldBal: BigNumber = oldBalances[i];
          const bal: BigNumber = balances[i];
          console.log(`TOKEN: ${token.address}; BALANCE ->> ${bal.toString()}`);
          tokenCount++;
          if(bal.gt(oldBal))
              counting++;
          console.log(`IS EQUAL? ${bal.eq(oldBal)}`);
          expect(bal.gte(oldBal)); //TODO: Is this assertion correct?
      }
      console.log(`Claimed Rewards on ${counting} Gauges`);
      // TODO: Add assertion for Counting
      expect(counting).to.gt(tokenCount/2); // at least half of all gauge tokens have been claimed
      console.log(counting);
      console.log(tokenCount);
  }
}

describe("Distribute Automation Tests", function () {

  let distributeScript: Web3FunctionHardhat;
  let owner: SignerWithAddress;
  let v1Minter: Contract;
  let minter: Minter;
  let v1Voter: Voter;
  let voter: Voter;

  before(async function () {
    [owner] = await hre.ethers.getSigners();
    distributeScript = w3f.get("distribute");

    voter = await ethers.getContractAt("Voter", jsonOutput.Voter);
    v1Voter = await ethers.getContractAt("Voter", jsonOutput.Voter);
    minter = await ethers.getContractAt("Minter", jsonOutput.Minter);
    v1Minter = await ethers.getContractAt(["function active_period() view returns (uint256)"], jsonConstants.v1.Minter);
  });

  it("Return canExec: true", async () => {

    let v2Pools: string[] = await getPools(voter);
    let v1Pools: string[] = await getPools(v1Voter);

    let lastUpdate = await minter.activePeriod();
    let lastUpdateV1 = await v1Minter.active_period();
    await time.increaseTo((lastUpdate).toNumber() + WEEK + 1);

    const [v2Gauges, v2FeeRewardsAddrs, v2Tokens]: [string[], string[], Contract[][]] = await getDistributionData(voter, v2Pools);
    const prevV2Balances = await getV2RewardBalances(v2Gauges, v2FeeRewardsAddrs, v2Tokens);

    const { result } = await distributeScript.run();
    expect(result.canExec).to.equal(true);

    let count = 0;
    for (let call of result.callData) {
      count++;
      await owner.sendTransaction({ to: call.to, data: call.data });
    }

    // Assert that Minter updates were done correctly
    let newUpdate = await minter.activePeriod();
    expect(newUpdate.toNumber()).to.gt(lastUpdate.toNumber());
    let newUpdateV1 = await v1Minter.active_period();
    expect(newUpdateV1.toNumber()).to.gt(lastUpdateV1.toNumber());
    expect(newUpdate.toNumber()).to.eq(newUpdateV1.toNumber());

    await assertAllV2GaugeBalances(v2Gauges, v2FeeRewardsAddrs, v2Tokens, prevV2Balances);
  });
});
