// SPDX-License-Identifier: BUSL-1.1
import { Contract } from "ethers";
import {
  RewardContractInfo,
  RewardsToClaim,
  ZERO_ADDRESS,
  Reward,
  Pool,
} from "./op-constants";

const REWARDS_TO_FETCH = 600;
const POOLS_TO_FETCH = 600;

export async function claimRewards(
  relay: Contract,
  lpSugarContract: Contract
): Promise<string[]> {
  const mTokenId = await relay.mTokenId();

  console.log("Will get rewards now");
  const rewards: RewardsToClaim = await getRewards(mTokenId, lpSugarContract);
  console.log("These are the fetched rewards");
  console.log(
    `Will claim ${Object.keys(rewards.fee).length} fees and ${
      Object.keys(rewards.bribe).length
    } bribes`
  );

  const claimedTokens = await processClaims(relay, rewards);
  return claimedTokens;
}

async function processClaims(
  relay: Contract,
  rewards: RewardsToClaim,
  logEvents: boolean = false,
  batchSize = 3
): Promise<string[]> {
  const claimedTokens: string[] = [
    ...new Set(
      Object.values(rewards.fee).concat(Object.values(rewards.bribe)).flat()
    ),
  ];
  let oldBalances: { [id: string]: BigInt } = {};
  // TODO: logs are for debugging purposes
  if (logEvents)
    oldBalances = await logBalances(relay, claimedTokens, logEvents);

  let promises = [];
  let feeKeys = Object.keys(rewards.fee);
  let feeValues = Object.values(rewards.fee);
  for (let i = 0; i < feeKeys.length; i += batchSize) {
    const batchKeys = feeKeys.slice(i, i + batchSize);
    const batchValues = feeValues.slice(i, i + batchSize);
    promises.push(relay.claimFees(batchKeys, batchValues));
  }

  let bribeKeys = Object.keys(rewards.bribe);
  let bribeValues = Object.values(rewards.bribe);
  for (let i = 0; i < bribeKeys.length; i += batchSize) {
    const batchKeys = bribeKeys.slice(i, i + batchSize);
    const batchValues = bribeValues.slice(i, i + batchSize);
    promises.push(relay.claimBribes(batchKeys, batchValues));
  }
  console.log("Will be processing claims now");
  try {
    const txs = await Promise.all(promises);
    await Promise.all(txs.map((tx) => tx.wait()));
    console.log("Claims processed");
  } catch (err) {
    console.log("Error while processing claims.");
  }

  if (logEvents) {
    const balances = await logBalances(relay, claimedTokens, logEvents);
    compareBalances(oldBalances, balances, claimedTokens.length);
  }
  return claimedTokens;
}

// TODO: remove logging functions logBalances and compareBalances before deploy
async function logBalances(
  relay: Contract,
  tokens: string[],
  logEvents: boolean = false
): Promise<{ [id: string]: BigInt }> {
  const relayAddr: string = relay.target.toString();
  let results: { [id: string]: BigInt } = {};
  for (const addr of tokens) {
    const token = new Contract(
      addr,
      [
        "function balanceOf(address) view returns (uint256)",
        "function name() view returns (string)",
      ],
      relay.runner
    );
    const name = await token.name();
    const amount = await token.balanceOf(relayAddr);
    if (logEvents) {
      console.log("Current Token: %s, Address: %s", name, addr);
      console.log("This is the token balance: %s", amount.toString());
      console.log(
        "================================================================="
      );
    }
    results[addr] = amount;
  }
  return results;
}

function compareBalances(oldBalances, balances, length) {
  let count = 0;
  for (const addr in oldBalances) {
    const oldBal = oldBalances[addr];
    const newBal = balances[addr];
    if (newBal > oldBal) count++;
  }
  console.log(
    `Claimed Rewards from ${count} tokens. The claimedTokens variable had ${length} items.`
  );
  if (length)
    console.log(
      `${((count / length) * 100).toFixed(2)}% of tokens claimed successfully.`
    );
}

// Gets Reward information for Fees and Bribes
async function getRewards(
  venft: BigInt,
  lpSugarContract: Contract,
  chunkSize = 100
): Promise<{ fee: RewardContractInfo; bribe: RewardContractInfo }> {
  const feeRewardInfo: RewardContractInfo = {};
  const bribeRewardInfo: RewardContractInfo = {};

  const numbersArray: number[] = Array.from(
    { length: Math.ceil(REWARDS_TO_FETCH / 100) },
    (_, index) => Math.min(index * 100, REWARDS_TO_FETCH)
  );
  const rewardsPromises = numbersArray.map((start) => {
    const end = Math.min(start + chunkSize, REWARDS_TO_FETCH);
    return lpSugarContract.rewards(end - start, start, venft);
  });

  const rewards: Reward[] = (await Promise.all(rewardsPromises)).flat();

  // Separate rewards by Bribe and Fees
  for (const reward of rewards) {
    if (reward.fee != ZERO_ADDRESS)
      feeRewardInfo[reward.fee] = (feeRewardInfo[reward.fee] || []).concat(
        reward.token
      );
    if (reward.bribe != ZERO_ADDRESS)
      bribeRewardInfo[reward.bribe] = (
        bribeRewardInfo[reward.bribe] || []
      ).concat(reward.token);
  }
  return { fee: feeRewardInfo, bribe: bribeRewardInfo };
}

// Gets All pools
export async function getPools(lpSugarContract: Contract, chunkSize = 75) {
  const allPools: Pool[] = [];
  const promises: Promise<void>[] = [];
  for (
    let startIndex = 0;
    startIndex < POOLS_TO_FETCH;
    startIndex += chunkSize
  ) {
    const endIndex = Math.min(startIndex + chunkSize, POOLS_TO_FETCH);
    promises.push(
      // eslint-disable-next-line no-async-promise-executor
      new Promise(async (resolve, reject) => {
        try {
          const pools = await lpSugarContract.forSwaps(
            endIndex - startIndex,
            startIndex
          );
          allPools.push(
            ...pools.map(
              ([lp, stable, token0, token1, factory]): Pool => ({
                lp,
                stable,
                token0,
                token1,
                factory,
              })
            )
          );
          resolve();
        } catch (err) {
          reject(err);
        }
      })
    );
  }
  await Promise.all(promises);
  return allPools;
}
