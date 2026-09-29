"use client";
import Link from "next/link";
import { Briefing } from "@/components/Briefing";
import { useSim } from "@/components/SimContext";
import { rsColor } from "@/components/types";
import type { Snap } from "@/components/types";

function HeroArt({ snap }: { snap: Snap | null }) {
  const cw = 112;
  const ch = 96;
  return (
    <svg viewBox="0 0 470 350" className="bob w-full max-w-[520px]" aria-hidden>
      <defs>
        <filter id="soft" x="-10%" y="-10%" width="120%" height="120%"><feDropShadow dx="0" dy="6" stdDeviation="6" floodColor="#1d2b24" floodOpacity="0.15" /></filter>
      </defs>
      {Array.from({ length: 12 }, (_, i) => {
        const col = Math.floor(i / 3);
        const row = i % 3;
        const x = 12 + col * (cw + 4);
        const y = 14 + row * (ch + 8);
        const rs = snap?.districts[i]?.worstRs ?? 0;
        const c = rsColor(rs);
        const hot = rs > 1;
        return (
          <g key={i} filter="url(#soft)">
            <rect x={x} y={y} width={cw} height={ch} rx={26} fill={c} fillOpacity={0.3} stroke="#fffdf8" strokeWidth={4} />
            {[0, 1, 2, 3, 4].map((k) => {
              const a = (k / 5) * Math.PI * 2 + i;
              return <circle key={k} cx={x + cw / 2 + Math.cos(a) * 30} cy={y + ch / 2 + Math.sin(a) * 25} r={5} fill={hot ? "#e5484d" : "#0f6b4f"} />;
            })}
            {(hot || i === 3) && <circle className="ping" cx={x + cw / 2} cy={y + ch / 2} r={22} fill="none" stroke="#e5484d" strokeWidth={3} />}
          </g>
        );
      })}
      <path d="M124 60 C 150 20, 200 20, 232 60" stroke="#e5484d" strokeWidth={3} strokeDasharray="4 8" fill="none" className="flow-line" />
    </svg>
  );
}

const FEATURES = [
  { href: "/stock", n: "1", tone: "bg-sky-soft", title: "See stock — even without computers", text: "Clinics send a voice note or a photo of their paper register. Prana reads it and estimates what is left, always with a likely range." },
  { href: "/spread", n: "2", tone: "bg-coral-soft", title: "Catch shortages that spread", text: "When one clinic runs out, patients move to the next one and empty that too. A single 'spread score' tells you when that domino effect has begun." },
  { href: "/plan", n: "3", tone: "bg-moss-soft", title: "Get plans for where to send supplies", text: "Three ready-made plans (balanced, fastest, cheapest). Each is replayed on the computer to show what would happen. A person always approves." },
  { href: "/countries", n: "4", tone: "bg-lilac-soft", title: "Learn from other countries", text: "Countries share a small 'fingerprint' of past outbreaks — never patient or stock data — so a new outbreak can be recognised days earlier." },
];

const WORDS = [
  ["Spread score", "How many nearby districts a shortage is likely to push into running out within a week. Above 1 means it is spreading by itself."],
  ["Likely range", "We never claim an exact number. We show a best guess and the range we are 95% sure it falls inside."],
  ["How well we see it", "A 0–100 score for each clinic. Fresh, varied and precise information scores high. Old information fades the dot on the map."],
  ["What-if replay", "We run the next 3 weeks twice on the computer — once with a plan, once without — and compare."],
  ["Fingerprint", "12 numbers describing how an outbreak behaves. Two similar fingerprints mean two similar outbreaks."],
];

export default function Home() {
  const { snap } = useSim();
  const atRisk = snap ? snap.districts.filter((d) => d.worstRs > 1).length : null;
  return (
    <div className="space-y-24">
      {/* hero */}
      <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div className="rise">
          <span className="chip bg-coral-soft text-[#b3391f]">Made-up region “Demo Pradesh” · runs on your own Gemini key</span>
          <h1 className="mt-5 font-serif text-5xl font-bold leading-[1.05] tracking-tight md:text-7xl">
            Know which clinics will <span className="relative whitespace-nowrap text-moss">run out<svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 200 10" preserveAspectRatio="none"><path d="M2 7 C 50 0, 150 0, 198 6" stroke="#ff6b4a" strokeWidth="4" fill="none" strokeLinecap="round" /></svg></span> of medicine — before they do.
          </h1>
          <p className="mt-6 max-w-xl text-xl leading-relaxed text-muted">
            Prana watches medicine stock across a whole region, warns when a shortage is about to spread from clinic to clinic, and suggests where to send supplies. Every big decision waits for a human to press “approve”.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/ask" className="btn btn-primary !px-6 !py-3 !text-base">Ask Prana anything</Link>
            <Link href="/map" className="btn !px-6 !py-3 !text-base">Open the live map</Link>
          </div>
        </div>
        <div className="rise flex justify-center" style={{ animationDelay: ".15s" }}>
          <HeroArt snap={snap} />
        </div>
      </section>

      {/* briefing */}
      <Briefing />

      <section className="card p-6 md:p-8">
        <h2 className="font-serif text-3xl font-bold">Where AI is used</h2>
        <p className="mt-2 max-w-2xl text-muted">A free-tier Gemini key turns these features on. Without one every page still works — you get built-in readings and answers, clearly labelled.</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[
            ["🎙 Voice notes", "Reads a pasted or uploaded voice note and pulls out the clinic, the medicine, how much is left, and whether patient numbers are going up."],
            ["📷 Register photos", "Reads a photo of a paper register and draws boxes around each row; updates the stock estimate for every medicine it reads."],
            ["🤝 Plan explanations", "Writes the plain-English 3-sentence explanation on each plan card in the planner."],
            ["📰 Daily briefing", "Writes the three bullets on the home page summarising today’s numbers."],
            ["💬 Ask Prana", "Answers plain-English questions using only today’s numbers — it is told to say ‘I don’t know’ rather than guess."],
            ["🔎 Grounded only in facts", "Every answer includes the list of numbers the model was allowed to use; if Gemini fails the page falls back to the built-in helper."],
          ].map(([title, body]) => (
            <div key={title} className="rounded-2xl bg-[#f6f0e3] p-4">
              <div className="font-serif text-xl font-bold">{title}</div>
              <div className="mt-1 text-sm leading-relaxed text-muted">{body}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-muted">
          Set <code className="rounded bg-[#f1e9d8] px-1.5 py-0.5 font-mono text-[12.5px] text-ink">GEMINI_API_KEY=...</code>
          (optional, <code className="rounded bg-[#f1e9d8] px-1.5 py-0.5 font-mono text-[12.5px] text-ink">GEMINI_MODEL</code>
          defaults to gemini-2.5-flash).
        </div>
      </section>

      {/* live numbers */}
      <section className="card rise grid gap-6 p-8 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ["Districts", snap ? "12" : "–", "in the region"],
          ["Clinics", snap ? String(snap.stats.phcs) : "–", "we keep an eye on"],
          ["Clinics out of something today", snap ? String(snap.stats.stockedOutPhcs) : "–", snap?.outbreak.active ? "the outbreak is running" : "calm before any outbreak"],
          ["Districts where a shortage is spreading", atRisk == null ? "–" : String(atRisk), "spread score above 1"],
        ].map(([l, v, s], i) => (
          <div key={i}>
            <div className={`font-serif text-5xl font-bold ${i >= 2 && Number(v) > 0 ? "text-alert" : "text-ink"}`}>{v}</div>
            <div className="mt-1 text-sm font-semibold leading-snug">{l}</div>
            <div className="text-sm text-muted">{s}</div>
          </div>
        ))}
      </section>

      {/* problem */}
      <section>
        <h2 className="font-serif text-4xl font-bold">The problem, in three pictures</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {[
            ["A clinic runs out", "Dengue cases jump. Paracetamol at one clinic is gone in days, not weeks.", "#e5484d"],
            ["Patients go next door", "People travel to the nearest clinic. Its stock gets used up much faster than planned.", "#f0803c"],
            ["The shortage spreads", "Now several clinics are empty. Fixing it late is slow and costly. Fixing it early is cheap.", "#7c5cbf"],
          ].map(([t, s, c], i) => (
            <div key={i} className="card rise p-6" style={{ animationDelay: `${i * 0.1}s` }}>
              <svg viewBox="0 0 220 70" className="mb-4 h-16 w-full">
                {Array.from({ length: 5 }, (_, k) => <circle key={k} cx={20 + k * 45} cy={35} r={13} fill={k <= i + 0 ? (c as string) : "#e6dcc8"} />)}
                {Array.from({ length: 4 }, (_, k) => <line key={k} x1={33 + k * 45} x2={7 + (k + 1) * 45} y1={35} y2={35} stroke="#1d2b24" strokeOpacity=".25" strokeWidth="3" strokeDasharray="3 4" />)}
              </svg>
              <div className="font-serif text-2xl font-bold">{i + 1}. {t}</div>
              <p className="mt-2 text-muted">{s}</p>
            </div>
          ))}
        </div>
      </section>

      {/* features */}
      <section>
        <h2 className="font-serif text-4xl font-bold">What Prana does</h2>
        <p className="mt-2 max-w-2xl text-lg text-muted">Four parts, one page each. Click any card to look inside.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          {FEATURES.map((f, i) => (
            <Link key={f.href} href={f.href} className={`rise group rounded-[28px] border border-line ${f.tone} p-8 transition-transform hover:-translate-y-1`} style={{ animationDelay: `${i * 0.08}s` }}>
              <div className="flex items-start justify-between">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-ink font-serif text-xl font-bold text-white">{f.n}</span>
                <span className="text-2xl transition-transform group-hover:translate-x-1">→</span>
              </div>
              <h3 className="mt-5 font-serif text-3xl font-bold leading-tight">{f.title}</h3>
              <p className="mt-2 text-[17px] leading-relaxed text-ink/75">{f.text}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* glossary */}
      <section className="card p-8 md:p-10">
        <h2 className="font-serif text-4xl font-bold">Words we use</h2>
        <p className="mt-2 text-lg text-muted">No jargon. Here is what each term means.</p>
        <dl className="mt-6 grid gap-x-10 gap-y-5 md:grid-cols-2">
          {WORDS.map(([w, d]) => (
            <div key={w} className="border-t border-line pt-4">
              <dt className="font-serif text-xl font-bold text-moss">{w}</dt>
              <dd className="mt-1 text-muted">{d}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
