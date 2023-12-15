import { ActionFn, Context, Event, PeriodicEvent } from "@tenderly/actions";
import { JsonRpcProvider, Wallet } from "ethers";

import { RELAY_REGISTRY_ADDRESS, AERO } from "./base-utils/base-constants";
import { processRelay } from "./base-utils/relay";
import { Relay } from "./common-utils/constants";

import {
  getFactoriesFromRegistry,
  getRelaysFromFactories,
  canRunInCurrentEpoch,
} from "./common-utils/relay";

export const baseKeeperFn: ActionFn = async (
  context: Context,
  event: Event
) => {
  const provider = new JsonRpcProvider(process.env.TENDERLY_BASE_FORK);
  const periodicEvent = event as PeriodicEvent;
  // TODO: Specific for testing ^^^

  // NOTE: EXECUTION STARTS BELOW

  // TODO: Uncomment this for deployment
  // const baseGatewayURL = context.gateways.getGateway(Network.BASE);
  // const provider = new JsonRpcProvider(baseGatewayURL);

  const privateKey = await context.secrets.get("PRIVATE_KEY");
  const wallet = new Wallet(privateKey, provider);

  // Check if can run in current timestamp
  const timestamp = BigInt(Math.round(periodicEvent.time.getTime() / 1000));
  const canRun = await canRunInCurrentEpoch(timestamp, context.storage);
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
      let relayQueue: Relay[] = await getRelaysFromFactories(
        factories,
        AERO,
        wallet
      );

      await context.storage.putJson("relays", relayQueue);
    } else {
      // Get next relay to process, store updated queue
      const relay: Relay = relays[0] ?? "";
      relays = relays.slice(1);

      // Update storage
      if (Object.keys(relays).length === 0) {
        // If processing last relay, processing is complete
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
