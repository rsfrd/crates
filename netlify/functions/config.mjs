// /api/config — hands the browser the public Supabase settings from Netlify's environment variables.
// (The anon key is designed to be public; your data is protected by sign-in + row level security.)
export default async () =>
  new Response(
    JSON.stringify({ supabaseUrl: process.env.SUPABASE_URL || "", supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "" }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } }
  );

export const config = { path: "/api/config" };
