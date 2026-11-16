// Merging two edits of one story (hikaye.json): the person's in the project wizard and Claude's on
// disk, both made from the same last-saved version (base). Each field takes the side that changed
// it; when both changed the same one, the person's wins (they are looking at it). Characters merge
// by name and cards by id, so one side adding or editing an item never drops the other side's.

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** A value changed on one side only takes that side; on both, mine. */
function pick(base, mine, theirs) {
  if (same(mine, base)) return theirs;
  return mine;
}

/** An object of plain values (istekler), key by key; a key removed on a side counts as a change. */
function mergeObject(base = {}, mine = {}, theirs = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    const v = pick(base[k], mine[k], theirs[k]);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** A list of items with a key: theirs in their order, my edits and deletions applied, my new items at the end. */
function mergeList(base = [], mine = [], theirs = [], keyOf) {
  const index = (list) => new Map(list.map((x) => [keyOf(x), x]));
  const b = index(base);
  const m = index(mine);
  const out = [];
  for (const t of theirs) {
    const k = keyOf(t);
    if (b.has(k) && !m.has(k)) continue; // I deleted it
    if (m.has(k)) out.push(pick(b.get(k), m.get(k), t));
    else out.push(t); // new on their side
  }
  const taken = new Set(out.map(keyOf));
  for (const x of mine) {
    const k = keyOf(x);
    if (!taken.has(k) && !b.has(k)) out.push(x); // new on my side
  }
  return out;
}

/**
 * @param {object} base the story both sides started from
 * @param {object} mine the person's edit (the wizard)
 * @param {object} theirs what is on disk now (Claude's)
 * @returns {object} the merged story
 */
export function mergeStory(base, mine, theirs) {
  const out = {};
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine), ...Object.keys(theirs)])) {
    if (k === "istekler") out.istekler = mergeObject(base.istekler, mine.istekler, theirs.istekler);
    else if (k === "karakterler") out.karakterler = mergeList(base.karakterler, mine.karakterler, theirs.karakterler, (c) => c.ad);
    else if (k === "kartlar") out.kartlar = mergeList(base.kartlar, mine.kartlar, theirs.kartlar, (c) => c.id);
    else {
      const v = pick(base[k], mine[k], theirs[k]);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}
