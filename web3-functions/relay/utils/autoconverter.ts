import { abi as compFactoryAbi } from "../../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import { abi as convAbi } from "../../../artifacts/src/autoConverter/AutoConverter.sol/AutoConverter.json";
import jsonConstants from "../../../lib/relay-private/script/constants/Optimism.json";
import { abi as erc20Abi } from "../abis/erc20.json";

import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import { RelayInfo, RelayToken, TxData, Route } from "../utils/constants";

// From a list of Token addresses, filters out Tokens with no balance
export async function getTokensToConvert(
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

  // relayTokens.forEach((token) => {
  //   console.log(`Address: ${token.address}, Amount: ${token.balance}`);
  // });

  return relayTokens;
}

// Get all AutoConverters paired with their Tokens to compound
export async function getConverterRelayInfos(
  relayAddrs: string[],
  tokensToSwap: string[],
  provider: Provider
): Promise<RelayInfo[]> {
  // Fetch all Relays as Contracts from factory
  let relays: Contract[] = relayAddrs.map(
    (r: string) => new Contract(r, convAbi, provider)
  );

  // TODO: Fix getting tokens to swap
  let compounderFactory: Contract = new Contract(
    "0xd4C6eDDBE963aFA2D7b1562d0F2F3F9462E6525b",
    compFactoryAbi,
    provider
  );
  // Fetch all High Liquidity Tokens
  tokensToSwap = await compounderFactory.highLiquidityTokens();

  // Retrieve tokens to be compounded for each Relay
  let tokenPromises: Promise<RelayToken[]>[] = relays.map((relay) =>
    getTokensToConvert(relay.address, tokensToSwap, provider)
  );
  let relayInfos: RelayInfo[] = [];
  let relayTokens: RelayToken[][] = await Promise.all(tokenPromises);
  relays.forEach((relay, index) => {
    relayInfos.push({ contract: relay, tokens: relayTokens[index] });
  });
  return relayInfos;
}

// Converts a list of RelayInfos into the calls necessary for the Converting
export async function getConverterTxData(
  relayInfos: RelayInfo[]
): Promise<TxData[]> {
  let txData: TxData[] = [];
  let destinationTokens: string[] = await Promise.all(
    relayInfos.map((info) => info.contract.token())
  );
  // Encode multicall for each Relay
  relayInfos.forEach((relayInfo: RelayInfo, i: number) => {
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
    let destinationToken: string = destinationTokens[i];
    let calls: string[] = relayInfo.tokens.map((token) => {
      if (token.address == destinationToken)
        // TODO: Finish excluding destination token
        token.address = jsonConstants.v2.VELO;
      return abi.encodeFunctionData("swapTokenToToken", [
        [getRoute(token.address, destinationToken)],
        token.balance,
        1,
      ]);
    });

    calls.pop(); //TODO: removing frax there is no routing for it yet

    txData = txData.concat(
      calls.map((call) => ({ to: relay.address, data: call } as TxData))
    );
  });
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
