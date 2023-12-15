// SPDX-License-Identifier: BUSL-1.1
import Graph from "graphology";
import { chunk, isEmpty } from "lodash";
import { Contract, Provider } from "ethers";
import { allSimpleEdgeGroupPaths } from "graphology-simple-path";

import { Route } from "../common-utils/constants";
import { ROUTER_ADDRESS } from "./base-constants";

const MAX_ROUTES = 50;

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
  highLiqTokens: string[],
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

  let paths: Route[][] = [];

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

  // Filters out High Liquidity Tokens and extra Routes if max length is exceeded
  return filterPaths(paths, [...highLiqTokens, fromToken, toToken], MAX_ROUTES);
}

// Filters out 2 Hop Paths until MaxLength is not surpassed
function filterPaths(
  paths: Route[][],
  highLiqTokens: string[],
  maxLength: number
): Route[][] {
  paths = paths.filter((routes: Route[]) =>
    routes.every(
      (r: Route) =>
        highLiqTokens.includes(r.to.toLowerCase()) &&
        highLiqTokens.includes(r.from.toLowerCase())
    )
  );
  if (paths.length > maxLength) {
    const itemsToRemove: number = paths.length - maxLength;
    let filteredArray: Route[][] = [];
    let count = 0;
    for (let i = 0; i < paths.length; i++) {
      const path: Route[] = paths[i];
      if (count < itemsToRemove) {
        if (path.length == 1) filteredArray.push(path);
        // Ignore tokens with more than 1 hop
        else count++;
      } else filteredArray.push(path);
    }
    paths = filteredArray;
  }
  return paths;
}

/**
 * Returns the best quote for a bunch of routes and an amount
 *
 * if the quoted amount is the same. This should theoretically limit
 * the price impact on a trade.
 */
export async function fetchQuote(
  routes: Route[][],
  amount: BigInt,
  provider: Provider,
  chunkSize = 50
) {
  const routeChunks = chunk(routes, chunkSize);
  const router: Contract = new Contract(
    ROUTER_ADDRESS,
    [
      "function getAmountsOut(uint256,tuple(address from, address to, bool stable, address factory)[]) public view returns (uint256[] memory)",
    ],
    provider
  );

  let quoteChunks = [];
  // Split into chunks and get the route quotes...
  for (const routeChunk of routeChunks) {
    for (const route of routeChunk) {
      let amountsOut;
      try {
        amountsOut = await router.getAmountsOut(amount, route);
      } catch (err) {
        amountsOut = [];
      }

      // Ignore bad quotes...
      if (amountsOut && amountsOut.length >= 1) {
        const amountOut: BigInt = amountsOut[amountsOut.length - 1];

        // Ignore zero quotes...
        if (amountOut != 0n)
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
        return best.amountOut > quote.amountOut ? best : quote;
      }
    }, null);

  if (!bestQuote) {
    return null;
  }

  return bestQuote;
}
