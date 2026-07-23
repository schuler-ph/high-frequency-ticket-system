import { test } from "node:test";
import assert from "node:assert/strict";

import { waitForDrain } from "../lib/drain.mjs";

/** A fake clock advanced by the fake sleep, so tests never really wait. */
const makeClock = () => {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms) => {
      t += ms;
    },
  };
};

test("waitForDrain completes once pending is zero for stablePolls", async () => {
  const clock = makeClock();
  const baseline = { accepted: 0, completed: 0, failed: 0 };
  // accepted stays 10; completed climbs 4 -> 8 -> 10 -> 10 -> 10.
  const completedSeq = [4, 8, 10, 10, 10];
  let i = 0;
  const result = await waitForDrain({
    baseline,
    fetchCounters: async () => ({
      accepted: 10,
      completed: completedSeq[Math.min(i++, completedSeq.length - 1)],
      failed: 0,
    }),
    sleep: clock.sleep,
    now: clock.now,
    pollIntervalSeconds: 1,
    stablePolls: 3,
    timeoutSeconds: 100,
  });
  assert.equal(result.status, "complete");
  assert.equal(result.pendingAtEnd, 0);
});

test("waitForDrain times out when pending never clears", async () => {
  const clock = makeClock();
  const result = await waitForDrain({
    baseline: { accepted: 0, completed: 0, failed: 0 },
    fetchCounters: async () => ({ accepted: 100, completed: 40, failed: 0 }),
    sleep: clock.sleep,
    now: clock.now,
    pollIntervalSeconds: 1,
    stablePolls: 3,
    timeoutSeconds: 5,
  });
  assert.equal(result.status, "timeout");
  assert.equal(result.pendingAtEnd, 60);
});

test("waitForDrain keeps polling through a transient scrape failure", async () => {
  const clock = makeClock();
  let call = 0;
  const result = await waitForDrain({
    baseline: { accepted: 0, completed: 0, failed: 0 },
    fetchCounters: async () => {
      call += 1;
      if (call === 1) throw new Error("scrape failed");
      return { accepted: 5, completed: 5, failed: 0 };
    },
    sleep: clock.sleep,
    now: clock.now,
    pollIntervalSeconds: 1,
    stablePolls: 2,
    timeoutSeconds: 100,
  });
  assert.equal(result.status, "complete");
});
