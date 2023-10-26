// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import {
  getCompounderTxData,
  getCompounderRelayInfos,
} from "./utils/autocompounder";
import {
  getConverterTxData,
  getConverterRelayInfos,
} from "./utils/autoconverter";
import { TxData, RelayInfo, RELAY_REGISTRY_ADDRESS } from "./utils/constants";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";

// Retrieve all Relay Factories from the Registry
async function getFactoriesFromRegistry(
  registryAddr: string,
  provider: Provider
): Promise<Contract[]> {
  let relayFactoryRegistry = new Contract(
    registryAddr,
    ["function getAll() view returns (address[] memory)"],
    provider
  );

  return (await relayFactoryRegistry.getAll()).map(
    (f: string) =>
      new Contract(
        f,
        ["function relays() view returns (address[] memory)"],
        provider
      )
  );
}

// Fetch Relay Infos for all Relays in all Factories
async function getRelayInfos(
  registryAddr: string,
  provider: Provider
): Promise<RelayInfo[][]> {
  let relayFactories = await getFactoriesFromRegistry(registryAddr, provider);
  let compounderInfos: RelayInfo[] = [];
  let converterInfos: RelayInfo[] = [];

  for (let factory of relayFactories) {
    let relayAddresses = await factory.relays();

    if (relayAddresses.length != 0) {
      let token = await new Contract(
        relayAddresses[0],
        ["function token() view returns (address)"],
        provider
      ).token();

      if (token == jsonConstants.v2.VELO) {
        // Fetch all High Liquidity Tokens for AutoCompounder
        factory = new Contract(
          factory.address,
          ["function highLiquidityTokens() view returns (address[] memory)"],
          provider
        );
        let tokensToSwap: string[] = await factory.highLiquidityTokens();
        compounderInfos = compounderInfos.concat(
          await getCompounderRelayInfos(relayAddresses, tokensToSwap, provider)
        );
      } else {
        converterInfos = converterInfos.concat(
          await getConverterRelayInfos(relayAddresses, [], provider)
        );
      }
    }
  }
  return [compounderInfos, converterInfos];
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { multiChainProvider } = context;
  const provider = multiChainProvider.default();

  let compounderInfos: RelayInfo[] = [];
  let converterInfos: RelayInfo[] = [];

  try {
    const timestamp = (await provider.getBlock("latest")).timestamp;
    console.log(`Timestamp is ${timestamp}`);

    // Retrieve all Relay Factories
    [compounderInfos, converterInfos] = await getRelayInfos(
      RELAY_REGISTRY_ADDRESS,
      provider
    );

  } catch (err) {
    return { canExec: false, message: `Rpc call failed ${err}` };
  }

  // Encode all needed calls based on tokens to compound
  let compounderTxData: TxData[] = await getCompounderTxData(
    compounderInfos,
    provider
  );

  // Return execution call data
  return {
    canExec: true,
    callData: compounderTxData,
  };
});
