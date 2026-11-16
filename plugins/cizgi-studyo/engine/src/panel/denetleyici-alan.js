// The inspector's building blocks, shared by denetleyici.js, bolum-ayar.js, altyazi-ayar.js and
// isik.js so the right panel reads as one page: a header that says what is selected, titled
// sections (rare ones folded), labels above controls, small choices as segmented buttons,
// numbers with their unit, sliders that show their value. Styles: ui-denetleyici.css.
import { el, select } from "./dom.js";

/** More choices than this read better as a dropdown in a ~300px panel. */
const MAX_SEGMENTS = 4;

/**
 * The top of a view: "← back", what kind of thing it is, its name and one muted line.
 * @param {{back?:{text:string, onClick:() => void}, kind?:string, title:string, meta?:string}} o
 * @returns {HTMLElement}
 */
export function header({ back, kind, title, meta }) {
  return el("header", { class: "ihead" },
    back ? el("button", { class: "btn small ghost back", type: "button", on: { click: back.onClick } }, back.text) : null,
    kind ? el("p", { class: "ihead-kind", text: kind }) : null,
    el("h2", { text: title }),
    meta ? el("p", { class: "ihead-meta", text: meta }) : null);
}

/**
 * A titled group of settings with an optional one-line explanation under the title
 * (Bölüm ayarları explains every section; quietSection() keeps a list calm).
 * @param {string} title
 * @param {string|null} hint
 * @param {...any} kids
 * @returns {HTMLElement}
 */
export function section(title, hint, ...kids) {
  return el("section", { class: "isec" },
    el("h3", { text: title }),
    hint ? el("p", { class: "isec-hint", text: hint }) : null,
    kids);
}

/** Like section() but the title carries the hint as a tooltip, so a list stays quiet. */
export function quietSection(title, hint, ...kids) {
  return el("section", { class: "isec" }, el("h3", { text: title, title: hint || undefined }), kids);
}

/** Which folded groups are open, by title: a redraw after an edit inside must not close them. */
const openFolds = new Set();

/**
 * A rarely used group, closed until opened; stays as the person left it until the page reloads.
 * @param {string} title
 * @param {string|null} hint
 * @param {...any} kids
 * @returns {HTMLDetailsElement}
 */
export function folded(title, hint, ...kids) {
  const box = el("details", { class: "isec isec-fold", open: openFolds.has(title) },
    el("summary", {}, el("span", { text: title })),
    hint ? el("p", { class: "isec-hint", text: hint }) : null,
    kids);
  box.addEventListener("toggle", () => { if (box.open) openFolds.add(title); else openFolds.delete(title); });
  return box;
}

/**
 * A label above its control. A <div>, not a <label>: a click on the words must not press the
 * first button of a segmented control. Pass the control's own aria-label for screen readers.
 * @param {string} text
 * @param {HTMLElement} control
 * @param {string} [hint] one muted line under the control
 * @returns {HTMLElement}
 */
export function labelled(text, control, hint) {
  // the words are not a <label>, so a bare control takes them as its name
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(control.tagName) && !control.hasAttribute("aria-label")) control.setAttribute("aria-label", text);
  return el("div", { class: "field" }, el("span", { text }), control, hint ? el("p", { class: "field-hint", text: hint }) : null);
}

/**
 * Two to four library words as segmented buttons (more: a dropdown, as dom.js select()).
 * An unknown current value stays visible and marked, as in select().
 * @param {string|undefined} value
 * @param {Array<string|{id:string,label:string}>} options
 * @param {(v:string|undefined) => void} onChange
 * @param {{empty?:string, label:string, disabled?:boolean}} o `empty` is the "not set" choice
 * @returns {HTMLElement}
 */
export function segment(value, options, onChange, { empty, label, disabled = false }) {
  const list = options.map((o) => (typeof o === "string" ? { id: o, label: o } : o));
  if (empty !== undefined) list.unshift({ id: "", label: empty });
  if (value !== undefined && !list.some((o) => o.id === value)) list.push({ id: value, label: `${value} (kütüphanede yok)` });
  if (list.length > MAX_SEGMENTS) {
    const s = select(value, options, onChange, { empty });
    s.setAttribute("aria-label", label);
    s.disabled = disabled;
    return s;
  }
  const group = el("div", { class: "iseg", role: "group", "aria-label": label });
  const buttons = list.map((o) => el("button", {
    type: "button", class: "iseg-b", disabled, "aria-pressed": String((value ?? "") === o.id),
    on: { click: (e) => {
      // pressed state first, so the choice shows even before the redraw
      for (const b of buttons) b.setAttribute("aria-pressed", String(b === e.currentTarget));
      onChange(o.id === "" ? undefined : o.id);
    } },
  }, o.label));
  group.append(...buttons);
  return group;
}

/**
 * A slider with its value beside it in a fixed-width slot (no shift while dragging); onSet
 * when let go.
 * @param {number} value
 * @param {{min?:number, max?:number, step?:number, label:string, show?:(x:number) => string, onSet:(x:number) => void}} o
 * @returns {HTMLElement}
 */
export function valueSlider(value, { min = 0, max = 1, step = 0.05, label, show = percent, onSet }) {
  const r = el("input", { type: "range", min, max, step, value, "aria-label": label });
  const out = el("output", { class: "islider-v", text: show(Number(value)) });
  r.addEventListener("input", () => { out.textContent = show(Number(r.value)); });
  r.addEventListener("change", () => onSet(Number(r.value)));
  return el("div", { class: "islider" }, r, out);
}

/** 0..1 as a whole percentage ("%80", Turkish order). */
export const percent = (x) => `%${Math.round(x * 100)}`;

/**
 * A number box with its unit after it ("s", "px").
 * @param {HTMLInputElement} input from dom.js number()
 * @param {string} unit
 * @param {string} label the box's accessible name
 * @returns {HTMLElement}
 */
export function withUnit(input, unit, label) {
  input.setAttribute("aria-label", label);
  return el("div", { class: "iunit" }, input, el("span", { "aria-hidden": "true", text: unit }));
}

/**
 * A checkbox with its words beside it (a lone box under a label reads as broken).
 * @param {string} text
 * @param {boolean} on
 * @param {(on:boolean) => void} onChange
 * @param {{disabled?:boolean, title?:string}} [o]
 * @returns {HTMLLabelElement}
 */
export function check(text, on, onChange, { disabled = false, title } = {}) {
  const box = el("input", { type: "checkbox", disabled });
  box.checked = on;
  box.addEventListener("change", () => onChange(box.checked));
  return el("label", { class: "icheck", title }, box, el("span", { text }));
}

/**
 * A destructive button that asks first, naming what goes (the panel has undo, but a click on
 * the wrong row should not be the way to find out).
 * @param {string} text the button's words
 * @param {string} question the confirmation, naming the item
 * @param {() => void} onYes
 * @param {{disabled?:boolean, title?:string}} [o]
 * @returns {HTMLButtonElement}
 */
export function dangerButton(text, question, onYes, { disabled = false, title } = {}) {
  return el("button", {
    class: "btn small danger", type: "button", disabled, title,
    on: { click: (e) => { e.stopPropagation(); if (window.confirm(question)) onYes(); } },
  }, text);
}
