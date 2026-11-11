import test from "node:test";
import assert from "node:assert/strict";
import { collectionCSV, collectionBackup, readBackup, trackLines, creditLines, CSV_COLUMNS } from "../public/js/exporter.js";
import { parseCSV, guessColumns, recordsFromRows } from "../public/js/importer.js";

const mingus = {
  id: "a1", artist: "Charles Mingus", title: "Mingus Ah Um", status: "owned", for_sale: true, year: 1959, label: "Columbia", catno: "CS 8171",
  genres: ["Jazz", "Hard Bop"], crates: ["late night"], sort_as: null, notes: 'Mint, "6-eye" label,\nbought in Tokyo',
  tracks: [{ pos: "A1", title: "Better Git It In Your Soul", dur: "7:23" }, { pos: "A2", title: "Goodbye Pork Pie Hat", dur: "5:44" }],
  credits: [
    { name: "Charles Mingus", roles: ["Bass", "Piano"], tracks: [], leader: true, kind: "musician" },
    { name: "John Handy", roles: ["Alto Saxophone"], tracks: ["A1"], leader: false, kind: "musician" },
    { name: "Teo Macero", roles: ["Producer"], tracks: [], leader: false, kind: "other" },
  ],
  price: null, created_at: "2025-03-01T10:00:00Z", updated_at: "2026-01-01T00:00:00Z", cover_url: "https://i.discogs.com/x.jpg",
  discogs_url: "https://www.discogs.com/release/1",
};
const shosta = {
  id: "a2", artist: "Shostakovich", title: "Symphony No. 5", status: "want", genres: ["Classical"], crates: [],
  tracks: [
    { pos: "A1", title: "I. Moderato", dur: "15:30", work: "Symphony No. 5 In D Minor, Op. 47", wi: 0, wby: "Dmitri Shostakovich" },
    { pos: "B1", title: "II. Allegretto", dur: "5:10", work: "Symphony No. 5 In D Minor, Op. 47", wi: 0, wby: "Dmitri Shostakovich" },
  ],
  credits: [], price: { value: 24.5, currency: "USD", checked_at: "2026-11-09T18:00:00Z" },
};

test("tracks: one per line, classical movements under their piece and composer", () => {
  assert.equal(trackLines(mingus.tracks), "A1 Better Git It In Your Soul  7:23\nA2 Goodbye Pork Pie Hat  5:44");
  assert.equal(trackLines(shosta.tracks), "Symphony No. 5 In D Minor, Op. 47 (Dmitri Shostakovich)\n  A1 I. Moderato  15:30\n  B1 II. Allegretto  5:10");
});

test("personnel: leader first with roles, track notes, other credits apart", () => {
  const c = creditLines(mingus);
  assert.equal(c.personnel, "Charles Mingus: Leader, Bass, Piano\nJohn Handy: Alto Saxophone (on A1)");
  assert.equal(c.other, "Teo Macero: Producer");
});

test("CSV: headings, quoting and line breaks survive a round trip through the CSV reader", () => {
  const text = collectionCSV([mingus, shosta]);
  assert.ok(text.startsWith("﻿"), "starts with a BOM so Excel reads accents");
  const { rows } = parseCSV(text);
  assert.deepEqual(rows[0], CSV_COLUMNS.map(([h]) => h));
  const col = (h) => rows[0].indexOf(h);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][col("Notes")], 'Mint, "6-eye" label,\nbought in Tokyo');
  assert.equal(rows[1][col("For sale")], "Yes");
  assert.equal(rows[1][col("Crates")], "late night");
  assert.equal(rows[2][col("Status")], "Wanted");
  assert.equal(rows[2][col("Lowest price")], "24.50 USD");
  assert.equal(rows[2][col("Price checked")], "2026-11-09");
  assert.ok(rows[1][col("Personnel")].includes("John Handy: Alto Saxophone (on A1)"));
});

test("a downloaded CSV imports back in: status per row, names from personnel", () => {
  const { rows } = parseCSV(collectionCSV([mingus, shosta]));
  const map = guessColumns(rows[0], true);
  const { records } = recordsFromRows(rows.slice(1), map, "owned");
  assert.equal(records.length, 2);
  assert.equal(records[0].status, "owned");
  assert.equal(records[1].status, "want");
  assert.deepEqual(records[0].personnel_hint, ["Charles Mingus", "John Handy"]);
  assert.equal(records[0].catno, "CS 8171");
  assert.deepEqual(records[0].genres, ["Jazz", "Hard Bop"]);
});

test("backup: everything comes back except ids and edit times", () => {
  const backup = collectionBackup([mingus, shosta, { id: "p", _pending: true, artist: "x", title: "y" }], "My Shelves", new Date("2026-11-09T20:00:00Z"));
  assert.equal(backup.format, "garage-crates-backup");
  assert.equal(backup.count, 2, "unsaved want-list adds are left out");
  const back = readBackup(JSON.stringify(backup));
  assert.equal(back.site, "My Shelves");
  assert.equal(back.savedAt, "2026-11-09T20:00:00.000Z");
  assert.equal(back.records.length, 2);
  const { id, updated_at, ...rest } = mingus;
  assert.deepEqual(back.records[0], rest);
  assert.deepEqual(back.records[1].tracks, shosta.tracks);
  assert.deepEqual(back.records[1].price, shosta.price);
});

test("backup: rejects other files, skips broken entries", () => {
  assert.throws(() => readBackup("artist,title\nx,y"), /isn’t a Garage Crates backup/);
  assert.throws(() => readBackup('{"hello":1}'), /isn’t a Garage Crates backup/);
  const r = readBackup(JSON.stringify({ albums: [{ artist: "A", title: "B", genres: "oops" }, { artist: "", title: "C" }, null] }));
  assert.equal(r.records.length, 1);
  assert.equal(r.skipped, 2);
  assert.deepEqual(r.records[0].genres, []);
  assert.equal(r.records[0].status, "owned");
});
