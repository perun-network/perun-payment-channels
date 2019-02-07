import { assert, expect, should } from "chai";
should();
const truffleAssert = require('truffle-assertions');
import { LedgerChannelsContract, LedgerChannelsInstance } from "../../types/truffle-contracts";
import { toBN, keccak, ether, addr, advanceBlockTime, currentTimestamp } from "./lib";

const LedgerChannels = artifacts.require<LedgerChannelsContract>("LedgerChannels");

contract("LedgerChannels", async (accounts) => {
  let lc: LedgerChannelsInstance;
  let idSeed = toBN(0xdeadbeef);
  let id: BN;
  let balance = {A: ether(1), B: ether(2)};

  it("should deploy the LedgerChannels contract", async () => {
    lc = await LedgerChannels.deployed();
  })

  it("should generate the correct id from the seed", async () => {
    id = await lc.genId(accounts[0], accounts[1], idSeed);
    const expId = toBN(keccak(addr(accounts[0]), addr(accounts[1]), idSeed));
    assert(id.eq(expId), "Generated id doesn't match spec.")
  });

  it("should open a ledger channel request from accounts[0] to [1]", async () => {
    // open new channel with acc[1], timeout of 60 sec, 1 eth
    let openTx = await lc.open(idSeed, accounts[1], 60, {value: balance.A});
    let eventOpening = openTx.logs[0];

    eventOpening.event.should.equal("Opening", "open() didn't fire an Opening event.");
    assert(eventOpening.args.id.eq(id), "Opening id doesn't match.");
    assert(eventOpening.args.balanceA.eq(balance.A), "Opening balance doesn't match.");
    eventOpening.args.should.include(
      {initiator: accounts[0], confirmer: accounts[1]},
      "Opening event parties don't match");
  });

  it("should not let the initiator close the channel", async () => {
    return truffleAssert.reverts(lc.timeoutOpen(id),
      "Confirmation timeout not reached yet.");
  })

  it("should advance the blocktime by ~70 seconds", async () => {
    let timestamp0 = await currentTimestamp();
    await advanceBlockTime(70)
    let timestamp1 = await currentTimestamp();
    // allow for up to 10 seconds to pass in the environment
    expect(timestamp1 - timestamp0).to.be.within(70,80);
  })

  it("should let the initiator close the timed-out channel", async () => {
  });
});

