// SPDX-License-Identifier: BUSL-1.1
import { Contract } from "ethers";
import {
  RewardsToClaim,
} from "../common-utils/constants";

export async function processClaims(
  relay: Contract,
  rewards: RewardsToClaim,
  logEvents: boolean = false,
  batchSize = 3
): Promise<string[]> {
  const claimedTokens: string[] = [
    ...new Set(
      Object.values(rewards.fee).concat(Object.values(rewards.bribe)).flat()
    ),
  ];
  let oldBalances: { [id: string]: BigInt } = {};
  // TODO: logs are for debugging purposes
  if (logEvents)
    oldBalances = await logBalances(relay, claimedTokens, logEvents);

  let promises = [];
  let feeKeys = Object.keys(rewards.fee);
  let feeValues = Object.values(rewards.fee);
  for (let i = 0; i < feeKeys.length; i += batchSize) {
    const batchKeys = feeKeys.slice(i, i + batchSize);
    const batchValues = feeValues.slice(i, i + batchSize);
    promises.push(relay.claimFees(batchKeys, batchValues));
  }

  let bribeKeys = Object.keys(rewards.bribe);
  let bribeValues = Object.values(rewards.bribe);
  for (let i = 0; i < bribeKeys.length; i += batchSize) {
    const batchKeys = bribeKeys.slice(i, i + batchSize);
    const batchValues = bribeValues.slice(i, i + batchSize);
    promises.push(relay.claimBribes(batchKeys, batchValues));
  }
  console.log("Will be processing claims now");
  try {
    const txs = await Promise.all(promises);
    await Promise.all(txs.map((tx) => tx.wait()));
    console.log("Claims processed");
  } catch (err) {
    console.log("Error while processing claims.");
  }

  if (logEvents) {
    const balances = await logBalances(relay, claimedTokens, logEvents);
    compareBalances(oldBalances, balances, claimedTokens.length);
  }
  return claimedTokens;
}

// TODO: remove logging functions logBalances and compareBalances before deploy
export async function logBalances(
  relay: Contract,
  tokens: string[],
  logEvents: boolean = false
): Promise<{ [id: string]: BigInt }> {
  const relayAddr: string = relay.target.toString();
  let results: { [id: string]: BigInt } = {};
  for (const addr of tokens) {
    const token = new Contract(
      addr,
      [
        "function balanceOf(address) view returns (uint256)",
        "function name() view returns (string)",
      ],
      relay.runner
    );
    const name = await token.name();
    const amount = await token.balanceOf(relayAddr);
    if (logEvents) {
      console.log("Current Token: %s, Address: %s", name, addr);
      console.log("This is the token balance: %s", amount.toString());
      console.log(
        "================================================================="
      );
    }
    results[addr] = amount;
  }
  return results;
}

export function compareBalances(oldBalances, balances, length) {
  let count = 0;
  for (const addr in oldBalances) {
    const oldBal = oldBalances[addr];
    const newBal = balances[addr];
    if (newBal > oldBal) count++;
  }
  console.log(
    `Claimed Rewards from ${count} tokens. The claimedTokens variable had ${length} items.`
  );
  if (length)
    console.log(
      `${((count / length) * 100).toFixed(2)}% of tokens claimed successfully.`
    );
}
