/// <reference types="truffle-typings" />

import { Mixed } from "web3/utils";

export const toBN = web3.utils.toBN;
export const keccak = web3.utils.soliditySha3;

export function ether(x: number): BN { return web3.utils.toWei(web3.utils.toBN(x), "ether"); }
export function addr(a: string): Mixed { return {type: 'address', value: a}; }
