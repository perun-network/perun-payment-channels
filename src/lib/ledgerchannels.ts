/// <reference types="truffle-typings" />

import { toBN, keccak } from "./web3";

export namespace State {
  export const Null = toBN(0);
  export const Opening = toBN(1);
  export const Open = toBN(2);
  export const ClosingByA = toBN(3);
  export const ClosingByB = toBN(4);
  export const Closed = toBN(5);
  export const Withdrawn = toBN(6);
};

export class ChannelUpdate {
  id: BN;
  version: BN;
  balanceA: BN;
  balanceB: BN;
  sigA?: string;
  sigB?: string;

  constructor(id: BN, version: BN, balanceA: BN, balanceB: BN) {
    this.id = id;
    this.version = version;
    this.balanceA = balanceA;
    this.balanceB = balanceB;
  }

  public clone(): ChannelUpdate {
    let cu = new ChannelUpdate(this.id.clone() as BN, this.version.clone() as BN,
      this.balanceA.clone() as BN, this.balanceB.clone() as BN);
    cu.sigA = this.sigA;
    cu.sigB = this.sigB;
    return cu;
  }

  public async sign(A: string, B: string) {
    let message = keccak(this.id, this.version, this.balanceA, this.balanceB);
    this.sigA = await web3.eth.sign(message, A);
    this.sigB = await web3.eth.sign(message, B);
  }

  /**
   * @description transfer given amount from A to B. A negative amount is a
   * transfer from B to A
   * @param amount to transfer from A to B
   * @return valid whether the transfer would be valid, e.g., not causing any
   *   negative balace
   */
  public transfer(amount: BN): boolean {
    let valid = ((!amount.isNeg() && amount.lte(this.balanceA))
      || (amount.isNeg()  && amount.neg().lte(this.balanceB)));
    this.balanceA = this.balanceA.sub(amount) as BN;
    this.balanceB = this.balanceB.add(amount) as BN;
    return valid;
  }

  public incVersion() {
    this.version = this.version.add(toBN(1)) as BN;
  }
}

