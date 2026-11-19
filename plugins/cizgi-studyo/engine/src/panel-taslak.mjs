/**
 * The panel's side of the project library's drafts (see proje-kutuphane.mjs):
 *
 *   GET  /api/taslaklar                  {kutuphane (the project library folder), taslaklar}
 *   POST /api/taslak  {islem, tur, id}   islem "al": take it in (a draft with a project drawing's id replaces
 *                                        it) · "reddet": put it aside · "hepsini-al" (tur only): every good draft
 *                                        of that kind → {taslaklar, vocab, alinan?, hatalar?}
 *   GET  /kutuphane-taslak/<tur>/<id>.svg   a good draft's drawing (all layers together)
 *   GET  /kutuphane-taslak/konsept/<id>.svg  a concept sketch (kutuphane/taslak/konsept/<id>.svg): a look to
 *                                            agree on before a rig is drawn, shown in the panel (panel_sor)
 *
 * Taking a draft in is the person's decision, made in the panel; nothing else does it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { listDrafts, draftSvg, approveDraft, approveAll, rejectDraft } from "./proje-kutuphane.mjs";
import { checkSvgSafety } from "./rigspec.mjs";
import { vocabulary } from "./panel-kutuphane.mjs";
import { HttpError } from "./panel-proje.mjs";

const KINDS = ["mekan", "nesne", "karakter", "hareket"];

/** @param {{project:string|null, loadLib:() => object, channel?:object|null}} opts */
export function draftRoutes({ project, loadLib, channel = null }) {
  const list = () => listDrafts(project, loadLib());
  return {
    // with the project library's own problems (drawings left out because they are broken)
    "GET /api/taslaklar": () => ({ kutuphane: project, taslaklar: list(), sorunlar: loadLib().projectErrors || [] }),
    "POST /api/taslak": (body) => {
      if (!project) throw new HttpError(409, "bu panelin proje kütüphanesi yok");
      const { islem, tur, id } = body || {};
      let all = null;
      try {
        // the person pressed Al / Yeni sürümü al themselves: that is their yes for the episodes it changes
        if (islem === "al") approveDraft(project, tur, id, loadLib(), { onaylandi: true });
        else if (islem === "reddet") rejectDraft(project, tur, id);
        else if (islem === "hepsini-al") {
          if (!KINDS.includes(tur)) throw new Error(`tür ${KINDS.join(", ")} olmalı`);
          all = approveAll(project, loadLib(), tur, { onaylandi: true });
        } else throw new Error('islem "al", "hepsini-al" ya da "reddet" olmalı');
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      // Claude, which may be waiting for these drawings in a wizard step, hears it
      const cizimler = all ? all.alinan.map((x) => ({ tur: x.tur, id: x.id })) : [{ tur, id }];
      if (cizimler.length) channel?.taslak({ islem: islem === "hepsini-al" ? "al" : islem, cizimler });
      // read again now: the drawings just moved
      return { taslaklar: list(), vocab: vocabulary(loadLib(true)), ...(all ?? {}) };
    },
  };
}

/** /kutuphane-taslak/<tur>/<id>.svg → the drawing, or undefined when the path is not one of these. */
export function draftFile(path, { project, loadLib }) {
  const m = /^\/kutuphane-taslak\/(mekan|nesne|karakter|konsept)\/([a-z0-9_-]+)\.svg$/.exec(path);
  if (!m) return undefined;
  if (m[1] === "konsept") {
    const file = project ? join(project, "taslak", "konsept", `${m[2]}.svg`) : null;
    if (!file || !existsSync(file)) throw new HttpError(404, "konsept yok");
    const svg = readFileSync(file, "utf8");
    if (checkSvgSafety(svg).length) throw new HttpError(404, "konsept çiziminde izin verilmeyen öğeler var");
    return svg;
  }
  const svg = draftSvg(project, m[1], m[2], loadLib());
  if (!svg) throw new HttpError(404, "taslak yok ya da hatalı");
  return svg;
}
