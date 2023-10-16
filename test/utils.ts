import { BigNumber } from "ethers";
import hre from "hardhat";
const { ethers } = hre;

import { Libraries } from "hardhat/types";
import { AbiCoder } from "@ethersproject/abi";
import { Contract } from "@ethersproject/contracts";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { IVoter } from "../typechain/relay-private/lib/contracts/contracts/interfaces/IVoter";
import jsonOutput from "../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";

import {
  setBalance,
  setStorageAt,
  impersonateAccount,
  stopImpersonatingAccount,
} from "@nomicfoundation/hardhat-network-helpers";

import {
  Web3FunctionExecSuccess,
} from "@gelatonetwork/web3-functions-sdk";

export type BalanceSlot = {
  address: string;
  slot: number;
  decimals: number;
}

export type StorageList = {
  [key: string]: BalanceSlot;
}

// Storage slots for the balanceOf mapping
export const storageSlots: StorageList = {
  velo: {
    address: "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
    slot: 0,
    decimals: 18,
  } as BalanceSlot,
  usdc: {
    address: "0x7F5c764cBc14f9669B88837ca1490cCa17c31607",
    slot: 0,
    decimals: 6,
  } as BalanceSlot,
  dai: {
    address: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    slot: 2,
    decimals: 18,
  } as BalanceSlot,
  weth: {
    address: "0x4200000000000000000000000000000000000006",
    slot: 3,
    decimals: 18,
  } as BalanceSlot,
};

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

export async function deployLibrary(
  typeName: string,
  ...args: any[]
): Promise<Contract> {
  const ctrFactory = await ethers.getContractFactory(typeName);

  const ctr = (await ctrFactory.deploy(...args)) as unknown as Contract;
  await ctr.deployed();
  return ctr;
}

export function logW3fRunStats(run: Web3FunctionExecSuccess) {
  const duration = run.duration.toFixed(2);
  const memory = run.memory.toFixed(2);
  const rpc = run.rpcCalls.total;
  console.log(`W3F run stats: ${duration}s / ${memory}mb / ${rpc} rpc calls`);
}

export async function setBalanceOf(
  userAddr: string,
  storageSlot: BalanceSlot,
  balance: number
) {
  let { address, slot, decimals } = storageSlot;
  // Storage slot index
  const storageIndex = ethers.utils.solidityKeccak256(
    ["uint256", "uint256"],
    [userAddr, slot] // key, slot
  );
  // Set balance
  await setStorageAt(address, storageIndex.toString(), BigNumber.from(balance).mul(BigNumber.from(10).pow(BigNumber.from(decimals))));
}

export async function seedRelayWithBalances(
  relayAddr: string,
  storageSlots: StorageList
) {
  for (let key in storageSlots) {
    const balances: {[id: string]: number} = {
      "weth": 10,
      "velo": 100_000,
    };

    const bal = balances[key] || 10_000;
    await setBalanceOf(relayAddr, storageSlots[key], bal);
  }
}

export async function createAutoCompounder(
  autoCompounderFactory: Contract,
  velo: Contract,
  escrow: Contract,
  owner: SignerWithAddress
) {
  // Impersonating manager
  let allowedManager = await escrow.allowedManager();
  await setBalance(allowedManager, 100e18);
  await impersonateAccount(allowedManager);
  let manager = await ethers.getSigner(allowedManager);

  // Creating Managed Lock
  let tx = await escrow.populateTransaction.createManagedLockFor(owner.address);
  await manager.sendTransaction({ ...tx, from: allowedManager });
  let mTokenId = await escrow.tokenId();
  await stopImpersonatingAccount(allowedManager);

  // Create Normal veNFT and deposit into managed
  let amount = BigNumber.from(10).pow(18);
  await velo.approve(escrow.address, amount.mul(10));
  await escrow.createLock(amount, 4 * 365 * 24 * 60 * 60);
  let token: BigNumber = await escrow.tokenId();
  let voter: IVoter = await ethers.getContractAt("IVoter", jsonOutput.Voter);
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
