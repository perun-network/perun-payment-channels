#!/usr/bin/env node
const Conf = require('conf');
const chalk = require('chalk');
const fs = require('fs');
const ethers = require('ethers')
const utils = ethers.utils;
const client = require('./client');
let sleep = require('util').promisify(setTimeout);

const CONTRACT_PATH = "../build/contracts/LedgerChannels.json";

// globals
let name = ''
let port = 6030;
let listen = "0.0.0.0";

// instances
let config = null;
let wallet = null;
let provider = null;
let contract = null;

// states
let openChannels = null;


// CONFIGURATION
// load Ganache-generated ABI
const abi = JSON.parse(fs.readFileSync(CONTRACT_PATH)).abi;

// command line arguments
const argv = require('yargs')
  .option('name', {
    description: 'name of this client',
  })
  .option('listen', {
    alias: 'l',
    description: 'address to listen on',
  })
  .option('port', {
    alias: 'p',
    description: 'port to listen on',
  })
  .option('sk', {
    description: 'secret key of account',
  })
  .option('network', {
    description: 'ethereum network to connect to (don\'t use custom url)',
  })
  .option('url', {
    alias: 'u',
    description: 'url of eth-node/Ganache (don\'t use network)',
  })
  .option('contract', {
    alias: 'c',
    description: 'contract address or "deploy" to deploy the contract',
  })
  .option('test', {
    description: 'test channel protocol with given peer in format <peer,url>',
  })
  .argv;


// MAIN PROGRAM
async function main() {
  await init();

  client.setup(contract, wallet, name);
  client.listen(listen, port);

  // testing
  if (argv.test) {
    let [peer, url] = argv.test.split(',')
    await runTest(peer, url);
  }
}

async function runTest(peer, url) {
  await client.connect(peer, url);

  let bal = utils.parseEther('0.1');
  client.proposeChannel(peer, {
    nonce: utils.bigNumberify(utils.randomBytes(32)),
    timeoutDur: 60, // in sec = 1 min
    parts: [wallet.address, null],
    bals: [bal, bal],
  });

  await sleep(6000); // wait for channel funding

  // send 10 off-chain TXs
  for (let i = 0; i < 10; i++) {
    client.proposeTransfer(peer, utils.parseEther('0.001'));
    await sleep(100); // pause between transfers as above call is not synchronous
  }
}

// init initializes the client by reading command line arguments and possibly
// the persisted configurtion.
// command line arguments take precedence over configuration.
async function init() {
  let globalConfig = new Conf();
  // name
  if (argv.name) {
    globalConfig.set('lastUsedName', argv.name);
  }
  if (globalConfig.has('lastUsedName')) {
    name = globalConfig.get('lastUsedName');
  } else {
    fail("Set a name.")
  }

  // We have different configurations per name so we can run several instances
  // of the client on the same machine.
  config = new Conf({ configName: "config_" + name })

  // listen address
  if (argv.listen) {
    config.set('listen', argv.listen);
    listen = argv.listen;
  } else {
    listen = config.get('listen', '0.0.0.0');
  }

  // listen port
  if (argv.port) {
    config.set('port', argv.port);
    port = argv.port;
  } else {
    port = config.get('port', 6030);
  }

  // wallet
  if (argv.sk) {
    config.set('sk', argv.sk);
  }
  if (config.has('sk')) {
    var sk = config.get('sk');
    wallet = new ethers.Wallet(sk);
  } else {
    // generate new secret key
    wallet = ethers.Wallet.createRandom();
    config.set('sk', wallet.privateKey);
  }

  // provider
  if (argv.network && argv.url) {
    fail("Specify either a network or url, not both.");
  }

  // provider by url
  if (argv.url) {
    config.set('url', argv.url);
    config.delete('network');
  }
  if (config.has('url')) {
    var url = config.get('url');
    provider = new ethers.providers.JsonRpcProvider(url);
  } else {
    config.set('network', 'rinkeby')
  }

  // provider by network
  if (argv.network) {
    config.set('network', argv.network);
    config.delete('url');
  }
  if (config.has('network')) {
    var network = config.get('network');
    provider = ethers.getDefaultProvider(network);
  }

  // finally connect wallet to provider
  wallet = wallet.connect(provider);

  console.log(
    "Name: " + name + "\n"
    + "Configuration path: " + config.path + "\n"
    + "Listening on: " + listen + ":" + port + "\n"
    + "Address: " + wallet.address
    //+ "Secret Key: " + wallet.privateKey + "\n"
  );
  if (config.has('network')) {
    console.log("Connecting to network: " + config.get('network'));
  } else {
    console.log("Connecting to url: " + config.get('url'));
  }

  // Print balance
  let balance = await wallet.getBalance();
  console.log("Balance (ETH): " + utils.formatEther(balance));

  // contract
  let addr;
  if (argv.contract) {
    if (argv.contract === 'deploy') {
      console.log("Deploying contract...");
      let bytecode = JSON.parse(fs.readFileSync(CONTRACT_PATH)).bytecode;
      let deployer = new ethers.ContractFactory(abi, bytecode, wallet);
      contract = await deployer.deploy();
      addr = contract.address;
    } else {
      addr = argv.contract;
    }
    config.set('contract', addr);
  }
  if (config.has('contract')) {
    addr = config.get('contract');
    // set contract if we didn't deploy it
    if (!contract) {
      contract = new ethers.Contract(addr, abi, wallet);
    }
  } else {
    fail('Contract address unknown, set one or set to "deploy" to deploy.')
  }

  console.log("Contract: " + config.get('contract'));
}

function fail(msg) {
  console.error(chalk.red(msg));
  process.exit(1);
}


main()
