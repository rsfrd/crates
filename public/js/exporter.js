// Downloads of the whole collection: a readable CSV (one row per album) and a complete JSON backup
// that can be restored. Pure functions, no DOM.
import { creditsFor, creditKind, roleLabel } from "./search.js";

// ---------- CSV: everything, one row per album ----------

// Track list as lines. Classical pieces get a heading line ("Symphony No. 5 (Shostakovich)") with
// their movements indented under it.
export function trackLines(tracks = []) {
  const out = [];
  let lastKey = null;
  for (const t of tracks) {
    const line = [t.pos, t.title].filter(Boolean).join(" ") + (t.by ? ` (${t.by})` : "") + (t.dur ? `  ${t.dur}` : "");
    const key = t.work ? (t.wi ?? t.work) : null;
    if (key != null) {
      if (key !== lastKey) out.push(t.work + (t.wby ? ` (${t.wby})` : ""));
      out.push("  " + line);
    } else out.push(line);
    lastKey = key;
  }
  return out.join("\n");
}

// "Miles Davis: Leader, Trumpet", one per line. Players first (leaders, then sidemen, then composers),
// everyone else (producers, engineers, artwork) in a second list.
export function creditLines(album) {
  const credits = creditsFor(album);
  const allPos = new Set((album.tracks || []).map((t) => t.pos));
  const order = { leader: 0, player: 1, composer: 2 };
  const line = (c) => {
    const role = roleLabel(c, album);
    const on = c.tracks && c.tracks.length && c.tracks.length < allPos.size ? ` (on ${c.tracks.join(", ")})` : "";
    return c.name + (role ? `: ${role}` : "") + on;
  };
  const players = credits.filter((c) => creditKind(c, album) in order).sort((x, y) => order[creditKind(x, album)] - order[creditKind(y, album)]);
  const others = credits.filter((c) => !(creditKind(c, album) in order));
  return { personnel: players.map(line).join("\n"), other: others.map(line).join("\n") };
}

export const CSV_COLUMNS = [
  ["Artist", (a) => a.artist],
  ["Album", (a) => a.title],
  ["Status", (a) => (a.status === "want" ? "Wanted" : "Owned")],
  ["For sale", (a) => (a.for_sale ? "Yes" : "")],
  ["Original year", (a) => a.original_year],
  ["Pressing year", (a) => a.year],
  ["Label", (a) => a.label],
  ["Catalogue number", (a) => a.catno],
  ["Genres", (a) => (a.genres || []).join(", ")],
  ["Crates", (a) => (a.crates || []).join(", ")],
  ["File under", (a) => a.sort_as],
  ["Tracks", (a) => trackLines(a.tracks)],
  ["Personnel", (a) => creditLines(a).personnel],
  ["Other credits", (a) => creditLines(a).other],
  ["Notes", (a) => a.notes],
  ["In wash queue since", (a) => (a.to_wash_since ? String(a.to_wash_since).slice(0, 10) : "")],
  ["Last washed", (a) => (a.washed_at ? String(a.washed_at).slice(0, 10) : "")],
  ["Lowest price", (a) => (a.price && a.price.value != null ? `${Number(a.price.value).toFixed(2)} ${a.price.currency || ""}`.trim() : "")],
  ["Price checked", (a) => (a.price && a.price.checked_at ? a.price.checked_at.slice(0, 10) : "")],
  ["Discogs", (a) => a.discogs_url],
  ["Cover", (a) => (a.cover_url && /^https?:/.test(a.cover_url) ? a.cover_url : "")],
  ["Added", (a) => (a.created_at ? String(a.created_at).slice(0, 10) : "")],
];

const cell = (v) => {
  const s = v == null ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// A UTF-8 CSV that Excel, Numbers and Google Sheets all open with accents intact.
export function collectionCSV(albums) {
  const lines = [CSV_COLUMNS.map(([h]) => h).join(","), ...albums.map((a) => CSV_COLUMNS.map(([, f]) => cell(f(a))).join(","))];
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---------- JSON: a complete backup ----------

export const BACKUP_FORMAT = "garage-crates-backup";

export function collectionBackup(albums, siteName = "Garage Crates", now = new Date()) {
  const clean = albums.filter((a) => !a._pending).map((a) => {
    const out = {};
    for (const [k, v] of Object.entries(a)) if (!k.startsWith("_") && k !== "updated_at") out[k] = v;
    return out;
  });
  return { format: BACKUP_FORMAT, version: 1, site: siteName, saved_at: now.toISOString(), count: clean.length, albums: clean };
}

// Reads a backup file back into records ready to save. Ids are left behind (the database gives new
// ones); everything else, including tracks, personnel, covers and when each album was added, comes back.
export function readBackup(text) {
  let data;
  try { data = JSON.parse(String(text || "").replace(/^﻿/, "")); }
  catch { throw new Error("That isn’t a Garage Crates backup. Choose the .json file from Download a backup."); }
  const list = Array.isArray(data) ? data : data && Array.isArray(data.albums) ? data.albums : null;
  if (!list) throw new Error("That isn’t a Garage Crates backup. Choose the .json file from Download a backup.");
  const records = [];
  let skipped = 0;
  for (const a of list) {
    if (!a || typeof a.artist !== "string" || typeof a.title !== "string" || !a.artist.trim() || !a.title.trim()) { skipped++; continue; }
    const r = {};
    for (const [k, v] of Object.entries(a)) if (k !== "id" && k !== "updated_at" && !k.startsWith("_")) r[k] = v;
    r.status = r.status === "want" ? "want" : "owned";
    for (const k of ["genres", "crates", "tracks", "credits", "personnel_hint"]) if (k in r && !Array.isArray(r[k])) r[k] = [];
    records.push(r);
  }
  return {
    records, skipped,
    site: data && !Array.isArray(data) ? data.site || "" : "",
    savedAt: data && !Array.isArray(data) ? data.saved_at || "" : "",
  };
}
