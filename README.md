# Velodrome Automation Repository

This repository contains the scripts designed to automate the Velodrome 
ecosystem using Gelato's Web3-Functions SDK.

Currently, this contains the Relay Keeper automation, which is designed
to execute all necessary Keeper actions after an Epoch Flip.
These actions include:
- Claiming of all available Rewards for a Relay;
- Swapping claimed rewards to the Relay's destination token;
- If the Relay is an AutoCompounder, Compounding of swapped tokens also
takes place, depositing the generated Rewards back into the Relay's veNFT,
resulting in a larger position.

## Installation

This repository is a hybrid Hardhat and Foundry repository.

Install Hardhat dependencies, with `yarn install`.
Install Foundry dependencies, with `forge install`.

## Testing

Tests are executed using Hardhat, with `yarn test`.

## Licensing

Files in the `web3-functions/relay-automation` folder are licensed under the Business Source License 1.1 (`BUSL-1.1`).
