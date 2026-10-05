import assert from "node:assert/strict";
import test from "node:test";

import { describePhaseASchedule } from "../lib/schedule.mjs";

const plan = (saleOpensAtSecond) => ({
  warmupSeconds: 45,
  rampSeconds: 45,
  sustainSeconds: 900,
  warmupRate: 1000,
  targetRate: 10000,
  saleOpensAtSecond,
});

test("describePhaseASchedule lists the stage boundaries on the k6 clock", () => {
  const lines = describePhaseASchedule(plan(55));
  assert.equal(lines[0], "Warm-up  0 s - 45 s: 1000 it/s flat");
  assert.equal(lines[1], "Rampe    45 s - 90 s: 1000 -> 10000 it/s");
  assert.equal(
    lines[2],
    "Sustain  ab 90 s: 10000 it/s bis Sold-out, spaetestens bis 990 s",
  );
});

test("describePhaseASchedule places the sale opening in its stage", () => {
  const openingOf = (second) => describePhaseASchedule(plan(second))[3];
  assert.equal(openingOf(30), "Verkauf oeffnet bei 30 s (im Warm-up)");
  assert.equal(openingOf(45), "Verkauf oeffnet bei 45 s (in der Rampe)");
  assert.equal(openingOf(54.6), "Verkauf oeffnet bei 55 s (in der Rampe)");
  assert.equal(openingOf(90), "Verkauf oeffnet bei 90 s (im Sustain)");
  assert.equal(
    openingOf(2000),
    "Verkauf oeffnet bei 2000 s (nach dem Ende von Phase A)",
  );
});

test("describePhaseASchedule reports a missing or elapsed gate as open from start", () => {
  assert.equal(
    describePhaseASchedule(plan(null))[3],
    "Verkauf: ohne Gate, offen ab Start",
  );
  assert.equal(
    describePhaseASchedule(plan(-3))[3],
    "Verkauf: vor dem k6-Start, offen ab Start",
  );
});
