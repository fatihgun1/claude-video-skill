// The left rail remembers which panel was open; values from the old Proje | Kütüphane pane still work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { storedPanel } from "../src/panel/serit.js";

test("the left rail opens the panel it remembers, or none when it was closed", () => {
  assert.equal(storedPanel("muzik"), "muzik");
  assert.equal(storedPanel(""), null); // closed: the stage keeps the room
  assert.equal(storedPanel("proje"), "sahneler"); // the old tree
  assert.equal(storedPanel("kutuphane"), "karakter"); // the old library
  assert.equal(storedPanel("bozuk"), "karakter");
});
