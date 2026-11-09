// Walkthrough of crates in demo mode. Run: node tests/browser-crates.mjs <outdir>
import { createRequire } from "node:module";
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const req = createRequire("/opt/npm-tools/node_modules/");
const { chromium } = req("playwright");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ROOT = new URL("../public/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((rq, res) => {
  const u = new URL(rq.url, "http://x");
  if (u.pathname.startsWith("/api/")) { res.writeHead(404); return res.end(); }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f));
}).listen(5181);

const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const p = await ctx.newPage();
p.on("pageerror", (e) => errors.push(e.message));
p.on("console", (m) => { if (m.type() === "error" && !/fonts|Failed to load resource/.test(m.text())) errors.push(m.text()); });
await p.route(/fonts\.|jsdelivr/, (r) => r.abort());
const shot = async (n) => { await p.waitForTimeout(350); await p.screenshot({ path: path.join(OUT, n + ".png") }); };
const dialogs = [];
p.on("dialog", async (d) => { dialogs.push(d.message()); d.type() === "prompt" ? await d.accept("Japan") : await d.accept(); });
const toastHas = (t) => p.waitForFunction((t) => document.querySelector("#toast")?.textContent.includes(t), t, { timeout: 5000 });
const BASE = "http://localhost:5181/?demo";

await p.goto(BASE); await p.waitForSelector(".row");
check(await p.locator("#crate").isHidden(), "no crate menu before any crates exist");

// select every city pop record and make a new crate
await p.fill("#q", "city pop"); await p.waitForTimeout(250);
const cityPop = await p.locator("#results a.row[data-id]").count();
await p.click("#select-toggle");
check(await p.locator("#selbar").isVisible() && await p.locator(".fab").isHidden(), "select mode shows the selection bar instead of Add");
await p.locator("#results a.row[data-id]").first().click();
check((await p.textContent(".selcount")).includes("1 record selected"), "tapping a record selects it (doesn't open it)");
check(!(await p.evaluate(() => location.hash)), "record didn't open");
await shot("k01-selecting");
await p.click("#sel-all");
check((await p.textContent(".selcount")).includes(`${cityPop} records selected`), `select all picks the ${cityPop} results`);
await p.click("#sel-add");
await p.fill("#new-crate-name", "  Japanese ");
await shot("k02-new-crate");
await p.click("#new-crate button");
await toastHas(`Added ${cityPop} records to Japanese`);
check(await p.locator("#selbar").isHidden(), "selection ends after adding");
check((await p.textContent("#crate")).includes(`Japanese (${cityPop})`), "crate menu appears with its count");

// add one more record to the existing crate
await p.fill("#q", "kankyo"); await p.waitForTimeout(250);
await p.click("#select-toggle");
await p.locator("#results a.row[data-id]").first().click();
await p.click("#sel-add");
await p.click('[data-add-crate="Japanese"]');
await toastHas("Added 1 record to Japanese");

// filter by crate
await p.fill("#q", ""); await p.waitForTimeout(150);
await p.selectOption("#crate", "Japanese"); await p.waitForTimeout(250);
const inCrate = await p.locator("#results a.row[data-id]").count();
check(inCrate === cityPop + 1, `crate filter shows city pop and ambient together (${inCrate})`);
check((await p.textContent("#results")).includes("Kankyō Ongaku"), "ambient record is in the crate");
await shot("k03-crate-filter");

// searching the crate name finds its records
await p.selectOption("#crate", ""); await p.fill("#q", "japanese"); await p.waitForTimeout(250);
check((await p.locator("#results a.row[data-id]").count()) >= inCrate, "searching “japanese” finds the crate's records");
await p.fill("#q", "");

// record page: crates shown, remove and re-add
await p.selectOption("#crate", "Japanese"); await p.waitForTimeout(200);
await p.locator("#results a.row[data-id]").first().click(); await p.waitForSelector(".crates-block");
check(await p.locator(".crate-chip").count() === 1, "record shows its crate");
await p.locator(".crates-block").scrollIntoViewIfNeeded(); await shot("k04-record-crates");
await p.click("[data-crate-rm]"); await toastHas("Taken out of Japanese");
check(await p.locator(".crate-chip").count() === 0, "taken out of the crate");
await p.click("#crate-add-open"); await p.click('[data-crate-quick="Japanese"]'); await toastHas("Added to Japanese");
check(await p.locator(".crate-chip").count() === 1, "added back with one tap");
// tapping the crate chip filters by it
await p.click("[data-crate-go]"); await p.waitForTimeout(300);
check((await p.inputValue("#crate")) === "Japanese" && !(await p.evaluate(() => location.hash)), "crate chip opens that crate");

// add a new record while looking at the crate: crate is pre-filled
await p.click(".fab"); await p.waitForSelector("#add-form");
await p.click(".add-more summary");
check((await p.inputValue('input[name="crate"]')) === "Japanese", "new record defaults to the crate you're viewing");
await p.fill('input[name="artist"]', "Hiroshi Yoshimura"); await p.fill('input[name="title"]', "Music For Nine Post Cards");
await p.click("#add-submit"); await p.waitForSelector(".crates-block");
check((await p.textContent(".crates-block")).includes("Japanese"), "new record lands in the crate");
await p.goto(BASE); await p.waitForSelector(".row");
check((await p.textContent("#crate")).includes(`Japanese (${inCrate + 1})`), "crate count includes the new record, after reload");

// manage: rename and delete
await p.goto(BASE + "#/tools"); await p.waitForSelector(".crate-list");
await shot("k05-manage");
await p.click('[data-crate-rename="Japanese"]'); await toastHas("Renamed to Japan");
check((await p.textContent(".crate-list")).includes("Japan") && !(await p.textContent(".crate-list")).includes("Japanese"), "crate renamed everywhere");
await p.click('[data-crate-delete="Japan"]'); await toastHas("Deleted Japan");
check(dialogs.some((d) => d.includes("stay in your collection")), "delete explains records are kept");
check((await p.textContent(".tools")).includes("Crates are your own groupings"), "no crates left");
await p.goto(BASE); await p.waitForSelector(".row");
check((await p.textContent("#count")).includes("713 records, 1 wanted"), "records are kept after deleting the crate");

// grid view selection
await p.click("#view-toggle"); await p.click("#select-toggle");
await p.locator(".tile").nth(1).click(); await p.locator(".tile").nth(3).click();
check((await p.textContent(".selcount")).includes("2 records selected"), "selecting works in grid view");
await shot("k06-grid-select");
await p.click("#sel-done");

console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await b.close(); server.close();
