// SPDX-License-Identifier: BUSL-1.1
import { Contract } from "ethers";
import { RewardsToClaim } from "../common-utils/constants";

export async function executeClaims(
  relay: Contract,
  rewards: RewardsToClaim,
  batchSize = 3
): Promise<string[]> {
  const claimedTokens: string[] = [
    ...new Set(
      Object.values(rewards.fee).concat(Object.values(rewards.bribe)).flat()
    ),
  ];

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
  try {
    const txs = await Promise.all(promises);
    await Promise.all(txs.map((tx) => tx.wait()));
  } catch (err) {
    console.log("Error while processing claims.");
  }

  return claimedTokens;
}
