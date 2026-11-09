// /api/discogs — signed-in proxy to the Discogs API.
//   ?op=match&artist=…&title=…&catno=…   best match + alternatives
//   ?op=fetch&ref=<discogs url | id>&artist=…  a specific release/master
//   ?op=search&q=…                         candidates to pick from
import { makeClient, match, fetchByRef, parseDiscogsRef, search, RateLimited } from "../lib/discogs.mjs";

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });

const okTokens = new Map(); // token -> expiry ms (small cache so we don't hit Supabase on every call)

async function signedIn(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return false;
  const exp = okTokens.get(token);
  if (exp && exp > Date.now()) return true;
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return false;
  okTokens.set(token, Date.now() + 5 * 60 * 1000);
  return true;
}

export default async (req) => {
  if (!process.env.DISCOGS_TOKEN) return json({ error: "DISCOGS_TOKEN is not set in Netlify" }, 500);
  if (!(await signedIn(req))) return json({ error: "not signed in" }, 401);

  const p = new URL(req.url).searchParams;
  const client = makeClient(process.env.DISCOGS_TOKEN);
  try {
    const op = p.get("op");
    let body;
    if (op === "match") {
      body = await match(client, { artist: p.get("artist") || "", title: p.get("title") || "", catno: p.get("catno") || "" });
    } else if (op === "fetch") {
      const ref = parseDiscogsRef(p.get("ref"));
      if (!ref) return json({ error: "Couldn't read that Discogs link or number" }, 400);
      const release = await fetchByRef(client, ref.type, ref.id, p.get("artist") || "");
      body = release ? { status: "matched", release } : { status: "not_found", release: null };
    } else if (op === "search") {
      body = { candidates: await search(client, p.get("q") || "") };
    } else {
      return json({ error: "unknown op" }, 400);
    }
    body.rateRemaining = client.remaining;
    return json(body);
  } catch (e) {
    if (e instanceof RateLimited) return json({ error: "rate_limited", retryAfter: e.retryAfter }, 429);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/discogs" };
