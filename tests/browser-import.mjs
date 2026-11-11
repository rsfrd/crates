// Importing from Discogs and from a spreadsheet. Run: node tests/browser-import.mjs <outdir>
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ROOT = new URL("../public/", import.meta.url).pathname;
let collection = [];   // starts empty, like a brand-new site
const bi = (id, artist, title, format = "Vinyl", extra = {}) => ({ id, master_id: id + 1000, title, year: 1960 + (id % 20), artists: [{ name: artist, join: "" }],
  labels: [{ name: "Blue Note", catno: `BLP ${4000 + id}` }], formats: [{ name: format, descriptions: ["LP"] }], genres: ["Jazz"], thumb: "", cover_image: "", ...extra });
const page1 = Array.from({ length: 100 }, (_, i) => bi(i + 1, `Artist ${String(i + 1).padStart(3, "0")}`, `Album ${i + 1}`));
const page2 = [bi(101, "Hank Mobley", "Soul Station"), bi(102, "Lee Morgan", "The Sidewinder", "CD"), bi(103, "Grant Green", "Idle Moments")];
const calls = [];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const srv = http.createServer(async (rq, res) => {
  const u = new URL(rq.url, "http://x");
  const send = (c, b) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (u.pathname === "/demo.json") return send(200, collection);
  if (u.pathname === "/api/discogs") {
    const op = u.searchParams.get("op"); calls.push(`${op}:${u.searchParams.get("username") || u.searchParams.get("ref") || ""}:${u.searchParams.get("list") || ""}:${u.searchParams.get("page") || ""}${u.searchParams.get("exact") ? ":exact" : ""}`);
    if (op === "collection") {
      const name = u.searchParams.get("username");
      if (name === "nobody") return send(400, { error: "There’s no Discogs user called “nobody”. Check the spelling." });
      const { rowFromDiscogs } = await import("../netlify/lib/discogs.mjs");
      if (u.searchParams.get("list") === "wants") return send(200, { page: 1, pages: 1, total: 1, rows: [rowFromDiscogs(bi(500, "Andrew Hill", "Point Of Departure"), "want")] });
      const p = Number(u.searchParams.get("page"));
      await new Promise((r) => setTimeout(r, 200));
      return send(200, { page: p, pages: 2, total: 103, rows: (p === 1 ? page1 : page2).map((x) => rowFromDiscogs(x, "owned")) });
    }
    if (op === "fetch") {
      const id = Number(u.searchParams.get("ref").split("/")[1]);
      const src = [...page1, ...page2].find((x) => x.id === id);
      return send(200, { status: "matched", release: { discogs_id: id, discogs_url: "x", year: src.year, label: "Blue Note", tracks: [{ pos: "A1", title: "Track", dur: "5:00" }], credits: [], discogs_title: src.title, discogs_artist: src.artists[0].name } });
    }
    return send(404, {});
  }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (u.pathname.startsWith("/api/") || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f));
}).listen(5187);

const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.route(/fonts\.|jsdelivr/, (r) => r.abort());
const BASE = "http://localhost:5187/?demo&demoapi";
const shot = async (n) => { await p.waitForTimeout(300); await p.screenshot({ path: path.join(OUT, n + ".png") }); };

// a brand-new, empty site invites an import
await p.goto(BASE); await p.waitForSelector(".empty");
check((await p.textContent(".empty")).includes("Your collection is empty") && await p.locator('.empty a[href="#/import/discogs"]').count() === 1, "empty site offers Discogs and spreadsheet imports");
await shot("i01-empty");

// Discogs: unknown user, then a real one across two pages
await p.click('.empty a[href="#/import/discogs"]'); await p.waitForSelector("#imp-form");
await p.fill('input[name="username"]', "nobody"); await p.click("#imp-form button");
await p.waitForSelector(".importer .note.warn");
check((await p.textContent(".importer")).includes("no Discogs user called “nobody”"), "unknown username gets a clear message");
await p.fill('input[name="username"]', "https://www.discogs.com/user/jazzfan/collection"); await p.click("#imp-form button");
await p.waitForSelector("#imp-save", { timeout: 8000 });
check(calls.includes("collection:jazzfan:collection:1") && calls.includes("collection:jazzfan:collection:2"), "a pasted profile link works, and both pages are read");
const summary = await p.textContent(".importer");
check(summary.includes("102 records to bring in") && summary.includes("1 not on vinyl, left out"), "the CD is left out with Vinyl only");
await shot("i02-discogs-found");
await p.click("#imp-vinyl"); await p.waitForTimeout(150);
check((await p.textContent("#imp-save")).includes("Import 103 records"), "unticking Vinyl only includes it");
await p.click("#imp-vinyl"); await p.waitForTimeout(150);
await p.click("#imp-save");
await p.waitForSelector(".importer .note strong", { timeout: 10000 });
check((await p.textContent(".importer")).includes("102 records imported"), "102 records imported");
await shot("i03-discogs-done");
await p.click('.importer a[href="#/tools"]'); await p.waitForSelector(".stat-strip");
check((await p.textContent(".card-row:has(#run)")).includes("102 records to fetch"), "they’re waiting to be fetched");
await p.click("#run");
await p.waitForFunction(() => document.querySelector(".progress"), null, { timeout: 5000 });
await new Promise((r) => setTimeout(r, 1500));
await p.click("#stop").catch(() => {});
const fetches = calls.filter((c) => c.startsWith("fetch:") || c.startsWith("match:"));
check(fetches.length > 0 && fetches.every((c) => c.startsWith("fetch:release/") && c.endsWith(":exact")), `Fetch details reads the exact pressing, no searching (${fetches.slice(0, 2).join(", ")})`);
await p.waitForFunction(() => !document.querySelector(".progress"), null, { timeout: 8000 });
// imported records skip matching: Fetch details reads the exact pressing
await p.goto(BASE); await p.waitForSelector(".row");
await p.fill("#q", "soul station"); await p.waitForTimeout(250);
await p.click("#results a.row[data-id]"); await p.waitForSelector(".album-title");
check((await p.textContent(".album-meta")).includes("BLP 4101"), "label and catalogue number came from Discogs");

// importing the same collection again brings in nothing new
await p.goto(BASE + "#/import/discogs"); await p.waitForSelector("#imp-form");
await p.fill('input[name="username"]', "jazzfan"); await p.click("#imp-form button");
await p.waitForFunction(() => document.querySelector(".importer")?.textContent.includes("102 you already have"), null, { timeout: 8000 });
check(!(await p.locator("#imp-save").count()), "a second import finds nothing new");
// want list
await p.click("#imp-again"); await p.click('label:has-text("Want list")');
await p.fill('input[name="username"]', "jazzfan"); await p.click("#imp-form button");
await p.waitForSelector("#imp-save"); await p.click("#imp-save");
await p.waitForSelector(".importer .note strong");
await p.goto(BASE); await p.waitForSelector(".row");
check((await p.textContent("#count")).includes("102 records, 1 wanted"), "want list imports as wants");

// spreadsheet: quoted commas, odd headings, a duplicate, an incomplete row
const csv = 'Album Title;Artist Name;Released;Catalog #;Genre\n"Parsley, Sage, Rosemary and Thyme";Simon & Garfunkel;1966;CS 9363;Folk / Rock\nSoul Station;Hank Mobley;1960;BLP 4031;Jazz\n;Missing Artist;;;\nBookends;Simon & Garfunkel;1968;KCS 9529;Folk\n';
await p.goto(BASE + "#/import/csv"); await p.waitForSelector('label[for="imp-file"]');
await shot("i04-csv-start");
await p.setInputFiles("#imp-file", { name: "records.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
await p.waitForSelector(".map");
check(await p.inputValue('[data-field="artist"]') === "1" && await p.inputValue('[data-field="title"]') === "0" && await p.inputValue('[data-field="catno"]') === "3", "columns are matched from the headings (semicolon file)");
const cs = await p.textContent(".importer");
check(cs.includes("2 records to bring in") && cs.includes("1 you already have") && cs.includes("1 without an artist or album"), "duplicate and incomplete rows are counted and left out");
check(cs.includes("Parsley, Sage, Rosemary and Thyme"), "the title with commas stays whole");
await shot("i05-csv-mapped");
await p.click('label:has-text("Want list")');
await p.click("#imp-save"); await p.waitForSelector(".importer .note strong");
await p.goto(BASE); await p.waitForSelector(".row");
check((await p.textContent("#count")).includes("102 records, 3 wanted"), "spreadsheet rows imported to the want list");
await p.fill("#q", "parsley"); await p.waitForTimeout(250);
await p.click("#results a.row[data-id]"); await p.waitForSelector(".album-title");
check((await p.textContent(".album")).includes("Folk") && (await p.textContent(".album")).includes("Rock") && (await p.textContent(".album-meta")).includes("1966"), "genres and year came through");

// guests can’t import
await p.goto(BASE + "&guest#/tools".replace("&guest#", "&guest#")); await p.waitForSelector(".stat-strip");
check(await p.getAttribute('a[data-import][href="#/import/discogs"]', "aria-disabled") === "true", "import is greyed out for guests");
console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await b.close(); srv.close();
