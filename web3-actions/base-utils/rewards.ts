// SPDX-License-Identifier: BUSL-1.1
import { Contract } from "ethers";
import { processClaims } from "../common-utils/rewards";
import {
  RewardContractInfo,
  RewardsToClaim,
  ZERO_ADDRESS,
  Reward,
  Pool,
} from "../common-utils/constants";

const REWARDS_TO_FETCH = 600;

export async function claimRewards(
  relay: Contract,
  lpSugarContract: Contract
): Promise<string[]> {
  const mTokenId = await relay.mTokenId();

  const rewards: RewardsToClaim = await getRewards(mTokenId, lpSugarContract);

  const claimedTokens = await processClaims(relay, rewards);
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
  const allPools: Pool[] = await lpSugarContract.forSwaps();
  return allPools.map(
    ([lp, stable, token0, token1, factory]): Pool => ({
      lp,
      stable,
      token0,
      token1,
      factory,
    })
  );
}
