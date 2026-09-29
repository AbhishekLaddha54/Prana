"use client";
import { useState } from "react";
import { useSim } from "./SimContext";
import { api } from "./types";

interface Test {
  configured: boolean; ok: boolean; model: string | null; reply: string | null; error: string | null; listError: string | null;
  available: string[]; ranked: string[]; attempts: { model: string; code: number; message: string }[];
}

/** Checks the Gemini connection for real: lists the models this key can use, makes one tiny call, lets you pin a model. */
export function AiPanel() {
  const { ai, aiStatus, refreshAi } = useSim();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Test | null>(null);

  const run = async () => {
    setBusy(true);
    try { setRes(await api<Test>("ai/test")); await refreshAi(); } catch (e) { setRes({ configured: ai, ok: false, model: null, reply: null, error: String(e), listError: null, available: [], ranked: [], attempts: [] }); }
    finally { setBusy(false); }
  };
  const pin = async (model: string) => {
    setBusy(true);
    try { await api("ai/model", { model }); setRes(await api<Test>("ai/test")); await refreshAi(); } finally { setBusy(false); }
  };

  return (
    <section id="test" className="card scroll-mt-28 p-5 text-sm">
      <h2 className="font-serif text-xl font-bold">Test Gemini</h2>
      <p className="mt-1 text-muted">
        {ai ? "Key found. This asks Google which models your key can use and makes one tiny test call." : "No key found. Set GEMINI_API_KEY in the environment (or .env) and restart the server."}
      </p>
      <button className="btn btn-primary btn-sm mt-3 w-full" disabled={busy || !ai} onClick={run}>
        {busy ? <><span className="spinner" style={{ borderTopColor: "#fff" }} /> Checking…</> : "Test connection"}
      </button>

      {aiStatus?.lastError && !res && <div className="mt-3 rounded-xl bg-[#ffe9e9] p-3 text-xs text-[#8f1d21]">{aiStatus.lastError}</div>}

      {res && (
        <div className="fade-in mt-4 space-y-3">
          <div className={`rounded-xl p-3 ${res.ok ? "bg-moss-soft text-moss" : "bg-[#ffe9e9] text-[#8f1d21]"}`}>
            <div className="font-bold">{res.ok ? `Working — using ${res.model}` : "Not working yet"}</div>
            {res.ok ? <div className="text-xs">Gemini replied: “{res.reply}”</div> : <div className="mt-1 text-xs">{res.error}</div>}
          </div>
          {res.listError && <div className="rounded-xl bg-sun-soft p-3 text-xs text-[#8a5f00]">{res.listError}</div>}

          {res.available.length > 0 && (
            <div>
              <div className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">Models your key can use</div>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                {res.ranked.map((m) => (
                  <button key={m} disabled={busy} onClick={() => pin(m)} className={`btn btn-sm !px-2.5 !py-1 !text-[11.5px] ${m === res.model ? "!border-moss !bg-moss-soft" : "btn-soft"}`} title="Use this model">
                    {m}{m === res.model ? " ✓" : ""}
                  </button>
                ))}
              </div>
              <div className="mt-1 text-[11px] text-muted">Click a model to use it from now on (until the server restarts). To make it permanent set GEMINI_MODEL.</div>
            </div>
          )}

          {res.attempts.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer font-semibold">What was tried</summary>
              <table className="mt-2 w-full text-[11px]">
                <tbody>
                  {res.attempts.map((a, i) => (
                    <tr key={i} className="border-t border-line align-top">
                      <td className="py-1 pr-2 font-mono">{a.model}</td>
                      <td className={`pr-2 font-mono ${a.code === 200 ? "text-moss" : "text-alert"}`}>{a.code || "—"}</td>
                      <td className="text-muted">{a.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
