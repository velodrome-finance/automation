// SPDX-License-Identifier: BUSL-1.1
import { Contract, Wallet } from "ethers";

//TODO: move this to abis folder
import { abi as compAbi } from "../../artifacts/lib/relay-private/src/autoCompounder/AutoCompounder.sol/AutoCompounder.json";
import { abi as convAbi } from "../../artifacts/lib/relay-private/src/autoConverter/AutoConverter.sol/AutoConverter.json";
import { buildGraph, fetchQuote, getRoutes } from "./quote";
import { claimRewards, getPools } from "./rewards";
import {
  LP_SUGAR_ADDRESS,
  LP_SUGAR_ABI,
  VELO,
  Relay,
  WEEK,
  HOUR,
  VELO_EXCLUDED_RELAYS,
} from "./op-constants";

export async function processRelay(
  relayAddr: string,
  factoryAddr: string,
  targetToken: string,
  isAutoCompounder: boolean,
  wallet: Wallet
) {
  // Process AutoCompounder
  const abi = isAutoCompounder ? compAbi : convAbi;
  const relay = new Contract(relayAddr, abi, wallet);
  const lpSugarContract: Contract = new Contract(
    LP_SUGAR_ADDRESS,
    LP_SUGAR_ABI,
    relay.runner
  );

  const claimedTokens = await claimRewards(relay, lpSugarContract);
  await processSwaps(
    relay,
    factoryAddr,
    claimedTokens,
    targetToken,
    lpSugarContract,
    isAutoCompounder
  );

  if (isAutoCompounder) {
    try {
      const tx = await relay.compound();
      await tx.wait();
      console.log("Compounding has happened successfully.");
      console.log(tx.hash);
    } catch (err) {
      console.log("Error while compounding tokens.");
    }

    //TODO: Logging for debugging purposes
    const veloBal = await new Contract(
      VELO,
      ["function balanceOf(address) view returns (uint256)"],
      relay.runner
    ).balanceOf(relay.target.toString());
    console.log(`VELO Bal = ${veloBal}`);
  }
}

async function processSwaps(
  relay: Contract,
  factoryAddr: string,
  tokensToSwap: string[],
  targetToken: string,
  lpSugarContract: Contract,
  isAutoCompounder: boolean
) {
  const factory = new Contract(
    factoryAddr,
    ["function highLiquidityTokens() view returns (address[] memory)"],
    relay.runner
  );
  // Get all tokens to Swap
  const highLiqTokens = await factory.highLiquidityTokens();
  tokensToSwap = [...new Set(tokensToSwap.concat(highLiqTokens))].filter(
    (addr: string) => addr.toLowerCase() !== targetToken.toLowerCase()
  );
  const relayAddr: string = relay.target.toString();
  if (
    VELO_EXCLUDED_RELAYS.map((addr) => addr.toLowerCase()).includes(
      relayAddr.toLowerCase()
    )
  )
    // if foundation relay, do not swap velo
    tokensToSwap = tokensToSwap.filter(
      (addr: string) => addr.toLowerCase() !== VELO.toLowerCase()
    );

  // TODO: Logging for debugging purposes
  await logSwapBalances(relay, tokensToSwap, targetToken);

  // Getting quotes for all Swaps
  let [quotes, failedQuotes] = await getQuotes(
    relayAddr,
    lpSugarContract,
    highLiqTokens,
    tokensToSwap,
    targetToken
  );
  const claimFunction = isAutoCompounder
    ? "swapTokenToVELOWithOptionalRoute"
    : "swapTokenToTokenWithOptionalRoute";
  let [txs, failedSwaps] = await executeSwaps(
    relay,
    tokensToSwap,
    quotes,
    claimFunction
  );

  console.log("All swaps processed.");
  console.log("These are the tokens that could not be swapped:");
  console.log(failedQuotes.concat(failedSwaps));
  console.log(
    `TokensToSwap: ${tokensToSwap.length} Failed Swaps: ${
      failedQuotes.concat(failedSwaps).length
    }`
  );

  // TODO: Logging for debugging purposes
  await logSwapBalances(relay, tokensToSwap, targetToken);

  console.log("All transactions successfully executed.");
  console.log("Tx hashes:");
  console.log(txs.filter(Boolean).map((tx) => tx.hash));
}

// TODO: Probably remove this for deploy
async function logSwapBalances(
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

async function getQuotes(
  relayAddr: string,
  lpSugarContract: Contract,
  highLiqTokens: string[],
  tokensToSwap: string[],
  targetToken: string
) {
  console.log("Will fetch pools now...");
  const [poolsGraph, poolsByAddress] = buildGraph(
    await getPools(lpSugarContract)
  );
  console.log("All pools fetched");

  const balances: BigInt[] = await Promise.all(
    tokensToSwap.map((addr) =>
      new Contract(
        addr,
        ["function balanceOf(address) view returns (uint256)"],
        lpSugarContract.runner
      ).balanceOf(relayAddr)
    )
  );

  let failedTokens: string[] = [];
  const provider = lpSugarContract.runner?.provider;
  console.log("Will fetch all quotes now...");
  const quotes = await Promise.all(
    tokensToSwap.map((token, i) => {
      return new Promise(async (resolve, _) => {
        let quote;
        try {
          const bal = balances[i];
          if (bal > 0n && provider) {
            let hops = 2;
            // refetch quote with up to 3 hops if no route found
            while (!quote && hops <= 3) {
              quote = await fetchQuote(
                getRoutes(
                  poolsGraph,
                  poolsByAddress,
                  token.toLowerCase(),
                  targetToken.toLowerCase(),
                  highLiqTokens.map((token: string) => token.toLowerCase()),
                  hops++
                ),
                bal,
                provider
              );
            }
            if (!quote) {
              failedTokens.push(token);
              console.log(`Did not fetch quote for token ${token}`);
            }
          }
          // resolve(quote);
        } catch (error) {
          console.log("Error while fetching Quote.");
          // //TODO: delete resolve comments if not necessary
          // resolve(quote);
        } finally {
          resolve(quote);
        }
      });
    })
  );
  return [quotes, failedTokens];
}

async function executeSwaps(
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
          // resolve(tx);
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
          // console.log(err);
          console.log(
            "------------------------------------------------------------------"
          );
          //TODO: Do i need reject?
          // TODO: do i need two resolves? maybe pull it inside finally block
          // resolve(tx);
        } finally {
          resolve(tx);
        }
      });
    })
  );
  return [txs, failedTokens];
}

// TODO: Update this to match new storage
// Verifies if script can run in Current Epoch
export async function canRunInCurrentEpoch(
  provider,
  storage
): Promise<boolean> {
  const timestamp = BigInt(
    (await provider.getBlock("latest"))?.timestamp ?? 0n
  );
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
        (token) => token.toLowerCase() == VELO.toLowerCase()
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
