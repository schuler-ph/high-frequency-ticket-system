// This file contains code that we reuse between our tests.
import * as test from "node:test";
import Fastify, { FastifyInstance } from "fastify";
import { app } from "../src/app.js";

export type TestContext = {
  after: typeof test.after;
};

// Automatically build and tear down our instance
async function build(t: TestContext): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger: false,
  });

  // fastify-plugin ensures that all decorators
  // are exposed for testing purposes, this is
  // different from the production setup
  await fastify.register(app);

  await fastify.ready();

  // Tear down our app after we are done
  t.after(() => void fastify.close());

  return fastify;
}

export { build };
