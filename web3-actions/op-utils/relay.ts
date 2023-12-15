// SPDX-License-Identifier: BUSL-1.1
import { Contract, Wallet } from "ethers";

import { abi as compAbi } from "../abis/AutoCompounder.json";
import { abi as convAbi } from "../abis/AutoConverter.json";
import { buildGraph, fetchQuote, getRoutes } from "./quote";
//TODO: remove logswapbalances
import { executeSwaps, logSwapBalances } from "../common-utils/relay";
import { claimRewards, getPools } from "./rewards";
import {
  VELO_EXCLUDED_RELAYS,
  LP_SUGAR_ADDRESS,
  LP_SUGAR_ABI,
  VELO,
} from "./op-constants";

export async function processRelay(
  relayAddr: string,
  factoryAddr: string,
  targetToken: string,
  isAutoCompounder: boolean,
  wallet: Wallet
) {
  // Process AutoCompounder
  const abi = isAutoCompounder ? compAbi : convAbi;
  const relay = new Contract(relayAddr, abi, wallet);
  const lpSugarContract: Contract = new Contract(
    LP_SUGAR_ADDRESS,
    LP_SUGAR_ABI,
    relay.runner
  );

  const claimedTokens = await claimRewards(relay, lpSugarContract);
  await processSwaps(
    relay,
    factoryAddr,
    claimedTokens,
    targetToken,
    lpSugarContract,
    isAutoCompounder
  );

  if (isAutoCompounder) {
    try {
      const tx = await relay.compound();
      await tx.wait();
      console.log("Compounding has happened successfully.");
      console.log(tx.hash);
    } catch (err) {
      console.log("Error while compounding tokens.");
    }

    //TODO: Logging for debugging purposes
    const veloBal = await new Contract(
      VELO,
      ["function balanceOf(address) view returns (uint256)"],
      relay.runner
    ).balanceOf(relay.target.toString());
    console.log(`VELO Bal = ${veloBal}`);
  }
}

async function processSwaps(
  relay: Contract,
  factoryAddr: string,
  tokensToSwap: string[],
  targetToken: string,
  lpSugarContract: Contract,
  isAutoCompounder: boolean
) {
  const factory = new Contract(
    factoryAddr,
    ["function highLiquidityTokens() view returns (address[] memory)"],
    relay.runner
  );
  // Get all tokens to Swap
  const highLiqTokens = await factory.highLiquidityTokens();
  tokensToSwap = [...new Set(tokensToSwap.concat(highLiqTokens))].filter(
    (addr: string) => addr.toLowerCase() !== targetToken.toLowerCase()
  );
  const relayAddr: string = relay.target.toString();
  if (
    VELO_EXCLUDED_RELAYS.map((addr) => addr.toLowerCase()).includes(
      relayAddr.toLowerCase()
    )
  )
    // if foundation relay, do not swap velo
    tokensToSwap = tokensToSwap.filter(
      (addr: string) => addr.toLowerCase() !== VELO.toLowerCase()
    );

  // TODO: Logging for debugging purposes
  await logSwapBalances(relay, tokensToSwap, targetToken);

  // Getting quotes for all Swaps
  let [quotes, failedQuotes] = await getQuotes(
    relayAddr,
    lpSugarContract,
    highLiqTokens,
    tokensToSwap,
    targetToken
  );
  const claimFunction = isAutoCompounder
    ? "swapTokenToVELOWithOptionalRoute"
    : "swapTokenToTokenWithOptionalRoute";
  let [txs, failedSwaps] = await executeSwaps(
    relay,
    tokensToSwap,
    quotes,
    claimFunction
  );

  console.log("All swaps processed.");
  console.log("These are the tokens that could not be swapped:");
  console.log(failedQuotes.concat(failedSwaps));
  console.log(
    `TokensToSwap: ${tokensToSwap.length} Failed Swaps: ${
      failedQuotes.concat(failedSwaps).length
    }`
  );

  // TODO: Logging for debugging purposes
  await logSwapBalances(relay, tokensToSwap, targetToken);

  console.log("All transactions successfully executed.");
  console.log("Tx hashes:");
  console.log(txs.filter(Boolean).map((tx) => tx.hash));
}

async function getQuotes(
  relayAddr: string,
  lpSugarContract: Contract,
  highLiqTokens: string[],
  tokensToSwap: string[],
  targetToken: string
) {
  console.log("Will fetch pools now...");
  const [poolsGraph, poolsByAddress] = buildGraph(
    await getPools(lpSugarContract)
  );
  console.log("All pools fetched");

  const balances: BigInt[] = await Promise.all(
    tokensToSwap.map((addr) =>
      new Contract(
        addr,
        ["function balanceOf(address) view returns (uint256)"],
        lpSugarContract.runner
      ).balanceOf(relayAddr)
    )
  );

  let failedTokens: string[] = [];
  const provider = lpSugarContract.runner?.provider;
  console.log("Will fetch all quotes now...");
  const quotes = await Promise.all(
    tokensToSwap.map((token, i) => {
      return new Promise(async (resolve, _) => {
        let quote;
        try {
          const bal = balances[i];
          if (bal > 0n && provider) {
            let hops = 2;
            // refetch quote with up to 3 hops if no route found
            while (!quote && hops <= 3) {
              quote = await fetchQuote(
                getRoutes(
                  poolsGraph,
                  poolsByAddress,
                  token.toLowerCase(),
                  targetToken.toLowerCase(),
                  highLiqTokens.map((token: string) => token.toLowerCase()),
                  hops++
                ),
                bal,
                provider
              );
            }
            if (!quote) {
              failedTokens.push(token);
              console.log(`Did not fetch quote for token ${token}`);
            }
          }
        } catch (error) {
          console.log("Error while fetching Quote.");
        } finally {
          resolve(quote);
        }
      });
    })
  );
  return [quotes, failedTokens];
}
