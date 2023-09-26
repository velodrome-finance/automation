import {
  LP_SUGAR_ABI,
  LP_SUGAR_ADDRESS,
  ZERO_ADDRESS,
} from "../../constants";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";
import { chunk, flattenDeep, isEmpty } from "lodash";
import { Reward, RewardContractInfo } from "./autocompounder";

const rewardInfoReducer = (map: RewardContractInfo, r: Reward) => {
  let key: string = ( r.fee != ZERO_ADDRESS ) ? r.fee : r.bribe;
  map[key] = (map[key] || []).concat(r.token);
  return map;
}

export async function fetchFeeRewards(
  venft: BigNumber,
  pairs,
  provider: Provider,
  chunkSize = 100
): Promise <RewardContractInfo> {
  if (isEmpty(pairs)) {
    return {};
  }

  const pairChunks = chunk(pairs, chunkSize);

  const lpSugarContract: Contract = new Contract(LP_SUGAR_ADDRESS, LP_SUGAR_ABI, provider);

  const rewards: Reward[] = await Promise.all(pairChunks.map(async (pairChunk, index: number) => {
      return await lpSugarContract
        .rewards(pairChunk.length, chunkSize * index, venft)
        .then((data: Reward[]) => {
          return (data || [])
            .filter((reward: Reward) => reward.fee != ZERO_ADDRESS) // Filter only rewards that come from fees
            .map((reward: Reward) => ({
              ...reward,
            }));
        });
  }));

  return flattenDeep(rewards).filter((r: Reward) => !isEmpty(r)).reduce(rewardInfoReducer, {});
}

export async function fetchBribeRewards(
  venft: BigNumber,
  pairs,
  provider: Provider,
  chunkSize = 100
): Promise<RewardContractInfo> {
  if (isEmpty(pairs)) {
    return {};
  }

  const pairChunks = chunk(pairs, chunkSize);

  const lpSugarContract: Contract = new Contract(LP_SUGAR_ADDRESS, LP_SUGAR_ABI, provider);

  const rewards: Reward[] = await Promise.all(pairChunks.map(async (pairChunk, index: number) => {
      return await lpSugarContract
      .rewards(pairChunk.length, chunkSize * index, venft)
      .then((data: Reward[]) => {
          return (data || [])
          .filter((reward: Reward) => reward.bribe != ZERO_ADDRESS) // Filter only rewards that come from bribes
          .map((reward: Reward) => ({
              ...reward,
          }));
      });
  }));

  return flattenDeep(rewards).filter((r: Reward) => !isEmpty(r)).reduce(rewardInfoReducer, {});
}
