// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";

import { processAutoCompounder } from "./utils/autocompounder";
import { setUpInitialStorage } from "./utils/relay";
import { TxData } from "./utils/constants";

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
