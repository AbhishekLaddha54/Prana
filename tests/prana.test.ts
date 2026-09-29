import test from "node:test";
import assert from "node:assert/strict";
import { normalUpdate, SIGMA } from "../src/lib/prana/nowcast";
import { createWorld, injectOutbreak, step, dayOf } from "../src/lib/prana/sim";
import { generatePlans, applyShips, shipsFromPlan } from "../src/lib/prana/planner";
import { fedAvg, cosine } from "../src/lib/prana/mesh";
import { MEDS, NM } from "../src/lib/prana/core";
import { cloneWorld } from "../src/lib/prana/world";

function surgeWorld(untilCritical = true) {
  const w = createWorld();
  while (dayOf(w) < 20) {
    if (dayOf(w) === 5) injectOutbreak(w, "dengue_para", 3);
    step(w);
    if (untilCritical && w.alerts.some((a) => a.level === "CRITICAL")) break;
  }
  return w;
}

test("nowcast conjugate Normal update", () => {
  const u = normalUpdate(10, 16, 6, 4);
  assert.ok(Math.abs(u.v - 3.2) < 1e-9); // 1/(1/16+1/4)
  assert.ok(Math.abs(u.mu - 3.2 * (10 / 16 + 6 / 4)) < 1e-9);
  assert.ok(u.v < 16 && u.v < 4); // posterior always tighter than either
  assert.ok(SIGMA.voice > SIGMA.photo && SIGMA.photo > SIGMA.manual);
  const strong = normalUpdate(10, 16, 6, SIGMA.manual ** 2);
  const weak = normalUpdate(10, 16, 6, SIGMA.voice ** 2);
  assert.ok(strong.v < weak.v);
});

test("Rs sign conventions: zero at baseline, >1 during surge, non-negative", () => {
  const base = createWorld();
  assert.ok(base.analysis.every((a) => a.rs === 0));
  const w = surgeWorld();
  assert.ok(w.analysis.every((a) => a.rs >= 0));
  assert.ok(w.analysis[3 * NM].rs > 1);
  assert.ok(w.alerts.some((a) => a.level === "CRITICAL"));
});

test("determinism: same seed -> identical world", () => {
  const a = surgeWorld();
  const b = surgeWorld();
  assert.equal(a.tick, b.tick);
  assert.deepEqual(a.stock, b.stock);
});

test("optimizer feasibility: no negative stock after plan", async () => {
  const w = surgeWorld();
  const plans = await generatePlans(w);
  assert.equal(plans.length, 3);
  for (const p of plans) {
    assert.ok(p.shipments.length > 0);
    const c = cloneWorld(w);
    applyShips(c, shipsFromPlan(c, p));
    assert.ok(c.wh.every((x) => x >= -1e-6));
    for (const s of p.shipments) if (MEDS[s.m].cold) assert.ok(s.cold);
  }
});

test("counterfactual deltas are nonzero during surge", async () => {
  const w = surgeWorld();
  const plans = await generatePlans(w);
  for (const p of plans) assert.ok(p.effect.patientDaysAvoided > 0 || p.effect.stockoutDaysAvoided !== 0);
});

test("FedAvg on 3 toy vectors", () => {
  const g = fedAvg([[1, 2, 3], [3, 2, 1], [2, 5, 8]]);
  assert.deepEqual(g.map((x) => Math.round(x * 1e9) / 1e9), [2, 3, 4]);
  const wg = fedAvg([[0, 0], [3, 6]], [1, 2]);
  assert.deepEqual(wg, [2, 4]);
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-12);
});
