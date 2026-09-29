// World state types (plain JSON-able data so structuredClone gives cheap counterfactual forks).
import { OUTBREAKS, OutKind, rand } from "./core";

export type State = "ADEQUATE" | "STRESSED" | "STOCKED_OUT" | "RECOVERED";
export type Level = 0 | 1 | 2; // none / WARNING / CRITICAL

export interface Pair {
  d: number;
  m: number;
  stockPhc: number;
  wh: number;
  dem: number; // district demand rate (units/day, EMA)
  dosPhc: number;
  dosTot: number;
  soCount: number;
  unmet: number;
  state: State;
  rs: number;
  dtso: number; // forecast days to stock-out (capped 60)
  fm7: number; // forecast outbreak demand multiplier ratio at +7d
  level: Level;
}
export interface Alert {
  id: number;
  tick: number;
  level: "WARNING" | "CRITICAL";
  d: number;
  m: number;
  rs: number;
  dtso: number;
  text: string;
}
export interface Ship {
  id: string;
  from: number;
  to: number;
  m: number;
  units: number;
  depart: number;
  arrive: number;
  planId: string;
  km: number;
  cost: number;
}
export interface Cell {
  mu: number;
  v: number;
  last: number; // tick of last observation
  src: number; // bitmask 1 voice 2 photo 4 manual 8 ledger
  n: number;
}
export interface Flow {
  a: number;
  b: number;
  m: number;
  amt: number;
}
export interface Hist {
  dmDem: number[][];
  dmDos: number[][];
  dmRs: number[][];
  so: number[]; // PHCs with >=1 stock-out
  nat: { dem: number[]; unmet: number[]; spill: number[]; stressed: number }[];
  patientDays: number[]; // untreated patient-days per tick
}
export const newHist = (): Hist => ({ dmDem: [], dmDos: [], dmRs: [], so: [], nat: [], patientDays: [] });

export interface World {
  seed: number;
  tick: number;
  t0: number; // warm-up length; demo day = tick - t0
  out: { kind: OutKind | null; start: number; infected: number[] };
  stock: number[];
  dem: number[];
  spillIn: number[];
  wh: number[];
  unmetD: number[];
  orders: { d: number; m: number; units: number; arrive: number }[];
  ships: Ship[];
  beds: number[];
  nurses: number[];
  nowcast: Cell[];
  holt: { l: number[]; b: number[]; e2: number[] };
  pairState: State[];
  alertStored: number[];
  alertHold: number[];
  analysis: Pair[];
  alerts: Alert[];
  alertSeq: number;
  flows: Flow[];
  shadow: { start: number; so: number[] } | null;
  hist: Hist;
}

/** Demand multiplier for a PHC/medicine at tick t given the infection state. */
export function outbreakMult(w: World, p: number, m: number, medId: string, t: number): number {
  const kind = w.out.kind;
  if (!kind) return 1;
  const inf = w.out.infected[p];
  if (inf < 0 || t < inf) return 1;
  const cfg = OUTBREAKS[kind];
  const peak = cfg.mult[medId];
  if (!peak) return 1;
  const age = t - inf;
  const sev = 0.85 + 0.15 * rand(w.seed, 11, p);
  const shape = 1 / (1 + Math.exp(-(age - cfg.mid) / cfg.steep));
  const decay = age > cfg.plateau ? Math.exp(-(age - cfg.plateau) / 8) : 1;
  return 1 + (peak - 1) * sev * shape * decay;
}

export function cloneWorld(w: World): World {
  const { hist, ...rest } = w;
  void hist;
  const c = structuredClone(rest) as Omit<World, "hist">;
  return { ...c, hist: newHist() };
}
