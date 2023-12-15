// SPDX-License-Identifier: BUSL-1.1
import { ethers } from "ethers";

export const ZERO_ADDRESS = ethers.ZeroAddress;

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
