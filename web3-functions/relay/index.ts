import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { abi as compFactoryAbi } from "../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import { abi as compAbi } from "../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import { abi as factoryAbi } from "../../artifacts/src/RelayFactory.sol/RelayFactory.json";
import { abi as registryAbi } from "../../artifacts/src/Registry.sol/Registry.json";
import { Contract } from "@ethersproject/contracts";
import { AbiCoder } from "@ethersproject/abi";

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

interface TxData {
  to: string;
  data: string;
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { userArgs, multiChainProvider } = context;

  const provider = multiChainProvider.default();

  const abiCoder = new AbiCoder();

  const TOKEN_ABI = [
    "function balanceOf(address) external view returns(uint256)",
  ];

  let relays: Contract[];
  let relayInfos: RelayInfo[] = [];

  let highLiqTokens: string[];
  let relayFactories: Contract[];
  let relayFactoryRegistry: Contract;
  let autoCompounderFactory: Contract;

  try {
    const registryAddr: string =
      (userArgs.registry as string) ??
      "0x925189766f98B766E64A67E9e70d435CD7F6F819";

    relayFactoryRegistry = new Contract(registryAddr, registryAbi, provider);
    console.log(
      `RelayFactoryRegistry is in address ${relayFactoryRegistry.address}`
    );

    // Retrieve all Relay Factories
    relayFactories = (await relayFactoryRegistry.getAll()).map(
      (f: string) => new Contract(f, factoryAbi, provider)
    );
    console.log(`All relayFactories ${relayFactories.map((e) => e.address)}`);

    // TODO: only using autoCompounderFactory for now
    autoCompounderFactory = new Contract(
      relayFactories[0].address,
      compFactoryAbi,
      provider
    );

    // Fetch all High Liquidity Tokens
    highLiqTokens = await autoCompounderFactory.highLiquidityTokens();
    // Fetch all Relays as Contracts from factory
    relays = (await autoCompounderFactory.relays()).map(
      (r: string) => new Contract(r, compAbi, provider)
    );

    // Get all token balances
    relays.forEach(async (relay) => {
      let tokenBalances = await Promise.all( // Fetch all token balances
        highLiqTokens.map((addr: string) =>
          new Contract(addr, TOKEN_ABI, provider).balanceOf(relay.address)
        )
      );

      // Pair balances with tokens as a RelayToken instance
      let relayTokens: RelayToken[] = [];
      highLiqTokens.forEach((addr, i) =>
        relayTokens.push({
          address: addr,
          amount: tokenBalances[i],
        } as RelayToken)
      );
      relayTokens.filter((token) => token.amount != 0); // Filter out tokens without amounts

      // Store info regarding all tokens of a Relay
      relayInfos.push({ contract: relay, tokens: relayTokens } as RelayInfo);
    });
  } catch (err) {
    return { canExec: false, message: `Rpc call failed ${err}` };
  }

  // TODO: Logging for debugging purposes
  console.log(
    `AutoCompounderFactory is in address ${autoCompounderFactory.address}`
  );
  console.log(`All relays ${relays}`);
  console.log(`All High Liq Tokens ${highLiqTokens}`);
  relayInfos.forEach((relayInfo) => {
    let contract = relayInfo.contract;
    console.log("==================================");
    console.log(`Relay Address: ${contract.address}`);
    relayInfo.tokens.forEach((relayToken) => {
      console.log(
        `Address: ${relayToken.address}, Amount: ${relayToken.amount}`
      );
    });
  });

  const slippage = 500; // TODO: choose slippage
  let txData: TxData[] = [];

  // Encode multicall for each Relay
  relayInfos.forEach((relayInfo: RelayInfo) => {
    let relay = relayInfo.contract;
    let abi = relay.interface;
    // Swap all Relay Tokens to VELO
    let calls: string[] = relayInfo.tokens.map((info) =>
      abi.encodeFunctionData("swapTokenToVELO", [info.address, slippage])
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
