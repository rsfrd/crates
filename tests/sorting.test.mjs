import assert from "node:assert/strict";
import { test } from "node:test";
import { knownPeople, fileAs, buildIndex } from "../public/js/search.js";

const rec = (artist, title, credits = [], hint = []) => ({ id: artist + title, artist, title, status: "owned", credits, personnel_hint: hint });
const credit = (name, roles) => ({ name, roles, tracks: [], leader: false, kind: "musician" });
const albums = [
  rec("Frank Zappa", "Hot Rats", [credit("Frank Zappa", ["Guitar", "Producer"])]),
  rec("Frank Zappa & The Mothers", "Just Another Band From L.A."),
  rec("Freddie Hubbard", "Hub-Tones", [credit("Freddie Hubbard", ["Trumpet"])]),
  rec("Dave Holland Quintet", "Jumpin' In", [credit("Dave Holland", ["Bass"])]),
  rec("Dinah Washington", "The Late, Late Show", [], ["Dinah Washington"]),
  rec("Steely Dan", "Aja", [credit("Walter Becker", ["Bass"]), credit("Donald Fagen", ["Vocals"])]),
  rec("The Cure", "Disintegration"),
  rec("A Tribe Called Quest", "The Low End Theory", [credit("Q-Tip", ["Vocals"])]),
  rec("Chamber Orchestra Of The Vienna State Opera", "x", [credit("Chamber Orchestra Of The Vienna State Opera", ["Orchestra"])]),
  rec("Sammy Davis Jr.", "Sings", [credit("Sammy Davis Jr.", ["Vocals"])]),
  rec("Beck", "Odelay", [credit("Beck", ["Vocals"])]),
  rec("Arnold Bax / Arthur Bliss", "Two English Oboe Quintets", [credit("Arnold Bax", ["Composed By"])]),
  rec("Sun Ra", "Lanquidity", [credit("Sun Ra", ["Piano"])]),
  // Bands that Discogs credits as a whole
  rec("Queens Of The Stone Age", "Songs For The Deaf", [credit("Queens Of The Stone Age", ["Producer", "Written-By"])]),
  rec("Simon & Garfunkel", "Bookends", [credit("Simon & Garfunkel", ["Producer"])]),
  rec("Belle and Sebastian", "Tigermilk", [credit("Belle And Sebastian", ["Performer"])]),
  rec("Arcade Fire", "Funeral", [credit("Arcade Fire", ["Written-By", "Producer"])]),
  rec("Vampire Weekend", "Contra", [credit("Vampire Weekend", ["Performer"])]),
  rec("Talking Heads", "Remain In Light", [credit("Talking Heads", ["Arranged By", "Instruments", "Music By", "Written-By", "Producer"]), credit("David Byrne", ["Vocals", "Guitar"])]),
  rec("Bruce Springsteen", "Nebraska", [credit("Bruce Springsteen", ["Vocals", "Guitar", "Harmonica", "Producer"])]),
  rec("Leonard Bernstein", "West Side Story", [credit("Leonard Bernstein", ["Conductor"])]),
  // People with name particles
  rec("Ludwig van Beethoven", "Symphony No. 9", [credit("Ludwig van Beethoven", ["Composed By"])]),
  rec("Paco de Lucía", "Fuente Y Caudal", [credit("Paco de Lucía", ["Guitar"])]),
];

test("people file by surname; bands by name", () => {
  const people = knownPeople(albums);
  assert.ok(people.has("frank zappa") && people.has("freddie hubbard") && people.has("dinah washington"));
  assert.ok(!people.has("chamber orchestra of the vienna state opera"), "ensembles are never people");
  assert.equal(fileAs("Frank Zappa", people), "zappa frank");
  assert.equal(fileAs("Frank Zappa & The Mothers", people), "zappa frank the mothers");
  assert.equal(fileAs("Freddie Hubbard", people), "hubbard freddie");
  assert.equal(fileAs("Dave Holland Quintet", people), "holland dave quintet");
  assert.equal(fileAs("Sammy Davis Jr.", people), "davis sammy jr");
  assert.equal(fileAs("Arnold Bax / Arthur Bliss", people), "bax arnold arthur bliss");
  assert.equal(fileAs("Steely Dan", people), "steely dan", "a band whose members are credited stays by name");
  assert.equal(fileAs("The Cure", people), "cure");
  assert.equal(fileAs("A Tribe Called Quest", people), "tribe called quest");
  assert.equal(fileAs("Beck", people), "beck");
});

test("bands credited as a whole stay filed by name", () => {
  const people = knownPeople(albums);
  assert.equal(fileAs("Queens Of The Stone Age", people), "queens of the stone age");
  assert.equal(fileAs("Simon & Garfunkel", people), "simon garfunkel");
  assert.equal(fileAs("Belle and Sebastian", people), "belle and sebastian");
  assert.equal(fileAs("Arcade Fire", people), "arcade fire", "a producer/songwriter credit doesn't make a band a person");
  assert.equal(fileAs("Vampire Weekend", people), "vampire weekend");
  assert.equal(fileAs("Talking Heads", people), "talking heads", "arranged/instruments/music-by credits don't make a band a person");
  assert.equal(fileAs("Bruce Springsteen", people), "springsteen bruce");
  assert.equal(fileAs("Leonard Bernstein", people), "bernstein leonard");
  assert.equal(fileAs("Ludwig van Beethoven", people), "beethoven ludwig van");
  assert.equal(fileAs("Paco de Lucía", people), "lucia paco de");
});

test("File under overrides the automatic choice", () => {
  const people = knownPeople(albums);
  assert.equal(fileAs("Sun Ra", people), "ra sun");
  assert.equal(fileAs("Sun Ra", people, "Sun Ra"), "sun ra sun ra");
});

test("the collection lists in filing order", () => {
  const order = buildIndex(albums).list.map((e) => e.album.artist);
  const pos = (n) => order.indexOf(n);
  assert.ok(pos("Arnold Bax / Arthur Bliss") < pos("The Cure"));
  assert.ok(pos("Freddie Hubbard") > pos("Dave Holland Quintet") && pos("Freddie Hubbard") < pos("Steely Dan"));
  assert.ok(pos("Frank Zappa") > pos("Dinah Washington"), "Zappa files at the end");
  assert.equal(order.at(-1).startsWith("Frank Zappa"), true);
});
