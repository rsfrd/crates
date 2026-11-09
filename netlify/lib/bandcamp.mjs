// Reads one Bandcamp album (or track) page into the same shape as a Discogs release.
// Bandcamp pages carry two machine-readable copies of the release: a schema.org JSON-LD block
// and the `data-tralbum` attribute the player uses. Either is enough; both are used when present.
import { isMusicalRole } from "./discogs.mjs";

const ENT = { "&quot;": '"', "&amp;": "&", "&#39;": "'", "&lt;": "<", "&gt;": ">", "&apos;": "'" };
const unescapeAttr = (s) => s.replace(/&(quot|amp|#39|lt|gt|apos);/g, (m) => ENT[m]);

function jsonLd(html) {
  const out = [];
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); out.push(...(Array.isArray(j) ? j : [j])); } catch { /* ignore a broken block */ }
  }
  return out.find((j) => /MusicAlbum|MusicRecording|Product/.test([].concat(j["@type"] || []).join(" "))) || null;
}

function tralbum(html) {
  const m = html.match(/data-tralbum=(["'])([\s\S]*?)\1/);
  if (!m) return null;
  try { return JSON.parse(unescapeAttr(m[2])); } catch { return null; }
}

// "P00H04M12S" → "4:12"; 252.3 (seconds) → "4:12"
function clock(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "";
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function isoDuration(d) {
  const m = String(d || "").match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/i);
  if (!m) return "";
  const [, D = 0, H = 0, M = 0, S = 0] = m;
  return clock(Number(D) * 86400 + Number(H) * 3600 + Number(M) * 60 + Number(S));
}
const yearOf = (s) => { const m = String(s || "").match(/\b(19|20)\d{2}\b/); return m ? Number(m[0]) : null; };

// Bandcamp credits are free text. Pick out lines that clearly say who played what:
// "Bert Lucarelli – oboe", "Judith Glyde: cello", "Eric Lewis - violin, viola".
const NAME = /^[A-Z][\p{L}'’.-]*(?:\s+(?:[A-Z][\p{L}'’.-]*|de|van|von|da|di|la|le|del|y)){0,4}$/u;
export function parseCredits(text = "") {
  const credits = [];
  for (let line of String(text).split(/\r?\n/)) {
    line = line.trim().replace(/^[-•*·]\s*/, "");
    const m = line.match(/^(.{2,60}?)\s*(?:\s[-–—]\s|:\s)\s*(.{2,80})$/);
    if (!m) continue;
    let [, a, b] = m;
    let name = a.trim(), roles = b.trim();
    // A person's name: capitalised words, at least two of them ("Drums" alone is an instrument).
    const person = (x) => NAME.test(x) && x.split(/\s+/).length >= 2;
    if (!person(name) && person(roles)) [name, roles] = [roles, name];   // "Oboe: Bert Lucarelli"
    if (!person(name)) continue;
    const list = roles.split(/\s*(?:,|&|\band\b|\/)\s*/i).map((r) => r.trim()).filter(Boolean)
      .map((r) => r.charAt(0).toUpperCase() + r.slice(1));
    if (!list.length || list.length > 6 || list.some((r) => r.split(" ").length > 4)) continue;
    const existing = credits.find((c) => c.name === name);
    if (existing) { for (const r of list) if (!existing.roles.includes(r)) existing.roles.push(r); continue; }
    credits.push({ name, id: null, roles: list, tracks: [], leader: false, kind: list.some(isMusicalRole) ? "musician" : "credit" });
  }
  return credits;
}

export function parseBandcampPage(html, url) {
  const ld = jsonLd(html);
  const tr = tralbum(html);
  if (!ld && !tr) return null;

  const title = (tr && tr.current && tr.current.title) || (ld && ld.name) || "";
  const artist = (tr && tr.artist) || (ld && ld.byArtist && (ld.byArtist.name || ld.byArtist)) || "";
  const year = yearOf((tr && (tr.album_release_date || (tr.current && tr.current.release_date))) || (ld && ld.datePublished));

  // Cover: Bandcamp serves sizes by suffix: _10 is 1200px, _9 is 210px.
  const artId = tr && (tr.art_id || (tr.current && tr.current.art_id));
  const ldImage = ld && [].concat(ld.image || [])[0];
  const cover_url = artId ? `https://f4.bcbits.com/img/a${artId}_10.jpg` : ldImage || null;
  const thumb_url = artId ? `https://f4.bcbits.com/img/a${artId}_9.jpg` : cover_url;

  let tracks = [];
  if (tr && Array.isArray(tr.trackinfo) && tr.trackinfo.length) {
    tracks = tr.trackinfo.map((t, i) => ({ pos: String(t.track_num || i + 1), title: t.title || "", dur: clock(t.duration) }));
  } else if (ld && ld.track && Array.isArray(ld.track.itemListElement)) {
    tracks = ld.track.itemListElement.map((e, i) => ({ pos: String(e.position || i + 1), title: (e.item && e.item.name) || "", dur: isoDuration(e.item && e.item.duration) }));
  } else if (ld && /MusicRecording/.test(String(ld["@type"]))) {
    tracks = [{ pos: "1", title: ld.name || title, dur: isoDuration(ld.duration) }];
  }

  const creditText = ((tr && tr.current && tr.current.credits) || (ld && ld.creditText) || "").trim();
  const credits = parseCredits(creditText);
  if (artist && !credits.some((c) => c.name === artist)) credits.unshift({ name: artist, id: null, roles: [], tracks: [], leader: true, kind: "musician" });
  else if (artist) credits.find((c) => c.name === artist).leader = true;

  const publisher = ld && ld.publisher && (ld.publisher.name || ld.publisher);
  const label = publisher && publisher !== artist ? String(publisher) : null;

  return {
    source: "bandcamp",
    discogs_id: null,
    discogs_url: url,
    year, label, label_catno: null,
    cover_url, thumb_url,
    discogs_genres: [], discogs_styles: [],
    tracks, credits,
    credits_text: creditText,
    discogs_title: String(title).trim(),
    discogs_artist: String(artist).trim(),
    parser: 3,
  };
}
