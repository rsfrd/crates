import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCSV, looksLikeHeader, guessColumns, recordsFromRows, withoutDuplicates } from "../public/js/importer.js";
import { collectionPage, rowFromDiscogs, makeClient } from "../netlify/lib/discogs.mjs";

test("CSV: quotes, commas and line breaks inside cells, doubled quotes, BOM, CRLF", () => {
  const { sep, rows } = parseCSV('﻿Artist,Album,Notes\r\nSimon & Garfunkel,"Parsley, Sage, Rosemary and Thyme","Says ""mint""\nbut it isn\'t"\r\n\r\nPavement,"Crooked Rain, Crooked Rain",\r\n');
  assert.equal(sep, ",");
  assert.deepEqual(rows, [
    ["Artist", "Album", "Notes"],
    ["Simon & Garfunkel", "Parsley, Sage, Rosemary and Thyme", 'Says "mint"\nbut it isn\'t'],
    ["Pavement", "Crooked Rain, Crooked Rain", ""],
  ]);
});

test("CSV: tab and semicolon files are recognised", () => {
  assert.equal(parseCSV("Artist\tTitle\nBeck\tOdelay").sep, "\t");
  assert.deepEqual(parseCSV("Artist;Title;Year\nBeck;Odelay;1996").rows[1], ["Beck", "Odelay", "1996"]);
});

test("column guessing from common headings", () => {
  const header = ["Album Title", "Artist Name", "Catalog #", "Released", "Genre", "Personnel", "Condition"];
  assert.ok(looksLikeHeader(header));
  const map = guessColumns(["Album Title", "Artist Name", "Catalog Number", "Released", "Genre", "Personnel", "Condition"]);
  assert.deepEqual(map, { title: 0, artist: 1, catno: 2, year: 3, genres: 4, personnel: 5, notes: 6 });
  assert.ok(!looksLikeHeader(["Beck", "Odelay"]));
  assert.deepEqual(guessColumns(["Beck", "Odelay"], false), { artist: 0, title: 1 });
});

test("rows become records; incomplete rows are skipped", () => {
  const rows = [["Charles Mingus", "Mingus Ah Um", "1959", "Jazz / Post Bop", "Jimmy Knepper, Dannie Richmond"], ["", "No artist"], ["Beck", "Odelay", "reissue 2016", "", ""]];
  const { records, skipped } = recordsFromRows(rows, { artist: 0, title: 1, year: 2, genres: 3, personnel: 4 }, "want");
  assert.deepEqual(skipped, [1]);
  assert.equal(records.length, 2);
  assert.deepEqual(records[0], { artist: "Charles Mingus", title: "Mingus Ah Um", status: "want", year: 1959, label: null, catno: null,
    genres: ["Jazz", "Post Bop"], notes: null, personnel_hint: ["Jimmy Knepper", "Dannie Richmond"], enrich_status: "pending" });
  assert.equal(records[1].year, 2016);
});

test("duplicates of what you already have are left out", () => {
  const existing = [{ artist: "Beck", title: "Odelay" }, { artist: "X", title: "Y", discogs_id: 42 }];
  const { fresh, dupes } = withoutDuplicates([{ artist: "BECK", title: "odelay" }, { artist: "Z", title: "Q", discogs_id: 42 }, { artist: "New", title: "One" }, { artist: "New", title: "One" }], existing);
  assert.deepEqual(fresh.map((r) => r.title), ["One"]);
  assert.equal(dupes.length, 3);
});

// Shaped like Discogs' /users/{name}/collection/folders/0/releases response
const bi = (id, extra = {}) => ({ id, master_id: id * 10, title: "Kind Of Blue", year: 1959, thumb: "https://i.discogs.com/t.jpg", cover_image: "https://i.discogs.com/c.jpg",
  artists: [{ name: "Miles Davis", join: "" }], labels: [{ name: "Columbia", catno: "CL 1355" }], formats: [{ name: "Vinyl", qty: "1", descriptions: ["LP", "Album", "Mono"] }],
  genres: ["Jazz"], styles: ["Modal"], ...extra });

test("a Discogs collection entry becomes an exact-pressing record", () => {
  assert.deepEqual(rowFromDiscogs(bi(200), "owned"), {
    artist: "Miles Davis", title: "Kind Of Blue", year: 1959, label: "Columbia", catno: "CL 1355", genres: ["Jazz"],
    discogs_id: 200, master_id: 2000, discogs_url: "https://www.discogs.com/release/200",
    cover_url: "https://i.discogs.com/c.jpg", thumb_url: "https://i.discogs.com/t.jpg",
    status: "owned", enrich_status: "pending", vinyl: true, format: "Vinyl LP Album Mono",
  });
  const cd = rowFromDiscogs(bi(201, { formats: [{ name: "CD" }], year: 0, cover_image: "https://st.discogs.com/spacer.gif", thumb: "", labels: [{ name: "Label (2)", catno: "none" }] }), "want");
  assert.equal(cd.vinyl, false); assert.equal(cd.year, null); assert.equal(cd.cover_url, null); assert.equal(cd.label, "Label"); assert.equal(cd.catno, null); assert.equal(cd.status, "want");
});

test("collection and want-list pages, and clear errors", async () => {
  const calls = [];
  const fake = async (url) => {
    const u = new URL(url); calls.push(u.pathname + u.search);
    if (u.pathname === "/users/jazzfan/collection/folders/0/releases") return new Response(JSON.stringify({ pagination: { page: 2, pages: 3, items: 250 }, releases: [{ id: 1, basic_information: bi(1) }, { id: 2 }] }), { status: 200 });
    if (u.pathname === "/users/jazzfan/wants") return new Response(JSON.stringify({ pagination: { page: 1, pages: 1, items: 1 }, wants: [{ id: 5, basic_information: bi(5) }] }), { status: 200 });
    if (u.pathname.startsWith("/users/private/")) return new Response("{}", { status: 403 });
    return new Response("{}", { status: 404 });
  };
  const client = makeClient("t", fake);
  const c = await collectionPage(client, "jazzfan", "collection", 2);
  assert.deepEqual([c.page, c.pages, c.total, c.rows.length, c.rows[0].status], [2, 3, 250, 1, "owned"]);
  assert.ok(calls[0].includes("page=2") && calls[0].includes("per_page=100"));
  const w = await collectionPage(client, "jazzfan", "wants");
  assert.equal(w.rows[0].status, "want");
  await assert.rejects(collectionPage(client, "nobody"), /no Discogs user called “nobody”/);
  await assert.rejects(collectionPage(client, "private"), /private on Discogs/);
  await assert.rejects(collectionPage(client, "  "), /Enter a Discogs username/);
});
