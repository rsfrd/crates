// Filing order and "File under". Run: node tests/browser-sorting.mjs <outdir>
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ROOT = new URL("../public/", import.meta.url).pathname;
const demo = JSON.parse(fs.readFileSync(ROOT + "demo.json", "utf8"));
// As after Discogs: Zappa and Hubbard credited individually.
for (const r of demo) {
  if (r.artist.startsWith("Frank Zappa")) r.credits = [{ name: "Frank Zappa", roles: ["Guitar", "Vocals"], tracks: [], leader: true, kind: "musician" }];
  if (r.artist === "Freddie Hubbard") r.credits = [{ name: "Freddie Hubbard", roles: ["Trumpet"], tracks: [], leader: true, kind: "musician" }];
}
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const srv = http.createServer((rq, res) => { const u = new URL(rq.url, "http://x");
  if (u.pathname === "/demo.json") { res.writeHead(200); return res.end(JSON.stringify(demo)); }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (u.pathname.startsWith("/api/") || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f)); }).listen(5185);
const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
const p = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
p.on("pageerror", (e) => errors.push(e.message));
await p.route(/fonts\.|jsdelivr/, (r) => r.abort());
await p.goto("http://localhost:5185/?demo"); await p.waitForSelector(".row");
const artists = () => p.$$eval("#results a.row[data-id] .row-sub", (els) => els.map((e) => e.textContent.replace(/, \d{4}$/, "")));
let list = await artists();
const at = (n) => list.findIndex((a) => a === n);
const near = (n) => list.slice(Math.max(0, at(n) - 2), at(n) + 3).join(" | ");
check(list[at("Frank Zappa") - 1] === "Lester Young" && list.at(-1) === "Warren Zevon", `Frank Zappa files under Z, between Young and Zevon (${near("Frank Zappa")})`);
check(list.findIndex((a) => a.startsWith("Frank Zappa & The Mothers")) > at("Lester Young"), "Frank Zappa & The Mothers files with Zappa");
const hub = at("Freddie Hubbard");
check(list[hub - 1] === "Hot Hot Heat", `Freddie Hubbard files under H, right after Hot Hot Heat (${near("Freddie Hubbard")})`);
check(at("Freddie Hubbard") < at("Charles Mingus") && at("Freddie Hubbard") < at("Dinah Washington"), "Hubbard comes before Mingus and Washington");
// File under: put Hubbard under "Freddie", then back
await p.locator('#results a.row[data-id]:has-text("Freddie Hubbard")').first().click(); await p.waitForSelector(".album-title");
await p.click("#edit-open");
check((await p.getAttribute('input[name="sort_as"]', "placeholder")) === "Hubbard", "File under shows where it files now (Hubbard)");
await p.fill('input[name="sort_as"]', "Freddie");
await p.click('#edit-form button[type="submit"]');
await p.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Filed under"), null, { timeout: 5000 });
await p.click("button[data-close]"); await p.waitForTimeout(300);
list = await artists();
const fi = at("Freddie Hubbard");
check(list[fi - 1] === "Foxwarren", `with File under “Freddie” it moves to F, after Foxwarren (${near("Freddie Hubbard")})`);
await p.reload(); await p.waitForSelector(".row"); list = await artists();
check(Math.abs(at("Freddie Hubbard") - fi) <= 1, "File under is kept after reload");
await p.locator('#results a.row[data-id]:has-text("Freddie Hubbard")').first().click(); await p.waitForSelector(".album-title");
await p.click("#edit-open"); await p.fill('input[name="sort_as"]', ""); await p.click('#edit-form button[type="submit"]');
await p.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("by surname"), null, { timeout: 5000 });
await p.click("button[data-close]"); await p.waitForTimeout(300); list = await artists();
check(at("Freddie Hubbard") === hub, "clearing it files by surname again");
console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await b.close(); srv.close();
