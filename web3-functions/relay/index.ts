import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
//TODO: move constants to constants.ts
import { getCompounderRelayInfos, getCompounderTxData, RelayInfo, TxData } from "./hooks/autocompounder";
import { abi as factoryAbi } from "../../artifacts/src/RelayFactory.sol/RelayFactory.json";
import { abi as registryAbi } from "../../artifacts/src/Registry.sol/Registry.json";
import { abi as erc20Abi } from "./abis/erc20.json";

import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";


import { useContractRead } from "wagmi";
// import { useQuote } from "../hooks/quote";
// import {WEEK, DAY, LP_SUGAR_ADDRESS, LP_SUGAR_ABI} from "../constants";

// Retrieve all Relay Factories from the Registry
async function getFactoriesFromRegistry(
  registryAddr: string,
  provider: Provider
): Promise<Contract[]> {
  let contract = new Contract(
    "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    erc20Abi,
    provider
  );
  let balance = await contract.balanceOf(
    "0xdc166445c575C7d8196274c3C62300BED0da9423"
  );
  console.log(`Balance = ${balance}`);
  let relayFactoryRegistry = new Contract(registryAddr, registryAbi, provider);
  console.log(
    `RelayFactoryRegistry is in address ${relayFactoryRegistry.address}`
  );

  return (await relayFactoryRegistry.getAll()).map(
    (f: string) => new Contract(f, factoryAbi, provider)
  );
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;
  const provider = multiChainProvider.default();

  let relayFactories: Contract[];
  let relayInfos: RelayInfo[] = [];

  //TODO: move to constants
  const DAY = 24 * 60 * 60;
  const WEEK = 7 * DAY;

  try {
    const timestamp = (await provider.getBlock("latest")).timestamp;
    let firstDayEnd = timestamp - (timestamp % WEEK) + DAY;

    //TODO: Also check if function has been run in less then a day

    // First Day Validation
    if (firstDayEnd < timestamp)
      return { canExec: false, message: `Not first day` };

    // Get Registry
    const registryAddr: string =
      (userArgs.registry as string) ??
      "0x925189766f98B766E64A67E9e70d435CD7F6F819";

    // Retrieve all Relay Factories
    relayFactories = await getFactoriesFromRegistry(registryAddr, provider);
    console.log(`All relayFactories ${relayFactories.map((e) => e.address)}`);

    // TODO: Only handling CompounderFactory
    // Fetch Tokens to Compound per AutoCompounder
    relayInfos = await getCompounderRelayInfos(
      relayFactories[0].address,
      provider
    );
  } catch (err) {
    return { canExec: false, message: `Rpc call failed ${err}` };
  }

  // TODO: Logging for debugging purposes
  console.log(`All relays ${relayInfos.map((info) => info.contract.address)}`);

  // Encode all needed calls based on tokens to compound
  let txData: TxData[] = getCompounderTxData(relayInfos);

  // Return execution call data
  return {
    canExec: true,
    callData: txData,
  };
});
