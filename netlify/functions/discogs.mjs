// /api/discogs — signed-in lookups for album details and cover images.
//   ?op=match&artist=…&title=…&catno=…        best Discogs match + alternatives
//   ?op=fetch&ref=<discogs url | id>&artist=…  a specific release/master
//   ?op=search&q=…                             Discogs candidates to pick from
//   ?op=images&artist=…&title=…&discogs_id=…   alternative covers (Apple Music, Cover Art Archive, Discogs)
import { makeClient, match, fetchByRef, parseDiscogsRef, search, RateLimited } from "../lib/discogs.mjs";
import { findImages } from "../lib/images.mjs";
import { signedIn, json } from "../lib/auth.mjs";

export default async (req) => {
  if (!(await signedIn(req))) return json({ error: "not signed in" }, 401);

  const p = new URL(req.url).searchParams;
  const op = p.get("op");
  const token = process.env.DISCOGS_TOKEN;
  if (!token && op !== "images") return json({ error: "DISCOGS_TOKEN is not set in Netlify" }, 500);
  const client = token ? makeClient(token) : null;
  try {
    let body;
    if (op === "match") {
      body = await match(client, { artist: p.get("artist") || "", title: p.get("title") || "", catno: p.get("catno") || "" });
    } else if (op === "fetch") {
      const ref = parseDiscogsRef(p.get("ref"));
      if (!ref) return json({ error: "That isn't a Discogs link or release number" }, 400);
      const release = await fetchByRef(client, ref.type, ref.id, p.get("artist") || "");
      body = release ? { status: "matched", release } : { status: "not_found", release: null };
    } else if (op === "search") {
      body = { candidates: await search(client, p.get("q") || "") };
    } else if (op === "images") {
      body = {
        images: await findImages(client, {
          artist: p.get("artist") || "", title: p.get("title") || "",
          discogsId: p.get("discogs_id") || null, currentUrl: p.get("current") || null,
        }),
      };
    } else {
      return json({ error: "unknown op" }, 400);
    }
    if (client) body.rateRemaining = client.remaining;
    return json(body);
  } catch (e) {
    if (e instanceof RateLimited) return json({ error: "rate_limited", retryAfter: e.retryAfter }, 429);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/discogs" };
