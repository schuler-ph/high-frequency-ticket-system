import { test } from "node:test";
import * as assert from "node:assert";

import Fastify from "fastify";
import Support from "../../src/plugins/support";

test("support works standalone", async (_t) => {
  const fastify = Fastify();
  void fastify.register(Support);
  await fastify.ready();

  assert.equal(fastify.someSupport(), "hugs");
});
