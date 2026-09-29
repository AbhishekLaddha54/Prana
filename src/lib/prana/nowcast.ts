// PRANA-Sense: Bayesian nowcast. Posterior over "days of stock remaining" is Normal(mu, v) per (PHC, medicine).
import { MEDS, NM, clamp } from "./core";
import { Cell, World } from "./world";

export type Channel = "voice" | "photo" | "manual";
/** Observation noise sd in days of stock: voice noisiest, manual least. */
export const SIGMA: Record<Channel, number> = { voice: 4, photo: 2.5, manual: 1 };
export const BIT: Record<Channel, number> = { voice: 1, photo: 2, manual: 4 };

/** Conjugate Normal-Normal update. prior N(mu, v), observation y ~ N(days, r). */
export function normalUpdate(mu: number, v: number, y: number, r: number): { mu: number; v: number } {
  const post = 1 / (1 / v + 1 / r);
  return { mu: post * (mu / v + y / r), v: post };
}

export interface Band {
  mu: number;
  sd: number;
  lo: number;
  hi: number;
}
export const band = (c: Cell): Band => {
  const sd = Math.sqrt(c.v);
  return { mu: c.mu, sd, lo: Math.max(0, c.mu - 1.96 * sd), hi: c.mu + 1.96 * sd };
};

export function observe(w: World, p: number, m: number, days: number, ch: Channel): { before: Band; after: Band } {
  const c = w.nowcast[p * NM + m];
  const before = band(c);
  const u = normalUpdate(c.mu, c.v, Math.max(0, days), SIGMA[ch] ** 2);
  c.mu = u.mu;
  c.v = u.v;
  c.last = w.tick;
  c.src |= BIT[ch];
  c.n++;
  return { before, after: band(c) };
}

/** Observability score 0-100 from freshness, source diversity and CI tightness. */
export function observability(w: World, p: number): number {
  const cells = w.nowcast.slice(p * NM, p * NM + NM);
  const fresh = cells.map((c) => Math.exp(-(w.tick - c.last) / 10));
  const tight = cells.map((c) => clamp(1 - Math.sqrt(c.v) / 7, 0, 1));
  const blend = (a: number[]) => 0.5 * (a.reduce((s, x) => s + x, 0) / a.length) + 0.5 * Math.max(...a);
  const union = cells.reduce((s, c) => s | c.src, 0);
  let bits = 0;
  for (let b = 1; b <= 8; b <<= 1) if (union & b) bits++;
  return Math.round(100 * (0.4 * blend(fresh) + 0.25 * (bits / 4) + 0.35 * blend(tight)));
}

export const medName = (m: number) => MEDS[m].name;
