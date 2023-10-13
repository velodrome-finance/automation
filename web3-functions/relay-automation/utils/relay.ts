// SPDX-License-Identifier: BUSL-1.1
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";

import { RELAY_REGISTRY_ADDRESS } from "./constants";
import jsonConstants from "../../../lib/relay-private/script/constants/Optimism.json";

// Sets up the initial Storage for a Relay
export async function setUpInitialStorage(
  storage,
  provider: Provider
) {
  // Get All Factories from Registry
  let factoriesQueue = await getFactoriesFromRegistry(RELAY_REGISTRY_ADDRESS, provider);
  const currFactory = factoriesQueue[0] ?? "";
  factoriesQueue = factoriesQueue.slice(1);
  // TODO: handle multiple factories, as right now this only handles autocompounder
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

// Retrieve all Relay Factories from the Registry
export async function getFactoriesFromRegistry(
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
