// SPDX-License-Identifier: BUSL-1.1
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";

import jsonConstants from "../../../lib/relay-private/script/constants/Optimism.json";
import {
  RELAY_REGISTRY_ADDRESS,
  PROCESSING_COMPLETE,
  CLAIM_STAGE,
  HOUR,
  DAY,
} from "./constants";

// Verifies if script can run in Current Epoch
export async function canRunInCurrentEpoch(
  provider,
  storage
): Promise<boolean> {
  const timestamp = (await provider.getBlock("latest")).timestamp;
  const startOfCurrentEpoch: number = timestamp - (timestamp % (7 * DAY));
  const keeperLastRun: number = Number(
    (await storage.get("keeperLastRun")) ?? ""
  );
  const startOfLastRunEpoch: number =
    keeperLastRun - (keeperLastRun % (7 * DAY));

  // Can only run Once per Epoch and only after its First Hour
  return (
    !keeperLastRun ||
    (startOfCurrentEpoch != startOfLastRunEpoch &&
      timestamp > startOfCurrentEpoch + HOUR)
  );
}

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

  return await relayFactoryRegistry.getAll();
}

// Sets up the initial Storage to process a Relay
export async function setUpInitialStorage(storage, provider: Provider) {
  // Get All Factories from Registry
  let factoriesQueue = await getFactoriesFromRegistry(
    RELAY_REGISTRY_ADDRESS,
    provider
  );
  const currFactory = factoriesQueue[0] ?? "";
  factoriesQueue = factoriesQueue.slice(1);
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

  return [
    currRelay,
    relaysQueue,
    currFactory,
    factoriesQueue,
    isAutoCompounder,
  ];
}

// Retrieves the current state of execution from Storage
export async function fetchStorageState(
  storage
): Promise<[string, string, string[], string[], string]> {
  const currRelay: string = (await storage.get("currRelay")) ?? "";
  const currFactory: string = (await storage.get("currFactory")) ?? "";

  let queue: string = (await storage.get("relaysQueue")) ?? ""; // fetch relays to process
  const relaysQueue: string[] = queue.length != 0 ? JSON.parse(queue) : [];

  queue = (await storage.get("factoriesQueue")) ?? ""; // fetch factories to process
  const factoriesQueue: string[] = queue.length != 0 ? JSON.parse(queue) : [];

  const isAutoCompounder: string =
    (await storage.get("isAutoCompounder")) ?? "";

  return [
    currRelay,
    currFactory,
    relaysQueue,
    factoriesQueue,
    isAutoCompounder,
  ];
}

// Updates storage for next run at the end of Automation
export async function updateStorage(
  stageName: string,
  currRelay: string,
  relaysQueue: string[],
  currFactory: string,
  factoriesQueue: string[],
  provider,
  storage
) {
  // Set next Relay when last Relay's processing is complete
  if (stageName == PROCESSING_COMPLETE) {
    // Relay has finished processing
    if (relaysQueue.length != 0) {
      // Process next Relay
      currRelay = relaysQueue[0];
      relaysQueue = relaysQueue.slice(1);
      await storage.set("currStage", CLAIM_STAGE);
      await storage.set("currRelay", currRelay);
      await storage.set("relaysQueue", JSON.stringify(relaysQueue));
    } else if (factoriesQueue.length != 0) {
      // Process next Factory
      currFactory = factoriesQueue[0];
      factoriesQueue = factoriesQueue.slice(1);
      await storage.set("currStage", CLAIM_STAGE);
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
      await storage.set("keeperLastRun", timestamp.toString());
    }
  }
}
