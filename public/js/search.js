// Search index over albums, tracks and people. Pure functions, no DOM.

// Typographic tidying for text from Discogs and older records: real apostrophes (Don’t, ’Round
// Midnight, Rock ’n’ Roll, the ’60s) and translated titles split with a dot instead of Discogs' " = ".
const ELIDED = /(^|[\s(“"])'(?=(round|til|tis|twas|n|em|cause|bout|s|\d{2}s?)\b)/gi;
export function typeset(s) {
  if (typeof s !== "string" || (!s.includes("'") && !s.includes("="))) return s;
  return s
    .replace(/\s+=\s+/g, " • ")
    .replace(ELIDED, "$1’")
    .replace(/(^|[\s(“"])'([^'\n]+?)'(?=$|[\s).,!?:;”"])/g, "$1‘$2’")
    .replace(/(?<=[\p{L}\p{N}.])'/gu, "’");
}

// The same tidying across an album’s names and titles; returns the album itself when nothing changes.
export function typesetAlbum(a) {
  if (!a) return a;
  let changed = false;
  const t = (v) => { const n = typeset(v); if (n !== v) changed = true; return n; };
  const out = { ...a, artist: t(a.artist), title: t(a.title), label: t(a.label) };
  if (Array.isArray(a.tracks)) out.tracks = a.tracks.map((x) => (x && typeof x === "object" ? { ...x, title: t(x.title), work: t(x.work), by: t(x.by), wby: t(x.wby) } : x));
  if (Array.isArray(a.credits)) out.credits = a.credits.map((x) => (x && typeof x === "object" ? { ...x, name: t(x.name) } : x));
  return changed ? out : a;
}

// Folding is called many thousands of times while indexing (the same names, roles and titles again and
// again), so results are remembered. The memory is cleared if it grows very large.
const folded = new Map();
export function fold(s = "") {
  const key = String(s);
  let out = folded.get(key);
  if (out === undefined) {
    if (folded.size > 50000) folded.clear();
    out = foldUncached(key);
    folded.set(key, out);
  }
  return out;
}
function foldUncached(s) {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function personKey(name) { return fold(name).replace(/\s+/g, "-"); }

// ---------- filing order ----------
// People are filed by surname ("Frank Zappa" under Z), bands by name ("The Cure" under C).
// Someone counts as a person when the records say so: Discogs credits them individually
// ("Frank Zappa – Guitar"), or the original spreadsheet lists them in the personnel.
const GROUP = /\b(orchestra|orchester|quartet|quintet|sextet|septet|octet|trio|duo|ensemble|band|choir|chorus|players|singers|brothers|sisters|group|club|sound|soloists|philharmonic|symphony|sinfonia|consort|academy|collective|company|experience|project|crew|gang|family|boys|girls|kids|all stars|allstars|messengers|mothers|arkestra|machine|system|unit|combo|orkestra)\b/;
const SUFFIX = new Set(["jr", "sr", "ii", "iii", "iv"]);

// Wording that marks a band, not a person: "Queens Of The Stone Age", "Belle and Sebastian", "Simon & Garfunkel".
// (Name particles like "van", "de", "da" are fine: "Ludwig van Beethoven", "Paco de Lucía".)
const BAND_WORDS = /\b(of|the|and|with|in|on|at|to|for|from|my|your|our|his|her|their|is|are|we|you|i|me|no|not|all|some|one|two|three|x)\b/;
const BAND_MARKS = /[&+\/]|\band\b/i;
// Credits that say an individual played, sang, conducted or composed: a named instrument or voice.
// Vaguer credits that Discogs often gives a whole band ("Arranged By", "Instruments", "Performer",
// "Written-By", "Producer") don’t count.
const INDIVIDUAL_ROLE = /\b(guitar|bass|drums?|percussion|piano|keyboards?|organ|synth\w*|moog|mellotron|rhodes|clavinet|harpsichord|celesta|accordion|vocals?|voice|soprano|alto|tenor|baritone|mezzo|countertenor|contralto|saxophone|sax|trumpet|cornet|flugelhorn|trombone|horn|tuba|euphonium|clarinet|flute|piccolo|oboe|cor anglais|english horn|bassoon|recorder|harmonica|violin|viola|cello|violoncello|double bass|contrabass|fiddle|harp|banjo|mandolin|ukulele|sitar|koto|shamisen|shakuhachi|steel|lap steel|pedal steel|dobro|vibraphone|vibes|marimba|xylophone|glockenspiel|timpani|congas?|bongos?|tabla|turntables|sampler|electronics|theremin|whistl\w*|conductor|composed by|composer|rap|mc)\b/i;
const individualRole = (r) => INDIVIDUAL_ROLE.test(r) && !/^(performer|featuring|band|ensemble|orchestra|choir|chorus|instruments)\b/i.test(r);

export function knownPeople(albums) {
  const people = new Set();
  const add = (name) => {
    const f = fold(name);
    if (!f || GROUP.test(f) || BAND_MARKS.test(name) || BAND_WORDS.test(f) || f === "various" || f.split(" ").length > 4) return;
    people.add(f);
  };
  for (const a of albums) {
    for (const c of a.credits || []) if ((c.roles || []).some(individualRole)) add(c.name);
    for (const n of a.personnel_hint || []) if (fold(n).includes(" ")) add(n);
  }
  return people;
}

// "frank zappa" → "zappa frank"; "sammy davis jr" → "davis sammy jr"
function bySurname(f) {
  const t = f.split(" ");
  let i = t.length - 1;
  while (i > 0 && SUFFIX.has(t[i])) i--;
  return [t[i], ...t.slice(0, i), ...t.slice(i + 1)].join(" ");
}

// How an artist name files: surname first for people (also at the start of
// "Frank Zappa & The Mothers" or "Dave Holland Quintet"), else the name without a leading The/A.
export function fileAs(artist, people = new Set(), sortAs = "") {
  if (sortAs && sortAs.trim()) return `${fold(sortAs)} ${fold(artist)}`;
  const f = fold(artist);
  let best = "";
  for (const p of people) {
    if ((f === p || f.startsWith(p + " ")) && p.length > best.length) best = p;
  }
  if (best) return `${bySurname(best)}${f.slice(best.length)}`;
  // "The Cure" files under C; "A Tribe Called Quest" under T (a lone "A" before one word stays).
  return f.replace(/^the (?=\S)/, "").replace(/^a (?=\S+ \S)/, "");
}

export function sortKey(a, people) {
  return `${fileAs(a.artist, people, a.sort_as)}\u0000${String(a.original_year || a.year || 9999).padStart(4, "0")}\u0000${fold(a.title)}`;
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

// What search needs from one album, kept per album object: an album that hasn't changed is the same
// object, so after an edit only the edited album is worked out again.
const entries = new WeakMap();
function entryFor(a) {
  let e = entries.get(a);
  if (!e) {
    e = {
      hay: fold([a.artist, a.title, a.catno, a.label, a.year, a.original_year, (a.genres || []).join(" "), (a.crates || []).join(" ")].join(" ")),
      tracks: (a.tracks || []).map((t) => ({ t, f: fold(t.title), w: t.work ? fold(t.work) : "", fw: fold(`${t.work || ""} ${t.title}`) })),
    };
    entries.set(a, e);
  }
  return e;
}

export function buildIndex(albums) {
  const individuals = knownPeople(albums);
  const sorts = new Map();   // each album's filing position, worked out once per build
  const sortOf = (a) => { let k = sorts.get(a); if (k === undefined) { k = sortKey(a, individuals); sorts.set(a, k); } return k; };
  const people = new Map();
  const list = albums.map((a) => {
    const credits = creditsFor(a);
    for (const c of credits) {
      const key = personKey(c.name);
      if (!key) continue;
      let p = people.get(key);
      if (!p) { p = { key, name: c.name, fold: fold(c.name), items: [] }; people.set(key, p); }
      if (p.last !== a) { p.last = a; p.items.push({ album: a, roles: c.roles || [], leader: !!c.leader, kind: c.kind, tracks: c.tracks || [] }); }
    }
    const e = entryFor(a);
    return { album: a, hay: e.hay, tracks: e.tracks, sort: sortOf(a) };
  });
  list.sort((x, y) => (x.sort < y.sort ? -1 : x.sort > y.sort ? 1 : 0));
  for (const p of people.values()) {
    delete p.last;
    p.items.sort((x, y) => (x.leader !== y.leader ? (x.leader ? -1 : 1) : sortOf(x.album) < sortOf(y.album) ? -1 : 1));
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
