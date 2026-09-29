// Gemini AI layer (Google AI Studio). Everything degrades gracefully to the deterministic
// offline helpers in sense.ts / planner.ts when no key is configured or calls fail.
//
// Key:   GEMINI_API_KEY (or GOOGLE_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY)
// Model: GEMINI_MODEL (optional pin). Otherwise we ask Google's ListModels endpoint which
//        models THIS key can use and try the best ones in order. Model names change often
//        (2.0 Flash is shut down, 3.x is current), so we never rely on a hardcoded name.

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const base = () => process.env.GEMINI_BASE_URL || DEFAULT_BASE;

// Only used when ListModels itself is unreachable.
const FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-flash-latest",
  "gemini-2.5-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-3-flash-preview",
];
// Errors where trying a different model can help (unknown model, per-model quota, overload).
const RETRY = new Set([404, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 8;
const DEADLINE_MS = 55_000;

export function aiKey(): string | null {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || null;
}
export const hasAI = () => !!aiKey();

export interface Attempt { model: string; code: number; message: string }
export interface AiStatus {
  configured: boolean;
  model: string | null; // model that last worked
  pinned: string | null; // model the user asked for
  calls: number;
  lastError: string | null;
  lastOkAt: number | null;
  attempts: Attempt[];
  listError: string | null;
}
const state = {
  model: null as string | null,
  pinned: (process.env.GEMINI_MODEL || "").trim() || null,
  calls: 0,
  lastError: null as string | null,
  lastOkAt: null as number | null,
  attempts: [] as Attempt[],
  listError: null as string | null,
  dead: new Set<string>(), // models that returned 404 on this key
  list: null as { at: number; ids: string[] } | null,
};
export const aiStatus = (): AiStatus => ({
  configured: !!aiKey(), model: state.model, pinned: state.pinned, calls: state.calls, lastError: state.lastError,
  lastOkAt: state.lastOkAt, attempts: state.attempts.slice(-12), listError: state.listError,
});

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };
interface Options { system?: string; json?: boolean; temperature?: number; maxTokens?: number }

function errMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    return String(j?.error?.message ?? body).replace(/\s+/g, " ").slice(0, 220);
  } catch {
    return body.replace(/\s+/g, " ").slice(0, 220);
  }
}

// ------------------------------------------------------------------ model discovery
/** Models this key may call with generateContent, text-capable only (no TTS / image / embedding / live). */
export async function listModels(force = false): Promise<string[] | null> {
  const key = aiKey();
  if (!key) return null;
  if (!force && state.list && Date.now() - state.list.at < 10 * 60_000) return state.list.ids;
  try {
    const ids: string[] = [];
    let token = "";
    for (let page = 0; page < 5; page++) {
      const url = `${base()}?pageSize=200${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`;
      const r = await fetch(url, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) {
        state.listError = `Could not list models (${r.status}): ${errMessage(await r.text())}`;
        return null;
      }
      const j = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
      for (const m of j.models ?? []) {
        if (m.supportedGenerationMethods?.includes("generateContent")) ids.push(m.name.replace(/^models\//, ""));
      }
      if (!j.nextPageToken) break;
      token = j.nextPageToken;
    }
    state.listError = null;
    state.list = { at: Date.now(), ids };
    return ids;
  } catch (e) {
    state.listError = `Could not reach the model list: ${e instanceof Error ? e.message : String(e)}`;
    return null;
  }
}

const NOT_TEXT = /(tts|image|live|embedding|robotics|transcribe|computer-use|omni|native-audio|aqa|learnlm|deep-research|antigravity|veo|lyria|imagen)/i;

/** Best first: known-good free-tier models, then stable Flash-Lite/Flash by version, previews and Pro last. */
export function rankModels(ids: string[]): string[] {
  const pref = [/^gemini-2\.5-flash$/, /^gemini-flash-latest$/, /^gemini-2\.5-flash-lite$/, /^gemini-flash-lite-latest$/];
  const ver = (id: string) => {
    const m = id.match(/gemini-(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const score = (id: string) => {
    const i = pref.findIndex((r) => r.test(id));
    if (i >= 0) return 1000 - i;
    let s = ver(id);
    if (/flash/.test(id)) s += 100;
    if (/lite/.test(id)) s += 20; // most generous free quota
    if (/preview|exp/.test(id)) s -= 60;
    if (/pro/.test(id)) s -= 80; // usually paid-only
    return s;
  };
  const usable = ids.filter((id) => /^gemini-/.test(id) && !NOT_TEXT.test(id));
  return [...new Set(usable)].sort((a, b) => score(b) - score(a));
}

async function candidates(): Promise<string[]> {
  const out: string[] = [];
  if (state.pinned && !state.dead.has(state.pinned)) out.push(state.pinned);
  if (state.model && !state.dead.has(state.model)) out.push(state.model);
  const listed = await listModels();
  const rest = listed && listed.length ? rankModels(listed) : FALLBACK_MODELS;
  for (const m of rest) if (!state.dead.has(m)) out.push(m);
  return [...new Set(out)].slice(0, MAX_ATTEMPTS);
}

// ------------------------------------------------------------------ calling
async function call(model: string, parts: Part[], o: Options): Promise<{ code: number; text: string | null; error: string | null }> {
  const key = aiKey();
  if (!key) return { code: 0, text: null, error: "No API key" };
  const body = {
    contents: [{ role: "user", parts }],
    ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
    generationConfig: {
      temperature: o.temperature ?? 0.1,
      // Thinking models (2.5 / 3.x) count their reasoning tokens against this budget, so keep it generous.
      maxOutputTokens: o.maxTokens ?? 8192,
      ...(o.json ? { responseMimeType: "application/json" } : {}),
    },
  };
  try {
    const r = await fetch(`${base()}/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    if (!r.ok) return { code: r.status, text: null, error: errMessage(await r.text()) };
    const j = await r.json();
    const cand = j?.candidates?.[0];
    // Skip "thought" parts — they are the model's reasoning, not the answer.
    const text: string = (cand?.content?.parts ?? [])
      .filter((p: { thought?: boolean }) => !p.thought)
      .map((p: { text?: string }) => p.text ?? "")
      .join("")
      .trim();
    if (!text) {
      const reason = cand?.finishReason ?? "UNKNOWN";
      const block = j?.promptFeedback?.blockReason;
      const msg = block
        ? `Gemini blocked the request (${block}).`
        : reason === "SAFETY" || reason === "RECITATION"
          ? `Gemini declined this content (${reason}). Try a clearer photo or shorter clip.`
          : reason === "MAX_TOKENS"
            ? "Gemini ran out of output room before answering (MAX_TOKENS)."
            : `Gemini returned no text (${reason}).`;
      return { code: 200, text: null, error: msg };
    }
    return { code: 200, text, error: null };
  } catch (e) {
    return { code: 0, text: null, error: e instanceof Error ? e.message : String(e) };
  }
}

function friendly(model: string, code: number, msg: string): string {
  if (code === 429) return `${model} hit its free-tier limit (${msg})`;
  if (code === 404) return `${model} is not available on this key`;
  if (code === 400 && /api key/i.test(msg)) return "Your API key was rejected. Create a fresh key at aistudio.google.com/apikey.";
  if (code === 401 || code === 403) return `Gemini refused this key (${code}): ${msg}`;
  return `${model}: ${msg}`;
}

/** Tries the pinned / last-working model first, then the best models this key can actually use. */
export async function generate(parts: Part[], o: Options = {}): Promise<string | null> {
  if (!hasAI()) return null;
  const started = Date.now();
  const list = await candidates();
  let last: { model: string; code: number; msg: string } | null = null;
  for (const model of list) {
    if (Date.now() - started > DEADLINE_MS) break;
    const r = await call(model, parts, o);
    if (r.text !== null) {
      state.model = model;
      state.calls++;
      state.lastOkAt = Date.now();
      state.lastError = null;
      state.attempts.push({ model, code: 200, message: "ok" });
      return r.text;
    }
    const message = r.error ?? "failed";
    state.attempts.push({ model, code: r.code, message });
    if (state.attempts.length > 40) state.attempts.splice(0, 20);
    last = { model, code: r.code, msg: message };
    if (r.code === 404) state.dead.add(model);
    if (state.model === model) state.model = null;
    // A bad key or malformed request will fail identically on every model — stop now.
    if (!RETRY.has(r.code) && r.code !== 200) break;
  }
  if (!last) {
    state.lastError = state.listError ?? "No Gemini model was available to try.";
  } else if (last.code === 404 || state.dead.size >= list.length) {
    const listed = state.list?.ids ? rankModels(state.list.ids).slice(0, 6) : [];
    state.lastError =
      "None of the models we tried are available on this key." +
      (listed.length ? ` Your key can use: ${listed.join(", ")}. Open Ask Prana → “Test Gemini” and pick one.` : state.listError ? ` ${state.listError}` : "");
  } else {
    state.lastError = friendly(last.model, last.code, last.msg);
  }
  return null;
}

function parseJson<T>(text: string | null): T | null {
  if (!text) return null;
  const s = text.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(s) as T; } catch {
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try { return JSON.parse(s.slice(a, b + 1)) as T; } catch { return null; }
    }
    return null;
  }
}

export async function aiJson<T>(system: string, user: string | Part[]): Promise<T | null> {
  const parts: Part[] = typeof user === "string" ? [{ text: user }] : user;
  return parseJson<T>(await generate(parts, { system, json: true, temperature: 0 }));
}

export async function aiText(system: string, user: string | Part[]): Promise<string | null> {
  const parts: Part[] = typeof user === "string" ? [{ text: user }] : user;
  const out = await generate(parts, { system, temperature: 0.3, maxTokens: 4096 });
  return out?.trim() ?? null;
}

// ------------------------------------------------------------------ diagnostics + pinning
export interface AiTest {
  configured: boolean;
  ok: boolean;
  model: string | null;
  reply: string | null;
  error: string | null;
  listError: string | null;
  available: string[];
  ranked: string[];
  attempts: Attempt[];
}

/** Lists the key's models, then makes one tiny real call. Safe to run from the UI. */
export async function testConnection(): Promise<AiTest> {
  if (!hasAI()) {
    return { configured: false, ok: false, model: null, reply: null, error: "No Gemini key found. Set GEMINI_API_KEY and restart the server.", listError: null, available: [], ranked: [], attempts: [] };
  }
  state.attempts = [];
  state.dead.clear();
  const ids = await listModels(true);
  const reply = await generate([{ text: "Reply with exactly the word: OK" }], { maxTokens: 256, temperature: 0 });
  return {
    configured: true, ok: reply !== null, model: state.model, reply: reply ? reply.slice(0, 80) : null,
    error: reply === null ? state.lastError : null, listError: state.listError,
    available: ids ?? [], ranked: ids ? rankModels(ids) : FALLBACK_MODELS, attempts: state.attempts.slice(-12),
  };
}

/** Pin a specific model for this server process (e.g. picked from the test panel). */
export function setModel(name: string | null): AiStatus {
  const clean = name ? name.replace(/^models\//, "").trim() : "";
  state.pinned = clean && /^[a-z0-9.\-_]+$/i.test(clean) ? clean : null;
  state.model = null;
  state.dead.clear();
  state.lastError = null;
  return aiStatus();
}
