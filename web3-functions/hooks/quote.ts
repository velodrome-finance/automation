import { useQuery } from "@tanstack/react-query";
import { readContracts } from "@wagmi/core";
import { FixedNumber, utils } from "ethers";
import Graph from "graphology";
import { allSimpleEdgeGroupPaths } from "graphology-simple-path";
import { chunk, isEmpty } from "lodash";

import { LIBRARY_ADDRESS, ROUTER_ABI, ROUTER_ADDRESS } from "../constants";

/**
 * Returns the division of two big numbers
 */
export function divUnsafe(bnA, bnB, decA = 18, decB = 18, decimals = 18) {
  const a = FixedNumber.fromValue(bnA, decA);
  const b = FixedNumber.fromValue(bnB, decB);

  if (b.isZero()) {
    return utils.parseUnits("0", decimals);
  }

  return utils.parseUnits(a.divUnsafe(b).round(decimals).toString(), decimals);
}

/**
 * Returns the multiplication of two big numbers
 */
export function mulUnsafe(bnA, bnB, decA = 18, decB = 18, decimals = 18) {
  const a = FixedNumber.fromValue(bnA, decA);
  const b = FixedNumber.fromValue(bnB, decB);

  return utils.parseUnits(a.mulUnsafe(b).round(decimals).toString(), decimals);
}

/**
 * Returns a new amount with applied slippage percentage
 *
 * Uses `FixedNumber` to assist with fractions.
 *
 * Base `pct` default to 0.
 * If you set `slippage` to 0 and use an arbitrary `pct` you can apply directly
 * a percentage to the `amount`.
 */
export function applyPct(amount, decimals, slippage, pct = "100") {
  const estSlippage = FixedNumber.fromString(
    (parseFloat(pct) - parseFloat(slippage)).toFixed(decimals)
  ).divUnsafe(FixedNumber.fromString((100.0).toFixed(decimals)));

  const minAmount = FixedNumber.fromValue(amount, decimals).mulUnsafe(
    estSlippage
  );

  return utils.parseUnits(minAmount.round(decimals).toString(), decimals);
}

/**
 * Returns the percentage of two numbers
 *
 * Uses `FixedNumber` to assist with fractions.
 */
export function pctOf(base, amount, decimals) {
  const parsedBase = FixedNumber.fromValue(base, decimals);

  if (parsedBase.isZero()) {
    return utils.parseUnits("0", decimals);
  }

  const left = FixedNumber.fromString((100.0).toFixed(decimals))
    .mulUnsafe(FixedNumber.fromValue(amount, decimals))
    .divUnsafe(parsedBase);

  return utils.parseUnits(left.round(decimals).toString(), decimals);
}

/**
 * Returns pairs graph and a map of pairs to their addresses
 *
 * We build the edge keys using the pair address and the direction.
 */
export function buildGraph(pairs) {
  const graph = new Graph();
  const pairsByAddress = {};

  pairs.forEach((pair) => {
    const tokenA = pair.token0.toLowerCase();
    const tokenB = pair.token1.toLowerCase();
    const pairAddress = pair.lp.toLowerCase();

    // @ts-ignore
    graph.mergeEdgeWithKey(`direct:${pairAddress}`, tokenA, tokenB);
    // @ts-ignore
    graph.mergeEdgeWithKey(`reversed:${pairAddress}`, tokenB, tokenA);

    pairsByAddress[pairAddress] = { ...pair, address: pairAddress };
  });

  return [graph, pairsByAddress];
}

/**
 * Generates possible routes from token A -> token B
 *
 * Based on the graph, returns a list of hops to get from tokenA to tokenB.
 *
 * Eg.:
 *  [
 *    [
 *      { fromA, toB, type, factory1 }
 *    ],
 *    [
 *      { fromA, toX, type, factory2 },
 *      { fromX, toB, type, factory1 }
 *    ],
 *    [
 *      { fromA, toY, type, factory1 },
 *      { fromY, toX, type, factory2 },
 *      { fromX, toB, type, factory1 }
 *    ]
 *  ]
 */
function getRoutes(pairs, fromToken, toToken, maxHops = 3) {
  if (isEmpty(pairs) || !fromToken || !toToken) {
    return [];
  }

  const [graph, pairsByAddress] = buildGraph(pairs);

  // @ts-ignore
  if (graph?.size < 1) {
    return [];
  }

  let paths = [];

  try {
    paths = allSimpleEdgeGroupPaths(
      graph,
      fromToken?.wrappedAddress || fromToken.address,
      toToken?.wrappedAddress || toToken.address,
      { maxDepth: maxHops }
    );
  } catch {
    return [];
  }

  return paths
    .map((pathSet) => {
      const mappedPathSet = pathSet.map((pairAddresses) => {
        const pairAddressWithDirection = pairAddresses[0];
        const [dir, pairAddress] = pairAddressWithDirection.split(":");
        const pair = pairsByAddress[pairAddress];

        if (dir === "reversed") {
          return {
            from: pair.token1,
            to: pair.token0,
            stable: pair.stable,
            factory: pair.factory,
          };
        }

        return {
          from: pair.token0,
          to: pair.token1,
          stable: pair.stable,
          factory: pair.factory,
        };
      });

      return mappedPathSet;
    })
    .filter((pathSet) => !isEmpty(pathSet));
}

/**
 * Returns the best quote for a bunch of routes and an amount
 *
 * TODO: We could split the `amount` between multiple routes
 * if the quoted amount is the same. This should theoretically limit
 * the price impact on a trade.
 */
async function fetchQuote(routes, amount, chunkSize = 50) {
  const routeChunks = chunk(routes, chunkSize);
  // Split into chunks are get the route quotes...
  const quotePromises = routeChunks.map((routeChunk) => {
    return readContracts({
      contracts: routeChunk.map((route) => ({
        address: ROUTER_ADDRESS,
        abi: ROUTER_ABI,
        functionName: "getAmountsOut",
        args: [amount, route],
      })),
    }).then((amountChunks) => {
      return amountChunks.map((amountsOut, cIndex) => {
        // Ignore bad quotes...
        // @ts-ignore
        if (!amountsOut || amountsOut.length < 1) {
          return null;
        }

        // @ts-ignore
        const amountOut = amountsOut[amountsOut.length - 1];

        // Ignore zero quotes...
        // @ts-ignore
        if (amountOut.isZero()) {
          return null;
        }

        return { route: routeChunk[cIndex], amount, amountOut, amountsOut };
      });
    });
  });

  const quoteChunks = await Promise.all(quotePromises);

  // Filter out bad quotes and find the best one...
  const bestQuote = quoteChunks
    .flat()
    .filter(Boolean)
    .reduce((best, quote) => {
      if (!best) {
        return quote;
      } else {
        return best.amountOut.gt(quote.amountOut) ? best : quote;
      }
    }, null);

  if (!bestQuote) {
    return null;
  }

  return { ...bestQuote, priceImpact: await fetchPriceImpact(bestQuote) };
}

/**
 * Fetches and calculates the price impact for a quote
 */
export async function fetchPriceImpact(quote) {
  const tradeDiffs = await readContracts({
    contracts: quote.route.map((route, index) => ({
      address: LIBRARY_ADDRESS,
      abi: [
        "function getTradeDiff(uint, address, address, bool, address) view returns (uint a, uint b)",
      ],
      functionName: "getTradeDiff",
      args: [
        quote.amountsOut[index],
        route.from,
        route.to,
        route.stable,
        route.factory,
      ],
    })),
  });

  let totalRatio = utils.parseUnits("1.0");

  tradeDiffs.filter(Boolean).forEach((diff) => {
    // @ts-ignore
    if (diff && diff.a.isZero()) {
      totalRatio = utils.parseUnits("0");
    } else {
      // @ts-ignore
      totalRatio = totalRatio.mul(diff.b).div(diff.a);
    }
  });

  return utils.parseUnits("1.0").sub(totalRatio).mul(100);
}

/**
 * Returns the quote for a tokenA -> tokenB
 */
export function useQuote(pairs, fromToken, toToken, amount, opts = {}) {
  return useQuery(
    ["fetchQuote", pairs, fromToken, toToken, amount],
    () => fetchQuote(getRoutes(pairs, fromToken, toToken), amount),
    {
      ...opts,
      // 1 minute...
      refetchInterval: 1_000 * 60,
      keepPreviousData: false,
    }
  );
}
