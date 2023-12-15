import { ActionFn, Context, Event } from "@tenderly/actions";
import { JsonRpcProvider, Wallet } from "ethers";

import { RELAY_REGISTRY_ADDRESS, Relay } from "./op-utils/op-constants";

import {
  processRelay,
  getFactoriesFromRegistry,
  getRelaysFromFactories,
  canRunInCurrentEpoch,
} from "./op-utils/relay";

export const optimisticKeeperFn: ActionFn = async (
  context: Context,
  _: Event
) => {
  const provider = new JsonRpcProvider(process.env.TENDERLY_OP_FORK);
  // TODO: Specific for testing ^^^

  // NOTE: EXECUTION STARTS BELOW

  // TODO: Uncomment this for deployment
  // const optimisticGatewayURL = context.gateways.getGateway(Network.OPTIMISTIC);
  // const provider = new JsonRpcProvider(optimisticGatewayURL);

  const privateKey = await context.secrets.get("PRIVATE_KEY");
  const wallet = new Wallet(privateKey, provider);

  // Check if can run in current timestamp
  const canRun = await canRunInCurrentEpoch(provider, context.storage);
  if (canRun) {
    let relays: Relay[] = await context.storage.getJson("relays");
    // If there are no relays to process, fetch and store them for next Execution
    if (Object.keys(relays).length === 0) {
      // Get All Factories from Registry
      const factories: string[] = await getFactoriesFromRegistry(
        RELAY_REGISTRY_ADDRESS,
        wallet
      );
      // Get All Relay Information from Factories
      let relayQueue: Relay[] = await getRelaysFromFactories(factories, wallet);

      await context.storage.putJson("relays", relayQueue);
    } else {
      // Get next relay to process, store updated queue
      const relay: Relay = relays[0] ?? "";
      relays = relays.slice(1);

      // Update storage
      if (Object.keys(relays).length === 0) {
        // If processing last relay, processing is complete
        const timestamp = BigInt(
          (await provider.getBlock("latest"))?.timestamp ?? 0n
        );
        await context.storage.putBigInt("keeperLastRun", timestamp);
        await context.storage.putJson("relays", {});
      } else {
        // If there are more relays to process, store them
        await context.storage.putJson("relays", relays);
      }

      // Process fetched Relay
      try {
        await processRelay(
          relay.address,
          relay.factory,
          relay.targetToken,
          relay.isAutoCompounder,
          wallet
        );
      } catch (err) {
        console.error(err);
      }
    }
  }
};
