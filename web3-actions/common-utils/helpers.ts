// SPDX-License-Identifier: BUSL-1.1
import { Contract, Wallet } from "ethers";
import { RewardsToClaim, Relay, WEEK, HOUR } from "./constants";

// Executes Swaps given the Relay and Swap Information
export async function executeSwaps(
  relay: Contract,
  tokensToSwap: string[],
  quotes,
  swapFunction: string
) {
  let failedTokens: string[] = [];
  const txs = await Promise.all(
    quotes.map((quote, i) => {
      return new Promise(async (resolve, _) => {
        const token = tokensToSwap[i];
        let tx;
        try {
          if (quote)
            if (token.toLowerCase() == quote.route[0].from.toLowerCase()) {
              tx = await relay.getFunction(swapFunction)(
                token,
                500,
                quote.route
              );
              await tx.wait();
            }
        } catch (err) {
          failedTokens.push(token);
          console.log(`Did not swap token ${token}`);
          console.log("An error occurred while broadcasting the transaction.");
          const errStr = err?.toString() ?? "";
          if (errStr.includes("0x42301c23"))
            console.log("Revert: InsufficientOutputAmount()");
          else if (errStr.includes("0xa932492f")) console.log("Revert: K()");
          else console.log("Revert: Unknown Error Code");
        } finally {
          resolve(tx);
        }
      });
    })
  );
  return [txs, failedTokens];
}

// Executes Claims given the Relay and Reward Information
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

// Verifies if script can run in Current Epoch
export async function canRunInCurrentEpoch(
  timestamp,
  storage
): Promise<boolean> {
  const keeperLastRun = (await storage.getBigInt("keeperLastRun")) ?? 0n;
  const startOfCurrentEpoch = timestamp - (timestamp % WEEK);
  const startOfLastRunEpoch = keeperLastRun - (keeperLastRun % WEEK);

  // Can only run Once per Epoch and only after its First Hour
  return (
    !keeperLastRun ||
    (startOfCurrentEpoch != startOfLastRunEpoch &&
      timestamp > startOfCurrentEpoch + HOUR)
  );
}

// Retrieve all Relay Factories from the Registry
export async function getFactoriesFromRegistry(
  registryAddr: string,
  wallet: Wallet
): Promise<string[]> {
  const relayFactoryRegistry = new Contract(
    registryAddr,
    ["function getAll() view returns (address[] memory)"],
    wallet
  );

  return await relayFactoryRegistry.getAll();
}

// Retrieve all Relays from the list of Factories
export async function getRelaysFromFactories(
  factories: string[],
  compoundingToken: string,
  wallet: Wallet
): Promise<Relay[]> {
  const promises: Promise<Relay[]>[] = factories.map((factoryAddr) => {
    return new Promise(async (resolve, _) => {
      const factory: Contract = new Contract(
        factoryAddr,
        ["function relays() view returns (address[] memory)"],
        wallet
      );
      const relays = await factory.relays();
      const tokens = await Promise.all(
        relays.map((addr: string) =>
          new Contract(
            addr,
            ["function token() view returns (address)"],
            wallet
          ).token()
        )
      );
      const isAutoCompounder: boolean = tokens.every(
        (token) => token.toLowerCase() == compoundingToken.toLowerCase()
      );
      const relayInfos: Relay[] = relays.map((addr: string, i: number) => {
        return {
          address: addr,
          factory: factoryAddr,
          isAutoCompounder: isAutoCompounder,
          targetToken: tokens[i],
        } as Relay;
      });
      resolve(relayInfos);
    });
  });

  return (await Promise.all(promises)).flat();
}
