import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { abi as compFactoryAbi } from "../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import { abi as compAbi } from "../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import { abi as factoryAbi } from "../../artifacts/src/RelayFactory.sol/RelayFactory.json";
import { abi as registryAbi } from "../../artifacts/src/Registry.sol/Registry.json";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { AbiCoder } from "@ethersproject/abi";

// Tokens to be Converted per Relay
interface RelayInfo {
  // Relay Contract
  contract: Contract;
  // All tokens to compound
  tokens: string[];
}

interface TxData {
  to: string;
  data: string;
}

const TOKEN_ABI = [
"function balanceOf(address) external view returns(uint256)",
];

async function getFactoriesFromRegistry(registryAddr: string, provider: Provider): Promise<Contract[]> {
    let relayFactoryRegistry = new Contract(registryAddr, registryAbi, provider);
    console.log(
      `RelayFactoryRegistry is in address ${relayFactoryRegistry.address}`
    );

    // Retrieve all Relay Factories
    return (await relayFactoryRegistry.getAll()).map(
      (f: string) => new Contract(f, factoryAbi, provider)
    );
}

async function getCompounderRelayInfos(autoCompounderAddr: string, provider: Provider): Promise<RelayInfo[]> {
  let autoCompounderFactory = new Contract(
    autoCompounderAddr,
    compFactoryAbi,
    provider
  );
  console.log(
    `AutoCompounderFactory is in address ${autoCompounderFactory.address}`
  );

  let relayInfos: RelayInfo[] = [];
  // Fetch all Relays as Contracts from factory
  let relays: Contract[] = (await autoCompounderFactory.relays()).map(
    (r: string) => new Contract(r, compAbi, provider)
  );
  // Fetch all High Liquidity Tokens
  let highLiqTokens: string[] = await autoCompounderFactory.highLiquidityTokens();
  console.log(`All High Liq Tokens ${highLiqTokens}`);

  relays.forEach(async (relay: Contract) => {
    console.log("==================================");
    console.log(`Relay Address: ${relay.address}`);
    // Get Relay Balance of all high liquidity tokens
    let relayTokens: string[] = await getTokensToCompound(relay.address, highLiqTokens, provider);
    // Store info regarding all tokens of a Relay
    relayInfos.push({ contract: relay, tokens: relayTokens } as RelayInfo);
  });
  return relayInfos;
}

async function getTokensToCompound(relayAddr: string, highLiqTokens: string[], provider: Provider): Promise<string[]> {
  // Get all token balances
  let tokenBalances = await Promise.all(
    highLiqTokens.map((addr: string) =>
      new Contract(addr, TOKEN_ABI, provider).balanceOf(relayAddr)
    )
  );

  highLiqTokens.forEach((relayToken, i) => {
    console.log(
      `Address: ${relayToken}, Amount: ${tokenBalances[i]}`
    );
  });

  return highLiqTokens.filter((_, i) => tokenBalances[i] == 0); // Filter out tokens without amounts
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.default();

  const abiCoder = new AbiCoder();

  let relayFactories: Contract[];
  let relayInfos: RelayInfo[] = [];

  try {
    // Get Registry
    const registryAddr: string =
      (userArgs.registry as string) ??
      "0x925189766f98B766E64A67E9e70d435CD7F6F819";

    // Retrieve all Relay Factories
    relayFactories = await getFactoriesFromRegistry(registryAddr, provider);
    console.log(`All relayFactories ${relayFactories.map((e) => e.address)}`);

    // TODO: Only handling CompounderFactory
    // Fetch Tokens to Compound per AutoCompounder
    relayInfos = await getCompounderRelayInfos(relayFactories[0].address, provider);
  } catch (err) {
    return { canExec: false, message: `Rpc call failed ${err}` };
  }

  // TODO: Logging for debugging purposes
  console.log(`All relays ${relayInfos.map((info) => info.contract.address)}`);

  const slippage = 500; // TODO: choose slippage
  let txData: TxData[] = [];

  // Encode multicall for each Relay
  relayInfos.forEach((relayInfo: RelayInfo) => {
    let relay = relayInfo.contract;
    let abi = relay.interface;
    // Swap all Relay Tokens to VELO
    let calls: string[] = relayInfo.tokens.map((token) =>
      abi.encodeFunctionData("swapTokenToVELO", [token, slippage])
    );
    // Compound rewards
    calls.push(abi.encodeFunctionData("rewardAndCompound"));
    // Encode calls in multicall
    let callData: string = abiCoder.encode(["bytes[]"], calls);
    txData.push({
      to: relay.address,
      data: abi.encodeFunctionData("multicall", [callData]),
    } as TxData);
  });

  // Return execution call data
  return {
    canExec: true,
    // callData: txData,
    callData: [],
  };
});
