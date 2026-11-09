// Browser walkthrough in demo mode. Run: node tests/browser.mjs <outdir>
import { createRequire as cr } from "node:module";
const { chromium } = cr("/opt/npm-tools/node_modules/")("playwright");
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire("/opt/npm-tools/node_modules/");
const sharp = require("sharp");
const OUT = process.argv[2];
const ROOT = new URL("../public/", import.meta.url).pathname;
fs.mkdirSync(OUT, { recursive: true });

// Stand-in covers (solid art so the layout can be judged).
async function art(hueA, hueB) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><rect width="300" height="300" fill="hsl(${hueA},55%,45%)"/><circle cx="210" cy="110" r="70" fill="hsl(${hueB},70%,60%)"/><rect x="20" y="220" width="160" height="14" fill="#fff"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
const covers = { a: await art(10, 50), b: await art(210, 30), c: await art(140, 300), d: await art(270, 190) };

const demo = JSON.parse(fs.readFileSync(path.join(ROOT, "demo.json"), "utf8"));
const find = (artist, title) => demo.find((r) => r.artist === artist && r.title.startsWith(title));
const mingus = find("Charles Mingus", "The Black Saint");
Object.assign(mingus, {
  year: 1963, label: "Impulse!", cover_url: "/t/b.png", thumb_url: "/t/b.png", enrich_status: "matched",
  discogs_url: "https://www.discogs.com/release/1",
  tracks: [{ pos: "A", title: "Track A - Solo Dancer", dur: "6:40" }, { pos: "B", title: "Track B - Duet Solo Dancers", dur: "6:45" }, { pos: "C", title: "Track C - Group Dancers", dur: "7:20" }, { pos: "D", title: "Mode D - Trio And Group Dancers", dur: "18:19" }],
  credits: [
    { name: "Charles Mingus", id: 1, roles: ["Double Bass", "Piano"], tracks: [], leader: true, kind: "musician" },
    { name: "Jaki Byard", id: 2, roles: ["Piano"], tracks: [], leader: false, kind: "musician" },
    { name: "Jerome Richardson", id: 3, roles: ["Soprano Saxophone", "Baritone Saxophone", "Flute"], tracks: [], leader: false, kind: "musician" },
    { name: "Charlie Mariano", id: 4, roles: ["Alto Saxophone"], tracks: [], leader: false, kind: "musician" },
    { name: "Jay Berliner", id: 5, roles: ["Classical Guitar"], tracks: ["C", "D"], leader: false, kind: "musician" },
    { name: "Dannie Richmond", id: 6, roles: ["Drums"], tracks: [], leader: false, kind: "musician" },
    { name: "Bob Thiele", id: 7, roles: ["Producer"], tracks: [], leader: false, kind: "credit" },
  ],
});
const alice = find("Alice Coltrane", "The Carnegie");
Object.assign(alice, { year: 1971, cover_url: "/t/a.png", thumb_url: "/t/a.png", enrich_status: "review", for_sale: true,
  tracks: [{ pos: "A", title: "Journey in Satchidananda", dur: "17:00" }, { pos: "B", title: "Shiva-Loka", dur: "16:00" }] });
const holland = find("Dave Holland Quintet", "Jumpin");
Object.assign(holland, { year: 1984, cover_url: "/t/d.png", thumb_url: "/t/d.png", enrich_status: "matched",
  credits: [{ name: "Dave Holland", id: 9, roles: ["Bass", "Cello"], tracks: [], leader: true, kind: "musician" }, { name: "Steve Coleman", id: 10, roles: ["Alto Saxophone", "Flute"], tracks: [], leader: false, kind: "musician" }],
  tracks: [{ pos: "A1", title: "Jumpin' In", dur: "8:58" }] });
demo.push({ ...structuredClone(mingus), id: "want1", title: "Mingus Ah Um", status: "want", year: 1959, label: "Columbia", cover_url: "/t/c.png", thumb_url: "/t/c.png",
  tracks: [{ pos: "A1", title: "Better Git It in Your Soul", dur: "7:23" }, { pos: "A2", title: "Goodbye Pork Pie Hat", dur: "5:44" }],
  credits: [{ name: "Charles Mingus", id: 1, roles: ["Bass"], tracks: [], leader: true, kind: "musician" }, { name: "Jimmy Knepper", id: 11, roles: ["Trombone"], tracks: [], leader: false, kind: "musician" }, { name: "Dannie Richmond", id: 6, roles: ["Drums"], tracks: [], leader: false, kind: "musician" }],
  created_at: "2026-10-30T00:00:00Z", for_sale: false });
demo.push({ id: "want2", artist: "Jaki Byard", title: "Out Front!", status: "want", genres: [], tracks: [], credits: [], personnel_hint: [], enrich_status: "pending", created_at: "2026-11-01T00:00:00Z" });

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/demo.json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(demo)); }
  if (u.pathname.startsWith("/t/")) { res.writeHead(200, { "content-type": "image/png" }); return res.end(covers[path.basename(u.pathname, ".png")]); }
  if (u.pathname.startsWith("/api/")) { res.writeHead(404); return res.end(); }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
}).listen(5178);

const browser = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const errors = [];
async function phone(scheme = "light") {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/fonts|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.route(/fonts\.(googleapis|gstatic)\.com|jsdelivr/, (r) => r.abort());
  return page;
}
const shot = async (page, name) => { await page.waitForTimeout(350); return page.screenshot({ path: path.join(OUT, name + ".png") }); };
const check = (cond, msg) => { if (!cond) errors.push("CHECK FAILED: " + msg); else console.log("ok -", msg); };

const p = await phone();
await p.goto("http://localhost:5178/");
await p.waitForSelector(".row");
check((await p.textContent("#count")).includes("713 records"), "header counts 713 owned");
check((await p.textContent("#count")).includes("2 wanted"), "header counts 2 wanted");
await shot(p, "01-home");

// Person search: player on someone else's album + leader
await p.fill("#q", "dannie richmond"); await p.waitForTimeout(250);
await shot(p, "02-search-person");
check(await p.locator(".person-row").count() >= 1, "person result for Dannie Richmond");
await p.click(".person-row");
await p.waitForSelector(".person-name");
const personText = await p.textContent(".person");
check(personText.includes("Drums"), "person page shows instrument");
check(personText.includes("Mingus Ah Um") && personText.includes("Want"), "want-list record shows up on person page with Want tag");
await shot(p, "03-person");
await p.click("button[data-close]"); await p.waitForTimeout(200);

await p.fill("#q", "jaki byard"); await p.waitForTimeout(250);
await p.click(".person-row"); await p.waitForSelector(".person-name");
check((await p.textContent(".person")).includes("Piano"), "Jaki Byard as pianist on Mingus record");
await p.click("button[data-close]"); await p.waitForTimeout(200);

// Leader view
await p.fill("#q", "charles mingus"); await p.waitForTimeout(250);
await p.click(".person-row"); await p.waitForSelector(".person-name");
check((await p.textContent(".person")).includes("Their records"), "Mingus page groups his own records");
const leadSection = p.locator(".person section").filter({ hasText: "Their records" });
check(await leadSection.locator(".row").count() > 0 && await leadSection.locator(".row-extra").count() === 0, "his own records show no role line");
await shot(p, "04-person-leader");
await p.click("button[data-close]"); await p.waitForTimeout(200);

// Song search
await p.fill("#q", "pork pie"); await p.waitForTimeout(250);
check((await p.textContent("#results")).includes("Goodbye Pork Pie Hat"), "song search finds track");
await shot(p, "05-search-song");

// Genre / title search
await p.fill("#q", "black saint"); await p.waitForTimeout(250);
await p.click("#results .row");
await p.waitForSelector(".album-title");
await shot(p, "06-album");
await p.locator(".panel").evaluate((el) => el.scrollTo(0, 600));
await shot(p, "07-album-credits");
// For sale toggle
await p.click(".switch-row");
await p.waitForTimeout(200);
await p.click("button[data-close]"); await p.waitForTimeout(200);
await p.fill("#q", ""); await p.click('[data-status="sale"]'); await p.waitForTimeout(200);
check((await p.textContent("#results")).includes("The Black Saint"), "for-sale filter shows newly marked record");
await shot(p, "08-for-sale");

// Want list add
await p.click('[data-status="want"]'); await p.waitForTimeout(150);
await p.click('a.fab[href="#/add"]'); await p.waitForSelector("#add-form");
await p.fill('input[name="artist"]', "Yusef Lateef");
await p.fill('input[name="title"]', "Eastern Sounds");
await shot(p, "09-add");
await p.click("#add-submit"); await p.waitForSelector(".album-title");
check((await p.textContent(".album-title")) === "Eastern Sounds", "new want opens its record page");
await p.click("button[data-close]"); await p.waitForTimeout(300);
check((await p.textContent("#results")).includes("Eastern Sounds"), "new want shows in want list");
check((await p.textContent("#count")).includes("3 wanted"), "want count updates");
await shot(p, "10-want-list");

// Want item in regular search
await p.click('[data-status="all"]');
await p.fill("#q", "mingus"); await p.waitForTimeout(250);
await shot(p, "11-search-mixed");
await p.click(".row:has-text('Mingus Ah Um')"); await p.waitForSelector(".status-block.want");
await shot(p, "12-want-album");
await p.click("#got-it"); await p.waitForTimeout(250);
check(await p.locator(".switch-row").count() === 1, "moved to collection shows for-sale switch");
await p.click("button[data-close]");

// Persistence after reload
await p.reload(); await p.waitForSelector(".row");
check((await p.textContent("#count")).includes("714 records"), "changes persist after reload");

// Grid + no-results + tools
await p.fill("#q", ""); await p.click("#view-toggle"); await p.waitForTimeout(200);
await shot(p, "13-grid");
await p.fill("#q", "zzqx nothing"); await p.waitForTimeout(250);
check((await p.textContent("#results")).includes("Add “zzqx nothing”"), "empty search offers want-list add");
await shot(p, "14-empty");
await p.goto("http://localhost:5178/#/tools"); await p.waitForSelector(".stats");
await shot(p, "15-tools");

// Dark mode
const d = await phone("dark");
await d.goto("http://localhost:5178/"); await d.waitForSelector(".row");
await d.fill("#q", "mingus"); await d.waitForTimeout(250);
await shot(d, "16-dark-search");
await d.click(".row:has-text('Black Saint')"); await d.waitForSelector(".album-title");
await shot(d, "17-dark-album");

// Desktop
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const w = await ctx.newPage(); w.on("pageerror", (e) => errors.push(e.message));
await w.route(/fonts\.(googleapis|gstatic)\.com|jsdelivr/, (r) => r.abort());
await w.goto("http://localhost:5178/#/album/" + mingus.id); await w.waitForSelector(".album-title");
await w.screenshot({ path: path.join(OUT, "18-desktop-album.png") });

console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await browser.close(); server.close();
