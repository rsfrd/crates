// Reading a spreadsheet of records (CSV, tab- or semicolon-separated). Pure functions, no DOM.
import { fold } from "./search.js";

// Splits text into rows of cells, following the usual CSV rules: quoted cells may hold the
// separator, line breaks and doubled quotes ("" for "). The separator is guessed from the first line.
export function parseCSV(text) {
  text = String(text || "").replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const outside = first.replace(/"[^"]*"/g, "");
  const count = (ch) => outside.split(ch).length - 1;
  const [best] = ["\t", ";", ","].map((ch) => [ch, count(ch)]).sort((a, b) => b[1] - a[1]);
  const sep = best[1] ? best[0] : ",";
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && cell.trim() === "") { quoted = true; cell = ""; }
    else if (ch === sep) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return { sep, rows: rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== "")) };
}

// The fields a record can take, with header words that usually mean them.
export const FIELDS = [
  { key: "artist", label: "Artist", required: true, words: /^(artist|artists|band|performer|musician|by|artist name)$/ },
  { key: "title", label: "Album", required: true, words: /^(title|album|album title|release|record|name|album name)$/ },
  { key: "year", label: "Year", words: /^(year|released|release year|date|release date|original year)$/ },
  { key: "label", label: "Label", words: /^(label|record label|labels)$/ },
  { key: "catno", label: "Catalogue no.", words: /^(cat|catno|cat no|cat#|catalog|catalogue|catalog number|catalogue number|catalog no|catalogue no|cat number)$/ },
  { key: "genres", label: "Genre", words: /^(genre|genres|style|styles|category)$/ },
  { key: "notes", label: "Notes", words: /^(notes|note|comments|comment|condition|description)$/ },
  { key: "personnel", label: "Players", words: /^(personnel|players|musicians|credits|lineup|line up|band members)$/ },
];

const normHeader = (h) => fold(h).replace(/\s+/g, " ").trim();

// Does the first row look like headings rather than a record?
export function looksLikeHeader(row) {
  return (row || []).some((h) => FIELDS.some((f) => f.words.test(normHeader(h))));
}

// Best guess of which column holds which field: { artist: 0, title: 1, … } (missing ones left out).
export function guessColumns(header, hasHeader = true) {
  const map = {};
  if (hasHeader) {
    header.forEach((h, i) => {
      const n = normHeader(h);
      const f = FIELDS.find((f) => f.words.test(n) && map[f.key] == null);
      if (f) map[f.key] = i;
    });
  }
  if (map.artist == null && map.title == null && header.length >= 2) { map.artist = 0; map.title = 1; }
  return map;
}

const splitList = (s, re) => String(s || "").split(re).map((x) => x.trim()).filter(Boolean);

// Turns spreadsheet rows into records. Rows without an artist or album are counted, not imported.
export function recordsFromRows(rows, map, status = "owned") {
  const out = [], skipped = [];
  rows.forEach((r, i) => {
    const get = (k) => (map[k] != null ? (r[map[k]] || "").trim() : "");
    const artist = get("artist"), title = get("title");
    if (!artist || !title) { skipped.push(i); return; }
    const y = get("year").match(/\b(1[89]\d{2}|20\d{2})\b/);
    out.push({
      artist, title, status,
      year: y ? Number(y[1]) : null,
      label: get("label") || null,
      catno: get("catno") || null,
      genres: splitList(get("genres"), /\s*[\/,;|]\s*/),
      notes: get("notes") || null,
      personnel_hint: splitList(get("personnel"), /\s*[,;|]\s*/),
      enrich_status: "pending",
    });
  });
  return { records: out, skipped };
}

// Drops records already in the collection (same Discogs release, or same artist and album).
export function withoutDuplicates(records, existing) {
  const ids = new Set(existing.map((a) => a.discogs_id).filter(Boolean));
  const names = new Set(existing.map((a) => `${fold(a.artist)}|${fold(a.title)}`));
  const fresh = [], dupes = [];
  for (const r of records) {
    const key = `${fold(r.artist)}|${fold(r.title)}`;
    if ((r.discogs_id && ids.has(r.discogs_id)) || names.has(key)) dupes.push(r);
    else { fresh.push(r); names.add(key); if (r.discogs_id) ids.add(r.discogs_id); }
  }
  return { fresh, dupes };
}
