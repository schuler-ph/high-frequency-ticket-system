import * as assert from "node:assert";
import { test } from "node:test";
import { registerWorkerRedisScripts } from "../../src/lib/redis-scripts.ts";

void test("registerWorkerRedisScripts registers all worker scripts once via defineCommand", () => {
  const definedCommands: Array<{ name: string; numberOfKeys?: number }> = [];

  const scripts = registerWorkerRedisScripts({
    defineCommand(name, definition) {
      definedCommands.push({ name, numberOfKeys: definition.numberOfKeys });
    },
  });

  assert.ok(scripts);
  assert.deepEqual(definedCommands, [
    { name: "finalizeOrderProcessing", numberOfKeys: 3 },
    { name: "compensateReservation", numberOfKeys: 2 },
  ]);
});
