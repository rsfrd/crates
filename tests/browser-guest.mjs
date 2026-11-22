// What someone with the passphrase sees: everything, with changes greyed out. Run: node tests/browser-guest.mjs <outdir>
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ROOT = new URL("../public/", import.meta.url).pathname;
const FIXTURE = new URL("./fixtures/collection.json", import.meta.url).pathname;
const demo = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
Object.assign(demo[0], { discogs_id: 5, enrich_status: "matched", notes: "VG+ sleeve, paid $12", crates: ["Japanese"],
  tracks: [{ pos: "A1", title: "Song", dur: "3:00" }], credits: [{ name: "Some Player", roles: ["Bass"], tracks: [], leader: false, kind: "musician" }] });
demo.push({ ...structuredClone(demo[1]), id: "want-1", status: "want", discogs_id: 9, price: { value: 20, currency: "USD", for_sale: 3, checked_at: new Date().toISOString() } });
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const calls = [];
const srv = http.createServer((rq, res) => { const u = new URL(rq.url, "http://x");
  if (u.pathname === "/demo.json") { res.writeHead(200); return res.end(JSON.stringify(demo)); }
  if (u.pathname.startsWith("/api/")) { calls.push(u.pathname + u.search); res.writeHead(403, { "content-type": "application/json" }); return res.end('{"error":"view only"}'); }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f)); }).listen(5186);
const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })).newPage();
p.on("pageerror", (e) => errors.push(e.message));
p.on("dialog", (d) => { errors.push("unexpected dialog: " + d.message()); d.dismiss(); });
await p.route(/fonts\.|jsdelivr/, (r) => r.abort());
const BASE = "http://localhost:5186/?demo&demoapi&guest";
const stored = () => p.evaluate(() => localStorage.getItem("crate.demo.v2"));
const toastSays = (t) => p.waitForFunction((t) => document.querySelector("#toast")?.textContent.includes(t), t, { timeout: 3000 }).then(() => true, () => false);

await p.goto(BASE); await p.waitForSelector(".row");
const before = await stored();
check((await p.textContent("#count")).includes("view only"), "header says view only");
check(await p.getAttribute('a.fab[href="#/add"]', "aria-disabled") === "true" && await p.getAttribute("#select-toggle", "aria-disabled") === "true", "Add and Select are greyed out");
await p.click('a.fab[href="#/add"]', { force: true });
check(await toastSays("view-only copy") && !(await p.evaluate(() => location.hash)), "tapping Add explains and doesn’t open it");
await p.click("#select-toggle", { force: true });
check(await p.locator("#selbar").isHidden(), "Select doesn’t start");
await p.screenshot({ path: path.join(OUT, "g01-home.png") });

// search, person pages and Pick for me all work
await p.fill("#q", "some player"); await p.waitForTimeout(250);
await p.click(".person-row"); await p.waitForSelector(".person-name");
check(true, "person page opens");
await p.goto(BASE + "#/pick"); await p.waitForSelector(".pick-card");
await p.click("#pick-again"); await p.waitForTimeout(800);
check(await p.locator(".pick-card").count() === 1, "Pick for me works for guests");

// a record: visible, notes shown, every change greyed
await p.goto(BASE + "#/album/" + demo[0].id); await p.waitForSelector(".album-title");
check((await p.inputValue("#notes")).includes("VG+"), "notes are visible");
for (const sel of ["#for-sale", "#notes", "#cover-find", "#cover-own", "#crate-add-open", "[data-crate-rm]", "#fix-open", "#refresh", "#edit-open", "#delete"]) {
  check(await p.getAttribute(sel, "aria-disabled") === "true", `${sel} greyed`);
}
await p.click(".switch-row", { force: true });
check(await toastSays("view-only") && !(await p.isChecked("#for-sale")), "For sale can’t be switched");
await p.click("#edit-open", { force: true }); check(!(await p.locator("#edit-form").count()), "Edit details doesn’t open");
await p.click("#delete", { force: true }); check(!(await p.locator(".album-title").count()) === false, "Delete does nothing (no dialog)");
await p.click("[data-crate-rm]", { force: true }); check((await p.locator(".crate-chip").count()) === 1, "crate stays");
await p.locator("#notes").focus().catch(() => {}); await p.keyboard.type("guest typing");
check((await p.inputValue("#notes")).includes("VG+"), "notes can’t be typed in");
await p.locator(".crates-block").scrollIntoViewIfNeeded();
await p.screenshot({ path: path.join(OUT, "g02-record.png") });

// want list: price shown, no automatic price check
await p.goto(BASE + "#/album/want-1"); await p.waitForSelector(".price-block"); await p.waitForTimeout(600);
check((await p.textContent(".price-block")).includes("$20.00") && !calls.some((c) => !c.startsWith("/api/config")), "prices show, but guests trigger no lookups");
check(await p.getAttribute('.price-links a:has-text("US sellers")', "aria-disabled") === null, "marketplace links still work");

// Collection screen: tools greyed, export and sign-out still there
await p.goto(BASE + "#/tools"); await p.waitForSelector(".stat-strip");
check(await p.locator("#export").getAttribute("aria-disabled") === null, "CSV download still works");
await p.screenshot({ path: path.join(OUT, "g03-tools.png") });

check((await stored()) === before, "nothing was changed");
console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await b.close(); srv.close();
