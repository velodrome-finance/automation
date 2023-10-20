// SPDX-License-Identifier: BUSL-1.1
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import { abi as convAbi } from "../../../artifacts/lib/relay-private/src/autoConverter/AutoConverter.sol/AutoConverter.json";
import { buildGraph, fetchQuote, getRoutes, isPriceImpactTooHigh } from "./quote";
import { getClaimCalls, getPools } from "./rewards";
import {
  PROCESSING_COMPLETE,
  CLAIM_STAGE,
  SWAP_STAGE,
  TxData,
} from "../utils/constants";

// Encode AutoConverter calls, one per Execution
export async function processAutoConverter(
  relayAddr: string,
  factoryAddr: string,
  stageName: string,
  storage,
  provider: Provider
): Promise<TxData[]> {
  // Process AutoConverter
  const relay = new Contract(relayAddr, convAbi, provider);

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
    const call = await encodeAutoConverterSwap(
      relayAddr,
      factoryAddr,
      storage,
      provider
    );

    if (call) calls.push(call);
  }
  return calls.map((call) => ({ to: relay.address, data: call } as TxData));
}

// Encodes all Swaps for AutoConverter
async function encodeAutoConverterSwap(
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
  if (tokensQueue.length == 0) {
    // processing of swaps hasn't started
    await storage.set("currStage", SWAP_STAGE);
    tokensQueue = await factory.highLiquidityTokens();
    ({ tokens: tokensQueue, balances: balancesQueue } =
      await filterHighLiqTokens(relayAddr, tokensQueue, provider));
  }

  // Process next Swap from Tokens Queue
  return await encodeSwapFromTokens(
    relayAddr,
    tokensQueue,
    balancesQueue,
    storage,
    provider
  );
}

// From a Relay Address and a list of Tokens, encode a swap per call
async function encodeSwapFromTokens(
  relayAddr: string,
  tokensQueue: string[],
  balancesQueue: string[],
  storage,
  provider: Provider
): Promise<string> {
  const [poolsGraph, poolsByAddress] = buildGraph(await getPools(provider));

  const relay = new Contract(relayAddr, convAbi, provider);
  const abi = relay.interface;
  let call: string = "";
  // Process One Swap per Execution
  const token = tokensQueue.shift();

  // Fetch best Swap quote
  let quote;
  if (token) {
    const bal = BigNumber.from(balancesQueue.shift());
    const targetToken = await relay.token();
    quote = await fetchQuote(
      getRoutes(
        poolsGraph,
        poolsByAddress,
        token.toLowerCase(),
        targetToken.toLowerCase()
      ),
      bal,
      provider
    );
  }

  if (quote) {
    const slippage = await isPriceImpactTooHigh(quote, provider) ? 500 : 100;

    // If best quote was found, encode swap call
    call = abi.encodeFunctionData("swapTokenToTokenWithOptionalRoute", [
      token,
      slippage,
      quote.route,
    ]);

    // update queues
    if (tokensQueue.length != 0) {
      // if there are still tokens in queue, continue
      await storage.set("balancesQueue", JSON.stringify(balancesQueue));
      await storage.set("tokensQueue", JSON.stringify(tokensQueue));
      return call;
    }
  }
  await storage.set("currStage", PROCESSING_COMPLETE); // After Swapping, AutoConverter is finished
  await storage.delete("balancesQueue");
  await storage.delete("tokensQueue");
  return call;
}

async function filterHighLiqTokens(
  relayAddr: string,
  highLiqTokens: string[],
  provider: Provider
) {
  const relay = new Contract(relayAddr, convAbi, provider);
  const targetToken = await relay.token();
  highLiqTokens = highLiqTokens.filter((e) => e != targetToken);
  let tokensQueue: string[] = [];
  let balancesQueue: string[] = [];
  for (const token of highLiqTokens) {
    const bal: BigNumber = await new Contract(
      token,
      ["function balanceOf(address) view returns (uint256)"],
      provider
    ).balanceOf(relayAddr);
    if (!bal.isZero()) {
      tokensQueue.push(token);
      balancesQueue.push(bal.toString());
    }
  }
  return { tokens: tokensQueue, balances: balancesQueue };
}
