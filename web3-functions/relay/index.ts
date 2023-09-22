import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
//TODO: move constants to constants.ts
import {
  getCompounderRelayInfos,
  getCompounderTxData,
  RelayInfo,
  TxData,
} from "./hooks/autocompounder";
import {
  getConverterRelayInfos,
  getConverterTxData,
  RelayInfo,
  TxData,
} from "./hooks/autoconverter";
import { abi as compounderFactoryAbi } from "../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import { abi as converterFactoryAbi } from "../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import { abi as factoryAbi } from "../../artifacts/src/RelayFactory.sol/RelayFactory.json";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";
import { abi as registryAbi } from "../../artifacts/src/Registry.sol/Registry.json";
import { abi as relayAbi } from "../../artifacts/src/Relay.sol/Relay.json";
import { abi as erc20Abi } from "./abis/erc20.json";

import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import { useContractRead } from "wagmi";
import { useQuote } from "./hooks/quote";
import { WEEK, DAY, LP_SUGAR_ADDRESS, LP_SUGAR_ABI } from "../constants";

// Retrieve all Relay Factories from the Registry
async function getFactoriesFromRegistry(
  registryAddr: string,
  provider: Provider
): Promise<Contract[]> {
  let relayFactoryRegistry = new Contract(registryAddr, registryAbi, provider);

  return (await relayFactoryRegistry.getAll()).map(
    (f: string) => new Contract(f, factoryAbi, provider)
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
        relayAbi,
        provider
      ).token();

      if (token == jsonConstants.v2.VELO) {
        // Fetch all High Liquidity Tokens for AutoCompounder
        factory = new Contract(factory.address, compounderFactoryAbi, provider);
        let tokensToSwap: string[] = await factory.highLiquidityTokens();
        compounderInfos = compounderInfos.concat(
          await getCompounderRelayInfos(relayAddresses, tokensToSwap, provider)
        );
      } else {
        //TODO: Fetch tokens to swap
        factory = new Contract(factory.address, converterFactoryAbi, provider);
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

  //TODO: move to constants
  const DAY = 24 * 60 * 60;
  const WEEK = 7 * DAY;

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
  let compounderTxData: TxData[] = await getCompounderTxData(compounderInfos, provider);
  let converterTxData: TxData[] = await getConverterTxData(converterInfos, provider);

  // Return execution call data
  return {
    canExec: true,
    callData: compounderTxData.concat(converterTxData),
  };
});
