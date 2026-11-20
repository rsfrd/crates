import test from "node:test";
import assert from "node:assert/strict";
import { buildIndex, creditKind, roleLabel, personKey } from "../public/js/search.js";

const album = (id, artist, title, genres, credits, tracks = []) => ({ id, artist, title, genres, credits, tracks, status: "owned", crates: [] });

test("a band credited Written-By on its own album: their record, not their music played by others", () => {
  const own = album("g1", "Guided By Voices", "Bee Thousand", ["Rock"], [
    { name: "Guided By Voices", roles: ["Written-By"], leader: true, kind: "musician", tracks: [] },
    { name: "Robert Pollard", roles: ["Vocals", "Guitar"], leader: false, kind: "musician", tracks: [] },
  ]);
  const plain = album("g2", "Guided By Voices", "Alien Lanes", ["Rock"], [{ name: "Guided By Voices", roles: [], leader: true, kind: "musician", tracks: [] }]);
  const cover = album("c1", "Some Band", "Covers Album", ["Rock"], [{ name: "Guided By Voices", roles: ["Written-By"], leader: false, kind: "musician", tracks: ["A1"] }]);
  const idx = buildIndex([own, plain, cover]);
  const p = idx.people.get(personKey("Guided By Voices"));
  const kinds = Object.fromEntries(p.items.map((i) => [i.album.id, creditKind(i)]));
  assert.deepEqual(kinds, { g1: "leader", g2: "leader", c1: "composer" });
  assert.equal(roleLabel(p.items.find((i) => i.album.id === "g1")), "Leader");
});

test("classical: a composer named as the album's artist is still their music, played by others", () => {
  const shosta = album("s1", "Shostakovich", "Symphony No. 5", ["Classical"], [
    { name: "Dmitri Shostakovich", roles: ["Composed By"], leader: true, kind: "musician", tracks: [] },
    { name: "Leonard Bernstein", roles: ["Conductor"], leader: false, kind: "musician", tracks: [] },
  ]);
  const byWorks = album("s2", "Bach", "Cantatas", [], [{ name: "Johann Sebastian Bach", roles: ["Composed By"], leader: true, kind: "musician", tracks: [] }],
    [{ pos: "A1", title: "I. Chorus", work: "Cantata BWV 140", wby: "Johann Sebastian Bach" }]);
  assert.equal(creditKind(shosta.credits[0], shosta), "composer");
  assert.equal(creditKind(byWorks.credits[0], byWorks), "composer", "pieces and movements count as classical even without the genre");
  assert.equal(roleLabel(shosta.credits[0], shosta), "Composer");
});
