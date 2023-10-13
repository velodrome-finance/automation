// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";

import {
  getTokensToCompound,
} from "./utils/autocompounder";
import { abi as compAbi } from "../../artifacts/lib/relay-private/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import { LP_SUGAR_ABI, LP_SUGAR_ADDRESS, RelayToken, RELAY_REGISTRY_ADDRESS, TxData, VELO } from "./utils/constants";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";
import { buildGraph, fetchQuote, getRoutes } from "./utils/quote";
import { getPools } from "./utils/rewards";

//TODO: move this
const POOLS_TO_FETCH = 150; // NOTE: Can currently fetch 600 but can't handle as much
const REWARDS_TO_FETCH = 70;

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

// From a Relay Address and a list of Tokens, encode a swap per call
async function processTokens(relayAddr: string, tokensQueue: string[], storage, provider: Provider): Promise<string> {
  const [poolsGraph, poolsByAddress] = buildGraph(
    await getPools(provider, POOLS_TO_FETCH)
  ); // TODO: Find right value, was using 600, 0

  const relay = new Contract(relayAddr, compAbi, provider);
  const abi = relay.interface;
  let call = "";
  // Process One Swap per Execution
  for(let i = 0; i < tokensQueue.length; i++) {

    // Fetch Relay balance
    const bal: BigNumber = await new Contract(
      tokensQueue[i],
      ["function balanceOf(address) view returns (uint256)"],
      provider
    ).balanceOf(relayAddr);

    if(!bal.isZero()) { // Skip tokens with zero balance
      const quote = await fetchQuote(
        getRoutes(
          poolsGraph,
          poolsByAddress,
          tokensQueue[i].toLowerCase(),
          VELO.toLowerCase()
        ),
        bal,
        provider
      );

      if (quote) { // If best quote was found
        // Encode swap call
        call = abi.encodeFunctionData("swapTokenToVELOKeeper", [
          quote,
          bal,
          1,
        ]);

        tokensQueue = tokensQueue.slice(i + 1); // update queue
        if(tokensQueue.length != 0) { // if there are still tokens in queue, continue
          await storage.set("stageQueue", JSON.stringify(tokensQueue));
          return call;
        }
      }
    }
  }
  //TODO: If no swap is to be returned maybe return compound call
  await storage.set("currStage", "compound"); // Next stage is compound encoding
  await storage.delete("stageQueue");
  return call;
}

// Encodes all Swaps for AutoCompounder
async function encodeAutoCompounderSwap(
    relayAddr: string,
    factoryAddr: string,
    stageName: string,
    storage,
    provider: Provider
): Promise<string> {
    const factory = new Contract(
      factoryAddr,
      ["function highLiquidityTokens() view returns (address[] memory)"],
      provider
    );

    let queue: string = (await storage.get("stageQueue")) ?? "";
    let tokensQueue: string[] = queue.length != 0 ? JSON.parse(queue) : [];

    // Set current Stage and Initial Tokens Queue
    if(stageName == "swap" && tokensQueue.length == 0) { // processing of swaps hasn't started
      tokensQueue = await factory.highLiquidityTokens();
      await storage.set("currStage", stageName);
    } else if (stageName != "swap") {
        return "";
    }

    // Process next Swap from Tokens Queue
    return await processTokens(relayAddr, tokensQueue, storage, provider);
}

// Encode AutoCompounder calls, one per Execution
async function processAutoCompounder(
    relayAddr: string,
    factoryAddr: string,
    stageName: string,
    storage,
    provider: Provider
): Promise<TxData[]> {
    let txData: TxData[] = [];
    // Process AutoCompounder
    const relay = new Contract(relayAddr, compAbi, provider);
    const abi = relay.interface;

    let call: string = "";
    // Process Relay Rewards
    // TODO: Fix Claim Calls
    // if(stageName == "claim")
    //   call = await getClaimCalls(relay, REWARDS_TO_FETCH);
    if(!call) // If no Claim calls left, next stage is Swap
      stageName = "swap";


    // Process a Swap per Call
    if(stageName == "swap") // If no Swaps left, next call should be Compound
      call = await encodeAutoCompounderSwap(relayAddr, factoryAddr, stageName, storage, provider);
    if(!call) {
      call = abi.encodeFunctionData("compound");
      await storage.set("currStage", "complete"); // After compounding Relay is processed
    }

    // Compound all Tokens
    txData.push({
      to: relay.address,
      data: call,
    } as TxData);
    return txData;
}

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

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { storage, multiChainProvider } = context;
  const provider = multiChainProvider.default();

  // Fetch state of Execution
  // Stages of Execution can either be 'claim', 'swap', 'compound' and 'complete', in this order
  let stageName: string = (await storage.get("currStage")) ?? "";
  let currRelay: string = (await storage.get("currRelay")) ?? "";
  let currFactory: string = (await storage.get("currFactory")) ?? "";

  let queue: string = (await storage.get("relaysQueue")) ?? "";
  let relaysQueue: string[] = queue.length != 0 ? JSON.parse(queue) : [];

  queue = (await storage.get("factoriesQueue")) ?? "";
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
