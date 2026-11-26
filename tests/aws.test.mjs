// The AWS Lambda wrapper hands requests to the same functions Netlify runs.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const out = mkdtempSync(path.join(tmpdir(), "crates-aws-"));
execFileSync("bash", [new URL("../aws/build.sh", import.meta.url).pathname, out]);
const { handler, toRequest, fromResponse } = await import(path.join(out, "handler.mjs"));

const event = (rawPath, extra = {}) => ({
  rawPath, rawQueryString: "", headers: { host: "abc.lambda-url.us-east-2.on.aws", "x-forwarded-host": "crates.example.org" },
  requestContext: { http: { method: "GET" } }, ...extra,
});

test("config comes back from the Netlify function, unchanged", async () => {
  process.env.SUPABASE_URL = "https://x.supabase.co"; process.env.SUPABASE_ANON_KEY = "anon";
  const r = await handler(event("/api/config"));
  assert.equal(r.statusCode, 200);
  assert.equal(r.isBase64Encoded, false);
  assert.deepEqual(JSON.parse(r.body), { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon" });
});

test("lookups still need the owner's sign-in", async () => {
  const r = await handler(event("/api/discogs", { rawQueryString: "op=match&artist=a&title=b" }));
  assert.equal(r.statusCode, 401);
});

test("unknown paths are 404", async () => {
  assert.equal((await handler(event("/api/nope"))).statusCode, 404);
});

test("requests keep their query, headers and body", async () => {
  const req = toRequest(event("/api/discogs", {
    rawQueryString: "op=match&title=Kind%20Of%20Blue", headers: { authorization: "Bearer t", "x-forwarded-host": "crates.example.org" },
    requestContext: { http: { method: "POST" } }, body: Buffer.from("hi").toString("base64"), isBase64Encoded: true,
  }));
  assert.equal(req.url, "https://crates.example.org/api/discogs?op=match&title=Kind%20Of%20Blue");
  assert.equal(new URL(req.url).searchParams.get("title"), "Kind Of Blue");
  assert.equal(req.headers.get("authorization"), "Bearer t");
  assert.equal(await req.text(), "hi");
});

test("images come back as base64, JSON as text", async () => {
  const png = await fromResponse(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } }));
  assert.equal(png.isBase64Encoded, true);
  assert.deepEqual([...Buffer.from(png.body, "base64")], [137, 80, 78, 71]);
  const js = await fromResponse(new Response('{"a":1}', { status: 418, headers: { "content-type": "application/json" } }));
  assert.equal(js.isBase64Encoded, false);
  assert.equal(js.statusCode, 418);
  assert.equal(js.body, '{"a":1}');
});
