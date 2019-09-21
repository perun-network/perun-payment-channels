#!/usr/bin/env node
const Conf = require('conf');
const chalk = require('chalk');
const fs = require('fs');
const ethers = require('ethers')

const client = require('./client');

// globals
let name = ""
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
const abi = JSON.parse(fs.readFileSync("../build/contracts/LedgerChannels.json")).abi;

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
    description: 'contract address',
  })
  .argv;


// MAIN PROGRAM
async function main() {
  init();

  // Print balance
  let balance = await wallet.getBalance();
  console.log("Balance (ETH): " + ethers.utils.formatEther(balance));

  // self-test
  client.listen(listen, port);
  client.open({
    'url': 'ws://' + listen + ':' + port,
    'origin': name
  });
}

// init initializes the client by reading command line arguments and possibly
// the persisted configurtion.
// command line arguments take precedence over configuration.
function init() {
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

  // contract
  if (argv.contract) {
    config.set('contract', argv.contract);
  }
  if (config.has('contract')) {
    var addr = config.get('contract');
    contract = new ethers.Contract(addr, abi, wallet);
  } else {
    fail("Contract address unknown, set one.")
  }

  console.log(
    "Configuration path: " + config.path + "\n"
    + "Name: " + name + "\n"
    + "Listening on: " + listen + ":" + port + "\n"
    + "Address: " + wallet.address + "\n"
    + "Contract: " + config.get('contract')
    //+ "Secret Key: " + wallet.privateKey + "\n"
  );
  if (config.has('network')) {
    console.log("Connected to network: " + config.get('network'));
  } else {
    console.log("Connected to url: " + config.get('url'));
  }

}

function fail(msg) {
  console.error(chalk.red(msg));
  process.exit(1);
}


main()
