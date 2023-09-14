import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import {
  abi as registryAbi
} from "../../artifacts/src/Registry.sol/Registry.json";
import { Contract } from "@ethersproject/contracts";

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.default();

  let relays;
  let relayFactoryRegistry;
  // Retrieve all relays
  try {
    const registryAddr = (userArgs.registry as string) ?? "0x925189766f98B766E64A67E9e70d435CD7F6F819";
    relayFactoryRegistry = new Contract(registryAddr, registryAbi, provider);
    console.log(`RelayFactoryRegistry is in address ${relayFactoryRegistry.address}`);
    relays = await relayFactoryRegistry.getAll();
    console.log(`All relays ${relays}`);
  } catch (err) {
    return { canExec: false, message: `Rpc call failed ${err}` };
  }


  return {
    canExec: true,
    callData: [],
  };
});
