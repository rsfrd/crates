// Walkthrough of: rename, changing covers (find / upload / link), adding a record with auto lookup.
// Run: node tests/browser-covers.mjs <outdir>
import { createRequire } from "node:module";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const req = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = req("playwright");
const sharp = req("sharp");
const OUT = process.argv[2];
const ROOT = new URL("../public/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

const art = (h1, h2, w = 300, hgt = 300) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><rect width="100%" height="100%" fill="hsl(${h1},55%,45%)"/><circle cx="${w * .65}" cy="${hgt * .4}" r="${Math.min(w, hgt) * .25}" fill="hsl(${h2},70%,62%)"/></svg>`)).png().toBuffer();
const covers = { cd: await art(0, 0), a: await art(20, 200), b: await art(210, 40), c: await art(130, 330), d: await art(280, 60), e: await art(45, 170) };
const photo = await art(160, 20, 1600, 1200); // a landscape "phone photo"

const demo = JSON.parse(fs.readFileSync(new URL("./fixtures/collection.json", import.meta.url).pathname, "utf8"));
demo.find((r) => r.artist === "Oscar Peterson, Joe Pass").catno = "OLD-123";   // a catalogue number from the spreadsheet, replaced by Fix match
const mingus = demo.find((r) => r.title.startsWith("The Black Saint"));
Object.assign(mingus, { cover_url: "/t/cd.png", thumb_url: "/t/cd.png", discogs_id: 42, enrich_status: "matched", year: 1963 });
const cdRecord = demo.find((r) => r.artist === "Ahmad Jamal") || demo[40];
Object.assign(cdRecord, { discogs_id: 55, enrich_status: "matched", cover_url: "/t/e.png", thumb_url: "/t/e.png", cover_locked: true,
  tracks: [{ pos: "1", title: "But Not For Me", dur: "3:32" }, { pos: "2", title: "Surrey With The Fringe On Top", dur: "2:01" }] });
const fetchLog = [];
// Bax/Bliss: two pieces with the same title, by different composers.
const oboe = demo.find((r) => r.title === "Oboe Quintets");
const QOBOE = "Quintet For Oboe And String Quartet";
Object.assign(oboe, { discogs_id: 3521, enrich_status: "matched", title: "Two English Oboe Quintets", artist: "Arnold Bax / Arthur Bliss - Bert Lucarelli, The Manhattan String Quartet",
  tracks: [
    { pos: "A1", title: "1. Tempo Molto Moderato - Allegro Moderato", dur: "6:11", work: QOBOE, wi: 1, wdur: "17:11", wby: "Arnold Bax" },
    { pos: "A2", title: "2. Lento Expressivo", dur: "6:10", work: QOBOE, wi: 1 },
    { pos: "B1", title: "1. Assai Sostenuto", dur: "7:56", work: QOBOE, wi: 2, wdur: "21:29", wby: "Arthur Bliss" },
    { pos: "B2", title: "2. Andante Con Moto", dur: "7:30", work: QOBOE, wi: 2 },
  ],
  credits: [
    { name: "Arnold Bax", id: 10, roles: ["Composed By"], tracks: ["A1", "A2"], leader: true, kind: "musician" },
    { name: "Arthur Bliss", id: 11, roles: ["Composed By"], tracks: ["B1", "B2"], leader: true, kind: "musician" },
    { name: "Bert Lucarelli", id: 12, roles: ["Oboe"], tracks: [], leader: true, kind: "musician" },
  ] });
const bandcampRelease = { source: "bandcamp", discogs_id: null, discogs_url: "https://kitdownes.bandcamp.com/album/smoke-mirrors", year: 2023, label: "Edition Records", label_catno: null,
  cover_url: "/t/e.png", thumb_url: "/t/e.png", discogs_genres: [], tracks: [{ pos: "1", title: "Sea Shanty", dur: "4:12" }, { pos: "2", title: "Ghost", dur: "6:01" }],
  credits: [{ name: "Kit Downes Trio", id: null, roles: [], tracks: [], leader: true, kind: "musician" }, { name: "Petter Eldh", id: null, roles: ["Double bass"], tracks: [], leader: false, kind: "musician" }],
  credits_text: "Kit Downes – piano\nPetter Eldh - double bass", discogs_title: "Smoke & Mirrors", discogs_artist: "Kit Downes Trio", parser: 3 };
const bandcampLog = [];
const searchLog = [];
// The Virtuoso Oboe: one track per piece, composer credited on each track.
const vOboe = demo.find((r) => /Virtuoso Oboe/.test(r.title));
Object.assign(vOboe, { discogs_id: 40, enrich_status: "matched", title: "The Virtuoso Oboe", artist: "André Lardrot, Felix Prohaska, Chamber Orchestra Of The Vienna State Opera",
  tracks: [
    { pos: "A1", title: "Concerto For Oboe And Orchestra In C, K. 314", dur: "", by: "Wolfgang Amadeus Mozart", note: "Cadenza: Raymond Meylan" },
    { pos: "A2", title: "Oboe Concerto No. 8 In B Flat", dur: "", by: "Georg Friedrich Händel" },
    { pos: "B1", title: "Quartet For Oboe And Strings In F, K. 370", dur: "", by: "Wolfgang Amadeus Mozart" },
  ],
  credits: [
    { name: "André Lardrot", id: 1, roles: ["Oboe"], tracks: [], leader: true, kind: "musician" },
    { name: "Wolfgang Amadeus Mozart", id: 95, roles: ["Composed By"], tracks: ["A1", "B1"], leader: false, kind: "credit" },
    { name: "Georg Friedrich Händel", id: 96, roles: ["Composed By"], tracks: ["A2"], leader: false, kind: "credit" },
    { name: "Raymond Meylan", id: 7, roles: ["Cadenza"], tracks: ["A1"], leader: false, kind: "musician" },
    { name: "Seymour Solomon", id: 8, roles: ["Producer"], tracks: [], leader: false, kind: "credit" },
  ] });
// A classical record already fetched the old way (movements only), and the grouped version Discogs now gives.
const quartets = demo.find((r) => (r.genres || []).includes("Classical") && r.artist.startsWith("J.S. Bach")) || demo.find((r) => (r.genres || []).includes("Classical"));
const Q1 = "String Quartet No. 1 In C Major, Op. 49", Q2 = "String Quartet No. 2 In A Major, Op. 68";
const grouped = [
  { pos: "A1", title: "Moderato", dur: "4:38", work: Q1, wdur: "13:50" }, { pos: "A2", title: "Moderato", dur: "4:51", work: Q1 },
  { pos: "A3", title: "Allegro Molto", dur: "2:00", work: Q1 }, { pos: "A4", title: "Allegro", dur: "2:12", work: Q1 },
  { pos: "B1", title: "Overture: Moderato Con Moto", dur: "8:02", work: Q2 }, { pos: "B2", title: "Recitative And Romance: Adagio", dur: "10:31", work: Q2 },
];
let oldServer = true;   // first answer comes from a not-yet-updated deploy
Object.assign(quartets, { discogs_id: 77, enrich_status: "matched", tracks: grouped.map(({ work, ...t }) => t) });

const calls = [];
const titleCase = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const release = (artist, title) => ({
  discogs_id: 7, discogs_url: "https://www.discogs.com/release/7", year: 1961, label: "Impulse!", label_catno: "A-12",
  cover_url: "/t/b.png", thumb_url: "/t/b.png", discogs_genres: ["Jazz"], discogs_styles: [],
  discogs_artist: titleCase(artist), discogs_title: titleCase(title),
  tracks: [{ pos: "A1", title: "Ezz-thetics", dur: "6:43" }, { pos: "A2", title: "Mr. Jones", dur: "7:01" }],
  credits: [{ name: artist, id: 1, roles: ["Alto Saxophone"], tracks: [], leader: true, kind: "musician" }, { name: "Elvin Jones", id: 2, roles: ["Drums"], tracks: [], leader: false, kind: "musician" }],
});

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer(async (rq, res) => {
  const u = new URL(rq.url, "http://x");
  const send = (code, type, body) => { res.writeHead(code, { "content-type": type }); res.end(body); };
  if (u.pathname === "/demo.json") return send(200, "application/json", JSON.stringify(demo));
  if (u.pathname.startsWith("/t/")) return send(200, "image/png", covers[path.basename(u.pathname, ".png")]);
  if (u.pathname === "/api/discogs") {
    const op = u.searchParams.get("op"); calls.push(op + ":" + (u.searchParams.get("title") || ""));
    if (op === "images") {
      await new Promise((r) => setTimeout(r, 300));
      return send(200, "application/json", JSON.stringify({ images: [
        { url: "/t/a.png", thumb: "/t/a.png", source: "Apple Music", detail: "The Black Saint and the Sinner Lady, 1963" },
        { url: "/t/missing.png", thumb: "/t/missing.png", source: "Cover Art Archive", detail: "1963" },
        { url: "/t/c.png", thumb: "/t/c.png", source: "Discogs", detail: "1963, US, Vinyl LP" },
        { url: "/t/d.png", thumb: "/t/d.png", source: "Discogs", detail: "1974, Japan, Vinyl LP" },
      ] }));
    }
    if (op === "match") {
      await new Promise((r) => setTimeout(r, 900)); // long enough to see the "looking up" state
      return send(200, "application/json", JSON.stringify({ status: "matched", release: release(u.searchParams.get("artist"), u.searchParams.get("title")), rateRemaining: 50 }));
    }
    if (op === "fetch") {
      const ref = u.searchParams.get("ref"); fetchLog.push(`${ref}${u.searchParams.get("exact") === "1" ? " exact" : ""}`);
      if (ref === "release/77") {
        const answer = oldServer
          ? { ...release("x", "x"), discogs_id: 77, discogs_artist: "Shostakovich, Borodin Quartet", discogs_title: "The Complete String Quartets Vol. 1 (Nos. 1-5)", tracks: grouped.map(({ work, wdur, ...t }) => t) }
          : { ...release("x", "x"), discogs_id: 77, discogs_artist: "Shostakovich, Borodin Quartet", discogs_title: "The Complete String Quartets Vol. 1 (Nos. 1-5)", tracks: grouped.map((t, i) => ({ ...t, wi: t.work === Q1 ? 1 : 2, ...(i === 0 ? { wby: "Dmitri Shostakovich" } : {}) })), parser: 4 };
        oldServer = false;
        return send(200, "application/json", JSON.stringify({ status: "matched", release: answer }));
      }
      const rel = ref === "release/900" ? { ...release("Oscar Peterson", "À Salle Pleyel"), discogs_id: 900, discogs_artist: "Oscar Peterson & Joe Pass", discogs_title: "À Salle Pleyel", label_catno: "2625 705",
          tracks: [{ pos: "A1", title: "Erster Teil = Part I = Première Partie", dur: "5:00" }, { pos: "A2", title: "'Round Midnight", dur: "6:10" }, { pos: "A3", title: "Don't Explain", dur: "4:00" }] }
        : { ...release("Charles Mingus", "x"), discogs_artist: "Charles Mingus", discogs_title: "The Black Saint And The Sinner Lady" };
      return send(200, "application/json", JSON.stringify({ status: "matched", release: rel }));
    }
    if (op === "search") { searchLog.push(u.searchParams.get("any")); return send(200, "application/json", JSON.stringify({ candidates: [
      { type: "release", id: 900, title: "Oscar Peterson & Joe Pass - À Salle Pleyel", year: "1975", country: "US", label: "Pablo", catno: "2625 705", format: "2 × Vinyl, LP, Album, Gatefold", have: 812, thumb: "/t/e.png" },
      { type: "release", id: 901, title: "Oscar Peterson & Joe Pass - À Salle Pleyel", year: "2017", country: "Europe", label: "Pablo", catno: "PACR 7020", format: "2 × Vinyl, LP, Album, Reissue, 180g, Clear", have: 95, thumb: "/t/e.png" },
      { type: "master", id: 77, title: "Oscar Peterson & Joe Pass - À Salle Pleyel", year: "1975", thumb: "/t/e.png" },
    ] })); }
    return send(400, "application/json", "{}");
  }
  if (u.pathname === "/api/bandcamp" && /missing-function/.test(u.searchParams.get("url"))) { res.writeHead(404, { "content-type": "text/html" }); return res.end("<html>Page not found</html>"); }
  if (u.pathname === "/api/bandcamp") {
    bandcampLog.push(u.searchParams.get("url"));
    if (!/bandcamp/.test(u.searchParams.get("url"))) return send(422, "application/json", JSON.stringify({ error: "That page doesn’t look like a Bandcamp album or track. Open the album on Bandcamp and copy its link." }));
    await new Promise((r) => setTimeout(r, 500));
    return send(200, "application/json", JSON.stringify({ status: "matched", release: bandcampRelease }));
  }
  if (u.pathname.startsWith("/api/")) return send(404, "text/plain", "");
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) return send(404, "text/plain", "");
  send(200, types[path.extname(f)] || "application/octet-stream", fs.readFileSync(f));
}).listen(5179);

const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => { if (m.type() === "error" && !/fonts|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await p.route(/fonts\.(googleapis|gstatic)\.com|jsdelivr/, (r) => r.abort());
const shot = async (n) => { await p.waitForTimeout(350); await p.screenshot({ path: path.join(OUT, n + ".png") }); };
const BASE = "http://localhost:5179/?demo&demoapi";

await p.goto(BASE); await p.waitForSelector(".row");
check((await p.textContent(".brand h1")) === "Garage Crates", "app is named Garage Crates");
check((await p.title()) === "Garage Crates", "page title renamed");
check((await p.textContent('a.fab[href="#/add"]')).trim() === "Add", "add button reads Add");

// --- find a better image
await p.goto(BASE + "#/album/" + mingus.id); await p.waitForSelector(".album-title");
await shot("c01-album-cd-cover");
await p.click("#cover-find");
await p.waitForSelector(".cover-opt");
await p.waitForTimeout(300);
check(await p.locator(".cover-opt").count() === 3, "broken image option is hidden, 3 shown");
await p.locator("#cover").scrollIntoViewIfNeeded();
await shot("c02-cover-options");
await p.click('.cover-opt:has-text("1974, Japan")');
await p.waitForTimeout(300);
check((await p.getAttribute(".thumb.large img", "src")) === "/t/d.png", "picked image becomes the cover");
check(JSON.parse(await p.evaluate(() => localStorage.getItem("crate.demo.v2"))).find((r) => r.title.startsWith("The Black Saint")).cover_locked === true, "chosen cover is locked");

// refresh details must keep the chosen cover
await p.click("#refresh"); await p.waitForTimeout(400);
check((await p.getAttribute(".thumb.large img", "src")) === "/t/d.png", "refreshing details keeps the chosen cover");
await shot("c03-cover-changed");

// --- upload a photo
await p.click("#cover-own"); await p.waitForSelector("#cover-file", { state: "attached" });
await shot("c04-own-image");
await p.setInputFiles("#cover-file", { name: "sleeve.png", mimeType: "image/png", buffer: photo });
await p.waitForFunction(() => document.querySelector(".thumb.large img")?.src.startsWith("data:image/jpeg"));
const dims = await p.evaluate(() => new Promise((r) => { const i = new Image(); i.onload = () => r([i.naturalWidth, i.naturalHeight]); i.src = document.querySelector(".thumb.large img").src; }));
check(dims[0] === dims[1] && dims[0] <= 320, `uploaded photo saved as a square thumbnail (${dims})`);
await shot("c05-photo-uploaded");

// --- paste a link
await p.click("#cover-own"); await p.fill("#cover-url", "not a link"); await p.click("#cover-link button");
check((await p.textContent("#cover")).includes("starts with https://"), "bad link gets a clear message");
await p.fill("#cover-url", "https://example.com/cover.jpg"); await p.click("#cover-link button"); await p.waitForTimeout(250);
check((await p.getAttribute(".thumb.large img", "src")) === "https://example.com/cover.jpg", "pasted link becomes the cover (demo mode)");
await p.click("button[data-close]"); await p.waitForTimeout(250);

// --- add a record to the collection, with lookup
await p.click('a.fab[href="#/add"]'); await p.waitForSelector("#add-form");
await p.click('label:has-text("Collection")');
check((await p.textContent("#add-submit")) === "Add to collection", "button follows the collection choice");
await p.fill('input[name="artist"]', "Eric Dolphy"); await p.fill('input[name="title"]', "Out There");
await shot("c06-add-record");
await p.click("#add-submit");
await p.waitForSelector(".note.looking");
await shot("c07-looking-up");
check((await p.textContent(".album-title")) === "Out There", "new record opens right away");
await p.waitForSelector(".tracks", { timeout: 5000 });
await p.waitForTimeout(200);
const sheet = await p.textContent(".album");
check(sheet.includes("Elvin Jones") && sheet.includes("Ezz-thetics") && sheet.includes("Impulse!"), "tracks, personnel and label filled in");
check(!(await p.locator(".note.looking").count()), "looking-up note goes away");
check((await p.getAttribute(".thumb.large img", "src")) === "/t/b.png", "cover filled in");
await shot("c08-added-filled");
await p.click("button[data-close]"); await p.waitForTimeout(250);
await p.fill("#q", "elvin"); await p.waitForTimeout(250);
check((await p.textContent(".person-row")).includes("Elvin Jones"), "new record’s players are searchable");
await p.click(".person-row"); await p.waitForSelector(".person-name");
check((await p.textContent(".person")).includes("Out There") && (await p.textContent(".person")).includes("Drums"), "player page lists the new record with instrument");
await p.click("button[data-close]"); await p.waitForTimeout(250);

// --- fixing a match renames the record to what Discogs has
const evans = demo.find((r) => r.artist === "Oscar Peterson, Joe Pass");
await p.goto(BASE + "#/album/" + evans.id); await p.waitForSelector(".album-title");
const before = await p.textContent(".album-title");
await p.click("#fix-open"); await p.waitForSelector("[data-ref]");
const cands = await p.textContent(".cands");
check(cands.includes("1975 · US · Pablo 2625 705") && cands.includes("2 × Vinyl, LP, Album, Reissue, 180g, Clear") && !cands.includes("collectors") && cands.includes("Any pressing: uses the original LP"), "Fix match rows show year, country, label, catalogue number, and format details, without collector counts");
check(searchLog.at(-1) === "0" && (await p.textContent("#fix")).includes("Showing vinyl only."), "Fix match searches vinyl only");
await p.locator("#fix").scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(OUT, "fix-list.png") });
await p.click("#fix-any"); await p.waitForFunction(() => document.querySelector("#fix")?.textContent.includes("Showing every format."));
check(searchLog.at(-1) === "1", "and can include CDs and other formats");
await p.click("#fix-any"); await p.waitForFunction(() => document.querySelector("#fix")?.textContent.includes("Showing vinyl only."));
await p.click("[data-ref]"); await p.waitForTimeout(400);
check((await p.textContent(".album-title")) === "À Salle Pleyel", `fix match sets the Discogs title (was "${before}")`);
check((await p.textContent(".album-artist")) === "Oscar Peterson & Joe Pass", "fix match sets the Discogs artist line");
check((await p.textContent("#toast")).includes("Match updated: À Salle Pleyel, Oscar Peterson & Joe Pass"), "toast says what it changed to");
check((await p.textContent(".album-meta")).includes("2625 705"), "fix match updates the catalogue number shown on the album: " + (await p.textContent(".album-meta")));
const trackText = await p.textContent(".tracks");
check(trackText.includes("Erster Teil • Part I • Première Partie") && trackText.includes("’Round Midnight") && trackText.includes("Don’t Explain") && !trackText.includes("'"), "track titles show real apostrophes and dots between translations");
await shot("c10-fixed-names");
await p.click("button[data-close]"); await p.waitForTimeout(250);
await p.fill("#q", "peterson & joe"); await p.waitForTimeout(250);
check((await p.textContent("#results")).includes("À Salle Pleyel"), "renamed record is searchable by its new artist");
await p.fill("#q", "");

check(fetchLog.includes("release/900 exact"), "a pressing picked in Fix match is used exactly");

// --- records pulled from CD track listings can be switched to vinyl
await p.goto(BASE + "#/tools"); await p.waitForSelector(".stat-strip");
check((await p.textContent(".tools")).includes("1 track list looks like a CD"), "Collection screen finds the CD-listed record");
await shot("c11-vinyl-fix");
await p.click("#vinyl");
await p.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Finished switching"), null, { timeout: 8000 });
check(fetchLog.includes("release/55"), "re-fetch asks for the vinyl version (not exact)");
check(!(await p.locator("#vinyl").count()), "button goes away once fixed");
await p.goto(BASE + "#/album/" + cdRecord.id); await p.waitForSelector(".tracks");
check((await p.textContent(".tracks")).includes("A1"), "track list now has sides");
check((await p.getAttribute(".thumb.large img", "src")) === "/t/e.png", "a cover you chose survives the switch");
await p.goto(BASE); await p.waitForSelector(".row");

// --- classical records: refreshing a flat classical record puts movements under their pieces
await p.goto(BASE + "#/tools"); await p.waitForSelector(".stat-strip");
check(!(await p.locator("#works").count()) && !(await p.textContent(".tools")).includes("classical record"), "no classical update prompt on the Collection page");
oldServer = false;
await p.goto(BASE + "#/album/" + quartets.id); await p.waitForSelector("#refresh");
await p.click("#refresh");
await p.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Details refreshed"), null, { timeout: 8000 });
check(fetchLog.includes("release/77"), "Refresh re-reads the record from Discogs");
await p.goto(BASE + "#/album/" + quartets.id); await p.waitForSelector(".tracks");
check(await p.locator(".tracks li.work").count() === 2, "two pieces shown as headers");
check((await p.textContent(".tracks li.work >> nth=0")).includes(Q1) && (await p.textContent(".tracks li.work >> nth=0")).includes("13:50"), "piece header shows Discogs' time for the piece");
check((await p.textContent(".tracks li.work >> nth=1")).includes("18:33"), "piece without its own time adds up its movements");
check(await p.locator(".tracks li.mvt").count() === 6, "all six movements listed under their pieces");
await p.locator(".tracks").scrollIntoViewIfNeeded();
await shot("c12-classical");
await p.goto(BASE); await p.waitForSelector(".row");
await p.fill("#q", "quartet no 2"); await p.waitForTimeout(250);
const songs = await p.textContent("#results");
check(songs.includes(Q2) && !songs.includes("Overture"), "searching a piece lists the piece once, not each movement");
await p.fill("#q", "recitative"); await p.waitForTimeout(250);
check((await p.textContent("#results")).includes("in " + Q2), "a movement hit says which piece it’s from");
await shot("c13-classical-search");
await p.fill("#q", "");

// --- two pieces with the same title stay apart; composers are labelled as composers
await p.goto(BASE + "#/album/" + oboe.id); await p.waitForSelector(".tracks");
check(await p.locator(".tracks li.work").count() === 2, "same-title pieces shown as two pieces");
check((await p.textContent(".tracks li.work >> nth=0")).includes("Arnold Bax") && (await p.textContent(".tracks li.work >> nth=1")).includes("Arthur Bliss"), "each piece shows its composer");
check((await p.textContent(".tracks li.work >> nth=1")).includes("21:29"), "second piece keeps its own time");
const pers = await p.textContent(".credits");
check(pers.includes("Composer") && !/Arnold Bax\s*Leader/.test(pers), "composers labelled Composer, not Leader");
check(/Bert Lucarelli\s*Leader, Oboe/.test(pers), "performer still shown as leader with instrument");
await p.locator(".tracks").scrollIntoViewIfNeeded();
await shot("c14-same-title-pieces");
await p.goto(BASE); await p.waitForSelector(".row");
await p.fill("#q", "quintet for oboe"); await p.waitForTimeout(250);
const qhits = await p.textContent("#results");
check(qhits.includes("by Arnold Bax") && qhits.includes("by Arthur Bliss"), "search lists both pieces, each with its composer");
await p.fill("#q", "");

// --- composers credited on single tracks
await p.goto(BASE + "#/album/" + vOboe.id); await p.waitForSelector(".tracks");
const vt = await p.textContent(".tracks");
check(vt.includes("Wolfgang Amadeus Mozart") && vt.includes("Cadenza: Raymond Meylan") && vt.includes("Georg Friedrich Händel"), "composer and cadenza shown under each track");
check(!(await p.locator(".tracks li.work").count()), "no piece headers invented for single-track pieces");
const vp = await p.textContent(".credits");
check(/Wolfgang Amadeus Mozart\s*Composer\s*on A1, B1/.test(vp), "Mozart in personnel as Composer on A1, B1");
check(/Raymond Meylan\s*Cadenza/.test(vp) && !vp.includes("Seymour Solomon"), "cadenza player in personnel; producer stays in other credits");
await p.locator(".tracks").scrollIntoViewIfNeeded();
await shot("c17-composers-on-tracks");
await p.click('.credits a:has-text("Wolfgang Amadeus Mozart")'); await p.waitForSelector(".person-name");
const mp = await p.textContent(".person");
check(mp.includes("Their music, played by others") && mp.includes("Composer on 1"), "Mozart’s page groups records as composer");
await shot("c18-composer-page");
await p.goto(BASE); await p.waitForSelector(".row");
await p.fill("#q", "lardrot"); await p.waitForTimeout(250);
check((await p.textContent(".person-row")).includes("leader on 1"), "search summary for a performer");
await p.fill("#q", "");

// --- Bandcamp: fix a record from a pasted Bandcamp link
const bcRec = demo.find((r) => r.artist === "Kit Downes, Petter Eldh, James Maddren");
await p.goto(BASE + "#/album/" + bcRec.id); await p.waitForSelector(".album-title");
await p.click("#fix-open"); await p.waitForSelector("#fix-q");
await p.fill("#fix-q", "https://example.com/some-page"); await p.click("#fix-form button");
await p.waitForSelector("#fix .note.warn");
check((await p.textContent("#fix")).includes("doesn’t look like a Bandcamp album"), "a non-Bandcamp link gets a clear message");
await p.fill("#fix-q", "https://x.bandcamp.com/album/missing-function"); await p.click("#fix-form button");
await p.waitForFunction(() => document.querySelector("#fix")?.textContent.includes("isn’t on your site yet"), null, { timeout: 5000 });
check((await p.textContent("#fix")).includes("netlify/functions/bandcamp.mjs"), "a missing server file is named in the message");
await p.fill("#fix-q", "https://kitdownes.bandcamp.com/album/smoke-mirrors"); await p.click("#fix-form button");
await p.waitForSelector(".tracks", { timeout: 5000 }); await p.waitForTimeout(200);
check((await p.textContent(".album-title")) === "Smoke & Mirrors" && (await p.textContent(".album-artist")) === "Kit Downes Trio", "Bandcamp names applied");
check((await p.textContent(".tracks")).includes("Sea Shanty"), "Bandcamp tracks applied");
check((await p.textContent(".credits")).includes("Petter Eldh"), "players from Bandcamp credits listed");
check((await p.inputValue("#notes")).startsWith("Credits from Bandcamp:"), "full credits text kept in notes");
check((await p.textContent(".footer-actions")).includes("View on Bandcamp"), "link says Bandcamp");
check(!(await p.locator("#refresh").count()), "no Discogs refresh for a Bandcamp record");
await shot("c15-bandcamp-fixed");
await p.goto(BASE); await p.waitForSelector(".row");

// --- Bandcamp: add a new record with a Bandcamp link
await p.click('a.fab[href="#/add"]'); await p.waitForSelector("#add-form");
await p.click('label:has-text("Collection")');
await p.fill('input[name="artist"]', "kit downes"); await p.fill('input[name="title"]', "smoke and mirrors");
await p.click(".add-more summary");
await p.fill('input[name="bandcamp"]', "https://kitdownes.bandcamp.com/album/smoke-mirrors");
await shot("c16-add-bandcamp");
const bcBefore = bandcampLog.length;
await p.click("#add-submit"); await p.waitForSelector(".tracks", { timeout: 5000 }); await p.waitForTimeout(200);
check(bandcampLog.length === bcBefore + 1 && (await p.textContent(".album-title")) === "Smoke & Mirrors", "Add with a Bandcamp link fills from Bandcamp, not Discogs");
await p.goto(BASE); await p.waitForSelector(".row");

// --- a quick lowercase add gets Discogs' spelling
await p.click('a.fab[href="#/add"]'); await p.waitForSelector("#add-form");
await p.click('label:has-text("Collection")');
await p.fill('input[name="artist"]', "freddie hubbard"); await p.fill('input[name="title"]', "hub-tones");
await p.click("#add-submit"); await p.waitForSelector(".tracks", { timeout: 5000 }); await p.waitForTimeout(200);
check((await p.textContent(".album-title")) === "Hub-Tones" && (await p.textContent(".album-artist")) === "Freddie Hubbard", "auto lookup uses Discogs' artist and title");
await p.click("button[data-close]"); await p.waitForTimeout(250);

// --- want list add still quick, from an empty search
await p.fill("#q", "Kenny Dorham"); await p.waitForTimeout(250);
await p.click(".empty .btn"); await p.waitForSelector("#add-form");
check((await p.inputValue('input[name="artist"]')) === "Kenny Dorham", "search text prefills artist");
check((await p.textContent("#add-submit")) === "Add to want list", "want list is the default");
await p.fill('input[name="title"]', "Whistle Stop"); await p.click("#add-submit");
await p.waitForSelector(".status-block.want"); await p.waitForSelector(".tracks", { timeout: 5000 });
check((await p.textContent("#count")).includes("wanted"), "want add saved");
await shot("c09-want-added");

console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
console.log("lookup calls:", calls.join(", "));
await browser.close(); server.close();
