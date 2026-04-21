import * as assert from "node:assert";
import { test } from "node:test";
import Fastify from "fastify";
import Support from "../../src/plugins/support.ts";

void test("support works standalone", async () => {
  const fastify = Fastify({ logger: false });
  void fastify.register(Support);
  await fastify.ready();

  try {
    assert.equal(fastify.someSupport(), "hugs");
  } finally {
    await fastify.close();
  }
});
