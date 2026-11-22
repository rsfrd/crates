import { createStore, cache, outbox } from "./store.js";
import { parseCSV, FIELDS, looksLikeHeader, guessColumns, recordsFromRows, withoutDuplicates } from "./importer.js";
import { collectionCSV, collectionBackup, readBackup } from "./exporter.js";
import { buildIndex, search, personKey, roleLabel, creditKind, creditsFor, fold, fileAs, knownPeople, typeset, typesetAlbum } from "./search.js";

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
  select: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.5 3.5 7.5-8"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h3.5c2 0 3.2 1 4.3 2.7l2.4 4.6c1.1 1.7 2.3 2.7 4.3 2.7H20"/><path d="M4 17h3.5c1.4 0 2.4-.5 3.2-1.4M13.3 8.4c.8-.9 1.8-1.4 3.2-1.4H20"/><path d="m17.5 4.5 2.5 2.5-2.5 2.5M17.5 14.5l2.5 2.5-2.5 2.5"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="m13.5 6.5 4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5M5 20h14"/></svg>',
  signout: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/></svg>',
  disc: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="1.6"/></svg>',
  sheet: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="4" width="17" height="16" rx="2"/><path d="M3.5 9h17M3.5 14.5h17M10 4v16"/></svg>',
  drop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c3 4 5.5 7.2 5.5 10.2a5.5 5.5 0 0 1-11 0C6.5 10.7 9 7.5 12 3.5z"/></svg>',
  // Hollow record = not on the shelf yet
  want: '<svg viewBox="0 0 16 16" aria-hidden="true" class="glyph"><circle cx="8" cy="8" r="6.25" fill="none" stroke-dasharray="2.2 1.6"/><circle cx="8" cy="8" r="1.4" fill="none"/></svg>',
};

// ---------- state ----------
const state = {
  store: null,
  owner: true,       // false for guests who came in with the passphrase
  // The last known name and guest setting, so the saved copy can be shown before anything loads.
  settings: (() => { try { return { siteName: "Garage Crates", guestEmail: "", ...JSON.parse(localStorage.getItem("crate.settings.v1") || "{}") }; } catch { return { siteName: "Garage Crates", guestEmail: "" }; } })(),
  albums: [],
  index: { list: [], people: new Map(), genres: [], crates: [] },
  q: "",
  status: pref.get("status", "all"),
  genre: "",
  crate: "",
  view: pref.get("view", "list"),
  select: null,      // Set of album ids while choosing records, else null
  selPanel: null,    // "add" | "remove" while the selection bar is open for crates
  visibleIds: [],    // albums in the current results, for "Select all"
  crateAdd: null,    // album id whose "Add to crate" box is open
  enrich: { running: false, stop: false, done: 0, total: 0, current: "", note: "" },
  editing: false,
  fix: null, // { albumId, candidates, busy, error }
  cover: null, // { albumId, images, busy, error, note }
  lookingUp: new Set(), // album ids whose details are being fetched right now
  pick: null,        // { crate, genre, id } for "Pick for me"
  pricing: new Set(), // want-list ids whose price is being checked right now
  imp: null,         // an import in progress
  priceFailed: new Set(), // checks that failed this session; not retried automatically
};

function setAlbums(rows) {
  state.albums = rows.map(typesetAlbum);   // real apostrophes and " • " between translated titles
  state.index = buildIndex(state.albums);
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
    toast(e.message || "Couldn’t save that change. Check your connection and try again.");
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
  if (a.status === "want" && a.price && a.price.value != null) t += `<span class="tag tag-price">${money(a.price)}</span>`;
  if (a.status === "owned" && a.for_sale) t += `<span class="tag tag-sale">For sale</span>`;
  if (a.status === "owned" && a.to_wash_since) t += `<span class="tag tag-wash">${ICON.drop}Wash</span>`;
  if (a._pending) t += `<span class="tag">Not synced</span>`;
  return t ? `<span class="tags">${t}</span>` : "";
}

// The year an album first came out (from its Discogs album family), else the pressing's own year.
const firstYear = (a) => a.original_year || a.year;
function sub(a) { return esc(a.artist) + (firstYear(a) ? `, ${firstYear(a)}` : ""); }

const picked = (a) => (state.select && state.select.has(a.id) ? " is-selected" : "");
const pickMark = `<span class="pick" aria-hidden="true">${ICON.check}</span>`;

function row(a, extra = "") {
  return `<a class="row${picked(a)}" href="#/album/${encodeURIComponent(a.id)}" data-id="${esc(a.id)}">${pickMark}
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
  return `<a class="tile${picked(a)}" href="#/album/${encodeURIComponent(a.id)}" data-id="${esc(a.id)}">
    ${thumb(a, "tile-art")}${pickMark}
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
        <h1>${esc(state.settings.siteName)}</h1>
        <p class="count" id="count"></p>
      </div>
      <div class="top-actions">
        <button class="icon-btn" id="select-toggle" aria-label="Select records">${ICON.select}</button>
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
          ${[["all", "All"], ["owned", "Owned"], ["want", "Want"], ["sale", "For sale"], ...(washReady() ? [["wash", "To wash"]] : [])]
            .map(([v, l]) => `<button role="radio" data-status="${v}" aria-checked="${state.status === v}">${l}</button>`).join("")}
        </div>
        <select id="crate" aria-label="Crate" hidden></select>
        <select id="genre" aria-label="Genre"></select>
      </div>
    </div>
    <main id="results" aria-live="polite"></main>
    <a class="fab fab-pick" href="#/pick" aria-label="Pick a record for me">${ICON.shuffle}</a>
    <a class="fab" href="#/add">${ICON.plus}<span>Add</span></a>
    <div id="selbar" class="selbar" hidden></div>
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
  $("#crate").addEventListener("change", (e) => { state.crate = e.target.value; renderResults(); });
  $("#select-toggle").addEventListener("click", () => (state.select ? endSelect() : startSelect()));
  // While selecting, tapping a record ticks it instead of opening it.
  $("#results").addEventListener("click", (e) => {
    if (!state.select) return;
    const a = e.target.closest("a[data-id]");
    if (!a) { if (e.target.closest("a")) e.preventDefault(); return; }
    e.preventDefault();
    const id = a.dataset.id;
    if (state.select.has(id)) state.select.delete(id); else state.select.add(id);
    a.classList.toggle("is-selected", state.select.has(id));
    renderSelbar();
  });
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
  $("#count").textContent = `${plural(c.owned, "record")}, ${c.want.toLocaleString()} wanted${state.owner ? "" : ", view only"}`;
  const sel = $("#genre");
  sel.innerHTML = `<option value="">All genres</option>` +
    state.index.genres.map((g) => `<option ${g === state.genre ? "selected" : ""}>${esc(g)}</option>`).join("");
  const cs = $("#crate");
  cs.hidden = !state.index.crates.length && !state.crate;
  cs.innerHTML = `<option value="">All crates</option>` +
    state.index.crates.map((c) => `<option value="${esc(c.name)}" ${c.name === state.crate ? "selected" : ""}>${esc(c.name)} (${c.count})</option>`).join("");
  $("#select-toggle").classList.toggle("on", !!state.select);
  const vt = $("#view-toggle");
  vt.innerHTML = state.view === "list" ? ICON.grid : ICON.list;
  vt.setAttribute("aria-label", state.view === "list" ? "Show covers as a grid" : "Show as a list");
}

function renderResults() {
  // The list is hidden while a page is open over it: redrawing 700 rows there is wasted work on a phone,
  // so it's redrawn once, when the page closes.
  const ov = $("#overlay");
  if (ov && !ov.hidden) { state.listStale = true; renderHeader(); return; }
  state.listStale = false;
  const res = search(state.index, state.q, { status: state.status, genre: state.genre, crate: state.crate });
  $("#clear").hidden = !state.q;
  const el = $("#results");
  el.classList.toggle("selecting", !!state.select);
  state.visibleIds = res.albums.filter((a) => !a._pending).map((a) => a.id);
  renderHeader();
  renderSelbar();

  if (!res.query) {
    if (!res.albums.length) {
      if (!state.albums.length && state.owner) {
        el.innerHTML = `<div class="empty"><p>Your collection is empty. Bring it in from Discogs or a spreadsheet, or add records one at a time.</p>
          <div class="empty-actions"><a class="btn primary" href="#/import/discogs">Import from Discogs</a><a class="btn" href="#/import/csv">Import a spreadsheet</a></div></div>`;
        return;
      }
      el.innerHTML = emptyState(state.status === "want"
        ? "Your want list is empty. Add an album you heard and it’ll be here when you’re in the store."
        : state.status === "sale" ? "Nothing is marked for sale. Open a record and turn on “For sale” to queue it."
        : state.status === "wash" ? "Your wash queue is empty. When a record sounds dirty, open it and turn on “To wash”."
        : state.crate ? `Nothing in “${esc(state.crate)}” matches these filters.`
        : "Nothing here yet.");
      return;
    }
    el.innerHTML = (state.status === "wash" && !state.select && state.owner
      ? `<p class="wash-hint">${plural(res.albums.length, "record")} in your wash queue. After a wash, tap ${ICON.select} to select the ones you washed, then <strong>Mark washed</strong>.</p>` : "")
      + albumBlock(res.albums);
    return;
  }

  let html = "";
  if (res.people.length) {
    html += `<section><h2>People <span>${res.people.length}</span></h2><div class="rows">` +
      res.people.map((p) => {
        const bits = personSummary(p.items).toLowerCase();
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
      res.songs.map((s) => row(s.album, s.tracks.slice(0, 3).map((t) =>
        `<span class="pos">${esc(t.pos)}</span> ${esc(t.title)}${t.isWork && t.wby ? ` <span class="on">by ${esc(t.wby)}</span>` : ""}${t.work && !t.isWork ? ` <span class="on">in ${esc(t.work)}</span>` : ""}`).join("<br>"))).join("") +
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
  // Don’t redraw a panel out from under someone who is typing in it.
  const active = document.activeElement;
  const typing = active && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && !/^(checkbox|radio|button|submit|file)$/i.test(active.type)));
  if (typing && active.closest?.("#overlay")) return;
  renderOverlay();
}

// ---------- crates ----------
const SETUP_CRATES = "Crates aren’t set up yet. Run supabase/updates/004_crates.sql in Supabase, then try again.";
const crateError = (e) => (/crates/i.test((e && e.message) || "") ? SETUP_CRATES : (e && e.message) || "Couldn’t save that change.");
const cleanCrate = (s) => String(s || "").replace(/\s+/g, " ").trim().slice(0, 60);

function startSelect() { state.select = new Set(); state.selPanel = null; renderResults(); }
function endSelect() { state.select = null; state.selPanel = null; renderResults(); }

function renderSelbar() {
  const bar = $("#selbar"); if (!bar) return;
  const fabs = document.querySelectorAll(".fab");
  if (!state.select) { bar.hidden = true; bar.innerHTML = ""; fabs.forEach((f) => (f.hidden = false)); return; }
  fabs.forEach((f) => (f.hidden = true));
  bar.hidden = false;
  const n = state.select.size;
  const all = state.visibleIds.length && state.visibleIds.every((id) => state.select.has(id));
  const chosen = [...state.select].map(byId).filter(Boolean);
  const inCrates = [...new Set(chosen.flatMap((a) => a.crates || []))].sort((a, b) => a.localeCompare(b));
  let panel = "";
  if (state.selPanel === "add") {
    panel = `<div class="selpanel">
      ${state.index.crates.length ? `<p class="hint">Add ${plural(n, "record")} to:</p><div class="chips">${state.index.crates.map((c) => `<button class="chip" data-add-crate="${esc(c.name)}">${esc(c.name)}</button>`).join("")}</div>` : ""}
      <form id="new-crate" class="fix-form"><input id="new-crate-name" placeholder="New crate name, like Japanese" autocomplete="off" maxlength="60"><button class="btn primary">Add</button></form>
    </div>`;
  } else if (state.selPanel === "remove") {
    panel = `<div class="selpanel">
      ${inCrates.length ? `<p class="hint">Take ${plural(n, "record")} out of:</p><div class="chips">${inCrates.map((c) => `<button class="chip" data-remove-crate="${esc(c)}">${esc(c)}</button>`).join("")}</div>`
        : `<p class="hint">None of the selected records are in a crate.</p>`}
    </div>`;
  }
  bar.innerHTML = `${panel}
    <div class="selrow">
      <span class="selcount">${n ? `${plural(n, "record")} selected` : "Tap records to select them"}</span>
      <button class="btn" id="sel-all">${all ? "Clear" : `Select all ${state.visibleIds.length}`}</button>
      <button class="btn" id="sel-done">Done</button>
    </div>
    <div class="selrow">
      ${state.status === "wash" ? `<button class="btn primary" id="sel-washed" ${n ? "" : "disabled"}>${ICON.drop}Mark washed</button>
      <button class="btn" id="sel-add" ${n ? "" : "disabled"}>Add to crate</button>`
      : `<button class="btn primary" id="sel-add" ${n ? "" : "disabled"}>Add to crate</button>
      <button class="btn" id="sel-remove" ${n ? "" : "disabled"}>Remove from crate</button>`}
    </div>`;
  bar.querySelector("#sel-all").addEventListener("click", () => {
    state.select = all ? new Set() : new Set(state.visibleIds); renderResults();
  });
  bar.querySelector("#sel-add").addEventListener("click", () => { state.selPanel = state.selPanel === "add" ? null : "add"; renderSelbar(); $("#new-crate-name")?.focus(); });
  bar.querySelector("#sel-remove")?.addEventListener("click", () => { state.selPanel = state.selPanel === "remove" ? null : "remove"; renderSelbar(); });
  bar.querySelector("#sel-washed")?.addEventListener("click", async () => {
    const now = new Date().toISOString(), ids = [...state.select];
    for (const id of ids) await updateAlbum(id, { to_wash_since: null, washed_at: now }).catch(() => {});
    toast(`Washed ${plural(ids.length, "record")}`);
    endSelect();
  });
  bar.querySelector("#sel-done").addEventListener("click", endSelect);
  const addTo = async (name) => {
    name = cleanCrate(name); if (!name) return;
    const ids = [...state.select];
    const changed = await changeCrates(ids, (cs) => (cs.includes(name) ? cs : [...cs, name]));
    if (changed != null) { toast(`Added ${plural(changed, "record")} to ${name}`); endSelect(); }
  };
  bar.querySelectorAll("[data-add-crate]").forEach((b) => b.addEventListener("click", () => addTo(b.dataset.addCrate)));
  bar.querySelector("#new-crate")?.addEventListener("submit", (e) => { e.preventDefault(); addTo($("#new-crate-name").value); });
  bar.querySelectorAll("[data-remove-crate]").forEach((b) => b.addEventListener("click", async () => {
    const name = b.dataset.removeCrate;
    const changed = await changeCrates([...state.select], (cs) => cs.filter((c) => c !== name));
    if (changed != null) { toast(`Took ${plural(changed, "record")} out of ${name}`); endSelect(); }
  }));
}

// Changes the crates on many records at once. Returns how many changed, or null if saving failed.
async function changeCrates(ids, fn) {
  const changes = [];
  for (const id of ids) {
    const a = byId(id); if (!a || a._pending) continue;
    const before = a.crates || [];
    const next = [...new Set(fn(before))];
    if (next.length !== before.length || next.some((c, i) => c !== before[i])) changes.push({ id, before, next });
  }
  if (!changes.length) return 0;
  // Show the change right away, then save.
  const nextById = new Map(changes.map((c) => [c.id, c.next]));
  setAlbums(state.albums.map((a) => (nextById.has(a.id) ? { ...a, crates: nextById.get(a.id) } : a)));
  renderAll();
  const failed = [];
  let firstError = null;
  for (let i = 0; i < changes.length; i += 6) {
    await Promise.all(changes.slice(i, i + 6).map(async (c) => {
      try { const saved = await state.store.update(c.id, { crates: c.next }); replaceAlbum(saved); }
      catch (e) { failed.push(c); firstError = firstError || e; }
    }));
  }
  if (failed.length) {
    const back = new Map(failed.map((c) => [c.id, c.before]));
    setAlbums(state.albums.map((a) => (back.has(a.id) ? { ...a, crates: back.get(a.id) } : a)));
    renderAll();
    toast(failed.length === changes.length ? crateError(firstError) : `${plural(failed.length, "record")} couldn’t be saved. ${crateError(firstError)}`);
    return null;
  }
  renderAll();
  return changes.length;
}

async function renameCrate(from) {
  const to = cleanCrate(await askConfirm(`Rename “${from}” to:`, { yes: "Rename", input: from }));
  if (!to || to === from) return;
  const ids = state.albums.filter((a) => (a.crates || []).includes(from)).map((a) => a.id);
  changeCrates(ids, (cs) => cs.map((c) => (c === from ? to : c))).then((n) => {
    if (n != null) { if (state.crate === from) state.crate = to; toast(`Renamed to ${to}`); renderAll(); }
  });
}

async function deleteCrate(name) {
  const ids = state.albums.filter((a) => (a.crates || []).includes(name)).map((a) => a.id);
  if (!(await askConfirm(`Delete the crate “${name}”? The ${plural(ids.length, "record")} in it stay in your collection.`, { yes: "Delete crate", danger: true }))) return;
  changeCrates(ids, (cs) => cs.filter((c) => c !== name)).then((n) => {
    if (n != null) { if (state.crate === name) state.crate = ""; toast(`Deleted ${name}`); renderAll(); }
  });
}

function crateBlock(a) {
  const crates = a.crates || [];
  const open = state.crateAdd === a.id;
  const others = state.index.crates.filter((c) => !crates.includes(c.name));
  return `<section class="block crates-block">
    <h3>Crates</h3>
    <div class="chips">
      ${crates.map((c) => `<span class="crate-chip"><button class="chip" data-crate-go="${esc(c)}">${esc(c)}</button><button class="chip-x" data-crate-rm="${esc(c)}" aria-label="Take out of ${esc(c)}">${ICON.close}</button></span>`).join("")}
      ${a._pending ? "" : `<button class="chip add-chip" id="crate-add-open">${ICON.plus}Add to crate</button>`}
    </div>
    ${open ? `<form id="crate-add" class="fix-form crate-add">
        <input id="crate-add-name" list="crate-names" placeholder="Crate name" autocomplete="off" maxlength="60">
        <datalist id="crate-names">${others.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist>
        <button class="btn primary">Add</button>
      </form>
      ${others.length ? `<div class="chips quick">${others.map((c) => `<button class="chip" data-crate-quick="${esc(c.name)}">${esc(c.name)}</button>`).join("")}</div>` : ""}` : ""}
  </section>`;
}

function wireCrates(panel, a) {
  panel.querySelectorAll("[data-crate-go]").forEach((b) => b.addEventListener("click", () => {
    state.crate = b.dataset.crateGo; state.genre = ""; setQuery("");
  }));
  panel.querySelectorAll("[data-crate-rm]").forEach((b) => b.addEventListener("click", async () => {
    const name = b.dataset.crateRm;
    if ((await changeCrates([a.id], (cs) => cs.filter((c) => c !== name))) != null) toast(`Taken out of ${name}`);
  }));
  panel.querySelector("#crate-add-open")?.addEventListener("click", () => {
    state.crateAdd = state.crateAdd === a.id ? null : a.id; renderOverlay(); $("#crate-add-name")?.focus();
  });
  const add = async (name) => {
    name = cleanCrate(name); if (!name) return;
    state.crateAdd = null;
    if ((await changeCrates([a.id], (cs) => [...cs, name])) != null) toast(`Added to ${name}`);
  };
  panel.querySelector("#crate-add")?.addEventListener("submit", (e) => { e.preventDefault(); add($("#crate-add-name").value); });
  panel.querySelectorAll("[data-crate-quick]").forEach((b) => b.addEventListener("click", () => add(b.dataset.crateQuick)));
}

// ---------- pick for me ----------
const PICK_RECENT = "pickRecent";

function pickPool(crate, genre) {
  return state.albums.filter((a) => a.status === "owned" && !a._pending
    && (!crate || (a.crates || []).includes(crate))
    && (!genre || (a.genres || []).includes(genre)));
}

// A random record from the pool, avoiding the last few picks while there’s enough to choose from.
function choose(pool, avoidId) {
  if (!pool.length) return null;
  let recent = [];
  try { recent = JSON.parse(pref.get(PICK_RECENT, "[]")); } catch {}
  const keep = Math.min(recent.length, Math.max(0, pool.length - 3), 25);
  const skip = new Set([...recent.slice(-keep), avoidId]);
  const fresh = pool.filter((a) => !skip.has(a.id));
  const from = fresh.length ? fresh : pool.filter((a) => a.id !== avoidId);
  const a = (from.length ? from : pool)[Math.floor(Math.random() * (from.length ? from.length : pool.length))];
  pref.set(PICK_RECENT, JSON.stringify([...recent.filter((id) => id !== a.id), a.id].slice(-40)));
  return a;
}

function renderPick() {
  if (!state.pick) state.pick = { crate: state.crate, genre: state.genre, id: null };
  const pk = state.pick;
  const pool = pickPool(pk.crate, pk.genre);
  if (!pk.id || !pool.some((a) => a.id === pk.id)) pk.id = choose(pool)?.id || null;
  const a = pk.id ? byId(pk.id) : null;
  const genres = [...new Set(state.albums.filter((x) => x.status === "owned").flatMap((x) => x.genres || []))].sort((x, y) => x.localeCompare(y));

  const panel = openPanel(`
    <div class="panel-bar">
      <h2 class="panel-title">Pick for me</h2>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <div class="picker">
      <div class="pick-from">
        <label>Crate
          <select id="pick-crate"><option value="">Any crate</option>${state.index.crates.map((c) => `<option value="${esc(c.name)}" ${c.name === pk.crate ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
        </label>
        <label>Genre
          <select id="pick-genre"><option value="">Any genre</option>${genres.map((g) => `<option ${g === pk.genre ? "selected" : ""}>${esc(g)}</option>`).join("")}</select>
        </label>
      </div>
      ${a ? `
        <a class="pick-card" href="#/album/${encodeURIComponent(a.id)}" id="pick-card">
          ${thumb(a, "large pick-art")}
          <span class="pick-title">${esc(a.title)}</span>
          <span class="pick-artist">${esc(a.artist)}${firstYear(a) ? `, ${firstYear(a)}` : ""}</span>
        </a>
        <p class="hint pick-pool">${pool.length === 1 ? "The only record" : `One of ${plural(pool.length, "record")}`}${pk.crate || pk.genre ? ` in ${esc([pk.crate, pk.genre].filter(Boolean).join(" + "))}` : " in your collection"}.</p>
        <div class="pick-actions">
          <button class="btn primary big" id="pick-again" ${pool.length > 1 ? "" : "disabled"}>${ICON.shuffle}Pick another</button>
          <a class="btn big" href="#/album/${encodeURIComponent(a.id)}">Open record</a>
        </div>`
      : `<div class="empty"><p>${pk.crate && pk.genre ? `Nothing in ${esc(pk.crate)} is tagged ${esc(pk.genre)}. Try just one of them.` : "There’s nothing to pick from here yet."}</p></div>`}
    </div>`, "pick");

  const reset = () => { pk.crate = panel.querySelector("#pick-crate").value; pk.genre = panel.querySelector("#pick-genre").value; pk.id = null; renderPick(); };
  panel.querySelector("#pick-crate").addEventListener("change", reset);
  panel.querySelector("#pick-genre").addEventListener("change", reset);
  panel.querySelector("#pick-again")?.addEventListener("click", () => shuffleTo(panel, pool));
}

// A short flick through a few covers before landing, like thumbing through a crate.
function shuffleTo(panel, pool) {
  const pk = state.pick;
  const next = choose(pool, pk.id);
  const art = panel.querySelector(".pick-art");
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!art || reduce || pool.length < 3) { pk.id = next.id; renderPick(); return; }
  panel.querySelector("#pick-again").disabled = true;
  let n = 0;
  const flick = setInterval(() => {
    const x = pool[Math.floor(Math.random() * pool.length)];
    const src = x.cover_url || x.thumb_url;
    art.innerHTML = src ? `<img src="${esc(src)}" alt="" referrerpolicy="no-referrer">` : `<span class="blank" style="--h:${hue(x.artist + x.title)}"><span class="disc"></span></span>`;
    art.classList.toggle("is-want", false);
    if (++n >= 7) { clearInterval(flick); pk.id = next.id; renderPick(); }
  }, 65);
}

// ---------- filing ----------
// The database has the "File under" column once 006_file_under.sql has run.
function sortReady() {
  if (state.store && state.store.mode !== "live") return true;
  return state.albums.some((a) => !a._pending && Object.prototype.hasOwnProperty.call(a, "sort_as"));
}
// Shown as the placeholder: where the record files now, e.g. "Zappa".
function fileUnderGuess(a) {
  const f = fileAs(a.artist, knownPeople(state.albums));
  const first = f.split(" ")[0] || "";
  return first.charAt(0).toUpperCase() + first.slice(1);
}

// ---------- want-list prices ----------
const SETUP_PRICES = "Prices aren’t set up yet. Run supabase/updates/005_prices.sql in Supabase, then reload.";
const PRICE_MAX_AGE = 12 * 3600 * 1000;

// The database has the price columns once 005_prices.sql has run (rows then carry a "price" key).
// "Released 1959 · This pressing 1972", or just the year when they're the same or one is unknown.
function candYears(c) {
  const o = c.original_year;
  return o && c.year && String(o) !== String(c.year) ? [`Released ${o}`, `This pressing ${c.year}`] : [o || c.year];
}

// The database has the wash queue columns (supabase/updates/009).
function washReady() {
  if (state.store && state.store.mode !== "live") return true;
  const sample = state.albums.find((a) => !a._pending);
  return !sample || "to_wash_since" in sample;
}
const shortDate = (iso) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// The database has the original-year column (supabase/updates/008).
function originalReady() {
  if (state.store && state.store.mode !== "live") return true;
  const sample = state.albums.find((a) => !a._pending);
  return !sample || "original_year" in sample;
}

function pricesReady() {
  if (state.store && state.store.mode !== "live") return true;
  return state.albums.some((a) => !a._pending && Object.prototype.hasOwnProperty.call(a, "price"));
}
const priceable = () => state.albums.filter((a) => a.status === "want" && a.discogs_id && !a._pending);
function priceStale(a) {
  if (!a.discogs_id || !state.store?.canEnrich || !pricesReady() || state.pricing.has(a.id) || state.priceFailed.has(a.id)) return false;
  if (a.price && a.price.release && a.price.release !== a.discogs_id) return true;   // matched to another pressing since
  const t = a.price && Date.parse(a.price.checked_at);
  return !t || Date.now() - t > PRICE_MAX_AGE;
}

function money(p, short = false) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: p.currency || "USD", maximumFractionDigits: short && p.value >= 10 ? 0 : 2 }).format(p.value);
  } catch { return `${p.value} ${p.currency || ""}`.trim(); }
}

function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!Number.isFinite(m)) return "";
  if (m < 2) return "just now";
  if (m < 60) return `${m} minutes ago`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "an hour ago" : `${h} hours ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// Discogs marketplace pages for this pressing, the one the price is for, cheapest first.
function marketLinks(a) {
  const pressing = `https://www.discogs.com/sell/release/${a.discogs_id}?sort=price%2Casc`;
  return { us: `${pressing}&ships_from=United+States`, all: pressing };
}

const notVinyl = (a) => !!(a.price && a.price.vinyl === false && a.price.release === a.discogs_id);

function priceBlock(a) {
  if (!a.discogs_id) return "";
  const p = a.price;
  const links = marketLinks(a);
  let line;
  if (state.pricing.has(a.id) && !p) line = `<p class="price-line"><span class="hint">Checking Discogs…</span></p>`;
  else if (notVinyl(a)) line = `<p class="note warn">This match isn’t a vinyl pressing${p.format ? ` (${esc(p.format.split(",")[0])})` : ""}, so there’s no vinyl price. Use <strong>Wrong album? Fix match</strong> below to pick the LP.</p>`;
  else if (p && p.value != null) line = `<p class="price-line"><strong>From ${money(p)}</strong><span class="hint">${plural(p.for_sale || 0, "copy", "copies")} of this pressing for sale, lowest price before shipping</span></p>`;
  else if (p) line = `<p class="price-line"><span>No copies of this pressing for sale on Discogs right now.</span></p>`;
  else line = "";
  return `<section class="block price-block">
    <h3>Buy on Discogs</h3>
    ${line}
    <div class="price-links">
      ${notVinyl(a) ? "" : `<a class="btn" href="${esc(links.us)}" target="_blank" rel="noopener">US sellers</a>
      <a class="btn" href="${esc(links.all)}" target="_blank" rel="noopener">All sellers</a>`}
    </div>
    <p class="hint price-note">${notVinyl(a) ? "" : "Both links show this pressing, the one the price is for. "}Signed in to Discogs, you’ll see shipping to your address and each seller’s rating.${p && p.checked_at ? ` Price checked ${ago(p.checked_at)}.` : ""}
      ${state.store.canEnrich && pricesReady() && !state.pricing.has(a.id) ? `<button class="linkish" id="price-refresh">Check again</button>` : ""}</p>
  </section>`;
}

// Asks Discogs for the current lowest price. `quiet` skips toasts (used when refreshing many).
// Redraws only the price section of an open album page. Everything else on the page is left alone, so a
// price arriving never reloads the page or moves it (iOS Safari jumped on every full redraw).
function paintPrice(id) {
  const r = route();
  const el = r.name === "album" && r.arg === id ? $("#overlay .panel .price-block") : null;
  const a = byId(id);
  if (!el || !a) return;
  const holder = document.createElement("div");
  holder.innerHTML = priceBlock(a).trim();
  const fresh = holder.firstElementChild;
  if (!fresh) return;
  el.replaceWith(fresh);
  fresh.querySelector("#price-refresh")?.addEventListener("click", () => checkPrice(byId(id), true));
}

async function checkPrice(a, force = false, quiet = false) {
  if (!a.discogs_id || state.pricing.has(a.id) || (!force && !priceStale(a))) return null;
  if (!pricesReady()) { if (!quiet) toast(SETUP_PRICES); return null; }
  state.pricing.add(a.id);
  paintPrice(a.id);
  try {
    state.priceFailed.delete(a.id);
    // Whether the pressing is vinyl is asked once per pressing and kept with the price.
    const known = a.price && a.price.release === a.discogs_id && typeof a.price.vinyl === "boolean";
    const r = await politeApi({ op: "price", id: a.discogs_id, master: a.master_id ? "0" : "1", fmt: known ? "0" : "1" });
    if (!r || !r.price) { state.priceFailed.add(a.id); return r ? r.rateRemaining : 0; }
    const vinyl = known ? a.price.vinyl : r.price.vinyl;
    const format = known ? a.price.format : r.price.format;
    const base = { release: a.discogs_id, vinyl: typeof vinyl === "boolean" ? vinyl : null, format: format || null, checked_at: new Date().toISOString() };
    // A CD (or cassette) match gets no price: a vinyl buyer would be misled by it.
    const patch = { price: vinyl === false ? { value: null, for_sale: 0, ...base } : { value: r.price.value, currency: r.price.currency, for_sale: r.price.for_sale, ...base } };
    if (!a.master_id && r.price.master_id) patch.master_id = r.price.master_id;
    state.pricing.delete(a.id);
    // Saved without redrawing anything; the price section and the list are refreshed below.
    const before = byId(a.id);
    replaceAlbum({ ...before, ...patch });
    try { replaceAlbum(await state.store.update(a.id, patch)); } catch { replaceAlbum(before); }
    return r.rateRemaining;
  } catch (e) {
    state.priceFailed.add(a.id);
    if (!quiet) toast(/session expired/i.test(e.message) ? e.message : "Couldn’t check the price right now.");
    return null;
  } finally {
    state.pricing.delete(a.id);
    paintPrice(a.id);
    renderResults();   // the list behind (price tags); open pages other than this album aren't touched
  }
}

// ---------- importing ----------
// state.imp holds the import in progress: { list, username, vinylOnly, reading, page, pages, found[], error, saving, saved }

const IMPORT_COLUMNS = new Set(["artist", "title", "year", "original_year", "label", "catno", "genres", "notes", "personnel_hint", "status", "enrich_status",
  "discogs_id", "master_id", "discogs_url", "cover_url", "thumb_url"]);

// Only send columns this site’s database has (older sites may not have master_id yet).
function forDatabase(r) {
  const out = {};
  for (const [k, v] of Object.entries(r)) if (IMPORT_COLUMNS.has(k) && !(k === "master_id" && !pricesReady()) && !(k === "original_year" && !originalReady())) out[k] = v;
  return out;
}

function importSummary(fresh, dupes, other) {
  return [`${plural(fresh.length, "record")} to bring in`, dupes.length && `${dupes.length.toLocaleString()} you already have`, other].filter(Boolean).join(", ") + ".";
}

async function saveImport(records, label) {
  const imp = state.imp;
  imp.saving = true; imp.saved = 0; imp.error = "";
  renderOverlay();
  try {
    const saved = await state.store.insertMany(records.map(forDatabase), (n) => { imp.saved = n; renderOverlay(); });
    setAlbums([...state.albums, ...saved]);
    imp.saving = false; imp.done = saved.length;
    renderAll();
    toast(`Imported ${plural(saved.length, "record")}${label ? ` from ${label}` : ""}`);
  } catch (e) {
    imp.saving = false;
    imp.error = /permission|row-level|policy/i.test(e.message) ? "This is a view-only copy. Only the owner can import." : `Importing stopped: ${e.message}`;
    renderAll();
  }
}

function importDone(imp) {
  return `<div class="note"><p><strong>${plural(imp.done, "record")} imported.</strong></p>
    <p>Covers, tracks and personnel come next. Open Collection and, under Album details, tap <strong>Fetch</strong>${state.store.canEnrich ? "" : " once the site is connected to Discogs"}.</p>
    <p class="price-links"><a class="btn primary" href="#/tools">Go to Collection</a><button class="btn" data-close>Done</button></p></div>`;
}

function renderImportDiscogs() {
  if (!state.owner) { viewOnly(); return closeOverlay(); }
  const imp = state.imp || (state.imp = { kind: "discogs", list: "collection", username: "", vinylOnly: true, found: null });
  let body = "";
  if (imp.done != null) body = importDone(imp);
  else if (imp.saving) body = `<p class="note looking">Saving ${imp.saved.toLocaleString()} of ${imp.toSave.toLocaleString()}…</p>`;
  else if (imp.reading) body = `<p class="note looking">Reading ${imp.list === "wants" ? "the want list" : "the collection"} from Discogs${imp.pages > 1 ? `, page ${imp.page} of ${imp.pages}` : ""}…</p>`;
  else if (imp.found) {
    const pool = imp.vinylOnly ? imp.found.filter((r) => r.vinyl) : imp.found;
    const notVinyl = imp.found.filter((r) => !r.vinyl).length;
    const { fresh, dupes } = withoutDuplicates(pool, state.albums);
    imp.fresh = fresh;
    body = `
      <p class="hint">${importSummary(fresh, dupes, notVinyl && imp.vinylOnly ? `${notVinyl.toLocaleString()} not on vinyl, left out` : "")}</p>
      ${notVinyl ? `<label class="check"><input type="checkbox" id="imp-vinyl" ${imp.vinylOnly ? "checked" : ""}> Vinyl only</label>` : ""}
      ${fresh.length ? `<div class="rows import-preview">${fresh.slice(0, 8).map((r) => row({ ...r, id: "p" + r.discogs_id })).join("")}</div>
        ${fresh.length > 8 ? `<p class="hint">…and ${(fresh.length - 8).toLocaleString()} more.</p>` : ""}
        <button class="btn primary big" id="imp-save">Import ${plural(fresh.length, "record")} ${imp.list === "wants" ? "to your want list" : "to your collection"}</button>` : ""}
      <button class="btn" id="imp-again">Start over</button>`;
  } else {
    body = `
      <form id="imp-form" class="add">
        <label>Discogs username<input name="username" value="${esc(imp.username)}" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="jazzcollector" required></label>
        <fieldset class="seg" role="radiogroup" aria-label="What to import">
          <label><input type="radio" name="list" value="collection" ${imp.list === "collection" ? "checked" : ""}><span>Collection</span></label>
          <label><input type="radio" name="list" value="wants" ${imp.list === "wants" ? "checked" : ""}><span>Want list</span></label>
        </fieldset>
        <button class="btn primary big">Look it up</button>
        <p class="hint">Albums come in as the pressings listed on Discogs. Discogs Wantlists are imported as Want lists in Garage Crates. The collection must be public on Discogs, unless it’s the account whose token this site uses.</p>
      </form>`;
  }
  const panel = openPanel(`
    <div class="panel-bar">
      <h2 class="panel-title">Import from Discogs</h2>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <div class="importer">${imp.error ? `<p class="note warn">${esc(imp.error)}</p>` : ""}${body}</div>`, "import");

  panel.querySelector("#imp-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    imp.username = String(f.get("username") || "").trim().replace(/^.*discogs\.com\/(user\/)?/i, "").replace(/\/.*$/, "");
    imp.list = f.get("list");
    readDiscogs(imp);
  });
  panel.querySelector("#imp-vinyl")?.addEventListener("change", (e) => { imp.vinylOnly = e.target.checked; renderOverlay(); });
  panel.querySelector("#imp-again")?.addEventListener("click", () => { state.imp = null; renderOverlay(); });
  panel.querySelector("#imp-save")?.addEventListener("click", () => { imp.toSave = imp.fresh.length; saveImport(imp.fresh, "Discogs"); });
}

async function readDiscogs(imp) {
  if (!state.store.canEnrich) { imp.error = "Importing from Discogs needs the site connected to Discogs (the DISCOGS_TOKEN setting)."; return renderOverlay(); }
  Object.assign(imp, { reading: true, error: "", found: [], page: 1, pages: 1 });
  renderOverlay();
  try {
    for (let page = 1; page <= imp.pages; page++) {
      const r = await politeApi({ op: "collection", username: imp.username, list: imp.list, page });
      if (!r) throw new Error("Discogs is busy. Try again in a minute.");
      Object.assign(imp, { page, pages: r.pages });
      imp.found.push(...r.rows);
      renderOverlay();
    }
    imp.reading = false;
    if (!imp.found.length) imp.error = imp.list === "wants" ? "That want list is empty." : "That collection is empty.";
    if (!imp.found.length) imp.found = null;
  } catch (e) {
    Object.assign(imp, { reading: false, found: null, error: e.message });
  }
  renderOverlay();
}

function renderImportCSV() {
  if (!state.owner) { viewOnly(); return closeOverlay(); }
  const imp = state.imp || (state.imp = { kind: "csv", status: "owned" });
  let body = "";
  if (imp.done != null) body = importDone(imp);
  else if (imp.saving) body = `<p class="note looking">Saving ${imp.saved.toLocaleString()} of ${imp.toSave.toLocaleString()}…</p>`;
  else if (imp.rows) {
    const data = imp.hasHeader ? imp.rows.slice(1) : imp.rows;
    const ready = imp.map.artist != null && imp.map.title != null;
    const { records, skipped } = ready ? recordsFromRows(data, imp.map, imp.status) : { records: [], skipped: [] };
    const { fresh, dupes } = withoutDuplicates(records, state.albums);
    imp.fresh = fresh;
    const heads = imp.rows[0].map((h, i) => (imp.hasHeader ? h || `Column ${i + 1}` : `Column ${i + 1}: ${h}`.slice(0, 40)));
    body = `
      <p class="hint">${esc(imp.fileName)}: ${plural(data.length, "row")}.</p>
      <label class="check"><input type="checkbox" id="imp-header" ${imp.hasHeader ? "checked" : ""}> The first row is headings</label>
      <div class="map">
        ${FIELDS.map((f) => `<label><span>${f.label}${f.required ? "" : ' <span class="hint">optional</span>'}</span>
          <select data-field="${f.key}"><option value="">${f.required ? "Choose a column" : "Not in this file"}</option>
          ${heads.map((h, i) => `<option value="${i}" ${imp.map[f.key] === i ? "selected" : ""}>${esc(h)}</option>`).join("")}</select></label>`).join("")}
      </div>
      <fieldset class="seg" role="radiogroup" aria-label="Import into">
        <label><input type="radio" name="imp-status" value="owned" ${imp.status === "owned" ? "checked" : ""}><span>Collection</span></label>
        <label><input type="radio" name="imp-status" value="want" ${imp.status === "want" ? "checked" : ""}><span>Want list</span></label>
      </fieldset>
      ${!ready ? `<p class="note warn">Choose which columns hold the artist and the album.</p>` : `
        <p class="hint">${importSummary(fresh, dupes, skipped.length && `${skipped.length.toLocaleString()} without an artist or album, left out`)}</p>
        ${fresh.length ? `<div class="rows import-preview">${fresh.slice(0, 5).map((r, i) => row({ ...r, id: "p" + i }, [r.year, r.catno, r.genres.join("/")].filter(Boolean).map(esc).join(", "))).join("")}</div>
          <button class="btn primary big" id="imp-save">Import ${plural(fresh.length, "record")}</button>` : ""}`}
      <button class="btn" id="imp-again">Choose another file</button>`;
  } else {
    body = `
      <p>Add to your collection or want list after choosing a file.</p>
      <p>Any spreadsheet saved as CSV works: one row per record, with at least an artist and an album. Year, label, catalogue number, genre, notes and players are used if they’re there.</p>
      <label class="btn primary big" for="imp-file">Choose a file</label>
      <input type="file" id="imp-file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" class="visually-hidden">
      <p class="hint">In Excel, Numbers or Google Sheets, use File → Export or Download → CSV.</p>`;
  }
  const panel = openPanel(`
    <div class="panel-bar">
      <h2 class="panel-title">Import a spreadsheet</h2>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <div class="importer">${imp.error ? `<p class="note warn">${esc(imp.error)}</p>` : ""}${body}</div>`, "import");

  panel.querySelector("#imp-file")?.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      const { rows } = parseCSV(await file.text());
      if (!rows.length) throw new Error("That file is empty.");
      const hasHeader = looksLikeHeader(rows[0]);
      Object.assign(imp, { rows, fileName: file.name, hasHeader, map: guessColumns(rows[0], hasHeader), error: "" });
    } catch (err) { imp.error = err.message || "Couldn’t read that file. Save it as CSV and try again."; }
    renderOverlay();
  });
  panel.querySelector("#imp-header")?.addEventListener("change", (e) => {
    imp.hasHeader = e.target.checked; imp.map = guessColumns(imp.rows[0], imp.hasHeader); renderOverlay();
  });
  panel.querySelectorAll("[data-field]").forEach((sel) => sel.addEventListener("change", () => {
    const v = sel.value === "" ? null : Number(sel.value);
    if (v == null) delete imp.map[sel.dataset.field]; else imp.map[sel.dataset.field] = v;
    renderOverlay();
  }));
  panel.querySelectorAll('[name="imp-status"]').forEach((r) => r.addEventListener("change", () => { imp.status = r.value; renderOverlay(); }));
  panel.querySelector("#imp-again")?.addEventListener("click", () => { state.imp = null; renderOverlay(); });
  panel.querySelector("#imp-save")?.addEventListener("click", () => { imp.toSave = imp.fresh.length; saveImport(imp.fresh, imp.fileName); });
}

// The columns this site’s database has. Older sites may lack some (crates, prices, file under), and a
// backup from a newer site shouldn’t stop a restore, so anything the database doesn’t have is left out.
function siteColumns() {
  const sample = state.store.mode === "live" && state.albums.find((a) => !a._pending);
  return sample ? new Set(Object.keys(sample).filter((k) => k !== "id" && k !== "updated_at")) : null;
}

function renderImportBackup() {
  if (!state.owner) { viewOnly(); return closeOverlay(); }
  const imp = state.imp || (state.imp = { kind: "backup" });
  let body = "";
  if (imp.done != null) body = `<div class="note"><p><strong>${plural(imp.done, "album")} restored</strong>, with their covers, tracks, personnel and notes.</p>
    <p class="price-links"><button class="btn primary" data-close>Done</button></p></div>`;
  else if (imp.saving) body = `<p class="note looking">Restoring ${imp.saved.toLocaleString()} of ${imp.toSave.toLocaleString()}…</p>`;
  else if (imp.records) {
    const { fresh, dupes } = withoutDuplicates(imp.records, state.albums);
    imp.fresh = fresh;
    const when = imp.savedAt ? new Date(imp.savedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "";
    body = `
      <p class="hint">${esc(imp.fileName)}${imp.site || when ? `: ${[imp.site && esc(imp.site), when && `saved ${when}`].filter(Boolean).join(", ")}` : ""}.</p>
      <p class="hint">${[`${plural(fresh.length, "album")} to restore`, dupes.length && `${dupes.length.toLocaleString()} already here, left as they are`, imp.skipped && `${imp.skipped} unreadable, left out`].filter(Boolean).join(", ")}.</p>
      ${fresh.length ? `<div class="rows import-preview">${fresh.slice(0, 5).map((r, i) => row({ ...r, id: "b" + i })).join("")}</div>
        ${fresh.length > 5 ? `<p class="hint">…and ${(fresh.length - 5).toLocaleString()} more.</p>` : ""}
        <button class="btn primary big" id="imp-save">Restore ${plural(fresh.length, "album")}</button>` : `<p class="note">Everything in this backup is already in your collection.</p>`}
      <button class="btn" id="imp-again">Choose another file</button>`;
  } else {
    body = `
      <p>Choose a backup file made with <strong>Download a backup</strong>. Albums that aren’t in your collection come back exactly as they were saved, with covers, tracks, personnel, notes and crates. Albums you already have are left as they are.</p>
      <label class="btn primary big" for="imp-file">Choose a backup file</label>
      <input type="file" id="imp-file" accept=".json,application/json" class="visually-hidden">`;
  }
  const panel = openPanel(`
    <div class="panel-bar">
      <h2 class="panel-title">Restore from a backup</h2>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <div class="importer">${imp.error ? `<p class="note warn">${esc(imp.error)}</p>` : ""}${body}</div>`, "import");

  panel.querySelector("#imp-file")?.addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try { Object.assign(imp, readBackup(await file.text()), { fileName: file.name, error: "" }); }
    catch (err) { imp.error = err.message; }
    renderOverlay();
  });
  panel.querySelector("#imp-again")?.addEventListener("click", () => { state.imp = null; renderOverlay(); });
  panel.querySelector("#imp-save")?.addEventListener("click", async () => {
    const cols = siteColumns();
    const rows = imp.fresh.map((r) => cols ? Object.fromEntries(Object.entries(r).filter(([k]) => cols.has(k))) : r);
    imp.toSave = rows.length;
    imp.saving = true; imp.saved = 0; imp.error = "";
    renderOverlay();
    try {
      const saved = await state.store.insertMany(rows, (n) => { imp.saved = n; renderOverlay(); });
      setAlbums([...state.albums, ...saved]);
      imp.saving = false; imp.done = saved.length;
      renderAll();
      toast(`Restored ${plural(saved.length, "album")}`);
    } catch (err) {
      imp.saving = false;
      imp.error = /permission|row-level|policy/i.test(err.message) ? "This is a view-only copy. Only the owner can restore." : `Restoring stopped: ${err.message}`;
      renderAll();
    }
  });
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
  // iOS Safari can drop a scroll position set before the new content is laid out (or mid-fling):
  // set it again on the next frame, so a page that refreshes (price, tracks) doesn't jump to the top.
  if (sameView && scroll) requestAnimationFrame(() => { if (Math.abs(panel.scrollTop - scroll) > 1) panel.scrollTop = scroll; });
  document.body.classList.add("locked");
  if (wasHidden) { lastFocus = document.activeElement; listScroll = window.scrollY; }
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
  if (state.listStale) renderResults();
  lastFocus?.focus?.({ preventScroll: true });
  // Back to where the list was. Closing sets the address to "#", which jumps to the top, and iOS Safari
  // sometimes leaves the list unpainted until it scrolls; a real scroll repaints it and loads the covers.
  const y = listScroll;
  window.scrollTo(0, y);
  requestAnimationFrame(() => { window.scrollTo(0, y + 1); window.scrollTo(0, y); });
}
let listScroll = 0;

function route() {
  const h = decodeURIComponent(location.hash.slice(1));
  const [path, qs] = h.split("?");
  const parts = path.split("/").filter(Boolean);
  return { name: parts[0] || "", arg: parts.slice(1).join("/"), params: new URLSearchParams(qs || "") };
}

function renderOverlay() {
  if (!state.store) return;   // still starting up; boot draws the page once the data is in
  const r = route();
  if (r.name !== "album") { state.editing = false; state.fix = null; state.cover = null; state.crateAdd = null; }
  if (r.name !== "pick" && r.name !== "album") state.pick = null;
  if (r.name !== "import" && !(state.imp && state.imp.saving)) state.imp = null;
  if (r.name === "album") return renderAlbum(r.arg);
  if (r.name === "person") return renderPerson(r.arg);
  if (r.name === "add") return renderAdd(r.params.get("q") || "");
  if (r.name === "tools") return renderTools();
  if (r.name === "import") return r.arg === "csv" ? renderImportCSV() : r.arg === "backup" ? renderImportBackup() : renderImportDiscogs();
  if (r.name === "pick") return renderPick();
  hideOverlay();
}

// "Tenor Saxophone, Percussion (Congas, Bongos)" → one unbreakable-when-possible piece per role,
// split only at commas outside brackets, each comma kept with the role before it.
function roleSpans(label) {
  const parts = []; let depth = 0, cur = "";
  for (const ch of label) {
    if (ch === "(" || ch === "[") depth++;
    if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map((r, i) => `<span class="r">${esc(r)}${i < parts.length - 1 ? "," : ""}</span>`).join(" ");
}

// ---------- track lists ----------
function seconds(d) {
  const p = String(d || "").split(":").map(Number);
  if (!d || p.some((n) => !Number.isFinite(n))) return null;
  return p.reduce((acc, n) => acc * 60 + n, 0);
}
function clock(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// Movements are listed under the piece they belong to, with the piece’s total time.
function trackList(tracks) {
  const groups = [];
  for (const t of tracks) {
    const last = groups[groups.length - 1];
    // Group by the piece itself (wi), so two pieces with the same title stay separate.
    const key = t.work ? (t.wi ?? t.work) : null;
    if (key != null && last && last.key === key) last.items.push(t);
    else groups.push({ key, work: t.work || null, by: t.wby || "", items: [t] });
  }
  const sub = (t) => [t.by, t.note].filter(Boolean).map((x) => `<span class="by">${esc(x)}</span>`).join("");
  const li = (t, cls = "") => `<li${cls ? ` class="${cls}"` : ""}><span class="pos">${esc(t.pos)}</span><span class="tt">${esc(t.title)}${sub(t)}</span><span class="dur">${esc(t.dur || "")}</span></li>`;
  return `<ol class="tracks">${groups.map((g) => {
    if (!g.work) return g.items.map((t) => li(t)).join("");
    const secs = g.items.map((t) => seconds(t.dur));
    const total = g.items[0].wdur || (secs.every((x) => x != null) ? clock(secs.reduce((a, b) => a + b, 0)) : "");
    return `<li class="work"><span class="tt">${esc(g.work)}${g.by ? `<span class="by">${esc(g.by)}</span>` : ""}</span><span class="dur">${total}</span></li>${g.items.map((t) => li(t, "mvt")).join("")}`;
  }).join("")}</ol>`;
}

// Long titles: split at a colon into title + subtitle, and step the size down as they grow.
function albumTitle(t) {
  const i = t.indexOf(": ");
  const split = i >= 3 && t.length - i > 4;
  const main = split ? t.slice(0, i) : t;
  const sub = split ? t.slice(i + 2) : "";
  const size = main.length > 60 ? " is-xlong" : main.length > 30 ? " is-long" : "";
  return `<h2 class="album-title${size}">${esc(main)}${sub ? `<span class="album-sub">${esc(sub)}</span>` : ""}</h2>`;
}

// ---------- album ----------
function renderAlbum(id) {
  const a = byId(id);
  if (!a) return hideOverlay();
  const credits = creditsFor(a);
  const order = { leader: 0, player: 1, composer: 2 };
  const players = credits.filter((c) => creditKind(c, a) in order).sort((x, y) => order[creditKind(x, a)] - order[creditKind(y, a)]);
  const others = credits.filter((c) => !(creditKind(c, a) in order));
  const allPos = new Set((a.tracks || []).map((t) => t.pos));
  const trackNote = (c) => c.tracks && c.tracks.length && c.tracks.length < allPos.size ? `<span class="on">on ${c.tracks.map(esc).join(", ")}</span>` : "";
  const credit = (c) => `<li><a href="#/person/${encodeURIComponent(personKey(c.name))}">
      <span class="who">${esc(c.name)}</span>
      <span class="what">${roleSpans(roleLabel(c, a))} ${trackNote(c)}</span></a></li>`;
  // Original year first; the pressing's own year sits by its catalogue number when it differs.
  const reissue = a.original_year && a.year && a.year !== a.original_year ? `${a.year} pressing` : "";
  // "1959 • Columbia, KCS 8163, 1972 pressing": the year it came out, then this pressing's details.
  const pressing = [a.label, a.catno, reissue].filter(Boolean).map(esc).join(", ");
  const meta = [firstYear(a) ? esc(firstYear(a)) : "", pressing].filter(Boolean).join(" • ");
  const canEnrich = state.store.canEnrich;

  const statusBlock = a.status === "want"
    ? `<div class="status-block want">
        <p>${ICON.want} ${a.created_at ? `Wanted since ${new Date(a.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : "On your want list"}</p>
        <button class="btn primary" id="got-it">Move to collection</button>
      </div>`
    : "";
  // For sale and To wash sit below the notes, above the buttons (owned records only).
  const switches = a.status === "want" ? "" : `<div class="switch-card">
      <label class="switch-row">
        <span><strong>For sale</strong><span class="hint">Shows up under the “For sale” filter.</span></span>
        <input type="checkbox" role="switch" id="for-sale" ${a.for_sale ? "checked" : ""}>
      </label>
      ${washReady() ? `<label class="switch-row">
        <span><strong>To wash</strong><span class="hint">${a.to_wash_since ? `In your wash queue since ${shortDate(a.to_wash_since)}. Turn off once it’s washed.`
          : a.washed_at ? `Last washed ${shortDate(a.washed_at)}.` : "Adds it to your wash queue."}</span></span>
        <input type="checkbox" role="switch" id="needs-wash" ${a.to_wash_since ? "checked" : ""}>
      </label>` : ""}
    </div>`;

  const edit = state.editing ? `
    <form class="edit" id="edit-form">
      <label>Artist<input name="artist" value="${esc(a.artist)}" required></label>
      <label>Album<input name="title" value="${esc(a.title)}" required></label>
      <div class="two">
        ${originalReady() ? `<label>First released<input name="original_year" inputmode="numeric" value="${esc(a.original_year || "")}"></label>` : ""}
        <label>${originalReady() ? "This pressing" : "Year"}<input name="year" inputmode="numeric" value="${esc(a.year || "")}"></label>
      </div>
      <label>Catalogue no.<input name="catno" value="${esc(a.catno || "")}"></label>
      <label><span>Genres<span class="hint">separate with commas</span></span><input name="genres" value="${esc((a.genres || []).join(", "))}"></label>
      ${sortReady() ? `<label><span>File under<span class="hint">leave empty to file people by surname; applies to every record by this artist</span></span><input name="sort_as" value="${esc(a.sort_as || "")}" placeholder="${esc(fileUnderGuess(a))}"></label>` : ""}
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
          ${albumTitle(a.title)}
          <p class="album-artist"><a href="#" data-search="${esc(a.artist)}">${esc(a.artist)}</a></p>
          ${meta ? `<p class="album-meta">${meta}</p>` : ""}
          ${(a.genres || []).length ? `<p class="chips">${a.genres.map((g) => `<button class="chip" data-genre="${esc(g)}">${esc(g)}</button>`).join("")}</p>` : ""}
        </div>
      </div>
      ${a._pending ? "" : coverOpen ? renderCover(a) : `<div class="cover-bar">
        ${canEnrich || !state.owner ? `<button class="btn" id="cover-find">Find a better image</button>` : ""}
        <button class="btn" id="cover-own">Use my own image</button>
      </div>`}
      ${looking ? `<p class="note looking">Looking up the cover, tracks and personnel…</p>` : ""}

      ${statusBlock}

      ${a.status === "want" ? priceBlock(a) : ""}

      ${crateBlock(a)}

      ${(a.tracks || []).length ? `<section class="block"><h3>Tracks</h3>${trackList(a.tracks)}</section>` : ""}

      ${players.length ? `<section class="block"><h3>Personnel</h3><ul class="credits">${players.map(credit).join("")}</ul></section>` : ""}
      ${others.length ? `<details class="block more"><summary>Production and other credits <span>${others.length}</span></summary><ul class="credits">${others.map(credit).join("")}</ul></details>` : ""}

      ${!looking && !a.tracks?.length && a.enrich_status === "pending" ? `<p class="note">Tracks and personnel haven’t been fetched yet.${canEnrich || !state.owner ? "" : " They’ll appear once the app is connected to Discogs."}</p>` : ""}
      ${a.enrich_status === "review" || a.enrich_status === "not_found" || a.enrich_status === "error" ? `<div class="note warn keep-note">
        <p>${a.enrich_status === "review" ? "This was the closest Discogs match, but it might be the wrong album. Check the tracks, or fix the match below." : "No Discogs match found. Paste a Discogs or Bandcamp link below to add details."}</p>
        <button class="btn" id="keep-as-is">${a.enrich_status === "review" ? "The match is right" : "It’s fine as it is"}</button>
      </div>` : ""}

      <section class="block">
        <h3>Notes</h3>
        <textarea id="notes" rows="2" placeholder="Condition, pressing, price paid…">${esc(a.notes || "")}</textarea>
      </section>

      ${switches}

      ${edit}
      ${fix}

      <div class="footer-actions">
        ${a.discogs_url ? `<a class="btn" href="${esc(a.discogs_url)}" target="_blank" rel="noopener">${a.discogs_id ? "View on Discogs" : "View on Bandcamp"}</a>` : ""}
        ${canEnrich || !state.owner ? `<button class="btn" id="fix-open">${a.discogs_url ? "Wrong album? Fix match" : "Find on Discogs or Bandcamp"}</button>` : ""}
        ${(canEnrich || !state.owner) && a.discogs_id ? `<button class="btn" id="refresh">Refresh details</button>` : ""}
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
  panel.querySelector("#needs-wash")?.addEventListener("change", async (e) => {
    const now = new Date().toISOString();
    await updateAlbum(a.id, e.target.checked ? { to_wash_since: now } : { to_wash_since: null, washed_at: now }).catch(() => {});
    toast(e.target.checked ? "Added to your wash queue" : "Washed. Out of your wash queue.");
  });
  panel.querySelector("#for-sale")?.addEventListener("change", async (e) => {
    await updateAlbum(a.id, { for_sale: e.target.checked }).catch(() => {});
    toast(e.target.checked ? "Marked for sale" : "No longer for sale");
  });
  const notes = panel.querySelector("#notes");
  notes.addEventListener("change", () => updateAlbum(a.id, { notes: notes.value || null }).then(() => toast("Note saved")).catch(() => {}));
  // Records Discogs can’t help with (a private pressing, a bespoke recording) can leave "Needs a look".
  panel.querySelector("#keep-as-is")?.addEventListener("click", async () => {
    const was = a.enrich_status;
    await updateAlbum(a.id, { enrich_status: was === "review" ? "matched" : "manual" }).catch(() => {});
    toast(was === "review" ? "Match confirmed" : "Kept as it is. It won’t need a look again.");
  });
  panel.querySelector("#edit-open")?.addEventListener("click", () => { state.editing = true; renderOverlay(); });
  panel.querySelector("#edit-cancel")?.addEventListener("click", () => { state.editing = false; renderOverlay(); });
  panel.querySelector("#edit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const year = parseInt(f.get("year"), 10);
    const first = parseInt(f.get("original_year"), 10);
    state.editing = false;
    await updateAlbum(a.id, {
      artist: f.get("artist").trim(), title: f.get("title").trim(),
      year: Number.isFinite(year) ? year : null, catno: f.get("catno").trim() || null,
      genres: f.get("genres").split(",").map((s) => s.trim()).filter(Boolean),
      ...(f.has("original_year") ? { original_year: Number.isFinite(first) ? first : null } : {}),
    }).catch(() => {});
    // "File under" belongs to the artist, so it’s set on every record by them.
    if (f.has("sort_as")) {
      const sortAs = f.get("sort_as").trim() || null;
      if ((a.sort_as || null) !== sortAs) {
        const artist = fold(f.get("artist"));
        const ids = state.albums.filter((x) => !x._pending && fold(x.artist) === artist).map((x) => x.id);
        await Promise.all(ids.map((id) => state.store.update(id, { sort_as: sortAs }).then(replaceAlbum).catch(() => {})));
        renderAll();
        toast(sortAs ? `Filed under “${sortAs}”` : "Filed by surname again");
        return;
      }
    }
    toast("Changes saved");
  });
  panel.querySelector("#delete").addEventListener("click", async () => {
    const msg = a.status === "want" ? `Remove “${a.title}” from your want list?` : `Delete “${a.title}” from your collection? This can’t be undone.`;
    if (!(await askConfirm(msg, { yes: a.status === "want" ? "Remove" : "Delete", danger: true }))) return;
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
  wireCrates(panel, a);
  panel.querySelector("#price-refresh")?.addEventListener("click", () => checkPrice(byId(a.id), true));
  // Want-list prices refresh themselves when the record is opened and the last check is old.
  if (a.status === "want" && priceStale(a)) checkPrice(a);
}

function renderFix(a) {
  const f = state.fix;
  const list = f.candidates
    ? f.candidates.length
      ? `<ul class="cands">${f.candidates.map((c) => `
          <li><button data-ref="${c.type}/${c.id}">
            <span class="thumb mini">${c.thumb ? `<img src="${esc(c.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="blank" style="--h:${hue(c.title)}"><span class="disc"></span></span>`}</span>
            <span class="row-text"><span class="row-title">${esc(typeset(c.title))}</span>
            ${c.type === "master"
              ? `<span class="cand-line">${esc([c.year && `Released ${c.year}`, "Any pressing: uses the original LP"].filter(Boolean).join(" · "))}</span>`
              : `<span class="cand-line">${esc([...candYears(c), c.country, [c.label, c.catno].filter(Boolean).join(" ")].filter(Boolean).join(" · "))}</span>
                 ${c.format ? `<span class="cand-format">${esc(c.format)}</span>` : ""}`}</span>
            <span class="use">Use this</span>
          </button></li>`).join("")}</ul>`
      : `<p class="note">${f.anyFormat ? "No results." : "No vinyl pressings found."} Try different words, or paste a link to the album’s Discogs page.</p>`
    : "";
  const formatSwitch = f.candidates && !f.busy
    ? `<p class="hint">${f.anyFormat ? "Showing every format." : "Showing vinyl only."} <button class="linkish" id="fix-any">${f.anyFormat ? "Vinyl only" : "Include CDs and other formats"}</button></p>`
    : "";
  return `<section class="block fix" id="fix">
    <h3>Fix the match</h3>
    <form id="fix-form" class="fix-form">
      <input id="fix-q" placeholder="Search Discogs, or paste a Discogs or Bandcamp link" value="${esc(f.lastQuery || `${a.artist} ${a.title}`)}">
      <button class="btn primary" ${f.busy ? "disabled" : ""}>${f.busy ? "Searching…" : "Search"}</button>
    </form>
    ${f.error ? `<p class="note warn">${esc(f.error)}</p>` : ""}
    ${formatSwitch}
    ${list}
  </section>`;
}

function wireFix(panel, a) {
  panel.querySelector("#fix-form")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const v = $("#fix-q").value.trim();
    if (/discogs\.com\/.*(release|master)\/\d+/i.test(v) || /^\[?[rm]?\d+\]?$/i.test(v)) return applyRef(a, v);
    if (/^https?:\/\//i.test(v)) return applyBandcamp(a, v);   // any other link: Bandcamp (artists can use their own domains)
    runFixSearch(a, v);
  });
  panel.querySelectorAll("[data-ref]").forEach((b) => b.addEventListener("click", () => applyRef(a, b.dataset.ref)));
  panel.querySelector("#fix-any")?.addEventListener("click", () => {
    state.fix = { ...state.fix, anyFormat: !state.fix.anyFormat };
    runFixSearch(a, state.fix.lastQuery || `${a.artist} ${a.title}`);
  });
}

async function runFixSearch(a, q) {
  state.fix = { ...state.fix, busy: true, error: "", lastQuery: q };
  renderOverlay();
  try {
    const r = await api({ op: "search", q, any: state.fix && state.fix.anyFormat ? "1" : "0" });
    state.fix = { ...state.fix, busy: false, candidates: r.candidates || [] };
  } catch (e) {
    state.fix = { ...state.fix, busy: false, error: e.message };
  }
  renderOverlay();
}

async function bandcampApi(url) {
  const token = await state.store.token();
  const res = await fetch(`/api/bandcamp?${new URLSearchParams({ url })}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!/json/.test(res.headers.get("content-type") || "")) throw new Error(missingFunction("bandcamp"));
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) throw new Error("Your session expired. Sign in again.");
  if (!res.ok) throw new Error(body.error || `Couldn’t read that page (${res.status})`);
  return body;
}

async function applyBandcamp(a, url) {
  state.fix = { ...state.fix, busy: true, error: "" };
  renderOverlay();
  try {
    const r = await bandcampApi(url);
    state.fix = null;
    await updateAlbum(a.id, releasePatch(a, r.release, "matched"));
    const now = byId(a.id);
    toast(`Details from Bandcamp: ${now.title}, ${now.artist}`);
  } catch (e) {
    state.fix = { ...state.fix, busy: false, error: e.message };
    renderOverlay();
  }
}

async function applyRef(a, ref) {
  state.fix = { ...state.fix, busy: true, error: "" };
  renderOverlay();
  try {
    const r = await api({ op: "fetch", ref, artist: a.artist, exact: "1" });
    if (!r.release) throw new Error("That Discogs page couldn’t be loaded. Check the link.");
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
  // Hide options whose image doesn’t exist (Cover Art Archive doesn’t have every album).
  panel.querySelectorAll(".cover-opt img").forEach((img) => img.addEventListener("error", () => img.closest(".cover-opt")?.remove()));
  panel.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", async () => {
    const im = state.cover.images[Number(b.dataset.pick)];
    // From a slow source: keep our own copy, so it loads as quickly as the rest.
    if (slowCover(im.url) && state.store.mode === "live") {
      setCover({ busy: "Saving a copy of that image…", error: "" });
      try { return await saveOwnImage(a, await downloadImage(im.url), setCover); }
      catch (err) { return setCover({ busy: "", error: err.message }); }
    }
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
    try { await saveOwnImage(a, await downloadImage(url), setCover); }
    catch (err) { setCover({ busy: "", error: err.message }); }
  });
}

// Downloads an image through the app's server (most sites can't be fetched from the browser directly).
async function downloadImage(url) {
  const token = await state.store.token();
  const res = await fetch(`/api/image?${new URLSearchParams({ url })}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!/json|image/.test(res.headers.get("content-type") || "")) throw new Error(missingFunction("image"));
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn’t download that image.");
  return res.blob();
}

// Covers that load slowly from where they live: the Cover Art Archive forwards each image through the
// Internet Archive, and iTunes images are served at full size. A cover chosen from there is saved to
// your own storage instead, with a small copy for lists.
const slowCover = (url) => /coverartarchive\.org|archive\.org|mzstatic\.com/i.test(url || "");

async function saveOwnImage(a, blob, setCover) {
  setCover({ busy: "Saving your image…", error: "" });
  try {
    const [full, small] = await Promise.all([resizeImage(blob, 1400, false), resizeImage(blob, 320, true)]);
    const urls = await state.store.uploadCover(a.id, full, small);
    state.cover = null;
    await updateAlbum(a.id, { ...urls, cover_locked: true });
    toast("Cover updated");
  } catch (e) {
    setCover({ busy: "", error: /decode|load/i.test(e.message) ? "That file isn’t an image this browser can read. Try a JPEG or PNG." : e.message });
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
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn’t load that image"))), "image/jpeg", 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn’t load that image")); };
    img.src = url;
  });
}

// ---------- person ----------
// "Leader on 2, plays on 5, composer on 3"
function personSummary(items) {
  const n = { leader: 0, player: 0, composer: 0, other: 0 };
  for (const i of items) n[creditKind(i)]++;
  const parts = [n.leader && `leader on ${n.leader}`, n.player && `plays on ${n.player}`, n.composer && `composer on ${n.composer}`, n.other && `credited on ${n.other}`].filter(Boolean);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function renderPerson(key) {
  const p = state.index.people.get(key);
  if (!p) return hideOverlay();
  const kinds = { leader: [], player: [], composer: [], other: [] };
  for (const i of p.items) kinds[creditKind(i)].push(i);
  const wanted = p.items.filter((i) => i.album.status === "want").length;
  const discogsId = p.items.map((i) => creditsFor(i.album).find((c) => personKey(c.name) === key)?.id).find(Boolean);
  const allTracks = (a) => (a.tracks || []).length;
  const itemRow = (i) => {
    const on = i.tracks.length && i.tracks.length < allTracks(i.album) ? ` <span class="on">on ${i.tracks.map(esc).join(", ")}</span>` : "";
    return row(i.album, `<span class="${creditKind(i) === "leader" ? "role lead" : "role"}">${esc(roleLabel(i))}</span>${on}`);
  };
  const summary = personSummary(p.items) + (wanted ? `. ${wanted} on your want list.` : ".");
  // Their own records need no role line; the record page has the detail.
  const section = (title, items, plain = false) => (items.length ? `<section><h3>${title}</h3><div class="rows">${items.map((i) => (plain ? row(i.album) : itemRow(i))).join("")}</div></section>` : "");

  openPanel(`
    <div class="panel-bar">
      <button class="icon-btn" data-close aria-label="Back">${ICON.back}</button>
    </div>
    <article class="person">
      <h2 class="person-name">${esc(p.name)}</h2>
      <p class="person-sum">${summary}</p>
      ${section("Their records", kinds.leader, true)}
      ${section(kinds.leader.length || kinds.composer.length ? "As a player" : "Records", kinds.player)}
      ${section("Their music, played by others", kinds.composer)}
      ${section("Other credits", kinds.other)}
      ${discogsId ? `<p class="footer-actions"><a class="btn" href="https://www.discogs.com/artist/${discogsId}" target="_blank" rel="noopener">See full discography on Discogs</a></p>` : ""}
    </article>`, "person");
}

// ---------- add a record ----------
function renderAdd(prefill) {
  if (!state.owner) { viewOnly(); return closeOverlay(); }
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
        <label><span>Crate<span class="hint">optional</span></span><input name="crate" list="add-crate-names" value="${esc(state.crate)}" placeholder="Japanese" autocomplete="off" maxlength="60"><datalist id="add-crate-names">${state.index.crates.map((c) => `<option value="${esc(c.name)}">`).join("")}</datalist></label>
        <label><span>Bandcamp link<span class="hint">if it isn’t on Discogs</span></span><input name="bandcamp" type="url" inputmode="url" placeholder="https://artist.bandcamp.com/album/…"></label>
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
    const bandcamp = (f.get("bandcamp") || "").trim();
    const crate = cleanCrate(f.get("crate"));
    if (crate) row.crates = [crate];
    if (bandcamp && !/^https?:\/\//i.test(bandcamp)) { toast("Paste the full Bandcamp link, starting with https://"); return; }
    const dupe = state.albums.find((a) => fold(a.artist) === fold(row.artist) && fold(a.title) === fold(row.title));
    if (dupe && !(await askConfirm(dupe.status === "want" ? "That’s already on your want list. Add it again?" : "You already own that one. Add it anyway?", { yes: "Add anyway" }))) return;
    $("#add-submit").disabled = true;
    try {
      let saved;
      try { saved = await state.store.insert(row); }
      catch (e) {
        // Crates not set up yet: save the record anyway, without its crate.
        if (!row.crates || !/crates/i.test(e.message || "")) throw e;
        delete row.crates;
        saved = await state.store.insert(row);
        setTimeout(() => toast(SETUP_CRATES), 2800);
      }
      setAlbums([...state.albums, saved]);
      renderResults();
      toast(row.status === "want" ? "Added to want list" : "Added to collection");
      // Show the new record while its details are looked up.
      if (state.store.canEnrich) state.lookingUp.add(saved.id);
      location.replace(`#/album/${encodeURIComponent(saved.id)}`);
      if (state.store.canEnrich) {
        (bandcamp ? lookUpBandcamp(saved, bandcamp) : enrichOne(saved)).then(renderAll).catch(() => {
          state.lookingUp.delete(saved.id); renderAll();
          toast("Couldn’t look up details right now. Try “Find on Discogs” later.");
        });
      }
    } catch {
      // No signal: keep it on this phone and sync later.
      const pending = { ...row, id: "pending-" + Date.now(), _pending: true, genres: [], tracks: [], credits: [], personnel_hint: [], enrich_status: "pending", created_at: new Date().toISOString() };
      outbox.push(pending);
      setAlbums([...state.albums, pending]);
      closeOverlay(); renderResults();
      toast("Saved on this phone. It’ll sync next time you’re online.");
    }
  });
}

// ---------- tools / enrichment ----------
function renderTools() {
  const by = (s) => state.albums.filter((a) => a._pending ? false : a.enrich_status === s);
  const pending = by("pending"), review = by("review"), missing = by("not_found"), errors = by("error"), done = by("matched"), kept = by("manual");
  const noSides = state.albums.filter(fromCDListing);
  const e = state.enrich;
  const mode = state.store.mode;
  const pct = e.total ? Math.round((e.done / e.total) * 100) : 0;

  const owned = state.albums.filter((x) => x.status !== "want").length, wanted = state.albums.length - owned;
  const toWash = state.albums.filter((x) => x.status === "owned" && x.to_wash_since).length;
  const notFound = missing.length + errors.length;
  const cdWants = state.albums.filter((x) => !x._pending && x.status === "want" && notVinyl(x) && x.enrich_status === "matched");
  const sec = (title, note, body) => `<section class="sec">
        <div class="sec-head"><h3>${title}</h3>${note ? `<span>${note}</span>` : ""}</div>
        ${body}
      </section>`;
  // One action per row: what it’s about on the left, a same-width button on the right.
  const action = (text, hint, button) => `<div class="card-row">
          <div class="card-text"><p>${text}</p>${hint ? `<p class="hint">${hint}</p>` : ""}</div>
          ${button}
        </div>`;
  const lookups = state.store.canEnrich || !state.owner;

  const panel = openPanel(`
    <div class="panel-bar">
      <h2 class="panel-title">Collection</h2>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div>
    <div class="tools">
      <p class="tools-sub">${plural(owned, "record")}${wanted ? ` · ${wanted} wanted` : ""}${toWash ? ` · ${toWash} to wash` : ""}${state.index.crates.length ? ` · ${plural(state.index.crates.length, "crate")}` : ""}</p>
      ${mode === "demo" ? `<p class="note">You’re looking at demo mode with a small sample collection. Changes stay in this browser. Connect Supabase and Discogs (see the README) to use your own records.</p>` : ""}
      ${mode === "offline" ? `<p class="note">You’re offline, showing the copy saved on this device. Want-list adds will sync when you reconnect.</p>` : ""}

      ${sec("Album details", "Covers, tracks, personnel", `<div class="card">
        <dl class="stat-strip">
          <div><dt>Done</dt><dd>${done.length + kept.length}</dd></div>
          <div><dt>To fetch</dt><dd>${pending.length}</dd></div>
          <div class="${review.length ? "warn" : ""}"><dt>Check</dt><dd>${review.length}</dd></div>
          <div class="${notFound ? "warn" : ""}"><dt>Not found</dt><dd>${notFound}</dd></div>
        </dl>
        ${e.running ? `<div class="card-row progress-row">
          <div class="card-text">
            <div class="progress" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
            <p class="hint">${e.done} of ${e.total}. ${esc(e.current)}${e.note ? ` ${esc(e.note)}` : ""}</p>
          </div>
          <button class="btn" id="stop">Stop</button>
        </div>`
        : lookups ? `
          ${pending.length ? action(`${plural(pending.length, "record")} to fetch`, `About ${Math.max(1, Math.round(pending.length * 4 / 60))} min. Keep this screen open; you can stop and pick up later.`, `<button class="btn primary" id="run">Fetch</button>`) : ""}
          ${notFound ? action(`${plural(notFound, "record")} ${notFound === 1 ? "wasn’t" : "weren’t"} found on Discogs.`, "", `<button class="btn" id="retry">Try again</button>`) : ""}
          ${slowCovers().length ? action(`${plural(slowCovers().length, "cover")} loading slowly`, "Chosen from the Cover Art Archive or iTunes, which are slow to serve images. Save a copy to your own storage so they load like the rest.", `<button class="btn" id="copy-covers">Save copies</button>`) : ""}
          ${state.store.mode === "live" && !washReady() ? `<div class="card-row"><p class="hint">To keep a wash queue, run supabase/updates/009_wash_queue.sql in Supabase, then reload.</p></div>` : ""}
          ${state.store.mode === "live" && !originalReady() ? `<div class="card-row"><p class="hint">To show the year each album first came out, run supabase/updates/008_original_year.sql in Supabase, then reload.</p></div>` : ""}
          ${noSides.length ? action(`${plural(noSides.length, "track list")} ${noSides.length === 1 ? "looks" : "look"} like ${noSides.length === 1 ? "a CD" : "CDs"}`, "No sides listed. Switch to the vinyl LP.", `<button class="btn" id="vinyl">Switch</button>`) : ""}`
        : ""}
      </div>`)}

      ${review.length + notFound + cdWants.length ? sec("Needs a look", "Open one, then Fix match", `<div class="card card-list">
        <div class="rows">${[...review, ...missing, ...errors, ...cdWants].map((a) => row(a, a.enrich_status === "review" ? "Check match" : a.enrich_status === "matched" ? "Not vinyl" : "Not found")).join("")}</div>
      </div>`) : ""}

      ${lookups ? sec("Want-list prices", "From Discogs", `<div class="card">
        ${!pricesReady() ? `<div class="card-row"><p class="hint">${esc(SETUP_PRICES)}</p></div>`
          : priceable().length ? action(`${plural(priceable().length, "wanted record")} on Discogs`, "Prices also update when you open any wanted album.", `<button class="btn" id="prices-all">Refresh all</button>`)
          : `<div class="card-row"><p class="hint">Wanted records matched on Discogs show their lowest marketplace price.</p></div>`}
      </div>`) : ""}

      ${sec("Crates", "Your own groupings", `<div class="card">
        ${state.index.crates.length ? `<ul class="crate-list">${state.index.crates.map((c) => `<li>
            <button class="crate-name" data-crate-open="${esc(c.name)}">${esc(c.name)} <span>${c.count}</span></button>
            <button class="icon-btn" data-crate-rename="${esc(c.name)}" aria-label="Rename ${esc(c.name)}">${ICON.pencil}</button>
            <button class="icon-btn danger" data-crate-delete="${esc(c.name)}" aria-label="Delete ${esc(c.name)}">${ICON.trash}</button>
          </li>`).join("")}</ul>` : ""}
        <p class="hint card-foot">${state.index.crates.length ? "To make a crate" : "Crates are your own groupings, like “Japanese” or “Late night”. To make one"}, tap the select button on the main screen, pick records, then Add to crate.</p>
      </div>`)}

      ${sec("Add records", "Duplicates are skipped", `<div class="import-tiles">
        <a class="import-tile" href="#/import/discogs" data-import>${ICON.disc}<span><strong>From Discogs</strong><span>Collection or want list, by username</span></span></a>
        <a class="import-tile" href="#/import/csv" data-import>${ICON.sheet}<span><strong>From a spreadsheet</strong><span>Any CSV file, columns matched for you</span></span></a>
      </div>`)}

      ${sec(mode === "live" ? "Backup and account" : "Backup", "", `<div class="card">
        <button class="list-row" id="export"><span><strong>Download a copy</strong><span>Get a CSV of all your albums, with tracks, personnel and notes</span></span>${ICON.download}</button>
        <button class="list-row" id="backup"><span><strong>Download a backup</strong><span>A complete copy that restores everything exactly (JSON)</span></span>${ICON.download}</button>
        <a class="list-row" href="#/import/backup" data-import><span><strong>Restore from a backup</strong><span>Bring back albums from a backup file</span></span>${ICON.upload}</a>
        ${MAKE_DEMO && state.store.canEnrich ? `<button class="list-row" id="make-demo"><span><strong>Make demo data</strong><span>Looks up the demo albums on Discogs and downloads demo.json</span></span>${ICON.download}</button>` : ""}
        ${mode === "live" ? `<button class="list-row" id="signout"><span><strong>Sign out</strong></span>${ICON.signout}</button>` : ""}
      </div>`)}
    </div>`, "tools");

  panel.querySelector("#run")?.addEventListener("click", () => runEnrich(["pending"]));
  panel.querySelector("#retry")?.addEventListener("click", () => runEnrich(["not_found", "error"]));
  panel.querySelector("#copy-covers")?.addEventListener("click", () => { coversCopied = 0; coversFailed = 0; runQueue(slowCovers(), copySlowCover, coversFinished); });
  panel.querySelector("#vinyl")?.addEventListener("click", () => runQueue(state.albums.filter(fromCDListing), refetchVinyl, "Finished switching to vinyl pressings"));
  panel.querySelector("#stop")?.addEventListener("click", () => { state.enrich.stop = true; state.enrich.note = "Stopping…"; renderOverlay(); });
  panel.querySelector("#export").addEventListener("click", exportCSV);
  panel.querySelector("#backup").addEventListener("click", exportBackup);
  panel.querySelector("#make-demo")?.addEventListener("click", (e) => makeDemoData(e.currentTarget));
  panel.querySelector("#prices-all")?.addEventListener("click", () => runQueue(priceable(), (a) => checkPrice(a, true, true), "Prices updated"));
  panel.querySelectorAll("[data-crate-open]").forEach((b) => b.addEventListener("click", () => { state.crate = b.dataset.crateOpen; state.genre = ""; setQuery(""); }));
  panel.querySelectorAll("[data-crate-rename]").forEach((b) => b.addEventListener("click", () => renameCrate(b.dataset.crateRename)));
  panel.querySelectorAll("[data-crate-delete]").forEach((b) => b.addEventListener("click", () => deleteCrate(b.dataset.crateDelete)));
  panel.querySelector("#signout")?.addEventListener("click", async () => { await state.store.signOut(); location.hash = ""; location.reload(); });
}

// A reply that isn’t from our function (Netlify’s "page not found") means the server file isn’t deployed.
function missingFunction(name) {
  return `The ${name} lookup isn’t on your site yet. Check that netlify/functions/${name}.mjs is in your GitHub repo, then let Netlify redeploy.`;
}

async function api(params) {
  const token = await state.store.token();
  const res = await fetch(`/api/discogs?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!/json/.test(res.headers.get("content-type") || "")) throw new Error(missingFunction("discogs"));
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) return { rateLimited: true, retryAfter: body.retryAfter || 30 };
  if (res.status === 401) throw new Error("Your session expired. Sign in again.");
  if (!res.ok) throw new Error(body.error || `Discogs lookup failed (${res.status})`);
  return body;
}

function releasePatch(a, rel, status) {
  const patch = {
    discogs_id: rel.discogs_id, discogs_url: rel.discogs_url, year: rel.year, label: rel.label,
    ...(pricesReady() ? { master_id: rel.master_id ?? null } : {}),
    ...(originalReady() && rel.original_year ? { original_year: rel.original_year } : {}),
    cover_url: rel.cover_url, thumb_url: rel.thumb_url, tracks: rel.tracks, credits: rel.credits,
    enrich_status: status,
  };
  if (a.cover_locked) { delete patch.cover_url; delete patch.thumb_url; }
  // Use Discogs' artist and title, unless this is only a possible match waiting to be checked.
  if (status !== "review") {
    if (rel.discogs_artist) patch.artist = rel.discogs_artist;
    if (rel.discogs_title) patch.title = rel.discogs_title;
  }
  // The catalogue number follows the pressing, like the label and year (a possible match leaves it alone).
  if (rel.label_catno && (status !== "review" || !a.catno)) patch.catno = rel.label_catno;
  if (rel.credits_text && !a.notes) patch.notes = `Credits from Bandcamp:\n${rel.credits_text}`;
  if (!(a.genres || []).length && (rel.discogs_genres || []).length) patch.genres = rel.discogs_genres;
  return patch;
}

async function enrichOne(a) {
  state.lookingUp.add(a.id);
  try { return await enrichOnce(a); } finally { state.lookingUp.delete(a.id); }
}

// Calls the lookup, waiting politely if Discogs says we’re going too fast.
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
  const exact = a.discogs_id && a.enrich_status === "pending";   // imported from Discogs: the pressing is known
  const r = exact
    ? await politeApi({ op: "fetch", ref: `release/${a.discogs_id}`, artist: a.artist, exact: "1" })
    : await politeApi({ op: "match", artist: a.artist, title: a.title, catno: a.catno || "" });
  if (!r) return 0;
  const patch = r.release ? releasePatch(a, r.release, r.status) : { enrich_status: "not_found" };
  await updateAlbum(a.id, patch);
  return r.rateRemaining;
}

// TEMPORARY: "?makedemo" adds a row to the Collection page that fills demo.json's sample albums
// with Discogs details (covers, tracks, personnel, years, want-list prices). Remove once demo.json is updated.
const MAKE_DEMO = new URLSearchParams(location.search).has("makedemo");
async function makeDemoData(btn) {
  const label = btn.querySelector("strong");
  btn.disabled = true;
  try {
    const sample = await (await fetch("demo.json", { cache: "no-store" })).json();
    const out = [];
    for (const [i, d] of sample.entries()) {
      label.textContent = `Looking up ${i + 1} of ${sample.length}…`;
      const row = { ...d };
      try {
        const r = await politeApi({ op: "match", artist: d.artist, title: d.title, catno: d.catno || "" });
        if (r?.release) {
          Object.assign(row, releasePatch(d, r.release, r.status), { master_id: r.release.master_id ?? null, original_year: r.release.original_year ?? null });
          if (row.status === "want" && row.discogs_id) {
            const p = await politeApi({ op: "price", id: row.discogs_id, master: row.master_id ? "0" : "1", fmt: "1" });
            if (p?.price) row.price = { value: p.price.value, currency: p.price.currency, for_sale: p.price.for_sale, release: row.discogs_id, vinyl: p.price.vinyl ?? null, format: p.price.format || null, checked_at: new Date().toISOString() };
          }
        } else row.enrich_status = r ? "not_found" : "error";
      } catch (e) { row.enrich_status = "error"; row._error = e.message; }
      out.push(row);
      await sleep(1500);
    }
    download("demo.json", JSON.stringify(out, null, 1), "application/json");
    label.textContent = "Downloaded demo.json";
  } catch (e) {
    label.textContent = "Make demo data"; toast(e.message);
  } finally { btn.disabled = false; }
}

async function lookUpBandcamp(a, url) {
  state.lookingUp.add(a.id);
  try {
    const r = await bandcampApi(url);
    await updateAlbum(a.id, releasePatch(a, r.release, "matched"));
  } finally { state.lookingUp.delete(a.id); }
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

// One-time: covers chosen from slow sources before they were copied, copied now.
const slowCovers = () => (state.store?.mode === "live" ? state.albums.filter((a) => !a._pending && slowCover(a.cover_url)) : []);
let coversCopied = 0, coversFailed = 0;
async function copySlowCover(a) {
  try {
    const blob = await downloadImage(a.cover_url);
    const [full, small] = await Promise.all([resizeImage(blob, 1400, false), resizeImage(blob, 320, true)]);
    await updateAlbum(a.id, { ...(await state.store.uploadCover(a.id, full, small)), cover_locked: true });
    coversCopied++;
  } catch { coversFailed++; }   // left as it is; it can be tried again
  return 60;                     // not a Discogs lookup: no need to wait between covers
}
function coversFinished() {
  const msg = `Saved ${plural(coversCopied, "cover")} to your storage`;
  const failed = coversFailed;
  coversCopied = 0; coversFailed = 0;
  return failed ? `${msg}. ${plural(failed, "cover")} couldn’t be downloaded; try again later.` : msg + ".";
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
  toast(e.stop ? "Stopped. Pick up where you left off any time." : typeof finished === "function" ? finished() : finished);
}

function download(name, text, type) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const fileDate = () => new Date().toISOString().slice(0, 10);
const fileSlug = () => (state.settings.siteName || "garage-crates").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "garage-crates";

// Every album with its tracks, personnel and notes, one row each, in the order the list shows them.
function exportCSV() {
  download(`${fileSlug()}-${fileDate()}.csv`, collectionCSV(state.index.list.map(({ album }) => album)), "text/csv;charset=utf-8");
}

// Everything, exactly as stored, for restoring later.
function exportBackup() {
  download(`${fileSlug()}-backup-${fileDate()}.json`, JSON.stringify(collectionBackup(state.albums, state.settings.siteName), null, 1), "application/json");
}

// ---------- misc ----------
function setQuery(q) {
  state.q = q; $("#q").value = q;
  closeOverlay();
  setTimeout(() => { renderResults(); window.scrollTo({ top: 0 }); }, 0);
}

let toastTimer;
// The app's own "Are you sure?". The browser's confirm() popup is unreliable on iOS, especially in an app
// added to the home screen, where it can fail to appear, so a tap on Remove did nothing.
// With `input`, it also asks for some text (prefilled with `input`) and answers with it, or null on Cancel.
function askConfirm(message, { yes = "OK", danger = false, input } = {}) {
  return new Promise((resolve) => {
    document.querySelector(".confirm-sheet")?.remove();
    const sheet = document.createElement("div");
    sheet.className = "confirm-sheet";
    sheet.innerHTML = `<div class="confirm-card" role="alertdialog" aria-modal="true" aria-labelledby="confirm-msg">
        <p id="confirm-msg">${esc(message)}</p>
        ${input !== undefined ? `<input type="text" class="confirm-input" aria-labelledby="confirm-msg" value="${esc(input)}">` : ""}
        <div class="confirm-actions">
          <button class="btn" data-answer="no">Cancel</button>
          <button class="btn ${danger ? "danger-fill" : "primary"}" data-answer="yes">${esc(yes)}</button>
        </div>
      </div>`;
    const field = () => sheet.querySelector(".confirm-input");
    const done = (answer) => {
      document.removeEventListener("keydown", onKey, true); sheet.remove();
      resolve(input !== undefined ? (answer ? field()?.value ?? "" : null) : answer);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); done(false); }
      else if (e.key === "Enter" && e.target === field()) { e.preventDefault(); done(true); }
    };
    sheet.addEventListener("click", (e) => {
      const b = e.target.closest("[data-answer]");
      if (b) done(b.dataset.answer === "yes");
      else if (e.target === sheet) done(false);   // tapping outside the card cancels
    });
    document.addEventListener("keydown", onKey, true);
    document.body.append(sheet);
    if (field()) { field().focus({ preventScroll: true }); field().select(); }
    else sheet.querySelector('[data-answer="no"]').focus({ preventScroll: true });
  });
}

function toast(msg) {
  const t = $("#toast"); if (!t) return;
  t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

// With a guest account set up, the passphrase comes first; the owner signs in with email and password.
function renderLogin(error = "", mode) {
  const guest = !!state.settings.guestEmail;
  mode = mode || (guest ? "guest" : "owner");
  document.title = state.settings.siteName;
  $("#app").innerHTML = `
    <main class="login">
      <h1>${esc(state.settings.siteName)}</h1>
      ${mode === "guest" ? `
        <form id="login-guest">
          <label>Passphrase<input name="passphrase" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required></label>
          ${error ? `<p class="note warn">${esc(error)}</p>` : ""}
          <button class="btn primary big">Look around</button>
        </form>
        <button class="linkish login-switch" id="to-owner">Owner sign in</button>`
      : `
        <form id="login">
          <label>Email<input name="email" type="email" autocomplete="username" required></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
          ${error ? `<p class="note warn">${esc(error)}</p>` : ""}
          <button class="btn primary big">Sign in</button>
        </form>
        ${guest ? `<button class="linkish login-switch" id="to-guest">I have a passphrase</button>` : ""}`}
    </main>`;
  $("#to-owner")?.addEventListener("click", () => renderLogin("", "owner"));
  $("#to-guest")?.addEventListener("click", () => renderLogin("", "guest"));
  $("#login-guest")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    try { await state.store.signIn(state.settings.guestEmail, new FormData(e.target).get("passphrase")); boot(); }
    catch (err) { renderLogin(/invalid/i.test(err.message) ? "That passphrase didn’t work. Check it and try again." : err.message, "guest"); }
  });
  $("#login")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try { await state.store.signIn(f.get("email"), f.get("password")); boot(); }
    catch (err) { renderLogin(/invalid/i.test(err.message) ? "That email and password don’t match. Try again." : err.message, "owner"); }
  });
  // Put the cursor in the first field, unless someone has already started typing somewhere.
  setTimeout(() => { if (!document.activeElement || document.activeElement === document.body) $("#app input")?.focus(); }, 50);
}

// ---------- view only ----------
// Guests see every control, greyed out; tapping one explains why instead of doing anything.
// The database refuses guest changes regardless; this just keeps the screen honest.
const EDIT_CONTROLS = [
  'a.fab[href="#/add"]', '.empty a.btn[href^="#/add"]', "#select-toggle",
  "#got-it", ".switch-row", "#for-sale", "#needs-wash", "#sel-washed", "#notes",
  "#cover-find", "#cover-own", "#crate-add-open", "[data-crate-rm]",
  "#fix-open", "#keep-as-is", "#refresh", "#edit-open", "#delete", "#price-refresh",
  "#run", "#retry", "#copy-covers", "#vinyl", "#prices-all", "[data-crate-rename]", "[data-crate-delete]", "[data-import]",
].join(", ");

function viewOnly() { toast("This is a view-only copy. Only the owner can make changes."); }

function markViewOnly(root) {
  if (state.owner || !root.querySelectorAll) return;
  const els = [...(root.matches?.(EDIT_CONTROLS) ? [root] : []), ...root.querySelectorAll(EDIT_CONTROLS)];
  for (const el of els) {
    el.setAttribute("aria-disabled", "true");
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") el.readOnly = true;
  }
}

function startViewOnly() {
  if (document.body.classList.contains("view-only")) return;   // already watching
  document.body.classList.add("view-only");
  markViewOnly(document.body);
  new MutationObserver((changes) => { for (const c of changes) for (const n of c.addedNodes) markViewOnly(n); })
    .observe(document.body, { childList: true, subtree: true });
  // Capture phase: runs before any of the app’s own handlers.
  for (const type of ["click", "change"]) {
    document.addEventListener(type, (e) => {
      const el = e.target.closest?.("[aria-disabled='true']");
      if (!el) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (type === "click" && el.id !== "notes") viewOnly();
    }, true);
  }
  document.addEventListener("focusin", (e) => { if (e.target.id === "notes") viewOnly(); });
}

// Track in-app navigation so the close button can go "back".
window.addEventListener("hashchange", () => {
  if (location.hash && !(history.state && history.state.crate)) history.replaceState({ crate: true }, "");
  renderOverlay();
});

async function boot() {
  // Leftovers from the one-time catalogue check, no longer used.
  try { for (const k of ["crate.catnoChecked1", "crate.catnoPassDone1", "crate.signedIn1", "crate.worksChecked4", "crate.origTried1"]) localStorage.removeItem(k); } catch {}
  const cached = await cache.get();
  state.store = state.store || (await createStore());
  state.settings = await state.store.settings().catch(() => state.settings);
  try { localStorage.setItem("crate.settings.v1", JSON.stringify(state.settings)); } catch {}
  document.title = state.settings.siteName;
  const session = await state.store.session();
  if (!session) return renderLogin();

  state.owner = await state.store.isOwner();
  if (!state.owner) state.store.canEnrich = false;   // no lookups or automatic updates for guests

  renderShell();
  if (!state.owner) startViewOnly();
  if (state.store.mode === "live" && cached) { setAlbums(cached); renderAll(); }
  // The open album page, as it was drawn: if syncing changes nothing on it, it isn't redrawn.
  const openAlbum = () => { const r = route(); return r.name === "album" ? JSON.stringify(byId(r.arg) || null) : null; };
  const shown = openAlbum();
  try {
    const synced = state.owner ? await outbox.flush(state.store) : [];
    const rows = await state.store.load(state.store.mode === "live" ? cached : null);
    const pending = outbox.all();
    setAlbums([...rows, ...pending]);
    if (synced.length) toast(`Synced ${plural(synced.length, "want-list add")}`);
    if (state.store.canEnrich) for (const s of synced) enrichOne(s).then(renderAll).catch(() => {});
  } catch (e) {
    if (!cached) $("#results").innerHTML = emptyState(`Couldn’t load your records: ${esc(e.message)}`);
    else toast("Showing the copy saved on this device. Couldn’t reach the server.");
  }
  if (shown !== null && shown !== "null" && openAlbum() === shown) renderResults(); else renderAll();
}

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();
