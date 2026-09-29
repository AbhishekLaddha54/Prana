// PRANA-Mesh: federated Crisis Pattern Library. Nations share 12-d outbreak signatures, never data.
import { MEDS, NM, ND, OutKind, clamp, laplace, randn } from "./core";
import { createWorld, injectOutbreak, stepMany } from "./sim";
import { World } from "./world";

export const SIG_DIM = 12;
export const SIG_NAMES = [
  "demand-growth slope", "mean surge ratio", "latest surge ratio", "secondary-med surge", "medicine-mix shift", "stress ratio",
  "stress trajectory", "spillover rate", "unmet-demand fraction", "spatial extent", "spread velocity", "demand volatility",
];
export const EPSILON = 4;
export const SENSITIVITY = 0.25;
export const CONFIRM_LAG = 6; // days a local-only forecaster needs before confirming a novel pattern

export interface Nation {
  id: "IND" | "BRA" | "ZAF";
  name: string;
  seed: number;
  kind: OutKind;
  origin: number;
  libId: string;
  label: string;
}
export const NATIONS: Nation[] = [
  { id: "IND", name: "India", seed: 1042, kind: "dengue_para", origin: 3, libId: "IND-Dengue-2019", label: "Dengue · Paracetamol" },
  { id: "BRA", name: "Brazil", seed: 2042, kind: "dengue_ors", origin: 5, libId: "BRA-Dengue-2024", label: "Dengue · ORS variant" },
  { id: "ZAF", name: "South Africa", seed: 3042, kind: "flood_amx", origin: 8, libId: "ZAF-Flood-2023", label: "Flood · Amoxicillin" },
];

export function cosine(a: number[], b: number[]): number {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}
/** FedAvg: (weighted) mean of client vectors. Equal weights by default. */
export function fedAvg(vs: number[][], weights?: number[]): number[] {
  const w = weights ?? vs.map(() => 1);
  const tot = w.reduce((s, x) => s + x, 0);
  return vs[0].map((_, i) => vs.reduce((s, v, k) => s + v[i] * w[k], 0) / tot);
}

const slope = (ys: number[]) => {
  const n = ys.length;
  const mx = (n - 1) / 2;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let a = 0, b = 0;
  ys.forEach((y, i) => { a += (i - mx) * (y - my); b += (i - mx) ** 2; });
  return b ? a / b : 0;
};
const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);

/** 12-d signature of the outbreak from onset tick `o` through tick `e` (inclusive), medicine-agnostic.
 *  Ratios are measured on the epicentre cluster (3 most-elevated districts) so nation size does not dilute the signal. */
export function signature(w: World, o: number, e: number): number[] | null {
  const n = e - o + 1;
  if (n < 2 || e >= w.hist.nat.length) return null;
  const b0 = Math.max(0, o - 14);
  const dm = w.hist.dmDem;
  const dbase = Array.from({ length: ND * NM }, (_, i) => mean(dm.slice(b0, o).map((x) => x[i])) || 1e-6);
  const dR = (t: number, d: number, m: number) => dm[t][d * NM + m] / dbase[d * NM + m];
  // primary medicine + epicentre
  const mr = Array.from({ length: NM }, (_, m) => Math.max(...Array.from({ length: ND }, (_, d) => mean(Array.from({ length: n }, (_, k) => dR(o + k, d, m))))));
  const order = mr.map((v, m) => [v, m]).sort((a, b) => b[0] - a[0]);
  const P = order[0][1];
  const S = order[1][1];
  const E = Array.from({ length: ND }, (_, d) => [mean(Array.from({ length: n }, (_, k) => dR(o + k, d, P))), d]).sort((a, b) => b[0] - a[0]).slice(0, 3).map((x) => x[1]);
  const ratio = (t: number, m: number) => E.reduce((s, d) => s + dm[t][d * NM + m], 0) / E.reduce((s, d) => s + dbase[d * NM + m], 0);
  const rp = Array.from({ length: n }, (_, k) => ratio(o + k, P));
  const rs = Array.from({ length: n }, (_, k) => ratio(o + k, S));
  const shareOf = (f: (m: number) => number) => { const v = Array.from({ length: NM }, (_, m) => f(m)); const t = v.reduce((a, b) => a + b, 0); return v.map((x) => x / t); };
  const shareB = shareOf((m) => E.reduce((s, d) => s + dbase[d * NM + m], 0));
  const shareW = shareOf((m) => mean(Array.from({ length: n }, (_, k) => E.reduce((s, d) => s + dm[o + k][d * NM + m], 0))));
  const win = w.hist.nat.slice(o, e + 1);
  const sumDem = win.reduce((s, x) => s + x.dem.reduce((a, b) => a + b, 0), 0);
  const sumSpill = win.reduce((s, x) => s + x.spill.reduce((a, b) => a + b, 0), 0);
  const sumUnmet = win.reduce((s, x) => s + x.unmet.reduce((a, b) => a + b, 0), 0);
  const elev = (t: number) => mean(Array.from({ length: ND }, (_, d) => (dR(t, d, P) > 1.3 ? 1 : 0)));
  const stress = win.map((x) => x.stressed);
  const cv = Math.sqrt(mean(rp.map((x) => (x - mean(rp)) ** 2))) / Math.max(mean(rp), 1e-6);
  const v = [
    slope(rp.map((x) => Math.log(Math.max(x, 0.05)))) / 0.5,
    (mean(rp) - 1) / 3,
    (rp[rp.length - 1] - 1) / 3,
    (mean(rs) - 1) / 3,
    0.5 * shareB.reduce((s, x, m) => s + Math.abs(x - shareW[m]), 0) * 2,
    stress[stress.length - 1] * 3,
    slope(stress) * 15,
    (sumSpill / Math.max(sumDem, 1e-6)) * 30,
    (sumUnmet / Math.max(sumDem, 1e-6)) * 8,
    elev(e) * 2,
    (Math.max(0, elev(e) - elev(o)) / n) * 10,
    cv * 2,
  ];
  return v.map((x) => clamp(Number.isFinite(x) ? x : 0, 0, 1));
}

export interface LibEntry {
  id: string;
  nation: Nation["id"];
  label: string;
  kind: OutKind;
  sig: number[];
  curve: number[]; // origin-district demand multiplier by age (days since onset) for the primary medicine
  peakMult: number;
  daysToPeak: number;
  medicine: string;
}
let libCache: LibEntry[] | null = null;
export function buildLibrary(): LibEntry[] {
  if (libCache) return libCache;
  libCache = NATIONS.map((n) => {
    const w = createWorld(n.seed, 30);
    const o = w.tick;
    injectOutbreak(w, n.kind, n.origin);
    stepMany(w, 22);
    const sig = signature(w, o, o + 4) as number[];
    const base = Array.from({ length: NM }, (_, m) => mean(w.hist.nat.slice(o - 14, o).map((x) => x.dem[m])));
    const P = Array.from({ length: NM }, (_, m) => mean(w.hist.nat.slice(o, o + 5).map((x) => x.dem[m])) / base[m]).reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);
    const bo = mean(w.hist.dmDem.slice(o - 14, o).map((x) => x[n.origin * NM + P]));
    const curve = Array.from({ length: 10 }, (_, a) => w.hist.dmDem[o + a][n.origin * NM + P] / bo);
    const peakMult = Math.max(...curve);
    const daysToPeak = curve.findIndex((c) => c >= 0.9 * peakMult);
    return { id: n.libId, nation: n.id, label: n.label, kind: n.kind, sig, curve, peakMult, daysToPeak, medicine: MEDS[P].name };
  });
  return libCache;
}

export interface MeshState {
  rounds: number;
  dp: boolean;
  shared: Record<string, number[]>; // vectors as shared in the latest round (after DP noise if enabled)
  global: number[];
  log: { round: number; dp: boolean; global: number[]; shared: Record<string, number[]> }[];
}
export function newMesh(): MeshState {
  const m: MeshState = { rounds: 0, dp: false, shared: {}, global: new Array(SIG_DIM).fill(0), log: [] };
  runRound(m, false);
  return m;
}
/** One federated round: each nation shares ONLY its signature vector (optionally Laplace-noised), server FedAvgs. */
export function runRound(st: MeshState, dp: boolean): MeshState {
  const lib = buildLibrary();
  st.rounds++;
  st.dp = dp;
  const round = st.rounds;
  const shared: Record<string, number[]> = {};
  NATIONS.forEach((n, k) => {
    const local = lib[k].sig.map((v, i) => clamp(v + 0.015 * randn(n.seed, round, i), 0, 1)); // local training jitter
    shared[n.id] = dp ? local.map((v, i) => clamp(v + (SENSITIVITY / EPSILON) * laplace(n.seed, round, i, 9), 0, 1)) : local;
  });
  st.shared = shared;
  st.global = fedAvg(NATIONS.map((n) => shared[n.id]));
  st.log.push({ round, dp, global: st.global, shared });
  if (st.log.length > 20) st.log.shift();
  return st;
}

export interface Match {
  id: string;
  nation: string;
  label: string;
  sim: number;
  foreign: boolean;
  peakMult: number;
  daysToPeak: number;
}
export function liveMatches(w: World, st: MeshState): { sig: number[]; matches: Match[]; onset: number } | null {
  if (!w.out.kind) return null;
  const sig = signature(w, w.out.start, w.tick - 1);
  if (!sig) return null;
  const lib = buildLibrary();
  const matches = lib.map((e) => ({
    id: e.id, nation: e.nation, label: e.label, foreign: e.nation !== "IND",
    sim: cosine(sig, e.nation === "IND" ? e.sig : st.shared[e.nation] ?? e.sig), peakMult: e.peakMult, daysToPeak: e.daysToPeak,
  }));
  return { sig, matches, onset: w.out.start };
}
