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

export async function currentTimestamp(): Promise<number> {
  let blocknumber = await web3.eth.getBlockNumber();
  let block = await web3.eth.getBlock(blocknumber);
  return block.timestamp;
}

