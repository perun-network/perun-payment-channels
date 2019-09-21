const http = require('http');
const ethers = require('ethers')
const chalk = require('chalk');
const WebSocketServer = require('websocket').server;
const WebSocketClient = require('websocket').client;

const PROTOCOL= 'perun-payment-channel';

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

    setupConn(conn);
  });
}

// open opens a ws connection to the url specified in the proposal and
// immediately sends the channel opening proposal.
function open(proposal) {
  let client = new WebSocketClient();

  client.on('connectFailed', function(error) {
    console.log('Connect Error: ' + error.toString());
  });

  client.on('connect', function(conn) {
    console.log((new Date()) + " WebSocket Client connected.");

    setupConn(conn);

    // we immediately send the opening proposal as client
    conn.sendUTF(JSON.stringify({ 'type': 'proposal', 'data': proposal }));
  })

  client.connect(proposal.url, PROTOCOL, proposal.origin);
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

  conn.on('message', function(message) {
    if (message.type !== 'utf8') {
      console.log(chalk.red("Received bogus binary message."));
      return;
    }

    handleMsg(message.utf8Data, conn);
  });
}

function handleMsg(msg, conn) {
  switch (msg.type) {
    case 'proposal':
      break;
    case 'accept':
      break;
    case 'updateReq':
      break;
    case 'updateRes':
      break;
    case 'close':
      break;
  }
}

module.exports = {
  listen: listen,
  open: open
}
