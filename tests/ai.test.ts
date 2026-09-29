import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

// Mock of generativelanguage.googleapis.com: one key, a mix of dead / quota-less / working models.
const LIST = [
  { name: "models/gemini-2.0-flash", supportedGenerationMethods: ["generateContent"] }, // shut down -> 404
  { name: "models/gemini-3.8-flash-tts", supportedGenerationMethods: ["generateContent"] }, // not text
  { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
  { name: "models/gemini-2.5-flash", supportedGenerationMethods: ["generateContent"] }, // 429 (limit 0 on this key)
  { name: "models/gemini-3.5-flash-lite", supportedGenerationMethods: ["generateContent"] }, // works, returns a thought part first
  { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
];
const hits: string[] = [];
let badKey = false;

const server = http.createServer((req, res) => {
  const url = req.url ?? "";
  res.setHeader("content-type", "application/json");
  if (badKey) { res.statusCode = 400; res.end(JSON.stringify({ error: { code: 400, message: "API key not valid. Please pass a valid API key." } })); return; }
  if (req.method === "GET" && url.startsWith("/v1beta/models")) { res.end(JSON.stringify({ models: LIST })); return; }
  const m = url.match(/\/v1beta\/models\/([^:]+):generateContent/);
  if (m) {
    hits.push(m[1]);
    if (m[1] === "gemini-2.0-flash") { res.statusCode = 404; res.end(JSON.stringify({ error: { code: 404, message: "models/gemini-2.0-flash is no longer available" } })); return; }
    if (m[1] === "gemini-2.5-flash") { res.statusCode = 429; res.end(JSON.stringify({ error: { code: 429, message: "quota exceeded, limit: 0" } })); return; }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: "internal reasoning..." }, { text: "OK" }] }, finishReason: "STOP" }] }));
    return;
  }
  res.statusCode = 404; res.end("{}");
});

test("model discovery, ranking and fallback", async () => {
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  process.env.GEMINI_API_KEY = "test-key";
  process.env.GEMINI_BASE_URL = `http://127.0.0.1:${port}/v1beta/models`;
  const ai = await import("../src/lib/prana/ai");

  // ranking: known-good first, TTS/embedding/pro excluded or demoted
  const ranked = ai.rankModels(["gemini-2.0-flash", "gemini-3.8-flash-tts", "gemini-2.5-pro", "gemini-3.5-flash-lite", "gemini-2.5-flash", "gemini-3-flash-preview"]);
  assert.equal(ranked[0], "gemini-2.5-flash");
  assert.ok(!ranked.includes("gemini-3.8-flash-tts"));
  assert.ok(ranked.indexOf("gemini-2.5-pro") > ranked.indexOf("gemini-3.5-flash-lite"));

  const t = await ai.testConnection();
  assert.equal(t.ok, true, JSON.stringify(t));
  assert.equal(t.model, "gemini-3.5-flash-lite"); // skipped 429 and 404, landed on a working one
  assert.equal(t.reply, "OK"); // thought part was filtered out
  assert.ok(!t.available.includes("gemini-embedding-001"));
  assert.ok(t.attempts.some((a) => a.code === 429) && t.attempts.some((a) => a.code === 200));

  // winner is cached: next call goes straight to it
  hits.length = 0;
  const out = await ai.aiText("sys", "hello");
  assert.equal(out, "OK");
  assert.deepEqual(hits, ["gemini-3.5-flash-lite"]);

  // pinning a model puts it first
  ai.setModel("gemini-2.5-pro");
  hits.length = 0;
  await ai.aiText("sys", "hello");
  assert.equal(hits[0], "gemini-2.5-pro");

  // bad key stops immediately with a clear message (no hammering every model)
  badKey = true;
  hits.length = 0;
  ai.setModel(null);
  const bad = await ai.generate([{ text: "x" }]);
  assert.equal(bad, null);
  assert.match(ai.aiStatus().listError ?? ai.aiStatus().lastError ?? "", /API key|list models|key/i);
  assert.equal(hits.length, 0);
  server.close();
});
