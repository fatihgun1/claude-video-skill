// The home page's pure helpers: the search over episodes and the id suggested from a title.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matches, slug, folderName } from "../src/panel/projeler.js";

test("the home page search finds an episode by title, id or folder, with Turkish case rules", () => {
  const e = { title: "Işıklı Park", id: "isikli-park", path: "bolumler/isikli-park/bolum.json" };
  assert.equal(matches(e, ""), true);
  assert.equal(matches(e, "  "), true);
  assert.equal(matches(e, "ışıklı"), true); // "I" lowers to "ı" in Turkish
  assert.equal(matches(e, "PARK"), true);
  assert.equal(matches(e, "bolumler/"), true);
  assert.equal(matches(e, "sokak"), false);
  assert.equal(matches({ path: "a/bolum.json" }, "a/"), true); // no title or id yet
});

test("a new episode's id is suggested from its title", () => {
  assert.equal(slug("Park Günü!"), "park-gunu");
  assert.equal(slug("  Çiçek & Şeker  "), "cicek-seker");
});

test("the home page names the folder by its last part", () => {
  assert.equal(folderName("C:\\Users\\x\\Video"), "Video");
  assert.equal(folderName("/home/x/proje/"), "proje");
  assert.equal(folderName("/"), "/");
});
