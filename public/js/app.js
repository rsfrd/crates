import { createStore, cache, outbox } from "./store.js";
import { buildIndex, search, personKey, roleLabel, creditsFor, fold } from "./search.js";

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ESC[c]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pref = {
  get(k, d) { try { return localStorage.getItem("crate." + k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("crate." + k, v); } catch {} },
};
function hue(s) { let h = 0; for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
const plural = (n, one, many = one + "s") => `${n.toLocaleString()} ${n === 1 ? one : many}`;

const ICON = {
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>',
  grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5"/><rect x="13.5" y="4" width="6.5" height="6.5"/><rect x="4" y="13.5" width="6.5" height="6.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5"/></svg>',
  tools: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/></svg>',
  // Hollow record = not on the shelf yet
  want: '<svg viewBox="0 0 16 16" aria-hidden="true" class="glyph"><circle cx="8" cy="8" r="6.25" fill="none" stroke-dasharray="2.2 1.6"/><circle cx="8" cy="8" r="1.4" fill="none"/></svg>',
};

// ---------- state ----------
const state = {
  store: null,
  albums: [],
  index: { list: [], people: new Map(), genres: [] },
  q: "",
  status: pref.get("status", "all"),
  genre: "",
  view: pref.get("view", "list"),
  enrich: { running: false, stop: false, done: 0, total: 0, current: "", note: "" },
  editing: false,
  fix: null, // { albumId, candidates, busy, error }
  cover: null, // { albumId, images, busy, error, note }
  lookingUp: new Set(), // album ids whose details are being fetched right now
};

function setAlbums(rows) {
  state.albums = rows;
  state.index = buildIndex(rows);
  if (state.store?.mode === "live") cache.set(rows.filter((r) => !r._pending));
}
const byId = (id) => state.albums.find((a) => a.id === id);

function replaceAlbum(row) {
  setAlbums(state.albums.map((a) => (a.id === row.id ? row : a)));
}

async function updateAlbum(id, patch) {
  const before = byId(id);
  replaceAlbum({ ...before, ...patch });           // optimistic
  renderAll();
  try {
    const saved = await state.store.update(id, patch);
    replaceAlbum(saved);
    return saved;
  } catch (e) {
    replaceAlbum(before);
    renderAll();
    toast(e.message || "Couldn't save that change. Check your connection and try again.");
    throw e;
  }
}

// ---------- shared pieces ----------
function thumb(a, cls = "") {
  const want = a.status === "want" ? " is-want" : "";
  const src = cls.includes("large") ? a.cover_url || a.thumb_url : a.thumb_url || a.cover_url;
  const inner = src
    ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
    : `<span class="blank" style="--h:${hue(a.artist + a.title)}"><span class="disc"></span></span>`;
  return `<span class="thumb ${cls}${want}">${inner}${a.status === "want" ? `<span class="thumb-glyph">${ICON.want}</span>` : ""}</span>`;
}

function tags(a) {
  let t = "";
  if (a.status === "want") t += `<span class="tag tag-want">${ICON.want}Want</span>`;
  if (a.status === "owned" && a.for_sale) t += `<span class="tag tag-sale">For sale</span>`;
  if (a._pending) t += `<span class="tag">Not synced</span>`;
  return t ? `<span class="tags">${t}</span>` : "";
}

function sub(a) { return esc(a.artist) + (a.year ? `, ${a.year}` : ""); }

function row(a, extra = "") {
  return `<a class="row" href="#/album/${encodeURIComponent(a.id)}">
    ${thumb(a)}
    <span class="row-text">
      <span class="row-title">${esc(a.title)}</span>
      <span class="row-sub">${sub(a)}</span>
      ${extra ? `<span class="row-extra">${extra}</span>` : ""}
    </span>
    ${tags(a)}
  </a>`;
}

function tile(a) {
  return `<a class="tile" href="#/album/${encodeURIComponent(a.id)}">
    ${thumb(a, "tile-art")}
    <span class="tile-title">${esc(a.title)}</span>
    <span class="tile-sub">${esc(a.artist)}</span>
    ${tags(a)}
  </a>`;
}

function albumBlock(albums) {
  if (state.view === "grid") return `<div class="grid">${albums.map(tile).join("")}</div>`;
  return `<div class="rows">${albums.map((a) => row(a)).join("")}</div>`;
}

// ---------- main screen ----------
function counts() {
  let owned = 0, want = 0, sale = 0;
  for (const a of state.albums) {
    if (a.status === "want") want++; else { owned++; if (a.for_sale) sale++; }
  }
  return { owned, want, sale };
}

function renderShell() {
  $("#app").innerHTML = `
    <header class="top">
      <div class="brand">
        <h1>Garage Crates</h1>
        <p class="count" id="count"></p>
      </div>
      <div class="top-actions">
        <button class="icon-btn" id="view-toggle" aria-label="Switch layout"></button>
        <a class="icon-btn" href="#/tools" aria-label="Collection tools">${ICON.tools}</a>
      </div>
    </header>
    <div class="searchbar" role="search">
      <label class="search">
        ${ICON.search}
        <input id="q" type="search" inputmode="search" autocomplete="off" autocorrect="off" spellcheck="false"
          placeholder="Artist, album, song or player" aria-label="Search your records" value="${esc(state.q)}">
        <button class="icon-btn clear" id="clear" aria-label="Clear search" hidden>${ICON.close}</button>
      </label>
      <div class="filters">
        <div class="seg" role="radiogroup" aria-label="Show">
          ${[["all", "All"], ["owned", "Owned"], ["want", "Want"], ["sale", "For sale"]]
            .map(([v, l]) => `<button role="radio" data-status="${v}" aria-checked="${state.status === v}">${l}</button>`).join("")}
        </div>
        <select id="genre" aria-label="Genre"></select>
      </div>
    </div>
    <main id="results" aria-live="polite"></main>
    <a class="fab" href="#/add">${ICON.plus}<span>Add</span></a>
    <div id="overlay" hidden></div>
    <div id="toast" role="status" aria-live="polite"></div>`;

  const input = $("#q");
  let t;
  input.addEventListener("input", () => {
    clearTimeout(t);
    t = setTimeout(() => { state.q = input.value; renderResults(); }, 70);
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
  $("#clear").addEventListener("click", () => { input.value = ""; state.q = ""; renderResults(); input.focus(); });
  $(".seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-status]"); if (!b) return;
    state.status = b.dataset.status; pref.set("status", state.status);
    for (const x of $(".seg").children) x.setAttribute("aria-checked", x === b);
    renderResults();
  });
  $("#genre").addEventListener("change", (e) => { state.genre = e.target.value; renderResults(); });
  $("#view-toggle").addEventListener("click", () => {
    state.view = state.view === "list" ? "grid" : "list"; pref.set("view", state.view); renderResults();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); input.focus(); }
    if (e.key === "Escape" && location.hash) closeOverlay();
  });
}

function renderHeader() {
  const c = counts();
  $("#count").textContent = `${plural(c.owned, "record")}, ${c.want.toLocaleString()} wanted`;
  const sel = $("#genre");
  sel.innerHTML = `<option value="">All genres</option>` +
    state.index.genres.map((g) => `<option ${g === state.genre ? "selected" : ""}>${esc(g)}</option>`).join("");
  const vt = $("#view-toggle");
  vt.innerHTML = state.view === "list" ? ICON.grid : ICON.list;
  vt.setAttribute("aria-label", state.view === "list" ? "Show covers as a grid" : "Show as a list");
}

function renderResults() {
  const res = search(state.index, state.q, { status: state.status, genre: state.genre });
  $("#clear").hidden = !state.q;
  const el = $("#results");
  renderHeader();

  if (!res.query) {
    if (!res.albums.length) {
      el.innerHTML = emptyState(state.status === "want"
        ? "Your want list is empty. Add an album you heard and it'll be here when you're in the store."
        : state.status === "sale" ? "Nothing is marked for sale. Open a record and turn on “For sale” to queue it."
        : "Nothing here yet.");
      return;
    }
    el.innerHTML = albumBlock(res.albums);
    return;
  }

  let html = "";
  if (res.people.length) {
    html += `<section><h2>People <span>${res.people.length}</span></h2><div class="rows">` +
      res.people.map((p) => {
        const lead = p.items.filter((i) => i.leader).length;
        const plays = p.items.length - lead;
        const bits = [lead && `leader on ${lead}`, plays && `plays on ${plays}`].filter(Boolean).join(", ");
        return `<a class="row person-row" href="#/person/${encodeURIComponent(p.key)}">
          <span class="stack">${p.items.slice(0, 3).map((i) => thumb(i.album, "mini")).join("")}</span>
          <span class="row-text"><span class="row-title">${esc(p.name)}</span>
          <span class="row-sub">${plural(p.items.length, "record")}${bits ? `, ${bits}` : ""}</span></span>
        </a>`;
      }).join("") + `</div></section>`;
  }
  if (res.albums.length) html += `<section><h2>Albums <span>${res.albums.length}</span></h2>${albumBlock(res.albums)}</section>`;
  if (res.songs.length) {
    html += `<section><h2>Songs <span>${res.songs.length}</span></h2><div class="rows">` +
      res.songs.map((s) => row(s.album, s.tracks.slice(0, 3).map((t) => `<span class="pos">${esc(t.pos)}</span> ${esc(t.title)}`).join("<br>"))).join("") +
      `</div></section>`;
  }
  if (!html) {
    html = emptyState(`No matches for “${esc(state.q)}”.`, true);
  }
  el.innerHTML = html;
}

function emptyState(msg, offerAdd) {
  return `<div class="empty"><p>${msg}</p>${offerAdd ? `<a class="btn" href="#/add?q=${encodeURIComponent(state.q)}">Add “${esc(state.q)}”</a>` : ""}</div>`;
}

function renderAll() {
  renderResults();
  // Don't redraw a panel out from under someone who is typing in it.
  const active = document.activeElement;
  if (active && active.closest?.("#overlay") && /input|textarea/i.test(active.tagName)) return;
  renderOverlay();
}

// ---------- overlays ----------
let lastFocus = null;

function closeOverlay() {
  if (history.state && history.state.crate) history.back();
  else location.hash = "";
}

function openPanel(html, kind) {
  const ov = $("#overlay");
  const wasHidden = ov.hidden;
  const prev = ov.querySelector(".panel");
  const sameView = !wasHidden && prev && prev.dataset.view === location.hash;
  const scroll = sameView ? prev.scrollTop : 0;
  ov.hidden = false;
  ov.className = `overlay overlay-${kind}`;
  ov.innerHTML = `<div class="scrim" data-close></div><div class="panel${sameView ? "" : " enter"}" role="dialog" aria-modal="true" tabindex="-1">${html}</div>`;
  const panel = ov.querySelector(".panel");
  panel.dataset.view = location.hash;
  panel.scrollTop = scroll;
  document.body.classList.add("locked");
  if (wasHidden) lastFocus = document.activeElement;
  if (!sameView) panel.focus({ preventScroll: true });
  ov.querySelector("[data-close].scrim")?.addEventListener("click", closeOverlay);
  ov.querySelectorAll("button[data-close]").forEach((b) => b.addEventListener("click", closeOverlay));
  return ov.querySelector(".panel");
}

function hideOverlay() {
  const ov = $("#overlay");
  if (!ov || ov.hidden) return;
  ov.hidden = true; ov.innerHTML = "";
  document.body.classList.remove("locked");
  lastFocus?.focus?.({ preventScroll: true });
}

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const [path, qs] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "", arg: parts.slice(1).join("/"), params: new URLSearchParams(qs || "") };
}

function renderOverlay() {
  const r = route();
  if (r.name !== "album") { state.editing = false; state.fix = null; state.cover = null; }
  if (r.name === "album") return renderAlbum(r.arg);
  if (r.name === "person") return renderPerson(r.arg);
  if (r.name === "add") return renderAdd(r.params.get("q") || "");
  if (r.name === "tools") return renderTools();
  hideOverlay();
}

// ---------- album ----------
function renderAlbum(id) {
  const a = byId(id);
  if (!a) return hideOverlay();
  const credits = creditsFor(a);
  const players = credits.filter((c) => c.kind === "musician" || c.leader);
  const others = credits.filter((c) => !(c.kind === "musician" || c.leader));
  const allPos = new Set((a.tracks || []).map((t) => t.pos));
  const trackNote = (c) => c.tracks && c.tracks.length && c.tracks.length < allPos.size ? `<span class="on">on ${c.tracks.map(esc).join(", ")}</span>` : "";
  const credit = (c) => `<li><a href="#/person/${encodeURIComponent(personKey(c.name))}">
      <span class="who">${esc(c.name)}</span>
      <span class="what">${roleLabel(c).split(", ").map((r) => `<span class="r">${esc(r)}</span>`).join(", ")} ${trackNote(c)}</span></a></li>`;
  const meta = [a.year, a.label, a.catno].filter(Boolean).map(esc).join(", ");
  const canEnrich = state.store.canEnrich;

  const statusBlock = a.status === "want"
    ? `<div class="status-block want">
        <p>${ICON.want} ${a.created_at ? `Wanted since ${new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : "On your want list"}</p>
        <button class="btn primary" id="got-it">Move to collection</button>
      </div>`
    : `<label class="switch-row">
        <span><strong>For sale</strong><span class="hint">Shows up under the “For sale” filter.</span></span>
        <input type="checkbox" role="switch" id="for-sale" ${a.for_sale ? "checked" : ""}>
      </label>`;

  const edit = state.editing ? `
    <form class="edit" id="edit-form">
      <label>Artist<input name="artist" value="${esc(a.artist)}" required></label>
      <label>Album<input name="title" value="${esc(a.title)}" required></label>
      <div class="two">
        <label>Year<input name="year" inputmode="numeric" value="${esc(a.year || "")}"></label>
        <label>Catalogue no.<input name="catno" value="${esc(a.catno || "")}"></label>
      </div>
      <label><span>Genres<span class="hint">separate with commas</span></span><input name="genres" value="${esc((a.genres || []).join(", "))}"></label>
      <div class="actions"><button class="btn primary" type="submit">Save changes</button><button class="btn" type="button" id="edit-cancel">Cancel</button></div>
    </form>` : "";

  const fix = state.fix && state.fix.albumId === a.id ? renderFix(a) : "";
  const coverOpen = state.cover && state.cover.albumId === a.id;
  const looking = state.lookingUp.has(a.id);

  const panel = openPanel(`
    <div class="panel-bar">
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <article class="album">
      <div class="album-head">
        ${thumb(a, "large")}
        <div class="album-id">
          <h2 class="album-title">${esc(a.title)}</h2>
          <p class="album-artist"><a href="#" data-search="${esc(a.artist)}">${esc(a.artist)}</a></p>
          ${meta ? `<p class="album-meta">${meta}</p>` : ""}
          ${(a.genres || []).length ? `<p class="chips">${a.genres.map((g) => `<button class="chip" data-genre="${esc(g)}">${esc(g)}</button>`).join("")}</p>` : ""}
        </div>
      </div>
      ${a._pending ? "" : coverOpen ? renderCover(a) : `<div class="cover-bar">
        ${canEnrich ? `<button class="btn" id="cover-find">Find a better image</button>` : ""}
        <button class="btn" id="cover-own">Use my own image</button>
      </div>`}
      ${looking ? `<p class="note looking">Looking up the cover, tracks and personnel…</p>` : ""}

      ${statusBlock}

      ${(a.tracks || []).length ? `<section class="block"><h3>Tracks</h3><ol class="tracks">
        ${a.tracks.map((t) => `<li><span class="pos">${esc(t.pos)}</span><span class="tt">${esc(t.title)}</span><span class="dur">${esc(t.dur || "")}</span></li>`).join("")}
      </ol></section>` : ""}

      ${players.length ? `<section class="block"><h3>Personnel</h3><ul class="credits">${players.map(credit).join("")}</ul></section>` : ""}
      ${others.length ? `<details class="block more"><summary>Production and other credits <span>${others.length}</span></summary><ul class="credits">${others.map(credit).join("")}</ul></details>` : ""}

      ${!looking && !a.tracks?.length && a.enrich_status === "pending" ? `<p class="note">Tracks and personnel haven't been fetched yet.${canEnrich ? "" : " They'll appear once the app is connected to Discogs."}</p>` : ""}
      ${a.enrich_status === "review" ? `<p class="note warn">This was the closest Discogs match, but it might be the wrong album. Check the tracks, or fix the match below.</p>` : ""}
      ${a.enrich_status === "not_found" ? `<p class="note warn">No Discogs match found. Paste a Discogs link below to add details.</p>` : ""}

      <section class="block">
        <h3>Notes</h3>
        <textarea id="notes" rows="2" placeholder="Condition, pressing, price paid…">${esc(a.notes || "")}</textarea>
      </section>

      ${edit}
      ${fix}

      <div class="footer-actions">
        ${a.discogs_url ? `<a class="btn" href="${esc(a.discogs_url)}" target="_blank" rel="noopener">View on Discogs</a>` : ""}
        ${canEnrich ? `<button class="btn" id="fix-open">${a.discogs_id ? "Wrong album? Fix match" : "Find on Discogs"}</button>` : ""}
        ${canEnrich && a.discogs_id ? `<button class="btn" id="refresh">Refresh details</button>` : ""}
        ${!state.editing ? `<button class="btn" id="edit-open">Edit details</button>` : ""}
        <button class="btn danger" id="delete">${a.status === "want" ? "Remove from want list" : "Delete record"}</button>
      </div>
    </article>`, "album");

  panel.querySelector("[data-search]")?.addEventListener("click", (e) => {
    e.preventDefault(); setQuery(a.artist);
  });
  panel.querySelectorAll("[data-genre]").forEach((b) => b.addEventListener("click", () => {
    state.genre = b.dataset.genre; setQuery("");
  }));
  panel.querySelector("#got-it")?.addEventListener("click", async () => {
    await updateAlbum(a.id, { status: "owned" }); toast("Moved to your collection");
  });
  panel.querySelector("#for-sale")?.addEventListener("change", async (e) => {
    await updateAlbum(a.id, { for_sale: e.target.checked }).catch(() => {});
    toast(e.target.checked ? "Marked for sale" : "No longer for sale");
  });
  const notes = panel.querySelector("#notes");
  notes.addEventListener("change", () => updateAlbum(a.id, { notes: notes.value || null }).then(() => toast("Note saved")).catch(() => {}));
  panel.querySelector("#edit-open")?.addEventListener("click", () => { state.editing = true; renderOverlay(); });
  panel.querySelector("#edit-cancel")?.addEventListener("click", () => { state.editing = false; renderOverlay(); });
  panel.querySelector("#edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const year = parseInt(f.get("year"), 10);
    state.editing = false;
    await updateAlbum(a.id, {
      artist: f.get("artist").trim(), title: f.get("title").trim(),
      year: Number.isFinite(year) ? year : null, catno: f.get("catno").trim() || null,
      genres: f.get("genres").split(",").map((s) => s.trim()).filter(Boolean),
    }).catch(() => {});
    toast("Changes saved");
  });
  panel.querySelector("#delete").addEventListener("click", async () => {
    const msg = a.status === "want" ? `Remove “${a.title}” from your want list?` : `Delete “${a.title}” from your collection? This can't be undone.`;
    if (!confirm(msg)) return;
    try {
      await state.store.remove(a.id);
      setAlbums(state.albums.filter((x) => x.id !== a.id));
      closeOverlay(); renderResults();
      toast(a.status === "want" ? "Removed from want list" : "Record deleted");
    } catch (e) { toast(e.message); }
  });
  panel.querySelector("#refresh")?.addEventListener("click", async (e) => {
    e.target.disabled = true; e.target.textContent = "Refreshing…";
    try {
      const r = await api({ op: "fetch", ref: `release/${a.discogs_id}`, artist: a.artist });
      if (r.release) { await updateAlbum(a.id, releasePatch(a, r.release, a.enrich_status === "review" ? "review" : "matched")); toast("Details refreshed"); }
    } catch (err) { toast(err.message); renderOverlay(); }
  });
  panel.querySelector("#fix-open")?.addEventListener("click", () => {
    state.fix = { albumId: a.id, candidates: null, busy: false, error: "" };
    renderOverlay();
    const inp = $("#fix-q"); inp?.focus();
    runFixSearch(a, `${a.artist} ${a.title}`);
  });
  wireFix(panel, a);
  wireCover(panel, a);
}

function renderFix(a) {
  const f = state.fix;
  const list = f.candidates
    ? f.candidates.length
      ? `<ul class="cands">${f.candidates.map((c) => `
          <li><button data-ref="${c.type}/${c.id}">
            <span class="thumb mini">${c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="blank" style="--h:${hue(c.title)}"><span class="disc"></span></span>`}</span>
            <span class="row-text"><span class="row-title">${esc(c.title)}</span>
            <span class="row-sub">${esc([c.year, c.country, c.format || (c.type === "master" ? "Original release" : "")].filter(Boolean).join(", "))}</span></span>
            <span class="use">Use this</span>
          </button></li>`).join("")}</ul>`
      : `<p class="note">No results. Try different words, or paste a link to the album's Discogs page.</p>`
    : "";
  return `<section class="block fix" id="fix">
    <h3>Fix the Discogs match</h3>
    <form id="fix-form" class="fix-form">
      <input id="fix-q" placeholder="Search Discogs, or paste a Discogs link" value="${esc(f.lastQuery || `${a.artist} ${a.title}`)}">
      <button class="btn primary" ${f.busy ? "disabled" : ""}>${f.busy ? "Searching…" : "Search"}</button>
    </form>
    ${f.error ? `<p class="note warn">${esc(f.error)}</p>` : ""}
    ${list}
  </section>`;
}

function wireFix(panel, a) {
  panel.querySelector("#fix-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#fix-q").value.trim();
    if (/discogs\.com\/.*(release|master)\/\d+/i.test(v) || /^\[?[rm]?\d+\]?$/i.test(v)) return applyRef(a, v);
    runFixSearch(a, v);
  });
  panel.querySelectorAll("[data-ref]").forEach((b) => b.addEventListener("click", () => applyRef(a, b.dataset.ref)));
}

async function runFixSearch(a, q) {
  state.fix = { ...state.fix, busy: true, error: "", lastQuery: q };
  renderOverlay();
  try {
    const r = await api({ op: "search", q });
    state.fix = { ...state.fix, busy: false, candidates: r.candidates || [] };
  } catch (e) {
    state.fix = { ...state.fix, busy: false, error: e.message };
  }
  renderOverlay();
}

async function applyRef(a, ref) {
  state.fix = { ...state.fix, busy: true, error: "" };
  renderOverlay();
  try {
    const r = await api({ op: "fetch", ref, artist: a.artist, exact: "1" });
    if (!r.release) throw new Error("That Discogs page couldn't be loaded. Check the link.");
    state.fix = null;
    await updateAlbum(a.id, releasePatch(a, r.release, "matched"));
    const now = byId(a.id);
    toast(now && (now.artist !== a.artist || now.title !== a.title) ? `Match updated: ${now.title}, ${now.artist}` : "Match updated");
  } catch (e) {
    state.fix = { ...state.fix, busy: false, error: e.message };
    renderOverlay();
  }
}

// ---------- cover ----------
function renderCover(a) {
  const c = state.cover;
  const imgs = c.images;
  const grid = imgs
    ? imgs.length
      ? `<div class="cover-grid">${imgs.map((im, i) => `
          <button class="cover-opt" data-pick="${i}" aria-label="Use this image from ${esc(im.source)}">
            <span class="cover-img"><img src="${esc(im.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>
            <span class="cover-src">${esc(im.source)}</span>
            <span class="cover-detail">${esc(im.detail || "")}</span>
          </button>`).join("")}</div>`
      : `<p class="note">No other images turned up. Take a photo of the sleeve, or paste a link to one you find.</p>`
    : "";
  return `<section class="block cover-pick" id="cover">
    <h3>Change the cover</h3>
    ${c.busy ? `<p class="note looking">${esc(c.busy)}</p>` : ""}
    ${c.error ? `<p class="note warn">${esc(c.error)}</p>` : ""}
    ${grid}
    <div class="cover-own">
      <label class="btn" for="cover-file">Take a photo or choose a file</label>
      <input type="file" id="cover-file" accept="image/*" class="visually-hidden">
      <form id="cover-link" class="fix-form" novalidate>
        <input id="cover-url" type="url" inputmode="url" placeholder="Paste an image link" autocomplete="off">
        <button class="btn">Use link</button>
      </form>
    </div>
    <div class="actions">
      ${state.store.canEnrich && !imgs ? `<button class="btn" id="cover-find">Find a better image</button>` : ""}
      <button class="btn" id="cover-done">Done</button>
    </div>
  </section>`;
}

function wireCover(panel, a) {
  const setCover = (patch) => { state.cover = { albumId: a.id, images: null, ...(state.cover || {}), ...patch }; renderOverlay(); };
  panel.querySelectorAll("#cover-find").forEach((b) => b.addEventListener("click", async () => {
    setCover({ busy: "Searching Apple Music, Cover Art Archive and Discogs…", error: "" });
    document.getElementById("cover")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    try {
      const r = await api({ op: "images", artist: a.artist, title: a.title, discogs_id: a.discogs_id || "", current: a.cover_url || "" });
      setCover({ busy: "", images: r.images || [] });
    } catch (e) { setCover({ busy: "", error: e.message }); }
  }));
  panel.querySelector("#cover-own")?.addEventListener("click", () => setCover({ error: "" }));
  panel.querySelector("#cover-done")?.addEventListener("click", () => { state.cover = null; renderOverlay(); });
  // Hide options whose image doesn't exist (Cover Art Archive doesn't have every album).
  panel.querySelectorAll(".cover-opt img").forEach((img) => img.addEventListener("error", () => img.closest(".cover-opt")?.remove()));
  panel.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", async () => {
    const im = state.cover.images[Number(b.dataset.pick)];
    state.cover = null;
    await updateAlbum(a.id, { cover_url: im.url, thumb_url: im.thumb || im.url, cover_locked: true }).then(() => toast("Cover updated")).catch(() => {});
  }));
  panel.querySelector("#cover-file")?.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) await saveOwnImage(a, file, setCover);
  });
  panel.querySelector("#cover-link")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const url = $("#cover-url").value.trim();
    if (!/^https?:\/\//i.test(url)) return setCover({ error: "Paste a full link that starts with https://" });
    if (state.store.mode !== "live") {           // demo: just point at the image
      state.cover = null;
      return updateAlbum(a.id, { cover_url: url, thumb_url: url, cover_locked: true }).then(() => toast("Cover updated")).catch(() => {});
    }
    setCover({ busy: "Downloading that image…", error: "" });
    try {
      const token = await state.store.token();
      const res = await fetch(`/api/image?${new URLSearchParams({ url })}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't download that image.");
      await saveOwnImage(a, await res.blob(), setCover);
    } catch (err) { setCover({ busy: "", error: err.message }); }
  });
}

async function saveOwnImage(a, blob, setCover) {
  setCover({ busy: "Saving your image…", error: "" });
  try {
    const [full, small] = await Promise.all([resizeImage(blob, 1400, false), resizeImage(blob, 320, true)]);
    const urls = await state.store.uploadCover(a.id, full, small);
    state.cover = null;
    await updateAlbum(a.id, { ...urls, cover_locked: true });
    toast("Cover updated");
  } catch (e) {
    setCover({ busy: "", error: /decode|load/i.test(e.message) ? "That file isn't an image this browser can read. Try a JPEG or PNG." : e.message });
  }
}

// Shrinks big phone photos before upload. `square` center-crops for list thumbnails.
function resizeImage(blob, max, square) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth, h = img.naturalHeight;
      let sx = 0, sy = 0, sw = w, sh = h;
      if (square) { const s = Math.min(w, h); sx = (w - s) / 2; sy = (h - s) / 2; sw = sh = s; }
      const scale = Math.min(1, max / Math.max(sw, sh));
      const cv = document.createElement("canvas");
      cv.width = Math.round(sw * scale); cv.height = Math.round(sh * scale);
      const ctx = cv.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't load that image"))), "image/jpeg", 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't load that image")); };
    img.src = url;
  });
}

// ---------- person ----------
function renderPerson(key) {
  const p = state.index.people.get(key);
  if (!p) return hideOverlay();
  const lead = p.items.filter((i) => i.leader);
  const side = p.items.filter((i) => !i.leader);
  const wanted = p.items.filter((i) => i.album.status === "want").length;
  const discogsId = p.items.map((i) => creditsFor(i.album).find((c) => personKey(c.name) === key)?.id).find(Boolean);
  const allTracks = (a) => (a.tracks || []).length;
  const itemRow = (i) => {
    const on = i.tracks.length && i.tracks.length < allTracks(i.album) ? ` <span class="on">on ${i.tracks.map(esc).join(", ")}</span>` : "";
    return row(i.album, `<span class="${i.leader ? "role lead" : "role"}">${esc(roleLabel(i))}</span>${on}`);
  };
  const summary = [
    lead.length && `Leader on ${lead.length}`,
    side.length && `${lead.length ? "plays" : "Plays"} on ${side.length}`,
  ].filter(Boolean).join(", ") + (wanted ? `. ${wanted} on your want list.` : ".");

  openPanel(`
    <div class="panel-bar">
      <button class="icon-btn" data-close aria-label="Back">${ICON.back}</button>
    </div>
    <article class="person">
      <h2 class="person-name">${esc(p.name)}</h2>
      <p class="person-sum">${summary}</p>
      ${lead.length ? `<section><h3>Their records</h3><div class="rows">${lead.map(itemRow).join("")}</div></section>` : ""}
      ${side.length ? `<section><h3>${lead.length ? "As a player" : "Records"}</h3><div class="rows">${side.map(itemRow).join("")}</div></section>` : ""}
      ${discogsId ? `<p class="footer-actions"><a class="btn" href="https://www.discogs.com/artist/${discogsId}" target="_blank" rel="noopener">See full discography on Discogs</a></p>` : ""}
    </article>`, "person");
}

// ---------- add a record ----------
function renderAdd(prefill) {
  const toCollection = state.status === "owned" || state.status === "sale";
  const label = (v) => (v === "want" ? "Add to want list" : "Add to collection");
  const panel = openPanel(`
    <div class="panel-bar">
      <h2 class="panel-title">Add a record</h2>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <form class="add" id="add-form" autocomplete="off">
      <fieldset class="seg" role="radiogroup" aria-label="Add to">
        <label><input type="radio" name="status" value="want" ${toCollection ? "" : "checked"}><span>Want list</span></label>
        <label><input type="radio" name="status" value="owned" ${toCollection ? "checked" : ""}><span>Collection</span></label>
      </fieldset>
      <label>Artist<input name="artist" id="add-artist" required value="${esc(prefill)}" autocapitalize="words"></label>
      <label>Album<input name="title" required autocapitalize="words"></label>
      <details class="add-more">
        <summary>More details</summary>
        <label><span>Catalogue no.<span class="hint">helps find the exact pressing</span></span><input name="catno" placeholder="BLP 4003"></label>
        <label><span>Note<span class="hint">optional</span></span><input name="notes" placeholder="Heard it at the café, the blue pressing…"></label>
      </details>
      <button class="btn primary big" type="submit" id="add-submit">${label(toCollection ? "owned" : "want")}</button>
      ${state.store.canEnrich ? `<p class="hint">The cover, year, label, tracks and personnel are filled in for you.</p>` : ""}
    </form>`, "add");
  const form = panel.querySelector("#add-form");
  form.addEventListener("change", () => { $("#add-submit").textContent = label(form.status.value); });
  setTimeout(() => (prefill ? form.title : form.artist).focus(), 60);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const row = {
      artist: f.get("artist").trim(), title: f.get("title").trim(), status: f.get("status"),
      catno: (f.get("catno") || "").trim() || null, notes: (f.get("notes") || "").trim() || null,
    };
    const dupe = state.albums.find((a) => fold(a.artist) === fold(row.artist) && fold(a.title) === fold(row.title));
    if (dupe && !confirm(dupe.status === "want" ? "That's already on your want list. Add it again?" : "You already own that one. Add it anyway?")) return;
    $("#add-submit").disabled = true;
    try {
      const saved = await state.store.insert(row);
      setAlbums([...state.albums, saved]);
      renderResults();
      toast(row.status === "want" ? "Added to want list" : "Added to collection");
      // Show the new record while its details are looked up.
      if (state.store.canEnrich) state.lookingUp.add(saved.id);
      location.replace(`#/album/${encodeURIComponent(saved.id)}`);
      if (state.store.canEnrich) {
        enrichOne(saved).then(renderAll).catch(() => {
          state.lookingUp.delete(saved.id); renderAll();
          toast("Couldn't look up details right now. Try “Find on Discogs” later.");
        });
      }
    } catch {
      // No signal: keep it on this phone and sync later.
      const pending = { ...row, id: "pending-" + Date.now(), _pending: true, genres: [], tracks: [], credits: [], personnel_hint: [], enrich_status: "pending", created_at: new Date().toISOString() };
      outbox.push(pending);
      setAlbums([...state.albums, pending]);
      closeOverlay(); renderResults();
      toast("Saved on this phone. It'll sync next time you're online.");
    }
  });
}

// ---------- tools / enrichment ----------
function renderTools() {
  const by = (s) => state.albums.filter((a) => a._pending ? false : a.enrich_status === s);
  const pending = by("pending"), review = by("review"), missing = by("not_found"), errors = by("error"), done = by("matched");
  const noSides = state.albums.filter(fromCDListing);
  const e = state.enrich;
  const mode = state.store.mode;
  const pct = e.total ? Math.round((e.done / e.total) * 100) : 0;

  const panel = openPanel(`
    <div class="panel-bar">
      <h2 class="panel-title">Collection</h2>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <div class="tools">
      ${mode === "demo" ? `<p class="note">You're looking at demo mode. Changes stay in this browser. Connect Supabase and Discogs (see the README) to use your real collection.</p>` : ""}
      ${mode === "offline" ? `<p class="note">You're offline, showing the copy saved on this device. Want-list adds will sync when you reconnect.</p>` : ""}

      <section class="block">
        <h3>Covers, tracks and personnel</h3>
        <dl class="stats">
          <div><dt>Done</dt><dd>${done.length}</dd></div>
          <div><dt>Not fetched</dt><dd>${pending.length}</dd></div>
          <div><dt>Check match</dt><dd>${review.length}</dd></div>
          <div><dt>Not found</dt><dd>${missing.length + errors.length}</dd></div>
        </dl>
        ${e.running ? `
          <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
          <p class="hint">${e.done} of ${e.total}. ${esc(e.current)}${e.note ? ` ${esc(e.note)}` : ""}</p>
          <button class="btn" id="stop">Stop</button>`
        : state.store.canEnrich ? `
          ${pending.length ? `<button class="btn primary" id="run">Fetch details for ${plural(pending.length, "record")}</button>
            <p class="hint">Discogs allows about 60 lookups a minute, so this takes roughly ${Math.max(1, Math.round(pending.length * 4 / 60))} minutes. Keep this screen open; you can stop and pick up later.</p>` : ""}
          ${missing.length + errors.length ? `<button class="btn" id="retry">Try the ${missing.length + errors.length} not found again</button>` : ""}
          ${noSides.length ? `<div class="vinyl-fix">
            <p class="hint">${plural(noSides.length, "record")} ${noSides.length === 1 ? "has" : "have"} a track list without sides, which usually means it came from a CD.</p>
            <button class="btn" id="vinyl">Switch ${noSides.length === 1 ? "it" : "them"} to the vinyl LP</button>
          </div>` : ""}`
        : ""}
      </section>

      ${review.length + missing.length ? `<section class="block"><h3>Needs a look</h3>
        <p class="hint">Open one and use “Fix match” to pick the right pressing or paste its Discogs link.</p>
        <div class="rows">${[...review, ...missing, ...errors].map((a) => row(a, a.enrich_status === "review" ? "Check match" : "Not found")).join("")}</div>
      </section>` : ""}

      <section class="block">
        <h3>Backup</h3>
        <button class="btn" id="export">Download a copy (CSV)</button>
      </section>
      ${mode === "live" ? `<section class="block"><button class="btn" id="signout">Sign out</button></section>` : ""}
    </div>`, "tools");

  panel.querySelector("#run")?.addEventListener("click", () => runEnrich(["pending"]));
  panel.querySelector("#retry")?.addEventListener("click", () => runEnrich(["not_found", "error"]));
  panel.querySelector("#vinyl")?.addEventListener("click", () => runQueue(state.albums.filter(fromCDListing), refetchVinyl, "Finished switching to vinyl pressings"));
  panel.querySelector("#stop")?.addEventListener("click", () => { state.enrich.stop = true; state.enrich.note = "Stopping…"; renderOverlay(); });
  panel.querySelector("#export").addEventListener("click", exportCSV);
  panel.querySelector("#signout")?.addEventListener("click", async () => { await state.store.signOut(); location.hash = ""; location.reload(); });
}

async function api(params) {
  const token = await state.store.token();
  const res = await fetch(`/api/discogs?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) return { rateLimited: true, retryAfter: body.retryAfter || 30 };
  if (res.status === 401) throw new Error("Your session expired. Sign in again.");
  if (!res.ok) throw new Error(body.error || `Discogs lookup failed (${res.status})`);
  return body;
}

function releasePatch(a, rel, status) {
  const patch = {
    discogs_id: rel.discogs_id, discogs_url: rel.discogs_url, year: rel.year, label: rel.label,
    cover_url: rel.cover_url, thumb_url: rel.thumb_url, tracks: rel.tracks, credits: rel.credits,
    enrich_status: status,
  };
  if (a.cover_locked) { delete patch.cover_url; delete patch.thumb_url; }
  // Use Discogs' artist and title, unless this is only a possible match waiting to be checked.
  if (status !== "review") {
    if (rel.discogs_artist) patch.artist = rel.discogs_artist;
    if (rel.discogs_title) patch.title = rel.discogs_title;
  }
  if (!a.catno && rel.label_catno) patch.catno = rel.label_catno;
  if (!(a.genres || []).length && (rel.discogs_genres || []).length) patch.genres = rel.discogs_genres;
  return patch;
}

async function enrichOne(a) {
  state.lookingUp.add(a.id);
  try { return await enrichOnce(a); } finally { state.lookingUp.delete(a.id); }
}

// Calls the lookup, waiting politely if Discogs says we're going too fast.
async function politeApi(params) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await api(params);
    if (!r.rateLimited) return r;
    state.enrich.note = `Discogs asked us to slow down; waiting ${r.retryAfter}s.`;
    renderOverlay();
    await sleep(r.retryAfter * 1000);
    state.enrich.note = "";
  }
  return null;
}

async function enrichOnce(a) {
  const r = await politeApi({ op: "match", artist: a.artist, title: a.title, catno: a.catno || "" });
  if (!r) return 0;
  const patch = r.release ? releasePatch(a, r.release, r.status) : { enrich_status: "not_found" };
  await updateAlbum(a.id, patch);
  return r.rateRemaining;
}

// ---------- vinyl repair ----------
// Vinyl track lists have sides (A1, B2…); CD ones are numbered 1, 2, 3.
const VINYL_CHECKED = "vinylChecked";
const vinylChecked = () => new Set(JSON.parse(pref.get(VINYL_CHECKED, "[]")));
function fromCDListing(a) {
  if (a._pending || !a.discogs_id || !(a.tracks || []).length) return false;
  if (a.tracks.some((t) => /^[A-Za-z]/.test(String(t.pos || "")))) return false;
  return !vinylChecked().has(a.id);   // already tried; Discogs has no sided vinyl listing
}

async function refetchVinyl(a) {
  const r = await politeApi({ op: "fetch", ref: `release/${a.discogs_id}`, artist: a.artist });
  const tried = vinylChecked(); tried.add(a.id); pref.set(VINYL_CHECKED, JSON.stringify([...tried]));
  if (!r || !r.release) return r ? r.rateRemaining : 0;
  await updateAlbum(a.id, releasePatch(a, r.release, a.enrich_status === "review" ? "review" : "matched"));
  return r.rateRemaining;
}

function runEnrich(statuses) {
  return runQueue(state.albums.filter((a) => !a._pending && statuses.includes(a.enrich_status)), enrichOne, "Finished fetching details");
}

async function runQueue(queue, worker, finished) {
  const e = state.enrich;
  if (e.running) return;
  Object.assign(e, { running: true, stop: false, done: 0, total: queue.length, current: "", note: "" });
  let wakeLock = null;
  try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {}
  renderOverlay();
  for (const a of queue) {
    if (e.stop) break;
    e.current = `${a.artist}, ${a.title}`;
    renderOverlay();
    let remaining = null;
    try { remaining = await worker(byId(a.id) || a); }
    catch (err) {
      if (/session expired/i.test(err.message)) { toast(err.message); break; }
      await updateAlbum(a.id, { enrich_status: "error" }).catch(() => {});
    }
    e.done++;
    // Stay under Discogs' 60 requests/minute.
    await sleep(remaining == null ? 1500 : remaining < 10 ? 15000 : 900);
  }
  Object.assign(e, { running: false, current: "", note: "" });
  try { await wakeLock?.release(); } catch {}
  renderAll();
  toast(e.stop ? "Stopped. Pick up where you left off any time." : finished);
}

function exportCSV() {
  const cols = ["artist", "title", "status", "for_sale", "year", "label", "catno", "genres", "notes", "discogs_url"];
  const cell = (v) => { const s = Array.isArray(v) ? v.join("/") : v ?? ""; return /[",\n]/.test(String(s)) ? `"${String(s).replace(/"/g, '""')}"` : String(s); };
  const lines = [cols.join(","), ...state.index.list.map(({ album }) => cols.map((c) => cell(album[c])).join(","))];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `garage-crates-${new Date().toISOString().slice(0, 10)}.csv` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- misc ----------
function setQuery(q) {
  state.q = q; $("#q").value = q;
  closeOverlay();
  setTimeout(() => { renderResults(); window.scrollTo({ top: 0 }); }, 0);
}

let toastTimer;
function toast(msg) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function renderLogin(error = "") {
  $("#app").innerHTML = `
    <main class="login">
      <h1>Garage Crates</h1>
      <form id="login">
        <label>Email<input name="email" type="email" autocomplete="username" required></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        ${error ? `<p class="note warn">${esc(error)}</p>` : ""}
        <button class="btn primary big">Sign in</button>
      </form>
    </main>`;
  $("#login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await state.store.signIn(f.get("email"), f.get("password")); boot(); }
    catch (err) { renderLogin(/invalid/i.test(err.message) ? "That email and password don't match. Try again." : err.message); }
  });
}

// Track in-app navigation so the close button can go "back".
window.addEventListener("hashchange", () => {
  if (location.hash && !(history.state && history.state.crate)) history.replaceState({ crate: true }, "");
  renderOverlay();
});

async function boot() {
  const cached = cache.get();
  state.store = state.store || (await createStore());
  const session = await state.store.session();
  if (!session) return renderLogin();

  renderShell();
  if (state.store.mode === "live" && cached) { setAlbums(cached); renderAll(); }
  try {
    const synced = await outbox.flush(state.store);
    const rows = await state.store.load();
    const pending = outbox.all();
    setAlbums([...rows, ...pending]);
    if (synced.length) toast(`Synced ${plural(synced.length, "want-list add")}`);
    if (state.store.canEnrich) for (const s of synced) enrichOne(s).then(renderAll).catch(() => {});
  } catch (e) {
    if (!cached) $("#results").innerHTML = emptyState(`Couldn't load your records: ${esc(e.message)}`);
    else toast("Showing the copy saved on this device. Couldn't reach the server.");
  }
  renderAll();
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();
