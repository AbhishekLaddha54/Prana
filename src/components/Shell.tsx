"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SimProvider, useSim } from "./SimContext";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/map", label: "Live Map" },
  { href: "/stock", label: "Stock Check" },
  { href: "/spread", label: "Shortage Spread" },
  { href: "/plan", label: "Action Plans" },
  { href: "/countries", label: "Country Network" },
  { href: "/ask", label: "Ask Prana" },
];

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
        <circle cx="16" cy="16" r="16" fill="#0f6b4f" />
        <path d="M16 8v16M8 16h16" stroke="#fff" strokeWidth="3.6" strokeLinecap="round" />
        <circle cx="24.5" cy="7.5" r="3.4" fill="#ff6b4a" />
      </svg>
      <div className="leading-none">
        <div className="font-serif text-2xl font-bold tracking-tight">Prana</div>
        <div className="mt-0.5 text-[10.5px] text-muted">medicine supply, made visible</div>
      </div>
    </Link>
  );
}

function AiBadge() {
  const { ai, aiStatus } = useSim();
  const model = aiStatus?.model ?? aiStatus?.pinned ?? "auto";
  const failing = ai && !!aiStatus?.lastError;
  const title = !ai
    ? "No Gemini key found. Set GEMINI_API_KEY and restart to switch on AI."
    : failing
      ? `Gemini key is set but the last call failed: ${aiStatus?.lastError}`
      : `Gemini key is set (model: ${model}). Click to test the connection.`;
  const tone = !ai ? "bg-sun-soft text-[#8a5f00]" : failing ? "bg-[#ffe3e3] text-[#9b1c1f]" : "bg-moss-soft text-moss";
  const dot = !ai ? "bg-sun" : failing ? "bg-alert" : "bg-moss";
  return (
    <Link href="/ask#test" className={`chip ${tone}`} title={title}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {!ai ? "No AI key" : failing ? "Gemini: needs attention" : `Gemini · ${model}`}
    </Link>
  );
}

function Frame({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { snap, playing, setPlaying, tick, speed, setSpeed, inject, reset, toast, err, clearErr, planBusy } = useSim();
  const urgent = snap?.planner.triggered;
  return (
    <div className="min-h-screen pb-32">
      <header className="sticky top-0 z-[1000] border-b border-line bg-cream/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3">
          <Logo />
          <nav className="flex flex-wrap items-center gap-1">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="pill-tab relative" data-on={path === n.href}>
                {n.label}
                {n.href === "/plan" && urgent && <span className="throb absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-alert" />}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <AiBadge />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-8">{children}</main>

      {toast && <div className="fade-in fixed right-5 top-20 z-[2500] max-w-sm rounded-2xl border border-line bg-paper px-4 py-3 text-sm shadow-xl">{toast}</div>}
      {err && (
        <div className="fixed right-5 top-36 z-[2500] max-w-sm rounded-2xl border border-alert/40 bg-[#fff1f1] px-4 py-3 text-sm text-[#8f1d21]">
          Something went wrong: {err} <button className="ml-2 underline" onClick={clearErr}>dismiss</button>
        </div>
      )}

      {/* time controls */}
      <div className="fixed bottom-4 left-1/2 z-[2300] flex max-w-[96vw] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-[28px] bg-ink px-4 py-2.5 text-white shadow-[0_18px_50px_-10px_rgba(0,0,0,.55)]">
        <div className="mr-1 flex items-center gap-2 pr-3">
          <span className={`h-2.5 w-2.5 rounded-full ${snap?.outbreak.active ? "throb bg-alert" : "bg-[#5fbf8a]"}`} />
          <div className="leading-tight">
            <div className="text-sm font-bold">{snap ? `Day ${snap.day}` : "Loading…"}</div>
            <div className="text-[11px] text-white/60">{snap ? `${snap.date} · ${snap.outbreak.active ? "outbreak on" : "all calm"}` : ""}</div>
          </div>
        </div>
        <button className="btn btn-sm !border-white/30 !bg-white/10 !text-white" onClick={() => setPlaying((p) => !p)} disabled={!snap}>{playing ? "❚❚ Pause" : "▶ Play time"}</button>
        <button className="btn btn-sm !border-white/30 !bg-white/10 !text-white" onClick={() => tick(1)} disabled={playing || !snap}>+1 day</button>
        <select className="btn btn-sm !border-white/30 !bg-white/10 !text-white" value={speed} onChange={(e) => setSpeed(+e.target.value)} title="How fast time moves">
          <option value={1000} className="text-black">Normal speed</option>
          <option value={500} className="text-black">2× speed</option>
          <option value={250} className="text-black">4× speed</option>
        </select>
        <button className="btn btn-coral btn-sm" onClick={inject} disabled={!snap || snap.outbreak.active}>{snap?.outbreak.active ? "Outbreak running" : "Start dengue outbreak"}</button>
        <button className="btn btn-sm !border-white/30 !bg-white/10 !text-white" onClick={reset} disabled={planBusy}>↺ Start over</button>
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  return (
    <SimProvider>
      <Frame>{children}</Frame>
    </SimProvider>
  );
}
