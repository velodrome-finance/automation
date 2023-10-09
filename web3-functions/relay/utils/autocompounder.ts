// SPDX-License-Identifier: BUSL-1.1
import { Provider } from "@ethersproject/providers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import { abi as compAbi } from "../../../artifacts/lib/relay-private/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import { RelayToken, RelayInfo, TxData, VELO } from "../utils/constants";
import { buildGraph, fetchQuote, getRoutes } from "./quote";
import { getClaimCalls, getPools } from "./rewards";

const POOLS_TO_FETCH = 300;
const REWARDS_TO_FETCH = 150;

// From a list of Token addresses, filters out Tokens with no balance
export async function getTokensToCompound(
  relayAddr: string,
  highLiqTokens: string[],
  provider: Provider
): Promise<RelayToken[]> {
  // Pair all Tokens to be compounded with their balances
  let relayTokens: RelayToken[] = [];
  for (const addr of highLiqTokens) {
    const tokenBalance: BigNumber = await new Contract(
      addr,
      ["function balanceOf(address) view returns (uint256)"],
      provider
    ).balanceOf(relayAddr);
    if (!tokenBalance.isZero())
      relayTokens.push({ address: addr, balance: tokenBalance } as RelayToken);
  }

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
  for (const addr of relayAddrs) {
    const relay = new Contract(addr, compAbi, provider);
    relayInfos.push({
      contract: relay,
      tokens: await getTokensToCompound(addr, highLiqTokens, provider),
    } as RelayInfo);
  }
  return relayInfos;
}

// Converts a list of RelayInfos into the calls necessary for the Compounding
export async function getCompounderTxData(
  relayInfos: RelayInfo[],
  provider: Provider
): Promise<TxData[]> {
  let txData: TxData[] = [];
  const [poolsGraph, poolsByAddress] = buildGraph(
    await getPools(provider, POOLS_TO_FETCH)
  );

  for (let relayInfo of relayInfos) {
    const relay = relayInfo.contract;
    const abi = relay.interface;

    // Fetch Relay Rewards
    let calls: string[] = await getClaimCalls(relay, REWARDS_TO_FETCH);

    // Swap all Relay Tokens to VELO
    for (let token of relayInfo.tokens) {
      const quote = await fetchQuote(
        getRoutes(
          poolsGraph,
          poolsByAddress,
          token.address.toLowerCase(),
          VELO.toLowerCase()
        ),
        token.balance,
        provider
      );
      if (quote)
        calls.push(
          abi.encodeFunctionData("swapTokenToVELOKeeper", [
            quote,
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
