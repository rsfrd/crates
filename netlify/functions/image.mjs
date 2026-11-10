// /api/image?url=… — fetches an image from a link you pasted, so the app can save its own copy.
// (Browsers can't download images from most sites directly; many sites also block hotlinking.)
import { ownerOnly, json } from "../lib/auth.mjs";

const MAX = 12 * 1024 * 1024;

export default async (req) => {
  const denied = await ownerOnly(req);
  if (denied) return denied;
  let url;
  try { url = new URL(new URL(req.url).searchParams.get("url") || ""); } catch { return json({ error: "That doesn't look like a link" }, 400); }
  if (!/^https?:$/.test(url.protocol) || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/.test(url.hostname)) {
    return json({ error: "That doesn't look like a link to an image" }, 400);
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (GarageCrates image fetch)", Accept: "image/*" }, signal: ctl.signal, redirect: "follow" });
    const type = res.headers.get("content-type") || "";
    if (!res.ok) return json({ error: `That site returned an error (${res.status})` }, 502);
    if (!type.startsWith("image/")) return json({ error: "That link opens a web page, not an image. Long-press the picture and copy the image address instead." }, 415);
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX) return json({ error: "That image is too large" }, 413);
    return new Response(buf, { headers: { "content-type": type, "cache-control": "no-store" } });
  } catch {
    return json({ error: "Couldn't download that image. Try another link, or save the picture and upload it." }, 502);
  } finally { clearTimeout(timer); }
};

export const config = { path: "/api/image" };
