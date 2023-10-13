// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";

import { abi as compAbi } from "../../artifacts/lib/relay-private/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";
import { RELAY_REGISTRY_ADDRESS, TxData, VELO } from "./utils/constants";
import { buildGraph, fetchQuote, getRoutes } from "./utils/quote";
import { getClaimCalls, getPools } from "./utils/rewards";

//TODO: move this
const POOLS_TO_FETCH = 150; // NOTE: Can currently fetch 600 but can't handle as much
const REWARDS_TO_FETCH = 150;

// TODO: This could be used in General Utils
async function setUpInitialStorage(
  storage,
  provider: Provider
) {
  // Get All Factories from Registry
  let factoriesQueue = await getFactoriesFromRegistry(RELAY_REGISTRY_ADDRESS, provider);
  const currFactory = factoriesQueue[0] ?? "";
  factoriesQueue = factoriesQueue.slice(1);
  // TODO: handle multiple factories, as right this only handles autocompounder
  let factory = new Contract(
    currFactory,
    ["function relays() view returns (address[] memory)"],
    provider
  );

  // Get all Relays from Factory
  let relaysQueue = await factory.relays();
  const currRelay = relaysQueue[0] ?? "";
  relaysQueue = relaysQueue.slice(1);

  // Verify if Relays are AutoCompounders
  let token = await new Contract(
    currRelay,
    ["function token() view returns (address)"],
    provider
  ).token();
  const isAutoCompounder = JSON.stringify(token == jsonConstants.v2.VELO);

  // Set Relays to be Processed
  await storage.set("currRelay", currRelay);
  await storage.set("relaysQueue", JSON.stringify(relaysQueue));
  // Set Factories to be Processed
  await storage.set("currFactory", currFactory);
  await storage.set("factoriesQueue", JSON.stringify(factoriesQueue));
  await storage.set("isAutoCompounder", isAutoCompounder);

  return [currRelay, relaysQueue, currFactory, factoriesQueue, isAutoCompounder]
}

// TODO: This could be used in General Utils
// Retrieve all Relay Factories from the Registry
async function getFactoriesFromRegistry(
  registryAddr: string,
  provider: Provider
): Promise<string[]> {
  const relayFactoryRegistry = new Contract(
    registryAddr,
    ["function getAll() view returns (address[] memory)"],
    provider
  );

  return (await relayFactoryRegistry.getAll());
}

// TODO: This could be used in General Utils Except for Compounding
// From a Relay Address and a list of Tokens, encode a swap per call
async function encodeSwapFromTokens(relayAddr: string, tokensQueue: string[], storage, provider: Provider): Promise<string> {
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
    const bal: BigNumber = await new Contract(
      token,
      ["function balanceOf(address) view returns (uint256)"],
      provider
    ).balanceOf(relayAddr);

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

        tokensQueue = tokensQueue.slice(i + 1); // update queue
        if(tokensQueue.length != 0) { // if there are still tokens in queue, continue
          await storage.set("tokensQueue", JSON.stringify(tokensQueue));
          return call;
        }
      }
    }
  }
  await storage.set("currStage", "compound"); // Next stage is compound encoding
  await storage.delete("tokensQueue");
  return call;
}

// TODO: AutoCompounder specific
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

    // Set current Stage and Initial Tokens Queue
    if(tokensQueue.length == 0) { // processing of swaps hasn't started
      tokensQueue = await factory.highLiquidityTokens();
      await storage.set("currStage", "swap");
    }

    // Process next Swap from Tokens Queue
    return await encodeSwapFromTokens(relayAddr, tokensQueue, storage, provider);
}

// TODO: AutoCompounder specific
// Encode AutoCompounder calls, one per Execution
async function processAutoCompounder(
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
      if(calls.length == 1 && !calls[0]) { // If no Claim calls left, next stage is Swap
        stageName = "swap";
        calls = [];
      }
    }

    // Process a Swap per Call
    if(stageName == "swap") { // If no Swaps left, next call should be Compound
      const call = await encodeAutoCompounderSwap(relayAddr, factoryAddr, storage, provider);
      if(call)
        calls.push(call);
      else {
        calls = [abi.encodeFunctionData("compound")];
        await storage.set("currStage", "complete"); // After compounding Relay is processed
      }
    }

    // TODO: encode calls in multicall to save gas?
    return calls.map((call) => ({to: relay.address, data: call} as TxData));
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { storage, multiChainProvider } = context;
  const provider = multiChainProvider.default();

  // Fetch state of Execution
  // Stages of Execution can either be 'claim', 'swap', 'compound' and 'complete', in this order
  let stageName: string = (await storage.get("currStage")) ?? "";
  let currRelay: string = (await storage.get("currRelay")) ?? "";
  let currFactory: string = (await storage.get("currFactory")) ?? "";

  let queue: string = (await storage.get("relaysQueue")) ?? ""; // fetch relays to process
  let relaysQueue: string[] = queue.length != 0 ? JSON.parse(queue) : [];

  queue = (await storage.get("factoriesQueue")) ?? ""; // fetch factories to process
  let factoriesQueue: string[] = queue.length != 0 ? JSON.parse(queue) : [];

  let isAutoCompounder: string = (await storage.get("isAutoCompounder")) ?? "";
  let txData: TxData[] = [];

  // Setup Initial State for Relay Processing
  // If all past Relays have been processed, restart processing
  //TODO: shorten this verification and also verify if factories are empty
  // Also Verify if lastRunTimestamp < EpochStart + 1Hour
  // Also could verify if stageName is empty
  if(!currRelay && !currFactory) {
    try {
      stageName = "claim"; // Claiming of Rewards is the first stage of Execution
      [currRelay, relaysQueue, currFactory, factoriesQueue, isAutoCompounder] = await setUpInitialStorage(storage, provider);
    } catch (err) {
      return { canExec: false, message: `Rpc call failed ${err}` };
    }
  }

  // Start processing current Relay
  if(JSON.parse(isAutoCompounder)) {
    txData = await processAutoCompounder(currRelay, currFactory, stageName, storage, provider);
  } else {
     // Process AutoConverter

  }

  // Fetch current stage after call is processed
  const currStage = await storage.get("currStage") ?? "";
  if (currStage)
    stageName = currStage;
  // Set next Relay when last Relay's processing is complete
  if(stageName == "complete") { // If current stage is Compound, Relay has finished processing
    if(relaysQueue.length != 0) {
      // Process next Relay
      currRelay = relaysQueue[0];
      relaysQueue = relaysQueue.slice(1);
      await storage.set("currStage", "claim");
      await storage.set("currRelay", currRelay);
      await storage.set("relaysQueue", JSON.stringify(relaysQueue));
    } else if(factoriesQueue.length != 0) {
      // Process next Factory
      currFactory = factoriesQueue[0];
      factoriesQueue = factoriesQueue.slice(1);
      await storage.set("currStage", "claim");
      await storage.set("currFactory", currFactory);
      await storage.set("factoriesQueue", JSON.stringify(factoriesQueue));
    } else {
      // All Relays have been processed
      await Promise.all([
        storage.delete("currStage"),
        storage.delete("currRelay"),
        storage.delete("relaysQueue"),
        storage.delete("currFactory"),
        storage.delete("factoriesQueue"),
        storage.delete("isAutoCompounder"),
      ]);
      const timestamp = (await provider.getBlock("latest")).timestamp;
      await storage.set("lastRunTimestamp", timestamp.toString());
    }
  }

  // Return execution call data
  return {
    canExec: true,
    callData: txData,
  };
});
