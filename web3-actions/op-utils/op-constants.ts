// SPDX-License-Identifier: BUSL-1.1
import lp_sugar_abi from "../abis/lp_sugar_op.json";

// OPT ADDRS
export const LP_SUGAR_ADDRESS = "0x6eDCAb198EAdDBDA3865f813A83F6bC9012F16e9";
export const ROUTER_ADDRESS = "0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858";
export const VELO = "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db";
export const KEEPER_REGISTRY_ADDRESS =
  "0x7bC95b327DF9d6dE05C1A02F6D252986Fcf45AF7";
export const RELAY_REGISTRY_ADDRESS =
  "0x6b1253B116B5919932399295C75116d33F8EfF96";
export const VELO_EXCLUDED_RELAYS = [
  "0x00621858D5Dc273FCF204260265bA6E66C34b5E7", // Foundation USDC Relay
];

export const KEEPER_LAST_RUN = "keeperLastRunOP";
export const LP_SUGAR_ABI = lp_sugar_abi;
