import assert from "node:assert/strict";
import { test } from "node:test";
import { findImages, fromItunes, fromCoverArtArchive } from "../netlify/lib/images.mjs";
import { makeClient } from "../netlify/lib/discogs.mjs";

const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
function fakeFetch(url) {
  const u = new URL(url);
  if (u.hostname === "itunes.apple.com") return ok({ results: [
    { collectionName: "Mingus Ah Um", artistName: "Charles Mingus", releaseDate: "1959-10-01T07:00:00Z", artworkUrl100: "https://is1.mzstatic.com/x/100x100bb.jpg" },
    { collectionName: "Greatest Hits", artistName: "Someone Else", artworkUrl100: "https://is1.mzstatic.com/y/100x100bb.jpg" },
  ] });
  if (u.hostname === "musicbrainz.org") return ok({ "release-groups": [{ id: "abc", score: 100, title: "Mingus Ah Um", "first-release-date": "1959" }, { id: "low", score: 40, title: "Other" }] });
  if (u.hostname === "api.discogs.com" && u.pathname === "/database/search") return ok({ results: [
    { title: "Charles Mingus - Mingus Ah Um", cover_image: "https://i.discogs.com/a.jpg", thumb: "https://i.discogs.com/a-t.jpg", year: "1959", country: "US", format: ["Vinyl", "LP"] },
    { title: "Charles Mingus - Mingus Ah Um", cover_image: "https://st.discogs.com/spacer.gif" },
    { title: "Charles Mingus - Blues & Roots", cover_image: "https://i.discogs.com/wrong.jpg" },
  ] });
  if (u.pathname === "/releases/42") return ok({ images: [{ type: "primary", uri: "https://i.discogs.com/cd.jpg", uri150: "https://i.discogs.com/cd-t.jpg" }, { type: "secondary", uri: "https://i.discogs.com/back.jpg" }] });
  return new Response("{}", { status: 404 });
}

test("iTunes: best matches only, upsized artwork", async () => {
  const r = await fromItunes({ artist: "Charles Mingus", title: "Mingus Ah Um" }, fakeFetch);
  assert.equal(r.length, 1);
  assert.equal(r[0].url, "https://is1.mzstatic.com/x/1200x1200bb.jpg");
  assert.equal(r[0].thumb, "https://is1.mzstatic.com/x/300x300bb.jpg");
});

test("Cover Art Archive: only confident MusicBrainz matches", async () => {
  const r = await fromCoverArtArchive({ artist: "Charles Mingus", title: "Mingus Ah Um" }, fakeFetch);
  assert.deepEqual(r.map((x) => x.url), ["https://coverartarchive.org/release-group/abc/front-1200"]);
});

test("findImages merges sources in order, drops wrong albums, placeholders and the current cover", async () => {
  const client = makeClient("t", fakeFetch);
  const r = await findImages(client, { artist: "Charles Mingus", title: "Mingus Ah Um", discogsId: "42", currentUrl: "https://i.discogs.com/cd.jpg" }, fakeFetch);
  assert.deepEqual(r.map((x) => x.source), ["Apple Music", "Cover Art Archive", "Discogs", "Discogs"]);
  assert.ok(!r.some((x) => /wrong|spacer|cd\.jpg/.test(x.url)));
  assert.equal(r[2].detail, "1959, US, Vinyl LP");
});

test("findImages survives sources failing", async () => {
  const boom = () => { throw new Error("down"); };
  const r = await findImages(null, { artist: "A", title: "B" }, boom);
  assert.deepEqual(r, []);
});
