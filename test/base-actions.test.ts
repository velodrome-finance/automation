import { TestPeriodicEvent, TestRuntime } from '@tenderly/actions-test';
import { baseKeeperFn } from '../web3-actions/base-automation';
import { JsonRpcProvider } from "@ethersproject/providers";

describe("Tenderly Automation Test", function () {

  before(async function () {});

  it("Test Base Tenderly Flow", async () => {
    const testRuntime = new TestRuntime();
    const provider = new JsonRpcProvider(
      process.env.TENDERLY_BASE_FORK
    );
    const CHECKPOINT = "b2109ae3-3b71-4058-8371-1af6218e0c79";
    await provider.send("evm_revert", [CHECKPOINT]);

    // setting test environment
    let relaysToTest = [
      {
        address: '0x788D2c0813Cac59770CDF36f7BEb9bFC819B6475',
        factory: '0x825223F246C98A0BA2b05a90701C9Db5810831f2',
        isAutoCompounder: true,
        targetToken: '0x940181a94A35A4569E4529A3CDfB74e38FD98631'
      },
      {
        address: '0x70Ec93EF92bdE5AA7AFFf6546207bD378A28933C',
        factory: '0x1c4a5522E293d15168a19baC5319448f58F3dfBA',
        isAutoCompounder: false,
        targetToken: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
      },
      {
        address: '0x794d1ae064A5d2803cBA821b7429d95cCeCcf1Ea',
        factory: '0x1c4a5522E293d15168a19baC5319448f58F3dfBA',
        isAutoCompounder: false,
        targetToken: '0x940181a94A35A4569E4529A3CDfB74e38FD98631'
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
      await testRuntime.execute(baseKeeperFn, new TestPeriodicEvent());
      relays = await testRuntime.context.storage.getJson('relays');
      keeperLastRun = await testRuntime.context.storage.getBigInt('keeperLastRun');
      console.log("This is the storage fetched after Execution Number %d:", count++);
      console.log(relays);
      console.log(keeperLastRun);
    }

    await provider.send("evm_revert", [CHECKPOINT]);
  });
});
