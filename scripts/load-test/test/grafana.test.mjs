import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRenderUrl,
  collectPanels,
  parseRangeJson,
  parseTimeInput,
  renderIndexMarkdown,
  slugify,
} from "../lib/grafana.mjs";

test("slugify produces filesystem-safe names and folds umlauts", () => {
  assert.equal(slugify("POST /buy Latency (p50 / p95 / p99)"), "post-buy-latency-p50-p95-p99");
  assert.equal(slugify("Pool Wait (max queued acquirers im Zeitraum)"), "pool-wait-max-queued-acquirers-im-zeitraum");
  assert.equal(slugify("Überzeichnung"), "ueberzeichnung");
  assert.equal(slugify("---"), "panel");
});

test("collectPanels flattens rows and drops non-graph panels", () => {
  const panels = collectPanels({
    panels: [
      { id: 1, type: "timeseries", title: "Rate" },
      { id: 2, type: "text", title: "Setup Required" },
      { id: 9, type: "row", title: "More", panels: [{ id: 3, type: "gauge", title: "Drift" }] },
      { type: "timeseries", title: "no id" },
    ],
  });
  assert.deepEqual(panels, [
    { id: 1, title: "Rate", type: "timeseries" },
    { id: 3, title: "Drift", type: "gauge" },
  ]);
});

test("parseTimeInput passes relative and epoch values through untouched", () => {
  assert.equal(parseTimeInput("now-15m", "Europe/Vienna"), "now-15m");
  assert.equal(parseTimeInput("now", "Europe/Vienna"), "now");
  assert.equal(parseTimeInput("1769523540000", "Europe/Vienna"), "1769523540000");
  assert.equal(parseTimeInput(1769523540000, "Europe/Vienna"), "1769523540000");
});

test("parseTimeInput reads the Grafana picker format in the given zone", () => {
  // Vienna is UTC+2 in July → 16:19 local is 14:19 UTC.
  assert.equal(
    parseTimeInput("2026-07-27 16:19:00", "Europe/Vienna"),
    String(Date.parse("2026-07-27T14:19:00Z")),
  );
  // January → UTC+1.
  assert.equal(
    parseTimeInput("2026-01-15 08:00:00", "Europe/Vienna"),
    String(Date.parse("2026-01-15T07:00:00Z")),
  );
  // UTC as the render zone must not shift anything.
  assert.equal(
    parseTimeInput("2026-07-27 16:19:00", "UTC"),
    String(Date.parse("2026-07-27T16:19:00Z")),
  );
});

test("parseTimeInput honours an explicit zone in the input", () => {
  assert.equal(
    parseTimeInput("2026-07-27T16:19:00Z", "Europe/Vienna"),
    String(Date.parse("2026-07-27T16:19:00Z")),
  );
  assert.equal(
    parseTimeInput("2026-07-27T16:19:00+02:00", "UTC"),
    String(Date.parse("2026-07-27T14:19:00Z")),
  );
});

test("parseTimeInput rejects garbage", () => {
  assert.throws(() => parseTimeInput("", "UTC"), /Empty time value/);
  assert.throws(() => parseTimeInput("gestern abend", "UTC"), /Invalid time/);
});

test("parseRangeJson accepts the time-picker blob and rejects incomplete ones", () => {
  assert.deepEqual(
    parseRangeJson('{"from":"2026-07-27 16:19:00","to":"2026-07-27 16:31:00"}'),
    { from: "2026-07-27 16:19:00", to: "2026-07-27 16:31:00" },
  );
  assert.throws(() => parseRangeJson('{"from":"now-15m"}'), /--range needs/);
});

test("buildRenderUrl targets d-solo and pins the datasource variable", () => {
  const url = new URL(
    buildRenderUrl({
      baseUrl: "http://localhost:10008/",
      uid: "hts-api-performance",
      slug: "api-performance",
      panelId: 2,
      from: "100",
      to: "200",
      width: 1200,
      height: 500,
      scale: 2,
      timeZone: "Europe/Vienna",
      theme: "dark",
      datasourceUid: "prom-uid",
    }),
  );
  assert.equal(url.pathname, "/render/d-solo/hts-api-performance/api-performance");
  assert.equal(url.searchParams.get("panelId"), "2");
  assert.equal(url.searchParams.get("from"), "100");
  assert.equal(url.searchParams.get("tz"), "Europe/Vienna");
  assert.equal(url.searchParams.get("var-datasource"), "prom-uid");
});

test("buildRenderUrl omits the datasource variable when none is known", () => {
  const url = new URL(
    buildRenderUrl({
      baseUrl: "http://localhost:10008",
      uid: "u",
      slug: "s",
      panelId: 1,
      from: "now-5m",
      to: "now",
      width: 100,
      height: 100,
      scale: 1,
      timeZone: "UTC",
      theme: "dark",
      datasourceUid: null,
    }),
  );
  assert.equal(url.searchParams.has("var-datasource"), false);
});

test("renderIndexMarkdown is deterministic and marks failed panels", () => {
  const data = {
    from: String(Date.parse("2026-07-27T14:19:00Z")),
    to: String(Date.parse("2026-07-27T14:31:00Z")),
    timeZone: "Europe/Vienna",
    dashboards: [
      {
        title: "API Performance",
        uid: "hts-api-performance",
        panels: [
          { title: "Request Rate (RPS)", file: "api-performance/01-request-rate-rps.png", error: null },
          { title: "Broken", file: "api-performance/02-broken.png", error: "render -> 500" },
        ],
      },
    ],
  };
  const md = renderIndexMarkdown(data);
  assert.equal(md, renderIndexMarkdown(data));
  assert.match(md, /2026-07-27 14:19:00 UTC/);
  assert.match(md, /!\[Request Rate \(RPS\)\]\(api-performance\/01-request-rate-rps\.png\)/);
  assert.match(md, /Export fehlgeschlagen: render -> 500/);
});
