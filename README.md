# Perun Payment Channels
Ethereum payment channels implementing the [Perun protocols](https://perun.network).

## Contracts
The `contracts` directory contains the smart contracts, currently

- **LedgerChannels**: Single-deployment ledger channels smart contract.
- **Migrations**: Truffle migrations.

## Setup
Install truffle with `yarn global add truffle` and required node packages
with `yarn`. The truffle configuration is set to use the system's `solc`
solidity compiler, so install that one too (Arch Linux: `pacman -Sy solidity`).

## Development
is done with [`truffle`](https://truffleframework.com/docs/truffle/overview),
see linked documentation.

### Compilation
Compilation is set to use the system's `solc`.  Run it with `truffle compile`.

### Migration
First start a local [Ganache](https://truffleframework.com/docs/ganache/overview)
blockchain and then issue `truffle migrate`. This deploys truffle's
`Migration` contract as well as one instance of our contracts.


_Copyright (C) 2019 Sebastian Stammler, Marius van der Wijden / MIT license (see LICENSE file)_
