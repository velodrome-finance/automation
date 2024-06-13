// SPDX-License-Identifier: BUSL-1.1
import { constants } from "ethers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import lp_sugar_abi from "../abis/lp_sugar.json";

// BASE ADDRS
export const LP_SUGAR_ADDRESS = "0x2073D8035bB2b0F2e85aAF5a8732C6f397F9ff9b";
export const ROUTER_ADDRESS = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
export const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
export const KEEPER_REGISTRY_ADDRESS =
  "0xBC3dc970f891ffdd3049FA3a649985CC6626d486";
export const RELAY_REGISTRY_ADDRESS =
  "0x05e41604B9463e2224227053980dfF3f57fb6dB5";
export const USDC_RELAY = "0x43E3267Ce69862FFbEEa59690cDb3e798f71cE7E";
export const USDC_RELAY2 = "0x70Ec93EF92bdE5AA7AFFf6546207bD378A28933C";

export const PROCESSING_COMPLETE: string = "complete";
export const COMPOUND_STAGE: string = "compound";
export const CLAIM_STAGE: string = "claim";
export const SWAP_STAGE: string = "swap";

export const ZERO_ADDRESS = constants.AddressZero;
export const LP_SUGAR_ABI = lp_sugar_abi;

export const HOUR = 60 * 60;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

// Tokens to be Converted per Relay
export type RelayInfo = {
  // Relay Contract
  contract: Contract;
  // All tokens to compound
  tokens: RelayToken[];
};

// Token address paired with its Balance
export type RelayToken = {
  address: string;
  balance: BigNumber;
};

export type TxData = {
  to: string;
  data: string;
};

export type Route = {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
};

export type Reward = {
  fee: string;
  bribe: string;
  token: string;
};

export type RewardContractInfo = {
  [key: string]: string[];
};
