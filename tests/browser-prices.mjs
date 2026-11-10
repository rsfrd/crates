// Want-list prices with a fake Discogs. Run: node tests/browser-prices.mjs <outdir>
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ROOT = new URL("../public/", import.meta.url).pathname;
const demo = JSON.parse(fs.readFileSync(new URL("./fixtures/collection.json", import.meta.url).pathname, "utf8"));
const hoursAgo = (h) => new Date(Date.now() - h * 3600e3).toISOString();
const want = (id, title, extra) => ({ ...structuredClone(demo[5]), id, title, artist: "Charles Mingus", status: "want", enrich_status: "matched", tracks: [], credits: [], crates: [], created_at: hoursAgo(30), ...extra });
demo.push(
  want("w-new", "Mingus Ah Um", { discogs_id: 500 }),                                                         // never checked
  want("w-old", "Blues & Roots", { discogs_id: 501, master_id: 88, price: { value: 40, currency: "USD", for_sale: 2, checked_at: hoursAgo(48) } }), // stale
  want("w-fresh", "Oh Yeah", { discogs_id: 502, master_id: 89, price: { value: 18.25, currency: "USD", for_sale: 9, checked_at: hoursAgo(1) } }), // fresh
  want("w-fail", "Tijuana Moods", { discogs_id: 503 }),                                                        // lookup fails
  want("w-cd", "Mingus Dynasty", { discogs_id: 504, master_id: 90 }),                                         // matched to a CD
  want("w-bc", "Bandcamp Only", { discogs_id: null, discogs_url: "https://x.bandcamp.com/album/y" }),         // not on Discogs
);
Object.assign(demo[6], { discogs_id: 600, enrich_status: "matched" });                                        // an owned record
const calls = [];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const srv = http.createServer(async (rq, res) => {
  const u = new URL(rq.url, "http://x");
  const send = (c, b) => { res.writeHead(c, { "content-type": "application/json" }); res.end(JSON.stringify(b)); };
  if (u.pathname === "/demo.json") return send(200, demo);
  if (u.pathname === "/api/discogs" && u.searchParams.get("op") === "price") {
    const id = u.searchParams.get("id"); calls.push(`${id}${u.searchParams.get("master") === "1" ? "+master" : ""}${u.searchParams.get("fmt") === "1" ? "+fmt" : ""}`);
    const fmt = u.searchParams.get("fmt") === "1" ? (id === "504" ? { vinyl: false, format: "CD, Album" } : { vinyl: true, format: "Vinyl, LP, Album" }) : { vinyl: null, format: null };
    await new Promise((r) => setTimeout(r, 400));
    if (id === "500") return send(200, { price: { value: 31.5, currency: "USD", for_sale: 4, blocked: false, master_id: 77, ...fmt }, rateRemaining: 50 });
    if (id === "501") return send(200, { price: { value: null, currency: "USD", for_sale: 0, blocked: false, master_id: null, ...fmt }, rateRemaining: 50 });
    if (id === "502") return send(200, { price: { value: 17, currency: "USD", for_sale: 10, blocked: false, master_id: null, ...fmt }, rateRemaining: 50 });
    if (id === "504") return send(200, { price: { value: 9.99, currency: "USD", for_sale: 40, blocked: false, master_id: null, ...fmt }, rateRemaining: 50 });
    return send(502, { error: "Discogs 500 on /marketplace/stats/503" });
  }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (u.pathname.startsWith("/api/") || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f));
}).listen(5184);

const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.route(/fonts\.|jsdelivr/, (r) => r.abort());
const BASE = "http://localhost:5184/?demo&demoapi";
const open = async (id) => { await p.goto(`${BASE}#/album/${id}`); await p.waitForSelector(".album-title"); };

// never checked: checks on open, shows price, links to all vinyl pressings
await open("w-new");
check((await p.textContent(".price-block")).includes("Checking Discogs"), "a new want shows it's checking");
await p.waitForFunction(() => document.querySelector(".price-line strong")?.textContent.includes("$31.50"), null, { timeout: 5000 });
const pb = await p.textContent(".price-block");
check(pb.includes("4 copies of this pressing for sale") && pb.includes("before shipping"), "price is labelled: copies for sale, before shipping");
const us = await p.getAttribute('.price-links a:has-text("US sellers")', "href");
const all = await p.getAttribute('.price-links a:has-text("All sellers")', "href");
const others = await p.getAttribute('.price-links a:has-text("Other pressings")', "href");
check(us.includes("/sell/release/500") && us.includes("ships_from=United+States") && us.includes("sort=price%2Casc"), "US sellers: this pressing, US sellers, cheapest first");
check(all.includes("/sell/release/500") && !all.includes("ships_from"), "All sellers: this pressing, worldwide (where the price comes from)");
check(others.includes("master_id=77") && others.includes("format=Vinyl"), "Other pressings: every vinyl version of the album");
check(calls.includes("500+master+fmt"), "first check also learns the album family and that it's vinyl");
await p.locator(".price-block").scrollIntoViewIfNeeded(); await p.waitForTimeout(300);
await p.screenshot({ path: path.join(OUT, "p01-price.png") });

// stale price refreshes; none for sale
await open("w-old");
await p.waitForFunction(() => document.querySelector(".price-block")?.textContent.includes("No copies"), null, { timeout: 5000 });
check(calls.some((c) => c.startsWith("501")), "a two-day-old price refreshes on open");
check((await p.getAttribute('.price-links a:has-text("Other pressings")', "href")).includes("master_id=88") && (await p.getAttribute('.price-links a:has-text("All sellers")', "href")).includes("/sell/release/501"), "links still work when nothing is for sale");
check(calls.includes("501+fmt"), "an older price learns whether its pressing is vinyl");

// fresh price: no call
const before = calls.length;
await open("w-fresh"); await p.waitForTimeout(800);
check(calls.length === before && (await p.textContent(".price-line")).includes("$18.25"), "a price checked an hour ago is shown without asking again");
check((await p.textContent(".price-note")).includes("Price checked an hour ago"), "says when it was checked");
await p.click("#price-refresh");
await p.waitForFunction(() => document.querySelector(".price-line strong")?.textContent.includes("$17.00"), null, { timeout: 5000 });
check(true, "Check again updates it");

// failure: one try, a clear message, no retry loop
await open("w-fail");
await p.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Couldn't check the price"), null, { timeout: 5000 });
await p.waitForTimeout(1500);
check(calls.filter((c) => c.startsWith("503")).length === 1, "a failed check isn't retried over and over");
check(await p.locator(".price-links a").count() === 2, "links are still offered when the price check fails");

// matched to a CD: no price, a note, and it lands in Needs a look
await open("w-cd");
await p.waitForFunction(() => document.querySelector(".price-block .note.warn"), null, { timeout: 5000 });
const cdBlock = await p.textContent(".price-block");
check(cdBlock.includes("isn't a vinyl pressing (CD)") && !cdBlock.includes("$9.99"), "a CD match shows no price, and says so");
check(!(await p.locator('.price-links a:has-text("All sellers")').count()) && (await p.getAttribute('.price-links a:has-text("Other pressings")', "href")).includes("master_id=90"), "only the vinyl pressings link is offered");
await p.locator(".price-block").scrollIntoViewIfNeeded(); await p.waitForTimeout(200);
await p.screenshot({ path: path.join(OUT, "p03-cd.png") });
await p.goto(BASE + "#/tools"); await p.waitForSelector(".sec");
check((await p.textContent(".card-list")).includes("Mingus Dynasty") && (await p.textContent(".card-list")).includes("Not vinyl"), "it's listed under Needs a look as Not vinyl");
await p.goto(BASE); await p.waitForSelector(".row");
await p.click('[data-status="want"]'); await p.waitForTimeout(250);
check(!(await p.textContent("#results")).includes("$9.99"), "and shows no price in the want list");

// not on Discogs, and owned records: no price section
await open("w-bc"); check(!(await p.locator(".price-block").count()), "no price section for a want that isn't on Discogs");
await open(demo[6].id); check(!(await p.locator(".price-block").count()), "no price section for records you own");

// want list shows prices at a glance
await p.goto(BASE); await p.waitForSelector(".row");
await p.click('[data-status="want"]'); await p.waitForTimeout(250);
const list = await p.textContent("#results");
check(list.includes("$31.50") && list.includes("$17.00"), "want list rows show the price");
await p.screenshot({ path: path.join(OUT, "p02-want-list.png") });

// bulk refresh
const n0 = calls.length;
await p.goto(BASE + "#/tools"); await p.waitForSelector("#prices-all");
check((await p.textContent(".card-row:has(#prices-all)")).includes("5 wanted records on Discogs"), "Collection offers a bulk refresh for the 5 wants on Discogs");
await p.click("#prices-all");
await p.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Prices updated"), null, { timeout: 20000 });
const bulk = calls.slice(n0);
check(bulk.length === 5, "bulk refresh checks each want once");
check(!bulk.some((c) => c.includes("+fmt") && !c.startsWith("503")), "and doesn't ask the format again for pressings it already knows: " + bulk.join(", "));
await p.click('[data-status="all"]').catch(() => {});

console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await b.close(); srv.close();
