// SPDX-License-Identifier: BUSL-1.1
import {
  Web3Function,
  Web3FunctionContext,
} from "@gelatonetwork/web3-functions-sdk";
import { Contract } from "@ethersproject/contracts";
import { Provider } from "@ethersproject/providers";
import { BigNumber } from "@ethersproject/bignumber";

import jsonOutput from "../../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";
import jsonConstants from "../../lib/relay-private/script/constants/Optimism.json";
import { WEEK, DAY, TxData } from "../relay-automation/utils/constants";

async function encodeV1DistributionCalls(provider: Provider): Promise<TxData[]> {
    let txData: TxData[] = [];

    // V1 Minter Update Period
    const v1Minter: Contract = new Contract(jsonConstants.v1.Minter, ["function update_period() external returns (uint256)"], provider);
    txData.push({ to: v1Minter.address, data: v1Minter.interface.encodeFunctionData("update_period()") } as TxData);

    // Distributing to V1 Gauges
    const v1Voter: Contract = new Contract(jsonConstants.v1.Voter, ["function distribute(uint256 _start, uint256 _finish)", "function length() external view returns (uint256)"], provider);
    const poolLength: BigNumber = await v1Voter.length();

    // TODO: Probably process 1 distribute per call
    // or perhaps one call per gauge? if not too gas intensive
    // Distributes in batches of 10 but will probably change to 1 gauge per batch
    txData = txData.concat([...Array(poolLength.toNumber()).keys()].filter((i: number) => i % 10 == 0).slice(0,2) //TODO: remove slice
              .map((i) => ({
                  to: v1Voter.address,
                  data: v1Voter.interface.encodeFunctionData("distribute(uint256,uint256)", [ i, i + 10 ])
              } as TxData)));

    return txData;
}

async function encodeV2DistributionCalls(provider: Provider): Promise<TxData[]> {
    let txData: TxData[] = [];

    // V2 Minter Update Period
    const v2Minter = new Contract(jsonOutput.Minter, ["function updatePeriod() external returns (uint256 _period)"], provider);
    txData.push({ to: v2Minter.address, data: v2Minter.interface.encodeFunctionData("updatePeriod()") } as TxData);

    // Distributing to V2 Gauges
    const v2Voter = new Contract(jsonOutput.Voter, ["function distribute(uint256 _start, uint256 _finish)", "function length() external view returns (uint256)"], provider);
    const poolLength = await v2Voter.length();

    // TODO: Probably process 1 distribute per call
    // or perhaps one call per gauge? if not too gas intensive
    // Distributes in batches of 10 but will probably change to 1 gauge per batch
    txData = txData.concat([...Array(poolLength.toNumber()).keys()].filter((i: number) => i % 10 == 0).slice(0,2) //TODO: remove slice
              .map((i) => ({
                  to: v2Voter.address,
                  data: v2Voter.interface.encodeFunctionData("distribute(uint256,uint256)", [ i, i + 10 ])
              } as TxData)));

    // SinkManager Claim Rebase and Gauge Rewards
    //TODO: It seems like this function is always called twice. Should check if I should do the same
    const sinkManager: Contract = new Contract(jsonOutput.SinkManager, ["function claimRebaseAndGaugeRewards()"], provider);
    txData.push({to: sinkManager.address, data: sinkManager.interface.encodeFunctionData("claimRebaseAndGaugeRewards()")} as TxData);
    return txData;
}

Web3Function.onRun(async (context: Web3FunctionContext) => {
  const { multiChainProvider } = context;
  const provider = multiChainProvider.default();

  let txData: TxData[] = [];

  try {
    const timestamp = (await provider.getBlock("latest")).timestamp;
    console.log(`Timestamp is ${timestamp}`);
    // TODO: maybe make new utils folder for this script to save constants
    let firstDayEnd = timestamp - (timestamp % WEEK) + DAY;

    // Can only run on First Day of Epoch
    // if (firstDayEnd < timestamp)
    //   return { canExec: false, message: `Not first day` };

    // v1 Update Period > v1 Distribute > v2 Update Period > v2 Distribute > SinkClaim
    // Encoding V1 Distribution transactions
    txData = txData.concat(await encodeV1DistributionCalls(provider));
    console.log("DATA FOR V1");
    console.log(txData);


    // Encoding V2 Distribution transactions
    txData = txData.concat(await encodeV2DistributionCalls(provider));

    console.log("DATA FOR V2");
    console.log(txData);

  } catch (err) {
      console.log(err);
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
