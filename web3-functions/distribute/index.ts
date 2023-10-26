// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";

import { WEEK, DAY, TxData } from "../relay-automation/utils/constants";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";
import jsonOutput from "../../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";

async function encodeDistributionCalls(
  voterAddr: string,
  minterAddr: string,
  minterFunction: string,
  shouldRebase: boolean,
  provider: Provider
): Promise<TxData[]> {
  let txData: TxData[] = [];

  // Minter Update Period
  const v1Minter: Contract = new Contract(
    minterAddr,
    [`function ${minterFunction} external returns (uint256)`],
    provider
  );
  txData.push({
    to: minterAddr,
    data: v1Minter.interface.encodeFunctionData(minterFunction),
  } as TxData);

  // Distributing to Gauges
  const v1Voter: Contract = new Contract(
    voterAddr,
    [
      "function distribute(uint256 _start, uint256 _finish)",
      "function length() external view returns (uint256)",
    ],
    provider
  );
  const poolLength: BigNumber = await v1Voter.length();

  // TODO: Probably process 1 distribute per call
  // or perhaps one call per gauge? if not too gas intensive
  // Distributes in batches of 10 but will probably change to 1 gauge per batch
  txData = txData.concat(
    [...Array(poolLength.toNumber()).keys()]
      .filter((i: number) => i % 10 == 0)
      .slice(0, 3)
      .map(
        (i) =>
          ({
            to: voterAddr,
            data: v1Voter.interface.encodeFunctionData(
              "distribute(uint256,uint256)",
              [i, i + 10]
            ),
          } as TxData)
      )
  );

  if (shouldRebase) {
    const sinkManager: Contract = new Contract(
      jsonOutput.SinkManager,
      ["function claimRebaseAndGaugeRewards()"],
      provider
    );
    txData.push({
      to: sinkManager.address,
      data: sinkManager.interface.encodeFunctionData(
        "claimRebaseAndGaugeRewards()"
      ),
    } as TxData);
  }
  return txData;
}

// Verifies if script can run in Current Epoch
export async function canRunInCurrentEpoch(
  provider,
  storage
): Promise<boolean> {
  const timestamp = (await provider.getBlock("latest")).timestamp;
  const startOfCurrentEpoch: number = timestamp - (timestamp % (7 * DAY));
  const keeperLastRun: number = Number(
    (await storage.get("lastDistribution")) ?? ""
  );
  const startOfLastRunEpoch: number =
    keeperLastRun - (keeperLastRun % (7 * DAY));

  // Distributions are only ran once per Epoch
  //TODO: Should I only allow distributions before end of first hour?
  return (
    !keeperLastRun ||
    (startOfCurrentEpoch != startOfLastRunEpoch &&
      timestamp > startOfCurrentEpoch)
  );
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { multiChainProvider, storage } = context;
  const provider = multiChainProvider.default();

  let txData: TxData[] = [];

  try {
    // Can only run on First Day of Epoch
    if (!(await canRunInCurrentEpoch(provider, storage)))
      return { canExec: false, message: `Too Soon for Execution` };

    // v1 Update Period > v1 Distribute > v2 Update Period > v2 Distribute > SinkClaim
    // Encoding V1 Distribution transactions
    txData = txData.concat(
      await encodeDistributionCalls(
        jsonConstants.v1.Voter,
        jsonConstants.v1.Minter,
        "update_period()",
        false,
        provider
      )
    );

    // Encoding V2 Distribution transactions
    txData = txData.concat(
      await encodeDistributionCalls(
        jsonOutput.Voter,
        jsonOutput.Minter,
        "updatePeriod()",
        true,
        provider
      )
    );

    // Saves the latest Distribution's Timestamp
    const timestamp = (await provider.getBlock("latest")).timestamp;
    await storage.set("lastDistribution", timestamp.toString());
  } catch (err) {
    return { canExec: false, message: `Rpc call failed ${err}` };
  }

  // Return execution Call Data
  return txData.length > 0
    ? {
        canExec: true,
        callData: txData,
      }
    : {
        canExec: false,
        message: "No transactions to broadcast.",
      };
});
