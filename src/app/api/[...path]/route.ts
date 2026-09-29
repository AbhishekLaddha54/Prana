import { NextRequest } from "next/server";
import { MEDS } from "@/lib/prana/core";
import * as E from "@/lib/prana/engine";
import { hasAI, setModel, testConnection } from "@/lib/prana/ai";
import { ingestManual, ingestRegister, ingestVoice, listRegisters, listVoiceNotes } from "@/lib/prana/sense";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const json = (data: unknown, status = 200) => Response.json(data, { status });

async function body(req: NextRequest): Promise<Record<string, unknown>> {
  try { return await req.json(); } catch { return {}; }
}

const AUDIO_OK = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/aac", "audio/ogg", "audio/webm", "audio/flac", "audio/x-flac"];
const IMG_OK = ["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic", "image/heif"];
const KB = 1024;

async function blobToData(file: Blob, accept: string[], label: string, maxBytes: number): Promise<{ data: string; mimeType: string } | { error: string }> {
  try {
    const type = file.type || "";
    if (accept.length && !accept.some((t) => type === t || type.startsWith(t.replace("/x-", "/"))))
      return { error: `${label} format ${type || "unknown"} is not supported. Use ${[...new Set(accept.map((t) => t.split("/")[1].replace(/^x-/, "")))].join(", ")}.` };
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > maxBytes)
      return { error: `${label} is ${Math.round(buf.length / KB)} KB — over the ${Math.round(maxBytes / KB)} KB limit. Compress or trim it.` };
    return { data: buf.toString("base64"), mimeType: type || "application/octet-stream" };
  } catch (e) { return { error: `Could not read that ${label.toLowerCase()}: ${String(e)}` }; }
}

/** Accepts either JSON or a multipart upload (field "audio" / "image"). */
async function input(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of fd.entries()) if (typeof v === "string") out[k] = v;
    const audio = fd.get("audio");
    const image = fd.get("image");
    const errs: string[] = [];
    if (audio instanceof Blob) {
      const a = await blobToData(audio, AUDIO_OK, "Audio", 9 * KB * KB);
      if ("error" in a) errs.push(a.error); else out.audio = a;
    }
    if (image instanceof Blob) {
      const i = await blobToData(image, IMG_OK, "Image", 6 * KB * KB);
      if ("error" in i) errs.push(i.error); else out.image = i;
    }
    if (errs.length) out.error = errs.join(" ");
    return out;
  }
  return body(req);
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const route = path.join("/");
  const q = req.nextUrl.searchParams;
  try {
    switch (route) {
      case "state":
        return json(E.snapshot());
      case "meta":
        return json({ ai: hasAI(), status: E.aiInfo(), meds: MEDS, seed: 42 });
      case "sense/voice-notes":
        return json(listVoiceNotes());
      case "sense/registers":
        return json(listRegisters());
      case "nowcast": {
        const r = E.nowcastDetail(q.get("phc") ?? "D4-P1", q.get("med") ?? "PAR");
        return r ? json(r) : json({ error: "unknown clinic or medicine" }, 404);
      }
      case "forecast":
        return json(E.forecastDetail(Number(q.get("d") ?? 3), Number(q.get("m") ?? 0)));
      case "mesh":
        return json(E.meshDetail());
      case "planner":
        return json({ plans: E.snapshot().planner });
      case "ai/briefing":
        return json(await E.briefing());
      case "ai/test":
        return json(await testConnection());
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const route = path.join("/");
  try {
    switch (route) {
      case "tick": {
        const b = await body(req);
        await E.tick(Math.max(1, Math.min(30, Number(b.n ?? 1))));
        return json(E.snapshot());
      }
      case "reset":
        E.resetSession();
        return json(E.snapshot());
      case "inject":
        return json({ ok: E.inject(), state: E.snapshot() });
      case "sense/voice": {
        const b = await input(req);
        const r = await ingestVoice(E.S().w, {
          sampleId: b.sampleId as string | undefined,
          transcript: b.transcript as string | undefined,
          phc: b.phc as string | undefined,
          audio: b.audio as { data: string; mimeType: string } | undefined,
        });
        if ((b as any).error) r.warning = (r.warning ? r.warning + " " : "") + String((b as any).error);
        E.recordAll();
        return json(r);
      }
      case "sense/register": {
        const b = await input(req);
        const r = await ingestRegister(E.S().w, {
          id: b.id as string | undefined,
          phc: b.phc as string | undefined,
          image: b.image as { data: string; mimeType: string } | undefined,
        });
        if ((b as any).error) r.warning = (r.warning ? r.warning + " " : "") + String((b as any).error);
        E.recordAll();
        return json(r);
      }

      case "sense/manual": {
        const b = await body(req);
        const r = ingestManual(E.S().w, String(b.phc), String(b.medicine), Number(b.units));
        E.recordAll();
        return json(r);
      }
      case "planner/run":
        return json({ plans: await E.runPlanner() });
      case "planner/approve": {
        const b = await body(req);
        const plan = E.approvePlan(String(b.name ?? "BALANCED"));
        return plan ? json({ ok: true, plan, state: E.snapshot() }) : json({ ok: false, error: "no such plan or already approved" }, 400);
      }
      case "planner/reject":
        E.rejectPlans();
        return json({ ok: true });
      case "mesh/round": {
        const b = await body(req);
        return json(E.meshRound(!!b.dp));
      }
      case "ai/model": {
        const b = await body(req);
        return json({ ok: true, status: setModel(typeof b.model === "string" ? b.model : null) });
      }
      case "ai/ask": {
        const b = await body(req);
        const question = String(b.question ?? "").slice(0, 800);
        if (!question.trim()) return json({ error: "empty question" }, 400);
        return json(await E.ask(question, Array.isArray(b.history) ? (b.history as { role: string; text: string }[]) : []));
      }
      default:
        return json({ error: "not found" }, 404);
    }
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
}
