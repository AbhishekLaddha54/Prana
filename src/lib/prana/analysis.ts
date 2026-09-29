// PRANA-Cortex: states, Shortage Reproduction Number (Rs), forecasts, alert engine.
import { H, ND, NM, MEDS, P_EDGE, SPILL_S, getGeo } from "./core";
import { Level, Pair, State, World, outbreakMult } from "./world";

export const KAPPA = 5.0; // calibration constant (see docs/MODEL.md)
export const PHI = 0.85; // damping for the trend
export const HORIZON = 30;

export function futureMult(w: World, d: number, m: number, h: number): number {
  const g = getGeo(w.seed);
  let num = 0;
  let den = 0;
  for (const p of g.districts[d].phcs) {
    const b = g.base[p * NM + m];
    num += b * outbreakMult(w, p, m, MEDS[m].id, w.tick + h);
    den += b;
  }
  return num / den;
}

/** Damped-trend exponential smoothing forecast x active outbreak multiplier ratio. */
export function forecastDemand(w: World, d: number, m: number, n: number): { mean: number[]; sd: number[] } {
  const i = d * NM + m;
  const l = w.holt.l[i];
  const b = w.holt.b[i];
  const sd1 = Math.sqrt(Math.max(w.holt.e2[i], 1e-6));
  const M0 = Math.max(futureMult(w, d, m, 0), 1e-6);
  const mean: number[] = [];
  const sd: number[] = [];
  let acc = 0;
  let phiPow = 1;
  for (let h = 1; h <= n; h++) {
    phiPow *= PHI;
    acc += phiPow * b;
    const ratio = futureMult(w, d, m, h) / M0;
    mean.push(Math.max(0, (l + acc) * ratio));
    sd.push(sd1 * Math.sqrt(h) * ratio);
  }
  return { mean, sd };
}

export function analyze(w: World): void {
  const g = getGeo(w.seed);
  const prev = w.analysis;
  const pairs: Pair[] = new Array(ND * NM);
  for (let d = 0; d < ND; d++) {
    for (let m = 0; m < NM; m++) {
      const i = d * NM + m;
      let stock = 0;
      let dem = 0;
      let so = 0;
      for (const p of g.districts[d].phcs) {
        stock += w.stock[p * NM + m];
        dem += w.dem[p * NM + m];
        if (w.stock[p * NM + m] < w.dem[p * NM + m]) so++;
      }
      const wh = w.wh[i];
      const M0 = Math.max(futureMult(w, d, m, 0), 1e-6);
      const { mean } = forecastDemand(w, d, m, HORIZON);
      let cum = 0;
      let dtso = 60;
      for (let h = 0; h < HORIZON; h++) {
        if (cum + mean[h] >= stock + wh) {
          dtso = h + (stock + wh - cum) / Math.max(mean[h], 1e-6);
          break;
        }
        cum += mean[h];
      }
      const dosPhc = stock / Math.max(dem, 1e-6);
      const dosTot = (stock + wh) / Math.max(dem, 1e-6);
      const before: State = w.pairState[i] ?? "ADEQUATE";
      let state: State;
      if (so >= 2) state = "STOCKED_OUT";
      else if (dosPhc < 7 || so >= 1) state = "STRESSED";
      else if (before === "STOCKED_OUT" || before === "RECOVERED") state = "RECOVERED";
      else state = "ADEQUATE";
      pairs[i] = {
        d, m, stockPhc: stock, wh, dem, dosPhc, dosTot, soCount: so, unmet: w.unmetD[i], state, rs: 0,
        dtso: Math.min(60, dtso), fm7: futureMult(w, d, m, H) / M0, level: 0,
      };
    }
  }
  // ---- Rs: expected neighbours pushed to stock-out within H days if current spillover persists
  for (let d = 0; d < ND; d++) {
    const nb = g.districts[d].nbrs;
    // recipients of spillover are the neighbours that still have stock (non-stocked-out)
    const wsum = nb.reduce((s, j) => s + (pairs[j * NM + 0].d >= 0 ? 0 : 0), 0);
    void wsum;
    for (let m = 0; m < NM; m++) {
      const src = pairs[d * NM + m];
      const shortfall = Math.max(0, src.dem * src.fm7 * H - src.stockPhc) / H;
      const u = Math.max(src.unmet, shortfall);
      let rs = 0;
      const live = nb.filter((j) => pairs[j * NM + m].state !== "STOCKED_OUT");
      const wtot = live.reduce((s, j) => s + 1 + g.nEdges[d][j], 0);
      if (u > 1e-6) {
        for (const j of live) {
          const tgt = pairs[j * NM + m];
          const wij = (1 + g.nEdges[d][j]) / wtot;
          const pij = 1 - Math.pow(1 - P_EDGE, Math.max(1, g.nEdges[d][j]));
          const load = SPILL_S * u * wij * H; // units pushed onto j over the horizon
          const buffer = Math.max(0.5 * tgt.dem, tgt.stockPhc / tgt.fm7 - 3 * tgt.dem); // usable buffer above a 3-day working reserve
          rs += pij * Math.min(1.5, load / buffer);
        }
      }
      src.rs = KAPPA * rs;
    }
  }
  // ---- levels + alerts
  for (let i = 0; i < pairs.length; i++) {
    const p = pairs[i];
    const level: Level = p.rs > 1 ? 2 : p.rs >= 0.8 || p.dtso <= 14 ? 1 : 0;
    p.level = level;
    const stored = w.alertStored[i] ?? 0;
    if (level > stored) {
      w.alertStored[i] = level;
      w.alertHold[i] = 0;
      const dist = g.districts[p.d];
      const risky = dist.nbrs
        .filter((j) => pairs[j * NM + p.m].state !== "STOCKED_OUT")
        .sort((a, b) => pairs[a * NM + p.m].dosPhc - pairs[b * NM + p.m].dosPhc)
        .slice(0, 3)
        .map((j) => g.districts[j].name);
      const med = MEDS[p.m].name;
      const text =
        level === 2
          ? `${med} in ${dist.name}: ${p.soCount} of 5 clinics have run out. Spread score ${p.rs.toFixed(2)} — the shortage is likely to reach ${risky.join(", ")} next.`
          : p.rs >= 0.8
            ? `${med} in ${dist.name}: spread score ${p.rs.toFixed(2)} is close to 1. Keep an eye on ${risky.join(", ")}.`
            : `${med} in ${dist.name}: expected to run out in about ${Math.round(p.dtso)} days because demand is rising.`;
      w.alerts.push({ id: ++w.alertSeq, tick: w.tick, level: level === 2 ? "CRITICAL" : "WARNING", d: p.d, m: p.m, rs: p.rs, dtso: p.dtso, text });
      if (w.alerts.length > 80) w.alerts.shift();
    } else if (level < stored) {
      w.alertHold[i] = (w.alertHold[i] ?? 0) + 1;
      if (w.alertHold[i] >= 3) {
        w.alertStored[i] = level;
        w.alertHold[i] = 0;
      }
    } else w.alertHold[i] = 0;
    w.pairState[i] = p.state;
  }
  void prev;
  w.analysis = pairs;
}
