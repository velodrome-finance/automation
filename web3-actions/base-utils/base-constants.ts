// SPDX-License-Identifier: BUSL-1.1
import lp_sugar_abi from "../abis/lp_sugar_base.json";

// BASE ADDRS
export const LP_SUGAR_ADDRESS = "0x2073D8035bB2b0F2e85aAF5a8732C6f397F9ff9b";
export const ROUTER_ADDRESS = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43";
export const AERO = "0x940181a94A35A4569E4529A3CDfB74e38FD98631";
export const KEEPER_REGISTRY_ADDRESS =
  "0x08724A9b94767a0BB9b539d3133Ac7A6AF9F283c";
export const RELAY_REGISTRY_ADDRESS =
  "0xD308aBCe663302d3b86b36d332CEFd8A4F62C5Ed";
export const AERO_EXCLUDED_RELAYS = [
  "0x48A6a8D403a58ecCc70d4d57347F801D4E182564", // Ouranous Foundation
  "0xC875b3Dae5B0C371bc8cf9deD64868b78ac47587", // Echinacea Foundation
  "0x6a941fE89Cac5f440bb14e5286AD3E38ca3F2d39", // Public Goods Funding
];

export const LP_SUGAR_ABI = lp_sugar_abi;
