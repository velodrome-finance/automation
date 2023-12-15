// SPDX-License-Identifier: BUSL-1.1
import { ethers } from "ethers";

import lp_sugar_abi from "../abis/lp_sugar_op.json";

// OPT ADDRS
export const LP_SUGAR_ADDRESS = "0x6eDCAb198EAdDBDA3865f813A83F6bC9012F16e9";
export const ROUTER_ADDRESS = "0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858";
export const VELO = "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db";
export const KEEPER_REGISTRY_ADDRESS =
  "0xfe97A8c1C90c829a246914f9576cbdA6D26A5AA2";
export const RELAY_REGISTRY_ADDRESS =
  "0xe9F00f2e61CB0c6fb00A2e457546aCbF0fC303C2";
export const USDC_RELAY = "0x2cfFffa6b305104692d2B06CCF178ee28fe9DaA4";
export const VELO_EXCLUDED_RELAYS = [
  "0x2cfFffa6b305104692d2B06CCF178ee28fe9DaA4",
];

export const ZERO_ADDRESS = ethers.ZeroAddress;
export const LP_SUGAR_ABI = lp_sugar_abi;

export const HOUR = 60n * 60n;
export const DAY = 24n * HOUR;
export const WEEK = 7n * DAY;

// Relay to be Processed
export type Relay = {
  // Relay Address
  address: string;
  // Factory Address
  factory: string;
  // Token to swap rewards into
  targetToken: string;
  // True if Relay is AutoCompounder
  isAutoCompounder: boolean;
};

export type Route = {
  from: string;
  to: string;
  stable: boolean;
  factory: string;
};

export type Pool = {
  address: string;
  stable: boolean;
  token0: string;
  token1: string;
  factory: string;
};

export type Reward = {
  fee: string;
  bribe: string;
  token: string;
};

export type RewardsToClaim = {
  fee: RewardContractInfo;
  bribe: RewardContractInfo;
};

export type RewardContractInfo = {
  [key: string]: string[];
};
