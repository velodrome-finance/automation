import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
//TODO: move constants to constants.ts
import { abi as compFactoryAbi } from "../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import { abi as compAbi } from "../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import { abi as factoryAbi } from "../../artifacts/src/RelayFactory.sol/RelayFactory.json";
import { abi as registryAbi } from "../../artifacts/src/Registry.sol/Registry.json";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";
import { abi as erc20Abi } from "./abis/erc20.json";

import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import { useContractRead } from "wagmi";
// import { useQuote } from "../hooks/quote";
// import {WEEK, DAY, LP_SUGAR_ADDRESS, LP_SUGAR_ABI} from "../constants";

// Tokens to be Converted per Relay
interface RelayInfo {
  // Relay Contract
  contract: Contract;
  // All tokens to compound
  tokens: RelayToken[];
}

// Token address paired with its Balance
interface RelayToken {
  address: string;
  balance: BigNumber;
}

interface TxData {
  to: string;
  data: string;
}

interface Route {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
}

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

// Get all AutoCompounders paired with their Tokens to compound
async function getCompounderRelayInfos(
  autoCompounderAddr: string,
  provider: Provider
): Promise<RelayInfo[]> {
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
  let highLiqTokens: string[] =
    await autoCompounderFactory.highLiquidityTokens();

  // Retrieve tokens to be compounded for each Relay
  let tokenPromises: Promise<RelayToken[]>[] = relays.map(async (relay) =>
    getTokensToCompound(relay.address, highLiqTokens, provider)
  );
  let relayTokens = await Promise.all(tokenPromises);
  relays.forEach((relay, index) => {
    relayInfos.push({ contract: relay, tokens: relayTokens[index] });
  });
  return relayInfos;
}

// From a list of Token addresses, filters out Tokens with no balance
async function getTokensToCompound(
  relayAddr: string,
  highLiqTokens: string[],
  provider: Provider
): Promise<RelayToken[]> {
  // Get all token balances
  let tokenBalances: BigNumber[] = await Promise.all(
    highLiqTokens.map((addr: string) =>
      new Contract(addr, erc20Abi, provider).balanceOf(relayAddr)
    )
  );

  // Pair balances with tokens and filter out zero balances
  let relayTokens: RelayToken[] = highLiqTokens
    .map(
      (token: string, i: number) =>
        ({ address: token, balance: tokenBalances[i] } as RelayToken)
    )
    .filter((token: RelayToken) => !token.balance.isZero());

  relayTokens.forEach((token) => {
    console.log(`Address: ${token.address}, Amount: ${token.balance}`);
  });

  return relayTokens;
}

// Converts a list of RelayInfos into the calls necessary for the Compounding
function getCompounderTxData(relayInfos: RelayInfo[]): TxData[] {
  let txData: TxData[] = [];
  // Encode multicall for each Relay
  relayInfos.forEach((relayInfo: RelayInfo) => {
    let relay = relayInfo.contract;
    let abi = relay.interface;
    //TODO: also encode claimBribes and claimFees

    // TODO: Finish useQuote
    // const { data: pools, error: poolsError } = useContractRead({
    //   address: LP_SUGAR_ADDRESS,
    //   abi: LP_SUGAR_ABI,
    //   functionName: "forSwaps",
    //   args: [600, 0],
    //   cacheTime: 5_000,
    // });

    // const {
    //   data: newQuote,
    //   error: quoteError,
    //   refetch: reQuote,
    // } = useQuote(pools, relayInfo.tokens[0].address, jsonConstants.v2.VELO, amount, {
    //   enabled: pools.length > 0 && amount != 0,
    // });

    // Swap all Relay Tokens to VELO
    let calls: string[] = relayInfo.tokens.map((token) =>
      abi.encodeFunctionData("swapTokenToVELOKeeper", [
        [getRoute(token.address, jsonConstants.v2.VELO)],
        token.balance,
        1,
      ])
    );
    calls.pop(); //TODO: removing frax there is no routing for it yet
    calls.push(abi.encodeFunctionData("compound"));
    txData.push({
      to: relay.address,
      data: abi.encodeFunctionData("multicall", [calls]),
    } as TxData);
  });
  return txData;
}

function getRoute(tokenFrom: string, tokenTo: string) {
  return {
    from: tokenFrom,
    to: tokenTo,
    stable: false,
    factory: jsonConstants.v2.PoolFactory,
  } as Route;
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
