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
