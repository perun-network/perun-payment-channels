# Perun Payment Channels Client
## Setup
0. If you have not already installed yarn, install it via your OS's package
   manager, follow https://yarnpkg.com/en/docs/install or, as a last resort, do
   `npm i --global yarn`
1. `git clone https://github.com/perun-network/perun-payment-channels.git ppc`
2. `cd ppc/client`
3. `yarn`
If you already have a funded account on the ropsten testnet, get its private
key and run the client once with
 ```
 ./pcc.js --cli --name <you> --sk <ropsten-key> --network ropsten --contract 0x5E479c0E53d6512432d379fb22EA2CeF39f6752b
 ```
Otherwise run the same command without the `--sk` option. The client will create
a secret key for you and show the address that you need to fund.

After the client ran once, all configuration parameters are saved and don't need
to be specified again. You can now just run the CLI with `./pcc.js --cli`.


## Tasks
1. In setupConn(), watch for Closing events caused by peer
2. Try to cheat the other party by first sending them coins and then closing the
   channel with a prior state.
3. turn proposeTransfer into an async function that returns a Promise that
   resolves when the signature by the peer was received.
4. In handleProp(), check that the proposer sent the funds he promised by reading
   out the event variables.
