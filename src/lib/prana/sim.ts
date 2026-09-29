// PRANA simulation engine: demand -> stock -> contagion spill -> restock, 1 tick = 1 day.
import { HIST_DAYS, MEDS, ND, NM, NP, OUTBREAKS, OutKind, P_EDGE as _P, SEED, SPILL_S, getGeo, rand, randn } from "./core";
import { analyze } from "./analysis";
import { Flow, World, newHist, outbreakMult } from "./world";

void _P;

export function createWorld(seed = SEED, warm = HIST_DAYS): World {
  const g = getGeo(seed);
  const stock = new Array(NP * NM);
  const dem = new Array(NP * NM);
  for (const p of g.phcs) for (let m = 0; m < NM; m++) {
    const b = g.base[p.idx * NM + m];
    dem[p.idx * NM + m] = b;
    stock[p.idx * NM + m] = Math.min(b * (10 + rand(seed, 20, p.idx, m) * 10), b * g.districts[p.d].capDays * 0.9);
  }
  const wh = new Array(ND * NM);
  const holtL = new Array(ND * NM);
  for (const d of g.districts) for (let m = 0; m < NM; m++) {
    const sum = d.phcs.reduce((s, p) => s + g.base[p * NM + m], 0);
    wh[d.idx * NM + m] = sum * (30 + rand(seed, 21, d.idx, m) * 15);
    holtL[d.idx * NM + m] = sum;
  }
  const w: World = {
    seed, tick: 0, t0: warm,
    out: { kind: null, start: -1, infected: new Array(NP).fill(-1) },
    stock, dem, spillIn: new Array(NP * NM).fill(0), wh,
    unmetD: new Array(ND * NM).fill(0), orders: [], ships: [],
    beds: new Array(NP).fill(50), nurses: new Array(NP).fill(4),
    nowcast: [],
    holt: { l: holtL, b: new Array(ND * NM).fill(0), e2: holtL.map((l) => (0.1 * l) ** 2) },
    pairState: new Array(ND * NM).fill("ADEQUATE"),
    alertStored: new Array(ND * NM).fill(0), alertHold: new Array(ND * NM).fill(0),
    analysis: [], alerts: [], alertSeq: 0, flows: [], shadow: null, hist: newHist(),
  };
  for (let i = 0; i < warm; i++) step(w);
  w.alerts = [];
  w.alertSeq = 0;
  initNowcast(w);
  return w;
}

export function initNowcast(w: World): void {
  w.nowcast = [];
  for (let p = 0; p < NP; p++) for (let m = 0; m < NM; m++) {
    const i = p * NM + m;
    const truth = w.stock[i] / Math.max(w.dem[i], 1e-6);
    const sd = 3 + 3 * rand(w.seed, 30, p, m);
    w.nowcast.push({
      mu: Math.max(0, truth + 3 * randn(w.seed, 31, p, m)), v: sd * sd,
      last: w.tick - Math.floor(2 + rand(w.seed, 32, p, m) * 25), src: 8, n: 0,
    });
  }
}

export function injectOutbreak(w: World, kind: OutKind, origin = 3): boolean {
  if (w.out.kind) return false;
  const g = getGeo(w.seed);
  w.out = { kind, start: w.tick, infected: new Array(NP).fill(-1) };
  for (const p of g.districts[origin].phcs) w.out.infected[p] = w.tick;
  return true;
}

export const dayOf = (w: World) => w.tick - w.t0;

function emergencyTopUp(w: World, d: number, m: number) {
  const g = getGeo(w.seed);
  const needs = g.districts[d].phcs.map((p) => ({ p, need: Math.max(0, 10 * w.dem[p * NM + m] - w.stock[p * NM + m]) }));
  const total = needs.reduce((s, x) => s + x.need, 0);
  const avail = w.wh[d * NM + m];
  if (total <= 0 || avail <= 0) return;
  const k = Math.min(1, avail / total);
  for (const x of needs) {
    w.stock[x.p * NM + m] += x.need * k;
    w.wh[d * NM + m] -= x.need * k;
  }
}

export function step(w: World): void {
  const g = getGeo(w.seed);
  const t = w.tick;
  const day = t - w.t0;
  const cfg = w.out.kind ? OUTBREAKS[w.out.kind] : null;

  // 1. outbreak spread along referral edges (p per edge per day for spreadDays)
  if (cfg && t > w.out.start && t <= w.out.start + cfg.spreadDays) {
    const fresh: number[] = [];
    for (let p = 0; p < NP; p++) {
      if (w.out.infected[p] < 0 || w.out.infected[p] >= t) continue;
      for (const q of g.phcs[p].nbrs)
        if (w.out.infected[q] < 0 && !fresh.includes(q) && rand(w.seed, t, p * 64 + q, 77) < cfg.p) fresh.push(q);
    }
    for (const q of fresh) w.out.infected[q] = t;
  }

  // 2. arrivals (depot orders + approved shipments)
  w.orders = w.orders.filter((o) => {
    if (o.arrive > t) return true;
    w.wh[o.d * NM + o.m] += o.units;
    return false;
  });
  w.ships = w.ships.filter((s) => {
    if (s.arrive > t) return true;
    w.wh[s.to * NM + s.m] += s.units;
    emergencyTopUp(w, s.to, s.m);
    return false;
  });

  // 3. demand, consumption, stock-out detection
  const season = 1 + 0.12 * Math.sin((2 * Math.PI * t) / 7);
  const out = new Array(NP * NM).fill(false);
  const unmet = new Array(NP * NM).fill(0);
  const dmDem = new Array(ND * NM).fill(0);
  const dmUnmet = new Array(ND * NM).fill(0);
  const natDem = new Array(NM).fill(0);
  const natUnmet = new Array(NM).fill(0);
  const natSpill = new Array(NM).fill(0);
  let stressedPairs = 0;
  for (let p = 0; p < NP; p++) {
    const d = g.phcs[p].d;
    for (let m = 0; m < NM; m++) {
      const i = p * NM + m;
      const exp = g.base[i] * season * outbreakMult(w, p, m, MEDS[m].id, t) * (1 + 0.08 * randn(w.seed, t, p, m));
      const total = exp + w.spillIn[i];
      const cons = Math.min(w.stock[i], total);
      w.stock[i] -= cons;
      unmet[i] = total - cons;
      w.dem[i] = 0.6 * w.dem[i] + 0.4 * total;
      out[i] = w.stock[i] < w.dem[i];
      if (w.stock[i] < 7 * w.dem[i]) stressedPairs++;
      dmDem[d * NM + m] += total;
      dmUnmet[d * NM + m] += unmet[i];
      natDem[m] += total;
      natUnmet[m] += unmet[i];
    }
  }

  // 4. contagion: s of unmet demand spills to nearest non-stocked-out referral neighbours (arrives next tick)
  const spillNext = new Array(NP * NM).fill(0);
  const flows: Flow[] = [];
  for (let p = 0; p < NP; p++) for (let m = 0; m < NM; m++) {
    const i = p * NM + m;
    if (!out[i] || unmet[i] <= 0.01) continue;
    const tg = g.phcs[p].nbrs.filter((q) => !out[q * NM + m]);
    if (!tg.length) continue;
    const share = (SPILL_S * unmet[i]) / tg.length;
    for (const q of tg) {
      spillNext[q * NM + m] += share;
      natSpill[m] += share;
      flows.push({ a: p, b: q, m, amt: share });
    }
  }
  w.spillIn = spillNext;
  w.flows = flows;

  for (let i = 0; i < ND * NM; i++) {
    w.unmetD[i] = 0.5 * w.unmetD[i] + 0.5 * dmUnmet[i];
    const l0 = w.holt.l[i];
    const b0 = w.holt.b[i];
    const pred = l0 + 0.85 * b0;
    const l1 = 0.4 * dmDem[i] + 0.6 * pred;
    w.holt.b[i] = 0.2 * (l1 - l0) + 0.8 * 0.85 * b0;
    w.holt.l[i] = l1;
    w.holt.e2[i] = 0.9 * w.holt.e2[i] + 0.1 * (dmDem[i] - pred) ** 2;
  }

  // 5. restock: district warehouse -> PHC weekly (capacity limited); national depot -> warehouse biweekly
  for (const d of g.districts) {
    if ((((day - d.idx) % 7) + 7) % 7 === 6) {
      for (let m = 0; m < NM; m++) {
        const reqs = d.phcs.map((p) => Math.max(0, d.capDays * g.base[p * NM + m] - w.stock[p * NM + m]));
        const tot = reqs.reduce((s, x) => s + x, 0);
        const k = tot > 0 ? Math.min(1, w.wh[d.idx * NM + m] / tot) : 0;
        d.phcs.forEach((p, j) => {
          w.stock[p * NM + m] += reqs[j] * k;
          w.wh[d.idx * NM + m] -= reqs[j] * k;
        });
      }
    }
    if ((((day + 3 * d.idx) % 14) + 14) % 14 === 0) {
      for (let m = 0; m < NM; m++) {
        const i = d.idx * NM + m;
        const dd = d.phcs.reduce((s, p) => s + w.dem[p * NM + m], 0);
        const pending = w.orders.filter((o) => o.d === d.idx && o.m === m).reduce((s, o) => s + o.units, 0);
        const need = Math.max(0, 45 * dd - w.wh[i] - pending);
        const fill = 0.7 + 0.3 * rand(w.seed, 40, t, i);
        const lead = 2 + Math.floor(rand(w.seed, 41, t, i) * 3);
        if (need > 0) w.orders.push({ d: d.idx, m, units: need * fill, arrive: t + lead });
      }
    }
  }

  // 6. story-realism fields
  for (let p = 0; p < NP; p++) {
    const mult = outbreakMult(w, p, 0, "PAR", t);
    w.beds[p] = Math.max(20, Math.min(100, 48 + 15 * (mult - 1) + 4 * randn(w.seed, 50, t, p)));
    w.nurses[p] = Math.max(1, Math.min(6, Math.round(4 - 0.3 * (mult - 1) + 0.8 * randn(w.seed, 51, t, p))));
  }

  // 7. nowcast propagation (consumption drift + process noise)
  for (const c of w.nowcast) {
    c.mu = Math.max(0, c.mu - 1);
    c.v += 0.6;
  }

  // 8. commit tick, analyse, record history
  let soPhc = 0;
  for (let p = 0; p < NP; p++) {
    let any = false;
    for (let m = 0; m < NM; m++) if (out[p * NM + m]) any = true;
    if (any) soPhc++;
  }
  const pd = natUnmet.reduce((s, x, m) => s + x * MEDS[m].ppu, 0);
  w.tick++;
  analyze(w);
  w.hist.dmDem.push(dmDem);
  w.hist.dmDos.push(w.analysis.map((a) => a.dosPhc));
  w.hist.dmRs.push(w.analysis.map((a) => a.rs));
  w.hist.so.push(soPhc);
  w.hist.nat.push({ dem: natDem, unmet: natUnmet, spill: natSpill, stressed: stressedPairs / (NP * NM) });
  w.hist.patientDays.push(pd);
}

export function stepMany(w: World, n: number): void {
  for (let i = 0; i < n; i++) step(w);
}
