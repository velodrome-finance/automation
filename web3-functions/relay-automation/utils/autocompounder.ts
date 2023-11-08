// SPDX-License-Identifier: BUSL-1.1
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import { abi as compAbi } from "../../../artifacts/lib/relay-private/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import {
  isPriceImpactTooHigh,
  buildGraph,
  fetchQuote,
  getRoutes,
} from "./quote";
import { getClaimCalls, getPools } from "./rewards";
import {
  PROCESSING_COMPLETE,
  COMPOUND_STAGE,
  CLAIM_STAGE,
  SWAP_STAGE,
  TxData,
  VELO,
} from "../utils/constants";

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
  if (stageName == CLAIM_STAGE) {
    calls = await getClaimCalls(relay, storage);
    if (calls.length == 1 && calls[0] == PROCESSING_COMPLETE) {
      // If no Claim calls left, next stage is Swap
      stageName = SWAP_STAGE;
      calls = [];
    }
  }

  // Process a Swap per Call
  if (stageName == SWAP_STAGE) {
    // If no Swaps left, next call should be Compound
    const call = await encodeAutoCompounderSwap(
      relayAddr,
      factoryAddr,
      storage,
      provider
    );
    stageName = await storage.get("currStage"); // Check if Current Stage changed

    if (call) calls.push(call);

    if (stageName == COMPOUND_STAGE) {
      // If all swaps were encoded, next stage will be "compound"
      if (calls.length > 0) {
        // A swap has happened
        calls.push(abi.encodeFunctionData("compound"));
        calls = [abi.encodeFunctionData("multicall", [calls])];
      } else {
        const bal: BigNumber = await new Contract(
          VELO,
          ["function balanceOf(address) view returns (uint256)"],
          provider
        ).balanceOf(relayAddr);
        if (!bal.isZero()) {
          // if Relay has VELO, compound it
          calls.push(abi.encodeFunctionData("compound"));
        }
      }
      await storage.set("currStage", PROCESSING_COMPLETE); // After compounding Relay is processed
    }
  }

  return calls.map((call) => ({ to: relay.address, data: call } as TxData));
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
  const highLiqTokens = await factory.highLiquidityTokens();

  // Set current Stage and Initial Tokens Queue
  if (tokensQueue.length == 0) {
    // processing of swaps hasn't started
    queue = (await storage.get("claimedTokens")) ?? "";
    let claimedTokens: string[] = queue.length != 0 ? JSON.parse(queue) : [];
    claimedTokens = claimedTokens.filter(
      (addr: string) => addr.toLowerCase() !== VELO.toLowerCase()
    );

    tokensQueue = [...new Set(claimedTokens.concat(highLiqTokens))];
    await storage.set("currStage", SWAP_STAGE);
    await storage.delete("claimedTokens");
  }

  // Process next Swap from Tokens Queue
  return await encodeSwapFromTokens(
    relayAddr,
    tokensQueue,
    highLiqTokens,
    storage,
    provider
  );
}

// From a Relay Address and a list of Tokens, encode a swap per call
async function encodeSwapFromTokens(
  relayAddr: string,
  tokensQueue: string[],
  highLiqTokens: string[],
  storage,
  provider: Provider
): Promise<string> {
  const [poolsGraph, poolsByAddress] = buildGraph(await getPools(provider));

  const abi = new Contract(relayAddr, compAbi, provider).interface;
  let call: string = "";
  // Process One Swap per Execution
  const token = tokensQueue[0];
  tokensQueue = tokensQueue.slice(1);

  // Fetch best Swap quote
  let quote;
  if (token) {
    const bal: BigNumber = await new Contract(
      token,
      ["function balanceOf(address) view returns (uint256)"],
      provider
    ).balanceOf(relayAddr);
    if (!bal.isZero())
      quote = await fetchQuote(
        getRoutes(
          poolsGraph,
          poolsByAddress,
          token.toLowerCase(),
          VELO.toLowerCase(),
          highLiqTokens.map((token) => token.toLowerCase())
        ),
        bal,
        provider
      );
  }

  if (quote) {
    const isHighLiq = highLiqTokens
      .concat([VELO.toLowerCase()])
      .map((t) => t.toLowerCase())
      .includes(token);
    const slippage = (await isPriceImpactTooHigh(quote, isHighLiq, provider))
      ? 500
      : 200;

    // If best quote was found, encode swap call
    call = abi.encodeFunctionData("swapTokenToVELOWithOptionalRoute", [
      token,
      slippage,
      quote.route,
    ]);
  }
  // update queues
  if (tokensQueue.length != 0) {
    // if there are still tokens in queue, continue
    await storage.set("tokensQueue", JSON.stringify(tokensQueue));
  } else {
    // next stage is compound encoding
    await storage.set("currStage", COMPOUND_STAGE);
    await storage.delete("tokensQueue");
  }
  return call;
}
