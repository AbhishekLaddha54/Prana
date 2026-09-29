import type { snapshot, meshDetail, nowcastDetail, forecastDetail } from "@/lib/prana/engine";
import type { Plan } from "@/lib/prana/planner";

export type Snap = ReturnType<typeof snapshot>;
export type MeshData = ReturnType<typeof meshDetail>;
export type NowcastData = NonNullable<ReturnType<typeof nowcastDetail>>;
export type ForecastData = ReturnType<typeof forecastDetail>;
export type { Plan };

export interface Focus { lat: number; lng: number; zoom: number; n: number }

export const MED_NAMES = ["Paracetamol", "ORS", "Amoxicillin", "Insulin", "Antimalarial", "Oxytocin", "Iron+folic acid", "Azithromycin"];
export const MED_IDS = ["PAR", "ORS", "AMX", "INS", "MAL", "OXY", "IFA", "AZI"];

export const STATE_LABEL: Record<string, string> = { ADEQUATE: "Healthy", STRESSED: "Running low", STOCKED_OUT: "Ran out", RECOVERED: "Recovered" };
export const LEVEL_LABEL: Record<string, string> = { CRITICAL: "Urgent", WARNING: "Watch" };

export async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch("/api/" + path, body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

/** Spread score -> colour (green = calm, red = spreading). */
export function rsColor(rs: number): string {
  if (rs > 1) return "#e5484d";
  if (rs >= 0.8) return "#f0803c";
  if (rs >= 0.4) return "#f5b83d";
  if (rs >= 0.15) return "#b7d36a";
  return "#5fbf8a";
}
export function rsWord(rs: number): string {
  if (rs > 1) return "Spreading";
  if (rs >= 0.8) return "About to spread";
  if (rs >= 0.4) return "Some risk";
  if (rs >= 0.15) return "Low risk";
  return "Calm";
}
