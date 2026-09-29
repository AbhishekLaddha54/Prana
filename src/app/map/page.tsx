"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Sparkline } from "@/components/Charts";
import { useSim } from "@/components/SimContext";
import { LEVEL_LABEL, MED_NAMES, STATE_LABEL, rsColor, rsWord } from "@/components/types";
import { Loading, PageHead } from "@/components/ui";

const MapView = dynamic(() => import("@/components/MapView"), { ssr: false, loading: () => <div className="skeleton h-full w-full" /> });

export default function MapPage() {
  const { snap, focus, fly, setStockFocus, setSelPair } = useSim();
  const router = useRouter();
  const [med, setMed] = useState(-1);
  if (!snap) return <Loading />;
  return (
    <div>
      <PageHead eyebrow="Live Map" title="Where is medicine running low?">
        Each shape is a district. Its colour shows how likely a shortage is to spread from there to its neighbours. Dots are clinics: bigger means more stock, faded means old information.
      </PageHead>

      <div className="mb-4 flex flex-wrap gap-2">
        <button className="pill-tab" data-on={med === -1} onClick={() => setMed(-1)}>All medicines</button>
        {MED_NAMES.map((n, i) => <button key={n} className="pill-tab" data-on={med === i} onClick={() => setMed(i)}>{n}</button>)}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="card relative overflow-hidden !rounded-[32px] p-2" style={{ height: 660 }}>
          <div className="h-full overflow-hidden rounded-[26px]">
            <MapView snap={snap} med={med} focus={focus} onPhc={(id) => { setStockFocus({ phc: id, med: med < 0 ? 0 : med }); router.push("/stock"); }} />
          </div>
          <div className="pointer-events-none absolute bottom-5 left-5 z-[500] rounded-2xl border border-line bg-paper/95 px-4 py-3 text-xs shadow">
            <div className="mb-1.5 font-bold">Chance a shortage spreads from here</div>
            <div className="flex items-center gap-3">
              {[["Calm", 0], ["Low", 0.2], ["Some", 0.5], ["High", 0.85], ["Spreading", 1.2]].map(([l, v]) => (
                <span key={String(l)} className="flex items-center gap-1"><i className="inline-block h-3 w-3 rounded-full" style={{ background: rsColor(Number(v)) }} />{l}</span>
              ))}
            </div>
            <div className="mt-1.5 text-muted">Red pulsing dot = clinic has run out · red dashed line = patients spilling over</div>
          </div>
          {snap.outbreak.active && (
            <div className="absolute left-5 top-5 z-[500] chip bg-coral-soft text-[#b3391f] shadow"><span className="h-2 w-2 animate-pulse rounded-full bg-alert" />{snap.outbreak.label} since day {snap.outbreak.startDay} · {snap.outbreak.infectedPhcs} clinics affected</div>
          )}
        </div>

        <div className="space-y-5">
          <section className="card p-5">
            <h2 className="font-serif text-2xl font-bold">Needs attention now</h2>
            <p className="mb-3 text-sm text-muted">The five district–medicine pairs with the highest spread score.</p>
            <div className="space-y-2">
              {snap.leaderboard.map((r, i) => (
                <button key={i} onClick={() => { const d = snap.districts[r.d]; fly(d.lat, d.lng, 8.75); setSelPair({ d: r.d, m: r.m }); }} className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white p-3 text-left transition hover:-translate-y-0.5 hover:shadow">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full font-serif font-bold text-white" style={{ background: rsColor(r.rs) }}>{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{MED_NAMES[r.m]} · {snap.districts[r.d].name}</div>
                    <div className="text-xs text-muted">{STATE_LABEL[r.state]} · {rsWord(r.rs)}</div>
                  </div>
                  <Sparkline data={r.spark} color={rsColor(r.rs)} w={62} />
                  <div className="w-11 text-right font-mono text-sm font-bold" style={{ color: rsColor(r.rs) }}>{r.rs.toFixed(2)}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-2xl font-bold">Alerts</h2>
              <span className="chip bg-coral-soft text-[#b3391f]">{snap.alerts.filter((a) => a.level === "CRITICAL").length} urgent</span>
            </div>
            <div className="mt-3 max-h-[260px] space-y-2 overflow-auto pr-1">
              {snap.alerts.length === 0 && <div className="rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted">All quiet. Start the dengue outbreak from the bar at the bottom to see alerts appear.</div>}
              {snap.alerts.slice(0, 12).map((a) => (
                <button key={a.id} onClick={() => { fly(a.lat, a.lng, 8.75); setSelPair({ d: a.d, m: MED_NAMES.indexOf(a.med) }); }} className="fade-in w-full rounded-2xl border border-line bg-white p-3 text-left transition hover:shadow">
                  <div className="mb-1 flex items-center gap-2 text-xs">
                    <span className={`chip ${a.level === "CRITICAL" ? "bg-alert text-white" : "bg-sun-soft text-[#8a5f00]"}`}>{LEVEL_LABEL[a.level]}</span>
                    <span className="text-muted">day {a.day}</span>
                  </div>
                  <div className="text-[13.5px] leading-snug">{a.text}</div>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
