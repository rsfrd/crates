// Checks the Supabase session token the app sends, so only you can use these functions.
const okTokens = new Map(); // token -> expiry ms

export async function signedIn(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
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

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
