import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import {
  abi as compAbi
} from "../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import {
  abi as compFactoryAbi
} from "../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import {
  abi as factoryAbi
} from "../../artifacts/src/RelayFactory.sol/RelayFactory.json";
import {
  abi as registryAbi
} from "../../artifacts/src/Registry.sol/Registry.json";
import { Contract } from "@ethersproject/contracts";

// Relay Token Information
interface RelayToken {
    // Address of the Token
    address: string;
    // Amount of tokens the Relay has in custody
    amount: number;
}

// Relay Information
interface RelayInfo {
    // Relay Contract
    contract: Contract;
    // All High Liquidity Tokens of the Relay
    tokens: RelayToken[];
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.default();

  const TOKEN_ABI = [
    "function balanceOf(address) external view returns(uint256)"
  ];

  // Retrieve all Relay Factories
  let relayFactories: Contract[];
  let relayFactoryRegistry: Contract;
  try {
    const registryAddr: string = (userArgs.registry as string) ?? "0x925189766f98B766E64A67E9e70d435CD7F6F819";
    relayFactoryRegistry = new Contract(registryAddr, registryAbi, provider);
    console.log(`RelayFactoryRegistry is in address ${relayFactoryRegistry.address}`);

    relayFactories = (await relayFactoryRegistry.getAll()).map((f: string) => new Contract(f, factoryAbi, provider));
    console.log(`All relayFactories ${relayFactories.map((e) => e.address)}`);
  } catch (err) {
    return { canExec: false, message: `Rpc call failed ${err}` };
  }

  // Retrieve all High Liquidity Tokens and their balances
  let relays: Contract[];
  let highLiqTokens: string[];
  let relayInfos: RelayInfo[] = [];
  // TODO: only using autoCompounderFactory for now
  let autoCompounderFactory: Contract = new Contract(relayFactories[0].address, compFactoryAbi, provider);
  try {
    // Fetch all High Liquidity tokens
    highLiqTokens = await autoCompounderFactory.highLiquidityTokens();
    // Fetch all relays from factory
    relays = (await autoCompounderFactory.relays()).map((r: string) => new Contract(r, compAbi, provider));

    relays.forEach(async (relay) => {
      let tokenBalances = await Promise.all(highLiqTokens.map((addr: string) => new Contract(addr, TOKEN_ABI, provider).balanceOf(relay.address)));
      let relayTokens: RelayToken[] = [];
      highLiqTokens.forEach((addr, i) => relayTokens.push({address: addr, amount: tokenBalances[i]} as RelayToken));
      relayTokens.filter((token) => token.amount != 0);

      relayInfos.push({contract: relay, tokens: relayTokens} as RelayInfo)
    });

    console.log(`AutoCompounderFactory is in address ${autoCompounderFactory.address}`);
    console.log(`All relays ${relays}`);
    console.log(`All High Liq Tokens ${highLiqTokens}`);
    relayInfos.forEach((relayInfo) => {
      let contract = relayInfo.contract;
      console.log("==================================");
      console.log(`Relay Address: ${contract.address}`);
      relayInfo.tokens.forEach((relayToken) => {
        console.log(`Address: ${relayToken.address}, Amount: ${relayToken.amount}`);
      });
    });

  } catch (err) {
    return { canExec: false, message: `Rpc call failed ${err}` };
  }


  // Return execution call data
  return {
    canExec: true,
    callData: [],
  };
});
