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
  Web3FunctionUserArgs,
  Web3FunctionResultV2,
} from "@gelatonetwork/web3-functions-sdk";
import { Web3FunctionHardhat } from "@gelatonetwork/web3-functions-sdk/hardhat-plugin";

import jsonOutput from "../lib/relay-private/lib/contracts/script/constants/output/DeployVelodromeV2-Optimism.json";

import {
  AutoConverter,
  AutoConverterFactory,
} from "../typechain/src/autoConverter/";
import { IVotingEscrow } from "../typechain/lib/contracts/contracts/interfaces/IVotingEscrow";
import { ERC20 } from "../typechain/lib/openzeppelin-contracts/contracts/token/ERC20/ERC20";
import { IVoter } from "../typechain/lib/contracts/contracts/interfaces/IVoter";
import { abi as erc20Abi } from "../web3-functions/relay/abis/erc20.json";

import { Contract } from "@ethersproject/contracts";
import { Libraries } from "hardhat/types";
import { BigNumber } from "ethers";
import { DAY } from "../web3-functions/relay/utils/constants";
import { hexZeroPad } from "ethers/lib/utils";
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
  frax: {
    address: "0x2E3D870790dC77A83DD1d18184Acc7439A53f475",
    slot: 0,
  },
};

async function createAutoConverter(
  autoConverterFactory: Contract,
  usdc: Contract,
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
  await velo.approve(escrow.address, amount);
  await escrow.createLock(amount, 4 * 365 * 24 * 60 * 60);
  let token: BigNumber = await escrow.tokenId();
  let voter: IVoter = await ethers.getContractAt("IVoter", jsonOutput.Voter);
  await voter.depositManaged(token, mTokenId);

  await escrow.approve(autoConverterFactory.address, mTokenId);

  // Create AutoConverter
  await autoConverterFactory.createRelay(
    owner.address,
    mTokenId,
    "AutoConverter",
    hexZeroPad(usdc.address, 32)
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
  for (let key in storageSlots) {
    let { address, slot } = storageSlots[key];
    // if(address != storageSlots["usdc"].address)
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

describe("AutoConverter Automation Tests", function () {
  let userArgs: Web3FunctionUserArgs;
  let relayW3f: Web3FunctionHardhat;
  let owner: SignerWithAddress;

  let dai: ERC20;
  let usdc: ERC20;
  let frax: ERC20;
  let weth: ERC20;
  let velo: ERC20;
  let relays: string[];
  let escrow: IVotingEscrow;
  let keeperRegistry: Registry;
  let mTokens: BigNumber[] = [];
  let autoConverter: AutoConverter;
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
    const autoConverterFactory: AutoConverterFactory =
      await ethers.getContractAt("AutoConverterFactory", factories[1]);

    dai = await ethers.getContractAt(erc20Abi, storageSlots["dai"].address);
    usdc = await ethers.getContractAt(erc20Abi, storageSlots["usdc"].address);
    frax = await ethers.getContractAt(erc20Abi, storageSlots["frax"].address);
    weth = await ethers.getContractAt(erc20Abi, storageSlots["weth"].address);
    velo = await ethers.getContractAt(erc20Abi, storageSlots["velo"].address);

    escrow = await ethers.getContractAt(
      "IVotingEscrow",
      jsonOutput.VotingEscrow
    );

    // Mint VELO to test user
    let { address: tokenAddr, slot } = storageSlots["velo"];
    await setBalanceOf(owner.address, tokenAddr, slot, 100_000e18); //TODO: this bal could be smaller

    // Setting owner as Keeper
    let allowedManager = await keeperRegistry.owner();
    await setBalance(allowedManager, 100e18);
    await impersonateAccount(allowedManager);
    let manager = await ethers.getSigner(allowedManager);

    let tx = await keeperRegistry.populateTransaction.approve(owner.address);
    await manager.sendTransaction({ ...tx, from: allowedManager });
    await stopImpersonatingAccount(allowedManager);

    for (let i = 0; i < 4; i++)
      mTokens.push(
        await createAutoConverter(
          autoConverterFactory,
          usdc,
          velo,
          escrow,
          owner
        )
      );

    relays = await autoConverterFactory.relays();
    autoConverter = await ethers.getContractAt("AutoConverter", relays[0]);
    expect(await autoConverter.token()).to.equal(usdc.address);

    for (const relay of relays) {
      await seedRelayWithBalances(relay, storageSlots);
    }

    // Warp to the last timestamp of the First Day
    let timestamp = await time.latest();
    let endOfFirstDay = timestamp - (timestamp % (7 * DAY)) + DAY;
    let newTimestamp =
      endOfFirstDay >= timestamp ? endOfFirstDay : endOfFirstDay + 7 * DAY;
    time.increaseTo(newTimestamp);

    relayW3f = w3f.get("relay");

    userArgs = {
      registry: relayFactoryRegistry.address,
    };
  });
  it("Test Converter Automator Flow", async () => {
    let factories = await relayFactoryRegistry.getAll();
    let tokensToCompound = [dai, weth, velo];

    // All balances were minted correctly

    let oldBalances = [];
    for (const i in relays) {
      for (const token of tokensToCompound) {
        expect(await token.balanceOf(relays[i])).closeTo(
          BigNumber.from(10).pow(23),
          BigNumber.from(10).pow(17)
        );
      }
      let oldBal = await usdc.balanceOf(relays[i]);
      expect(oldBal).closeTo(
        BigNumber.from(10).pow(23),
        BigNumber.from(10).pow(17)
      );
      oldBalances.push(oldBal);
    }

    let oldBal = await usdc.balanceOf(autoConverter.address);
    expect(oldBal).closeTo(
      BigNumber.from(10).pow(23),
      BigNumber.from(10).pow(17)
    );

    let { result } = await relayW3f.run();
    result = result as Web3FunctionResultV2;
    expect(result.canExec).to.equal(true);
    for (let call of result.callData) {
      await owner.sendTransaction({ to: call.to, data: call.data });
    }

    // All balances were Swapped to USDC and compounded correctly
    for (const i in relays) {
      for (const token of tokensToCompound) {
        expect(await token.balanceOf(relays[i])).to.equal(0);
      }
      expect(await usdc.balanceOf(relays[i])).to.above(oldBal);
    }
  });
  it("Cannot execute if after first day of script", async () => {
    time.increase(1);
    let { result } = await relayW3f.run();
    expect(result.canExec).to.equal(false);
  });

  it("Cannot execute twice in a day", async () => {
    await relayW3f.run();
    time.increase(DAY - 1);
    let { result } = await relayW3f.run();
    expect(result.canExec).to.equal(false);
  });
});
