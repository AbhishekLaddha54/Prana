"use client";
import { useEffect, useMemo, useState } from "react";
import { Legend, LineChart } from "@/components/Charts";
import { useSim } from "@/components/SimContext";
import { ForecastData, LEVEL_LABEL, MED_NAMES, STATE_LABEL, api, rsColor, rsWord } from "@/components/types";
import { Loading, PageHead } from "@/components/ui";

export default function SpreadPage() {
  const { snap, selPair, setSelPair } = useSim();
  const [data, setData] = useState<ForecastData | null>(null);
  useEffect(() => { api<ForecastData>(`forecast?d=${selPair.d}&m=${selPair.m}`).then(setData).catch(() => {}); }, [selPair.d, selPair.m, snap?.tick]);

  const fc = useMemo(() => {
    if (!data) return null;
    const np = data.past.length;
    return {
      xs: [...data.past.map((p) => p.day), ...data.forecast.map((f) => f.day)],
      series: [
        { name: "What was used", color: "#3a86c8", data: [...data.past.map((p) => p.demand), ...data.forecast.map(() => null)] },
        { name: "What we expect", color: "#f0803c", dashed: true, data: [...new Array(np - 1).fill(null), data.past[np - 1].demand, ...data.forecast.map((f) => f.mean)],
          band: { lo: [...new Array(np).fill(null), ...data.forecast.map((f) => f.lo)], hi: [...new Array(np).fill(null), ...data.forecast.map((f) => f.hi)] } },
      ],
    };
  }, [data]);

  if (!snap) return <Loading />;
  const sel = snap.districts[selPair.d];
  const selRs = sel.rs[selPair.m];
  const vl = [];
  if (snap.outbreak.startDay != null) vl.push({ x: snap.outbreak.startDay + 1, label: "outbreak starts", color: "#e5484d" });
  if (snap.planner.approved) vl.push({ x: snap.planner.approved.day + 1, label: "plan approved", color: "#0f6b4f" });

  return (
    <div className="space-y-8">
      <PageHead eyebrow="Shortage Spread" title="Shortages spread like a cold — we measure how fast." tone="coral">
        When a clinic runs out, its patients walk to the next one and drain it too. The <b>spread score</b> tells you how many neighbouring districts a shortage is likely to knock out within a week.
      </PageHead>

      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["Below 0.8", "Calm", "The shortage stays where it is.", "#5fbf8a"],
          ["0.8 to 1", "Watch closely", "It is close to tipping into a chain reaction.", "#f0803c"],
          ["Above 1", "Spreading", "Each empty district knocks out more than one neighbour. Act now.", "#e5484d"],
        ].map(([r, t, d, c]) => (
          <div key={r} className="card flex items-start gap-4 p-5">
            <span className="mt-1 h-10 w-10 shrink-0 rounded-full" style={{ background: c }} />
            <div><div className="text-sm text-muted">Spread score {r}</div><div className="font-serif text-2xl font-bold">{t}</div><div className="text-sm text-muted">{d}</div></div>
          </div>
        ))}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="card overflow-hidden p-5 md:p-6">
          <h2 className="font-serif text-3xl font-bold">Every district, every medicine</h2>
          <p className="mb-4 text-muted">Click a square to see its forecast below. Numbers are spread scores.</p>
          <div className="overflow-x-auto">
            <table className="w-full border-separate border-spacing-1 text-center text-[12px]">
              <thead>
                <tr><th />{MED_NAMES.map((n) => <th key={n} className="px-1 pb-1 text-[11px] font-semibold text-muted">{n.replace("Iron+folic acid", "Iron")}</th>)}</tr>
              </thead>
              <tbody>
                {snap.districts.map((d) => (
                  <tr key={d.id}>
                    <th className="whitespace-nowrap pr-2 text-right text-[12px] font-semibold">{d.name}</th>
                    {d.rs.map((rs, m) => {
                      const on = selPair.d === d.idx && selPair.m === m;
                      return (
                        <td key={m}>
                          <button onClick={() => setSelPair({ d: d.idx, m })} title={`${MED_NAMES[m]} in ${d.name}: ${STATE_LABEL[d.states[m]]}`} className="h-9 w-full min-w-[46px] rounded-lg font-mono font-semibold transition hover:scale-105" style={{ background: rsColor(rs), opacity: rs < 0.05 ? 0.4 : 1, color: rs > 1 ? "#fff" : "#1d2b24", outline: on ? "3px solid #1d2b24" : "none", outlineOffset: 1 }}>
                            {rs < 0.005 ? "0" : rs.toFixed(2)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="card p-5 md:p-6">
          <h2 className="font-serif text-3xl font-bold">Alerts</h2>
          <p className="mb-3 text-muted">“Urgent” = spread score above 1. “Watch” = close, or a stock-out expected within 2 weeks.</p>
          <div className="max-h-[470px] space-y-2 overflow-auto pr-1">
            {snap.alerts.length === 0 && <div className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">Nothing to report. Start the outbreak from the bar below.</div>}
            {snap.alerts.map((a) => (
              <button key={a.id} onClick={() => setSelPair({ d: a.d, m: MED_NAMES.indexOf(a.med) })} className="fade-in w-full rounded-2xl border border-line bg-white p-3 text-left transition hover:shadow">
                <div className="mb-1 flex items-center gap-2 text-xs"><span className={`chip ${a.level === "CRITICAL" ? "bg-alert text-white" : "bg-sun-soft text-[#8a5f00]"}`}>{LEVEL_LABEL[a.level]}</span><span className="text-muted">day {a.day}</span></div>
                <div className="text-[13.5px] leading-snug">{a.text}</div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-serif text-3xl font-bold">Clinics that ran out, day by day</h2>
          <p className="mb-3 text-muted">Counts clinics with at least one medicine below one day of demand. Approve a plan to see what would have happened without it.</p>
          <LineChart xs={snap.curve.map((c) => c.day)} height={240} series={[
            ...(snap.planner.approved ? [{ name: "Without a plan", color: "#f0803c", dashed: true, data: snap.curve.map((c) => c.without) }] : []),
            { name: "Clinics out (what actually happens)", color: "#e5484d", data: snap.curve.map((c) => (c.so == null || Number.isNaN(c.so) ? null : c.so)) },
          ]} vlines={vl} xLabel="day" />
          <div className="mt-2"><Legend items={[{ name: "Clinics that ran out", color: "#e5484d" }, ...(snap.planner.approved ? [{ name: "Without a plan", color: "#f0803c", dashed: true }] : [])]} /></div>
        </section>

        <section className="card p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-3xl font-bold">{MED_NAMES[selPair.m]} in {sel.name}</h2>
              <p className="text-muted">{STATE_LABEL[sel.states[selPair.m]]} · spread score <b style={{ color: rsColor(selRs) }}>{selRs.toFixed(2)}</b> ({rsWord(selRs)}){data ? ` · may run out in ${data.dtso >= 60 ? "60+" : data.dtso.toFixed(0)} days` : ""}</p>
            </div>
          </div>
          <div className="mt-3">
            {fc ? <LineChart xs={fc.xs} series={fc.series} height={240} vlines={[{ x: snap.day + 1, label: "today" }]} xLabel="day · units used per day" /> : <div className="skeleton h-[240px]" />}
          </div>
          <div className="mt-2"><Legend items={[{ name: "What was used", color: "#3a86c8" }, { name: "What we expect (shaded = likely range)", color: "#f0803c", dashed: true }]} /></div>
        </section>
      </div>
    </div>
  );
}
