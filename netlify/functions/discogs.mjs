// /api/discogs — signed-in lookups for album details and cover images.
//   ?op=match&artist=…&title=…&catno=…        best Discogs match + alternatives
//   ?op=fetch&ref=<discogs url | id>&artist=…  a release/master, swapped for its vinyl LP unless &exact=1
//   ?op=search&q=…                             Discogs candidates to pick from
//   ?op=images&artist=…&title=…&discogs_id=…   alternative covers (Apple Music, Cover Art Archive, Discogs)
//   ?op=price&id=<release id>[&master=1]       lowest marketplace price in USD + copies for sale
//   ?op=collection&username=…&list=collection|wants&page=N   one page of someone’s Discogs collection or want list
import { makeClient, match, fetchByRef, parseDiscogsRef, search, marketplace, collectionPage, DiscogsUserError, RateLimited } from "../lib/discogs.mjs";
import { findImages } from "../lib/images.mjs";
import { ownerOnly, json } from "../lib/auth.mjs";

export default async (req) => {
  const denied = await ownerOnly(req);
  if (denied) return denied;

  const p = new URL(req.url).searchParams;
  const op = p.get("op");
  const token = process.env.DISCOGS_TOKEN;
  if (!token && op !== "images") return json({ error: "DISCOGS_TOKEN is not set on the server" }, 500);
  const client = token ? makeClient(token) : null;
  try {
    let body;
    if (op === "match") {
      body = await match(client, { artist: p.get("artist") || "", title: p.get("title") || "", catno: p.get("catno") || "" });
    } else if (op === "fetch") {
      const ref = parseDiscogsRef(p.get("ref"));
      if (!ref) return json({ error: "That isn’t a Discogs link or release number" }, 400);
      const release = await fetchByRef(client, ref.type, ref.id, p.get("artist") || "", { preferVinyl: p.get("exact") !== "1" });
      body = release ? { status: "matched", release } : { status: "not_found", release: null };
    } else if (op === "search") {
      body = { candidates: await search(client, p.get("q") || "", { anyFormat: p.get("any") === "1" }) };
    } else if (op === "price") {
      const id = Number(p.get("id"));
      if (!Number.isInteger(id) || id <= 0) return json({ error: "Missing a Discogs release number" }, 400);
      body = { price: await marketplace(client, id, { withMaster: p.get("master") === "1", withFormat: p.get("fmt") === "1" }) };
    } else if (op === "collection") {
      body = await collectionPage(client, p.get("username"), p.get("list") === "wants" ? "wants" : "collection", Math.max(1, Number(p.get("page")) || 1));
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
    if (e instanceof DiscogsUserError) return json({ error: e.message }, 400);
    return json({ error: String(e.message || e) }, 502);
  }
};

export const config = { path: "/api/discogs" };
