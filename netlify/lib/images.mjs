// Finds alternative cover images from several sources. Every source is optional:
// one failing or timing out never stops the others.
import { scoreCandidate, similarity } from "./discogs.mjs";

const UA = "GarageCrates/1.0 ( https://www.netlify.com )";

async function getJSON(fetchImpl, url, headers = {}, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetchImpl(url, { headers: { "User-Agent": UA, Accept: "application/json", ...headers }, signal: ctl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; } finally { clearTimeout(t); }
}

// Apple Music / iTunes: clean, square, official artwork.
export async function fromItunes({ artist, title }, fetchImpl = fetch) {
  const q = new URLSearchParams({ term: `${artist} ${title}`, entity: "album", limit: "10" });
  const r = await getJSON(fetchImpl, `https://itunes.apple.com/search?${q}`);
  return ((r && r.results) || [])
    .map((x) => ({ x, s: 0.65 * similarity(x.collectionName, title) + 0.35 * similarity(x.artistName, artist) }))
    .filter(({ s }) => s >= 0.5)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .filter(({ x }) => x.artworkUrl100)
    .map(({ x }) => ({
      url: x.artworkUrl100.replace(/\d+x\d+bb/, "1200x1200bb"),
      thumb: x.artworkUrl100.replace(/\d+x\d+bb/, "300x300bb"),
      source: "Apple Music",
      detail: [x.collectionName, x.releaseDate && x.releaseDate.slice(0, 4)].filter(Boolean).join(", "),
    }));
}

// MusicBrainz + Cover Art Archive: community-scanned covers of the original album.
export async function fromCoverArtArchive({ artist, title }, fetchImpl = fetch) {
  const clean = (s) => s.replace(/["\\]/g, "");
  const query = /^various/i.test(artist)
    ? `releasegroup:"${clean(title)}"`
    : `releasegroup:"${clean(title)}" AND artist:"${clean(artist)}"`;
  const r = await getJSON(fetchImpl, `https://musicbrainz.org/ws/2/release-group?${new URLSearchParams({ query, fmt: "json", limit: "5" })}`);
  return ((r && r["release-groups"]) || [])
    .filter((g) => (g.score || 0) >= 85)
    .slice(0, 2)
    .map((g) => ({
      url: `https://coverartarchive.org/release-group/${g.id}/front-1200`,
      thumb: `https://coverartarchive.org/release-group/${g.id}/front-250`,
      source: "Cover Art Archive",
      detail: [g.title, g["first-release-date"] && g["first-release-date"].slice(0, 4)].filter(Boolean).join(", "),
      mayBeMissing: true,
    }));
}

const isSpacer = (u) => !u || /spacer\.gif/.test(u);

// Discogs: other vinyl pressings of the same album, plus the other photos on the matched release.
export async function fromDiscogs(client, { artist, title, discogsId }) {
  const pressings = [], photos = [];
  const tasks = [
    client.get("/database/search", { type: "release", artist: /^various/i.test(artist) ? "Various" : artist, release_title: title, format: "Vinyl", per_page: 15 })
      .then((r) => {
        for (const x of (r && r.results) || []) {
          if (isSpacer(x.cover_image) || scoreCandidate(x, artist, title) < 0.55) continue;
          pressings.push({
            url: x.cover_image, thumb: x.thumb || x.cover_image, source: "Discogs",
            detail: [x.year, x.country, (x.format || []).slice(0, 2).join(" ")].filter(Boolean).join(", "),
          });
        }
      }).catch(() => {}),
  ];
  if (discogsId) {
    tasks.push(client.get(`/releases/${discogsId}`).then((rel) => {
      for (const img of (rel && rel.images) || []) {
        photos.push({ url: img.uri, thumb: img.uri150 || img.uri, source: "Discogs", detail: img.type === "primary" ? "Current match, front" : "Current match, other photo" });
      }
    }).catch(() => {}));
  }
  await Promise.all(tasks);
  return [...pressings, ...photos];
}

export async function findImages(client, album, fetchImpl = fetch) {
  const [itunes, caa, discogs] = await Promise.all([
    fromItunes(album, fetchImpl).catch(() => []),
    fromCoverArtArchive(album, fetchImpl).catch(() => []),
    client ? fromDiscogs(client, album).catch(() => []) : [],
  ]);
  const seen = new Set();
  return [...itunes, ...caa, ...discogs]
    .filter((c) => c.url && !seen.has(c.url) && seen.add(c.url))
    .filter((c) => c.url !== album.currentUrl)
    .slice(0, 18);
}
