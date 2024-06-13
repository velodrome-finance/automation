// SPDX-License-Identifier: BUSL-1.1
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import { abi as convAbi } from "../../../artifacts/lib/relay-private/src/autoConverter/AutoConverter.sol/AutoConverter.json";
import {
  buildGraph,
  fetchQuote,
  getRoutes,
} from "./quote";
import { getClaimCalls, getPools } from "./rewards";
import {
  PROCESSING_COMPLETE,
  CLAIM_STAGE,
  USDC_RELAY2,
  USDC_RELAY,
  SWAP_STAGE,
  TxData,
  AERO,
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
  const highLiqTokens = await factory.highLiquidityTokens();

  // Set current Stage and Initial Tokens Queue
  if (tokensQueue.length == 0) {
    // processing of swaps hasn't started
    queue = (await storage.get("claimedTokens")) ?? "";
    let claimedTokens: string[] = queue.length != 0 ? JSON.parse(queue) : [];
    if (relayAddr == USDC_RELAY || relayAddr == USDC_RELAY2)
      // if foundation relay, do not swap aero
      claimedTokens = claimedTokens.filter(
        (addr: string) => addr.toLowerCase() !== AERO.toLowerCase()
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

  const relay = new Contract(relayAddr, convAbi, provider);
  const abi = relay.interface;
  let call: string = "";
  // Process One Swap per Execution
  const token = tokensQueue[0];
  tokensQueue = tokensQueue.slice(1);

  // Fetch best Swap quote
  let quote;
  const targetToken = await relay.token();
  if (token && token.toLowerCase() != targetToken.toLowerCase()) {
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
          targetToken.toLowerCase(),
          highLiqTokens.map((token) => token.toLowerCase())
        ),
        bal,
        provider
      );
  }

  if (quote) {
    // If best quote was found, encode swap call
    call = abi.encodeFunctionData("swapTokenToTokenWithOptionalRoute", [
      token,
      500,
      quote.route,
    ]);
  }
  // update queues
  if (tokensQueue.length != 0) {
    // If there are still tokens in queue, continue
    await storage.set("tokensQueue", JSON.stringify(tokensQueue));
  } else {
    // After Swapping all tokens, AutoConverter is finished
    await storage.set("currStage", PROCESSING_COMPLETE);
    await storage.delete("tokensQueue");
  }
  return call;
}
