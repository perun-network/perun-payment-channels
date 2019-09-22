'use strict';
const ethers = require('ethers');
const utils = ethers.utils;

class Channel {
  constructor(nonce, timeoutDur, parts, bals, idx, signer) {
    this.version = ethers.constants.Zero;
    this.nonce = nonce;
    this.timeoutDur = timeoutDur;
    this.parts = parts;
    this.bals = bals;
    this.idx = idx;
    this.oidx = idx ? 0 : 1;
    this.signer = signer;
    this.sigs = [null, null];
    this.id = genId(parts[0], parts[1], nonce);
  }

  static fromProp(prop, idx, signer) {
    return new Channel(prop.nonce, prop.timeoutDur, prop.parts, prop.bals, idx, signer);
  }

  get state() {
    return {
      id: this.id,
      version: this.version,
      bals: this.bals,
      sigs: this.sigs
    };
  }

  //// OUR UPDATE ////

  // transfer given amount from us to peer.
  // returns state with signature to send to peer.
  async transfer(amount) {
    if (! (amount.gt(ethers.constants.Zero)
      && amount.lte(this.bals[this.idx])) ) {
      return null;
    }

    this.nextState = {
      id: id,
      version: this.version.add(ethers.constants.One),
      bals: [bals[this.idx].sub(amount), bals[this.oidx].add(amount)],
    }

    let sigs = [null, null];
    sigs[this.idx] = await signState(this.signer, this.nextState);
    this.nextState.sigs = sigs;

    return this.nextState;
  }

  // enableTransfer makes nextState the current state and sets the provided peer
  // signature.
  // returns false if signature is not valid.
  enableTransfer(sig) {
    if (!verifyStateSig(sig, this.parts[this.oidx], this.nextState)) {
      console.log("Peer sent invalid signature to our transfer.")
      return false;
    }

    this.version = this.nextState.version;
    this.bals = this.nextState.bals;
    this.sigs = this.nextState.sigs; // already includes our signature
    this.sigs[this.oidx] = sig;

    return true;
  }

  //// PEER UPDATE ////

  // peerTransfer sets update from peer.
  // returns own signature if valid update, or null.
  async peerTransfer(sig, state) {
    if (!verifyPeerUpdate(sig, state)) {
      return null;
    }

    this.version = state.version;
    this.bals = state.bals;
    this.sigs[this.oidx] = sig;

    return this.sign();
  }

  async sign() {
    // only calculate sig once per update
    if (!this.sigs[this.idx]) {
      let sig = await signState(this.signer, this.state);
      this.sigs[this.idx] = sig;
    }
    return this.sigs[this.idx];
  }

  verifyPeerUpdate(sig, state) {
    if (this.verifyStateSig(sig, this.parts[this.oidx], state)) {
      console.log("Peer sent invalid signature with their update.");
      return false;
    }

    if (!this.version.add(ethers.constants.One).eq(state.version)) {
      console.log("Version counter not increased by one.");
    }

    // states are send as uint hex's, so we don't need to check negatives
    if (!equalBals(this.bals, state.bals)) {
      console.log("Update does not preserve the sum of balances.");
      return false;
    }

    if (this.bals[this.idx].lte(state.bals[this.idx])) {
      console.log("Peer update decreases our balance.");
      return false;
    }

    return true;
  }
}

function genId(addrA, addrB, seed) {
  return utils.solidityKeccak256(
    ['address', 'address', 'uint256'],
    [addrA, addrB, seed]
  );
}

async function signState(signer, state) {
  return signer.signMessage(utils.arrayify( packState(state) ));
}

function verifyStateSig(sig, addr, state) {
  return (addr === utils.verifyMessage(utils.arrayify(packState(state)), sig));
}

function packState(s) {
  return utils.solidityKeccak256(
    ['uint256', 'uint256', 'uint256', 'uint256'],
    [s.id, s.version, s.bals[0], s.bals[1]]
  );
}

function equalBals(x, y) {
  return x[0].add(x[1]).eq(y[0].add(y[1]));
}

module.exports.Channel = Channel;
