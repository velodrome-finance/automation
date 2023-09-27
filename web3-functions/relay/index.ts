import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import {
  getCompounderRelayInfos,
  getCompounderTxData,
} from "./utils/autocompounder";
import {
  getConverterRelayInfos,
  getConverterTxData,
} from "./utils/autoconverter";
import { RelayInfo, TxData } from "./utils/constants";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";

import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import { WEEK, DAY } from "./utils/constants";

// Retrieve all Relay Factories from the Registry
async function getFactoriesFromRegistry(
  registryAddr: string,
  provider: Provider
): Promise<Contract[]> {
  let relayFactoryRegistry = new Contract(
    registryAddr,
    "function getAll() view returns (address[] memory)",
    provider
  );

  return (await relayFactoryRegistry.getAll()).map(
    (f: string) =>
      new Contract(
        f,
        "function relays() view returns (address[] memory)",
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
        "function token() view returns (address)",
        provider
      ).token();

      if (token == jsonConstants.v2.VELO) {
        // Fetch all High Liquidity Tokens for AutoCompounder
        factory = new Contract(
          factory.address,
          "function highLiquidityTokens() external view returns (address[] memory)",
          provider
        );
        let tokensToSwap: string[] = await factory.highLiquidityTokens();
        compounderInfos = compounderInfos.concat(
          await getCompounderRelayInfos(relayAddresses, tokensToSwap, provider)
        );
      } else {
        //TODO: Fetch tokens to swap
        // factory = new Contract(factory.address, converterFactoryAbi, provider);
        converterInfos = converterInfos.concat(
          await getConverterRelayInfos(relayAddresses, [], provider)
        );
      }
    }
  }
  return [compounderInfos, converterInfos];
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;
  const provider = multiChainProvider.default();

  let compounderInfos: RelayInfo[] = [];
  let converterInfos: RelayInfo[] = [];

  try {
    const timestamp = (await provider.getBlock("latest")).timestamp;
    console.log(`Timestamp is ${timestamp}`);
    let firstDayEnd = timestamp - (timestamp % WEEK) + DAY;

    //TODO: Also check if function has been run in less then a day

    // Can only run on First Day of Epoch
    if (firstDayEnd < timestamp)
      return { canExec: false, message: `Not first day` };

    // Get Registry
    const registryAddr: string =
      (userArgs.registry as string) ??
      "0x925189766f98B766E64A67E9e70d435CD7F6F819";
    console.log(`Registry is in address ${registryAddr}`);

    // Retrieve all Relay Factories
    [compounderInfos, converterInfos] = await getRelayInfos(
      registryAddr,
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
  let converterTxData: TxData[] = await getConverterTxData(
    converterInfos,
    provider
  );

  // Return execution call data
  return {
    canExec: true,
    callData: compounderTxData.concat(converterTxData),
  };
});
