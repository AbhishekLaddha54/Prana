"use client";
import { useEffect, useState } from "react";
import { useSim } from "./SimContext";
import { api } from "./types";

/** Daily briefing written by Gemini from today's numbers (falls back to a built-in summary). */
export function Briefing() {
  const { snap, ai } = useSim();
  const [text, setText] = useState<string | null>(null);
  const [mode, setMode] = useState<"live" | "mock" | null>(null);
  const [busy, setBusy] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let stop = false;
    setBusy(true);
    api<{ answer: string; mode: "live" | "mock"; error?: string }>("ai/briefing")
      .then((r) => { if (!stop) { setText(r.answer); setMode(r.mode); setErr(r.error ?? null); } })
      .catch((e) => { if (!stop) { setText("The briefing could not be loaded just now."); setErr(String(e)); } })
      .finally(() => { if (!stop) setBusy(false); });
    return () => { stop = true; };
  }, [snap?.tick, ai]);

  return (
    <section className="card flex flex-col gap-3 p-6 md:p-8">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-serif text-3xl font-bold">Today’s briefing</h2>
        <span className={`chip ${mode === "live" ? "bg-moss-soft text-moss" : "bg-sun-soft text-[#8a5f00]"}`}>{mode === "live" ? "written by Gemini" : "built-in summary"}</span>
      </div>
      {busy ? (
        <div className="space-y-2"><div className="skeleton h-4 w-3/4" /><div className="skeleton h-4 w-2/3" /><div className="skeleton h-4 w-1/2" /></div>
      ) : (
        <div className="whitespace-pre-wrap text-[17px] leading-relaxed">{text}</div>
      )}
      {err && <div className="text-xs text-[#8a5f00]">{err}</div>}
    </section>
  );
}
