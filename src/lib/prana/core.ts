// PRANA core: constants, deterministic stateless RNG, medicines, synthetic geography.
export const SEED = 42;
export const NM = 8;
export const NP = 60;
export const ND = 12;
export const HIST_DAYS = 90;
export const H = 7; // Rs horizon (days)
export const SPILL_S = 0.45; // share of unmet demand that spills to neighbours
export const P_EDGE = 0.35; // per-edge per-day spread probability

const TWO_PI = Math.PI * 2;

/** Stateless deterministic uniform [0,1) from (seed, ...int keys). Same inputs -> same output. */
export function rand(seed: number, ...keys: number[]): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (const k of keys) {
    h = Math.imul(h ^ Math.floor(k), 0x85ebca6b);
    h ^= h >>> 13;
    h = Math.imul(h, 0xc2b2ae35);
    h ^= h >>> 16;
  }
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export function randn(seed: number, ...keys: number[]): number {
  const u1 = Math.max(1e-9, rand(seed, ...keys, 101));
  const u2 = rand(seed, ...keys, 202);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(TWO_PI * u2);
}
export function laplace(seed: number, ...keys: number[]): number {
  const u = rand(seed, ...keys, 303) - 0.5;
  return -Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}
export const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));

export interface Med {
  id: string;
  name: string;
  unit: string;
  base: number; // baseline daily consumption per PHC at reference population
  cold: boolean;
  truck: number; // units per truck
  ppu: number; // patient-days covered per unit
}
export const MEDS: Med[] = [
  { id: "PAR", name: "Paracetamol", unit: "strip", base: 12, cold: false, truck: 4000, ppu: 3 },
  { id: "ORS", name: "ORS", unit: "sachet", base: 8, cold: false, truck: 3000, ppu: 1 },
  { id: "AMX", name: "Amoxicillin", unit: "capsule", base: 7, cold: false, truck: 3000, ppu: 0.34 },
  { id: "INS", name: "Insulin", unit: "vial", base: 1.5, cold: true, truck: 400, ppu: 20 },
  { id: "MAL", name: "Antimalarial", unit: "dose", base: 2, cold: false, truck: 1000, ppu: 0.34 },
  { id: "OXY", name: "Oxytocin", unit: "ampoule", base: 0.6, cold: true, truck: 200, ppu: 1 },
  { id: "IFA", name: "Iron+folic acid", unit: "tablet", base: 10, cold: false, truck: 4000, ppu: 1 },
  { id: "AZI", name: "Azithromycin", unit: "tablet", base: 3, cold: false, truck: 1500, ppu: 0.34 },
];
export const medIdx = (id: string) => MEDS.findIndex((m) => m.id === id);

export type OutKind = "dengue_para" | "dengue_ors" | "flood_amx";
export interface OutCfg {
  label: string;
  mult: Record<string, number>;
  p: number;
  spreadDays: number;
  mid: number;
  steep: number;
  plateau: number;
}
export const OUTBREAKS: Record<OutKind, OutCfg> = {
  dengue_para: { label: "Dengue surge", mult: { PAR: 4, ORS: 3.2 }, p: 0.35, spreadDays: 12, mid: 1.2, steep: 0.8, plateau: 28 },
  dengue_ors: { label: "Dengue (ORS variant)", mult: { ORS: 4, PAR: 2.6 }, p: 0.32, spreadDays: 12, mid: 1.6, steep: 0.9, plateau: 26 },
  flood_amx: { label: "Flood / waterborne", mult: { AMX: 3.4, ORS: 2.4, AZI: 1.9 }, p: 0.5, spreadDays: 8, mid: 0.9, steep: 0.7, plateau: 20 },
};

// ---------------------------------------------------------------- geography
export interface District {
  id: string;
  idx: number;
  name: string;
  lat: number;
  lng: number;
  pop: number;
  coldHub: boolean;
  poly: [number, number][];
  nbrs: number[];
  phcs: number[];
  capDays: number;
}
export interface Phc {
  id: string;
  idx: number;
  d: number;
  name: string;
  lat: number;
  lng: number;
  nbrs: number[]; // undirected union of referral edges
  refers: number[]; // directed referral out-edges (1-3)
}
export interface Geo {
  districts: District[];
  phcs: Phc[];
  base: number[]; // NP*NM baseline daily demand
  nEdges: number[][]; // ND x ND count of PHC referral edges between districts
  centerLat: number;
  centerLng: number;
}

const D_NAMES = ["Kalyanpur", "Mahesar", "Rampura", "Shivgarh", "Devnagar", "Harsiddhi", "Jalgaon Khas", "Nandigram", "Chitrakoot", "Badlapur", "Sundarpet", "Tarapur"];
const COLD_HUBS = new Set([1, 2, 3, 4, 5, 6, 8, 9, 10]);

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const dLat = ((b[0] - a[0]) * Math.PI) / 180;
  const dLng = ((b[1] - a[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a[0] * Math.PI) / 180) * Math.cos((b[0] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const geoCache = new Map<number, Geo>();
export function getGeo(seed: number): Geo {
  const hit = geoCache.get(seed);
  if (hit) return hit;
  // shared, jittered corner lattice (4 cols x 3 rows) -> organic district polygons that tile
  const corner = (c: number, r: number): [number, number] => {
    const edge = c === 0 || c === 4 || r === 0 || r === 3;
    const j = edge ? 0.04 : 0.14;
    return [24.55 - r * 1.1 + (rand(seed, 1, c, r) - 0.5) * j * 2, 75.4 + c * 1.2 + (rand(seed, 2, c, r) - 0.5) * j * 2];
  };
  const districts: District[] = [];
  for (let i = 0; i < ND; i++) {
    const col = Math.floor(i / 3);
    const row = i % 3;
    const poly = [corner(col, row), corner(col + 1, row), corner(col + 1, row + 1), corner(col, row + 1)];
    const lat = poly.reduce((s, p) => s + p[0], 0) / 4;
    const lng = poly.reduce((s, p) => s + p[1], 0) / 4;
    const nbrs: number[] = [];
    for (let j = 0; j < ND; j++) {
      if (j === i) continue;
      const cj = Math.floor(j / 3);
      const rj = j % 3;
      if (Math.abs(cj - col) <= 1 && Math.abs(rj - row) <= 1) nbrs.push(j);
    }
    districts.push({
      id: `D${i + 1}`, idx: i, name: D_NAMES[i], lat, lng,
      pop: i === 3 ? 900000 : Math.round((450000 + rand(seed, 3, i) * 750000) / 1000) * 1000,
      coldHub: COLD_HUBS.has(i), poly, nbrs, phcs: [], capDays: i === 3 ? 13 : 21,
    });
  }
  const phcs: Phc[] = [];
  for (const d of districts) {
    for (let k = 0; k < 5; k++) {
      const ang = (k / 5) * Math.PI * 2 + rand(seed, 4, d.idx, k) * 0.6;
      const rad = 0.16 + rand(seed, 5, d.idx, k) * 0.14;
      const idx = phcs.length;
      d.phcs.push(idx);
      phcs.push({
        id: `${d.id}-P${k + 1}`, idx, d: d.idx, name: `${d.name} PHC-${k + 1}`,
        lat: d.lat + Math.sin(ang) * rad * 0.9, lng: d.lng + Math.cos(ang) * rad * 1.05, nbrs: [], refers: [],
      });
    }
  }
  const dist = (a: Phc, b: Phc) => haversineKm([a.lat, a.lng], [b.lat, b.lng]);
  for (const p of phcs) {
    const d = districts[p.d];
    const k = d.phcs.indexOf(p.idx);
    const ring = d.phcs[(k + 1) % 5];
    const out = new Set<number>([ring]);
    if (rand(seed, 6, p.idx) < 0.6) {
      const near = d.phcs.filter((q) => q !== p.idx && q !== ring).sort((a, b) => dist(p, phcs[a]) - dist(p, phcs[b]))[0];
      out.add(near);
    }
    if (rand(seed, 7, p.idx) < 0.6) {
      const cand = phcs.filter((q) => d.nbrs.includes(q.d)).sort((a, b) => dist(p, a) - dist(p, b))[0];
      if (cand) out.add(cand.idx);
    }
    p.refers = [...out];
  }
  for (const p of phcs) for (const q of p.refers) {
    if (!p.nbrs.includes(q)) p.nbrs.push(q);
    if (!phcs[q].nbrs.includes(p.idx)) phcs[q].nbrs.push(p.idx);
  }
  const nEdges = Array.from({ length: ND }, () => new Array(ND).fill(0));
  for (const p of phcs) for (const q of p.nbrs) if (phcs[q].d !== p.d) nEdges[p.d][phcs[q].d] += 1;
  const share = phcs.map((_, i) => 0.7 + 0.6 * rand(seed, 8, i));
  const base = new Array(NP * NM);
  for (const p of phcs) for (let m = 0; m < NM; m++)
    base[p.idx * NM + m] = MEDS[m].base * (districts[p.d].pop / 800000) * share[p.idx] * (0.9 + 0.2 * rand(seed, 9, p.idx, m));
  const geo: Geo = {
    districts, phcs, base, nEdges,
    centerLat: districts.reduce((s, d) => s + d.lat, 0) / ND,
    centerLng: districts.reduce((s, d) => s + d.lng, 0) / ND,
  };
  geoCache.set(seed, geo);
  return geo;
}
