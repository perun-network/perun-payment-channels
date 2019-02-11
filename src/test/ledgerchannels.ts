import { assert, expect, should } from "chai";
should();
const truffleAssert = require('truffle-assertions');
import { LedgerChannelsContract, LedgerChannelsInstance } from "../../types/truffle-contracts";
import { BN } from "web3-utils";
import { toBN, keccak, ether, addr, advanceBlockTime,
  snapshot, currentTimestamp, ChannelUpdate } from "./lib";

const LedgerChannels = artifacts.require<LedgerChannelsContract>("LedgerChannels");

contract("LedgerChannels", async (accounts) => {
  let lc: LedgerChannelsInstance;
  let idSeed = toBN(0xdeadbeef);
  let id: BN;
  let balance = {A: ether(10), B: ether(20)};
  const timeout = 60;

  describe("Opening...", () => {
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
  })

  snapshot("Opening; close timed-out opening", () => {
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
  }) /* snapshot Opening */

  let chanUpdates = new Map<string, ChannelUpdate>();

  async function assertCloseFail(closeFn: any, chanUpdateId: string, msg?: string) {
    let u = chanUpdates.get(chanUpdateId) as ChannelUpdate;
    u.should.not.be.undefined;
    return truffleAssert.reverts(
      closeFn(u.id, u.version, u.balanceA, u.balanceB,
        web3.utils.hexToBytes(u.sigA!), web3.utils.hexToBytes(u.sigB!)),
      msg);
  }

  async function assertCloseEvent(closeFn: any, passUpdate: boolean, event: string,
    sender: string, closer: string, confirmer: string, chanUpdateId: string):
    Promise<Truffle.TransactionResponse>
  {
    let closeTx: Truffle.TransactionResponse;
    let u = chanUpdates.get(chanUpdateId) as ChannelUpdate;
    u.should.not.be.undefined;
    if (passUpdate) {
      closeTx = await closeFn(u.id, u.version, u.balanceA, u.balanceB,
          web3.utils.hexToBytes(u.sigA!), web3.utils.hexToBytes(u.sigB!), {from: sender});
    } else {
      closeTx = await closeFn(id, {from: sender});
    }

    truffleAssert.eventEmitted(closeTx, event,
      (ev: any) => { return ev.id.eq(id)
          && ev.closer == closer && ev.confirmer == confirmer
          && ev.finalBalanceA.eq(u.balanceA) && ev.finalBalanceB.eq(u.balanceB);
      }
    );

    return closeTx;
  }

  function assertHasWithdrawalEvent(tx: Truffle.TransactionResponse, id: BN, by: string, balance: BN) {
    truffleAssert.eventEmitted(tx, 'Withdrawal', (ev: any) => {
      return ev.id.eq(id) && ev.by == by && ev.balance.eq(balance);
    });
  }

  describe("Open...", () => {
    it("should confirm a channel between accounts[0] and [1]", async () => {
      //truffleAssert.eventEmitted(
        //await lc.open(idSeed, timeout, accounts[1], balance.B, {value: balance.A}),
        //'Opening'
      //);
      truffleAssert.eventEmitted(
        await lc.confirmOpen(id, {value: balance.B, from: accounts[1]}), 'Open',
        (ev: any) => { return ev.id.eq(id)
            && ev.initiator === accounts[0] && ev.confirmer === accounts[1]
            && ev.balanceA.eq(balance.A) && ev.balanceB.eq(balance.B);
        }
      );
    });

    it("generating state updates...", async () => {
      let update = new ChannelUpdate(id, toBN(0), balance.A, balance.B);
      chanUpdates.set('0', update.clone());

      update.transfer(ether(1)).should.be.true; // A: 9, B: 21
      update.incVersion();
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
  });

  snapshot("Open; initial balance closing", () => {
    it("should request initial balance closing", async () => {
      return assertCloseEvent(lc.closeInitialBalance, false, "Closing",
        accounts[0], accounts[0], accounts[1], '0');
    });

    it("should have [1] confirm initial balance closing", async () => {
      let confirmCloseTx = await assertCloseEvent(lc.confirmClose, false, "Closed",
        accounts[1], accounts[0], accounts[1], '0');
      assertHasWithdrawalEvent(confirmCloseTx, id, accounts[1], balance.B);
    });

    it("should have [0] withdraw their channel balance", async () => {
      assertHasWithdrawalEvent(await lc.withdraw(id), id, accounts[0], balance.A);
    })
  });

  describe("Closing...", () => {
    it("should fail to request channel closing due to wrong signatures and balance", async () => {
      await assertCloseFail(lc.close, '1_wrongSigA', "Signature verification of channel update failed for A.");
      await assertCloseFail(lc.close, '1_wrongSigB', "Signature verification of channel update failed for B.");
      return assertCloseFail(lc.close, '2_moneyPrinted', "Update total balance greater than current balance.");
    });

    it("should request channel closing by [0] with version 1", async () => {
      return assertCloseEvent(lc.close, true, "Closing", accounts[0], accounts[0], accounts[1], '1');
    });
  });

  snapshot("Closing; timeout close", () => {
    it("should advance the blocktime by ~70 seconds", async () => {
      let timestamp0 = await currentTimestamp();
      await advanceBlockTime(timeout + 10)
      let timestamp1 = await currentTimestamp();
      // allow for up to 10 seconds to pass in the environment
      expect(timestamp1 - timestamp0).to.be.within(timeout + 10, timeout + 20);
    });

    it("should let the closing initiator close the timed-out channel", async () => {
      let u = chanUpdates.get('1') as ChannelUpdate;
      let tx = await assertCloseEvent(lc.timeoutClose, false, "ClosedTimeout",
        accounts[0], accounts[0], accounts[1], '1');
      assertHasWithdrawalEvent(tx, u.id, accounts[0], u.balanceA);
    });
  });
});

