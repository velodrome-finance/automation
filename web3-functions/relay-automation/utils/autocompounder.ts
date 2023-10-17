// SPDX-License-Identifier: BUSL-1.1
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import { abi as compAbi } from "../../../artifacts/lib/relay-private/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import { PROCESSING_COMPLETE, TxData, VELO } from "../utils/constants";
import { buildGraph, fetchQuote, getRoutes } from "./quote";
import { getClaimCalls, getPools } from "./rewards";

const REWARDS_TO_FETCH = 150;
const POOLS_TO_FETCH = 150;

// Encode AutoCompounder calls, one per Execution
export async function processAutoCompounder(
    relayAddr: string,
    factoryAddr: string,
    stageName: string,
    storage,
    provider: Provider
): Promise<TxData[]> {
    // Process AutoCompounder
    const relay = new Contract(relayAddr, compAbi, provider);
    const abi = relay.interface;

    let calls: string[] = [];
    // Process Relay Rewards
    if(stageName == "claim") {
      calls = await getClaimCalls(relay, REWARDS_TO_FETCH, storage);
      if(calls.length == 1 && calls[0] == PROCESSING_COMPLETE) { // If no Claim calls left, next stage is Swap
        stageName = "swap";
        calls = [];
      }
    }

    // Process a Swap per Call
    if(stageName == "swap") {// If no Swaps left, next call should be Compound
      const call = await encodeAutoCompounderSwap(relayAddr, factoryAddr, storage, provider);
      stageName = await storage.get("currStage"); // Check if Current Stage changed

      if(call)
        calls.push(call);

      if(stageName == "compound") { // If all swaps were encoded, next stage will be "compound"
        calls.push(abi.encodeFunctionData("compound"));
        await storage.set("currStage", "complete"); // After compounding Relay is processed
      }
    }

    // TODO: encode calls in multicall to save gas?
    return calls.map((call) => ({to: relay.address, data: call} as TxData));
}

// Encodes all Swaps for AutoCompounder
async function encodeAutoCompounderSwap(
    relayAddr: string,
    factoryAddr: string,
    storage,
    provider: Provider
): Promise<string> {
    const factory = new Contract(
      factoryAddr,
      ["function highLiquidityTokens() view returns (address[] memory)"],
      provider
    );

    let queue: string = (await storage.get("tokensQueue")) ?? "";
    let tokensQueue: string[] = queue.length != 0 ? JSON.parse(queue) : [];
    queue = (await storage.get("balancesQueue")) ?? "";
    let balancesQueue: string[] = queue.length != 0 ? JSON.parse(queue) : [];

    // Set current Stage and Initial Tokens Queue
    if(tokensQueue.length == 0) { // processing of swaps hasn't started
      await storage.set("currStage", "swap");
      tokensQueue = await factory.highLiquidityTokens();
      ({tokens: tokensQueue, balances: balancesQueue} = await filterHighLiqTokens(relayAddr, tokensQueue, provider));
    }

    // Process next Swap from Tokens Queue
    return await encodeSwapFromTokens(relayAddr, tokensQueue, balancesQueue, storage, provider);
}

async function filterHighLiqTokens(relayAddr: string, highLiqTokens: string[], provider: Provider) {
    let tokensQueue: string[] = [];
    let balancesQueue: string[] = [];
    for(const token of highLiqTokens) {
      const bal: BigNumber = await new Contract(
        token,
        ["function balanceOf(address) view returns (uint256)"],
        provider
      ).balanceOf(relayAddr);
      if(!bal.isZero()) {
          tokensQueue.push(token);
          balancesQueue.push(bal.toString());
      }
    }
    return {tokens: tokensQueue, balances: balancesQueue};
}

// TODO: If not for Compounding this could be on relay.ts
// From a Relay Address and a list of Tokens, encode a swap per call
async function encodeSwapFromTokens(relayAddr: string, tokensQueue: string[], balancesQueue: string[], storage, provider: Provider): Promise<string> {
  const [poolsGraph, poolsByAddress] = buildGraph(
    await getPools(provider, POOLS_TO_FETCH)
  ); // TODO: Find right value, was using 600, 0

  const relay = new Contract(relayAddr, compAbi, provider);
  const abi = relay.interface;
  let call = "";
  // Process One Swap per Execution
  for(let i = 0; i < tokensQueue.length; i++) {

    // Fetch Relay balance
    const token = tokensQueue[i];
    const bal = BigNumber.from(balancesQueue[i]);

    if(!bal.isZero()) { // Skip tokens with zero balance
      const quote = await fetchQuote(
        getRoutes(
          poolsGraph,
          poolsByAddress,
          token.toLowerCase(),
          VELO.toLowerCase()
        ),
        bal,
        provider
      );

    if (quote) { // If best quote was found
        // Encode swap call
        call = abi.encodeFunctionData("swapTokenToVELOWithOptionalRoute", [
          token,
          500, // TODO: Find desired slippage
          quote
        ]);

        // update queues
        tokensQueue = tokensQueue.slice(i + 1);
        balancesQueue = balancesQueue.slice(i + 1);
        if(tokensQueue.length != 0) { // if there are still tokens in queue, continue
          await storage.set("tokensQueue", JSON.stringify(tokensQueue));
          await storage.set("balancesQueue", JSON.stringify(balancesQueue));
          return call;
        }
      }
    }
  }
  await storage.set("currStage", "compound"); // Next stage is compound encoding
  await storage.delete("balancesQueue");
  await storage.delete("tokensQueue");
  return call;
}

