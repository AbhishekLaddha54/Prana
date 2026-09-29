// PRANA-Planner: min-cost-flow redistribution, 3 candidate plans, counterfactual replay, explanations.
import { MEDS, ND, NM, getGeo, haversineKm } from "./core";
import { forecastDemand } from "./analysis";
import { aiText, hasAI } from "./ai";
import { step } from "./sim";
import { Ship, World, cloneWorld } from "./world";

export const ROAD_FACTOR = 1.3;
export const RS_PER_KM = 22; // truck cost, INR per km
export const SPEED_KMPH = 40;
export const HANDLING_H = 4;

// ------------------------------------------------------------ min-cost flow (successive shortest paths)
class MCF {
  g: { to: number; cap: number; cost: number; rev: number }[][];
  constructor(n: number) {
    this.g = Array.from({ length: n }, () => []);
  }
  add(u: number, v: number, cap: number, cost: number): [number, number] {
    this.g[u].push({ to: v, cap, cost, rev: this.g[v].length });
    this.g[v].push({ to: u, cap: 0, cost: -cost, rev: this.g[u].length - 1 });
    return [u, this.g[u].length - 1];
  }
  run(s: number, t: number): number {
    const n = this.g.length;
    let flow = 0;
    for (;;) {
      const dist = new Array(n).fill(Infinity);
      const inq = new Array(n).fill(false);
      const pv = new Array(n).fill(-1);
      const pe = new Array(n).fill(-1);
      dist[s] = 0;
      const q = [s];
      while (q.length) {
        const u = q.shift() as number;
        inq[u] = false;
        this.g[u].forEach((e, i) => {
          if (e.cap > 0 && dist[u] + e.cost < dist[e.to]) {
            dist[e.to] = dist[u] + e.cost;
            pv[e.to] = u;
            pe[e.to] = i;
            if (!inq[e.to]) { inq[e.to] = true; q.push(e.to); }
          }
        });
      }
      if (dist[t] === Infinity) break;
      let f = Infinity;
      for (let v = t; v !== s; v = pv[v]) f = Math.min(f, this.g[pv[v]][pe[v]].cap);
      for (let v = t; v !== s; v = pv[v]) {
        const e = this.g[pv[v]][pe[v]];
        e.cap -= f;
        this.g[v][e.rev].cap += f;
      }
      flow += f;
    }
    return flow;
  }
}

export interface Shipment {
  from: number;
  to: number;
  m: number;
  units: number;
  km: number;
  hours: number;
  cost: number;
  etaDays: number;
  cold: boolean;
}
export interface Effect {
  focus: { d: number; m: number };
  rsNow: number;
  rsWithout: number;
  rsWith: number;
  dtsoWithout: number;
  dtsoWith: number;
  patientDaysAvoided: number;
  stockoutDaysAvoided: number;
  series: { without: number[]; with: number[] };
}
export type PlanName = "BALANCED" | "FASTEST" | "CHEAPEST";
export interface Plan {
  id: string;
  name: PlanName;
  shipments: Shipment[];
  totalCost: number;
  totalUnits: number;
  maxEtaH: number;
  unserved: { d: number; m: number; units: number }[];
  effect: Effect;
  explanation: string;
  explanationMode: "live" | "mock";
}

interface Params {
  name: PlanName;
  wKm: number;
  wTime: number;
  horizon: number;
  reserveDays: number;
  maxTrucks: number;
  tiered: boolean;
}
const PARAMS: Params[] = [
  { name: "BALANCED", wKm: 0.5, wTime: 0.5, horizon: 28, reserveDays: 35, maxTrucks: 4, tiered: true },
  { name: "FASTEST", wKm: 0, wTime: 1, horizon: 24, reserveDays: 28, maxTrucks: 6, tiered: false },
  { name: "CHEAPEST", wKm: 1, wTime: 0, horizon: 18, reserveDays: 28, maxTrucks: 3, tiered: false },
];

function solve(w: World, P: Params): { ships: Shipment[]; unserved: Plan["unserved"] } {
  const g = getGeo(w.seed);
  const ships: Shipment[] = [];
  const unserved: Plan["unserved"] = [];
  for (let m = 0; m < NM; m++) {
    const med = MEDS[m];
    const sinks: { d: number; need: number }[] = [];
    const srcs: { d: number; surplus: number }[] = [];
    // pre-emptive frontier: neighbours of districts whose Rs>1 (or already stocked out) will be hit next
    const frontier = new Set<number>();
    for (let d = 0; d < ND; d++) {
      const a = w.analysis[d * NM + m];
      if (a.rs > 1 || a.state === "STOCKED_OUT") g.districts[d].nbrs.forEach((j) => frontier.add(j));
    }
    for (let d = 0; d < ND; d++) {
      const a = w.analysis[d * NM + m];
      const f = forecastDemand(w, d, m, P.horizon).mean;
      let needF = f.reduce((s, x) => s + x, 0);
      const atRisk = a.level >= 1 || a.state === "STOCKED_OUT" || (a.state === "STRESSED" && a.dtso < 21);
      const isFrontier = frontier.has(d) && !atRisk;
      if (isFrontier) needF *= 2.2; // anticipated outbreak arrival
      const total = a.stockPhc + a.wh;
      if (atRisk || isFrontier) {
        const need = Math.floor(needF - total);
        if (need > 0) sinks.push({ d, need });
      } else if (a.state === "ADEQUATE" || a.state === "RECOVERED") {
        const fAvg = needF / P.horizon;
        const surplus = Math.floor(Math.min(a.wh, total - P.reserveDays * fAvg));
        if (surplus > 0 && a.dtso > 21) srcs.push({ d, surplus });
      }
    }
    if (!sinks.length) continue;
    const arcs: { i: number; j: number; km: number; hours: number }[] = [];
    for (const s of srcs) for (const k of sinks) {
      const km = haversineKm([g.districts[s.d].lat, g.districts[s.d].lng], [g.districts[k.d].lat, g.districts[k.d].lng]) * ROAD_FACTOR;
      const hours = km / SPEED_KMPH + HANDLING_H;
      if (med.cold && !(g.districts[s.d].coldHub && g.districts[k.d].coldHub && km <= 350)) continue; // refrigerated routes only
      arcs.push({ i: s.d, j: k.d, km, hours });
    }
    const maxKm = Math.max(1, ...arcs.map((a) => a.km));
    const maxH = Math.max(1, ...arcs.map((a) => a.hours));
    const S = 0;
    const T = 1;
    const net = new MCF(2 + ND * 2);
    const sIdx = (d: number) => 2 + d;
    const kIdx = (d: number) => 2 + ND + d;
    for (const s of srcs) {
      if (P.tiered) {
        net.add(S, sIdx(s.d), Math.floor(s.surplus * 0.5), 0);
        net.add(S, sIdx(s.d), s.surplus - Math.floor(s.surplus * 0.5), 400);
      } else net.add(S, sIdx(s.d), s.surplus, 0);
    }
    const arcRef: { ref: [number, number]; a: (typeof arcs)[number] }[] = [];
    for (const a of arcs) {
      const c = 1 + Math.round(1000 * (P.wKm * (a.km / maxKm) + P.wTime * (a.hours / maxH)));
      arcRef.push({ ref: net.add(sIdx(a.i), kIdx(a.j), P.maxTrucks * med.truck, c), a });
    }
    for (const k of sinks) net.add(kIdx(k.d), T, k.need, 0);
    net.run(S, T);
    const got = new Map<number, number>();
    for (const { ref, a } of arcRef) {
      const e = net.g[ref[0]][ref[1]];
      const units = net.g[e.to][e.rev].cap; // flow = reverse residual
      if (units < 1) continue;
      got.set(a.j, (got.get(a.j) ?? 0) + units);
      const trucks = Math.ceil(units / med.truck);
      ships.push({ from: a.i, to: a.j, m, units, km: a.km, hours: a.hours, cost: Math.round(trucks * a.km * RS_PER_KM), etaDays: Math.max(1, Math.ceil(a.hours / 24)), cold: med.cold });
    }
    for (const k of sinks) {
      const rest = k.need - (got.get(k.d) ?? 0);
      if (rest > 0) unserved.push({ d: k.d, m, units: rest });
    }
  }
  return { ships, unserved };
}

// ------------------------------------------------------------ apply + counterfactual replay
export function shipsFromPlan(w: World, plan: Plan): Ship[] {
  return plan.shipments.map((s, i) => ({
    id: `${plan.id}-${i}`, from: s.from, to: s.to, m: s.m, units: s.units, depart: w.tick, arrive: w.tick + s.etaDays, planId: plan.id, km: s.km, cost: s.cost,
  }));
}
/** Load trucks now (deduct donor warehouse stock, never below zero) and schedule arrivals. */
export function applyShips(w: World, ships: Ship[]): void {
  for (const s of ships) {
    const i = s.from * NM + s.m;
    const load = Math.min(s.units, w.wh[i]);
    w.wh[i] -= load;
    w.ships.push({ ...s, units: load });
  }
}

interface Replay {
  so: number[];
  pd: number;
  rs: number[]; // per-day max Rs of focus med over districts
  dtso7: number;
  minStock: number;
}
export function replay(w: World, ships: Ship[], days: number, focus: { d: number; m: number }): Replay {
  const c = cloneWorld(w);
  applyShips(c, ships);
  const r: Replay = { so: [], pd: 0, rs: [], dtso7: 60, minStock: Infinity };
  for (let k = 1; k <= days; k++) {
    step(c);
    r.so.push(c.hist.so[c.hist.so.length - 1]);
    r.pd += c.hist.patientDays[c.hist.patientDays.length - 1];
    r.rs.push(Math.max(...Array.from({ length: ND }, (_, d) => c.analysis[d * NM + focus.m].rs)));
    if (k === 7) r.dtso7 = c.analysis[focus.d * NM + focus.m].dtso;
    r.minStock = Math.min(r.minStock, ...c.stock, ...c.wh);
  }
  return r;
}
export function projectNoPlan(w: World, days: number): number[] {
  return replay(w, [], days, { d: 0, m: 0 }).so;
}

export function pickFocus(w: World): { d: number; m: number } {
  let best = w.analysis[0];
  for (const a of w.analysis) if (a.rs > best.rs || (a.rs === best.rs && a.dtso < best.dtso)) best = a;
  return { d: best.d, m: best.m };
}

function template(w: World, plan: Plan): string {
  const g = getGeo(w.seed);
  const byMed = new Map<number, number>();
  plan.shipments.forEach((s) => byMed.set(s.m, (byMed.get(s.m) ?? 0) + s.units));
  const meds = [...byMed.entries()].map(([m, u]) => `${Math.round(u).toLocaleString()} ${MEDS[m].unit}s of ${MEDS[m].name}`).join(" and ") || "no stock";
  const names = (ids: number[]) => {
    const u = [...new Set(ids)].map((i) => g.districts[i].name);
    return u.length > 3 ? `${u.slice(0, 3).join(", ")} and ${u.length - 3} more` : u.join(", ") || "—";
  };
  const e = plan.effect;
  const style = plan.name === "FASTEST" ? "gets supplies there as quickly as possible" : plan.name === "CHEAPEST" ? "keeps trucking cost as low as possible" : "balances cost, speed and keeping the donating districts safe";
  const label = plan.name[0] + plan.name.slice(1).toLowerCase();
  return (
    `The ${label} plan sends ${meds} from ${names(plan.shipments.map((s) => s.from))} to ${names(plan.shipments.map((s) => s.to))}. Trucks arrive within about ${Math.max(0, Math.round(plan.maxEtaH))} hours and it costs roughly ₹${Math.round(plan.totalCost).toLocaleString()}. ` +
    `It ${style}, and every district giving stock keeps at least ${PARAMS.find((p) => p.name === plan.name)?.reserveDays} days for itself. ` +
    `In the what-if replay the spread score falls from ${e.rsWithout.toFixed(1)} to ${e.rsWith.toFixed(1)}, and about ${Math.round(e.patientDaysAvoided).toLocaleString()} patient-days without medicine are avoided over 3 weeks.`
  );
}

export async function generatePlans(w: World): Promise<Plan[]> {
  const focus = pickFocus(w);
  const rsNow = w.analysis[focus.d * NM + focus.m].rs;
  const none = replay(w, [], 21, focus);
  const plans: Plan[] = [];
  for (const P of PARAMS) {
    const { ships, unserved } = solve(w, P);
    const id = `${w.tick}-${P.name}`;
    const plan: Plan = {
      id, name: P.name, shipments: ships,
      totalCost: ships.reduce((s, x) => s + x.cost, 0), totalUnits: ships.reduce((s, x) => s + x.units, 0),
      maxEtaH: Math.max(0, ...ships.map((s) => s.hours)), unserved,
      effect: null as unknown as Effect, explanation: "", explanationMode: "mock",
    };
    const withPlan = replay(w, shipsFromPlan(w, plan), 21, focus);
    plan.effect = {
      focus, rsNow, rsWithout: none.rs[6] ?? 0, rsWith: withPlan.rs[6] ?? 0,
      dtsoWithout: none.dtso7, dtsoWith: withPlan.dtso7,
      patientDaysAvoided: Math.max(0, none.pd - withPlan.pd),
      stockoutDaysAvoided: none.so.reduce((s, x) => s + x, 0) - withPlan.so.reduce((s, x) => s + x, 0),
      series: { without: none.so, with: withPlan.so },
    };
    plan.explanation = template(w, plan);
    if (hasAI()) {
      const txt = await aiText(
        "You are a supply-chain analyst speaking to a district health officer who is not technical. " +
        "In exactly 3 short plain-English sentences, explain this plan: what moves, from where to where, what it costs, when it lands, and what it prevents. No jargon, no bullet points.",
        JSON.stringify({ plan: plan.name, deliveries: plan.shipments.length, units: plan.totalUnits, costInr: plan.totalCost, maxHours: Math.round(plan.maxEtaH), predictedEffect: { ...plan.effect, series: undefined } }),
      );
      if (txt) { plan.explanation = txt.replace(/\s+/g, " ").trim(); plan.explanationMode = "live"; }
    }
    plans.push(plan);
  }
  return plans;
}
