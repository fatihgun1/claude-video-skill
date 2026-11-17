/*
 * Çizgi Stüdyo — facial expressions (cast[].ifade), shared by the browser player and Node.
 * The brows (brow_L / brow_R) and the eye size (eye_L / eye_R with data-pivot) carry the
 * expression, also while the character speaks; the
 * expression mouths (mouth_smile, mouth_sad, mouth_angry, mouth_scared, and the speech shapes mouth_O / mouth_E)
 * show only in speech silences and outside lines. A drawing without a part shows a neutral one.
 *
 * Loaded after core.js as a classic <script>, and via `import` in Node.
 * Attaches the API to globalThis.CizgiYuz.
 */
(function (root) {
  "use strict";

  const EXPRESSIONS = Object.freeze(["notr", "gulumse", "kizgin", "uzgun", "sasirmis", "korkmus"]);

  /** The face a spoken line's feeling (utterance.duygu) gives when the shot sets no ifade. */
  const DUYGU_IFADE = Object.freeze({
    kizgin: "kizgin",
    uzgun: "uzgun",
    korkmus: "korkmus",
    heyecanli: "sasirmis", // raised brows read as excitement while the mouth follows the speech
    neseli: "gulumse",
  });

  /**
   * Brows per expression, in rig units and degrees: lift moves them down (negative: up);
   * tilt turns the inner end (toward the other brow, or toward the nose) down (negative: up).
   */
  const BROWS = Object.freeze({
    notr: { lift: 0, tilt: 0 },
    gulumse: { lift: -2, tilt: -4 },
    kizgin: { lift: 6, tilt: 24 },
    uzgun: { lift: 2, tilt: -20 },
    sasirmis: { lift: -5, tilt: 0 }, // a higher brow meets the hair, drawn in the same colour
    korkmus: { lift: -3, tilt: -22 },
  });

  /** Eye size per expression [sx, sy] around the eye's data-pivot: wide in surprise and fear, narrow in anger. */
  const EYES = Object.freeze({
    kizgin: [1, 0.8],
    uzgun: [1, 0.9],
    sasirmis: [1.2, 1.3],
    korkmus: [1.25, 1.3],
  });

  /** The mouth an expression shows outside speech: the first the drawing has (mouth_O and mouth_E are speech shapes every rig has). */
  const MOUTH = Object.freeze({
    gulumse: "mouth_smile",
    kizgin: "mouth_angry",
    uzgun: "mouth_sad",
    sasirmis: "mouth_O",
    korkmus: ["mouth_scared", "mouth_E"],
  });

  /** Optional parts a drawing needs to show each expression (any one of a list of brows is enough). */
  const NEEDS = Object.freeze({
    notr: [],
    gulumse: ["mouth_smile"],
    kizgin: ["brow", "mouth_angry"],
    uzgun: ["brow", "mouth_sad"],
    sasirmis: ["brow"],
    korkmus: ["brow"],
  });

  /**
   * The face at shot-local time t: the shot's cast[].ifade when it sets one; otherwise, while the
   * character speaks a line with a feeling, the face of that feeling; else neutral.
   * @param {object} member cast member
   * @param {number} t shot-local seconds
   * @param {{duygu?:string}|null} speaking the line the character is speaking now
   */
  function faceAt(member, t, speaking) {
    if (member && member.ifade) return root.CizgiCore.expressionAt(member, t);
    return (speaking && DUYGU_IFADE[speaking.duygu]) || "notr";
  }

  /** The mouth to show: speech wins; in its silences (and outside lines) the expression's mouth when the drawing has it. */
  function mouthFor(viseme, face, has) {
    if (viseme !== "mouth_rest") return viseme;
    const m = [].concat(MOUTH[face] || []).find(has);
    return m || "mouth_rest";
  }

  /**
   * Transform of one brow. inner: +1 when its inner end is toward +x (the other brow or the nose
   * is to its right), -1 when it is to its left.
   */
  function browTransform(face, inner, px, py) {
    const b = BROWS[face] || BROWS.notr;
    if (!b.lift && !b.tilt) return "";
    return "translate(0 " + b.lift + ") rotate(" + inner * b.tilt + " " + px + " " + py + ")";
  }

  /** Transform of one eye group (eye_L / eye_R with data-pivot at its centre); "" when it keeps its size. */
  function eyeTransform(face, px, py) {
    const e = EYES[face];
    if (!e) return "";
    return "translate(" + px + " " + py + ") scale(" + e[0] + " " + e[1] + ") translate(" + -px + " " + -py + ")";
  }

  /** Which way each brow's inner end points: toward the other brow, or toward the nose (+x) when alone. */
  function innerSides(pivots) {
    if (pivots.length < 2) return pivots.map(() => 1);
    return pivots.map((p, i) => (pivots[1 - i][0] >= p[0] ? 1 : -1));
  }

  /**
   * Expression parts missing from a drawing for one face ([] when it can show it).
   * @param {string} face
   * @param {(id:string) => boolean} has
   */
  function missingFor(face, has) {
    return (NEEDS[face] || []).filter((p) => (p === "brow" ? !has("brow_L") && !has("brow_R") : !has(p)))
      .map((p) => (p === "brow" ? "brow_L/brow_R" : p));
  }

  root.CizgiYuz = { EXPRESSIONS, DUYGU_IFADE, BROWS, EYES, MOUTH, faceAt, mouthFor, browTransform, eyeTransform, innerSides, missingFor };
})(typeof window !== "undefined" ? window : globalThis);
