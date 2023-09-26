import { useQuery } from "@tanstack/react-query";
import { readContract } from "@wagmi/core";
import { utils } from "ethers";
import { isEmpty, orderBy } from "lodash";

import { LP_SUGAR_ABI, LP_SUGAR_ADDRESS, ZERO_ADDRESS } from "../constants";
import { applyPct, divUnsafe, mulUnsafe, pctOf } from "./quote";
import { fetchVeAPR } from "./ve";

// async function fetchLatestPairEpochs(limit, offset, tokens, tokenAddress) {
//   const epochs = await readContract({
//     address: LP_SUGAR_ADDRESS,
//     abi: LP_SUGAR_ABI,
//     functionName: "epochsLatest",
//     args: [limit, offset],
//   });
//
//   const veAPR = await fetchVeAPR();
//   const defaultToken = tokens[String(tokenAddress).toLowerCase()];
//
//   if (isEmpty(tokens) || !defaultToken) {
//     return [];
//   }
//
//   const decimals = defaultToken.decimals;
//   const rewardsTotal = (rewards) => {
//     let total = utils.parseUnits("0", decimals);
//
//     rewards.forEach((reward) => {
//       const token = tokens[reward.token.toLowerCase()];
//
//       if (token) {
//         total = total.add(
//           mulUnsafe(reward.amount, token.price, token.decimals)
//         );
//       }
//     });
//
//     return total;
//   };
//
//   // @ts-ignore
//   const epochsWithTbv = (epochs || []).map((epoch) => {
//     // Total bribes, fees and overall voting values
//     const tbv = rewardsTotal(epoch.bribes);
//     const tfv = rewardsTotal(epoch.fees);
//     const tvv = tbv.add(tfv);
//
//     if (tvv.isZero() || epoch.votes.isZero()) {
//       return {
//         ...epoch,
//         tbv,
//         tfv,
//         tvv,
//         veAPR,
//         vapr: utils.parseUnits("0"),
//         emissionsTokenDecimals: decimals,
//         emissionsTokenSymbol: defaultToken.symbol,
//       };
//     }
//
//     const annualTvv = mulUnsafe(
//       tvv,
//       utils.parseUnits("52", decimals),
//       decimals
//     );
//     const votesValue = mulUnsafe(epoch.votes, defaultToken.price, decimals);
//     const vapr = pctOf(votesValue, annualTvv, decimals);
//
//     return {
//       ...epoch,
//       tbv,
//       tfv,
//       tvv,
//       vapr,
//       veAPR,
//       emissionsTokenDecimals: decimals,
//       emissionsTokenSymbol: defaultToken.symbol,
//     };
//   });
//
//   return epochsWithTbv;
// }

// async function fetchPairEpochs(pairAddress, tokens, limit, offset) {
//   if (!pairAddress) {
//     return [];
//   }
//
//   const epochs = await readContract({
//     address: LP_SUGAR_ADDRESS,
//     abi: LP_SUGAR_ABI,
//     functionName: "epochsByAddress",
//     args: [limit, offset, pairAddress],
//   });
//
//   if (!tokens) {
//     return epochs;
//   }
//
//   // @ts-ignore
//   const epochsWithTbv = (epochs || []).map((epoch) => {
//     let tbv = utils.parseUnits("0");
//
//     epoch.bribes.forEach((bribe) => {
//       const token = tokens[bribe.token.toLowerCase()];
//
//       if (token) {
//         tbv = tbv.add(mulUnsafe(bribe.amount, token.price, token.decimals));
//       }
//     });
//
//     return { ...epoch, tbv };
//   });
//
//   return epochsWithTbv;
// }

export async function fetchPairs(account, tokens) {
  const accountAddress = account || ZERO_ADDRESS;
  const zero = utils.parseUnits("0");
  const pairs = await readContract({
    address: LP_SUGAR_ADDRESS,
    abi: LP_SUGAR_ABI,
    functionName: "all",
    args: [1_000, 0, accountAddress],
  });

  // @ts-ignore
  const withTvl = (pairs || []).map((pair) => {
    const token0 = tokens[pair.token0.toLowerCase()];
    const token1 = tokens[pair.token1.toLowerCase()];
    const emissionsToken = tokens[pair.emissions_token.toLowerCase()];

    const token0Balance = token0?.balance || zero;
    const token1Balance = token1?.balance || zero;
    const feePct = pair.pool_fee / 100;
    const poolFee = utils.parseUnits(
      feePct.toFixed(pair.decimals),
      pair.decimals
    );
    const volPct = utils.parseUnits(
      (100.0 / feePct).toFixed(pair.decimals),
      pair.decimals
    );

    const tvl = mulUnsafe(
      pair.reserve0,
      token0?.price || zero,
      token0?.decimals
    ).add(mulUnsafe(pair.reserve1, token1?.price || zero, token1?.decimals));
    const feesValue = mulUnsafe(
      pair.token0_fees,
      token0?.price || zero,
      token0?.decimals
    ).add(mulUnsafe(pair.token1_fees, token1?.price || zero, token1?.decimals));

    const volume = mulUnsafe(feesValue, volPct);
    const token0Volume = mulUnsafe(
      pair.token0_fees,
      volPct,
      token0?.decimals,
      pair.decimals,
      token0?.decimals
    );
    const token1Volume = mulUnsafe(
      pair.token1_fees,
      volPct,
      token1?.decimals,
      pair.decimals,
      token1?.decimals
    );

    const pairSansApr = {
      ...pair,
      // Map `address` to `pair_address` or `lp`...
      address: pair.pair_address || pair.lp,
      tvl,
      apr: zero,
      token0Balance,
      token1Balance,
      poolFee,
      feesValue,
      token0Volume,
      token1Volume,
      volume,
    };

    if (tvl.isZero() || pair.emissions.isZero()) {
      return pairSansApr;
    }

    const daySeconds = utils.parseUnits(String(24 * 60 * 60));
    const rewardValue = mulUnsafe(
      pair.emissions,
      emissionsToken?.price || zero,
      emissionsToken?.decimals
    );
    const reward = mulUnsafe(rewardValue, daySeconds, emissionsToken?.decimals);

    const stakedPct = pctOf(
      pair.total_supply,
      pair.gauge_total_supply,
      pair.decimals
    );
    const stakedTvl = applyPct(
      tvl,
      pair.decimals,
      "0",
      utils.formatUnits(stakedPct, pair.decimals)
    );

    const apr = mulUnsafe(
      divUnsafe(reward, stakedTvl, emissionsToken?.decimals),
      utils.parseUnits(String(100 * 365)),
      emissionsToken?.decimals
    );

    return { ...pairSansApr, apr };
  });

  return orderBy(
    // First order by the tokens symbol...
    orderBy(withTvl, [(pair) => pair.symbol.split("-")[1]]),
    // Next by user balances...
    [
      (pair) =>
        parseFloat(utils.formatUnits(pair.account_balance, pair.decimals)),
      (pair) =>
        parseFloat(utils.formatUnits(pair.account_staked, pair.decimals)),
    ],
    ["desc", "desc"]
  );
}

// export function usePairEpochs(pair, tokens, limit = 1, offset = 0, opts = {}) {
//   return useQuery(
//     ["fetchPairEpochs", pair?.address, tokens?.length, limit, offset],
//     () => fetchPairEpochs(pair?.address, tokens, limit, offset),
//     {
//       ...opts,
//       keepPreviousData: true,
//       // 5 minutes...
//       refetchInterval: 1_000 * 60 * 5,
//       placeholderData: [],
//     }
//   );
// }

// export function useLatestPairEpochs(tokens, tokenAddress, opts = {}) {
//   return useQuery(
//     ["fetchLatestPairEpochs", 1000, 0, tokens?.length, tokenAddress],
//     () => fetchLatestPairEpochs(1000, 0, tokens, tokenAddress),
//     {
//       ...opts,
//       keepPreviousData: true,
//       // 5 minutes...
//       refetchInterval: 1_000 * 60 * 5,
//       placeholderData: [],
//     }
//   );
// }

// export function usePairs(account, tokens, opts = {}) {
//   return useQuery(
//     ["fetchPairs", account, tokens?.length],
//     () => fetchPairs(account, tokens),
//     {
//       ...opts,
//       keepPreviousData: true,
//       // 5 minutes...
//       refetchInterval: 1_000 * 60 * 5,
//       placeholderData: [],
//     }
//   );
// }
