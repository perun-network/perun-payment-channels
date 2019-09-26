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
// map from peers to a single channel id
let peerChans = {};

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

    setupConn(request.origin, conn);
  });
}

// connect opens a ws connection to the given url and saves it under the
// specified peer identifier
async function connect(peer, url) {
  // TODO: check if connection to peer already present.
  let client = new WebSocketClient();

  return new Promise((resolve, reject) => {
    client.on('connectFailed', function(error) {
      warn('Connect Error: ' + error.toString());
      reject(error);
    });

    client.on('connect', function(conn) {
      console.log((new Date()) + " WebSocket Client connected.");

      setupConn(peer, conn);
      resolve();
    });

    client.connect(url, PROTOCOL, name);
  });
}

// proposeChannel sends a channel proposal on the specified connection
async function proposeChannel(peer, proposal) {
  let conn = conns[peer];
  if (!conn) {
    warn("I don't have a connection to peer: " + peer);
    return;
  }

  let bal = await wallet.getBalance();
  // Proposer always has index 0, accepter index 1
  if (bal.lt(proposal.bals[0])) {
    warn("Insufficient funds for own proposal:\n");
    console.log(proposal);
    return;
  }

  props[peer] = proposal;
  conn.sendUTF(JSON.stringify({ 'type': 'proposal', 'data': proposal }));
  return new Promise((resolve, reject) => {
    // funded() will be called in handleAccept() so that the promise resolves
    // once the channel is funded from our side.
    proposal.funded = resolve;
    proposal.rejected = reject;
  })
}

// proposes to send an off-chain transaction
async function proposeTransfer(peer, amount) {
  console.log("Proposing to transfer " + utils.formatEther(amount) + " to " + peer);
  let conn = conns[peer];
  if (!conn) {
    warn("No connection to peer: " + peer);
    return;
  }

  let chan = getChan(peer);

  let update = await chan.transfer(amount);
  if (!update) {
    warn("Error preparing transfer of " + utils.formatEther(amount) + " to " + peer);
    return;
  }
  conn.sendUTF(JSON.stringify({ 'type': 'updateReq', 'data': update }));
}

async function closeChannel(peer) {
  console.log("Attempting to close channel with peer: " + peer);
  let chan = getChan(peer);

  let tx;
  if (chan.version === 0) {
    tx = await contract.closeInitialBalance(id);
  } else {
    tx = await contract.close(
      chan.id, chan.version,
      chan.bals[0], chan.bals[1],
      chan.sigs[0], chan.sigs[1]
    );
  }
  console.log("close() called on channel with peer: " + peer);
  return tx.wait();
}

function getChan(peer) {
  let conn = conns[peer];
  if (!conn) {
    throw new Error("No connection to peer: " + peer);
  }

  let id = peerChans[peer];
  if (!id) {
    throw new Error("No channel open for peer: " + peer);
  }

  return chans[id];
}

// common connection handling for client and server
function setupConn(peer, conn) {
  conns[peer] = conn;

  conn.on('error', function(err) {
    warn("Connection error: " + error.toString());
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

    return handleMsg(peer, JSON.parse(message.utf8Data));
  });
}

async function handleMsg(peer, msg) {
  //console.log("Received message:");
  //console.log(msg);
  switch (msg.type) {
    case 'proposal':
      return handleProp(peer, msg.data);
    case 'accept':
      return handleAccept(peer, msg.data);
    case 'updateReq':
      return handleUpdateReq(peer, msg.data);
    case 'updateRes':
      return handleUpdateRes(peer, msg.data);
    case 'close':
      // we currently just watch the chain for Closing events
      break;
  }
}

//// ON-CHAIN HANDLERS ////

async function handleProp(peer, prop) {
  let conn = conns[peer];
  ethifyProposal(prop);

  // check that we have enough eth in our account
  let bal = await wallet.getBalance();
  // Proposer always has index 0, accepter index 1
  if (bal.lt(prop.bals[1])) {
    warn("Insufficient funds for peer prop " + prop);
    return
  }
  // complete proposal - our address is missing so far
  prop.parts[1] = wallet.address;
  // we accept all proposals in this demo...
  conn.sendUTF(JSON.stringify({ 'type': 'accept', 'data': prop }));

  // setup local channel instance
  // We are accepter -> idx 1
  let chan = Channel.fromProp(prop, 1, wallet);
  setupChannel(peer, chan);

  // wait for Opening event caused by proposer
  // The channel id doesn't commit to the balances, so we filter that one too.
  let eventOpening = contract.filters.Opening(chan.id);
  contract.once(eventOpening, async () => {
    // TODO: check that proposer sent the funds he promised...
    console.log("[Opening] Proposer funded channel, funding...");
    let tx;
    try {
      tx = await contract.confirmOpen(
        chan.id,
        { value: chan.bals[1],
          gasLimit: 300000 }
      );
    } catch (e) {
      warn("confirmOpen threw exception.");
      console.log(e);
      return;
    }

    console.log("confirmOpen called.");
    await tx.wait();
    console.log("confirmOpen tx mined. Channel is open! 🎉");
  });
}

async function handleAccept(peer, prop) {
  let conn = conns[peer];
  // TODO: check that proposal matches the one we sent!
  ethifyProposal(prop);

  // setup local channel instance
  // We are proposer -> idx 0
  let chan = Channel.fromProp(prop, 0, wallet);
  setupChannel(peer, chan);

  // Proposer (we) receives accept -> counterParty has idx 1
  let tx = await contract.open(
    chan.nonce,
    chan.timeoutDur,
    chan.parts[1],
    chan.bals[1],
    { value: chan.bals[0] }
  )
  console.log("open called.");

  // wait for tx to be mined.
  await tx.wait();
  console.log("open tx mined. Wait for Open event caused by funding from peer.");

  let eventOpen = contract.filters.Open(chan.id);
  contract.once(eventOpen, () => {
    console.log("[Open] Peer funded channel, it is open! 🎉")
    // TODO: set state of channel to funded - currently we don't track state
    props[peer].funded();
  });
}

// JSON unmarshaler for proposals send over the wire
function ethifyProposal(proposal) {
  proposal.nonce = utils.bigNumberify(proposal.nonce);
  proposal.bals = proposal.bals.map(x => utils.bigNumberify(x));
  proposal.parts = proposal.parts.map(x => x ? utils.getAddress(x) : null);
}

function setupChannel(peer, chan) {
  peerChans[peer] = chan.id;
  chans[chan.id] = chan;

  // watch closing events caused by peer
  let eventClosing = contract.filters.Closing(chan.id, chan.peer);
  contract.once(eventClosing,
    async (_id, _closer, _confirmer, _balA, _balB) => {
      console.log("[Closing] Peer " + peer + " tries to close channel...");
      // I forgot to put the version number in the event, let's compare the
      // balances instead...
      let tx;
      if (!_balA.eq(chan.bals[0])) {
        console.log("Peer tries to cheat us! Calling disputedClose()");
        tx = await contract.disputedClose(
          chan.id, chan.version,
          chan.bals[0], chan.bals[1],
          chan.sigs[0], chan.sigs[1]
        );
      } else {
        console.log("Peer used latest state, all good. Calling confirmClose()");
        tx = await contract.confirmClose(chan.id);
      }
      await tx.wait();
      console.log("Channel with peer " + peer + " closed. 👌");
      // note: disputedClose and confirmOpen both called withdraw() already.
  });

  // TODO: withdraw money on Closed event caused by peer
}

//// OFF-CHAIN TRANSFER HANDLERS ////

// handles incoming update requests, accepting immediately if valid
async function handleUpdateReq(peer, update) {
  let conn = conns[peer];

  ethifyUpdate(update);
  if (update.id !== peerChans[peer]) {
    warn("Received update request for unknown channel " + update.id + " from peer " + peer);
    return;
  }

  let chan = chans[update.id];
  let signedUpdate = await chan.peerTransfer(update);
  if (!signedUpdate) {
    warn("Received invalid update from peer");
    console.log(update);
    return;
  }

  console.log("Received valid update request, state updated! 💸\n" + chan.shortStateStr())
  console.log("Sending update response with signature to peer " + peer);
  conn.sendUTF(JSON.stringify({ 'type': 'updateRes', 'data': signedUpdate }));
}

async function handleUpdateRes(peer, update) {
  let conn = conns[peer];

  ethifyUpdate(update);
  if (update.id !== peerChans[peer]) {
    warn("Received update response for unknown channel " + update.id + " from peer " + peer);
    return;
  }

  let chan = chans[update.id];
  let ok = chan.enableTransfer(update);
  if (ok) {
    console.log("Received valid signature from peer, state updated! 💸\n" + chan.shortStateStr());
  } else {
    warn("Received invalid signature from peer, state not updated!");
  }
}

// JSON unmarshaler for updates send over the wire
function ethifyUpdate(update) {
  // id and sigs are hex strings, so ok
  update.version = utils.bigNumberify(update.version);
  update.bals = update.bals.map(x => utils.bigNumberify(x));
}

function warn(msg) {
  console.error(chalk.red(msg));
}

module.exports = {
  setup: setup,
  listen: listen,
  connect: connect,
  proposeChannel: proposeChannel,
  proposeTransfer: proposeTransfer,
  closeChannel: closeChannel
}
