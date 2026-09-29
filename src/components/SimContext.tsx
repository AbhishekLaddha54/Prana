"use client";
import { Dispatch, ReactNode, SetStateAction, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Focus, MED_NAMES, Snap, api } from "./types";

export interface AiInfo { configured: boolean; model: string | null; pinned: string | null; lastError: string | null; lastOkAt: number | null }
export interface Band { lo: number; hi: number; mu: number }
export interface Reading { id: number; phc: string; medicine: string; channel: string; before: Band; after: Band }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Ctx {
  snap: Snap | null; err: string | null; clearErr: () => void; ai: boolean; aiStatus: AiInfo | null; refreshAi: () => Promise<void>;
  playing: boolean; setPlaying: Dispatch<SetStateAction<boolean>>; speed: number; setSpeed: (n: number) => void;
  refresh: () => Promise<Snap | null>; tick: (n?: number) => Promise<Snap | null>; inject: () => Promise<void>; reset: () => Promise<void>;
  toast: string | null; say: (t: string) => void;
  focus: Focus | null; fly: (lat: number, lng: number, zoom?: number) => void;
  selPair: { d: number; m: number }; setSelPair: (v: { d: number; m: number }) => void;
  stockFocus: { phc: string; med: number } | null; setStockFocus: (v: { phc: string; med: number } | null) => void;
  readings: Reading[]; addReading: (u: Omit<Reading, "id"> | null | undefined) => void;
  meshMode: "with" | "without"; setMeshMode: (m: "with" | "without") => void;
  planBusy: boolean; planHl: string | null; runPlanner: () => Promise<void>; approvePlan: (name: string) => Promise<boolean>; rejectPlans: () => Promise<void>;
}
const C = createContext<Ctx | null>(null);
export function useSim(): Ctx {
  const c = useContext(C);
  if (!c) throw new Error("SimProvider missing");
  return c;
}

export function SimProvider({ children }: { children: ReactNode }) {
  const [snap, setSnap] = useState<Snap | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1000);
  const [ai, setAi] = useState(false);
  const [aiStatus, setAiStatus] = useState<AiInfo | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [selPair, setSelPair] = useState({ d: 3, m: 0 });
  const [stockFocus, setStockFocus] = useState<{ phc: string; med: number } | null>(null);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [meshMode, setMeshMode] = useState<"with" | "without">("without");
  const [planBusy, setPlanBusy] = useState(false);
  const [planHl, setPlanHl] = useState<string | null>(null);
  const busy = useRef(false);
  const lastCrit = useRef(0);
  const snapRef = useRef<Snap | null>(null);
  snapRef.current = snap;
  const focusN = useRef(0);
  const readId = useRef(0);

  const refreshAi = useCallback(async () => {
    try {
      const m = await api<{ ai: boolean; status: AiInfo }>("meta");
      setAi(m.ai); setAiStatus(m.status);
    } catch { /* ignore */ }
  }, []);

  const say = useCallback((t: string) => { setToast(t); setTimeout(() => setToast((c) => (c === t ? null : c)), 4500); }, []);
  const fly = useCallback((lat: number, lng: number, zoom = 8.5) => setFocus({ lat, lng, zoom, n: ++focusN.current }), []);
  const refresh = useCallback(async () => {
    try { const s = await api<Snap>("state"); setSnap(s); setErr(null); return s; } catch (e) { setErr(String(e)); return null; }
  }, []);

  useEffect(() => {
    refresh().then((s) => { if (s) lastCrit.current = Math.max(0, ...s.alerts.filter((a) => a.level === "CRITICAL").map((a) => a.id)); });
    refreshAi();
  }, [refresh, refreshAi]);

  const tick = useCallback(async (n = 1) => {
    while (busy.current) await sleep(60);
    busy.current = true;
    try { const s = await api<Snap>("tick", { n }); setSnap(s); return s; } catch (e) { setErr(String(e)); setPlaying(false); return null; } finally { busy.current = false; }
  }, []);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => { if (!busy.current) tick(1); }, speed);
    return () => clearInterval(id);
  }, [playing, speed, tick]);

  useEffect(() => {
    if (!snap) return;
    const crit = snap.alerts.filter((a) => a.level === "CRITICAL");
    const top = crit.length ? Math.max(...crit.map((a) => a.id)) : 0;
    if (top > lastCrit.current) {
      lastCrit.current = top;
      if (playing) { setPlaying(false); say("Urgent: a shortage has started spreading. Paused so you can look — open Action Plans."); }
    }
  }, [snap, playing, say]);

  const inject = useCallback(async () => {
    const r = await api<{ ok: boolean; state: Snap }>("inject", {});
    setSnap(r.state);
    const d = r.state.districts[3];
    fly(d.lat, d.lng, 8.5);
    say("Dengue outbreak started in Shivgarh (district D4).");
  }, [fly, say]);

  const reset = useCallback(async () => {
    setPlaying(false); setPlanHl(null);
    const s = await api<Snap>("reset", {});
    lastCrit.current = 0;
    setSnap(s); setReadings([]); setStockFocus(null); setMeshMode("without"); setFocus(null); setSelPair({ d: 3, m: 0 });
    say("Everything is back to the starting point.");
  }, [say]);

  const addReading = useCallback((u: Omit<Reading, "id"> | null | undefined) => {
    if (!u) return;
    setReadings((r) => [{ ...u, id: ++readId.current }, ...r].slice(0, 12));
  }, []);

  const runPlanner = useCallback(async () => {
    setPlanBusy(true);
    try { await api("planner/run", {}); await refresh(); } finally { setPlanBusy(false); }
  }, [refresh]);
  const approvePlan = useCallback(async (name: string) => {
    setPlanBusy(true);
    try {
      const r = await api<{ ok: boolean; state: Snap }>("planner/approve", { name });
      if (r.ok) { setSnap(r.state); say(`${name[0]}${name.slice(1).toLowerCase()} plan approved — trucks are on the way.`); }
      return r.ok;
    } catch { return false; } finally { setPlanBusy(false); }
  }, [say]);
  const rejectPlans = useCallback(async () => { await api("planner/reject", {}); await refresh(); say("Plans dismissed."); }, [refresh, say]);

  const value: Ctx = {
    snap, err, clearErr: () => setErr(null), ai, aiStatus, refreshAi, playing, setPlaying, speed, setSpeed, refresh, tick, inject, reset, toast, say, focus, fly,
    selPair, setSelPair, stockFocus, setStockFocus, readings, addReading, meshMode, setMeshMode, planBusy, planHl, runPlanner, approvePlan, rejectPlans,
  };
  return <C.Provider value={value}>{children}</C.Provider>;
}
