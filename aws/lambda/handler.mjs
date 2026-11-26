// AWS Lambda entry point for the same server functions Netlify runs (netlify/functions/*.mjs).
// CloudFront sends /api/* to this function's URL; each request is handed to the matching
// Netlify-style function as a standard web Request, and its Response is turned back into Lambda's format.
// aws/build.sh copies this file next to netlify/functions and netlify/lib before deploying.

import discogs from "./functions/discogs.mjs";
import image from "./functions/image.mjs";
import bandcamp from "./functions/bandcamp.mjs";
import config from "./functions/config.mjs";
import keepaliveFn from "./functions/keepalive.mjs";

const ROUTES = { "/api/discogs": discogs, "/api/image": image, "/api/bandcamp": bandcamp, "/api/config": config };

const TEXT = /^(text\/|application\/(json|javascript|xml)|image\/svg)/i;

// Lambda function URL event (payload format 2.0) -> Request
export function toRequest(event) {
  const h = event.headers || {};
  const host = h["x-forwarded-host"] || h.host || "localhost";
  const url = `https://${host}${event.rawPath || "/"}${event.rawQueryString ? `?${event.rawQueryString}` : ""}`;
  const method = event.requestContext?.http?.method || "GET";
  const headers = new Headers();
  for (const [k, v] of Object.entries(h)) if (v != null) headers.set(k, v);
  if (event.cookies?.length) headers.set("cookie", event.cookies.join("; "));
  const body = event.body == null || method === "GET" || method === "HEAD"
    ? undefined
    : event.isBase64Encoded ? Buffer.from(event.body, "base64") : event.body;
  return new Request(url, { method, headers, body });
}

// Response -> Lambda function URL result
export async function fromResponse(res) {
  const headers = {};
  res.headers.forEach((v, k) => { if (k !== "set-cookie") headers[k] = v; });
  const cookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const type = res.headers.get("content-type") || "";
  const binary = type && !TEXT.test(type);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    statusCode: res.status,
    headers,
    ...(cookies.length ? { cookies } : {}),
    body: binary ? buf.toString("base64") : buf.toString("utf8"),
    isBase64Encoded: binary,
  };
}

export const handler = async (event) => {
  const fn = ROUTES[(event.rawPath || "").replace(/\/+$/, "")];
  if (!fn) return { statusCode: 404, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "not found" }) };
  try {
    return await fromResponse(await fn(toRequest(event)));
  } catch (e) {
    console.error(e);
    return { statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: "Something went wrong on the server" }) };
  }
};

// Daily schedule: keeps the free Supabase project from being paused for inactivity.
export const keepalive = async () => {
  const res = await keepaliveFn();
  return { status: res.status, body: await res.text() };
};
