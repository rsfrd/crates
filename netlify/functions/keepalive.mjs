// Runs once a day so the free Supabase project never sits idle long enough to be paused.
export default async () => {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return new Response("not configured", { status: 200 });
  const res = await fetch(`${url}/rest/v1/albums?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  console.log("keepalive", res.status);
  return new Response("ok");
};

export const config = { schedule: "@daily" };
