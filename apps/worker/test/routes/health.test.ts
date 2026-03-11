import { test } from "node:test";
import * as assert from "node:assert";
import { build } from "../helper.js";

void test("health route returns 200", async (t) => {
  const app = await build(t);

  const res = await app.inject({
    method: "GET",
    url: "/health",
  });

  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.payload) as { status: string };
  assert.equal(payload.status, "ok");
});
