// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";

import { TxData } from "./utils/constants";
import { processAutoCompounder } from "./utils/autocompounder";
import { canRunInCurrentEpoch, fetchStorageState, setUpInitialStorage, updateStorage } from "./utils/relay";

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { storage, multiChainProvider } = context;
  const provider = multiChainProvider.default();

  // Variables to track Automation State
  let currRelay: string;
  let currFactory: string;
  let relaysQueue: string[];
  let factoriesQueue: string[];
  let isAutoCompounder: string;

  // Stages of Execution can either be 'claim', 'swap', 'compound' and 'complete', in this order
  let stageName: string = (await storage.get("currStage")) ?? "";

  if(!(await canRunInCurrentEpoch(provider, storage)))
    return { canExec: false, message: `Too Soon for Execution` };

  // Setup Initial State for Automation if no Stage is taking place
  if(!stageName) {
    try {
      stageName = "claim"; // Claiming of Rewards is the first stage of Execution
      [currRelay, relaysQueue, currFactory, factoriesQueue, isAutoCompounder] = await setUpInitialStorage(storage, provider);
    } catch (err) {
      return { canExec: false, message: `Rpc call failed ${err}` };
    }
  } else
    // Fetch current state of Execution if there is a Stage being processed
    [currRelay, currFactory, relaysQueue, factoriesQueue, isAutoCompounder] = await fetchStorageState(storage);

  let txData: TxData[] = [];
  // Start processing current Relay
  if(JSON.parse(isAutoCompounder)) {
    txData = await processAutoCompounder(currRelay, currFactory, stageName, storage, provider);
  } else {
     // Process AutoConverter

  }

  // Fetch current stage after call is processed
  const currStage: string = await storage.get("currStage") ?? "";
  if (currStage)
    stageName = currStage;
  await updateStorage(stageName, currRelay, relaysQueue, currFactory, factoriesQueue, provider, storage);

  // Return execution call data
  return {
    canExec: true,
    callData: txData,
  };
});
