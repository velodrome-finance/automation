import Graph from "graphology";
import { chunk, isEmpty } from "lodash";
import { parseUnits } from "@ethersproject/units";
import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { allSimpleEdgeGroupPaths } from "graphology-simple-path";

import { LIBRARY_ABI, LIBRARY_ADDRESS, ROUTER_ABI, ROUTER_ADDRESS } from "../../constants";

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
      fromToken,
      toToken,
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
async function fetchQuote(routes, amount, provider: Provider, chunkSize = 50) {
  const routeChunks = chunk(routes, chunkSize);
  let router: Contract = new Contract(ROUTER_ADDRESS,ROUTER_ABI, provider);
  amount = BigNumber.from(10).pow(10); // TODO: Remove this after fix

  // Split into chunks and get the route quotes...
  let quotePromises = routeChunks.map((routeChunk) => {
      return Promise.all(
          routeChunk
            .map((route) => router.getAmountsOut(amount, route))
      ).then((amountChunks) => {
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
           })
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

  return {
    ...bestQuote,
    priceImpact: await fetchPriceImpact(bestQuote, provider),
  };
}

/**
 * Fetches and calculates the price impact for a quote
 */
export async function fetchPriceImpact(quote, provider: Provider) {
  let library = new Contract(LIBRARY_ADDRESS, LIBRARY_ABI, provider);

  const tradeDiffs = await Promise.all(
    quote.route.map((route, index) =>
      library.functions["getTradeDiff(uint256,address,address,bool,address)"](
        quote.amountsOut[index],
        route.from,
        route.to,
        route.stable,
        route.factory
      )
    )
  );

  let totalRatio = parseUnits("1.0");

  tradeDiffs.filter(Boolean).forEach((diff) => {
    // @ts-ignore
    if (diff && diff.a.isZero()) {
      totalRatio = parseUnits("0");
    } else {
      // @ts-ignore
      totalRatio = totalRatio.mul(diff.b).div(diff.a);
    }
  });

  return parseUnits("1.0").sub(totalRatio).mul(100);
}

/**
 * Returns the quote for a tokenA -> tokenB
 */
export async function useQuote(
  pairs,
  fromToken,
  toToken,
  amount,
  provider: Provider
) {
  return await fetchQuote(getRoutes(pairs, fromToken.toLowerCase(), toToken.toLowerCase()), amount, provider);
}