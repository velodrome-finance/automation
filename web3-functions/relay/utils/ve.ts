import { useQuery } from "@tanstack/react-query";
import { readContract, readContracts } from "@wagmi/core";
import dayjs from "dayjs";
import { utils } from "ethers";
import { chunk, flattenDeep, isEmpty } from "lodash";

import {
  LP_SUGAR_ABI,
  LP_SUGAR_ADDRESS,
  MINTER_ADDRESS,
  VE_ADDRESS,
  VE_SUGAR_ABI,
  VE_SUGAR_ADDRESS,
  WEEK,
  ZERO_ADDRESS,
} from "../../constants";
import { mulUnsafe, pctOf } from "./quote";

import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

// /**
//  * Returns:
//  *  - total available voting power
//  *  - curent epoch
//  *  - registered voting power
//  *  - epoch end time
//  */
// async function fetchVeStats() {
//   return await readContracts({
//     contracts: [
//       {
//         address: VE_ADDRESS,
//         abi: ["function totalSupply() view returns (uint)"],
//         functionName: "totalSupply",
//       },
//       {
//         address: VE_ADDRESS,
//         abi: ["function token() view returns (address)"],
//         functionName: "token",
//       },
//       {
//         address: VE_ADDRESS,
//         abi: ["function decimals() view returns (uint8)"],
//         functionName: "decimals",
//       },
//       {
//         address: MINTER_ADDRESS,
//         abi: ["function activePeriod() view returns (uint)"],
//         functionName: "activePeriod",
//       },
//     ],
//   }).then((data) => {
//     const [totalVotes, token, decimals, epochStartedAt] = data;
//
//     return {
//       totalVotes,
//       token,
//       decimals,
//       epochStartedAt,
//       // Voting ends one hour before the midnight!
//       epochEndsAt: Number(epochStartedAt) + WEEK - 60 * 60,
//     };
//   });
// }
//
// async function fetchVenft(id) {
//   if (!id) {
//     return null;
//   }
//
//   const [rewardsDistAddress, venft] = await readContracts({
//     contracts: [
//       {
//         address: VE_ADDRESS,
//         abi: ["function distributor() view returns (address)"],
//         functionName: "distributor",
//       },
//       {
//         address: VE_SUGAR_ADDRESS,
//         abi: VE_SUGAR_ABI,
//         functionName: "byId",
//         args: [id],
//       },
//     ],
//   });
//
//   const apr = await fetchVeAPR();
//   const { totalVotes, epochStartedAt, epochEndsAt } = await fetchVeStats();
//
//   // @ts-ignore
//   const expiresAt = venft.permanent
//     ? dayjs().add(4, "year")
//     : // @ts-ignore
//       dayjs.unix(venft.expires_at);
//
//   return {
//     // @ts-ignore
//     ...venft,
//     expiresAt,
//     apr,
//     totalVotes,
//     epochStartedAt,
//     epochEndsAt,
//     rewards_distributor: rewardsDistAddress,
//   };
// }
//
// async function fetchVenfts(account) {
//   if (!account) {
//     return [];
//   }
//
//   const [rewardsDistAddress, venfts] = await readContracts({
//     contracts: [
//       {
//         address: VE_ADDRESS,
//         abi: ["function distributor() view returns (address)"],
//         functionName: "distributor",
//       },
//       {
//         address: VE_SUGAR_ADDRESS,
//         abi: VE_SUGAR_ABI,
//         functionName: "byAccount",
//         args: [account],
//       },
//     ],
//   });
//
//   const apr = await fetchVeAPR();
//   const { totalVotes, epochStartedAt, epochEndsAt } = await fetchVeStats();
//
//   // @ts-ignore
//   return (venfts || []).map((venft) => {
//     const expiresAt = venft.permanent
//       ? dayjs.unix(Number(epochStartedAt)).add(4, "year")
//       : dayjs.unix(venft.expires_at);
//
//     return {
//       ...venft,
//       expiresAt,
//       apr,
//       totalVotes,
//       epochStartedAt,
//       epochEndsAt,
//       rewards_distributor: rewardsDistAddress,
//     };
//   });
// }

// /**
//  * This will loop through the Locks (veNFTs) and return any related rewards
//  *
//  * There's also an alternative implementation of this function using batches of
//  * pairs.
//  */
// async function fetchRewards(venfts, pairs, chunkSize = 100) {
//   if (isEmpty(venfts) || isEmpty(pairs)) {
//     return [];
//   }
//
//   const pairChunks = chunk(pairs, chunkSize);
//
//   const promises = venfts.map(async (venft) => {
//     const rewardsPromises = pairChunks.map((pairChunk, index) => {
//       return readContract({
//         address: LP_SUGAR_ADDRESS,
//         abi: LP_SUGAR_ABI,
//         functionName: "rewards",
//         args: [pairChunk.length, chunkSize * index, venft.id],
//       }).then((data) => {
//         // @ts-ignore
//         return (data || []).map((reward) => ({
//           ...reward,
//           pair: pairs.find((pair) => pair.address == reward.lp),
//         }));
//       });
//     });
//
//     const rewards = await Promise.all(rewardsPromises);
//
//     return {
//       ...venft,
//       rewards: flattenDeep(rewards).filter((r) => !isEmpty(r)),
//     };
//   });
//
//   return await Promise.all(promises);
// }

/**
 * This will loop through the Locks (veNFTs) and return any related rewards
 *
 * There's also an alternative implementation of this function using batches of
 * pairs.
 */
// async function fetchRewards(venfts, pairs, provider, chunkSize = 100) {
//   if (isEmpty(venfts) || isEmpty(pairs)) {
//     return [];
//   }
//
//   const pairChunks = chunk(pairs, chunkSize);
//
//   let lpSugarContract = new ethers.Contract(
//     LP_SUGAR_ADDRESS,
//     LP_SUGAR_ABI,
//     provider
//   );
//
//   const promises = venfts.map(async (venft) => {
//     const rewardsPromises = pairChunks.map((pairChunk, index) => {
//       return await lpSugarContract
//         .rewards(pairChunk.length, chunkSize * index, venft.id)
//         .then((data) => {
//           // @ts-ignore
//           return (data || []).map((reward) => ({
//             ...reward,
//             pair: pairs.find((pair) => pair.address == reward.lp),
//           }));
//         });
//     });
//
//     const rewards = await Promise.all(rewardsPromises);
//
//     return {
//       ...venft,
//       rewards: flattenDeep(rewards).filter((r) => !isEmpty(r)),
//     };
//   });
//
//   return await Promise.all(promises);
// }

export async function fetchFeeRewards(
  venfts,
  pairs,
  provider,
  chunkSize = 100
) {
  if (isEmpty(venfts) || isEmpty(pairs)) {
    return [];
  }

  const pairChunks = chunk(pairs, chunkSize);

  let lpSugarContract = new Contract(LP_SUGAR_ADDRESS, LP_SUGAR_ABI, provider);

  const promises = venfts.map(async (venft) => {
    const rewardsPromises = pairChunks.map(async (pairChunk, index) => {
      return await lpSugarContract
        .rewards(pairChunk.length, chunkSize * index, venft.id)
        .then((data) => {
          // @ts-ignore
          return (data || [])
            .filter((reward) => reward.fee) // Filter only rewards that come from fees
            .map((reward) => ({
              ...reward,
              pair: pairs.find((pair) => pair.address == reward.lp),
            }));
        });
    });

    const rewards = await Promise.all(rewardsPromises);

    return {
      ...venft,
      rewards: flattenDeep(rewards).filter((r) => !isEmpty(r)),
    };
  });

  return await Promise.all(promises);
}

export async function fetchBribeRewards(
  venft,
  pairs,
  provider,
  chunkSize = 100
) {
  if (isEmpty(pairs)) {
    return [];
  }

  const pairChunks = chunk(pairs, chunkSize);

  let lpSugarContract = new Contract(LP_SUGAR_ADDRESS, LP_SUGAR_ABI, provider);

  const rewardsPromises = pairChunks.map(async (pairChunk, index) => {
    return await lpSugarContract
      .rewards(pairChunk.length, chunkSize * index, venft)
      .then((data) => {
        // @ts-ignore
        return (data || [])
          .filter((reward) => reward.bribe) // Filter only rewards that come from bribes
          .map((reward) => ({
            ...reward,
            pair: pairs.find((pair) => pair.address == reward.lp),
          }));
      });
  });

  const rewards = await Promise.all(rewardsPromises);

  return {
    ...venft,
    rewards: flattenDeep(rewards).filter((r) => !isEmpty(r)),
  };
}

/**
 * This will loop through pairs and Locks (veNFTs) and return any rewards
 *
 * `VeSugar::rewards()` seems to be taking too long and `readContracts` has
 * a similar effect, so we keep it less efficient, but optimal by sequentially
 * getting the rewards.
 */
// async function _fetchRewardsInBatches(venfts, pairs, chunkSize = 100) {
//   if (isEmpty(venfts) || isEmpty(pairs)) {
//     return [];
//   }
//
//   const pairChunks = chunk(
//     pairs.filter((pair) => pair.gauge != ZERO_ADDRESS),
//     chunkSize
//   );
//
//   // Ethers.js `JsonRpcBatchProvider` doesn't chunk the calls, instead
//   // it splits these based on a 10ms timeout. We use a `sleep(11)` to
//   // trick the provider to move to the next batch/chunk.
//   const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
//
//   const rewardsForPairChunk = (pairChunk, venft) => {
//     return pairChunk.map((pair) => {
//       return readContract({
//         address: LP_SUGAR_ADDRESS,
//         abi: LP_SUGAR_ABI,
//         functionName: "rewardsByPair",
//         args: [venft.id, pair.address],
//       }).then((data) => {
//         // @ts-ignore
//         const rewards = (data || []).map((reward) => ({ ...reward, pair }));
//
//         return rewards;
//       });
//     });
//   };
//
//   const venftsWithRewards = venfts.map(async (venft) => {
//     const rewards = [];
//
//     for (const pairChunk of pairChunks) {
//       const chunkPromises = rewardsForPairChunk(pairChunk, venft);
//
//       // Wait before processing the next batch/chunk...
//       await sleep(11);
//
//       const chunkRewards = await Promise.all(chunkPromises);
//       rewards.push(chunkRewards);
//     }
//
//     return {
//       ...venft,
//       rewards: flattenDeep(rewards).filter((r) => !isEmpty(r)),
//     };
//   });
//
//   return Promise.all(venftsWithRewards);
// }

// /**
//  * Returns the rebase percentage for Locks (veNFTs)
//  */
// export async function fetchVeAPR() {
//   const [weekly, supply, veDecimals] = await readContracts({
//     contracts: [
//       {
//         address: MINTER_ADDRESS,
//         abi: ["function weekly() view returns (uint)"],
//         functionName: "weekly",
//       },
//       {
//         address: VE_ADDRESS,
//         abi: ["function supply() view returns (uint)"],
//         functionName: "supply",
//       },
//       {
//         address: VE_ADDRESS,
//         abi: ["function decimals() view returns (uint)"],
//         functionName: "decimals",
//       },
//     ],
//   });
//
//   // @ts-ignore
//   if (supply.isZero()) {
//     return supply;
//   }
//
//   const decimals = Number(veDecimals);
//
//   const growth = await readContract({
//     address: MINTER_ADDRESS,
//     abi: ["function calculateGrowth(uint) view returns (uint)"],
//     functionName: "calculateGrowth",
//     args: [weekly],
//   });
//
//   const annualGrowth = mulUnsafe(
//     growth,
//     utils.parseUnits("52", decimals),
//     decimals
//   );
//
//   return pctOf(supply, annualGrowth, decimals);
// }
//
// export function useVeStats(opts = {}) {
//   return useQuery(["fetchVeStats"], () => fetchVeStats(), {
//     ...opts,
//     keepPreviousData: true,
//   });
// }
//
// export function useVenft(id, opts = {}) {
//   return useQuery(["fetchVenft", id], () => fetchVenft(id), {
//     ...opts,
//     keepPreviousData: true,
//   });
// }
//
// export function useVenfts(account, opts = {}) {
//   return useQuery(["fetchVenfts", account], () => fetchVenfts(account), {
//     ...opts,
//     keepPreviousData: true,
//     placeholderData: [],
//   });
// }

// export function useRewards(venfts, pairs, opts = {}) {
//   const venftIds = (venfts || []).map((venft) => venft.id.toString());
//
//   return useQuery(
//     ["fetchRewards", venftIds, pairs?.length],
//     () => fetchRewards(venfts, pairs),
//     {
//       ...opts,
//       keepPreviousData: true,
//       placeholderData: [],
//     }
//   );
// }
