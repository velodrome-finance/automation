// SPDX-License-Identifier: BUSL-1.1
import { Contract } from "ethers";
import { executeClaims } from "../common-utils/helpers";
import {
  RewardContractInfo,
  RewardsToClaim,
  ZERO_ADDRESS,
  Reward,
  Pool,
} from "../common-utils/constants";

const REWARDS_TO_FETCH = 600;
const POOLS_TO_FETCH = 600;

export async function claimRewards(
  relay: Contract,
  lpSugarContract: Contract
): Promise<string[]> {
  const mTokenId = await relay.mTokenId();

  const rewards: RewardsToClaim = await getRewards(mTokenId, lpSugarContract);

  const claimedTokens = await executeClaims(relay, rewards);
  return claimedTokens;
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
