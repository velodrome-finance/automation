import { abi as compFactoryAbi } from "../../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import { abi as compAbi } from "../../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import jsonConstants from "../../../lib/relay-private/script/constants/Optimism.json";
import { abi as erc20Abi } from "../abis/erc20.json";
//TODO: move constants to constants.ts

import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import { useQuote } from "./quote";
import { WEEK, DAY, LP_SUGAR_ADDRESS, LP_SUGAR_ABI } from "../../constants";

// TODO: move type declaration
// Tokens to be Converted per Relay
export type RelayInfo = {
  // Relay Contract
  contract: Contract;
  // All tokens to compound
  tokens: RelayToken[];
}

// Token address paired with its Balance
export type RelayToken = {
  address: string;
  balance: BigNumber;
}

export type TxData = {
  to: string;
  data: string;
}

export type Route = {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
}

// From a list of Token addresses, filters out Tokens with no balance
export async function getTokensToCompound(
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

  return relayTokens;
}

// Get all AutoCompounders paired with their Tokens to compound
export async function getCompounderRelayInfos(
  relayAddrs: string[],
  highLiqTokens: string[],
  provider: Provider
): Promise<RelayInfo[]> {
  let relayInfos: RelayInfo[] = [];
  // Fetch all Relays as Contracts from factory
  let relays: Contract[] = relayAddrs.map(
    (r: string) => new Contract(r, compAbi, provider)
  );
  // let highLiqTokens: string[] =
  //   await autoCompounderFactory.highLiquidityTokens();

  // Retrieve tokens to be compounded for each Relay
  let tokenPromises: Promise<RelayToken[]>[] = relays.map(async (relay) =>
    getTokensToCompound(relay.address, highLiqTokens, provider)
  );
  let relayTokens = await Promise.all(tokenPromises);
  relays.forEach((relay, index) => {
    relayInfos.push({ contract: relay, tokens: relayTokens[index] });
  });
  // relayInfos.forEach((info) => {
  //     console.log(`Relay: ${info.contract.address}`);
  //     info.tokens.forEach((token) => console.log(`Address: ${token.address}, Balance: ${token.balance}`));
  // })
  return relayInfos;
}

// Converts a list of RelayInfos into the calls necessary for the Compounding
export function getCompounderTxData(relayInfos: RelayInfo[]): TxData[] {
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
  // console.log(txData);
  return txData;
}

export function getRoute(tokenFrom: string, tokenTo: string) {
  return {
    from: tokenFrom,
    to: tokenTo,
    stable: false,
    factory: jsonConstants.v2.PoolFactory,
  } as Route;
}
