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
  // Claim Fees
  let rewards: RewardContractInfo = await fetchFeeRewards(
    mTokenId,
    relay.provider,
    pairsLength
  );
  let rewardAddrs: string[] = Object.keys(rewards);
  if (rewardAddrs.length != 0)
    calls.push(
      relay.interface.encodeFunctionData("claimFees", [
        rewardAddrs,
        Object.values(rewards),
      ])
    );

  // Claim Bribes
  rewards = await fetchBribeRewards(mTokenId, relay.provider, pairsLength);
  rewardAddrs = Object.keys(rewards);
  if (rewardAddrs.length != 0)
    calls.push(
      relay.interface.encodeFunctionData("claimBribes", [
        rewardAddrs,
        Object.values(rewards),
      ])
    );
  return calls;
}

async function fetchFeeRewards(
  venft: BigNumber,
  provider: Provider,
  pairsLength: number,
  chunkSize = 100
): Promise<RewardContractInfo> {
  const lpSugarContract: Contract = new Contract(
    LP_SUGAR_ADDRESS,
    LP_SUGAR_ABI,
    provider
  );

  let rewardInfo: RewardContractInfo = {};
  for (let startIndex = 0; startIndex < pairsLength; startIndex += chunkSize) {
    const endIndex = Math.min(startIndex + chunkSize, pairsLength);
    const rewards: Reward[] = (
      await lpSugarContract.rewards(endIndex - startIndex, startIndex, venft)
    )
      .filter((reward) => reward.fee != ZERO_ADDRESS)
      .map(
        (reward) =>
          ({
            fee: reward.fee,
            bribe: ZERO_ADDRESS,
            token: reward.token,
          } as Reward)
      );

    for (const reward of rewards) {
      rewardInfo[reward.fee] = (rewardInfo[reward.fee] || []).concat(
        reward.token
      );
    }
  }

  return rewardInfo;
}

async function fetchBribeRewards(
  venft: BigNumber,
  provider: Provider,
  pairsLength: number,
  chunkSize = 100
): Promise<RewardContractInfo> {
  const lpSugarContract: Contract = new Contract(
    LP_SUGAR_ADDRESS,
    LP_SUGAR_ABI,
    provider
  );

  let rewardInfo: RewardContractInfo = {};
  for (let startIndex = 0; startIndex < pairsLength; startIndex += chunkSize) {
    const endIndex = Math.min(startIndex + chunkSize, pairsLength);
    const rewards: Reward[] = (
      await lpSugarContract.rewards(endIndex - startIndex, startIndex, venft)
    )
      .filter((reward) => reward.bribe != ZERO_ADDRESS)
      .map(
        (reward) =>
          ({
            bribe: reward.bribe,
            fee: ZERO_ADDRESS,
            token: reward.token,
          } as Reward)
      );

    for (const reward of rewards) {
      rewardInfo[reward.bribe] = (rewardInfo[reward.bribe] || []).concat(
        reward.token
      );
    }
  }

  return rewardInfo;
}
