import { constants, utils } from "ethers";
import { optimism } from "wagmi/chains";

import lp_sugar_abi from "./relay/abis/lp_sugar.json";
import ve_sugar_abi from "./relay/abis/ve_sugar.json";
import library_abi from "./relay/abis/library.json";
import router_abi from "./relay/abis/router.json";

export const DAY = 24 * 60 * 60;
export const WEEK = 7 * DAY;

export const ZERO_ADDRESS = constants.AddressZero;
export const LP_SUGAR_ABI = lp_sugar_abi;
export const VE_SUGAR_ABI = ve_sugar_abi;
export const LIBRARY_ABI = library_abi;
export const ROUTER_ABI = router_abi;

export const LP_SUGAR_ADDRESS = "0x4d996e294b00ce8287c16a2b9a4e637eca5c939f";
export const VE_SUGAR_ADDRESS = "0x0ecc2593e3a6a9be3628940fa4d928cc257b588b";
export const LIBRARY_ADDRESS = "0x253ca289cd921ba4a18c053c00a80c9660d508f8";
export const ROUTER_ADDRESS = "0xa062ae8a9c5e11aaa026fc2670b0d65ccc8b2858";
