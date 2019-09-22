const http = require('http');
const ethers = require('ethers')
const utils = ethers.utils;
const chalk = require('chalk');
const WebSocketServer = require('websocket').server;
const WebSocketClient = require('websocket').client;

const Channel = require('./channel').Channel;
const PROTOCOL= 'perun-payment-channel';

// contract session - has to be injected with setup()
let contract = null;
let wallet = null; // inject with setup()
let name = '';

// conns - map from peer names to connections
let conns = {};
// props - map from peer names to proposals
let props = {};
// chans - map from ids to channels
let chans = {};

// client dependency injector
function setup(_contract, _wallet, _name) {
  contract = _contract;
  wallet = _wallet;
  name = _name;
}

function listen(host, port) {
  let server = http.createServer(function(request, response) {
    console.log((new Date()) + ' Received request for ' + request.url);
    response.writeHead(404);
    response.end();
  });
  server.listen(port, host, function() {
    console.log((new Date()) + ' Server is listening on ' + host+':'+port);
  });

  wsServer = new WebSocketServer({
    httpServer: server,
    autoAcceptConnections: false
  });

  wsServer.on('request', function(request) {
    let conn = request.accept(PROTOCOL, request.origin);
    console.log((new Date()) + ' Connection accepted from ' + request.origin);

    conns[request.origin] = conn;
    setupConn(conn);
  });
}

// connect opens a ws connection to the given url and saves it under the
// specified peer identifier
function connect(peer, url) {
  // TODO: check if connection to peer already present.
  let client = new WebSocketClient();

  client.on('connectFailed', function(error) {
    console.log('Connect Error: ' + error.toString());
  });

  client.on('connect', function(conn) {
    console.log((new Date()) + " WebSocket Client connected.");

    conns[peer] = conn;
    setupConn(conn);
  })

  client.connect(url, PROTOCOL, name);
}

// proposeChannel sends a channel proposal on the specified connection
async function proposeChannel(peer, proposal) {
  console.log("Proposing\n" + JSON.stringify(proposal));
  let conn = conns[peer];
  if (!conn) {
    console.log("I don't have a connection to peer: " + peer);
    return;
  }

  let bal = await wallet.getBalance();
  // Proposer always has index 0, accepter index 1
  if (bal.lt(proposal.bals[0])) {
    console.log("Insufficient funds for own proposal " + proposal);
    return;
  }

  props[peer] = proposal;
  conn.sendUTF(JSON.stringify({ 'type': 'proposal', 'data': proposal }));
}

// common connection handling for client and server
function setupConn(conn) {
  conn.on('error', function(err) {
    console.error("Connection error: " + error.toString());
  });

  conn.on('close', function(reasonCode, description) {
    console.log((new Date()) + ' Peer ' + conn.remoteAddress + ' disconnected.\n'
      + '['+reasonCode+'] ' + description);
  });

  conn.on('message', async function(message) {
    if (message.type !== 'utf8') {
      warn("Received bogus binary message.");
      return;
    }

    return handleMsg(conn, JSON.parse(message.utf8Data));
  });
}

async function handleMsg(conn, msg) {
  console.log("Received message:");
  console.log(msg);
  switch (msg.type) {
    case 'proposal':
      return handleProp(conn, msg.data);
    case 'accept':
      return handleAccept(conn, msg.data);
    case 'updateReq':
      break;
    case 'updateRes':
      break;
    case 'close':
      break;
  }
}

async function handleProp(conn, prop) {
  ethifyProposal(prop);
  // check that we have enough eth in our account
  let bal = await wallet.getBalance();
  // Proposer always has index 0, accepter index 1
  if (bal.lt(prop.bals[1])) {
    console.log("Insufficient funds for peer prop " + prop);
    return
  }
  // complete proposal - our address is missing so far
  prop.parts[1] = wallet.address;
  // we accept all proposals in this demo...
  conn.sendUTF(JSON.stringify({ 'type': 'accept', 'data': prop }));

  // setup local channel instance
  // We are accepter -> idx 1
  let chan = Channel.fromProp(prop, 1, wallet);
  chans[chan.id] = chan;

  // wait for Opening event caused by proposer
  // The channel id doesn't commit to the balances, so we filter that one too.
  let eventOpening = contract.filters.Opening(chan.id);
  contract.once(eventOpening, async () => {
    // TODO: check that proposer sent the funds he promised...
    console.log("[Opening] Proposer funded channel, funding...");
    let tx = await contract.confirmOpen(
      chan.id,
      { value: chan.bals[1] }
    );

    console.log("confirmOpen called.");
    await tx.wait();
    console.log("confirmOpen tx mined. Channel is open! 🎉");
  });
}

async function handleAccept(conn, prop) {
  // TODO: check that proposal matches the one we sent!
  ethifyProposal(prop);

  // setup local channel instance
  // We are proposer -> idx 0
  let chan = Channel.fromProp(prop, 0, wallet);
  chans[chan.id] = chan;

  // Proposer (we) receives accept -> counterParty has idx 1
  let tx = await contract.open(
    chan.nonce,
    chan.timeoutDur,
    chan.parts[1],
    chan.bals[1],
    { value: chan.bals[0] }
  )
  console.log("open called.");
  //console.log(tx);

  // wait for tx to be mined.
  await tx.wait();
  console.log("open tx mined. Wait for Open event caused by funding from peer.");

  let eventOpen = contract.filters.Open(chan.id);
  contract.once(eventOpen, () => {
    console.log("[Open] Peer funded channel, it is open! 🎉")
    // TODO: set state of channel to funded - currently we don't track state
  });
}

// JSON unmarshaler for proposals send over the wire
function ethifyProposal(proposal) {
  proposal.nonce = utils.bigNumberify(proposal.nonce);
  proposal.bals = proposal.bals.map(x => utils.bigNumberify(x));
  proposal.parts = proposal.parts.map(x => x ? utils.getAddress(x) : null);
}

function warn(msg) {
  console.error(chalk.red(msg));
}

module.exports = {
  setup: setup,
  listen: listen,
  connect: connect,
  proposeChannel: proposeChannel
}
