// PRANA-Sense: real inputs — voice notes (text or audio), register photos (bundled or uploaded),
// typed counts. Every channel lands in one JSON schema and feeds the Bayesian nowcast.
import fs from "node:fs";
import path from "node:path";
import voiceNotes from "@/data/voice_notes.json";
import registers from "@/data/registers.json";
import { MEDS, NM, getGeo } from "./core";
import { aiJson, aiStatus, hasAI, Part } from "./ai";

const why = () => aiStatus().lastError;
import { Band, Channel, observe } from "./nowcast";
import { World } from "./world";

export interface Extraction {
  phc_id: string | null;
  medicine: string | null;
  units_remaining: number | null;
  days_of_stock: number | null;
  footfall_trend: "rising" | "stable" | "falling";
  notes: string;
  confidence: number;
}
export interface Update {
  before: Band;
  after: Band;
  phc: string;
  medicine: string;
  channel: Channel;
}
export interface ObsResult {
  extraction: Extraction;
  update: Update | null;
  mode: "live" | "mock";
  transcript?: string;
  warning?: string;
}

export const listVoiceNotes = () => voiceNotes;
export const listRegisters = () => registers;

const MED_KEYS: [string, RegExp][] = [
  ["PAR", /paracetamol|crocin|bukhar ki dawa/i],
  ["ORS", /\bors\b|electral|oral rehydration/i],
  ["AMX", /amoxi/i],
  ["INS", /insulin/i],
  ["MAL", /antimalarial|malaria/i],
  ["OXY", /oxytocin/i],
  ["IFA", /\bifa\b|iron|folic/i],
  ["AZI", /azithro/i],
];
const HI_NUM: Record<string, number> = { das: 10, bees: 20, pachees: 25, tees: 30, chalis: 40, pachas: 50, saath: 60, sau: 100 };
const MED_LIST = MEDS.map((m) => m.name).join(", ");

export function resolvePhc(w: World, id: string | null): number {
  if (!id) return -1;
  return getGeo(w.seed).phcs.findIndex((p) => p.id.toLowerCase() === String(id).toLowerCase());
}

/** Deterministic offline extractor — same output shape as the AI path. */
function mockExtract(w: World, text: string, fallbackPhc?: string): Extraction {
  const m = text.match(/D\s?(\d{1,2})\s*[-\s]?\s*P\s?(\d)/i);
  const phc_id = m ? `D${+m[1]}-P${m[2]}` : fallbackPhc ?? null;
  const medHit = MED_KEYS.find(([, re]) => re.test(text));
  const mi = medHit ? MEDS.findIndex((x) => x.id === medHit[0]) : -1;
  const stripped = text.replace(/D\s?\d{1,2}\s*[-\s]?\s*P\s?\d/gi, " ");
  let units: number | null = null;
  const num = stripped.match(/(\d+)\s*(strip|packet|sachet|vial|capsule|dose|tablet|ampoule|goli)?/i);
  if (num) units = +num[1];
  else for (const wd of stripped.toLowerCase().split(/\W+/)) if (HI_NUM[wd]) { units = HI_NUM[wd]; break; }
  const p = resolvePhc(w, phc_id);
  let days: number | null = null;
  if (units != null && p >= 0 && mi >= 0) days = units / Math.max(w.dem[p * NM + mi], 0.1);
  if (/kal tak|aaj hi|khatam/i.test(text) && days != null) days = Math.min(days, 1.5);
  const footfall = /badh|zyada|increase|surge/i.test(text) ? "rising" : /\bkam\b|ghat|decrease/i.test(text) ? "falling" : "stable";
  const notes = [text.match(/since\s+\w+/i)?.[0] ?? "", /bukhar/i.test(text) ? "fever cases" : "", /dast/i.test(text) ? "diarrhoea cases" : "", /fridge/i.test(text) ? "cold chain ok" : ""].filter(Boolean).join("; ");
  const confidence = Math.min(0.92, 0.35 + (phc_id ? 0.15 : 0) + (mi >= 0 ? 0.2 : 0) + (units != null ? 0.17 : 0));
  return {
    phc_id, medicine: mi >= 0 ? MEDS[mi].name : null, units_remaining: units,
    days_of_stock: days != null ? Math.round(days * 10) / 10 : null,
    footfall_trend: footfall, notes, confidence: Math.round(confidence * 100) / 100,
  };
}

const SYS_EXTRACT =
  `You read clinic stock reports from a low-resource region. Reply with ONLY a JSON object: ` +
  `{"phc_id":"D4-P1","medicine":"one of: ${MED_LIST}","units_remaining":number|null,"days_of_stock":number|null,` +
  `"footfall_trend":"rising|stable|falling","notes":"short plain text","confidence":0-1}. ` +
  `Use null when a field is not stated. Never invent numbers.`;

function applyObservation(w: World, ex: Extraction, ch: Channel): Update | null {
  const p = resolvePhc(w, ex.phc_id);
  const m = MEDS.findIndex((x) => x.name === ex.medicine);
  if (p < 0 || m < 0) return null;
  let days = ex.days_of_stock;
  if (days == null && ex.units_remaining != null) days = ex.units_remaining / Math.max(w.dem[p * NM + m], 0.1);
  if (days == null) return null;
  const r = observe(w, p, m, days, ch);
  return { ...r, phc: ex.phc_id as string, medicine: ex.medicine as string, channel: ch };
}

function finish(w: World, ex: Extraction, ch: Channel, mode: "live" | "mock", extra: Partial<ObsResult> = {}): ObsResult {
  const update = applyObservation(w, ex, ch);
  if (update && ex.days_of_stock == null) ex.days_of_stock = Math.round(update.after.mu * 10) / 10;
  return { extraction: ex, update, mode, ...extra };
}

// ------------------------------------------------------------------ voice
export interface VoiceInput {
  sampleId?: string;
  transcript?: string;
  phc?: string;
  audio?: { data: string; mimeType: string };
}

export async function ingestVoice(w: World, input: VoiceInput): Promise<ObsResult> {
  const sample = voiceNotes.find((v) => v.id === input.sampleId);
  if (input.audio) {
    // Real audio → Gemini transcribes and extracts in one pass.
    const mime = input.audio.mimeType;
    const b64len = input.audio.data.length;
    if (b64len > 9_000_000) {
      return {
        extraction: { phc_id: null, medicine: null, units_remaining: null, days_of_stock: null, footfall_trend: "stable", notes: "", confidence: 0 },
        update: null, mode: "mock",
        warning: "That audio is larger than the 9 MB limit Gemini accepts on the free tier. Try a shorter clip or transcribe it yourself.",
      };
    }
    const parts: Part[] = [
      { inlineData: { mimeType: mime, data: input.audio.data } },
      {
        text:
          `This is a short voice note (${mime}) from a clinic worker in Demo Pradesh. Clinic IDs look like D4-P2. ` +
          "Reply with ONLY a JSON object: {\"transcript\":\"full transcription in the original language\", " +
          "\"extraction\":{\"phc_id\": string|null, \"medicine\": string|null, \"units_remaining\": number|null, " +
          "\"days_of_stock\": number|null, \"footfall_trend\": \"rising\"|\"stable\"|\"falling\", " +
          "\"notes\": short plain text, \"confidence\": 0-1}}. Use null for fields you cannot hear clearly." +
          (input.phc ? ` The clinic code is ${input.phc} if you cannot hear it.` : ""),
      },
    ];
    const out = await aiJson<{ transcript?: string; extraction?: Partial<Extraction> }>(SYS_EXTRACT, parts);
    const base = mockExtract(w, out?.transcript ?? "", input.phc);
    const ex: Extraction = { ...base, ...(out?.extraction ?? {}) };
    return finish(w, ex, "voice", out?.extraction ? "live" : "mock", {
      transcript: out?.transcript,
      warning: out?.extraction ? undefined : `Gemini could not read that audio${why() ? `: ${why()}` : "."} Nothing was recorded. Try a shorter clip (wav, mp3, m4a) or paste the text instead.`,
    });
  }
  const transcript = input.transcript?.trim() || sample?.transcript || "";
  let ex: Extraction | null = null;
  let mode: "live" | "mock" = "mock";
  if (hasAI() && transcript) {
    const j = await aiJson<Extraction>(SYS_EXTRACT, `${input.phc ? `Clinic code: ${input.phc}\n` : ""}Transcript:\n${transcript}`);
    if (j && (j.medicine || j.units_remaining != null)) { ex = { ...mockExtract(w, transcript, input.phc), ...j }; mode = "live"; }
  }
  let warning: string | undefined;
  if (!ex) {
    ex = mockExtract(w, transcript, input.phc);
    if (hasAI() && transcript) warning = `Gemini did not answer${why() ? ` (${why()})` : ""}, so the built-in reader was used instead.`;
  }
  return finish(w, ex, "voice", mode, { transcript, warning });
}

// ------------------------------------------------------------------ register photo
export interface Row { extraction: Extraction; update: Update | null; bbox: number[] | null }

export async function ingestRegister(w: World, opts: { id?: string; phc?: string; image?: { data: string; mimeType: string } }): Promise<{
  register: { id: string; phc: string; image: string | null; title: string };
  rows: Row[];
  mode: "live" | "mock";
  warning?: string;
}> {
  const reg = registers.find((r) => r.id === opts.id) ?? registers[0];
  const phc = opts.phc ?? reg.phc;
  let image: { data: string; mimeType: string };
  if (opts.image) {
    if (opts.image.data.length > 6_000_000) {
      return { register: { id: opts.id ?? "upload", phc, image: null, title: opts.id ?? "Uploaded register" }, rows: [], mode: "live", warning: "That photo is too large for the free tier. Try a smaller or compressed image." };
    }
    image = opts.image;
  } else {
    image = { data: fs.readFileSync(path.join(process.cwd(), "public", reg.image)).toString("base64"), mimeType: "image/png" };
  }
  const title = opts.image ? "Uploaded register photo" : reg.title;

  const SYS_VISION =
    `You read photographed paper stock registers from a clinic. Reply with ONLY JSON: ` +
    `{"phc_id":"D4-P2 or null","rows":[{"medicine":"one of: ${MED_LIST}","balance":number,"bbox":[x,y,w,h] as percentages 0-100}]}. ` +
    `Include every stock row you can read. bbox is that row's position in the image (percent of width/height). Never invent numbers.`;

  if (opts.image && !hasAI()) {
    return { register: { id: "upload", phc, image: null, title }, rows: [], mode: "mock", warning: "A Gemini API key is needed to read uploaded photos. Click one of the sample registers to see how photo reading works without a key, or add GEMINI_API_KEY." };
  }
  if (hasAI()) {
    const j = await aiJson<{ phc_id?: string; rows?: { medicine: string; balance: number; bbox?: number[] }[] }>(SYS_VISION, [
      { inlineData: { mimeType: image.mimeType, data: image.data } },
      { text: opts.phc ? `The clinic code for this register is ${opts.phc}.` : "Try to read the clinic code written on the register." },
    ]);
    if (j?.rows?.length) {
      const rows: Row[] = j.rows.slice(0, 12).map((r) => {
        const ex: Extraction = { phc_id: j.phc_id ?? phc, medicine: r.medicine, units_remaining: r.balance, days_of_stock: null, footfall_trend: "stable", notes: "read from register photo", confidence: 0.85 };
        const update = applyObservation(w, ex, "photo");
        return { extraction: ex, update, bbox: r.bbox ?? null };
      }).filter((r) => r.update);
      if (rows.length) return { register: { id: opts.id ?? "upload", phc: j.phc_id ?? phc, image: opts.image ? null : reg.image, title }, rows, mode: "live" };
    }
    // AI was reachable but couldn't read this photo — say so instead of pretending.
    if (opts.image) {
      return { register: { id: "upload", phc, image: null, title }, rows: [], mode: "live", warning: `We could not read any rows in that photo${why() ? `: ${why()}` : "."} Try a straighter, brighter shot with the table visible.` };
    }
  }

  const rows: Row[] = reg.rows.map((r) => {
    const ex: Extraction = { phc_id: reg.phc, medicine: r.medicine, units_remaining: r.balance, days_of_stock: null, footfall_trend: "stable", notes: "pre-baked read of the sample register", confidence: 0.8 };
    const update = applyObservation(w, ex, "photo");
    return { extraction: ex, update, bbox: r.bbox };
  });
  const warning = hasAI() && why() ? `Gemini could not read the sample photo (${why()}), so the pre-read values were used.` : undefined;
  return { register: { id: reg.id, phc: reg.phc, image: reg.image, title }, rows, mode: "mock", warning };
}

// ------------------------------------------------------------------ typed count
export function ingestManual(w: World, phcId: string, medicine: string, units: number): ObsResult {
  const med = MEDS.find((m) => m.id === medicine || m.name === medicine);
  const ex: Extraction = { phc_id: phcId, medicine: med?.name ?? null, units_remaining: units, days_of_stock: null, footfall_trend: "stable", notes: "typed count", confidence: 0.95 };
  return finish(w, ex, "manual", "mock");
}
