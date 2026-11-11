// The live-site path (Supabase sign-in, passphrase, owner check, import) against a stand-in Supabase.
// Run: node tests/browser-live.mjs <outdir>
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ROOT = new URL("../public/", import.meta.url).pathname;

// A tiny supabase-js look-alike that runs in the page. `window.__sb` sets up how the "server" behaves.
const FAKE_SUPABASE = `
const cfg = window.__sb;
const KEY = "fake-sb-session";
const rows = cfg.rows;
const who = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const err = (message, code) => ({ data: null, error: { message, code } });
const denied = () => err('new row violates row-level security policy for table "albums"', "42501");
const isOwner = () => who()?.email === cfg.ownerEmail;
function query(table) {
  const q = { table, op: "select", filters: [], one: false, range: null, payload: null, wantRows: false };
  const run = async () => {
    if (table === "site_settings") return cfg.settings ? { data: cfg.settings, error: null } : err('relation "site_settings" does not exist', "42P01");
    if (!who()) return { data: [], error: null };
    let set = rows.filter((r) => q.filters.every(([k, v]) => r[k] === v));
    if (q.op === "select") { if (q.range) set = set.slice(q.range[0], q.range[1] + 1); return { data: set, error: null }; }
    if (cfg.rules && !isOwner()) return denied();
    if (q.op === "insert") {
      const list = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => ({ id: crypto.randomUUID(), genres: [], crates: [], tracks: [], credits: [], personnel_hint: [], for_sale: false, created_at: new Date().toISOString(), ...r }));
      rows.push(...list); cfg.inserted = (cfg.inserted || 0) + list.length;
      return { data: q.one ? list[0] : list, error: null };
    }
    if (q.op === "update") { set.forEach((r) => Object.assign(r, q.payload)); return q.one ? (set[0] ? { data: set[0], error: null } : err("no rows")) : { data: set, error: null }; }
    if (q.op === "delete") { for (const r of set) rows.splice(rows.indexOf(r), 1); return { data: null, error: null }; }
  };
  const b = {
    select() { return b; }, order() { return b; }, range(a, z) { q.range = [a, z]; return b; },
    insert(p) { q.op = "insert"; q.payload = p; return b; }, update(p) { q.op = "update"; q.payload = p; return b; }, delete() { q.op = "delete"; return b; },
    eq(k, v) { q.filters.push([k, v]); return b; }, single() { q.one = true; return b; },
    then(ok, no) { return run().then(ok, no); },
  };
  return b;
}
export function createClient() {
  return {
    auth: {
      async getSession() { const u = who(); return { data: { session: u ? { access_token: "tok-" + u.email, user: u } : null } }; },
      async signInWithPassword({ email, password }) {
        const u = cfg.users.find((x) => x.email === email && x.password === password);
        if (!u) return err("Invalid login credentials");
        localStorage.setItem(KEY, JSON.stringify({ email })); return { data: { user: { email } }, error: null };
      },
      async signOut() { localStorage.removeItem(KEY); return { error: null }; },
    },
    from: query,
    async rpc(name) {
      if (name !== "is_owner") return err("unknown");
      if (!cfg.rules) return err("Could not find the function public.is_owner without parameters in the schema cache", "PGRST202");
      return { data: isOwner(), error: null };
    },
    storage: { from() { return { async upload() { return cfg.rules && !isOwner() ? err("new row violates row-level security policy") : { data: {}, error: null }; }, getPublicUrl(n) { return { data: { publicUrl: "/covers/" + n } }; } }; } },
  };
}`;

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const srv = http.createServer((rq, res) => {
  const u = new URL(rq.url, "http://x");
  if (u.pathname === "/api/config") { res.writeHead(200, { "content-type": "application/json" }); return res.end('{"supabaseUrl":"https://fake.supabase.co","supabaseAnonKey":"anon"}'); }
  if (u.pathname.startsWith("/api/")) { res.writeHead(404); return res.end(); }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f));
}).listen(5188);

const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });

async function site(setup) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => { window.__sb = s; }, setup);
  await ctx.route(/fonts\./, (r) => r.abort());
  await ctx.route(/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_SUPABASE }));
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  return p;
}
const rec = (i, extra = {}) => ({ id: "r" + i, artist: "Artist " + i, title: "Album " + i, status: "owned", genres: ["Jazz"], crates: [], tracks: [], credits: [], personnel_hint: [], for_sale: false, notes: "condition notes " + i, created_at: "2026-01-01", enrich_status: "matched", price: null, sort_as: null, master_id: null, ...extra });
const toastSays = (p, t) => p.waitForFunction((t) => document.querySelector("#toast")?.textContent.includes(t), t, { timeout: 3000 }).then(() => true, () => false);

// ---- a site with owner + guest set up
const p = await site({
  rules: true, ownerEmail: "me@example.com",
  users: [{ email: "me@example.com", password: "owner-pw" }, { email: "guests@example.com", password: "blue velvet lp" }],
  settings: [{ key: "site_name", value: "Sam’s Shelves" }, { key: "guest_email", value: "guests@example.com" }],
  rows: [rec(1), rec(2), rec(3, { status: "want" })],
});
await p.goto("http://localhost:5188/"); await p.waitForSelector(".login");
check((await p.textContent(".login h1")) === "Sam’s Shelves" && (await p.title()) === "Sam’s Shelves", "site name comes from settings, before signing in");
check(await p.locator('input[name="passphrase"]').count() === 1 && await p.locator("#to-owner").count() === 1, "passphrase first, owner sign-in link below");
await p.screenshot({ path: path.join(OUT, "l01-passphrase.png") });
await p.fill('input[name="passphrase"]', "wrong words"); await p.click("#login-guest button");
await p.waitForSelector(".login .note.warn");
check((await p.textContent(".login")).includes("That passphrase didn’t work"), "a wrong passphrase says so");
await p.fill('input[name="passphrase"]', "blue velvet lp"); await p.click("#login-guest button");
await p.waitForSelector(".row");
check((await p.textContent("#count")).includes("view only") && (await p.textContent(".brand h1")) === "Sam’s Shelves", "the passphrase opens a view-only copy");
await p.click('a.fab[href="#/add"]', { force: true });
check(await toastSays(p, "view-only"), "Add is view only");
await p.goto("http://localhost:5188/#/album/r1"); await p.waitForSelector(".album-title");
check((await p.inputValue("#notes")).includes("condition notes 1"), "guests see notes");
await p.goto("http://localhost:5188/#/import/csv"); await p.waitForTimeout(400);
check(!(await p.locator("#imp-file").count()), "guests can’t open the import screen by address");
// the guest stays signed in after a reload
await p.reload(); await p.waitForSelector(".row");
check((await p.textContent("#count")).includes("view only"), "guest stays signed in after a reload");
// sign out, then the owner signs in
await p.goto("http://localhost:5188/#/tools"); await p.waitForSelector("#signout");
await p.click("#signout"); await p.waitForSelector(".login");
await p.click("#to-owner"); await p.fill('input[name="email"]', "me@example.com"); await p.fill('input[name="password"]', "owner-pw");
await p.screenshot({ path: path.join(OUT, "l02-owner.png") });
await p.click("#login button"); await p.waitForSelector(".row");
check(!(await p.textContent("#count")).includes("view only") && await p.getAttribute('a.fab[href="#/add"]', "aria-disabled") === null, "the owner gets everything");
// the owner imports a spreadsheet into the live database
await p.goto("http://localhost:5188/#/import/csv"); await p.waitForSelector('label[for="imp-file"]');
const csv = "Artist,Album\n" + Array.from({ length: 450 }, (_, i) => `Band ${i},Record ${i}`).join("\n");
await p.setInputFiles("#imp-file", { name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await p.waitForSelector("#imp-save"); await p.click("#imp-save");
await p.waitForSelector(".importer .note strong", { timeout: 10000 });
check((await p.textContent(".importer")).includes("450 records imported") && (await p.evaluate(() => window.__sb.inserted)) === 450, "450 rows saved to Supabase (in batches)");
await p.evaluate(() => { location.hash = "#/"; }); await p.waitForSelector(".row"); await p.waitForTimeout(300);
const cnt = await p.textContent("#count"); check(cnt.includes("452 records"), "they are in the collection: " + cnt);

// ---- a site set up before owners and guests existed: unchanged
const old = await site({ rules: false, users: [{ email: "me@example.com", password: "pw" }], settings: null, rows: [rec(1)] });
await old.goto("http://localhost:5188/"); await old.waitForSelector(".login");
check(await old.locator('input[name="email"]').count() === 1 && !(await old.locator("#to-guest").count()) && (await old.textContent(".login h1")) === "Garage Crates", "an older site keeps the email sign-in and its name");
await old.fill('input[name="email"]', "me@example.com"); await old.fill('input[name="password"]', "pw"); await old.click("#login button");
await old.waitForSelector(".row");
check(!(await old.textContent("#count")).includes("view only"), "and its owner still has full access");

console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await b.close(); srv.close();
