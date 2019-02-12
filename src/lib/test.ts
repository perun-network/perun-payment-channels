/// <reference types="truffle-typings" />

import { asyncWeb3Send } from "./web3";

export async function advanceBlockTime(time: number): Promise<any> {
  await asyncWeb3Send('evm_increaseTime', [time]);
  return asyncWeb3Send('evm_mine', []);
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

