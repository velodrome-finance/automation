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
import { RelayToken, RELAY_REGISTRY_ADDRESS } from "./utils/constants";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";

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

Web3Function.onRun(async (context: Web3FunctionContext) => {
  //TODO: move this
  const POOLS_TO_FETCH = 300;
  const REWARDS_TO_FETCH = 70;

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
      // Process AutoCompounder
      const factory = new Contract(
        currFactory,
        ["function highLiquidityTokens() view returns (address[] memory)"],
        provider
      );
      // TODO: Should I also keep tokens to swap in storage?
      const tokensToSwap: string[] = await factory.highLiquidityTokens();
      // Get All Tokens that should be Swapped
      const tokensToCompound: RelayToken[] = await getTokensToCompound(currRelay, tokensToSwap, provider);
      const relay = new Contract(currRelay, compAbi, provider);
      const abi = relay.interface;

      // Fetch Relay Rewards
      // TODO: Fix Claim Calls
      // let calls: string[] = await getClaimCalls(relay, REWARDS_TO_FETCH);

  } else {
      // Process AutoConverter

  }


  // Return execution call data
  return {
    canExec: true,
    callData: [],
  };
});
