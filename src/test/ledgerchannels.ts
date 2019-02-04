import { assert, expect } from "chai";
import { LedgerChannelsContract } from "../../types/truffle-contracts";

const LedgerChannels = artifacts.require<LedgerChannelsContract>("LedgerChannels");

function ether(x: number): BN { return web3.utils.toWei(web3.utils.toBN(x), "ether"); }

contract("LedgerChannels", async (accounts) => {
  it("should open a ledger channel request from accounts[0] to [1]", async () => {
    let lc = await LedgerChannels.deployed();
    // open new channel with acc[1], timeout of 60 sec, 1 eth
    let openTx = await lc.open(accounts[1], 60, {value: ether(1)});
  })
})

