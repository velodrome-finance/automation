import { ActionFn, Context, Event } from "@tenderly/actions";
import { JsonRpcProvider, Wallet } from "ethers";

import { RELAY_REGISTRY_ADDRESS, Relay } from "./utils/op-constants";

import {
  processRelay,
  getFactoriesFromRegistry,
  getRelaysFromFactories,
  canRunInCurrentEpoch,
} from "./utils/relay";

export const optimisticKeeperFn: ActionFn = async (
  context: Context,
  _: Event
) => {

  //TODO: Specific for testing VVV
  const provider = new JsonRpcProvider(
    "https://rpc.tenderly.co/fork/c9424fdc-aa62-412a-9ae6-dd244c953b72"
  );

  // const checkpoint = await provider.send("evm_snapshot", []);

  // const CHECKPOINT = "61ad5e2f-8507-4219-a5ef-25114fd87f27";
  // console.log("Reverting to the initial fork state.");
  // await provider.send("evm_revert", [CHECKPOINT]);
  // console.log(
  //   "========================================================================"
  // );
  // TODO: Specific for testing ^^^

  // NOTE: EXECUTION STARTS BELOW

  // TODO: Uncomment this for deployment
  // const optimisticGatewayURL = context.gateways.getGateway(Network.OPTIMISTIC);
  // const provider = new JsonRpcProvider(optimisticGatewayURL);

  const privateKey = await context.secrets.get('PRIVATE_KEY');
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
      relayQueue = [relayQueue[1], relayQueue[relayQueue.length - 1]]; // TODO: ONLY PROCESSING THESE TWO RELAYS FOR NOW

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
