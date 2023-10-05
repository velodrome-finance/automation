// SPDX-License-Identifier: BUSL-1.1
import {
  LP_SUGAR_ABI,
  LP_SUGAR_ADDRESS,
  ZERO_ADDRESS,
  Reward,
  RewardContractInfo,
} from "../utils/constants";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";

// Fetches and claims all available Rewards
export async function getClaimCalls(
  relay: Contract,
  pairsLength: number
): Promise<string[]> {
  const mTokenId = await relay.mTokenId();
  let calls = [];
  let rewards = await getRewards(mTokenId, relay.provider, pairsLength);

  // Claim Fees
  let rewardAddrs: string[] = Object.keys(rewards.fee);
  if (rewardAddrs.length != 0)
    calls.push(
      relay.interface.encodeFunctionData("claimFees", [
        rewardAddrs,
        Object.values(rewards.fee),
      ])
    );
  // Claim Bribes
  rewardAddrs = Object.keys(rewards.bribe);
  if (rewardAddrs.length != 0)
    calls.push(
      relay.interface.encodeFunctionData("claimBribes", [
        rewardAddrs,
        Object.values(rewards.bribe),
      ])
    );
  return calls;
}

// Gets Reward information for Fees and Bribes
async function getRewards(
  venft: BigNumber,
  provider: Provider,
  pairsLength: number,
  chunkSize = 100
) {
  const lpSugarContract: Contract = new Contract(
    LP_SUGAR_ADDRESS,
    LP_SUGAR_ABI,
    provider
  );
  const feeRewardInfo: RewardContractInfo = {};
  const bribeRewardInfo: RewardContractInfo = {};

  const promises: Promise<void>[] = [];
  for (let startIndex = 0; startIndex < pairsLength; startIndex += chunkSize) {
    const endIndex = Math.min(startIndex + chunkSize, pairsLength);
    promises.push(
      // eslint-disable-next-line no-async-promise-executor
      new Promise(async (resolve, reject) => {
        try {
          const rewards: Reward[] = await lpSugarContract.rewards(
            endIndex - startIndex,
            startIndex,
            venft
          );

          // Separate rewards by Bribe and Fees
          for (const reward of rewards) {
            if (reward.fee != ZERO_ADDRESS)
              feeRewardInfo[reward.fee] = (
                feeRewardInfo[reward.fee] || []
              ).concat(reward.token);
            if (reward.bribe != ZERO_ADDRESS)
              bribeRewardInfo[reward.bribe] = (
                bribeRewardInfo[reward.bribe] || []
              ).concat(reward.token);
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      })
    );
  }
  await Promise.all(promises);
  return { fee: feeRewardInfo, bribe: bribeRewardInfo };
}
