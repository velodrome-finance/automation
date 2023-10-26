// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";

import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";
import jsonOutput from "../../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";

const HOUR = 60 * 60;
const DAY = 24 * HOUR;

type TxData = {
  to: string;
  data: string;
};

// Encodes Minter's UpdatePeriod and Voter's Distributions
async function encodeDistributionCalls(
  voterAddr: string,
  minterAddr: string,
  minterFunction: string,
  provider: Provider
): Promise<TxData[]> {
  let txData: TxData[] = [];

  // Minter Update Period
  const minter: Contract = new Contract(
    minterAddr,
    [`function ${minterFunction} external returns (uint256)`],
    provider
  );
  txData.push({
    to: minterAddr,
    data: minter.interface.encodeFunctionData(minterFunction),
  } as TxData);

  // Distributing to Gauges
  const voter: Contract = new Contract(
    voterAddr,
    [
      "function distribute(uint256 _start, uint256 _finish)",
      "function length() external view returns (uint256)",
    ],
    provider
  );
  const poolLength: BigNumber = await voter.length();

  // TODO: Perhaps process one call per gauge? if not too gas intensive
  // Distributes in batches of 10 but will probably change to 1 gauge per batch
  txData = txData.concat(
    [...Array(poolLength.toNumber()).keys()]
      .filter((i: number) => i % 10 == 0)
      .slice(0, 3)
      .map(
        (i) =>
          ({
            to: voterAddr,
            data: voter.interface.encodeFunctionData(
              "distribute(uint256,uint256)",
              [i, i + 10]
            ),
          } as TxData)
      )
  );
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
  // And they should take place during its first Hour
  //TODO: Should I allow distributions after the end of first hour?
  return (
    !keeperLastRun ||
    (startOfCurrentEpoch != startOfLastRunEpoch &&
      timestamp > startOfCurrentEpoch &&
      timestamp <= startOfCurrentEpoch + HOUR)
  );
}

// Script to Automate V1 and V2 Distributions. Transactions are encoded in the order below
// v1 Update Period > v1 Distribute > v2 Update Period > v2 Distribute > SinkManager Claim
Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { multiChainProvider, storage } = context;
  const provider = multiChainProvider.default();

  let txData: TxData[] = [];

  try {
    // Can only run on First Day of Epoch
    if (!(await canRunInCurrentEpoch(provider, storage)))
      return { canExec: false, message: `Too Soon for Execution` };

    // Encoding V1 Distribution transactions
    txData = txData.concat(
      await encodeDistributionCalls(
        jsonConstants.v1.Voter,
        jsonConstants.v1.Minter,
        "update_period()",
        provider
      )
    );

    // Encoding V2 Distribution transactions
    txData = txData.concat(
      await encodeDistributionCalls(
        jsonOutput.Voter,
        jsonOutput.Minter,
        "updatePeriod()",
        provider
      )
    );

    // Encoding SinkManager Claim and Rebase
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
