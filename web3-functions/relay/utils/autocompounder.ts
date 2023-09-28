import { abi as compAbi } from "../../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import jsonConstants from "../../../lib/relay-private/script/constants/Optimism.json";
import { abi as erc20Abi } from "../abis/erc20.json";

import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import {
  RelayToken,
  RelayInfo,
  TxData,
  Route,
  LP_SUGAR_ADDRESS,
  LP_SUGAR_ABI,
} from "../utils/constants";
import { getClaimCalls } from "./ve";
import { fetchQuote, getRoutes } from "./quote";

// From a list of Token addresses, filters out Tokens with no balance
export async function getTokensToCompound(
  relayAddr: string,
  highLiqTokens: string[],
  provider: Provider
): Promise<RelayToken[]> {
  // Get all token balances
  let tokenBalances: BigNumber[] = [];
  for(const addr of highLiqTokens) {
      tokenBalances.push(await (new Contract(addr, erc20Abi, provider).balanceOf(relayAddr)));
  }

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
  // Retrieve tokens to be compounded for each Relay
  let relayInfos: RelayInfo[] = [];
  for(const addr of relayAddrs) {
      const relay = new Contract(addr, compAbi, provider);
      relayInfos.push({contract: relay, tokens: await getTokensToCompound(addr, highLiqTokens, provider)} as RelayInfo);
  }
  return relayInfos;
}

// Converts a list of RelayInfos into the calls necessary for the Compounding
export async function getCompounderTxData(
  relayInfos: RelayInfo[],
  provider: Provider
): Promise<TxData[]> {
  let txData: TxData[] = [];
  const lpSugar = new Contract(LP_SUGAR_ADDRESS, LP_SUGAR_ABI, provider);
  const pools = await lpSugar.forSwaps(340, 0); // TODO: Find right value, was using 600, 0

  for (let relayInfo of relayInfos) {
    const relay = relayInfo.contract;
    const abi = relay.interface;

    // Fetch Relay Rewards
    let calls: string[] = await getClaimCalls(relay, 75);

    // Swap all Relay Tokens to VELO
    for (let token of relayInfo.tokens) {
      const quote = await fetchQuote(
        getRoutes(
          pools,
          token.address.toLowerCase(),
          jsonConstants.v2.VELO.toLowerCase()
        ),
        token.balance,
        provider
      );
      if (quote)
        calls.push(
          abi.encodeFunctionData("swapTokenToVELOKeeper", [
            quote.route,
            token.balance,
            1,
          ])
        );
    }

    // Compound all Tokens
    calls.push(abi.encodeFunctionData("compound"));
    txData.push({
      to: relay.address,
      data: abi.encodeFunctionData("multicall", [calls]),
    } as TxData);
  }
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
