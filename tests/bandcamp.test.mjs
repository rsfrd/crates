import assert from "node:assert/strict";
import { test } from "node:test";
import { parseBandcampPage, parseCredits } from "../netlify/lib/bandcamp.mjs";

const attr = (o) => JSON.stringify(o).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const tralbum = {
  artist: "Kit Downes Trio", art_id: 1234567890, album_release_date: "17 Mar 2023 00:00:00 GMT",
  current: { title: "Smoke & Mirrors", release_date: "17 Mar 2023 00:00:00 GMT",
    credits: "Kit Downes – piano\nPetter Eldh - double bass, synth\nDrums: James Maddren\nRecorded by Alex Bonney at Livingston Studios\nMastered at Abbey Road\n\nCover photo © 2023 Someone" },
  trackinfo: [{ track_num: 1, title: "Sea Shanty", duration: 252.3 }, { track_num: 2, title: "Vermillion's \"Ghost\"", duration: 3725 }],
};
const ld = { "@context": "https://schema.org", "@type": ["MusicAlbum", "Product"], name: "Smoke & Mirrors",
  byArtist: { "@type": "MusicGroup", name: "Kit Downes Trio" }, publisher: { "@type": "MusicGroup", name: "Edition Records" },
  datePublished: "17 Mar 2023 00:00:00 GMT", image: "https://f4.bcbits.com/img/a1234567890_10.jpg",
  track: { "@type": "ItemList", itemListElement: [
    { "@type": "ListItem", position: 1, item: { "@type": "MusicRecording", name: "Sea Shanty", duration: "P00H04M12S" } },
    { "@type": "ListItem", position: 2, item: { "@type": "MusicRecording", name: "Vermillion's \"Ghost\"", duration: "P01H02M05S" } },
  ] } };
const page = (withTralbum = true, withLd = true) => `<!DOCTYPE html><html><head>
  ${withLd ? `<script type="application/ld+json">${JSON.stringify(ld)}</script>` : ""}
  </head><body><div id="pagedata"></div>
  ${withTralbum ? `<script data-tralbum="${attr(tralbum)}" data-band="{}" src="/x.js"></script>` : ""}
  </body></html>`;

test("reads an album page: names, year, label, cover, tracks with times", () => {
  const r = parseBandcampPage(page(), "https://kitdownes.bandcamp.com/album/smoke-mirrors");
  assert.equal(r.discogs_title, "Smoke & Mirrors");
  assert.equal(r.discogs_artist, "Kit Downes Trio");
  assert.equal(r.year, 2023);
  assert.equal(r.label, "Edition Records");
  assert.equal(r.cover_url, "https://f4.bcbits.com/img/a1234567890_10.jpg");
  assert.equal(r.thumb_url, "https://f4.bcbits.com/img/a1234567890_9.jpg");
  assert.deepEqual(r.tracks, [{ pos: "1", title: "Sea Shanty", dur: "4:12" }, { pos: "2", title: 'Vermillion\'s "Ghost"', dur: "1:02:05" }]);
  assert.equal(r.discogs_id, null);
  assert.equal(r.discogs_url, "https://kitdownes.bandcamp.com/album/smoke-mirrors");
});

test("works from the JSON-LD block alone", () => {
  const r = parseBandcampPage(page(false, true), "u");
  assert.equal(r.discogs_title, "Smoke & Mirrors");
  assert.deepEqual(r.tracks.map((t) => t.dur), ["4:12", "1:02:05"]);
  assert.equal(r.cover_url, "https://f4.bcbits.com/img/a1234567890_10.jpg");
});

test("credits text becomes searchable players; prose lines are ignored", () => {
  const r = parseBandcampPage(page(), "u");
  const by = Object.fromEntries(r.credits.map((c) => [c.name, c]));
  assert.ok(by["Kit Downes Trio"].leader);
  assert.deepEqual(by["Kit Downes"].roles, ["Piano"]);
  assert.deepEqual(by["Petter Eldh"].roles, ["Double bass", "Synth"]);
  assert.deepEqual(by["James Maddren"].roles, ["Drums"]);
  assert.equal(r.credits.length, 4, "recording/mastering/copyright lines are not people");
  assert.match(r.credits_text, /Livingston Studios/);
});

test("credit parsing edge cases", () => {
  assert.deepEqual(parseCredits("Hello world, this is a sentence about the album.").length, 0);
  assert.deepEqual(parseCredits("• Andrew Berdahl: viola").map((c) => [c.name, c.roles]), [["Andrew Berdahl", ["Viola"]]]);
  assert.deepEqual(parseCredits("Mahlon Darlington - violin\nMahlon Darlington - viola").map((c) => c.roles), [["Violin", "Viola"]]);
});

test("not a Bandcamp release page", () => {
  assert.equal(parseBandcampPage("<html><body>hello</body></html>", "u"), null);
});
