// SPDX-License-Identifier: BUSL-1.1
import { Contract, Wallet } from "ethers";
import { HOUR, Relay, WEEK } from "./constants";

export async function executeSwaps(
  relay: Contract,
  tokensToSwap: string[],
  quotes,
  swapFunction: string
) {
  let failedTokens: string[] = [];
  console.log("Will submit Swap Transactions now...");
  console.log(
    "------------------------------------------------------------------"
  );
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
            } else {
              console.log("TOKENS DO NOT MATCH");
            }
        } catch (err) {
          failedTokens.push(token);
          console.log(`Did not swap token ${token}`);
          console.log("An error occurred while broadcasting the transaction.");
          const errStr = err?.toString() ?? "";
          if (errStr.includes("0x42301c23"))
            console.log("Revert: InsufficientOutputAmount()");
          else if (errStr.includes("0xa932492f")) console.log("Revert: K()");
          else {
            console.log("Revert: Unknown Error Code");
          }
          console.log(
            "------------------------------------------------------------------"
          );
        } finally {
          resolve(tx);
        }
      });
    })
  );
  return [txs, failedTokens];
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

// TODO: Probably remove this for deploy
export async function logSwapBalances(
  relay: Contract,
  tokensToSwap: string[],
  targetToken: string
) {
  const newBalances: BigInt[] = await Promise.all(
    tokensToSwap.map((addr) =>
      new Contract(
        addr,
        ["function balanceOf(address) view returns (uint256)"],
        relay.runner
      ).balanceOf(relay.target.toString())
    )
  );
  for (const i in tokensToSwap) {
    console.log(`Token ${tokensToSwap[i]}, Balance = ${newBalances[i]}`);
  }
  const targetBal = await new Contract(
    targetToken,
    ["function balanceOf(address) view returns (uint256)"],
    relay.runner
  ).balanceOf(relay.target.toString());
  console.log(`TargetToken Bal = ${targetBal}`);
}
