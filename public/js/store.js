// Data access: Supabase in production, browser storage in demo mode.
// Both expose the same shape: { mode, session(), signIn(), signOut(), settings(), isOwner(), load(), insert(),
// insertMany(), update(), remove(), token(), uploadCover() }

const CACHE_KEY = "crate.cache.v1";
const OUTBOX_KEY = "crate.outbox.v1";
const OWNER_KEY = "crate.owner.v1";
const FULL_KEY = "crate.fullLoad.v1";          // when the whole collection was last downloaded
const FULL_EVERY = 24 * 3600 * 1000;           // otherwise only changes are downloaded

const DEFAULTS = { siteName: "Garage Crates", guestEmail: "" };

function readLS(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } }
function writeLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); return true; } catch { return false; } }

// The saved copy of the collection lives in IndexedDB. With full track lists and personnel it runs to
// several MB, and Safari gives localStorage only about 5 MB per site, which the sign-in also needs: once
// it was full, Supabase couldn't save the session and every reload signed you out.
let dbOpen = null;
function idb() {
  dbOpen = dbOpen || new Promise((resolve, reject) => {
    const r = indexedDB.open("garage-crates", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("kv");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbOpen;
}
async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const q = db.transaction("kv").objectStore("kv").get(key);
    q.onsuccess = () => resolve(q.result);
    q.onerror = () => reject(q.error);
  });
}
async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("kv", "readwrite");
    tx.objectStore("kv").put(value, key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

let saveTimer = null, toSave = null;
export const cache = {
  async get() {
    // Versions before this kept the copy in localStorage: move it, which frees that space for the sign-in.
    const old = readLS(CACHE_KEY, null);
    if (old) {
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      try { await idbSet(CACHE_KEY, old); } catch {}
      return old;
    }
    try { return (await idbGet(CACHE_KEY)) ?? null; } catch { return null; }
  },
  // Writes are gathered for a moment, since a run of edits each replaces the whole copy.
  set(rows) {
    toSave = rows;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { idbSet(CACHE_KEY, toSave).catch(() => {}); }, 300);
  },
};

export async function createStore() {
  let cfg = null;
  try {
    const res = await fetch("/api/config", { cache: "no-store" });
    if (res.ok) cfg = await res.json();
  } catch { /* offline or running without Netlify */ }

  const forceDemo = new URLSearchParams(location.search).has("demo");
  if (!forceDemo && cfg && cfg.supabaseUrl && cfg.supabaseAnonKey) return supabaseStore(cfg);
  if (!forceDemo && !cfg && (await cache.get())) return offlineStore();
  return demoStore();
}

async function supabaseStore(cfg) {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } });
  const one = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };

  const store = {
    mode: "live",
    async session() { return (await sb.auth.getSession()).data.session; },
    async token() { return (await sb.auth.getSession()).data.session?.access_token || ""; },
    async signIn(email, password) { one(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    // Name and guest email anyone may read (site_settings). Older sites without the table get the defaults.
    async settings() {
      const r = await sb.from("site_settings").select("key, value");
      if (r.error || !r.data) return { ...DEFAULTS };
      const kv = Object.fromEntries(r.data.map((x) => [x.key, x.value]));
      return { siteName: kv.site_name || DEFAULTS.siteName, guestEmail: kv.guest_email || "" };
    },
    // Only the owner may change things. Sites without is_owner() yet have no guests, so everyone signed in is the owner.
    async isOwner() {
      const r = await sb.rpc("is_owner");
      if (!r.error) { writeLS(OWNER_KEY, r.data === true); return r.data === true; }
      if (/could not find|does not exist|PGRST202|404/i.test(`${r.error.code} ${r.error.message}`)) return true;
      return readLS(OWNER_KEY, true);   // network trouble: go with the last answer
    },
    // With the copy saved on this device, downloads only what changed since: records edited after the newest
    // one in the copy, plus the list of ids (to drop records deleted elsewhere). The whole collection is
    // downloaded once a day anyway, and whenever there's no copy.
    async load(saved) {
      const all = async (query) => {
        const rows = [];
        for (let from = 0; ; from += 1000) {
          const page = one(await query().range(from, from + 999));
          rows.push(...page);
          if (page.length < 1000) break;
        }
        return rows;
      };
      const full = async () => {
        const rows = await all(() => sb.from("albums").select("*").order("created_at"));
        writeLS(FULL_KEY, Date.now());
        store.lastLoad = { kind: "full", rows: rows.length };
        return rows;
      };
      const since = Array.isArray(saved) && saved.length && Date.now() - readLS(FULL_KEY, 0) < FULL_EVERY
        ? saved.reduce((m, r) => (r.updated_at && r.updated_at > m ? r.updated_at : m), "") : "";
      if (!since) return full();
      const [ids, changed, sample] = await Promise.all([
        all(() => sb.from("albums").select("id").order("id")),
        all(() => sb.from("albums").select("*").gte("updated_at", since).order("updated_at")),
        sb.from("albums").select("*").limit(1).then(one),
      ]);
      // A database update added or removed a field: the copy can't be patched, so start fresh.
      const fields = (r) => Object.keys(r || {}).sort().join(",");
      if (sample[0] && fields(sample[0]) !== fields(saved.find((r) => !r._pending))) return full();
      const present = new Set(ids.map((r) => r.id));
      const byId = new Map(saved.filter((r) => present.has(r.id)).map((r) => [r.id, r]));
      for (const r of changed) byId.set(r.id, r);
      if (ids.some((r) => !byId.has(r.id))) return full();   // something the copy can't account for: start fresh
      store.lastLoad = { kind: "changes", rows: changed.length, removed: saved.filter((r) => !present.has(r.id)).length };
      return [...byId.values()].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
    },
    async insert(row) { return one(await sb.from("albums").insert(row).select().single()); },
    async insertMany(rows, onProgress) {
      const saved = [];
      for (let i = 0; i < rows.length; i += 200) {
        saved.push(...one(await sb.from("albums").insert(rows.slice(i, i + 200)).select()));
        onProgress?.(saved.length);
      }
      return saved;
    },
    async update(id, patch) { return one(await sb.from("albums").update(patch).eq("id", id).select().single()); },
    async remove(id) { one(await sb.from("albums").delete().eq("id", id)); },
    // Saves a full-size and a small copy; returns their public addresses.
    async uploadCover(albumId, full, thumb) {
      const base = `${albumId}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const put = async (name, blob) => {
        const r = await sb.storage.from("covers").upload(name, blob, { contentType: blob.type || "image/jpeg", cacheControl: "31536000", upsert: false });
        if (r.error) throw new Error(/bucket not found/i.test(r.error.message) ? "Cover uploads aren’t set up yet. Run supabase/updates/002_covers.sql in Supabase." : r.error.message);
        return sb.storage.from("covers").getPublicUrl(name).data.publicUrl;
      };
      const [cover_url, thumb_url] = await Promise.all([put(`${base}.jpg`, full), put(`${base}-thumb.jpg`, thumb)]);
      return { cover_url, thumb_url };
    },
    canEnrich: true,
  };
  return store;
}

// Opened with no connection: show the last copy, read-only except queued want-list adds.
function offlineStore() {
  return {
    mode: "offline",
    async session() { return { offline: true }; },
    async token() { return ""; },
    async signIn() {}, async signOut() {},
    async load() { return (await cache.get()) || []; },
    async insert() { throw new Error("offline"); },
    async update() { throw new Error("You’re offline. Changes will need a connection."); },
    async remove() { throw new Error("You’re offline. Changes will need a connection."); },
    async uploadCover() { throw new Error("You’re offline. Changes will need a connection."); },
    async insertMany() { throw new Error("You’re offline. Importing needs a connection."); },
    async settings() { return { ...DEFAULTS, ...readLS("crate.settings.v1", {}) }; },
    async isOwner() { return readLS(OWNER_KEY, true); },
    canEnrich: false,
  };
}

function demoStore() {
  const KEY = "crate.demo.v1";
  const save = (rows) => writeLS(KEY, rows);
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
  return {
    mode: "demo",
    async session() { return { demo: true }; },
    async token() { return ""; },
    async signIn() {}, async signOut() {},
    async load() {
      let rows = readLS(KEY, null);
      if (!rows) {
        const res = await fetch("demo.json");
        rows = res.ok ? await res.json() : [];
        save(rows);
      }
      return rows;
    },
    async insert(row) {
      const rows = readLS(KEY, []);
      const full = { id: uid(), genres: [], status: "owned", for_sale: false, tracks: [], credits: [], personnel_hint: [], enrich_status: "pending", created_at: new Date().toISOString(), ...row };
      rows.push(full); save(rows); return full;
    },
    async update(id, patch) {
      const rows = readLS(KEY, []);
      const i = rows.findIndex((r) => r.id === id);
      rows[i] = { ...rows[i], ...patch }; save(rows); return rows[i];
    },
    async remove(id) { save(readLS(KEY, []).filter((r) => r.id !== id)); },
    async insertMany(rows, onProgress) {
      const saved = [];
      for (const row of rows) saved.push(await this.insert(row));
      onProgress?.(saved.length);
      return saved;
    },
    async settings() { return { ...DEFAULTS }; },
    // "?demo&guest" previews what someone with the passphrase sees.
    async isOwner() { return !new URLSearchParams(location.search).has("guest"); },
    // Demo mode keeps images in this browser only.
    async uploadCover(albumId, full, thumb) {
      const asData = (b) => new Promise((ok, no) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(b); });
      const t = await asData(thumb);
      return { cover_url: t, thumb_url: t };
    },
    // "?demo&demoapi" lets the demo talk to a test server’s lookup endpoints.
    canEnrich: new URLSearchParams(location.search).has("demoapi"),
  };
}

// Want-list adds made with no signal wait here until the next successful connection.
export const outbox = {
  all: () => readLS(OUTBOX_KEY, []),
  push: (row) => writeLS(OUTBOX_KEY, [...readLS(OUTBOX_KEY, []), row]),
  async flush(store) {
    const pending = readLS(OUTBOX_KEY, []);
    if (!pending.length || store.mode !== "live") return [];
    const done = [], left = [];
    for (const row of pending) {
      const { id, _pending, ...clean } = row;
      try { done.push(await store.insert(clean)); } catch { left.push(row); }
    }
    writeLS(OUTBOX_KEY, left);
    return done;
  },
};
