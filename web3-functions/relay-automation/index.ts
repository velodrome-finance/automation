// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

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

// Encodes all Swaps for AutoCompounder
async function encodeAutoCompounderSwaps(
    relayAddr: string,
    factoryAddr: string,
    provider: Provider
): Promise<string[]> {
    const relay = new Contract(relayAddr, compAbi, provider);
    const abi = relay.interface;
    const factory = new Contract(
      factoryAddr,
      ["function highLiquidityTokens() view returns (address[] memory)"],
      provider
    );
    let calls: string[] = [];
    // Process all Swaps
    const [poolsGraph, poolsByAddress] = buildGraph(
      await getPools(provider, POOLS_TO_FETCH)
    ); // TODO: Find right value, was using 600, 0

    // TODO: Should I also keep tokens to swap in storage?
    // Get All Tokens that should be Swapped
    const tokensToSwap: string[] = await factory.highLiquidityTokens();
    const tokensToCompound: RelayToken[] = await getTokensToCompound(relayAddr, tokensToSwap, provider);
    // Swap all Relay Tokens to VELO
    for(const token of tokensToCompound) {
     // TODO: This call is too heavy and results in Memory Exceeded
     // I believe it is caused by the getAmountsOut in loop inside the function
     const quote = await fetchQuote(
       getRoutes(
         poolsGraph,
         poolsByAddress,
         token.address.toLowerCase(),
         VELO.toLowerCase()
       ),
       token.balance,
       provider
     );
     if (quote)
       calls.push(
         abi.encodeFunctionData("swapTokenToVELOKeeper", [
           quote,
           token.balance,
           1,
         ])
       );
    }
    return calls;
}

async function processAutoCompounder(
    relayAddr: string,
    factoryAddr: string,
    provider: Provider
): Promise<TxData[]> {
    let txData: TxData[] = [];
    // Process AutoCompounder
    const relay = new Contract(relayAddr, compAbi, provider);
    const abi = relay.interface;

    // Process Relay Rewards
    // TODO: Fix Claim Calls
    // let calls: string[] = await getClaimCalls(relay, REWARDS_TO_FETCH);

    let calls: string[] = [];
    // Process all Swaps
    calls = await encodeAutoCompounderSwaps(relayAddr, factoryAddr, provider);

    // Compound all Tokens
    //TODO: separate in multiple calls
    calls.push(abi.encodeFunctionData("compound"));
    txData.push({
      to: relay.address,
      data: abi.encodeFunctionData("multicall", [calls]),
    } as TxData);
    return txData;
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { storage, multiChainProvider } = context;
  const provider = multiChainProvider.default();

  // Fetch state of Execution
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
  if(currRelay == "" && relaysQueue.length == 0) {
    try {
      // Get All Factories from Registry
      factoriesQueue = await getFactoriesFromRegistry(RELAY_REGISTRY_ADDRESS, provider);

      currFactory = factoriesQueue[0] ?? "";
      factoriesQueue = factoriesQueue.slice(1);
      // TODO: handle multiple factories, as right this only handles autocompounder
      let factory = new Contract(
        currFactory,
        ["function relays() view returns (address[] memory)"],
        provider
      );
      // Get all Relays from Factory
      relaysQueue = await factory.relays();
      currRelay = relaysQueue[0] ?? "";
      relaysQueue = relaysQueue.slice(1);

      // Verify if Relays are AutoCompounders
      let token = await new Contract(
        currRelay,
        ["function token() view returns (address)"],
        provider
      ).token();
      isAutoCompounder = JSON.stringify(token == jsonConstants.v2.VELO);

      // Set Relays to be Processed
      await storage.set("currRelay", currRelay);
      await storage.set("relaysQueue", JSON.stringify(relaysQueue));
      // Set Factories to be Processed
      await storage.set("currFactory", currFactory);
      await storage.set("factoriesQueue", JSON.stringify(factoriesQueue));
      await storage.set("isAutoCompounder", isAutoCompounder);
    } catch (err) {
      return { canExec: false, message: `Rpc call failed ${err}` };
    }
  }

  // Start processing current Relay
   if(JSON.parse(isAutoCompounder)) {
       txData = await processAutoCompounder(currRelay, currFactory, provider);
  } else {
     // Process AutoConverter

  }
  // Set next Relay when last Relay's processing is complete
  if(relaysQueue.length != 0) {
    // Process next Relay
    currRelay = relaysQueue[0];
    relaysQueue = relaysQueue.slice(1);
    await storage.set("currRelay", currRelay);
    await storage.set("relaysQueue", JSON.stringify(relaysQueue));

  } else if(factoriesQueue.length != 0) {
    // Process next Factory
    currFactory = factoriesQueue[0];
    factoriesQueue = factoriesQueue.slice(1);
    await storage.set("currFactory", currFactory);
    await storage.set("factoriesQueue", JSON.stringify(factoriesQueue));
  } else {
    // All Relays have been processed
    await storage.set("currRelay", "");
    await storage.set("relaysQueue", JSON.stringify(relaysQueue));
    await storage.set("currFactory", "");
    await storage.set("factoriesQueue", JSON.stringify(factoriesQueue));
  }

  // Return execution call data
  return {
    canExec: true,
    callData: txData,
  };
});
