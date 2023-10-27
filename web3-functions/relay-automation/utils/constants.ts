// SPDX-License-Identifier: BUSL-1.1
import { constants } from "ethers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import lp_sugar_abi from "../abis/lp_sugar.json";

export const LP_SUGAR_ADDRESS = "0x4d996e294b00ce8287c16a2b9a4e637eca5c939f";
export const ROUTER_ADDRESS = "0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858";
export const VELO = "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db";
export const KEEPER_REGISTRY_ADDRESS =
  "0xDB8f1909FcA704597Eb186fea188ECc6b728332B";
export const RELAY_REGISTRY_ADDRESS =
  "0x1C33BA7a5F4F2E80622d603A9E5e54294410f6d9";
export const VELO_LIBRARY_ADDRESS =
  "0x253CA289Cd921ba4a18C053C00a80c9660D508f8";
export const COMPOUNDER_TOKEN_ID = 19041;
export const CONVERTER_TOKEN_ID = 19042;

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
