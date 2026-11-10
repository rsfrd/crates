import assert from "node:assert/strict";
import { test } from "node:test";
import { whoIs, ownerOnly } from "../netlify/lib/auth.mjs";

process.env.SUPABASE_URL = "https://x.supabase.co";
process.env.SUPABASE_ANON_KEY = "anon";
const req = (token) => new Request("https://site/api/discogs", { headers: token ? { authorization: `Bearer ${token}` } : {} });
// Stand-in Supabase: token "owner" and "guest" are signed in; is_owner() answers per token, or is missing.
const supabase = (rpc) => async (url, opts = {}) => {
  const token = (opts.headers.Authorization || "").split(" ")[1];
  if (url.endsWith("/auth/v1/user")) return new Response("{}", { status: ["owner", "guest", "old"].includes(token) ? 200 : 401 });
  if (url.endsWith("/rpc/is_owner")) return rpc(token);
  return new Response("", { status: 404 });
};
const rpc = (token) => (token === "old" ? new Response("not found", { status: 404 }) : new Response(JSON.stringify(token === "owner"), { status: 200 }));

test("owner may use lookups; guests get a view-only answer; strangers must sign in", async () => {
  assert.equal(await ownerOnly(req("owner"), supabase(rpc)), null);
  const g = await ownerOnly(req("guest"), supabase(rpc));
  assert.equal(g.status, 403);
  assert.match((await g.json()).error, /view-only/);
  assert.equal((await ownerOnly(req("nope"), supabase(rpc))).status, 401);
  assert.equal((await ownerOnly(req(null), supabase(rpc))).status, 401);
});

test("a site set up before owners existed keeps working (no is_owner yet)", async () => {
  assert.deepEqual(await whoIs(req("old"), supabase(rpc)), { signedIn: true, owner: true });
});

test("an error checking ownership fails closed", async () => {
  const broken = supabase(() => new Response("boom", { status: 500 }));
  const r = await whoIs(new Request("https://s", { headers: { authorization: "Bearer guest-2" } }), async (url, o) =>
    url.endsWith("/auth/v1/user") ? new Response("{}", { status: 200 }) : broken(url, o));
  assert.equal(r.owner, false);
});
