// Checks the Supabase session the app sends. Lookups (Discogs, Bandcamp, images, prices) are for the
// site's owner only, so guests browsing with the passphrase can't use up the owner's Discogs allowance.
const checked = new Map(); // token -> { until, owner }

export async function whoIs(req, fetchImpl = fetch) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { signedIn: false, owner: false };
  const hit = checked.get(token);
  if (hit && hit.until > Date.now()) return { signedIn: true, owner: hit.owner };

  const base = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  const headers = { apikey: key, Authorization: `Bearer ${token}` };
  const user = await fetchImpl(`${base}/auth/v1/user`, { headers });
  if (!user.ok) return { signedIn: false, owner: false };

  // is_owner() comes from supabase/setup.sql (or updates/007). Sites set up before it existed
  // have no guests, so anyone signed in is the owner there.
  const rpc = await fetchImpl(`${base}/rest/v1/rpc/is_owner`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{}" });
  let owner = true;
  if (rpc.ok) owner = (await rpc.json()) === true;
  else if (rpc.status !== 404) owner = false;

  checked.set(token, { until: Date.now() + 5 * 60 * 1000, owner });
  return { signedIn: true, owner };
}

// Returns a Response to send back when the caller isn't the owner, or null when they are.
export async function ownerOnly(req, fetchImpl = fetch) {
  const who = await whoIs(req, fetchImpl);
  if (!who.signedIn) return json({ error: "not signed in" }, 401);
  if (!who.owner) return json({ error: "This is a view-only copy." }, 403);
  return null;
}

// Kept for anything that only needs a signed-in user.
export async function signedIn(req, fetchImpl = fetch) {
  return (await whoIs(req, fetchImpl)).signedIn;
}

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
