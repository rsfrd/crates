import assert from "node:assert/strict";
import { test } from "node:test";
import { splitRoles, cleanRole, isMusicalRole, buildCredits, normalizeRelease, scoreCandidate, parseDiscogsRef, match, makeClient } from "../netlify/lib/discogs.mjs";

// Shaped like a real Discogs /releases response.
const release = {
  id: 1234, uri: "https://www.discogs.com/release/1234-Dave-Holland-Quintet-Jumpin-In", year: 1984,
  title: "Jumpin' In",
  artists: [{ id: 41, name: "Dave Holland Quintet" }],
  labels: [{ name: "ECM Records", catno: "ECM 1269" }],
  genres: ["Jazz"], styles: ["Post Bop"],
  images: [{ type: "secondary", uri: "s.jpg", uri150: "s150.jpg" }, { type: "primary", uri: "p.jpg", uri150: "p150.jpg" }],
  extraartists: [
    { id: 9, name: "Dave Holland", role: "Bass, Cello, Composed By", tracks: "" },
    { id: 10, name: "Steve Coleman", role: "Alto Saxophone, Flute", tracks: "" },
    { id: 11, name: "Kenny Wheeler", role: "Flugelhorn, Trumpet, Cornet", tracks: "" },
    { id: 12, name: "Julian Priester", role: "Trombone", tracks: "" },
    { id: 13, name: "Steve Ellington (2)", role: "Drums", tracks: "" },
    { id: 14, name: "Manfred Eicher", role: "Producer", tracks: "" },
    { id: 15, name: "Jan Erik Kongshaug", role: "Engineer", tracks: "" },
  ],
  tracklist: [
    { type_: "heading", title: "Side A", position: "" },
    { type_: "track", position: "A1", title: "Jumpin' In", duration: "8:58" },
    { type_: "track", position: "A2", title: "First Snow", duration: "6:13",
      extraartists: [{ id: 99, name: "Guest Pianist", role: "Piano [Electric]" }] },
    { type_: "index", title: "Suite", sub_tracks: [{ position: "B1a", title: "Part 1", duration: "3:00" }] },
  ],
};

test("role splitting and cleaning", () => {
  assert.deepEqual(splitRoles("Saxophone [Tenor], Flute"), ["Tenor Saxophone", "Flute"]);
  assert.deepEqual(splitRoles("Percussion [Congas, Bongos], Vocals"), ["Percussion (Congas, Bongos)", "Vocals"]);
  assert.equal(cleanRole("Bass [Electric]"), "Electric Bass");
  assert.ok(isMusicalRole("Drums"));
  assert.ok(isMusicalRole("Tenor Saxophone"));
  assert.ok(isMusicalRole("Conductor"));
  assert.ok(!isMusicalRole("Producer"));
  assert.ok(!isMusicalRole("Liner Notes"));
  assert.ok(!isMusicalRole("Photography By"));
  assert.ok(!isMusicalRole("Lacquer Cut By"));
  assert.ok(!isMusicalRole("Written-By"));
});

test("credits: leaders, instruments, track-level players, production", () => {
  const credits = buildCredits(release, "Dave Holland Quintet");
  const by = Object.fromEntries(credits.map((c) => [c.name, c]));
  assert.equal(by["Dave Holland"].leader, true, "name inside album artist -> leader");
  assert.deepEqual(by["Dave Holland"].roles, ["Bass", "Cello", "Composed By"]);
  assert.equal(by["Steve Coleman"].leader, false);
  assert.equal(by["Steve Coleman"].kind, "musician");
  assert.ok(by["Steve Ellington"], "disambiguation suffix stripped");
  assert.equal(by["Manfred Eicher"].kind, "credit");
  assert.deepEqual(by["Guest Pianist"].tracks, ["A2"]);
  assert.deepEqual(by["Guest Pianist"].roles, ["Electric Piano"]);
  assert.equal(credits[0].leader, true, "leaders sorted first");
  assert.equal(credits.at(-1).kind, "credit", "production sorted last");
});

test("normalizeRelease: cover, tracks, label", () => {
  const n = normalizeRelease(release, "Dave Holland Quintet");
  assert.equal(n.cover_url, "p.jpg");
  assert.equal(n.thumb_url, "p150.jpg");
  assert.equal(n.label, "ECM Records");
  assert.equal(n.label_catno, "ECM 1269");
  assert.deepEqual(n.tracks.map((t) => t.pos), ["A1", "A2", "B1a"]);
});

test("scoring prefers the right album", () => {
  const good = scoreCandidate({ title: "Charles Mingus - The Black Saint And The Sinner Lady" }, "Charles Mingus", "The Black Saint and the Sinner Lady");
  const bad = scoreCandidate({ title: "Charles Mingus - Mingus Ah Um" }, "Charles Mingus", "The Black Saint and the Sinner Lady");
  assert.ok(good > 0.95, `good ${good}`);
  assert.ok(bad < 0.5, `bad ${bad}`);
  const various = scoreCandidate({ title: "Various - Pacific Breeze: Japanese City Pop, AOR & Boogie 1976-1986" }, "Various Artists", "Pacific Breeze: Japanese City Pop, AOR and Boogie 1976-1986");
  assert.ok(various > 0.9, `various ${various}`);
});

test("discogs link parsing", () => {
  assert.deepEqual(parseDiscogsRef("https://www.discogs.com/release/1234-Foo-Bar"), { type: "release", id: 1234 });
  assert.deepEqual(parseDiscogsRef("https://www.discogs.com/master/987-Foo"), { type: "master", id: 987 });
  assert.deepEqual(parseDiscogsRef("[r555]"), { type: "release", id: 555 });
  assert.deepEqual(parseDiscogsRef("m42"), { type: "master", id: 42 });
  assert.equal(parseDiscogsRef("hello"), null);
});

test("match flow: master search -> main release", async () => {
  const calls = [];
  const fake = async (url) => {
    const u = new URL(url); calls.push(u.pathname + u.search);
    const body =
      u.pathname === "/database/search" && u.searchParams.get("type") === "master"
        ? { results: [{ type: "master", id: 7, title: "Dave Holland Quintet - Jumpin' In", year: "1984" },
                      { type: "master", id: 8, title: "Dave Holland Quintet - Seeds Of Time", year: "1985" }] }
        : u.pathname === "/masters/7" ? { id: 7, year: 1984, main_release: 1234 }
        : u.pathname === "/releases/1234" ? release
        : { results: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "x-discogs-ratelimit-remaining": "55" } });
  };
  const client = makeClient("t", fake);
  const r = await match(client, { artist: "Dave Holland Quintet", title: "Jumpin' In", catno: "ECM 1271" });
  assert.equal(r.status, "matched");
  assert.equal(r.release.discogs_id, 1234);
  assert.equal(r.release.year, 1984);
  assert.equal(client.remaining, 55);
  assert.ok(calls.some((c) => c.includes("catno=ECM+1271")));
});

test("match flow: nothing found", async () => {
  const fake = async () => new Response(JSON.stringify({ results: [] }), { status: 200 });
  const r = await match(makeClient("t", fake), { artist: "Nobody", title: "Nothing" });
  assert.equal(r.status, "not_found");
});

import { artistLine } from "../netlify/lib/discogs.mjs";

test("artist line follows Discogs joins and cleans names", () => {
  assert.equal(artistLine([{ name: "Oscar Peterson", join: "&" }, { name: "Joe Pass" }]), "Oscar Peterson & Joe Pass");
  assert.equal(artistLine([{ name: "Dave Lambert", join: "," }, { name: "Jon Hendricks", join: "&" }, { name: "Annie Ross" }]), "Dave Lambert, Jon Hendricks & Annie Ross");
  assert.equal(artistLine([{ name: "Sun Ra (2)", join: "And" }, { name: "His Arkestra" }]), "Sun Ra And His Arkestra");
  assert.equal(artistLine([{ name: "Haruomi Hosono", join: "" }, { name: "Shigeru Suzuki" }]), "Haruomi Hosono, Shigeru Suzuki");
  assert.equal(artistLine([{ name: "Various" }]), "Various Artists");
  assert.equal(artistLine([{ name: "Thelonious Monk*" }]), "Thelonious Monk");
  assert.equal(artistLine([]), "");
});

test("normalizeRelease carries Discogs' artist and title", () => {
  const n = normalizeRelease({ id: 5, title: " Undercurrent ", artists: [{ id: 1, name: "Bill Evans", join: "&" }, { id: 2, name: "Jim Hall" }] }, "bill evans jim hall");
  assert.equal(n.discogs_artist, "Bill Evans & Jim Hall");
  assert.equal(n.discogs_title, "Undercurrent");
});

import { pickVinylVersion, isVinylRelease, fetchByRef as fetchRef, search as searchDiscogs } from "../netlify/lib/discogs.mjs";

test("picks the original full-length vinyl LP", () => {
  const versions = [
    { id: 1, format: "CD, Album", major_formats: ["CD"], released: "1987" },
    { id: 2, format: "LP, Album, RE", major_formats: ["Vinyl"], released: "1972" },
    { id: 3, format: "7\", Single", major_formats: ["Vinyl"], released: "1958" },
    { id: 4, format: "LP, Album", major_formats: ["Vinyl"], released: "1959" },
    { id: 5, format: "LP, Album, Unofficial Release", major_formats: ["Vinyl"], released: "1958" },
    { id: 6, format: "LP, Album", major_formats: ["Vinyl"], released: "1959", status: "Draft" },
  ];
  assert.equal(pickVinylVersion(versions).id, 4);
  assert.equal(pickVinylVersion([{ id: 9, format: "CD", major_formats: ["CD"] }]), null);
  assert.ok(isVinylRelease({ formats: [{ name: "Vinyl", descriptions: ["LP"] }] }));
  assert.ok(!isVinylRelease({ formats: [{ name: "CD" }] }));
});

// A tiny fake Discogs: master 7 has a CD as its main release and a vinyl LP among its versions.
function fakeDiscogs(calls) {
  const cd = { id: 100, master_id: 7, title: "Kind Of Blue", year: 1997, artists: [{ id: 1, name: "Miles Davis" }], formats: [{ name: "CD", descriptions: ["Album"] }],
    tracklist: [{ type_: "track", position: "1", title: "So What" }, { type_: "track", position: "2", title: "Freddie Freeloader" }] };
  const lp = { id: 200, master_id: 7, title: "Kind Of Blue", year: 1959, country: "US", artists: [{ id: 1, name: "Miles Davis" }], formats: [{ name: "Vinyl", qty: "1", descriptions: ["LP", "Album", "Mono"] }],
    tracklist: [{ type_: "track", position: "A1", title: "So What" }, { type_: "track", position: "A2", title: "Freddie Freeloader" }] };
  return async (url) => {
    const u = new URL(url); calls.push(u.pathname + u.search);
    const body = u.pathname === "/masters/7" ? { id: 7, year: 1959, main_release: 100 }
      : u.pathname === "/masters/7/versions" ? { versions: [{ id: 100, format: "CD, Album", major_formats: ["CD"], released: "1997" }, { id: 200, format: "LP, Album, Mono", major_formats: ["Vinyl"], released: "1959" }] }
      : u.pathname === "/releases/100" ? cd : u.pathname === "/releases/200" ? lp
      : u.pathname === "/database/search" ? { results: [
          { type: "release", id: 100, title: "Miles Davis - Kind Of Blue", format: ["CD", "Album"] },
          { type: "master", id: 7, title: "Miles Davis - Kind Of Blue" },
          { type: "release", id: 200, title: "Miles Davis - Kind Of Blue", format: ["Vinyl", "LP"] },
        ] }
      : null;
    return new Response(JSON.stringify(body || {}), { status: body ? 200 : 404 });
  };
}

test("a master resolves to its vinyl LP, not the CD main release", async () => {
  const calls = [];
  const r = await fetchRef(makeClient("t", fakeDiscogs(calls)), "master", 7, "Miles Davis");
  assert.equal(r.discogs_id, 200);
  assert.deepEqual(r.tracks.map((t) => t.pos), ["A1", "A2"]);
  assert.equal(r.year, 1959);
  assert.match(r.format, /Vinyl LP/);
  assert.ok(calls.some((c) => c.includes("/masters/7/versions") && c.includes("format=Vinyl")));
});

test("a CD release is swapped for the vinyl LP, unless asked for exactly", async () => {
  const swapped = await fetchRef(makeClient("t", fakeDiscogs([])), "release", 100, "Miles Davis");
  assert.equal(swapped.discogs_id, 200);
  const exact = await fetchRef(makeClient("t", fakeDiscogs([])), "release", 100, "Miles Davis", { preferVinyl: false });
  assert.equal(exact.discogs_id, 100);
});

test("Fix match search lists masters and vinyl only", async () => {
  const r = await searchDiscogs(makeClient("t", fakeDiscogs([])), "kind of blue");
  assert.deepEqual(r.map((c) => `${c.type}:${c.id}`), ["master:7", "release:200"]);
});

test("automatic match ends on the vinyl LP and searches catalogue numbers among vinyl", async () => {
  const calls = [];
  const r = await match(makeClient("t", fakeDiscogs(calls)), { artist: "Miles Davis", title: "Kind of Blue", catno: "CL 1355" });
  assert.equal(r.release.discogs_id, 200);
  assert.ok(calls.some((c) => c.includes("catno=CL+1355") && c.includes("format=Vinyl")));
});
