import hre from "hardhat";
import { before } from "mocha";
import { expect } from "chai";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Registry } from "../typechain/src/relay/";

import {
  impersonateAccount,
  stopImpersonatingAccount,
  setBalance,
  setStorageAt,
  time,
  setCode,
} from "@nomicfoundation/hardhat-network-helpers";
import {
  Web3FunctionExecSuccess,
  Web3FunctionUserArgs,
  Web3FunctionResultV2,
} from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";

import jsonConstants from "../lib/relay-private/script/constants/Optimism.json";
import jsonOutput from "../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";

import {
  AutoCompounder,
  CompoundOptimizer,
  AutoCompounderFactory,
} from "../typechain/src/autoCompounder/";
import { IVotingEscrow } from "../typechain/lib/contracts/contracts/interfaces/IVotingEscrow";
import { ERC20 } from "../typechain/lib/openzeppelin-contracts/contracts/token/ERC20/ERC20";
import { IVoter } from "../typechain/lib/contracts/contracts/interfaces/IVoter";
import { abi as erc20Abi } from "../web3-functions/relay/abis/erc20.json";
import lpSugarAbi from "../web3-functions/relay/abis/lp_sugar.json";

import { Contract } from "@ethersproject/contracts";
import { AbiCoder } from "@ethersproject/abi";
import { Libraries } from "hardhat/types";
import { BigNumber } from "ethers";
import { DAY, LP_SUGAR_ADDRESS } from "../web3-functions/relay/utils/constants";
const { ethers, deployments, w3f } = hre;

interface BalanceSlot {
  address: string;
  slot: number;
}

interface StorageList {
  [key: string]: BalanceSlot;
}

// Storage slots for the balanceOf mapping
const storageSlots: StorageList = {
  velo: {
    address: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
    slot: 0,
  } as BalanceSlot,
  usdc: {
    address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    slot: 0,
  } as BalanceSlot,
  dai: {
    address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    slot: 2,
  } as BalanceSlot,
  weth: {
    address: "0x4200000000000000000000000000000000000006",
    slot: 3,
  } as BalanceSlot,
};

async function createAutoCompounder(
  autoCompounderFactory: Contract,
  velo: Contract,
  escrow: Contract,
  owner: SignerWithAddress
) {
  // Impersonating manager
  const allowedManager = await escrow.allowedManager();
  await setBalance(allowedManager, 100e18);
  await impersonateAccount(allowedManager);
  const manager = await ethers.getSigner(allowedManager);

  // Creating Managed Lock
  const tx = await escrow.populateTransaction.createManagedLockFor(
    owner.address
  );
  await manager.sendTransaction({ ...tx, from: allowedManager });
  const mTokenId = await escrow.tokenId();
  await stopImpersonatingAccount(allowedManager);

  // Create Normal veNFT and deposit into managed
  const amount = BigNumber.from(10).pow(18);
  await velo.approve(escrow.address, amount.mul(10));
  await escrow.createLock(amount, 4 * 365 * 24 * 60 * 60);
  const token: BigNumber = await escrow.tokenId();
  const voter: IVoter = await ethers.getContractAt("IVoter", jsonOutput.Voter);
  await voter.depositManaged(token, mTokenId);

  await escrow.approve(autoCompounderFactory.address, mTokenId);

  // Create AutoCompounder
  const abiCoder = new AbiCoder();
  await autoCompounderFactory.createRelay(
    owner.address,
    mTokenId,
    "AutoCompounder",
    abiCoder.encode(["bytes"], [0])
  );

  return mTokenId;
}

async function setBalanceOf(
  userAddr: string,
  erc20address: string,
  slot: number,
  balance: number
) {
  // Storage slot index
  const storageIndex = ethers.utils.solidityKeccak256(
    ["uint256", "uint256"],
    [userAddr, slot] // key, slot
  );
  // Set balance
  await setStorageAt(erc20address, storageIndex.toString(), balance);
}

async function seedRelayWithBalances(
  relayAddr: string,
  storageSlots: StorageList
) {
  for (const key in storageSlots) {
    const { address, slot } = storageSlots[key];
    await setBalanceOf(relayAddr, address, slot, 100_000e18);
  }
}

export async function deployLibrary(
  typeName: string,
  ...args: any[]
): Promise<Contract> {
  const ctrFactory = await ethers.getContractFactory(typeName);

  const ctr = (await ctrFactory.deploy(...args)) as unknown as Contract;
  await ctr.deployed();
  return ctr;
}

export async function deploy<Type>(
  typeName: string,
  libraries?: Libraries,
  ...args: any[]
): Promise<Type> {
  const ctrFactory = await ethers.getContractFactory(typeName, { libraries });

  const ctr = (await ctrFactory.deploy(...args)) as unknown as Type;
  await (ctr as unknown as Contract).deployed();
  return ctr;
}

function logW3fRunStats(run: Web3FunctionExecSuccess) {
  const duration = run.duration.toFixed(2);
  const memory = run.memory.toFixed(2);
  const rpc = run.rpcCalls.total;
  console.log(`W3F run stats: ${duration}s / ${memory}mb / ${rpc} rpc calls`);
}

describe("AutoCompounder Automation Tests", function () {
  let userArgs: Web3FunctionUserArgs;
  let relayW3f: Web3FunctionHardhat;
  let owner: SignerWithAddress;

  let dai: ERC20;
  let usdc: ERC20;
  let weth: ERC20;
  let velo: ERC20;
  let relays: string[];
  let escrow: IVotingEscrow;
  let keeperRegistry: Registry;
  const mTokens: BigNumber[] = [];
  let relayFactoryRegistry: Registry;

  before(async function () {
    await deployments.fixture();
    [owner] = await hre.ethers.getSigners();

    relayFactoryRegistry = await ethers.getContractAt(
      "Registry",
      "0x925189766f98B766E64A67E9e70d435CD7F6F819"
    );
    keeperRegistry = await ethers.getContractAt(
      "Registry",
      "0x859f423Dc180C42A2F353796ed4A1591a46c3f69"
    );
    const factories: string[] = await relayFactoryRegistry.getAll();
    const autoCompounderFactory: AutoCompounderFactory =
      await ethers.getContractAt("AutoCompounderFactory", factories[0]);

    dai = await ethers.getContractAt(erc20Abi, storageSlots["dai"].address);
    usdc = await ethers.getContractAt(erc20Abi, storageSlots["usdc"].address);
    weth = await ethers.getContractAt(erc20Abi, storageSlots["weth"].address);
    velo = await ethers.getContractAt(erc20Abi, storageSlots["velo"].address);

    escrow = await ethers.getContractAt(
      "IVotingEscrow",
      jsonOutput.VotingEscrow
    );

    // Mint VELO to test user
    const { address: tokenAddr, slot } = storageSlots["velo"];
    await setBalanceOf(owner.address, tokenAddr, slot, 100_000e18); //TODO: this bal could be smaller

    // Setting owner as Keeper
    const allowedManager = await keeperRegistry.owner();
    await setBalance(allowedManager, 100e18);
    await impersonateAccount(allowedManager);
    const manager = await ethers.getSigner(allowedManager);

    const tx = await keeperRegistry.populateTransaction.approve(owner.address);
    await manager.sendTransaction({ ...tx, from: allowedManager });
    await stopImpersonatingAccount(allowedManager);

    // Create multiple AutoCompounders and save their mTokenId's
    for (let i = 0; i < 1; i++)
      mTokens.push(
        await createAutoCompounder(autoCompounderFactory, velo, escrow, owner)
      );

    // Fetch info on all the AutoCompounders and seed them with Tokens
    relays = await autoCompounderFactory.relays();
    for (const relay of relays) {
      await seedRelayWithBalances(relay, storageSlots);
    }

    // Warp to the last timestamp of the First Day
    const day = 24 * 60 * 60;
    const timestamp = await time.latest();
    const endOfFirstDay = timestamp - (timestamp % (7 * day)) + day;
    const newTimestamp =
      endOfFirstDay >= timestamp ? endOfFirstDay : endOfFirstDay + 7 * day;
    time.increaseTo(newTimestamp);

    relayW3f = w3f.get("relay");

    userArgs = {
      registry: relayFactoryRegistry.address,
    };

    // Warm up hardhat cache for lpSugar calls
    const lpSugarContract = await ethers.getContractAt(
      lpSugarAbi,
      LP_SUGAR_ADDRESS
    );
    await lpSugarContract.forSwaps(600, 0);
    await lpSugarContract.rewards(mTokens[0], 600, 0);
  });
  it("Test Compounder Automator Flow", async () => {
    const factories = await relayFactoryRegistry.getAll();
    const tokensToCompound = [usdc, weth, velo];

    // All balances were minted correctly for all Relays
    const oldBalances = [];
    for (const i in relays) {
      for (const token of tokensToCompound) {
        expect(await token.balanceOf(relays[i])).closeTo(
          BigNumber.from(10).pow(23),
          BigNumber.from(10).pow(17)
        );
      }
      const oldBal = await escrow.balanceOfNFT(mTokens[i]);
      expect(oldBal).to.equal(BigNumber.from(10).pow(18));
      oldBalances.push(oldBal);
    }

    // Run script and send its transactions
    const run = await relayW3f.run();
    const result = run.result as Web3FunctionResultV2;
    logW3fRunStats(run);

    expect(result.canExec).to.equal(true);

    for (const call of result.callData) {
      await owner.sendTransaction({ to: call.to, data: call.data });
    }

    // All balances were Swapped to VELO and compounded correctly for all Relays
    for (const i in relays) {
      for (const token of tokensToCompound) {
        expect(await token.balanceOf(relays[i])).to.equal(0);
      }
      expect(await escrow.balanceOfNFT(mTokens[i])).to.above(oldBalances[i]);
    }
  });
  it("Cannot execute if after first day of script", async () => {
    time.increase(1);
    const run = await relayW3f.run();
    const result = run.result as Web3FunctionResultV2;
    logW3fRunStats(run);
    expect(result.canExec).to.equal(false);
  });
  it("Cannot execute twice in a day", async () => {
    await relayW3f.run();
    time.increase(DAY - 1);
    const run = await relayW3f.run();
    const result = run.result as Web3FunctionResultV2;
    logW3fRunStats(run);
    expect(result.canExec).to.equal(false);
  });
});
