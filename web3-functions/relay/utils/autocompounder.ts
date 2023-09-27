import { abi as compAbi } from "../../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import jsonConstants from "../../../lib/relay-private/script/constants/Optimism.json";
import { abi as erc20Abi } from "../abis/erc20.json";

import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";


import { RelayToken, RelayInfo, TxData, Route, LP_SUGAR_ADDRESS, LP_SUGAR_ABI } from "../utils/constants";
import { getClaimCalls } from "./ve";
import { useQuote } from "./quote";

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

// Converts a list of RelayInfos into the calls necessary for the Compounding
export async function getCompounderTxData(
  relayInfos: RelayInfo[],
  provider: Provider
): Promise<TxData[]> {
  let txData: TxData[] = [];

  for (let relayInfo of relayInfos) {
    const relay = relayInfo.contract;
    const abi = relay.interface;

    // Fetch Relay Rewards
    let calls: string[] = await getClaimCalls(relay, 75);

    const contract = new Contract(LP_SUGAR_ADDRESS, LP_SUGAR_ABI, provider);
    const pools = await contract.forSwaps(125, 0); // TODO: Find right value, was using 600, 0
    // Swap all Relay Tokens to VELO
    for(let token of relayInfo.tokens) {
        calls.push(
          abi.encodeFunctionData("swapTokenToVELOKeeper", [
            (await useQuote(pools, token.address, jsonConstants.v2.VELO, token.balance, provider)),
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
