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
