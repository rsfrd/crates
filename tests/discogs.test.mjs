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

test("Fix match search asks Discogs for vinyl, lists masters and vinyl only, all formats when asked", async () => {
  const calls = [];
  const r = await searchDiscogs(makeClient("t", fakeDiscogs(calls)), "kind of blue");
  assert.deepEqual(r.map((c) => `${c.type}:${c.id}`), ["master:7", "release:200"]);
  assert.ok(calls[0].includes("format=Vinyl"));
  const any = await searchDiscogs(makeClient("t", fakeDiscogs(calls)), "kind of blue", { anyFormat: true });
  assert.deepEqual(any.map((c) => `${c.type}:${c.id}`), ["release:100", "master:7", "release:200"]);
  assert.ok(!calls[1].includes("format="));
});

test("Fix match candidates carry what tells pressings apart", async () => {
  const fake = async () => new Response(JSON.stringify({ results: [{
    type: "release", id: 9, title: "Miles Davis - Kind Of Blue", year: "2015", country: "Europe", catno: "CS 8163",
    label: ["Columbia (2)", "Sony Music"], format: ["Vinyl", "LP", "Album", "Reissue"],
    formats: [{ name: "Vinyl", qty: "1", descriptions: ["LP", "Album", "Reissue", "180g"], text: "Blue Translucent" }],
    community: { have: 1234, want: 50 },
  }, { type: "release", id: 10, title: "X", format: ["Vinyl", "LP"], formats: [{ name: "Vinyl", qty: "2", descriptions: ["LP"] }], catno: "none" }] }), { status: 200 });
  const [c, d] = await searchDiscogs(makeClient("t", fake), "kind of blue");
  assert.equal(c.format, "Vinyl, LP, Album, Reissue, 180g, Blue Translucent");
  assert.equal(c.label, "Columbia");
  assert.equal(c.catno, "CS 8163");
  assert.equal(c.country, "Europe");
  assert.equal(c.have, 1234);
  assert.equal(d.format, "2 × Vinyl, LP");
  assert.equal(d.catno, null);
});

test("automatic match ends on the vinyl LP and searches catalogue numbers among vinyl", async () => {
  const calls = [];
  const r = await match(makeClient("t", fakeDiscogs(calls)), { artist: "Miles Davis", title: "Kind of Blue", catno: "CL 1355" });
  assert.equal(r.release.discogs_id, 200);
  assert.ok(calls.some((c) => c.includes("catno=CL+1355") && c.includes("format=Vinyl")));
});

import { flattenTracks } from "../netlify/lib/discogs.mjs";

test("classical: index tracks keep their piece with each movement", () => {
  const tl = [
    { type_: "heading", title: "Side A", position: "" },
    { type_: "index", position: "", title: "String Quartet No. 1 In C Major, Op. 49", duration: "",
      extraartists: [{ id: 50, name: "Dmitri Shostakovich", role: "Composed By" }],
      sub_tracks: [
        { type_: "track", position: "A1", title: "Moderato", duration: "4:38" },
        { type_: "track", position: "A2", title: "Moderato", duration: "4:51" },
      ] },
    { type_: "index", position: "", title: "String Quartet No. 2 In A Major, Op. 68", sub_tracks: [
        { type_: "track", position: "A3", title: "Overture: Moderato Con Moto", duration: "8:02" },
    ] },
  ];
  const t = flattenTracks(tl);
  assert.deepEqual(t.map((x) => [x.pos, x.title, x.work]), [
    ["A1", "Moderato", "String Quartet No. 1 In C Major, Op. 49"],
    ["A2", "Moderato", "String Quartet No. 1 In C Major, Op. 49"],
    ["A3", "Overture: Moderato Con Moto", "String Quartet No. 2 In A Major, Op. 68"],
  ]);
  assert.equal(t[0]._extra[0].name, "Dmitri Shostakovich", "piece-level composer credit flows to movements");
});

test("classical: heading rows label the movements below them; side headings don’t", () => {
  const tl = [
    { type_: "heading", title: "Symphony No. 5 In C Minor, Op. 67" },
    { type_: "track", position: "A1", title: "Allegro Con Brio" },
    { type_: "track", position: "A2", title: "Andante Con Moto" },
    { type_: "heading", title: "Side B" },
    { type_: "track", position: "B1", title: "Allegro" },
    { type_: "heading", title: "Egmont Overture, Op. 84" },
    { type_: "track", position: "B2", title: "Sostenuto, Ma Non Troppo" },
  ];
  assert.deepEqual(flattenTracks(tl).map((x) => x.work), [
    "Symphony No. 5 In C Minor, Op. 67", "Symphony No. 5 In C Minor, Op. 67", "Symphony No. 5 In C Minor, Op. 67", "Egmont Overture, Op. 84",
  ]);
});

test("ordinary albums are unchanged: no work on plain tracks", () => {
  const n = normalizeRelease({ id: 1, tracklist: [{ type_: "heading", title: "Side One" }, { type_: "track", position: "A1", title: "So What", duration: "9:22" }] }, "");
  assert.deepEqual(n.tracks, [{ pos: "A1", title: "So What", dur: "9:22" }]);
});

test("the Borodin Quartet release, as Discogs lists it", () => {
  // Shaped after discogs.com/release/5892349: pieces are index rows with their own time,
  // movements are sub-tracks, and most movements have no time of their own.
  const piece = (title, duration, subs) => ({ type_: "index", position: "", title, duration, sub_tracks: subs.map(([position, t, d = ""]) => ({ type_: "track", position, title: t, duration: d })) });
  const release = { id: 5892349, title: "The Complete String Quartets, Vol. 1 (Nos. 1-5)", formats: [{ name: "Vinyl", qty: "3", descriptions: ["LP"] }],
    artists: [{ id: 1, name: "Shostakovich*", join: "," }, { id: 2, name: "The Borodin Quartet*" }],
    tracklist: [
      piece("Quartet No. 1 In C, Op. 49", "13:50", [["A1", "I. Moderato"], ["A2", "II. Moderato, Theme And Variations"], ["A3", "III. Allegro Molto, Scherzo"], ["A4", "IV. Allegro"]]),
      piece("Quartet No. 2 In A, Op. 68", "", [["A5", "I. Overture: Moderato Con Moto", "8:05"], ["B1", "II. Recitative And Romance: Adagio"], ["B2", "III. Valse: Allegretto"], ["B3", "IV. Theme With Variations"]]),
      piece("Quartet No. 3 In F, Op. 73", "", [["C1", "I. Allegretto", "16:10"], ["C2", "II. Moderato Con Moto"], ["C3", "III. Allegro Non Troppo"], ["D1", "IV. Adagio, Passacaglia", "16:35"]]),
      piece("Quartet No. 4 In D, Op. 83", "24:55", [["E1", "I. Allegretto"], ["E2", "II. Andantino"]]),
    ] };
  const n = normalizeRelease(release, "Shostakovich");
  assert.equal(n.parser, 4);
  assert.equal(n.discogs_artist, "Shostakovich, The Borodin Quartet");
  assert.equal(n.tracks.length, 14);
  assert.deepEqual([...new Set(n.tracks.map((t) => t.work))], ["Quartet No. 1 In C, Op. 49", "Quartet No. 2 In A, Op. 68", "Quartet No. 3 In F, Op. 73", "Quartet No. 4 In D, Op. 83"]);
  assert.equal(n.tracks[0].wdur, "13:50");
  assert.equal(n.tracks[1].wdur, undefined);
  assert.deepEqual(n.tracks[4], { pos: "A5", title: "I. Overture: Moderato Con Moto", dur: "8:05", work: "Quartet No. 2 In A, Op. 68", wi: 2 });
});

test("two pieces with the same title stay separate, each with its composer", () => {
  // Shaped after the MHS 3521 Bax/Bliss release: same piece title, different composers.
  const piece = (by, dur, subs) => ({ type_: "index", position: "", title: "Quintet For Oboe And String Quartet", duration: dur,
    artists: [{ id: by[0], name: by[1], anv: "Sir " + by[1] }],
    extraartists: [{ id: by[0], name: by[1], role: "Composed By" }],
    sub_tracks: subs.map(([position, title, duration]) => ({ type_: "track", position, title, duration })) });
  const release = { id: 1, title: "Two English Oboe Quintets",
    artists: [{ id: 10, name: "Arnold Bax", join: "/" }, { id: 11, name: "Arthur Bliss", join: "-" }, { id: 12, name: "Bert Lucarelli", join: "," }, { id: 13, name: "The Manhattan String Quartet" }],
    tracklist: [
      piece([10, "Arnold Bax"], "17:11", [["A1", "1. Tempo Molto Moderato - Allegro Moderato", "6:11"], ["A2", "2. Lento Expressivo", "6:10"], ["A3", "3. Allegro Giocoso", "4:42"]]),
      piece([11, "Arthur Bliss"], "21:29", [["B1", "1. Assai Sostenuto", "7:56"], ["B2", "2. Andante Con Moto", "7:30"], ["B3", "3. Vivace", "5:35"]]),
    ] };
  const n = normalizeRelease(release, "Arnold Bax / Arthur Bliss");
  assert.deepEqual(n.tracks.map((t) => t.wi), [1, 1, 1, 2, 2, 2]);
  assert.equal(n.tracks[0].wby, "Arnold Bax");
  assert.equal(n.tracks[3].wby, "Arthur Bliss");
  assert.equal(n.tracks[3].wdur, "21:29");
  const bax = n.credits.find((c) => c.name === "Arnold Bax");
  assert.ok(bax.leader && bax.roles.includes("Composed By"));
});

test("single-track pieces keep their composer and notes (The Virtuoso Oboe)", () => {
  // Shaped after Vanguard HM 40 SD: each piece is one track, credited on the track itself.
  const tr = (position, title, composer, more = []) => ({ type_: "track", position, title, duration: "",
    extraartists: [...more, { id: composer[0], name: composer[1], anv: composer[1], role: "Composed By" }] });
  const release = { id: 2, title: "The Virtuoso Oboe",
    artists: [{ id: 1, name: "André Lardrot", join: "," }, { id: 2, name: "Felix Prohaska", join: "," }, { id: 3, name: "Chamber Orchestra Of The Vienna State Opera" }],
    tracklist: [
      tr("A1", "Concerto For Oboe And Orchestra In C, K. 314", [95, "Wolfgang Amadeus Mozart"], [{ id: 7, name: "Raymond Meylan", role: "Cadenza" }]),
      tr("A2", "Oboe Concerto No. 8 In B Flat", [96, "Georg Friedrich Händel"]),
      tr("B1", "Quartet For Oboe And Strings In F, K. 370", [95, "Wolfgang Amadeus Mozart"]),
      tr("B2", "Oboe Concerto In D, Op. 7 No. 6", [97, "Tomaso Albinoni"]),
    ] };
  const n = normalizeRelease(release, "André Lardrot, Felix Prohaska, Chamber Orchestra Of The Vienna State Opera");
  assert.deepEqual(n.tracks[0], { pos: "A1", title: "Concerto For Oboe And Orchestra In C, K. 314", dur: "", by: "Wolfgang Amadeus Mozart", note: "Cadenza: Raymond Meylan" });
  assert.deepEqual(n.tracks.map((t) => t.by), ["Wolfgang Amadeus Mozart", "Georg Friedrich Händel", "Wolfgang Amadeus Mozart", "Tomaso Albinoni"]);
  assert.ok(n.tracks.every((t) => !t.work), "no pieces invented");
  const mozart = n.credits.find((c) => c.name === "Wolfgang Amadeus Mozart");
  assert.deepEqual(mozart.tracks, ["A1", "B1"]);
});

test("jazz: track-level performers are not shown as composers", () => {
  const n = normalizeRelease({ id: 3, tracklist: [{ type_: "track", position: "A1", title: "Blue", extraartists: [{ id: 1, name: "Ron Carter", role: "Bass" }, { id: 2, name: "Wayne Shorter", role: "Written-By" }] }] }, "x");
  assert.deepEqual(n.tracks[0], { pos: "A1", title: "Blue", dur: undefined, by: "Wayne Shorter" });
});

import { marketplace } from "../netlify/lib/discogs.mjs";

test("marketplace: lowest price in USD, copies for sale, album family", async () => {
  const calls = [];
  const fake = async (url) => {
    const u = new URL(url); calls.push(u.pathname + u.search);
    if (u.pathname === "/marketplace/stats/200") return new Response(JSON.stringify({ lowest_price: { currency: "USD", value: 24.499999 }, num_for_sale: 7, blocked_from_sale: false }), { status: 200 });
    if (u.pathname === "/releases/200") return new Response(JSON.stringify({ id: 200, master_id: 7 }), { status: 200 });
    if (u.pathname === "/marketplace/stats/300") return new Response(JSON.stringify({ lowest_price: null, num_for_sale: null, blocked_from_sale: false }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const client = makeClient("t", fake);
  assert.deepEqual(await marketplace(client, 200, { withMaster: true }), { value: 24.5, currency: "USD", for_sale: 7, blocked: false, master_id: 7, vinyl: null, format: null });
  assert.ok(calls[0].includes("curr_abbr=USD"));
  assert.deepEqual(await marketplace(client, 300), { value: null, currency: "USD", for_sale: 0, blocked: false, master_id: null, vinyl: null, format: null });
});

test("matched releases remember their album family", () => {
  assert.equal(normalizeRelease({ id: 1, master_id: 55 }, "").master_id, 55);
  assert.equal(normalizeRelease({ id: 1 }, "", { id: 66, year: 1960 }).master_id, 66);
  assert.equal(normalizeRelease({ id: 1 }, "").master_id, null);
});

test("marketplace: says whether the pressing is vinyl when asked", async () => {
  const fake = async (url) => {
    const u = new URL(url);
    if (u.pathname.startsWith("/marketplace/stats/")) return new Response(JSON.stringify({ lowest_price: { currency: "USD", value: 9 }, num_for_sale: 3 }), { status: 200 });
    if (u.pathname === "/releases/1") return new Response(JSON.stringify({ id: 1, master_id: 5, formats: [{ name: "CD", qty: "1", descriptions: ["Album"] }] }), { status: 200 });
    if (u.pathname === "/releases/2") return new Response(JSON.stringify({ id: 2, master_id: 5, formats: [{ name: "Vinyl", qty: "1", descriptions: ["LP"], text: "Red" }] }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const client = makeClient("t", fake);
  const cd = await marketplace(client, 1, { withFormat: true });
  assert.equal(cd.vinyl, false); assert.equal(cd.format, "CD, Album"); assert.equal(cd.master_id, 5);
  const lp = await marketplace(client, 2, { withFormat: true });
  assert.equal(lp.vinyl, true); assert.equal(lp.format, "Vinyl, LP, Red");
});

import { fetchByRef } from "../netlify/lib/discogs.mjs";

test("original year: a reissue keeps its own year and gets its album's first year", async () => {
  const calls = [];
  const fake = async (url) => {
    const u = new URL(url); calls.push(u.pathname);
    if (u.pathname === "/releases/72") return new Response(JSON.stringify({ id: 72, master_id: 5460, year: 1972, title: "Kind Of Blue", artists: [{ name: "Miles Davis" }],
      formats: [{ name: "Vinyl", descriptions: ["LP", "Reissue"] }], labels: [{ name: "Columbia", catno: "KCS 8163" }], tracklist: [] }), { status: 200 });
    if (u.pathname === "/masters/5460") return new Response(JSON.stringify({ id: 5460, year: 1959 }), { status: 200 });
    if (u.pathname === "/releases/99") return new Response(JSON.stringify({ id: 99, master_id: 0, year: 1980, formats: [{ name: "Vinyl" }], labels: [], tracklist: [] }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const client = makeClient("t", fake);
  const r = await fetchByRef(client, "release", 72, "Miles Davis", { preferVinyl: false });
  assert.equal(r.year, 1972);
  assert.equal(r.original_year, 1959);
  const solo = await fetchByRef(client, "release", 99, "x", { preferVinyl: false });
  assert.equal(solo.year, 1980);
  assert.equal(solo.original_year, null, "no album family, no original year");
});

test("search: pressings get their album's original year", async () => {
  const fake = async (url) => {
    const u = new URL(url);
    if (u.pathname === "/database/search") return new Response(JSON.stringify({ results: [
      { type: "release", id: 1, master_id: 5460, title: "Miles Davis - Kind Of Blue", year: "1972", format: ["Vinyl", "LP"] },
      { type: "release", id: 2, master_id: 777, title: "Other - Thing", year: "2001", format: ["Vinyl", "LP"] },
      { type: "master", id: 777, title: "Other - Thing", year: "1968", format: ["Vinyl"] },
    ] }), { status: 200 });
    if (u.pathname === "/masters/5460") return new Response(JSON.stringify({ id: 5460, year: 1959 }), { status: 200 });
    return new Response("{}", { status: 404 });
  };
  const [a, b] = await searchDiscogs(makeClient("t", fake), "x");
  assert.equal(a.original_year, 1959);
  assert.equal(b.original_year, "1968", "taken from the family already in the results");
});
