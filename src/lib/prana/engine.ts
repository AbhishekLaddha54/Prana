// Session facade: holds the in-memory demo state and builds API payloads.
import { HIST_DAYS, MEDS, ND, NM, NP, OUTBREAKS, SEED, getGeo } from "./core";
import { forecastDemand } from "./analysis";
import { aiStatus, aiText, hasAI } from "./ai";
import { CONFIRM_LAG, MeshState, NATIONS, SIG_NAMES, buildLibrary, liveMatches, newMesh, runRound } from "./mesh";
import { band, observability } from "./nowcast";
import { Plan, applyShips, generatePlans, projectNoPlan, shipsFromPlan } from "./planner";
import { createWorld, dayOf, injectOutbreak, step } from "./sim";
import { World } from "./world";

interface Session {
  w: World;
  mesh: MeshState;
  plans: Plan[] | null;
  plansTick: number;
  approved: { name: string; planId: string; tick: number } | null;
  triggerAlert: number;
  lastCrit: number;
  obsLog: Record<string, { tick: number; mu: number; lo: number; hi: number; sd: number }[]>;
  meshSeries: { tick: number; sims: Record<string, number> }[];
  detectTick: number | null;
  detectId: string | null;
  origin: number;
  injected: boolean;
}

const G = globalThis as unknown as { __prana?: Session };

function fresh(): Session {
  const w = createWorld(SEED, HIST_DAYS);
  const s: Session = { w, mesh: newMesh(), plans: null, plansTick: -1, approved: null, triggerAlert: 0, lastCrit: 0, obsLog: {}, meshSeries: [], detectTick: null, detectId: null, origin: 3, injected: false };
  recordBands(s);
  return s;
}
export function recordAll(): void {
  recordBands(S());
}
export function S(): Session {
  if (!G.__prana) G.__prana = fresh();
  return G.__prana;
}
export function resetSession(): void {
  G.__prana = fresh();
}

function recordBands(s: Session, only?: number[]) {
  const keys = only ?? s.w.nowcast.map((_, i) => i);
  for (const i of keys) {
    const b = band(s.w.nowcast[i]);
    const log = (s.obsLog[i] ??= []);
    const last = log[log.length - 1];
    if (last && last.tick === s.w.tick) log[log.length - 1] = { tick: s.w.tick, mu: b.mu, lo: b.lo, hi: b.hi, sd: b.sd };
    else log.push({ tick: s.w.tick, mu: b.mu, lo: b.lo, hi: b.hi, sd: b.sd });
    if (log.length > 90) log.shift();
  }
}

export async function tick(n = 1): Promise<void> {
  const s = S();
  for (let i = 0; i < n; i++) {
    step(s.w);
    recordBands(s);
    const lm = liveMatches(s.w, s.mesh);
    if (lm) {
      const sims: Record<string, number> = {};
      lm.matches.forEach((m) => (sims[m.id] = m.sim));
      s.meshSeries.push({ tick: s.w.tick, sims });
      const best = lm.matches.filter((m) => m.foreign).sort((a, b) => b.sim - a.sim)[0];
      if (s.detectTick == null && best && best.sim >= 0.85) { s.detectTick = s.w.tick; s.detectId = best.id; }
    }
    const crit = s.w.alerts.filter((a) => a.level === "CRITICAL" && a.id > s.lastCrit);
    if (crit.length) {
      s.lastCrit = Math.max(...crit.map((a) => a.id));
      if (!s.approved) {
        s.triggerAlert = crit[0].id;
        s.plans = await generatePlans(s.w);
        s.plansTick = s.w.tick;
      }
    }
  }
}

export function inject(): boolean {
  const s = S();
  const ok = injectOutbreak(s.w, "dengue_para", s.origin);
  if (ok) s.injected = true;
  return ok;
}

export async function runPlanner(): Promise<Plan[]> {
  const s = S();
  s.plans = await generatePlans(s.w);
  s.plansTick = s.w.tick;
  return s.plans;
}
export function approvePlan(name: string): Plan | null {
  const s = S();
  const plan = s.plans?.find((p) => p.name === name);
  if (!plan || s.approved) return null;
  s.w.shadow = { start: s.w.tick, so: projectNoPlan(s.w, 40) };
  applyShips(s.w, shipsFromPlan(s.w, plan));
  s.approved = { name: plan.name, planId: plan.id, tick: s.w.tick };
  return plan;
}
export function rejectPlans(): void {
  const s = S();
  s.plans = null;
  s.triggerAlert = 0;
}

function dateOf(day: number): string {
  const d = new Date(Date.UTC(2025, 5, 2 + day));
  return d.toISOString().slice(0, 10);
}

export function snapshot() {
  const s = S();
  const w = s.w;
  const g = getGeo(w.seed);
  const day = dayOf(w);
  const A = w.analysis;
  const sev = { ADEQUATE: 0, RECOVERED: 0, STRESSED: 1, STOCKED_OUT: 2 } as const;
  const districts = g.districts.map((d) => {
    const ps = A.slice(d.idx * NM, d.idx * NM + NM);
    const worst = ps.reduce((b, p) => (p.rs > b.rs ? p : b), ps[0]);
    const st = ps.reduce((b, p) => (sev[p.state] > sev[b.state] ? p : b), ps[0]);
    return {
      id: d.id, idx: d.idx, name: d.name, lat: d.lat, lng: d.lng, pop: d.pop, poly: d.poly, coldHub: d.coldHub,
      worstRs: worst.rs, worstMed: worst.m, state: st.state, rs: ps.map((p) => p.rs), states: ps.map((p) => p.state),
      dtso: ps.map((p) => p.dtso), level: Math.max(...ps.map((p) => p.level)),
    };
  });
  const phcs = g.phcs.map((p) => {
    const dos: number[] = [];
    const so: boolean[] = [];
    const ci: { mu: number; lo: number; hi: number }[] = [];
    for (let m = 0; m < NM; m++) {
      const i = p.idx * NM + m;
      dos.push(w.stock[i] / Math.max(w.dem[i], 1e-6));
      so.push(w.stock[i] < w.dem[i]);
      const b = band(w.nowcast[i]);
      ci.push({ mu: b.mu, lo: b.lo, hi: b.hi });
    }
    return {
      id: p.id, idx: p.idx, d: p.d, name: p.name, lat: p.lat, lng: p.lng, beds: Math.round(w.beds[p.idx]), nurses: w.nurses[p.idx],
      obs: observability(w, p.idx), dos, so, ci, infected: w.out.infected[p.idx] >= 0,
    };
  });
  const edges: [number, number][] = [];
  g.phcs.forEach((p) => p.nbrs.forEach((q) => q > p.idx && edges.push([p.idx, q])));
  const flowMap = new Map<string, { a: number; b: number; amt: number }>();
  for (const f of w.flows) {
    const k = f.a + "-" + f.b;
    const c = flowMap.get(k);
    if (c) c.amt += f.amt; else flowMap.set(k, { a: f.a, b: f.b, amt: f.amt });
  }
  const top = [...A].sort((a, b) => b.rs - a.rs).slice(0, 5).map((a) => {
    const spark: number[] = [];
    const n = w.hist.dmRs.length;
    for (let t = Math.max(0, n - 30); t < n; t++) spark.push(w.hist.dmRs[t][a.d * NM + a.m]);
    return { d: a.d, m: a.m, rs: a.rs, state: a.state, dtso: a.dtso, level: a.level, spark };
  });
  const from = Math.max(0, w.hist.so.length - 14 - Math.max(day, 0) - 0);
  void from;
  const curve: { day: number; so: number; without: number | null }[] = [];
  for (let t = w.t0 - 10; t < w.hist.so.length; t++) {
    const wo = w.shadow && t >= w.shadow.start ? w.shadow.so[t - w.shadow.start] ?? null : null;
    curve.push({ day: t - w.t0 + 1, so: w.hist.so[t], without: wo });
  }
  if (w.shadow) {
    for (let k = w.hist.so.length - w.shadow.start; k < w.shadow.so.length; k++) curve.push({ day: w.shadow.start + k - w.t0 + 1, so: NaN, without: w.shadow.so[k] });
  }
  const ships = w.ships.map((sh) => ({
    id: sh.id, from: sh.from, to: sh.to, m: sh.m, units: sh.units, progress: Math.min(1, (w.tick - sh.depart) / Math.max(1, sh.arrive - sh.depart)),
    fromLL: [g.districts[sh.from].lat, g.districts[sh.from].lng], toLL: [g.districts[sh.to].lat, g.districts[sh.to].lng],
  }));
  const lm = liveMatches(w, s.mesh);
  const best = lm?.matches.filter((m) => m.foreign).sort((a, b) => b.sim - a.sim)[0] ?? null;
  return {
    ai: hasAI(),
    tick: w.tick, day, date: dateOf(day),
    outbreak: { active: !!w.out.kind, label: w.out.kind ? OUTBREAKS[w.out.kind].label : null, startDay: w.out.kind ? w.out.start - w.t0 : null, infectedPhcs: w.out.infected.filter((x) => x >= 0).length },
    districts, phcs, edges, flows: [...flowMap.values()].filter((f) => f.amt > 0.5), ships,
    alerts: [...w.alerts].reverse().slice(0, 50).map((a) => ({ ...a, day: a.tick - w.t0, lat: g.districts[a.d].lat, lng: g.districts[a.d].lng, dId: g.districts[a.d].id, med: MEDS[a.m].name })),
    leaderboard: top, curve,
    planner: {
      triggered: s.triggerAlert > 0 && !s.approved, plans: s.plans, plansDay: s.plansTick - w.t0, approved: s.approved ? { ...s.approved, day: s.approved.tick - w.t0 } : null,
    },
    meshBrief: best ? { id: best.id, sim: best.sim, peakMult: best.peakMult, daysToPeak: best.daysToPeak, detectDay: s.detectTick != null ? s.detectTick - w.t0 : null } : null,
    stats: { phcs: NP, districts: ND, stockedOutPhcs: w.hist.so[w.hist.so.length - 1] ?? 0 },
  };
}

export function nowcastDetail(phcId: string, medId: string) {
  const s = S();
  const w = s.w;
  const p = getGeo(w.seed).phcs.findIndex((x) => x.id === phcId);
  const m = MEDS.findIndex((x) => x.id === medId);
  if (p < 0 || m < 0) return null;
  const i = p * NM + m;
  const c = w.nowcast[i];
  const b = band(c);
  return {
    phc: phcId, medicine: MEDS[m].name, current: b, observations: c.n, sources: c.src, ageDays: w.tick - c.last, observability: observability(w, p),
    truthDays: w.stock[i] / Math.max(w.dem[i], 1e-6),
    log: (s.obsLog[i] ?? []).map((e) => ({ ...e, day: e.tick - w.t0 })),
  };
}

export function forecastDetail(d: number, m: number) {
  const s = S();
  const w = s.w;
  const past: { day: number; demand: number }[] = [];
  const n = w.hist.dmDem.length;
  for (let t = Math.max(0, n - 30); t < n; t++) past.push({ day: t - w.t0 + 1, demand: w.hist.dmDem[t][d * NM + m] });
  const f = forecastDemand(w, d, m, 14);
  const fc = f.mean.map((mu, h) => ({ day: w.tick - w.t0 + h + 1, mean: mu, lo: Math.max(0, mu - 1.96 * f.sd[h]), hi: mu + 1.96 * f.sd[h] }));
  const a = w.analysis[d * NM + m];
  return { district: getGeo(w.seed).districts[d].id, medicine: MEDS[m].name, past, forecast: fc, dtso: a.dtso, rs: a.rs, state: a.state };
}

export function meshDetail() {
  const s = S();
  const w = s.w;
  const lib = buildLibrary();
  const lm = liveMatches(w, s.mesh);
  const best = lm?.matches.filter((m) => m.foreign).sort((a, b) => b.sim - a.sim)[0] ?? null;
  // head-to-head forecast for the origin district / primary medicine
  const P = 0;
  const o = w.out.start;
  const series: { day: number; actual: number | null; withMesh: number | null; without: number | null }[] = [];
  if (w.out.kind) {
    const b0 = Math.max(0, o - 14);
    const base = w.hist.dmDem.slice(b0, o).reduce((sum, x) => sum + x[s.origin * NM + P], 0) / Math.max(1, o - b0);
    const entry = lib.find((e) => e.id === (s.detectId ?? best?.id));
    const now = w.tick - 1;
    for (let t = o - 3; t <= now + 12; t++) {
      const age = t - o;
      const curve = entry ? entry.curve[Math.min(entry.curve.length - 1, Math.max(0, age))] : 1;
      const detected = s.detectTick != null && t >= s.detectTick - 1;
      const confirmed = s.detectTick != null && t >= s.detectTick + CONFIRM_LAG;
      series.push({
        day: t - w.t0 + 1,
        actual: t <= now ? w.hist.dmDem[t][s.origin * NM + P] : null,
        withMesh: entry && detected && t >= now ? base * curve : null,
        without: entry && t >= now ? (confirmed ? base * curve : base) : null,
      });
    }
  }
  return {
    nations: NATIONS.map((n) => ({ ...n })),
    features: SIG_NAMES,
    library: lib.map((e) => ({ id: e.id, nation: e.nation, label: e.label, sig: e.sig, shared: s.mesh.shared[e.nation] ?? e.sig, peakMult: e.peakMult, daysToPeak: e.daysToPeak, medicine: e.medicine, curve: e.curve })),
    rounds: s.mesh.rounds, dp: s.mesh.dp, global: s.mesh.global, epsilon: 4,
    live: lm ? { sig: lm.sig, matches: lm.matches } : null,
    headline: best
      ? { text: `This looks like ${NATIONS.find((n) => n.id === best.nation)?.name ?? best.nation}’s past outbreak (${best.label}). Expect demand to reach about ${best.peakMult.toFixed(1)}× normal within ${best.daysToPeak} days.`, sim: best.sim, id: best.id, peakMult: best.peakMult, daysToPeak: best.daysToPeak }
      : null,
    detectDay: s.detectTick != null ? s.detectTick - w.t0 : null,
    confirmLag: CONFIRM_LAG,
    series,
    simSeries: s.meshSeries.map((x) => ({ day: x.tick - w.t0, ...x.sims })),
  };
}

export function meshRound(dp: boolean) {
  const s = S();
  runRound(s.mesh, dp);
  return meshDetail();
}

// ------------------------------------------------- AI helpers: grounded chat + daily briefing
const MED_NAMES_TXT = MEDS.map((m) => m.name);
function facts(): string {
  const s = snapshot();
  const names = (d: number) => getGeo(SEED).districts[d].name;
  const top = s.leaderboard.map((r, i) => `${i + 1}. ${MED_NAMES_TXT[r.m]} in ${names(r.d)}: spread score ${r.rs.toFixed(2)}, ${r.state.toLowerCase().replace("_", " ")}, about ${Math.round(r.dtso)} days of stock left`).join("\n");
  const alerts = s.alerts.slice(0, 6).map((a) => `- [${a.level}] day ${a.day}: ${a.text}`).join("\n") || "- none";
  const outCount = s.phcs.filter((p) => p.so.some(Boolean)).length;
  const low = s.phcs.filter((p) => Math.min(...p.dos) < 7).length;
  return [
    `Region: Demo Pradesh, 12 districts, 60 clinics, 8 medicines.`,
    `Simulation day ${s.day} (${s.date}).`,
    `Outbreak: ${s.outbreak.active ? `${s.outbreak.label} since day ${s.outbreak.startDay}, ${s.outbreak.infectedPhcs} clinics affected` : "none active"}.`,
    `Clinics that ran out of at least one medicine: ${outCount}. Clinics under 7 days of stock: ${low}.`,
    `Plans: ${s.planner.approved ? `${s.planner.approved.name} approved on day ${s.planner.approved.day}` : s.planner.plans ? "3 plans ready, waiting for a human to approve one" : "not generated yet"}.`,
    s.meshBrief ? `Country network: closest match ${s.meshBrief.id} at ${Math.round(s.meshBrief.sim * 100)}% similar, expected peak ${s.meshBrief.peakMult.toFixed(1)}x demand in ${s.meshBrief.daysToPeak} days.` : "Country network: no match yet.",
    `Most at-risk district-medicine pairs:\n${top}`,
    `Recent alerts:\n${alerts}`,
  ].join("\n");
}

export interface ChatReply { answer: string; mode: "live" | "mock"; error?: string }

/** Answers questions about the current situation. Always grounded in live numbers. */
export async function ask(question: string, history: { role: string; text: string }[] = []): Promise<ChatReply> {
  const f = facts();
  if (hasAI()) {
    const convo = history.slice(-6).map((h) => `${h.role === "user" ? "Officer" : "Prana"}: ${h.text}`).join("\n");
    const txt = await aiText(
      "You are Prana, an assistant inside a medicine supply control room for a poor rural region. " +
      "Answer in plain English, short paragraphs, no jargon and no markdown tables. Use ONLY the facts given — if something is not in the facts, say you do not know. " +
      "Give concrete next actions where relevant. Never invent numbers.",
      `${f}\n\nConversation so far:\n${convo}\n\nOfficer: ${question}\nPrana:`,
    );
    if (txt) return { answer: txt, mode: "live" };
  }
  return { answer: offlineAnswer(question, f), mode: "mock", error: aiStatus().lastError ?? undefined };
}

function offlineAnswer(q: string, facts: string): string {
  const s = snapshot();
  const names = (d: number) => getGeo(SEED).districts[d].name;
  const t = q.toLowerCase();
  const head = "*(Offline helper — add a Gemini API key for full answers.)*\n\n";
  const lines = s.leaderboard.slice(0, 3).map((r) => `• ${MED_NAMES_TXT[r.m]} in ${names(r.d)} — spread score ${r.rs.toFixed(2)}, about ${Math.round(r.dtso)} days left`);
  if (/plan|do|action|recommend|fix|send/.test(t)) {
    const done = s.planner.approved ? `${s.planner.approved.name} was already approved on day ${s.planner.approved.day}; let the trucks arrive before judging it.` : "Open Action Plans and approve the balanced plan — it is the one that keeps every donor district safe.";
    return head + `What I would do now:\n1. ${done}\n2. Keep stock moving to the districts below.\n3. Re-check the spread score tomorrow.\n\n${lines.join("\n")}`;
  }
  if (/why|cause|spread|happen/.test(t)) {
    return head + `A clinic that runs out does not stop demand — its patients walk to the next clinic and drain that one too. We track that as a spread score: above 1 means each empty district is likely to knock out more than one neighbour within a week.\n\n${lines.join("\n")}`;
  }
  if (/who|which|where|worst|risk/.test(t)) return head + `The districts that need attention first are:\n${lines.join("\n")}`;
  return head + `Here is the situation on day ${s.day}: ${s.outbreak.active ? `${s.outbreak.label} is running and ${s.outbreak.infectedPhcs} clinics are affected` : "no outbreak is active"}, ${s.stats.stockedOutPhcs} clinics have run out of something.\n\nMost at risk:\n${lines.join("\n")}\n\nFull snapshot used for this answer:\n${facts.slice(0, 700)}`;
}

/** Short written summary of today's numbers. */
export async function briefing(): Promise<ChatReply> {
  const f = facts();
  if (hasAI()) {
    const txt = await aiText(
      "You are Prana. Write a daily briefing for a district health officer in 3 short bullets (max 40 words each), plain English, no jargon, no headings, start each bullet with '•'. Use ONLY the facts given.",
      f,
    );
    if (txt) return { answer: txt, mode: "live" };
  }
  const s = snapshot();
  const names = (d: number) => getGeo(SEED).districts[d].name;
  const worst = s.leaderboard[0];
  const b = [
    `• Day ${s.day}: ${s.outbreak.active ? `${s.outbreak.label} has reached ${s.outbreak.infectedPhcs} clinics` : "no outbreak is active"}.`,
    `• ${s.stats.stockedOutPhcs} clinics have run out of at least one medicine.`,
    worst ? `• Most urgent: ${MED_NAMES_TXT[worst.m]} in ${names(worst.d)}, spread score ${worst.rs.toFixed(2)} — about ${Math.round(worst.dtso)} days of stock left.` : "• Nothing urgent right now.",
  ];
  return { answer: b.join("\n"), mode: "mock", error: aiStatus().lastError ?? undefined };
}

export const aiInfo = () => aiStatus();
