// SPDX-License-Identifier: BUSL-1.1
import { Contract, Wallet } from "ethers";

import { abi as compAbi } from "../abis/AutoCompounder.json";
import { abi as convAbi } from "../abis/AutoConverter.json";
import { buildGraph, fetchQuote, getRoutes } from "./quote";
import { executeSwaps } from "../common-utils/helpers";
import { claimRewards, getPools } from "./rewards";
import {
  AERO_EXCLUDED_RELAYS,
  LP_SUGAR_ADDRESS,
  LP_SUGAR_ABI,
  AERO,
} from "./base-constants";

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
    } catch (err) {
      console.log("Error while compounding tokens.");
    }
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
    AERO_EXCLUDED_RELAYS.map((addr) => addr.toLowerCase()).includes(
      relayAddr.toLowerCase()
    )
  )
    // if foundation relay, do not swap aero
    tokensToSwap = tokensToSwap.filter(
      (addr: string) => addr.toLowerCase() !== AERO.toLowerCase()
    );

  // Getting quotes for all Swaps
  let [quotes, _] = await getQuotes(
    relayAddr,
    lpSugarContract,
    highLiqTokens,
    tokensToSwap,
    targetToken
  );
  const claimFunction = isAutoCompounder
    ? "swapTokenToVELOWithOptionalRoute"
    : "swapTokenToTokenWithOptionalRoute";
  await executeSwaps(relay, tokensToSwap, quotes, claimFunction);
}

async function getQuotes(
  relayAddr: string,
  lpSugarContract: Contract,
  highLiqTokens: string[],
  tokensToSwap: string[],
  targetToken: string
) {
  const [poolsGraph, poolsByAddress] = buildGraph(
    await getPools(lpSugarContract)
  );

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
  const quotes = await Promise.all(
    tokensToSwap.map((token, i) => {
      return new Promise(async (resolve, _) => {
        let quote;
        try {
          const bal = balances[i];
          if (bal > 0n && provider) {
            quote = await fetchQuote(
              getRoutes(
                poolsGraph,
                poolsByAddress,
                token.toLowerCase(),
                targetToken.toLowerCase(),
                highLiqTokens.map((token: string) => token.toLowerCase()),
                3
              ),
              bal,
              provider
            );
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
