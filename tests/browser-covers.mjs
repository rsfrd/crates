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

const demo = JSON.parse(fs.readFileSync(path.join(ROOT, "demo.json"), "utf8"));
const mingus = demo.find((r) => r.title.startsWith("The Black Saint"));
Object.assign(mingus, { cover_url: "/t/cd.png", thumb_url: "/t/cd.png", discogs_id: 42, enrich_status: "matched", year: 1963 });

const calls = [];
const release = (artist, title) => ({
  discogs_id: 7, discogs_url: "https://www.discogs.com/release/7", year: 1961, label: "Impulse!", label_catno: "A-12",
  cover_url: "/t/b.png", thumb_url: "/t/b.png", discogs_genres: ["Jazz"], discogs_styles: [],
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
    if (op === "fetch") return send(200, "application/json", JSON.stringify({ status: "matched", release: release("Charles Mingus", "x") }));
    return send(400, "application/json", "{}");
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
check((await p.textContent(".fab")).trim() === "Add", "add button reads Add");

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
check(JSON.parse(await p.evaluate(() => localStorage.getItem("crate.demo.v1"))).find((r) => r.title.startsWith("The Black Saint")).cover_locked === true, "chosen cover is locked");

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
await p.click(".fab"); await p.waitForSelector("#add-form");
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
check((await p.textContent(".person-row")).includes("Elvin Jones"), "new record's players are searchable");
await p.click(".person-row"); await p.waitForSelector(".person-name");
check((await p.textContent(".person")).includes("Out There") && (await p.textContent(".person")).includes("Drums"), "player page lists the new record with instrument");
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
