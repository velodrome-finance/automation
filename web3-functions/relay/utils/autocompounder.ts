import { abi as compAbi } from "../../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import jsonConstants from "../../../lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";
import { abi as erc20Abi } from "../abis/erc20.json";

import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import { buildGraph, fetchQuote, getRoutes } from "./quote";
import { getClaimCalls } from "./ve";
import {
  LP_SUGAR_ADDRESS,
  LP_SUGAR_ABI,
  VELO,
  RelayToken,
  RelayInfo,
  TxData,
} from "../utils/constants";

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
      erc20Abi,
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
  const lpSugar = new Contract(LP_SUGAR_ADDRESS, LP_SUGAR_ABI, provider);
  const [poolsGraph, poolsByAddress] = buildGraph(
    await lpSugar.forSwaps(345, 0)
  ); // TODO: Find right value, was using 600, 0

  for (let relayInfo of relayInfos) {
    const relay = relayInfo.contract;
    const abi = relay.interface;

    // Fetch Relay Rewards
    let calls: string[] = await getClaimCalls(relay, 75);

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
