"use client";
import { useEffect, useRef, useState } from "react";
import { AiPanel } from "@/components/AiPanel";
import { useSim } from "@/components/SimContext";
import { MED_NAMES, STATE_LABEL, api } from "@/components/types";
import { PageHead } from "@/components/ui";

interface Msg { role: "user" | "prana"; text: string; mode?: "live" | "mock"; error?: string }

const SUGGESTIONS = [
  "What needs attention first?",
  "Which clinics will run out first, and why?",
  "What should I do today?",
  "Explain the spread score in simple words.",
  "Is the plan I approved working?",
  "What did the country network find?",
];

export default function AskPage() {
  const { snap, ai, aiStatus, refreshAi } = useSim();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history = msgs.map((m) => ({ role: m.role === "user" ? "user" : "assistant", text: m.text }));
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setQ("");
    setBusy(true);
    try {
      const r = await api<{ answer: string; mode: "live" | "mock"; error?: string }>("ai/ask", { question, history });
      setMsgs((m) => [...m, { role: "prana", text: r.answer, mode: r.mode, error: r.error }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "prana", text: `Sorry, I could not reach the AI service (${String(e)}). Try again in a moment.`, mode: "mock" }]);
    } finally { setBusy(false); refreshAi(); }
  };

  return (
    <div>
      <PageHead eyebrow="Ask Prana" title="Ask anything about the situation." tone="sky">
        Prana answers with the numbers on screen right now — nothing else. Ask in ordinary words. When the Gemini key is missing or the free tier is busy, the built-in helper answers instead and says so.
      </PageHead>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
        <section className="card flex min-h-[560px] flex-col p-5 md:p-7">
          <div className="flex-1 space-y-4">
            {msgs.length === 0 && (
              <div className="rounded-3xl bg-[#f6f0e3] p-6">
                <div className="font-serif text-2xl font-bold">Hello — what would you like to know?</div>
                <p className="mt-2 text-muted">For example: “Which medicine should I move first?”, “Why is this spreading?”, or “Is the plan I approved working?”</p>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`fade-in flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[86%] rounded-3xl px-5 py-3.5 text-[15px] leading-relaxed ${m.role === "user" ? "bg-ink text-white" : "border border-line bg-white"}`}>
                  {m.role === "prana" && (
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className={`chip ${m.mode === "live" ? "bg-moss-soft text-moss" : "bg-sun-soft text-[#8a5f00]"}`}>{m.mode === "live" ? "Gemini" : "Offline helper"}</span>
                    </div>
                  )}
                  <div className="whitespace-pre-wrap">{m.text}</div>
                  {m.error && <div className="mt-2 text-xs text-[#8a5f00]">{m.error}</div>}
                </div>
              </div>
            ))}
            {busy && <div className="flex items-center gap-2 text-muted"><span className="spinner" /> Prana is thinking…</div>}
            <div ref={endRef} />
          </div>

          <div className="mt-5">
            <div className="mb-2 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => <button key={s} className="btn btn-sm btn-soft" disabled={busy} onClick={() => send(s)}>{s}</button>)}
            </div>
            <div className="flex gap-2">
              <input className="field" placeholder="Type your question…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send(q)} disabled={busy} />
              <button className="btn btn-primary" disabled={busy || !q.trim()} onClick={() => send(q)}>Ask</button>
            </div>
          </div>
        </section>

        <aside className="space-y-4">
          <AiPanel />
          <section className="card p-5">
            <h2 className="font-serif text-xl font-bold">What Prana sees right now</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {[
                ["Day", snap ? `${snap.day} (${snap.date})` : "—"],
                ["Outbreak", snap?.outbreak.active ? `${snap.outbreak.label}, ${snap.outbreak.infectedPhcs} clinics` : "none"],
                ["Clinics out", snap ? String(snap.stats.stockedOutPhcs) : "—"],
                ["Plan", snap?.planner.approved ? `${snap.planner.approved.name} approved` : snap?.planner.plans ? "waiting for approval" : "none yet"],
                ["Country match", snap?.meshBrief ? `${snap.meshBrief.id} · ${Math.round(snap.meshBrief.sim * 100)}%` : "none"],
              ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 border-b border-line pb-1.5"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
            </dl>
            {snap && (
              <div className="mt-3 space-y-1.5">
                <div className="text-xs font-bold uppercase tracking-wide text-muted">Most at risk</div>
                {snap.leaderboard.slice(0, 3).map((r, i) => (
                  <div key={i} className="rounded-xl bg-[#f6f0e3] px-3 py-2 text-xs">
                    <b>{MED_NAMES[r.m]}</b> · {snap.districts[r.d].name}
                    <div className="text-muted">{STATE_LABEL[r.state]} · spread score {r.rs.toFixed(2)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
          <section className="card p-5 text-sm">
            <h2 className="font-serif text-xl font-bold">How this works</h2>
            <p className="mt-2 text-muted">Before answering, Prana sends the question together with a snapshot of today’s numbers to Gemini, with instructions to use only those facts and to say “I don’t know” rather than guess.</p>
            <p className="mt-2 text-muted">{ai ? (aiStatus?.lastError ? `Key is set but the last call failed — use “Test Gemini” above.` : `Key is set${aiStatus?.model ? ` · model ${aiStatus.model}` : ""}.`) : "No Gemini key is set, so the built-in answerer replies. Set GEMINI_API_KEY to switch on full answers."}</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
