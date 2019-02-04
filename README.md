# Perun Payment Channels
Ethereum payment channels implementing the [Perun protocols](https://perun.network).

## Contracts
The `contracts` directory contains the smart contracts, currently

- **LedgerChannels**: Single-deployment ledger channels smart contract.
- **Migrations**: Truffle migrations.

## Setup
[Truffle](https://truffleframework.com/docs/truffle/overview) and typescript are
assumed to be installed globally (`yarn global add truffle typescript` or use
your distro packages, e.g., `pacman -Sy typescript` for Arch Linux).  Other
dependencies are installed with `yarn`.  The truffle configuration is set to use
the system's `solc` solidity compiler, so install that one too (Arch Linux:
`pacman -Sy solidity`).

## Development
is done with the truffle framework and typescript.

### Compilation
Compilation consists of three steps. First, the contracts are compiled using
`solc`, by running `truffle compile` or `yarn build:contracts`. Then, typescript
typings are generated using `typechain` for type-safe development of tests and
applications (`yarn build:types`). Finally, the test and applications, written
in typescript, are transpiled to javascript (`yarn build:js`). All three build
steps can also be invoked at once with `yarn build`.

### Deployment
First start a local [Ganache](https://truffleframework.com/docs/ganache/overview)
blockchain and then issue `truffle migrate`. This deploys truffle's
`Migration` contract as well as one instance of our contracts.

### Testing
All tests are written in typescript. The runnable javascript tests are generated
as part of `yarn build`. After this step, tests are run by `yarn test` or
directly `truffle test`.


_Copyright (C) 2019 Sebastian Stammler, Marius van der Wijden / MIT license (see LICENSE file)_
