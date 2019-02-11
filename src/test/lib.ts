/// <reference types="truffle-typings" />

import { promisify } from "util";
import { Mixed } from "web3-utils";

export const toBN = web3.utils.toBN;
export const keccak = web3.utils.soliditySha3;

export function ether(x: number): BN { return web3.utils.toWei(web3.utils.toBN(x), "ether"); }
export function addr(a: string): Mixed { return {type: 'address', value: a}; }

export async function asyncWeb3Send(method: string, params: any[], id?: number): Promise<any> {
  let req: any = { jsonrpc: '2.0', method: method, params: params };
  if (id != undefined) req.id = id;

  return promisify((callback) => {
    (web3.currentProvider as any).send(req, callback)
  })();
}

export async function advanceBlockTime(time: number): Promise<any> {
  await asyncWeb3Send('evm_increaseTime', [time]);
  return asyncWeb3Send('evm_mine', []);
}

export async function currentTimestamp(): Promise<number> {
  let blocknumber = await web3.eth.getBlockNumber();
  let block = await web3.eth.getBlock(blocknumber);
  return block.timestamp;
}

export function snapshot(name: string, tests: any) {
  describe("Snapshot: " + name, () => {
    let snapshot_id: number;

    before("take snapshot before all tests", async () => {
      snapshot_id = (await asyncWeb3Send('evm_snapshot', [])).result;
    });

    after("restore snapshot after all test", async () => {
      return asyncWeb3Send('evm_revert', [snapshot_id]);
    });

    tests();
  });
}

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

