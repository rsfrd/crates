// Checks nothing on a record page is wider than the screen. Run: node tests/browser-layout.mjs <outdir>
import { createRequire } from "node:module"; import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const { chromium } = createRequire("/opt/npm-tools/node_modules/")("playwright");
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const ROOT = new URL("../public/", import.meta.url).pathname;
const demo = JSON.parse(fs.readFileSync(new URL("./fixtures/collection.json", import.meta.url).pathname, "utf8"));
// A record with the kinds of credits that used to overflow.
Object.assign(demo[0], {
  title: "Supercalifragilisticexpialidociousnessesandmorewithoutspaces Live", artist: "The Extremely Long Ensemble Name Orchestra And Chorus Of The Somewhere State Opera",
  discogs_id: 1, enrich_status: "matched", catno: "VERY-LONG-CATALOGUE-NUMBER-WITHOUT-SPACES-0001",
  tracks: [{ pos: "A1", title: "Concerto For Oboe And Orchestra In C, K. 314 (Allegro Aperto - Adagio Non Troppo - Rondo: Allegretto)", dur: "21:30", by: "Wolfgang Amadeus Mozart", note: "Cadenza: Raymond Meylan; Arranged By: Somebodywithaverylongname Withoutbreaks" },
           { pos: "A2", title: "Averyveryveryverylongtracktitlewithnospacesatallthatgoesonandon", dur: "3:00" }],
  credits: [
    { name: "Bert Lucarelli", roles: ["Oboe"], tracks: [], leader: true, kind: "musician" },
    { name: "Hieronymus Bartholomew Fitzgerald-Montgomery Worthington III", roles: ["Tenor Saxophone", "Soprano Saxophone", "Alto Clarinet", "Bass Clarinet", "Flute", "Piccolo Flute"], tracks: ["A1", "A3", "B1", "B2", "B4", "C1", "C2", "D1"], leader: false, kind: "musician" },
    { name: "Someone", roles: ["Percussion (Congas, Bongos, Timbales, Shaker, Triangle, Cabasa, Guiro, Claves, Woodblock)"], tracks: [], leader: false, kind: "musician" },
    { name: "Wolfgang Amadeus Mozart", roles: ["Composed By"], tracks: ["A1", "B1"], leader: false, kind: "credit" },
    { name: "A Producer", roles: ["Producer (Executive, Supervising, Remastered For The Deluxe Anniversary Edition)"], tracks: [], leader: false, kind: "credit" },
  ],
});
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const srv = http.createServer((rq, res) => { const u = new URL(rq.url, "http://x");
  if (u.pathname === "/demo.json") { res.writeHead(200); return res.end(JSON.stringify(demo)); }
  const f = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
  if (u.pathname.startsWith("/api/") || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(f)] || "text/plain" }); res.end(fs.readFileSync(f)); }).listen(5183);
const errors = [];
const check = (c, m) => (c ? console.log("ok -", m) : errors.push("CHECK FAILED: " + m));
const b = await chromium.launch({ executablePath: "/usr/bin/google-chrome" });
for (const width of [320, 390, 430, 768]) {
  const p = await (await b.newContext({ viewport: { width, height: 800 }, deviceScaleFactor: 2, isMobile: width < 700, hasTouch: true })).newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.route(/fonts\.|jsdelivr/, (r) => r.abort());
  for (const [what, hash] of [["record", `#/album/${demo[0].id}`], ["person", "#/person/hieronymus-bartholomew-fitzgerald-montgomery-worthington-iii"]]) {
    await p.goto(`http://localhost:5183/?demo${hash}`); await p.waitForSelector(what === "record" ? ".credits" : ".person-name"); await p.waitForTimeout(300);
    const r = await p.evaluate(() => {
      const panel = document.querySelector(".panel");
      const box = panel.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(panel).paddingRight);
      const over = [...panel.querySelectorAll("*")].filter((el) => { const rr = el.getBoundingClientRect(); return rr.width && rr.right > box.right - pad + 1; })
        .filter((el) => !el.closest(".panel-bar")).map((el) => el.className || el.tagName).slice(0, 5);
      return { scroll: panel.scrollWidth - panel.clientWidth, page: document.documentElement.scrollWidth - innerWidth, over };
    });
    check(r.scroll <= 0 && r.page <= 0 && !r.over.length, `${what} at ${width}px: nothing wider than the screen${r.over.length ? " — " + r.over.join(", ") : ""}`);
    if (what === "record") { await p.locator(".tracks").scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}/layout-${width}-tracks.png` }); await p.locator(".credits").first().scrollIntoViewIfNeeded(); await p.screenshot({ path: `${OUT}/layout-${width}.png` }); }
  }
}
console.log(errors.length ? "\nERRORS:\n" + errors.join("\n") : "\nno errors");
await b.close(); srv.close();
