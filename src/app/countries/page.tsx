"use client";
import { useCallback, useEffect, useState } from "react";
import { Legend, LineChart } from "@/components/Charts";
import { useSim } from "@/components/SimContext";
import { MeshData, api } from "@/components/types";
import { Loading, PageHead } from "@/components/ui";

const COLORS: Record<string, string> = { IND: "#f0803c", BRA: "#0f6b4f", ZAF: "#7c5cbf" };
const FLAG: Record<string, string> = { IND: "🇮🇳", BRA: "🇧🇷", ZAF: "🇿🇦" };
const NICE: Record<string, string> = { "IND-Dengue-2019": "India · dengue 2019", "BRA-Dengue-2024": "Brazil · dengue 2024", "ZAF-Flood-2023": "South Africa · floods 2023" };

function Bars({ v, color, names }: { v: number[]; color: string; names: string[] }) {
  return (
    <div className="flex h-20 items-end gap-1">
      {v.map((x, i) => <div key={i} title={names[i]} className="flex-1 rounded-t-md transition-all duration-500" style={{ height: `${Math.max(4, x * 100)}%`, background: color }} />)}
    </div>
  );
}

export default function CountriesPage() {
  const { snap, meshMode, setMeshMode } = useSim();
  const [mesh, setMesh] = useState<MeshData | null>(null);
  const [busy, setBusy] = useState(false);
  const [dp, setDp] = useState(false);
  const [tip, setTip] = useState(false);
  const load = useCallback(async () => { try { const m = await api<MeshData>("mesh"); setMesh(m); } catch { /* ignore */ } }, []);
  useEffect(() => { load(); }, [load, snap?.tick]);
  useEffect(() => { if (mesh) setDp(mesh.dp); }, [mesh?.dp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!snap || !mesh) return <Loading />;
  const ids = mesh.library.map((l) => l.id);
  const sx = mesh.simSeries.map((s) => s.day);
  const sims = ids.map((id) => ({ name: NICE[id], color: COLORS[id.slice(0, 3)], width: id === mesh.headline?.id ? 3.4 : 1.8, opacity: id === mesh.headline?.id ? 1 : 0.65, data: mesh.simSeries.map((s) => (s as unknown as Record<string, number>)[id] ?? null) }));
  const hx = mesh.series.map((s) => s.day);
  const withMesh = meshMode === "with";
  const hs = [
    { name: "What clinics actually used", color: "#3a86c8", data: mesh.series.map((s) => s.actual) },
    ...(withMesh
      ? [{ name: "Forecast without the network", color: "#f0803c", dashed: true, opacity: 0.6, data: mesh.series.map((s) => s.without) }, { name: "Forecast with the network", color: "#0f6b4f", width: 3.4, data: mesh.series.map((s) => s.withMesh) }]
      : [{ name: "Forecast without the network (stays flat)", color: "#f0803c", dashed: true, width: 3, data: mesh.series.map((s) => s.without) }]),
  ];
  const noOutbreak = mesh.series.length === 0;

  return (
    <div className="space-y-8">
      <PageHead eyebrow="Country Network" title="Recognise a new outbreak by learning from others." tone="lilac">
        Each country turns a past outbreak into a small <b>fingerprint</b> — just 12 numbers. Only those numbers are shared, never patient or stock records. When a new outbreak starts, we compare its fingerprint to everyone else’s.
      </PageHead>

      <section className="card grid gap-6 p-6 md:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="text-sm font-semibold text-muted">What the network says right now</div>
          <div className="mt-1 font-serif text-3xl font-bold leading-snug md:text-4xl">{mesh.headline ? mesh.headline.text : "Nothing to compare yet — start the dengue outbreak from the bar below."}</div>
        </div>
        {mesh.headline && <div className="rounded-3xl bg-lilac-soft px-8 py-5 text-center"><div className="font-serif text-6xl font-bold text-[#5a3ea0]">{Math.round(mesh.headline.sim * 100)}%</div><div className="text-sm text-muted">similar</div></div>}
      </section>

      <section className="card p-6 md:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <div className="mr-auto">
            <h2 className="font-serif text-3xl font-bold">Forecast: with vs. without the network</h2>
            <p className="text-muted">Without a matching fingerprint, a new outbreak needs about {mesh.confirmLag} days of data before the forecast reacts. With one, it reacts straight away.</p>
          </div>
          <div className="inline-flex rounded-full border-2 border-ink p-1">
            <button className={`rounded-full px-5 py-2 text-sm font-bold transition ${!withMesh ? "bg-sun text-ink" : "text-muted"}`} onClick={() => setMeshMode("without")}>Without network</button>
            <button className={`rounded-full px-5 py-2 text-sm font-bold transition ${withMesh ? "bg-moss text-white" : "text-muted"}`} onClick={() => setMeshMode("with")}>With network</button>
          </div>
        </div>
        <div className="mt-5">
          {noOutbreak
            ? <div className="flex h-[260px] items-center justify-center rounded-2xl border border-dashed border-line text-muted">This chart appears once an outbreak starts.</div>
            : <LineChart xs={hx} series={hs} height={280} vlines={mesh.detectDay != null ? [{ x: mesh.detectDay + 1, label: "match found", color: "#0f6b4f" }] : []} xLabel="day · paracetamol used per day in Shivgarh" />}
        </div>
        {!noOutbreak && <div className="mt-2"><Legend items={hs.map((s) => ({ name: s.name, color: s.color, dashed: "dashed" in s ? s.dashed : false }))} /></div>}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="card p-6">
          <h2 className="font-serif text-3xl font-bold">How similar is today’s outbreak?</h2>
          <p className="mb-3 text-muted">Match score against each country’s fingerprint, day by day. Above 85% counts as a match.</p>
          {sx.length > 1
            ? <LineChart xs={sx} series={sims} height={230} yMin={0} yMax={1} hlines={[{ y: 0.85, label: "match line (85%)", color: "#0f6b4f" }]} xLabel="day" />
            : <div className="flex h-[230px] items-center justify-center rounded-2xl border border-dashed border-line text-muted">Waiting for an outbreak…</div>}
          <div className="mt-2"><Legend items={sims.map((s) => ({ name: s.name, color: s.color }))} /></div>
        </section>

        <section className="card p-6">
          <h2 className="font-serif text-3xl font-bold">Share fingerprints</h2>
          <p className="mb-4 text-muted">Each round, every country sends its 12 numbers. The server simply averages them into one shared fingerprint.</p>
          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { setMesh(await api<MeshData>("mesh/round", { dp })); } finally { setBusy(false); } }}>{busy ? <><span className="spinner" style={{ borderTopColor: "#fff" }} /> Averaging…</> : `Run sharing round ${mesh.rounds + 1}`}</button>
            <label className="relative flex cursor-pointer items-center gap-2 text-sm font-semibold" onMouseEnter={() => setTip(true)} onMouseLeave={() => setTip(false)}>
              <input type="checkbox" className="h-4 w-4 accent-[#0f6b4f]" checked={dp} onChange={(e) => setDp(e.target.checked)} /> Extra privacy (adds noise) <span className="text-muted">ⓘ</span>
              {tip && <div className="absolute left-0 top-8 z-20 w-[330px] rounded-2xl border border-line bg-paper p-4 text-[13px] font-normal leading-relaxed shadow-xl">We blur each number with a little random “static” before it leaves a country, so nobody can work out private details from it. More static means more privacy but slightly less accurate matches. (Technical name: differential privacy, ε = {mesh.epsilon}.)</div>}
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2 text-sm"><span className="chip bg-lilac-soft text-[#5a3ea0]">Round {mesh.rounds}</span><span className={`chip ${mesh.dp ? "bg-moss-soft text-moss" : "bg-line text-muted"}`}>{mesh.dp ? "Blurred numbers were shared" : "Plain numbers were shared"}</span></div>
          <div className="mt-5 rounded-2xl bg-[#f6f0e3] p-4">
            <div className="mb-2 text-sm font-semibold">Shared average fingerprint (12 numbers)</div>
            <Bars v={mesh.global} color="#7c5cbf" names={mesh.features} />
          </div>
        </section>
      </div>

      <section>
        <h2 className="font-serif text-3xl font-bold">The fingerprint library</h2>
        <p className="mb-4 text-muted">Hover a bar to see which feature it stands for (for example how fast demand grew, or how far it spread).</p>
        <div className="grid gap-5 md:grid-cols-3">
          {mesh.library.map((e) => {
            const n = mesh.nations.find((x) => x.id === e.nation)!;
            return (
              <div key={e.id} className="card p-5">
                <div className="flex items-center justify-between"><div className="font-serif text-2xl font-bold">{FLAG[e.nation]} {n.name}</div></div>
                <div className="mt-1 text-sm text-muted">{NICE[e.id].split(" · ")[1]} · demand peaked at {e.peakMult.toFixed(1)}× normal in {e.daysToPeak} days</div>
                <div className="mt-4"><Bars v={e.shared} color={COLORS[e.nation]} names={mesh.features} /></div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
