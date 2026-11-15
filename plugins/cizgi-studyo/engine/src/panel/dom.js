// Small DOM helpers for the panel. Data only ever goes through textContent and
// setAttribute, never innerHTML, so nothing from a file can become markup.

export const $ = (id) => document.getElementById(id);

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "on") for (const [ev, fn] of Object.entries(v)) n.addEventListener(ev, fn);
    else if (k === "text") n.textContent = v;
    else if (k === "style" && typeof v === "object") {
      for (const [p, val] of Object.entries(v)) {
        if (p.startsWith("--")) n.style.setProperty(p, val); // CSS variables need setProperty
        else n.style[p] = val;
      }
    }
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat(Infinity)) if (kid != null && kid !== false) n.append(kid);
  return n;
}

const SVG_NS = "http://www.w3.org/2000/svg";
export function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) n.setAttribute(k, v);
  for (const kid of kids.flat(Infinity)) if (kid != null) n.append(kid);
  return n;
}

/** A <select> over library words; an unknown current value stays visible and marked. */
export function select(value, options, onChange, { empty } = {}) {
  const s = el("select", { on: { change: () => onChange(s.value === "" ? undefined : s.value) } });
  if (empty !== undefined) s.append(el("option", { value: "", text: empty }));
  for (const o of options) {
    const id = typeof o === "string" ? o : o.id;
    s.append(el("option", { value: id, text: typeof o === "string" ? o : o.label }));
  }
  if (value !== undefined && ![...s.options].some((o) => o.value === value)) {
    s.append(el("option", { value, text: `${value} (kütüphanede yok)` }));
  }
  s.value = value ?? "";
  return s;
}

/**
 * A number input that commits on change; an empty box means "not set". A typed value
 * outside min..max (the browser only hints at those) is brought back inside before it is used.
 */
export function number(value, onChange, { min, max, step = 0.05 } = {}) {
  const i = el("input", { type: "number", value: value ?? "", min, max, step });
  i.addEventListener("change", () => {
    if (i.value === "") return onChange(undefined);
    let n = Number(i.value);
    if (!Number.isFinite(n)) return onChange(undefined);
    if (min !== undefined) n = Math.max(min, n);
    if (max !== undefined) n = Math.min(max, n);
    if (String(n) !== i.value) i.value = String(n);
    return onChange(n);
  });
  return i;
}

export function field(text, control) {
  return el("label", { class: "field" }, el("span", { text }), control);
}

export function setKey(obj, key, value) {
  if (value === undefined) delete obj[key];
  else obj[key] = value;
}

export const seconds = (t) => `${t.toFixed(2)} s`;
