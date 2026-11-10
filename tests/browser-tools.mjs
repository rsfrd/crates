// The Collection page (titled sections on cards) and "It's fine as it is". Run: node tests/browser-tools.mjs <outdir>
import { createRequire } from "node:module";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ROOT = new URL("../public/", import.meta.url).pathname;

// The real collection, mostly fetched, with one record not found, one to check, three to fetch and a crate.
const albums = JSON.parse(fs.readFileSync(new URL("./fixtures/collection.json", import.meta.url)));
albums.forEach((a, i) => {
  a.enrich_status = a.id === "r0064" ? "not_found" : a.id === "r0005" ? "review" : i > 700 ? "pending" : "matched";
  if (/^(Casiopea|Mariya Takeuchi|Tatsuro Yamashita|Taeko Ohnuki)/.test(a.artist)) a.crates = ["japanese"];
  if (/^(Arvo Pärt)/.test(a.artist)) a.crates = ["late night"];
});
const demo = JSON.stringify(albums);

const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((rq, res) => {
  const u = new URL(rq.url, "http://x");
  if (u.pathname === "/demo.json") { res.writeHead(200, { "content-type": "application/json" }); return res.end(demo); }
  // Lookups answer slowly with "not found", so a run can be watched and stopped.
  if (u.pathname === "/api/discogs") { setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end('{"release":null}'); }, 1500); return; }
  if (u.pathname.startsWith("/api/")) { res.writeHead(404); return res.end(); }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f));
}).listen(5189);

const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });

async function page(colorScheme, query = "") {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/fonts\.|jsdelivr/, (r) => r.abort());
  await p.goto("http://localhost:5189/?demo&demoapi" + query + "#/tools"); await p.waitForSelector(".sec");
  return p;
}
const box = (p, sel) => p.locator(sel).boundingBox();
const toastHas = (p, t) => p.waitForFunction((t) => document.querySelector("#toast")?.textContent.includes(t), t, { timeout: 4000 }).then(() => true, () => false);

const p = await page("light");
const heads = await p.locator(".sec-head h3").allTextContents();
check(heads.join("|") === "Album details|Needs a look|Want-list prices|Crates|Add records|Backup", "sections in order: " + heads.join(", "));
check((await p.textContent(".tools-sub")).includes("records") && (await p.textContent(".tools-sub")).includes("2 crates"), "summary line under the title");
check((await p.locator(".stat-strip .warn").count()) === 2, "Check and Not found stand out when above zero");

// alignment: the two import tiles match, crate buttons line up, row buttons share one width
await p.waitForTimeout(500); // let the panel finish sliding in
const [t1, t2] = await p.$$eval(".import-tile", (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; }));
check(Math.abs(t1.y - t2.y) < 1 && Math.abs(t1.height - t2.height) < 1 && Math.abs(t1.width - t2.width) < 1, "import tiles are the same size and aligned: " + JSON.stringify([t1, t2]));
const crateRows = p.locator(".crate-list li");
for (let i = 0; i < await crateRows.count(); i++) {
  const [r, d] = [await box(p, `.crate-list li >> nth=${i} >> [data-crate-rename]`), await box(p, `.crate-list li >> nth=${i} >> [data-crate-delete]`)];
  check(Math.abs(r.y - d.y) < 1 && r.width === 44 && d.width === 44, `crate ${i + 1}: rename and delete line up`);
}
const rx = await box(p, ".crate-list li >> nth=0 >> [data-crate-rename]"), rx2 = await box(p, ".crate-list li >> nth=1 >> [data-crate-rename]");
check(Math.abs(rx.x - rx2.x) < 1, "crate buttons line up from row to row");
const widths = await p.locator(".card-row > .btn").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
check(widths.length >= 2 && widths.every((w) => w === widths[0]), "action buttons share one width: " + widths.join(","));
const btnRows = await p.locator(".card-row:has(> .btn)").evaluateAll((els) => els.map((r) => { const b = r.querySelector(".btn").getBoundingClientRect(), c = r.getBoundingClientRect(); return Math.round(c.right - b.right); }));
check(btnRows.every((x) => x === btnRows[0]), "and sit at the same right edge");
check(await p.evaluate(() => document.documentElement.scrollWidth <= 390), "no sideways scroll on a phone");
await p.screenshot({ path: path.join(OUT, "t01-light-top.png") });
await p.setViewportSize({ width: 390, height: 1900 }); await p.waitForTimeout(300);
await p.screenshot({ path: path.join(OUT, "t02-light-full.png") });
await p.setViewportSize({ width: 390, height: 844 });

// actions still work
await p.click("[data-crate-open='late night']"); await p.waitForTimeout(300);
check(!(await p.evaluate(() => location.hash.includes("tools"))), "tapping a crate opens it");
await p.goto("http://localhost:5189/?demo&demoapi#/tools"); await p.waitForSelector(".sec");
await p.click("#retry"); await p.waitForTimeout(500);
check(await p.locator(".progress").count() === 1 && await p.locator("#stop").count() === 1, "Try again shows progress with Stop in the card");
await p.screenshot({ path: path.join(OUT, "t03-running.png") });
await p.click("#stop"); await p.waitForTimeout(600);

// "It's fine as it is" on the record Discogs doesn't have
await p.goto("http://localhost:5189/?demo&demoapi#/album/r0064"); await p.waitForSelector(".album-title");
check((await p.textContent("#keep-as-is")) === "It's fine as it is", "a not-found record offers It's fine as it is");
await p.screenshot({ path: path.join(OUT, "t04-keep.png") });
await p.click("#keep-as-is");
check(await toastHas(p, "Kept as it is"), "it says it's kept");
check(await p.locator("#keep-as-is").count() === 0 && await p.locator(".keep-note").count() === 0, "the warning goes away");
await p.goto("http://localhost:5189/?demo&demoapi#/tools"); await p.waitForSelector(".sec");
const rowsInLook = await p.locator(".card-list .row").allTextContents();
check(!rowsInLook.some((t) => t.includes("Brian Noyes")) && rowsInLook.length === 1, "it's left Needs a look");
check(await p.locator("#retry").count() === 0, "and isn't retried");
const doneCount = Number(await p.locator(".stat-strip div >> nth=0 >> dd").textContent());
check(doneCount === 700, "it counts as done: " + doneCount);
// confirming a possible match
await p.goto("http://localhost:5189/?demo&demoapi#/album/r0005"); await p.waitForSelector(".album-title");
check((await p.textContent("#keep-as-is")) === "The match is right", "a possible match offers The match is right");
await p.click("#keep-as-is"); check(await toastHas(p, "Match confirmed"), "and confirms it");
await p.goto("http://localhost:5189/?demo&demoapi#/tools"); await p.waitForSelector(".sec");
check(!(await p.locator(".sec-head h3", { hasText: "Needs a look" }).count()), "Needs a look disappears once it's empty");
// after a reload it stays kept (saved in the demo store)
await p.reload(); await p.waitForSelector(".sec");
check(!(await p.locator(".sec-head h3", { hasText: "Needs a look" }).count()), "and stays that way after a reload");

// dark
const d = await page("dark");
await d.setViewportSize({ width: 390, height: 1900 }); await d.waitForTimeout(300);
await d.screenshot({ path: path.join(OUT, "t05-dark-full.png") });

// guests: everything greyed but the download, and keep-as-is is greyed too
const g = await page("light", "&guest");
check(await g.getAttribute("[data-import] >> nth=0", "aria-disabled") === "true" && await g.getAttribute("[data-crate-delete] >> nth=0", "aria-disabled") === "true", "guests see imports and crate buttons greyed");
check(await g.getAttribute("#export", "aria-disabled") === null, "guests can still download");
await g.setViewportSize({ width: 390, height: 1900 }); await g.waitForTimeout(300);
await g.screenshot({ path: path.join(OUT, "t06-guest.png") });
await g.goto("http://localhost:5189/?demo&demoapi&guest#/album/r0064"); await g.waitForSelector("#keep-as-is");
check(await g.getAttribute("#keep-as-is", "aria-disabled") === "true", "guests can't mark a record as fine");

console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await b.close(); server.close();
