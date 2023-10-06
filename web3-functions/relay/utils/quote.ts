// SPDX-License-Identifier: BUSL-1.1
import Graph from "graphology";
import { chunk, isEmpty } from "lodash";
import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { allSimpleEdgeGroupPaths } from "graphology-simple-path";

import { ROUTER_ADDRESS, Route } from "./constants";

/**
 * Returns pairs graph and a map of pairs to their addresses
 *
 * We build the edge keys using the pair address and the direction.
 */
export function buildGraph(pairs) {
  const graph = new Graph({ multi: true });
  const pairsByAddress = {};

  if (!isEmpty(pairs))
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
export function getRoutes(
  graph,
  pairsByAddress,
  fromToken: string,
  toToken: string,
  maxHops = 2
): Route[][] {
  if (!fromToken || !toToken) {
    return [];
  }

  // @ts-ignore
  if (graph?.size < 1) {
    return [];
  }

  let graphPaths = [];

  try {
    graphPaths = allSimpleEdgeGroupPaths(graph, fromToken, toToken, {
      maxDepth: maxHops,
    });
  } catch {
    return [];
  }

  const paths = [];

  graphPaths.map((pathSet) => {
    let mappedPathSets = [];

    pathSet.map((pairAddresses, index) => {
      const currentMappedPathSets = [];
      pairAddresses.map((pairAddressWithDirection) => {
        const [dir, pairAddress] = pairAddressWithDirection.split(":");
        const pair = pairsByAddress[pairAddress];
        const routeComponent = {
          from: pair.token0,
          to: pair.token1,
          stable: pair.stable,
          factory: pair.factory,
        };
        if (dir === "reversed") {
          routeComponent.from = pair.token1;
          routeComponent.to = pair.token0;
        }

        index == 0
          ? currentMappedPathSets.push([routeComponent])
          : mappedPathSets.map((incompleteSet) => {
              currentMappedPathSets.push(
                incompleteSet.concat([routeComponent])
              );
            });
      });

      mappedPathSets = [...currentMappedPathSets];
    });
    paths.push(...mappedPathSets);
  });
  return paths;
}

/**
 * Returns the best quote for a bunch of routes and an amount
 *
 * TODO: We could split the `amount` between multiple routes
 * if the quoted amount is the same. This should theoretically limit
 * the price impact on a trade.
 */
export async function fetchQuote(
  routes: Route[][],
  amount: BigNumber,
  provider: Provider,
  chunkSize = 50
) {
  const routeChunks = chunk(routes, chunkSize);
  const router: Contract = new Contract(ROUTER_ADDRESS, ["function getAmountsOut(uint256,tuple(address from, address to, bool stable, address factory)[]) public view returns (uint256[] memory)"], provider);
  amount = BigNumber.from(10).pow(10); // TODO: Remove this after fix

  let quoteChunks = [];
  // Split into chunks and get the route quotes...
  for (const routeChunk of routeChunks) {
    for (const route of routeChunk) {
      const amountsOut = await router.getAmountsOut(amount, route);

      // Ignore bad quotes...
      if (amountsOut && amountsOut.length >= 1) {
        const amountOut = amountsOut[amountsOut.length - 1];

        // Ignore zero quotes...
        if (!amountOut.isZero())
          quoteChunks.push({ route, amount, amountOut, amountsOut });
      }
    }
  }

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

  return bestQuote.route;
}
