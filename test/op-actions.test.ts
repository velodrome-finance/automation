import { TestPeriodicEvent, TestRuntime } from '@tenderly/actions-test';
import { optimisticKeeperFn } from '../web3-actions/optimism-automation';
import { JsonRpcProvider } from "@ethersproject/providers";

describe("Tenderly Automation Test", function () {

  before(async function () {});

  it("Test Optimism Tenderly Flow", async () => {
    const testRuntime = new TestRuntime();
    const provider = new JsonRpcProvider(
      process.env.TENDERLY_OP_FORK
    );
    // reverts fork to initial state
    const CHECKPOINT = "61ad5e2f-8507-4219-a5ef-25114fd87f27";
    await provider.send("evm_revert", [CHECKPOINT]);

    // setting test environment
    let relaysToTest = [
      {
        address: '0xE5F3613c803b959E6983B48a6c75bb9527f0f19B',
        factory: '0x103935f12063c1AbCe28Aa322EFE9eA9bc63ca71',
        isAutoCompounder: true,
        targetToken: '0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db'
      },
      {
        address: '0x2cfFffa6b305104692d2B06CCF178ee28fe9DaA4',
        factory: '0x87E658fa1C67014826A69EFdccDfEFFf19E34B30',
        isAutoCompounder: false,
        targetToken: '0x7F5c764cBc14f9669B88837ca1490cCa17c31607'
      }
    ]
    await testRuntime.context.storage.putJson('relays', relaysToTest);

    let relays = await testRuntime.context.storage.getJson('relays');
    let keeperLastRun = await testRuntime.context.storage.getBigInt('keeperLastRun');
    console.log("This is the storage fetched before any Execution:");
    console.log(relays);
    console.log(keeperLastRun);

    testRuntime.context.secrets.put('PRIVATE_KEY', process.env.PRIVATE_KEY ?? '');
    let count = 1;
    while (!keeperLastRun) {
      await testRuntime.execute(optimisticKeeperFn, new TestPeriodicEvent());
      relays = await testRuntime.context.storage.getJson('relays');
      keeperLastRun = await testRuntime.context.storage.getBigInt('keeperLastRun');
      console.log("This is the storage fetched after Execution Number %d:", count++);
      console.log(relays);
      console.log(keeperLastRun);
    }

    // reverts fork to initial state
    await provider.send("evm_revert", [CHECKPOINT]);
  });
});
