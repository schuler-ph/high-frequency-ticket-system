import * as assert from "node:assert";
import { test } from "node:test";
import {
  StartupTimeoutError,
  withStartupTimeout,
} from "../../src/lib/startup-timeout.ts";

void test("withStartupTimeout resolves with the operation result before the timeout", async () => {
  const result = await withStartupTimeout(
    Promise.resolve("ok"),
    1000,
    "should not fire",
  );

  assert.equal(result, "ok");
});

void test("withStartupTimeout rejects with an actionable StartupTimeoutError when the operation hangs", async () => {
  const neverResolves = new Promise<string>(() => {});

  await assert.rejects(
    () =>
      withStartupTimeout(
        neverResolves,
        20,
        "Redis did not become ready — is the hts-redis container running?",
      ),
    (err: unknown) => {
      assert.ok(err instanceof StartupTimeoutError);
      assert.match(err.message, /hts-redis container running/);
      return true;
    },
  );
});

void test("withStartupTimeout propagates the operation's own rejection unchanged", async () => {
  await assert.rejects(
    () =>
      withStartupTimeout(
        Promise.reject(new Error("connection refused")),
        1000,
        "timeout message that should not be used",
      ),
    /connection refused/,
  );
});
