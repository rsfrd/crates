import test from "node:test";
import assert from "node:assert/strict";
import { typeset, typesetAlbum, fold } from "../public/js/search.js";

test("real apostrophes, elisions and quoted words", () => {
  assert.equal(typeset("Don't Explain"), "Don’t Explain");
  assert.equal(typeset("'Round Midnight"), "’Round Midnight");
  assert.equal(typeset("Rock 'n' Roll"), "Rock ’n’ Roll");
  assert.equal(typeset("Guns N' Roses"), "Guns N’ Roses");
  assert.equal(typeset("Live in the '60s"), "Live in the ’60s");
  assert.equal(typeset("Sonny's 'Crib'"), "Sonny’s ‘Crib’");
  assert.equal(typeset("E=MC2"), "E=MC2");
  assert.equal(typeset(null), null);
});

test("translated titles are separated with a dot", () => {
  assert.equal(
    typeset("Erster Teil: Am Ersten Weihnachtsfeiertage = Part I: For The 1st Day Of Christmas = Première Partie: Pour Le 1er Jour De La Fête De Noël"),
    "Erster Teil: Am Ersten Weihnachtsfeiertage • Part I: For The 1st Day Of Christmas • Première Partie: Pour Le 1er Jour De La Fête De Noël");
});

test("albums: names, titles, tracks and credits are tidied; notes are left alone; unchanged albums stay the same object", () => {
  const a = { artist: "Bill Evans", title: "Portrait In Jazz", label: "Riverside", notes: "Don't sell",
    tracks: [{ pos: "A1", title: "Come Rain Or Come Shine" }, { pos: "B1", title: "Ich bin's = It's Me", work: "Weihnachts-Oratorium = Christmas Oratorio", wby: "J.S. Bach" }],
    credits: [{ name: "Scott LaFaro", roles: ["Bass"] }, { name: "Paul O'Neill", roles: ["Producer"] }] };
  const t = typesetAlbum(a);
  assert.equal(t.tracks[1].title, "Ich bin’s • It’s Me");
  assert.equal(t.tracks[1].work, "Weihnachts-Oratorium • Christmas Oratorio");
  assert.equal(t.credits[1].name, "Paul O’Neill");
  assert.equal(t.notes, "Don't sell");
  const plain = { artist: "Miles Davis", title: "Kind Of Blue", tracks: [], credits: [] };
  assert.equal(typesetAlbum(plain), plain);
});

test("search treats straight and curly apostrophes alike", () => {
  assert.equal(fold("Don’t Explain"), fold("Don't Explain"));
});
