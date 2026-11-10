// /api/bandcamp?url=… — reads the one Bandcamp page you pasted and returns its details.
// One page per paste, for your own catalogue; it never searches or crawls Bandcamp.
import { ownerOnly, json } from "../lib/auth.mjs";
import { parseBandcampPage } from "../lib/bandcamp.mjs";

const MAX = 4 * 1024 * 1024;

export default async (req) => {
  const denied = await ownerOnly(req);
  if (denied) return denied;
  let url;
  try { url = new URL(new URL(req.url).searchParams.get("url") || ""); } catch { return json({ error: "That doesn't look like a link" }, 400); }
  if (!/^https?:$/.test(url.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(url.hostname)) {
    return json({ error: "That doesn't look like a Bandcamp link" }, 400);
  }
  url.hash = ""; url.search = "";
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (GarageCrates personal catalogue)", Accept: "text/html" }, signal: ctl.signal, redirect: "follow" });
    if (!res.ok) return json({ error: `Bandcamp returned an error (${res.status}). Check the link.` }, 502);
    const html = await res.text();
    if (html.length > MAX) return json({ error: "That page is too large to read" }, 413);
    const release = parseBandcampPage(html, res.url || url.toString());
    if (!release || !release.discogs_title) {
      return json({ error: "That page doesn't look like a Bandcamp album or track. Open the album on Bandcamp and copy its link." }, 422);
    }
    return json({ status: "matched", release });
  } catch {
    return json({ error: "Couldn't reach that page. Try again, or check the link." }, 502);
  } finally { clearTimeout(timer); }
};

export const config = { path: "/api/bandcamp" };
