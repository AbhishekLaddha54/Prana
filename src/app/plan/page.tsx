"use client";
import Link from "next/link";
import { LineChart } from "@/components/Charts";
import { useSim } from "@/components/SimContext";
import { MED_NAMES, Plan } from "@/components/types";
import { Loading, PageHead } from "@/components/ui";

const TONE: Record<string, { c: string; bg: string; label: string; blurb: string }> = {
  BALANCED: { c: "#0f6b4f", bg: "bg-moss-soft", label: "Balanced", blurb: "A fair mix of speed, cost and keeping donor districts safe." },
  FASTEST: { c: "#3a86c8", bg: "bg-sky-soft", label: "Fastest", blurb: "Gets supplies there as quickly as possible." },
  CHEAPEST: { c: "#c98a00", bg: "bg-sun-soft", label: "Cheapest", blurb: "Uses the fewest truck kilometres." },
};

export default function PlanPage() {
  const { snap, planBusy, planHl, runPlanner, approvePlan, rejectPlans } = useSim();
  if (!snap) return <Loading />;
  const plans = snap.planner.plans as Plan[] | null;
  const approved = snap.planner.approved;
  const D = snap.districts;
  return (
    <div className="space-y-8">
      <PageHead eyebrow="Action Plans" title="Three ways to fix it. You choose one." tone="moss">
        When a shortage starts spreading, Prana works out which districts have spare stock and which need it, then proposes three truck plans. Nothing moves until a person presses <b>Approve</b>.
      </PageHead>

      <section className={`card flex flex-wrap items-center gap-4 p-5 ${snap.planner.triggered ? "!border-alert" : ""}`}>
        {approved ? (
          <><span className="chip bg-moss text-white">Approved</span><div className="flex-1"><b>{TONE[approved.name].label} plan</b> was approved on day {approved.day}. Trucks are moving — you can watch them on the map.</div><Link href="/map" className="btn btn-primary btn-sm">Watch trucks on the map →</Link><Link href="/spread" className="btn btn-sm">See the curves split →</Link></>
        ) : snap.planner.triggered ? (
          <><span className="chip throb bg-alert text-white">Urgent</span><div className="flex-1">A shortage is spreading. Three plans were made automatically on day {snap.planner.plansDay}. Compare them and approve one.</div></>
        ) : (
          <><span className="chip bg-line text-muted">Nothing urgent</span><div className="flex-1 text-muted">Plans appear automatically when a shortage starts spreading. You can also ask for plans right now.</div></>
        )}
        {!approved && <button className="btn btn-coral" disabled={planBusy} onClick={runPlanner}>{planBusy ? <><span className="spinner" style={{ borderTopColor: "#fff" }} /> Working it out…</> : plans ? "↻ Make fresh plans" : "Make plans now"}</button>}
      </section>

      {!plans ? (
        <div className="card p-12 text-center text-muted"><div className="font-serif text-2xl font-bold text-ink">No plans yet</div><p className="mt-2">Start the dengue outbreak from the bar below and let a few days pass, or press “Make plans now”.</p></div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-3">
          {plans.map((p) => {
            const t = TONE[p.name];
            const e = p.effect;
            const hl = planHl === p.name;
            return (
              <article key={p.id} className={`card rise flex flex-col gap-4 p-6 transition-all ${hl ? "ring-4 ring-moss/50" : ""}`} style={{ borderColor: t.c + "88", borderWidth: 2 }}>
                <div className="flex items-start justify-between">
                  <div><h2 className="font-serif text-3xl font-bold" style={{ color: t.c }}>{t.label}</h2><p className="text-sm text-muted">{t.blurb}</p></div>
                  {p.name === "BALANCED" && <span className="chip bg-moss text-white">Our pick</span>}
                </div>

                <div className="grid grid-cols-4 gap-2 text-center">
                  {[[p.shipments.length, "deliveries"], [Math.round(p.totalUnits).toLocaleString(), "units moved"], [`₹${Math.round(p.totalCost / 1000)}k`, "cost"], [`${Math.round(p.maxEtaH)}h`, "longest trip"]].map(([v, l]) => (
                    <div key={String(l)} className={`rounded-2xl ${t.bg} px-1 py-2`}><div className="font-serif text-xl font-bold">{v}</div><div className="text-[11px] text-muted">{l}</div></div>
                  ))}
                </div>

                <div className="rounded-2xl border border-line bg-white p-4">
                  <div className="text-xs font-bold uppercase tracking-wide text-muted">What-if replay · next 3 weeks</div>
                  <div className="mt-2 flex items-baseline gap-2"><span className="text-sm text-muted">Spread score</span><span className="font-serif text-2xl font-bold text-alert">{e.rsWithout.toFixed(1)}</span><span className="text-muted">→</span><span className="font-serif text-2xl font-bold text-moss">{e.rsWith.toFixed(1)}</span></div>
                  <div className="text-sm">Days until it runs out: <b>{Math.min(30, e.dtsoWithout).toFixed(0)}</b> → <b className="text-moss">{Math.min(30, e.dtsoWith).toFixed(0)}{e.dtsoWith >= 30 ? "+" : ""}</b></div>
                  <div className="mt-1 text-sm">Patient-days without medicine avoided: <b className="text-moss">{Math.round(e.patientDaysAvoided).toLocaleString()}</b></div>
                  <div className="mt-2"><LineChart xs={e.series.with.map((_, i) => i + 1)} height={70} series={[{ name: "no plan", color: "#f0803c", dashed: true, data: e.series.without, width: 1.8 }, { name: "with plan", color: t.c, data: e.series.with, width: 2.4 }]} /></div>
                  <div className="text-[11px] text-muted">Dashed = clinics out without a plan · solid = with this plan</div>
                </div>

                <p className="text-[14.5px] leading-relaxed">{p.explanation}</p>

                <details className="rounded-2xl border border-line bg-white">
                  <summary className="cursor-pointer px-4 py-2.5 text-sm font-semibold">See all {p.shipments.length} deliveries</summary>
                  <div className="max-h-[180px] overflow-auto px-4 pb-3">
                    <table className="w-full text-[12px]">
                      <tbody>
                        {p.shipments.map((s, i) => (
                          <tr key={i} className="border-t border-line">
                            <td className="py-1.5">{D[s.from].name} → <b>{D[s.to].name}</b></td>
                            <td>{MED_NAMES[s.m]}{s.cold ? " ❄" : ""}</td>
                            <td className="text-right font-mono">{Math.round(s.units).toLocaleString()}</td>
                            <td className="text-right font-mono text-muted">{Math.round(s.hours)}h</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="mt-1 text-[11px] text-muted">❄ = needs a fridge truck (insulin, oxytocin)</div>
                  </div>
                </details>
                {p.unserved.length > 0 && <div className="rounded-xl bg-sun-soft p-2 text-xs text-[#8a5f00]">Not fully covered: {p.unserved.map((u) => `${D[u.d].name} ${MED_NAMES[u.m]}`).join(", ")}</div>}

                <div className="mt-auto flex gap-2">
                  <button className="btn btn-primary flex-1" disabled={!!approved || planBusy} onClick={() => approvePlan(p.name)}>✓ Approve</button>
                  <button className="btn flex-1" disabled={!!approved || planBusy} onClick={rejectPlans}>✕ Reject all</button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
