"use client";
import { useEffect, useState } from "react";
import { LineChart, RangeBar } from "@/components/Charts";
import { Reading, useSim } from "@/components/SimContext";
import { MED_IDS, MED_NAMES, NowcastData, api } from "@/components/types";
import { Loading, PageHead } from "@/components/ui";

interface VoiceNote { id: string; phc: string; transcript: string; durationSec: number }
type Upd = Omit<Reading, "id">;
interface Extr { phc_id: string | null; medicine: string | null; units_remaining: number | null; days_of_stock: number | null; footfall_trend: string; notes: string; confidence: number }
interface ObsRes { extraction: Extr; update: Upd | null; mode: "live" | "mock"; transcript?: string; warning?: string }
interface Row { extraction: Extr; update: Upd | null; bbox: number[] | null }
interface RegRes { register: { id: string; phc: string; image: string | null; title: string }; rows: Row[]; mode: "live" | "mock"; warning?: string }
interface Reg { id: string; phc: string; image: string; title: string }

const TREND: Record<string, string> = { rising: "More patients than usual", stable: "About the same", falling: "Fewer patients" };
const CHANNELS = [
  ["Voice note", "Least exact"],
  ["Register photo", "Somewhat exact"],
  ["Typed count", "Most exact"],
];

function Understood({ e }: { e: Extr }) {
  const rows: [string, string][] = [
    ["Clinic", e.phc_id ?? "not found"],
    ["Medicine", e.medicine ?? "not found"],
    ["Units left", e.units_remaining != null ? String(e.units_remaining) : "—"],
    ["Days of stock", e.days_of_stock != null ? `${e.days_of_stock} days` : "—"],
    ["Patients", TREND[e.footfall_trend] ?? e.footfall_trend],
    ["Notes", e.notes || "—"],
    ["How sure we are", `${Math.round(e.confidence * 100)}%`],
  ];
  return (
    <div>
      <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 text-sm">
        {rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
      </dl>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">See the raw data</summary>
        <pre className="mt-2 max-h-52 overflow-auto rounded-xl bg-[#ece4d3] p-3 font-mono text-[11px]">{JSON.stringify(e, null, 2)}</pre>
      </details>
    </div>
  );
}

function VoiceBox() {
  const { snap, refresh, addReading, ai } = useSim();
  const [notes, setNotes] = useState<VoiceNote[]>([]);
  const [text, setText] = useState("");
  const [phc, setPhc] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ObsRes | null>(null);
  useEffect(() => { api<VoiceNote[]>("sense/voice-notes").then(setNotes).catch(() => {}); }, []);

  const submit = async (payload: FormData | Record<string, unknown>) => {
    setBusy(true); setRes(null);
    try {
      const r = payload instanceof FormData
        ? await fetch("/api/sense/voice", { method: "POST", body: payload }).then((x) => x.json())
        : await api<ObsRes>("sense/voice", payload);
      setRes(r); addReading(r.update); refresh();
    } catch (e) { setRes({ extraction: { phc_id: null, medicine: null, units_remaining: null, days_of_stock: null, footfall_trend: "stable", notes: "", confidence: 0 }, update: null, mode: "mock", warning: String(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-3">
        <label className="text-sm font-semibold">What the worker said</label>
        <textarea className="field min-h-[130px]" placeholder="Paste the note, e.g. “Paracetamol ke sirf 50 strip bache hain, bukhar ke mareez badh rahe hain…”" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="flex flex-wrap items-center gap-2">
          <select className="field !w-auto" value={phc} onChange={(e) => setPhc(e.target.value)}>
            <option value="">Clinic code: unknown</option>
            {snap?.phcs.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.name}</option>)}
          </select>
          <button className="btn btn-primary" disabled={busy || (!text.trim() && !file)} onClick={() => submit({ transcript: text, phc })}>{busy ? <span className="spinner" /> : "Read this note"}</button>
        </div>

        <div className="rounded-2xl border border-dashed border-line p-4">
          <div className="text-sm font-semibold">Or upload the actual recording</div>
          <div className="mt-1 text-xs text-muted">Gemini listens to the audio and pulls the same facts out (wav, mp3, m4a, ogg).</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input type="file" accept="audio/*" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} disabled={!ai} />
            <button className="btn btn-sm" disabled={!file || busy} onClick={async () => {
              if (!file) return;
              const fd = new FormData();
              fd.append("audio", file);
              if (phc) fd.append("phc", phc);
              await submit(fd);
            }}>{busy ? <span className="spinner" /> : "Transcribe & read"}</button>
            {!ai && <span className="text-xs text-[#8a5f00]">Without a Gemini key the file is accepted but nothing will come back. Paste or use an example note instead, or add GEMINI_API_KEY.</span>}
          </div>
        </div>

        {notes.length > 0 && (
          <div>
            <div className="mb-1 text-sm font-semibold">Or load an example note</div>
            <div className="flex flex-wrap gap-2">
              {notes.map((n) => <button key={n.id} className="btn btn-sm btn-soft" onClick={() => { setText(n.transcript); setPhc(n.phc); }}>{n.id} · {n.phc}</button>)}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {busy && <div className="flex items-center gap-2 text-muted"><span className="spinner" /> Reading…</div>}
        {res?.warning && <div className="rounded-2xl bg-sun-soft p-3 text-sm text-[#8a5f00]">{res.warning}</div>}
        {res && (
          <div className="fade-in grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl bg-[#f6f0e3] p-4">
              <div className="mb-2 font-serif text-lg font-bold">What we understood</div>
              <Understood e={res.extraction} />
              {res.transcript && <div className="mt-3 text-xs italic text-muted">“{res.transcript}”</div>}
            </div>
            <div className="rounded-2xl bg-[#f6f0e3] p-4">
              <div className="mb-2 font-serif text-lg font-bold">How the estimate changed</div>
              {res.update
                ? <><div className="mb-3 text-sm text-muted">{res.update.medicine} at {res.update.phc}. A voice note is the least exact source, so the range narrows only a little.</div><RangeBar before={res.update.before} after={res.update.after} /></>
                : <div className="text-sm text-[#8a5f00]">We couldn’t tell which clinic or medicine this was about, so nothing was recorded.</div>}
            </div>
          </div>
        )}
        {!res && !busy && <div className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">Type or upload a note on the left. Prana picks out the clinic, the medicine and how much is left, then improves the stock estimate.</div>}
      </div>
    </div>
  );
}

function PhotoBox() {
  const { snap, refresh, addReading, ai } = useSim();
  const [regs, setRegs] = useState<Reg[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [phc, setPhc] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RegRes | null>(null);
  useEffect(() => {
    api<Reg[]>("sense/registers").then((r) => setRegs(r)).catch(() => {});
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (payload: FormData | Record<string, unknown>) => {
    setBusy(true); setRes(null);
    try {
      const r = payload instanceof FormData
        ? await fetch("/api/sense/register", { method: "POST", body: payload }).then((x) => x.json())
        : await api<RegRes>("sense/register", payload);
      setRes(r); r.rows.forEach((x: Row) => addReading(x.update)); refresh();
    } catch (e) { setRes({ register: { id: "upload", phc: "", image: null, title: "" }, rows: [], mode: "mock", warning: String(e) }); }
    finally { setBusy(false); }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,430px)_1fr]">
      <div className="space-y-3">
        <div className="rounded-2xl border border-dashed border-line p-4">
          <div className="text-sm font-semibold">Upload a photo of the paper register</div>
          <div className="mt-1 text-xs text-muted">Straight, bright shots work best. Gemini reads the rows and returns the same format as every other channel.</div>
          <input type="file" accept="image/*" className="mt-2 block text-sm" onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            setFile(f);
            if (preview) URL.revokeObjectURL(preview);
            setPreview(f ? URL.createObjectURL(f) : null);
          }} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select className="field !w-auto" value={phc} onChange={(e) => setPhc(e.target.value)}>
              <option value="">Clinic code: read from photo</option>
              {snap?.phcs.map((p) => <option key={p.id} value={p.id}>{p.id} — {p.name}</option>)}
            </select>
            <button className="btn btn-primary" disabled={busy || !file} onClick={() => {
              if (!file) return;
              const fd = new FormData();
              fd.append("image", file);
              if (phc) fd.append("phc", phc);
              submit(fd);
            }}>{busy ? <span className="spinner" /> : "Read the photo"}</button>
            {!ai && <span className="text-xs text-[#8a5f00]">Without a Gemini key uploaded photos won’t be read; use one of the sample registers instead.</span>}
            <a className="btn btn-sm btn-soft" href="/sample_voice.wav" download>Download test voice clip (silence, 1 s)</a>
          </div>
        </div>
        <div>
          <div className="mb-1 text-sm font-semibold">Or use one of our sample registers</div>
          <div className="flex flex-wrap gap-2">
            {regs.map((r) => <button key={r.id} className="btn btn-sm btn-soft" onClick={() => { setFile(null); setPreview(null); submit({ id: r.id }); }}>{r.title}</button>)}
          </div>
        </div>
        {(preview || res?.register.image) && (
          <div className="relative overflow-hidden rounded-2xl border border-line">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview ?? (res?.register.image ?? regs[0]?.image ?? "")} alt="stock register" className="block w-full" />
            {res?.rows.map((r, i) => r.bbox && (
              <div key={i} className="fade-in absolute rounded border-2 border-[#22c58a] bg-[#22c58a]/15" style={{ left: `${r.bbox[0]}%`, top: `${r.bbox[1]}%`, width: `${r.bbox[2]}%`, height: `${r.bbox[3]}%` }}>
                <span className="absolute -top-2.5 left-0 rounded bg-[#0f6b4f] px-1.5 text-[10px] font-bold text-white">{r.extraction.medicine}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        {busy && <div className="flex items-center gap-2 text-muted"><span className="spinner" /> Reading rows…</div>}
        {res?.warning && <div className="rounded-2xl bg-sun-soft p-3 text-sm text-[#8a5f00]">{res.warning}</div>}
        {res && res.rows.length > 0 && (
          <div className="fade-in space-y-3">
            {res.rows.map((r, i) => (
              <div key={i} className="rounded-2xl bg-[#f6f0e3] p-4">
                <div className="mb-2 flex justify-between text-sm"><b>{r.extraction.medicine}</b><span className="text-muted">{r.extraction.phc_id} · balance written: {r.extraction.units_remaining}</span></div>
                {r.update && <RangeBar before={r.update.before} after={r.update.after} />}
              </div>
            ))}
          </div>
        )}
        {!res && !busy && <div className="rounded-2xl border border-dashed border-line p-10 text-center text-muted">A photo of a paper register goes in. Rows are found, numbers are read, and each one tightens the stock estimate.</div>}
      </div>
    </div>
  );
}

function TypeBox() {
  const { snap, refresh, addReading, stockFocus, setStockFocus } = useSim();
  const [phc, setPhc] = useState(stockFocus?.phc ?? "D4-P1");
  const [med, setMed] = useState(stockFocus ? MED_IDS[stockFocus.med] : "PAR");
  const [units, setUnits] = useState(40);
  const [res, setRes] = useState<ObsRes | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <div className="space-y-3">
        <div className="text-sm font-semibold text-muted">Type in a count (works on any basic phone)</div>
        <select className="field" value={phc} onChange={(e) => setPhc(e.target.value)}>{snap?.phcs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="field" value={med} onChange={(e) => setMed(e.target.value)}>{MED_IDS.map((m, i) => <option key={m} value={m}>{MED_NAMES[i]}</option>)}</select>
        <input className="field" type="number" min={0} value={units} onChange={(e) => setUnits(+e.target.value)} />
        <button className="btn btn-primary w-full" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api<ObsRes>("sense/manual", { phc, medicine: med, units }); setRes(r); addReading(r.update); refresh(); setStockFocus?.({ phc, med: MED_IDS.indexOf(med) }); } finally { setBusy(false); } }}>{busy ? <span className="spinner" /> : "Send count"}</button>
      </div>
      <div>{res?.update ? <div className="fade-in rounded-2xl bg-[#f6f0e3] p-4"><div className="mb-3 text-sm text-muted">Typed numbers are the most exact source, so the range shrinks a lot.</div><RangeBar before={res.update.before} after={res.update.after} /></div> : <div className="rounded-2xl border border-dashed border-line p-8 text-center text-muted">Send a count to see the estimate tighten.</div>}</div>
    </div>
  );
}

function SendCount({ phc, med }: { phc: string; med: number }) {
  const { refresh, addReading } = useSim();
  const [units, setUnits] = useState(20);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ObsRes | null>(null);
  return (
    <div className="rounded-2xl bg-[#f6f0e3] p-4">
      <div className="text-xs font-semibold text-muted">UPDATE THIS COUNT</div>
      <p className="mt-1 text-sm text-muted">The clinic just did a physical count of {MED_NAMES[med]}. Send it in and the estimate updates.</p>
      <div className="mt-2 flex items-center gap-2">
        <input className="field !w-28" type="number" min={0} value={units} onChange={(e) => setUnits(+e.target.value)} />
        <button className="btn btn-primary" disabled={busy} onClick={async () => { setBusy(true); try { const r = await api<ObsRes>("sense/manual", { phc, medicine: MED_IDS[med], units }); setRes(r); addReading(r.update); refresh(); } finally { setBusy(false); } }}>{busy ? <span className="spinner" /> : "Send count"}</button>
      </div>
      {res?.update && (
        <div className="fade-in mt-3">
          <RangeBar before={res.update.before} after={res.update.after} />
          <div className="mt-1 text-xs text-muted">Typed counts are the most exact source, so the range shrinks the most.</div>
        </div>
      )}
    </div>
  );
}

function Estimate() {
  const { snap, stockFocus, setStockFocus, readings } = useSim();
  const phc = stockFocus?.phc ?? "D4-P1";
  const med = stockFocus?.med ?? 0;
  const [data, setData] = useState<NowcastData | null>(null);
  useEffect(() => { api<NowcastData>(`nowcast?phc=${phc}&med=${MED_IDS[med]}`).then(setData).catch(() => {}); }, [phc, med, snap?.tick, readings.length]);
  return (
    <section className="card p-6 md:p-8">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h2 className="font-serif text-3xl font-bold">Stock estimate for one clinic</h2>
          <p className="text-muted">Best guess of how many days of medicine are left, with the range we are 95% sure about. The estimate follows the real stock but drifts as days pass — a fresh count below pulls it back.</p>
        </div>
        <select className="field !w-auto" value={phc} onChange={(e) => setStockFocus({ phc: e.target.value, med })}>{snap?.phcs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="field !w-auto" value={med} onChange={(e) => setStockFocus({ phc, med: +e.target.value })}>{MED_NAMES.map((n, i) => <option key={n} value={i}>{n}</option>)}</select>
      </div>
      {!data ? <div className="skeleton mt-5 h-40" /> : (
        <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_300px]">
          <div>
            {data.log.length >= 2
              ? <LineChart xs={data.log.map((l) => l.day)} yMin={0} height={230} series={[{ name: "estimate", color: "#0f6b4f", data: data.log.map((l) => l.mu), band: { lo: data.log.map((l) => l.lo), hi: data.log.map((l) => l.hi) } }]} hlines={[{ y: data.truthDays, label: `real stock: ${data.truthDays.toFixed(1)} days (hidden from the model)`, color: "#7c5cbf" }]} xLabel="day" />
              : <div className="rounded-2xl bg-[#f6f0e3] p-6"><RangeBar after={data.current} /><div className="mt-3 text-sm text-muted">Let time run for a few days and this becomes a chart. The purple line will show the real stock, which the estimate never sees.</div></div>}
          </div>
          <div className="space-y-3">
            <div className="rounded-2xl bg-moss-soft p-4"><div className="text-xs font-semibold text-moss">RIGHT NOW</div><div className="font-serif text-3xl font-bold">{data.current.mu.toFixed(1)} days</div><div className="text-sm text-muted">likely between {data.current.lo.toFixed(1)} and {data.current.hi.toFixed(1)}</div></div>
            <SendCount phc={phc} med={med} />
            <div className="rounded-2xl bg-sun-soft p-4"><div className="text-xs font-semibold text-[#8a5f00]">HOW WELL WE SEE THIS CLINIC</div><div className="font-serif text-3xl font-bold">{data.observability}/100</div><div className="text-sm text-muted">last heard {data.ageDays} days ago · {data.observations} new readings</div></div>
          </div>
        </div>
      )}
    </section>
  );
}

export default function StockPage() {
  const { snap, readings, ai } = useSim();
  const [tab, setTab] = useState<"voice" | "photo" | "type">("voice");
  if (!snap) return <Loading />;
  const dark = [...snap.phcs].sort((a, b) => a.obs - b.obs).slice(0, 8);
  return (
    <div className="space-y-8">
      <PageHead eyebrow="Stock Check" title="Guess the stock from whatever we can get." tone="sky">
        Many clinics have no computer system. So we listen to voice notes, read photos of paper registers, and accept typed counts. Each one improves our estimate — and we always show how unsure we still are.
      </PageHead>

      <section className="card p-6 md:p-8">
        <div className="mb-6 flex flex-wrap items-center gap-2">
          <button className="pill-tab" data-on={tab === "voice"} onClick={() => setTab("voice")}>🎙 Voice note</button>
          <button className="pill-tab" data-on={tab === "photo"} onClick={() => setTab("photo")}>📷 Photo of register</button>
          <button className="pill-tab" data-on={tab === "type"} onClick={() => setTab("type")}>⌨ Typed count</button>
          <div className="ml-auto flex flex-wrap gap-2 text-xs">
            {CHANNELS.map(([n, w]) => <span key={n} className="chip bg-[#f1e9d8] text-muted">{n}: {w}</span>)}
            {!ai && <span className="chip bg-sun-soft text-[#8a5f00]" title="Set GEMINI_API_KEY to let Gemini read notes and photos">AI reading off — built-in reader</span>}
          </div>
        </div>
        {tab === "voice" && <VoiceBox />}
        {tab === "photo" && <PhotoBox />}
        {tab === "type" && <TypeBox />}
      </section>

      {readings.length > 0 && (
        <section className="card p-6 md:p-8">
          <h2 className="font-serif text-3xl font-bold">Recent readings</h2>
          <p className="mb-4 text-muted">The grey bar is what we believed before. The green bar is what we believe now.</p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {readings.map((r) => (
              <div key={r.id} className="fade-in rounded-2xl bg-[#f6f0e3] p-4">
                <div className="mb-2 flex justify-between text-sm"><b>{r.medicine}</b><span className="text-muted">{r.phc} · {r.channel}</span></div>
                <RangeBar before={r.before} after={r.after} />
              </div>
            ))}
          </div>
        </section>
      )}

      <Estimate />

      <section className="card p-6 md:p-8">
        <h2 className="font-serif text-3xl font-bold">Clinics we can see the least</h2>
        <p className="mb-4 text-muted">A low score means our information is old or thin. These are the clinics to phone first.</p>
        <div className="grid gap-x-10 gap-y-3 md:grid-cols-2">
          {dark.map((p) => (
            <div key={p.id} className="flex items-center gap-3">
              <div className="w-44 truncate text-sm font-semibold">{p.name}</div>
              <div className="h-3 flex-1 rounded-full bg-[#f1e9d8]"><div className="h-3 rounded-full transition-all duration-700" style={{ width: `${p.obs}%`, background: p.obs > 60 ? "#5fbf8a" : p.obs > 35 ? "#f5b83d" : "#f0803c" }} /></div>
              <div className="w-10 text-right font-mono text-sm">{p.obs}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
