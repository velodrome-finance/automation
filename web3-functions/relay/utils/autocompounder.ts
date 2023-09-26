import { abi as compFactoryAbi } from "../../../artifacts/src/autoCompounder/AutoCompounderFactory.sol/AutoCompounderFactory.json";
import { abi as compAbi } from "../../../artifacts/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import { abi as voterAbi } from "../../../artifacts/lib/contracts/contracts/interfaces/IVoter.sol/IVoter.json";
import jsonConstants from "../../../lib/relay-private/script/constants/Optimism.json";
import { abi as erc20Abi } from "../abis/erc20.json";
//TODO: move constants to constants.ts

import { BigNumber } from "@ethersproject/bignumber";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";

import { fetchBribeRewards, fetchFeeRewards } from "./ve";
import jsonOutput from "../../../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";

import { LP_SUGAR_ADDRESS, LP_SUGAR_ABI } from "../../constants";

// TODO: move type declaration
// Tokens to be Converted per Relay
export type RelayInfo = {
  // Relay Contract
  contract: Contract;
  // All tokens to compound
  tokens: RelayToken[];
};

// Token address paired with its Balance
export type RelayToken = {
  address: string;
  balance: BigNumber;
};

export type TxData = {
  to: string;
  data: string;
};

export type Route = {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
};

export type Reward = {
  venft_id: number;
  lp: string;
  amount: BigNumber;
  token: string;
  fee: string;
  bribe: string;
};

export type RewardContractInfo = {
  [key: string]: string[];
};

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
export async function getCompounderTxData(
  relayInfos: RelayInfo[],
  provider: Provider
): Promise<TxData[]> {
  let txData: TxData[] = [];
  let contract = new Contract(LP_SUGAR_ADDRESS, LP_SUGAR_ABI, provider);
  let pools = await contract.forSwaps(50, 0); // TODO: Find right value, was using 600, 0

  // TODO: THIS IS USED FOR TESTING
  let voter = new Contract(jsonOutput.Voter, voterAbi, provider);
  let mTokenId = await relayInfos[0].contract.mTokenId();
  mTokenId = BigNumber.from(4145);
  let feeRewards: RewardContractInfo = await fetchFeeRewards(mTokenId, pools, provider);
  console.log("REWAJBRKJHASGFJASBJ");
  console.log(feeRewards);
  // let bribeRewards: RewardContractInfo = await fetchBribeRewards(
  //   mTokenId,
  //   pools,
  //   provider
  // );
  // console.log("REWAJBRKJHASGFJASBJ");
  // console.log(bribeRewards);

  for (let relayInfo of relayInfos.slice(0,1)) {
    const relay = relayInfo.contract;
    const abi = relay.interface;
    //TODO: also encode claimBribes and claimFees

    // // Fetch Relay Rewards
    // let mTokenId = await relay.mTokenId();
    // let feeRewards: RewardContractInfo = await fetchFeeRewards(mTokenId, pools, provider);
    // let bribeRewards: RewardContractInfo = await fetchBribeRewards(
    //   mTokenId,
    //   pools,
    //   provider
    // );

    // // Claim all available Rewards
    // let calls: string[] = [
    //     abi.encodeFunctionData("claimFees", [Object.keys(feeRewards), Object.values(feeRewards)]),
    //     abi.encodeFunctionData("claimBribes", [Object.keys(bribeRewards), Object.values(bribeRewards)])
    // ];

    // // Swap all Relay Tokens to VELO
    // calls.concat(relayInfo.tokens.map((token) =>
    //   abi.encodeFunctionData("swapTokenToVELOKeeper", [
    //     [getRoute(token.address, jsonConstants.v2.VELO)],
    //     token.balance,
    //     1,
    //   ])
    // ));

    // calls.pop(); //TODO: removing frax there is no routing for it yet
    // calls.push(abi.encodeFunctionData("compound"));
    txData.push({
      // to: relay.address,
      // data: abi.encodeFunctionData("multicall", [calls]),
      //TODO: Used for testing of claimFees and claimBribes VVV
      to: voter.address,
      data: voter.interface.encodeFunctionData("claimFees", [Object.keys(feeRewards), Object.values(feeRewards), 4145]),
      // data: voter.interface.encodeFunctionData("claimBribes", [Object.keys(bribeRewards), Object.values(bribeRewards), 4145]),
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
