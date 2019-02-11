import { assert, expect, should } from "chai";
should();
const truffleAssert = require('truffle-assertions');
import { LedgerChannelsContract, LedgerChannelsInstance } from "../../types/truffle-contracts";
import { BN } from "web3-utils";
import { toBN, keccak, ether, addr, advanceBlockTime, currentTimestamp, ChannelUpdate } from "./lib";

const LedgerChannels = artifacts.require<LedgerChannelsContract>("LedgerChannels");

contract("LedgerChannels", async (accounts) => {
  let lc: LedgerChannelsInstance;
  let idSeed = toBN(0xdeadbeef);
  let id: BN;
  let balance = {A: ether(10), B: ether(20)};
  const timeout = 60;

  it("should deploy the LedgerChannels contract", async () => {
    lc = await LedgerChannels.deployed();
  });

  it("should generate the correct id from the seed", async () => {
    id = await lc.genId(accounts[0], accounts[1], idSeed);
    const expId = toBN(keccak(addr(accounts[0]), addr(accounts[1]), idSeed));
    assert(id.eq(expId), "Generated id doesn't match spec.")
  });

  it("should open a ledger channel request from accounts[0] to [1]", async () => {
    // open new channel with acc[1], timeout of 60 sec, 1 eth
    let openTx = await lc.open(idSeed, timeout, accounts[1], balance.B, {value: balance.A});
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
  });

  it("should not let accounts[2] confirm the channel", async () => {
    return truffleAssert.reverts(
      lc.confirmOpen(id, {value: balance.B, from: accounts[2]}),
      "Caller is not the confirmer of this channel.");
  });

  it("should advance the blocktime by ~70 seconds", async () => {
    let timestamp0 = await currentTimestamp();
    await advanceBlockTime(timeout + 10)
    let timestamp1 = await currentTimestamp();
    // allow for up to 10 seconds to pass in the environment
    expect(timestamp1 - timestamp0).to.be.within(timeout + 10, timeout + 20);
  });

  it("should let the initiator close the timed-out channel", async () => {
    let timeoutOpenTx = await lc.timeoutOpen(id);
    truffleAssert.eventEmitted(timeoutOpenTx, 'OpenTimeout', (ev: any) => {
      return ev.id.eq(id) && ev.initiator === accounts[0]
        && ev.confirmer === accounts[1] && ev.balanceA.eq(balance.A);
    });
    truffleAssert.eventEmitted(timeoutOpenTx, 'Withdrawal', (ev: any) => {
      return ev.id.eq(id) && ev.by === accounts[0] && ev.balance.eq(balance.A);
    });
  });

  it("should open and confirm a channel between accounts[0] and [1]", async () => {
    truffleAssert.eventEmitted(
      await lc.open(idSeed, timeout, accounts[1], balance.B, {value: balance.A}),
      'Opening'
    );
    truffleAssert.eventEmitted(
      await lc.confirmOpen(id, {value: balance.B, from: accounts[1]}), 'Open',
      (ev: any) => { return ev.id.eq(id)
          && ev.initiator === accounts[0] && ev.confirmer === accounts[1]
          && ev.balanceA.eq(balance.A) && ev.balanceB.eq(balance.B);
      }
    );
  });

  let chanUpdates = new Map<string, ChannelUpdate>();

  it("generating state updates...", async () => {
    let update = new ChannelUpdate(id, toBN(1), balance.A, balance.B);
    update.transfer(ether(1)).should.be.true; // A: 9, B: 21
    await update.sign(accounts[0], accounts[1]);
    chanUpdates.set('1', update.clone());

    await update.sign(accounts[2], accounts[1]);
    chanUpdates.set('1_wrongSigA', update.clone());

    await update.sign(accounts[0], accounts[3]);
    chanUpdates.set('1_wrongSigB', update.clone());

    update.transfer(ether(-3)).should.be.true; // A: 12, B: 18
    update.incVersion();
    await update.sign(accounts[0], accounts[1]);
    chanUpdates.set('2', update.clone());

    update.balanceA = ether(13);
    update.balanceB = ether(19);
    await update.sign(accounts[0], accounts[1]);
    chanUpdates.set('2_moneyPrinted', update.clone());
  });

  async function assertCloseFail(closeFn: any, chanUpdateId: string, msg?: string) {
    let u = chanUpdates.get(chanUpdateId) as ChannelUpdate;
    u.should.not.be.undefined;
    return truffleAssert.reverts(
      closeFn(u.id, u.version, u.balanceA, u.balanceB,
        web3.utils.hexToBytes(u.sigA!), web3.utils.hexToBytes(u.sigB!)),
      msg);
  }

  async function assertCloseEvent(closeFn: any, chanUpdateId: string, event: string,
    sender: string, closer: string, confirmer: string):
    Promise<Truffle.TransactionResponse>
  {
    let u = chanUpdates.get(chanUpdateId) as ChannelUpdate;
    u.should.not.be.undefined;
    let closeTx = await closeFn(u.id, u.version, u.balanceA, u.balanceB,
        web3.utils.hexToBytes(u.sigA!), web3.utils.hexToBytes(u.sigB!), {from: sender});

    truffleAssert.eventEmitted(closeTx, event,
      (ev: any) => { return ev.id.eq(id)
          && ev.closer == closer && ev.confirmer == confirmer
          && ev.finalBalanceA.eq(u.balanceA) && ev.finalBalanceB.eq(u.balanceB);
      }
    );

    return closeTx;
  }

  it("should fail to request channel closing due to wrong signatures and balance", async () => {
    await assertCloseFail(lc.close, '1_wrongSigA', "Signature verification of channel update failed for A.");
    await assertCloseFail(lc.close, '1_wrongSigB', "Signature verification of channel update failed for B.");
    return assertCloseFail(lc.close, '2_moneyPrinted', "Update total balance greater than current balance.");
  });

  it("should request channel closing by 0 with version 1", async () => {
    return assertCloseEvent(lc.close, '1', "Closing", accounts[0], accounts[0], accounts[1])
  });
});

