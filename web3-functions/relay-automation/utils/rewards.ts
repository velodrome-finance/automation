// SPDX-License-Identifier: BUSL-1.1
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";
import {
  PROCESSING_COMPLETE,
  LP_SUGAR_ADDRESS,
  LP_SUGAR_ABI,
  ZERO_ADDRESS,
  RewardContractInfo,
  Reward,
} from "../utils/constants";

const REWARDS_TO_FETCH = 600;
const MAX_REWARDS_CALLS = 3;
const POOLS_TO_FETCH = 600;

// Fetches and claims all available Rewards
export async function getClaimCalls(
  relay: Contract,
  storage
): Promise<string[]> {
  const mTokenId = await relay.mTokenId();
  let offset: number = Number((await storage.get("offset")) ?? "");

  if (!offset) await storage.set("currStage", "claim");

  if (offset == REWARDS_TO_FETCH) {
    await storage.delete("offset");
    await storage.set("currStage", "swap");
    return [PROCESSING_COMPLETE];
  }

  let rewards = await getRewards(mTokenId, relay.provider, offset, storage);

  // Claim Fees
  const feeCalls = encodeRewards(
    Object.keys(rewards.fee),
    Object.values(rewards.fee),
    "claimFees",
    relay.interface
  );
  // Claim Bribes
  const bribeCalls = encodeRewards(
    Object.keys(rewards.bribe),
    Object.values(rewards.bribe),
    "claimBribes",
    relay.interface
  );
  return feeCalls.concat(bribeCalls);
}

// From Reward information, encodes Claim Calls
function encodeRewards(
  rewardAddrs: string[],
  tokenAddrs: string[][],
  claimFunction: string,
  abi,
  batchSize = 3
): string[] {
  let calls: string[] = [];
  for (let i = 0; i < rewardAddrs.length; i += batchSize) {
    // Encodes Claims for different Reward Contracts in batches, to avoid high gas consumption
    const rewardAddrsBatch: string[] = rewardAddrs.slice(i, i + batchSize);
    const rewardTokensBatch: string[][] = tokenAddrs.slice(i, i + batchSize);
    calls.push(
      abi.encodeFunctionData(claimFunction, [
        rewardAddrsBatch,
        rewardTokensBatch,
      ])
    );
  }
  return calls;
}

// Gets Reward information for Fees and Bribes
async function getRewards(
  venft: BigNumber,
  provider: Provider,
  startIndex: number,
  storage,
  chunkSize = 100
) {
  const lpSugarContract: Contract = new Contract(
    LP_SUGAR_ADDRESS,
    LP_SUGAR_ABI,
    provider
  );
  const feeRewardInfo: RewardContractInfo = {};
  const bribeRewardInfo: RewardContractInfo = {};

  let endIndex = 0;
  let callCount = 0;

  while (endIndex != REWARDS_TO_FETCH && callCount < MAX_REWARDS_CALLS) {
    endIndex = Math.min(startIndex + chunkSize, REWARDS_TO_FETCH);
    // Fetch Rewards available
    const rewards: Reward[] = await lpSugarContract.rewards(
      endIndex - startIndex,
      startIndex,
      venft
    );
    callCount++;

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
    startIndex += chunkSize;
  }
  storage.set("offset", endIndex.toString()); // update offset for next run
  return { fee: feeRewardInfo, bribe: bribeRewardInfo };
}

// Gets All pools
export async function getPools(provider: Provider, chunkSize = 75) {
  const lpSugarContract: Contract = new Contract(
    LP_SUGAR_ADDRESS,
    LP_SUGAR_ABI,
    provider
  );
  const allPools: any[] = [];
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
          const pools: any[] = await lpSugarContract.forSwaps(
            endIndex - startIndex,
            startIndex
          );
          allPools.push(...pools);
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
