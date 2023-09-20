import { constants, utils } from "ethers";
import { optimism } from "wagmi/chains";

import lp_sugar_abi from "./abis/lp_sugar.json";
import router_abi from "./abis/router.json";
import ve_sugar_abi from "./abis/ve_sugar.json";
import ve_v1_sugar_abi from "./abis/ve_v1_sugar.json";

export const DAY = 24 * 60 * 60;
export const WEEK = 7 * DAY;
export const ZERO_ADDRESS = constants.AddressZero;
export const TOKEN_ICON = "/svg/coin.svg";
export const PASSHASH = import.meta.env.VITE_PASSHASH;
export const RPC_URI = import.meta.env.VITE_RPC_URI;
export const LP_SUGAR_ADDRESS = import.meta.env.VITE_LP_SUGAR_ADDRESS;
export const LP_SUGAR_ABI = lp_sugar_abi;
export const VE_SUGAR_ADDRESS = import.meta.env.VITE_VE_SUGAR_ADDRESS;
export const VE_SUGAR_ABI = ve_sugar_abi;
export const V1_VE_SUGAR_ADDRESS = process.env.VITE_V1_VE_SUGAR_ADDRESS;
export const V1_VE_SUGAR_ABI = ve_v1_sugar_abi;
export const ROUTER_ABI = router_abi;
export const ROUTER_ADDRESS = import.meta.env.VITE_ROUTER_ADDRESS;
export const V1_ROUTER_ADDRESS = import.meta.env.VITE_V1_ROUTER_ADDRESS;
export const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS;
export const LIBRARY_ADDRESS = import.meta.env.VITE_LIBRARY_ADDRESS;
export const MINTER_ADDRESS = import.meta.env.VITE_MINTER_ADDRESS;
export const VOTER_ADDRESS = import.meta.env.VITE_VOTER_ADDRESS;
export const V1_VOTER_ADDRESS = import.meta.env.VITE_V1_VOTER_ADDRESS;
export const V1_VE_ADDRESS = import.meta.env.VITE_V1_VE_ADDRESS;
export const SINK_ADDRESS = import.meta.env.VITE_SINK_ADDRESS;
export const VE_ADDRESS = import.meta.env.VITE_VE_ADDRESS;
export const PRICES_ADDRESS = import.meta.env.VITE_PRICES_ADDRESS;
export const DEFAULT_TOKEN_ETH = import.meta.env.VITE_DEFAULT_TOKEN_ETH;
export const STABLE_TOKEN = import.meta.env.VITE_STABLE_TOKEN;
export const DEFAULT_TOKENS = String(import.meta.env.VITE_DEFAULT_TOKENS)
  .split(",")
  .map((tokenAddress) => tokenAddress.toLowerCase());
// Self-burning tokens... eg. OptiDoge
export const UNSAFE_TOKENS = String(import.meta.env.VITE_UNSAFE_TOKENS)
  .split(",")
  .map((tokenAddress) => tokenAddress.toLowerCase());
// Route connector tokens for prices contract
export const CONNECTOR_TOKENS = String(import.meta.env.VITE_CONNECTOR_TOKENS)
  .split(",")
  .map((tokenAddress) => tokenAddress.toLowerCase());

export const SIGNIN_MESSAGE =
  "By signing this I confirm that I have read and I agree to the terms of " +
  "service and legal disclaimer provided by Velodrome Finance on ";

export const DEFAULT_SLIPPAGE = import.meta.env.VITE_DEFAULT_SLIPPAGE;
export const DEFAULT_SWAP_MINUTES = import.meta.env.VITE_DEFAULT_SWAP_MINUTES;
export const DEFAULT_EXPERT_MODE = false;
export const SAFE_PI = utils.parseUnits(String(import.meta.env.VITE_SAFE_PI));
export const UNSAFE_PI = utils.parseUnits(
  String(import.meta.env.VITE_UNSAFE_PI)
);

export const TOKEN_ASSETS_CDN = String(
  import.meta.env.VITE_TOKEN_ASSETS_CDN
).split(",");
export const DEFAULT_CHAIN = optimism;
export const NATIVE_TOKEN_LOGO = import.meta.env.VITE_NATIVE_TOKEN_LOGO;
export const NATIVE_TOKEN = {
  ...DEFAULT_CHAIN.nativeCurrency,
  wrappedAddress: import.meta.env.VITE_WRAPPED_NATIVE_TOKEN.toLowerCase(),
  address: DEFAULT_CHAIN.nativeCurrency.symbol.toLowerCase(),
};

export const WALLETCONNECT_PROJECT_ID = import.meta.env
  .VITE_WALLETCONNECT_PROJECT_ID;

// prettier-ignore
export const FEATURE_FLAGS = String(
  import.meta.env.VITE_FEATURE_FLAGS
).split(",");

export const TOKEN_REQ_HOOK = import.meta.env.VITE_TOKEN_REQ_HOOK;
