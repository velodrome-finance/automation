import { TestPeriodicEvent, TestRuntime, TestBlockEvent } from '@tenderly/actions-test';
import { optimisticKeeperFn } from '../web3-actions/optimism-automation';

describe("Tenderly Automation Test", function () {

  before(async function () {});

  it("Test Tenderly Flow", async () => {
    const testRuntime = new TestRuntime();

    testRuntime.context.secrets.put('PRIVATE_KEY', process.env.PRIVATE_KEY ?? '');

    let relays = await testRuntime.context.storage.getJson('relays');
    let keeperLastRun = await testRuntime.context.storage.getBigInt('keeperLastRun');
    console.log("THIS IS THE STORAGE FETCHED BEFORE ANY EXECUTION");
    console.log(relays);
    console.log(keeperLastRun);

    let count = 1;
    while (!keeperLastRun) {
      await testRuntime.execute(optimisticKeeperFn, new TestBlockEvent());
      relays = await testRuntime.context.storage.getJson('relays');
      keeperLastRun = await testRuntime.context.storage.getBigInt('keeperLastRun');
      console.log("THESE ARE THE RELAYS FETCHED AFTER EXECUTION NUMBER %d:", count++);
      console.log(relays);
      console.log(keeperLastRun);
    }
  });
});
