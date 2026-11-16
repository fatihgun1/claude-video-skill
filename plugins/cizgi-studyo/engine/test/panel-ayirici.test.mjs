// Dividers between the panel's areas: arrow keys and the limits of a size.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sizeAfterKey, clampSize } from "../src/panel/ayirici.js";

test("an arrow key on a divider grows the area it faces, other keys do nothing", () => {
  // the left panel's right edge: → widens it
  assert.equal(sizeAfterKey("ArrowRight", "x", 1, 300, 20), 320);
  assert.equal(sizeAfterKey("ArrowLeft", "x", 1, 300, 20), 280);
  // the right panel's left edge: ← widens it
  assert.equal(sizeAfterKey("ArrowLeft", "x", -1, 330, 20), 350);
  // the timeline's top edge: ↑ makes it taller
  assert.equal(sizeAfterKey("ArrowUp", "y", -1, 244, 20), 264);
  assert.equal(sizeAfterKey("ArrowDown", "y", -1, 244, 20), 224);
  assert.equal(sizeAfterKey("ArrowUp", "x", 1, 300, 20), null);
  assert.equal(sizeAfterKey("Enter", "y", -1, 244, 20), null);
});

test("a size stays within its limits; a window too small for the least gives what it has", () => {
  assert.equal(clampSize(100, 220, 480), 220);
  assert.equal(clampSize(900, 220, 480), 480);
  assert.equal(clampSize(301.6, 220, 480), 302);
  assert.equal(clampSize(300, 220, 150), 150); // max below min: max wins, the stage keeps its room
});
