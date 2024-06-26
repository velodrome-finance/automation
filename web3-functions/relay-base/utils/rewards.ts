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

  const rewards = await getRewards(mTokenId, relay.provider, offset, storage);

  const queue: string = (await storage.get("claimedTokens")) ?? ""; // fetch previously claimed tokens
  const prevTokens: string[] = queue.length != 0 ? JSON.parse(queue) : [];

  const claimedTokens = [
    ...new Set(
      Object.values(rewards.fee)
        .concat(Object.values(rewards.bribe))
        .concat(prevTokens)
        .flat()
    ),
  ];
  await storage.set("claimedTokens", JSON.stringify(claimedTokens)); // update claimed tokens list

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
export async function getPools(provider: Provider) {
  const lpSugarContract: Contract = new Contract(
    LP_SUGAR_ADDRESS,
    LP_SUGAR_ABI,
    provider
  );
  return await lpSugarContract.forSwaps();
}
