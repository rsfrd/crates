// Discogs lookup + normalization. Pure helpers are exported for testing.

const API = "https://api.discogs.com";
const UA = "CrateVinylCollection/1.0 +https://netlify.app";

export class RateLimited extends Error {
  constructor(retryAfter) { super("Discogs rate limit"); this.retryAfter = retryAfter; }
}

export function makeClient(token, fetchImpl = fetch) {
  let remaining = null;
  async function get(path, params) {
    const url = new URL(API + path);
    if (params) for (const [k, v] of Object.entries(params)) if (v) url.searchParams.set(k, v);
    const res = await fetchImpl(url, {
      headers: { "User-Agent": UA, Authorization: `Discogs token=${token}`, Accept: "application/json" },
    });
    const rem = res.headers.get("x-discogs-ratelimit-remaining");
    if (rem !== null) remaining = Number(rem);
    if (res.status === 429) throw new RateLimited(Number(res.headers.get("retry-after")) || 30);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Discogs ${res.status} on ${path}`);
    return res.json();
  }
  return { get, get remaining() { return remaining; } };
}

// ---------- text matching ----------

export function norm(s = "") {
  return s
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\(\d+\)/g, " ")              // Discogs disambiguation "(2)"
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|a|an|lp|vinyl|remastered|reissue|deluxe|edition)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) { return new Set(norm(s).split(" ").filter(Boolean)); }

export function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export function scoreCandidate(cand, artist, title) {
  // Discogs search titles look like "Artist - Title"
  const full = cand.title || "";
  const i = full.indexOf(" - ");
  const cArtist = i >= 0 ? full.slice(0, i) : "";
  const cTitle = i >= 0 ? full.slice(i + 3) : full;
  const isVarious = /^various/i.test(artist);
  const t = similarity(cTitle, title);
  const a = isVarious ? (/various/i.test(cArtist) ? 1 : 0.5) : similarity(cArtist, artist);
  return 0.65 * t + 0.35 * a;
}

// ---------- credits ----------

// Split "Saxophone [Tenor], Flute" on commas that are not inside brackets.
export function splitRoles(role = "") {
  const out = []; let depth = 0, cur = "";
  for (const ch of role) {
    if (ch === "[") depth++;
    if (ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(cleanRole).filter(Boolean);
}

export function cleanRole(r) {
  r = r.trim();
  const m = r.match(/^(.*?)\s*\[(.*)\]\s*$/);
  if (!m) return r;
  const base = m[1].trim(), detail = m[2].trim();
  if (!detail) return base;
  if (/,/.test(detail) || detail.split(" ").length > 2) return `${base} (${detail})`;
  return `${detail} ${base}`;         // "Saxophone [Tenor]" -> "Tenor Saxophone"
}

const NON_MUSICAL = /produc|engineer|recorded|mix|master|lacquer|liner|photo|design|artwork|art by|art direction|cover|layout|written|composed|lyrics|music by|words by|songwriter|executive|a&r|manage|notes|supervis|coordinat|transfer|edited|editor|illustrat|painting|copyright|publish|booking|technician|assistant|tape op|other|compiled|translat|typograph|sleeve|graphics|direction|legal|licens|manufactur|distribut|market|phonographic|crew|cut by|pressed|plated|label|mastered|remix|dj mix|management|concept|creative|styling|hair|make-?up|research|annotation|reissue|restoration|authoring|programmed by|sequenced|text by|adapted/i;

export function isMusicalRole(r) {
  if (/^(featuring|leader|conductor|arranged by|orchestra|ensemble|band|choir|chorus|soloist)/i.test(r)) return true;
  return !NON_MUSICAL.test(r);
}

export function cleanName(n = "") { return n.replace(/\s*\(\d+\)\s*$/, "").replace(/\*$/, "").trim(); }

// The artist line as Discogs shows it: "Oscar Peterson & Joe Pass", "Lambert, Hendricks & Ross".
export function artistLine(artists = []) {
  const names = artists.filter((x) => x && x.name);
  if (!names.length) return "";
  if (names.length === 1 && /^various$/i.test(cleanName(names[0].name))) return "Various Artists";
  return names.map((x, i) => {
    const name = cleanName(x.name);
    if (i === names.length - 1) return name;
    const j = (x.join || "").trim();
    if (!j || j === ",") return name + ", ";
    return `${name} ${j} `;
  }).join("").replace(/\s+/g, " ").trim();
}

export function buildCredits(release, albumArtist = "") {
  const map = new Map();
  const leaderIds = new Set((release.artists || []).map((a) => a.id).filter(Boolean));
  const albumNorm = ` ${norm(albumArtist)} `;

  function add(person, roles, tracks) {
    const name = cleanName(person.name);
    if (!name || /^various$/i.test(name)) return;
    const key = person.id ? `id:${person.id}` : `n:${norm(name)}`;
    let c = map.get(key);
    if (!c) { c = { name, id: person.id || null, roles: [], tracks: [], leader: false }; map.set(key, c); }
    for (const r of roles) if (r && !c.roles.includes(r)) c.roles.push(r);
    for (const t of tracks) if (t && !c.tracks.includes(t)) c.tracks.push(t);
    if (person.id && leaderIds.has(person.id)) c.leader = true;
    if (albumNorm.includes(` ${norm(name)} `)) c.leader = true;
  }

  for (const a of release.artists || []) add(a, [], []);
  for (const ea of release.extraartists || []) {
    const tr = (ea.tracks || "").split(/\s*,\s*/).filter(Boolean);
    add(ea, splitRoles(ea.role), tr);
  }
  for (const t of flattenTracks(release.tracklist || [])) {
    for (const ea of t._extra || []) add(ea, splitRoles(ea.role), [t.pos || t.title]);
  }

  const list = [...map.values()].map((c) => ({
    ...c,
    kind: c.leader || c.roles.some(isMusicalRole) ? "musician" : "credit",
  }));
  // Leaders first, then musicians, then everyone else.
  const rank = (c) => (c.leader ? 0 : c.kind === "musician" ? 1 : 2);
  return list.sort((a, b) => rank(a) - rank(b));
}

const COMPOSER_ROLE = /compos|written|music by|^music\b/i;
const TRACK_NOTE_ROLE = /cadenza|arranged|orchestrat|transcri|libretto|lyrics|words by|text by/i;

// Headings that only mark a side or disc ("Side A", "LP 2", "B"), not a piece of music.
const SIDE_HEADING = /^(side|disc|disk|cd|lp|record|vinyl|platte|seite|face)\b[\s\w.-]{0,8}$|^[a-h]$|^(side )?(one|two|three|four)$/i;

// Flattens a Discogs track list. Classical releases group movements under a piece in two ways:
// an "index" track whose sub_tracks are the movements, or a "heading" row above them.
// Either way each movement keeps its piece as `work`.
export function flattenTracks(tl) {
  const out = [];
  let heading = null, headingId = 0, pieces = 0;
  // A track's own "Composed By" / "Written-By" credit.
  const composedBy = (t) => {
    const c = (t.extraartists || []).filter((e) => COMPOSER_ROLE.test(e.role || ""));
    return [...new Set(c.map((e) => cleanName(e.name)))].join(", ");
  };
  // Who wrote a piece: the artist on the piece row (how Discogs credits classical pieces), else its composer credit.
  const pieceBy = (t) => ((t.artists || []).length ? artistLine(t.artists) : composedBy(t));
  // Other track-level credits worth showing beside the music: "Cadenza: Raymond Meylan", "Arranged By: …".
  const trackNote = (t) => (t.extraartists || [])
    .filter((e) => TRACK_NOTE_ROLE.test(e.role || ""))
    .map((e) => `${(e.role || "").replace(/\s*\[.*?\]/g, "").trim()}: ${cleanName(e.name)}`)
    .join("; ");
  for (const t of tl) {
    if (t.type_ === "heading") {
      const h = (t.title || "").trim();
      if (h && !SIDE_HEADING.test(h)) { heading = h; headingId = ++pieces; }
      continue;
    }
    if (t.type_ === "index") {
      const work = (t.title || "").trim() || heading;
      const wi = ++pieces;                 // each piece row is its own piece, even when titles repeat
      const wby = pieceBy(t);
      (t.sub_tracks || []).forEach((sub, i) => out.push({
        pos: sub.position || (t.position ? `${t.position}${String.fromCharCode(97 + i)}` : ""),
        title: sub.title, dur: sub.duration, work, wi,
        ...(composedBy(sub) && composedBy(sub) !== wby ? { by: composedBy(sub) } : {}),
        ...(trackNote(sub) ? { note: trackNote(sub) } : {}),
        // The piece's own running time and composer, kept on its first movement.
        ...(i === 0 && t.duration ? { wdur: t.duration } : {}),
        ...(i === 0 && wby ? { wby } : {}),
        _extra: [...(t.extraartists || []), ...(sub.extraartists || [])],
      }));
      continue;
    }
    // A single-track piece credits its composer on the track itself.
    out.push({ pos: t.position, title: t.title, dur: t.duration, work: heading, wi: heading ? headingId : undefined,
      ...(composedBy(t) ? { by: composedBy(t) } : {}), ...(trackNote(t) ? { note: trackNote(t) } : {}), _extra: t.extraartists });
  }
  return out;
}

export function normalizeRelease(release, albumArtist, master) {
  const img = (release.images || []).find((i) => i.type === "primary") || (release.images || [])[0];
  const label = (release.labels || [])[0];
  const genres = [...new Set((release.genres || []).flatMap((g) => g.split(/\s*\/\s*/)))];
  return {
    discogs_id: release.id,
    master_id: release.master_id || (master && master.id) || null,
    discogs_url: release.uri || `https://www.discogs.com/release/${release.id}`,
    year: (master && master.year) || release.year || null,
    label: label ? cleanName(label.name) : null,
    label_catno: label && label.catno !== "none" ? label.catno : null,
    cover_url: img ? img.uri : null,
    thumb_url: img ? (img.uri150 || img.uri) : null,
    discogs_genres: genres,
    discogs_styles: release.styles || [],
    tracks: flattenTracks(release.tracklist || []).map(({ pos, title, dur, work, wi, wdur, wby, by, note }) => ({
      pos, title, dur,
      ...(work ? { work, wi } : {}), ...(wdur ? { wdur } : {}), ...(wby ? { wby } : {}),
      ...(by ? { by } : {}), ...(note ? { note } : {}),
    })),
    // Lets the app tell details from this version of the parser apart from older ones.
    parser: 4,
    credits: buildCredits(release, albumArtist),
    discogs_title: (release.title || "").trim(),
    format: (release.formats || []).map((f) => [f.qty && f.qty !== "1" ? `${f.qty}×` : "", f.name, ...(f.descriptions || [])].filter(Boolean).join(" ")).join(", "),
    country: release.country || null,
    discogs_artist: artistLine(release.artists),
  };
}

// ---------- matching ----------

function toCandidate(r) {
  return {
    type: r.type, id: r.id, title: r.title, year: r.year || null,
    country: r.country || null, format: (r.format || []).slice(0, 3).join(", "),
    catno: r.catno || null, thumb: r.thumb || r.cover_image || null,
    master_id: r.master_id || null,
  };
}

// ---------- vinyl pressings ----------

export function isVinylRelease(rel) {
  return (rel.formats || []).some((f) => f.name === "Vinyl");
}

// From a master's vinyl versions, the best stand-in for "the LP": a full-length LP,
// officially released, earliest first.
export function pickVinylVersion(versions = []) {
  const vinyl = versions.filter((v) => {
    const majors = v.major_formats || [];
    const fmt = `${v.format || ""}`;
    return (majors.includes("Vinyl") || /vinyl|LP/i.test(fmt)) && !/unofficial|test pressing|transcription/i.test(fmt) && (!v.status || v.status === "Accepted");
  });
  const year = (v) => { const m = String(v.released || "").match(/\d{4}/); return m ? Number(m[0]) : 9999; };
  const rank = (v) => {
    const fmt = `${v.format || ""}`;
    let r = 0;
    if (!/\bLP\b/.test(fmt)) r += 2;                      // 7"/10"/12" singles after full LPs
    if (/\b(RE|RP|Reissue|Remastered)\b/.test(fmt)) r += 1;  // originals before reissues
    return r;
  };
  return vinyl.sort((a, b) => rank(a) - rank(b) || year(a) - year(b))[0] || null;
}

async function vinylFromMaster(client, masterId, albumArtist) {
  const m = await client.get(`/masters/${masterId}`);
  if (!m) return null;
  const v = await client.get(`/masters/${masterId}/versions`, { format: "Vinyl", sort: "released", sort_order: "asc", per_page: 100 });
  const pick = pickVinylVersion((v && v.versions) || []);
  const rel = await client.get(`/releases/${pick ? pick.id : m.main_release}`);
  return rel ? normalizeRelease(rel, albumArtist, m) : null;
}

// type "master": always resolves to a vinyl pressing when one exists.
// type "release": that exact release, unless preferVinyl is on and it isn't vinyl,
// in which case the vinyl LP of the same album is used instead.
export async function fetchByRef(client, type, id, albumArtist, { preferVinyl = true } = {}) {
  if (type === "master") return vinylFromMaster(client, id, albumArtist);
  const rel = await client.get(`/releases/${id}`);
  if (!rel) return null;
  if (preferVinyl && !isVinylRelease(rel) && rel.master_id) {
    const vinyl = await vinylFromMaster(client, rel.master_id, albumArtist);
    if (vinyl) return vinyl;
  }
  return normalizeRelease(rel, albumArtist);
}

export function parseDiscogsRef(input = "") {
  const s = String(input).trim();
  let m = s.match(/(release|master)s?\/(\d+)/i);
  if (m) return { type: m[1].toLowerCase(), id: Number(m[2]) };
  m = s.match(/^\[?([rm])?(\d+)\]?$/i);
  if (m) return { type: m[1] && m[1].toLowerCase() === "m" ? "master" : "release", id: Number(m[2]) };
  return null;
}

export async function match(client, { artist, title, catno }) {
  const seen = new Map();
  const consider = (results) => {
    for (const r of results || []) {
      const key = `${r.type}:${r.id}`;
      if (seen.has(key)) continue;
      const c = toCandidate(r);
      c.score = scoreCandidate(r, artist, title);
      seen.set(key, c);
    }
  };
  const best = () => [...seen.values()].sort((a, b) => b.score - a.score)[0];
  const qArtist = /^various/i.test(artist) ? "Various" : artist;

  if (catno) {
    const r = await client.get("/database/search", { type: "release", catno, format: "Vinyl", per_page: 5 });
    consider(r && r.results);
    // A catalogue-number hit is strong evidence even if titles are worded differently.
    for (const c of seen.values()) if (c.score >= 0.45) c.score = Math.min(1, c.score + 0.2);
  }
  if (!best() || best().score < 0.8) {
    const r = await client.get("/database/search", { type: "master", artist: qArtist, release_title: title, per_page: 5 });
    consider(r && r.results);
  }
  if (!best() || best().score < 0.75) {
    const r = await client.get("/database/search", { type: "release", artist: qArtist, release_title: title, format: "Vinyl", per_page: 5 });
    consider(r && r.results);
  }
  if (!best() || best().score < 0.6) {
    const r = await client.get("/database/search", { q: `${artist} ${title}`, per_page: 8 });
    consider((r && r.results || []).filter((x) => x.type === "release" || x.type === "master"));
  }

  const candidates = [...seen.values()].sort((a, b) => b.score - a.score).slice(0, 6);
  const top = candidates[0];
  if (!top || top.score < 0.45) return { status: "not_found", release: null, candidates };

  const release = await fetchByRef(client, top.type, top.id, artist);
  if (!release) return { status: "not_found", release: null, candidates };
  return { status: top.score >= 0.75 ? "matched" : "review", release, candidates, score: top.score };
}

// Marketplace figures for one release, in US dollars: the lowest listed price (any seller, before shipping)
// and how many copies are for sale. Also the album family, when asked for.
export async function marketplace(client, releaseId, { withMaster = false } = {}) {
  const stats = await client.get(`/marketplace/stats/${releaseId}`, { curr_abbr: "USD" });
  let masterId = null;
  if (withMaster) {
    const rel = await client.get(`/releases/${releaseId}`);
    masterId = (rel && rel.master_id) || null;
  }
  const low = stats && stats.lowest_price;
  return {
    value: low && Number.isFinite(Number(low.value)) ? Math.round(Number(low.value) * 100) / 100 : null,
    currency: (low && low.currency) || "USD",
    for_sale: (stats && Number.isFinite(stats.num_for_sale)) ? stats.num_for_sale : 0,
    blocked: !!(stats && stats.blocked_from_sale),
    master_id: masterId,
  };
}

// ---------- importing someone's Discogs collection or want list ----------
const SPACER = /spacer\.gif/;

// One "basic_information" entry from Discogs → a record row for the app. The pressing is exact,
// so these skip matching: "Fetch details" reads that very release.
export function rowFromDiscogs(bi, status) {
  const label = (bi.labels || [])[0];
  const art = (u) => (u && !SPACER.test(u) ? u : null);
  return {
    artist: artistLine(bi.artists || []) || "Unknown artist",
    title: String(bi.title || "").trim() || "Untitled",
    year: bi.year || null,
    label: label ? cleanName(label.name) : null,
    catno: label && label.catno && label.catno.toLowerCase() !== "none" ? label.catno : null,
    genres: [...new Set(bi.genres || [])],
    discogs_id: bi.id,
    master_id: bi.master_id || null,
    discogs_url: `https://www.discogs.com/release/${bi.id}`,
    cover_url: art(bi.cover_image), thumb_url: art(bi.thumb) || art(bi.cover_image),
    status,
    enrich_status: "pending",
    vinyl: (bi.formats || []).some((f) => f.name === "Vinyl"),
    format: (bi.formats || []).map((f) => [f.name, ...(f.descriptions || [])].join(" ")).join(", "),
  };
}

export class DiscogsUserError extends Error {}

// One page (up to 100 records) of a user's collection ("collection") or want list ("wants").
export async function collectionPage(client, username, list = "collection", page = 1) {
  const user = encodeURIComponent(String(username || "").trim());
  if (!user) throw new DiscogsUserError("Enter a Discogs username.");
  const path = list === "wants" ? `/users/${user}/wants` : `/users/${user}/collection/folders/0/releases`;
  let r;
  try {
    r = await client.get(path, { page: String(page), per_page: "100", ...(list === "wants" ? {} : { sort: "artist", sort_order: "asc" }) });
  } catch (e) {
    if (/ 403 /.test(` ${e.message} `) || /Discogs 403/.test(e.message)) {
      throw new DiscogsUserError(list === "wants" ? "That want list is private on Discogs." : "That collection is private on Discogs. Its owner can make it public in Discogs settings (Privacy), or use their own Discogs token on this site.");
    }
    throw e;
  }
  if (!r) throw new DiscogsUserError(`There's no Discogs user called “${decodeURIComponent(user)}”. Check the spelling.`);
  const items = (list === "wants" ? r.wants : r.releases) || [];
  const status = list === "wants" ? "want" : "owned";
  return {
    page: (r.pagination && r.pagination.page) || page,
    pages: (r.pagination && r.pagination.pages) || 1,
    total: (r.pagination && r.pagination.items) || items.length,
    rows: items.filter((x) => x.basic_information).map((x) => rowFromDiscogs(x.basic_information, status)),
  };
}

export async function search(client, q) {
  const r = await client.get("/database/search", { q, per_page: 25 });
  const all = ((r && r.results) || []).filter((x) => x.type === "release" || x.type === "master");
  const vinylish = (x) => x.type === "master" || (x.format || []).includes("Vinyl");
  const keep = all.some(vinylish) ? all.filter(vinylish) : all;
  return keep.slice(0, 12).map(toCandidate);
}
