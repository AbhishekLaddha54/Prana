"use client";
import type { ReactNode } from "react";

export function PageHead({ eyebrow, title, children, tone = "moss" }: { eyebrow: string; title: string; children?: ReactNode; tone?: "moss" | "coral" | "sky" | "lilac" | "sun" }) {
  const tones = { moss: "bg-moss-soft text-moss", coral: "bg-coral-soft text-[#b3391f]", sky: "bg-sky-soft text-[#1f5f96]", lilac: "bg-lilac-soft text-[#5a3ea0]", sun: "bg-sun-soft text-[#8a5f00]" };
  return (
    <div className="rise mb-8 max-w-3xl">
      <span className={`chip ${tones[tone]}`}>{eyebrow}</span>
      <h1 className="mt-3 font-serif text-4xl font-bold leading-[1.1] tracking-tight md:text-5xl">{title}</h1>
      {children && <p className="mt-3 text-lg leading-relaxed text-muted">{children}</p>}
    </div>
  );
}

export function Loading({ label = "Getting the latest numbers…" }: { label?: string }) {
  return (
    <div className="space-y-4">
      <div className="skeleton h-12 w-2/3" />
      <div className="skeleton h-64 w-full" />
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}

export function AiBadge({ live }: { live: boolean }) {
  return (
    <span className={`chip ${live ? "bg-moss-soft text-moss" : "bg-sun-soft text-[#8a5f00]"}`} title={live ? "Connected to OpenAI" : "No API key found, so built-in offline helpers are used. Results follow the same format."}>
      <span className={`h-2 w-2 rounded-full ${live ? "bg-moss" : "bg-sun"}`} />
      {live ? "AI connected" : "Offline demo AI"}
    </span>
  );
}

export function Stat({ value, label, tone = "ink" }: { value: ReactNode; label: string; tone?: "ink" | "alert" | "moss" | "sun" | "sky" }) {
  const c = { ink: "text-ink", alert: "text-alert", moss: "text-moss", sun: "text-[#c98a00]", sky: "text-sky" }[tone];
  return (
    <div>
      <div className={`font-serif text-4xl font-bold ${c}`}>{value}</div>
      <div className="text-sm text-muted">{label}</div>
    </div>
  );
}
