// Search index over albums, tracks and people. Pure functions, no DOM.

export function fold(s = "") {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function personKey(name) { return fold(name).replace(/\s+/g, "-"); }

export function sortKey(a) {
  const artist = fold(a.artist).replace(/^the /, "");
  return `${artist}\u0000${String(a.year || 9999).padStart(4, "0")}\u0000${fold(a.title)}`;
}

const MUSICAL_SKIP = /produc|engineer|record|mix|master|lacquer|liner|photo|design|art|cover|layout|written|composed|lyrics|music by|words by|executive|notes|supervis|coordinat|transfer|edit|illustrat|publish|technician|assistant|compiled|sleeve|direction|licens|manufactur|distribut|market|cut by/i;

// What a person did on an album, in plain words.
const COMPOSER = /compos|written|music by|^music$/i;

// What kind of credit this is: "leader", "player", "composer" or "other".
export function creditKind(entry) {
  const roles = entry.roles || [];
  const musical = roles.filter((r) => !MUSICAL_SKIP.test(r));
  if (!musical.length && roles.some((r) => COMPOSER.test(r))) return "composer";
  if (entry.leader) return "leader";
  if (musical.length || entry.kind === "musician") return "player";
  return "other";
}

export function roleLabel(entry) {
  const musical = entry.roles.filter((r) => !MUSICAL_SKIP.test(r));
  const other = entry.roles.filter((r) => MUSICAL_SKIP.test(r));
  // Composers (often named as album artists on classical records) are composers, not band leaders.
  if (creditKind(entry) === "composer") return "Composer";
  if (entry.leader) return musical.length ? `Leader, ${musical.join(", ")}` : "Leader";
  if (musical.length) return musical.join(", ");
  if (other.length) return other.join(", ");
  return "Personnel";
}

export function creditsFor(album) {
  if (album.credits && album.credits.length) return album.credits;
  // Before Discogs details arrive, fall back to names from the original spreadsheet.
  const artistF = ` ${fold(album.artist)} `;
  return (album.personnel_hint || []).map((name) => ({
    name, id: null, roles: [], tracks: [], kind: "musician",
    leader: artistF.includes(` ${fold(name)} `),
  }));
}

export function buildIndex(albums) {
  const people = new Map();
  const list = albums.map((a) => {
    const credits = creditsFor(a);
    for (const c of credits) {
      const key = personKey(c.name);
      if (!key) continue;
      let p = people.get(key);
      if (!p) { p = { key, name: c.name, fold: fold(c.name), items: [] }; people.set(key, p); }
      if (!p.items.some((i) => i.album.id === a.id)) p.items.push({ album: a, roles: c.roles || [], leader: !!c.leader, kind: c.kind, tracks: c.tracks || [] });
    }
    return {
      album: a,
      hay: fold([a.artist, a.title, a.catno, a.label, a.year, (a.genres || []).join(" "), (a.crates || []).join(" ")].join(" ")),
      tracks: (a.tracks || []).map((t) => ({ t, f: fold(t.title), w: t.work ? fold(t.work) : "", fw: fold(`${t.work || ""} ${t.title}`) })),
      sort: sortKey(a),
    };
  });
  list.sort((x, y) => (x.sort < y.sort ? -1 : x.sort > y.sort ? 1 : 0));
  for (const p of people.values()) {
    p.items.sort((x, y) => (x.leader !== y.leader ? (x.leader ? -1 : 1) : sortKey(x.album) < sortKey(y.album) ? -1 : 1));
  }
  const genres = [...new Set(albums.flatMap((a) => a.genres || []))].sort((a, b) => a.localeCompare(b));
  const crateCounts = new Map();
  for (const a of albums) for (const c of a.crates || []) crateCounts.set(c, (crateCounts.get(c) || 0) + 1);
  const crates = [...crateCounts].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
  return { list, people, genres, crates };
}

export function passes(album, { status = "all", genre = "", crate = "" } = {}) {
  if (status === "owned" && album.status !== "owned") return false;
  if (status === "want" && album.status !== "want") return false;
  if (status === "sale" && !(album.status === "owned" && album.for_sale)) return false;
  if (genre && !(album.genres || []).includes(genre)) return false;
  if (crate && !(album.crates || []).includes(crate)) return false;
  return true;
}

function matchesAll(hay, words) { return words.every((w) => hay.includes(w)); }

export function search(index, query, filters = {}) {
  const q = fold(query);
  const visible = index.list.filter((e) => passes(e.album, filters));
  if (!q) return { query: q, people: [], albums: visible.map((e) => e.album), songs: [] };
  const words = q.split(" ");

  const albums = visible.filter((e) => matchesAll(e.hay, words)).map((e) => e.album);

  const songs = [];
  if (q.length >= 2) {
    for (const e of visible) {
      // A search that names a piece ("quartet no 3") lists the piece once, not every movement.
      const hits = [], works = new Set();
      for (const x of e.tracks) {
        if (x.w && matchesAll(x.w, words)) {
          const key = x.t.wi ?? x.t.work;
          if (!works.has(key)) { works.add(key); hits.push({ pos: x.t.pos, title: x.t.work, isWork: true, wby: x.t.wby }); }
        } else if (matchesAll(x.f, words) || (x.w && matchesAll(x.fw, words))) hits.push(x.t);
      }
      if (hits.length) songs.push({ album: e.album, tracks: hits });
    }
  }

  const people = [];
  for (const p of index.people.values()) {
    if (!matchesAll(p.fold, words)) continue;
    const items = p.items.filter((i) => passes(i.album, filters));
    if (items.length) people.push({ ...p, items });
  }
  people.sort((a, b) => {
    const ae = a.fold === q, be = b.fold === q;
    if (ae !== be) return ae ? -1 : 1;
    return b.items.length - a.items.length;
  });

  return { query: q, people: people.slice(0, 8), albums, songs: songs.slice(0, 40) };
}
