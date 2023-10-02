// SPDX-License-Identifier: BUSL-1.1
import { constants, utils } from "ethers";
import { Contract } from "@ethersproject/contracts";
import { BigNumber } from "@ethersproject/bignumber";

import lp_sugar_abi from "../../relay/abis/lp_sugar.json";
import ve_sugar_abi from "../../relay/abis/ve_sugar.json";
import library_abi from "../../relay/abis/library.json";
import router_abi from "../../relay/abis/router.json";

export const DAY = 24 * 60 * 60;
export const WEEK = 7 * DAY;

export const ZERO_ADDRESS = constants.AddressZero;
export const LP_SUGAR_ABI = lp_sugar_abi;
export const VE_SUGAR_ABI = ve_sugar_abi;
export const LIBRARY_ABI = library_abi;
export const ROUTER_ABI = router_abi;

export const VELO = "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db";
export const LP_SUGAR_ADDRESS = "0x4d996e294b00ce8287c16a2b9a4e637eca5c939f";
export const VE_SUGAR_ADDRESS = "0x0ecc2593e3a6a9be3628940fa4d928cc257b588b";
export const LIBRARY_ADDRESS = "0x253ca289cd921ba4a18c053c00a80c9660d508f8";
export const ROUTER_ADDRESS = "0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858";

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
