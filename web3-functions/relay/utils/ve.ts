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
  let feeRewardInfo: RewardContractInfo = {};
  let bribeRewardInfo: RewardContractInfo = {};
  for (let startIndex = 0; startIndex < pairsLength; startIndex += chunkSize) {
    const endIndex = Math.min(startIndex + chunkSize, pairsLength);
    const rewards: Reward[] = await lpSugarContract.rewards(
      endIndex - startIndex,
      startIndex,
      venft
    );

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
  }

  return { fee: feeRewardInfo, bribe: bribeRewardInfo };
}
