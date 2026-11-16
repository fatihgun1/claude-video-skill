// Dragging a library card onto the timeline or the stage: what each kind does where it lands.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropAction, kindOfTypes, typeOf } from "../src/panel/birak.js";

const shot = { shotId: "s1_sh1", local: 2.4 };

test("a card's kind travels in the drag's type (readable while dragging, unlike its data)", () => {
  assert.equal(typeOf("kamera-plan"), "application/x-cizgi-kamera-plan");
  assert.equal(kindOfTypes(["text/plain", "application/x-cizgi-ses"]), "ses");
  assert.equal(kindOfTypes(["Files"]), null);
  assert.equal(kindOfTypes(["application/x-cizgi-bilinmez"]), null); // not a library kind
});

test("an action dropped on a character's track starts where it is let go; at the shot's start it replaces the first", () => {
  assert.deepEqual(dropAction("hareket", { area: "timeline", ...shot, castIndex: 1 }), { pick: "hareket-ekle", seek: 2.4, castIndex: 1 });
  assert.deepEqual(dropAction("hareket", { area: "timeline", shotId: "s1_sh1", local: 0.02, castIndex: 0 }), { pick: "hareket", seek: 0, castIndex: 0, seg: 0 });
  // not on a character: nothing to give it to
  assert.equal(dropAction("hareket", { area: "timeline", ...shot, castIndex: null }), null);
  // on a character on the stage: from the playhead
  assert.deepEqual(dropAction("hareket", { area: "stage", shotId: "s1_sh1", castIndex: 0 }), { pick: "hareket-ekle", castIndex: 0 });
  assert.equal(dropAction("hareket", { area: "stage", shotId: "s1_sh1", castIndex: null }), null);
});

test("an effect lands at the moment it is let go; on the stage at the playhead", () => {
  assert.deepEqual(dropAction("ses", { area: "timeline", ...shot }), { pick: "ses", seek: 2.4 });
  assert.deepEqual(dropAction("ses", { area: "stage", shotId: "s1_sh1" }), { pick: "ses" });
});

test("a character, prop, place or camera goes to the shot under it; a character on the stage where it is let go", () => {
  assert.deepEqual(dropAction("karakter", { area: "timeline", ...shot, castIndex: 0 }), { pick: "karakter" }); // added, not swapped
  assert.deepEqual(dropAction("karakter", { area: "stage", shotId: "s1_sh1", worldX: 700 }), { pick: "karakter", worldX: 700 });
  for (const kind of ["nesne", "mekan", "kamera-plan", "kamera-hareket"]) {
    assert.deepEqual(dropAction(kind, { area: "timeline", ...shot }), { pick: kind });
    assert.deepEqual(dropAction(kind, { area: "stage", shotId: "s1_sh1" }), { pick: kind });
  }
});

test("music is the whole film's: anywhere; everything else needs a shot under it", () => {
  assert.deepEqual(dropAction("muzik", { area: "timeline", shotId: null }), { pick: "muzik" });
  assert.equal(dropAction("ses", { area: "timeline", shotId: null }), null);
  assert.equal(dropAction("karakter", { area: "stage", shotId: null }), null);
  assert.equal(dropAction("bilinmez", { area: "timeline", ...shot }), null);
});
