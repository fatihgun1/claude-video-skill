/**
 * The panel's side of the project library's drafts (see proje-kutuphane.mjs):
 *
 *   GET  /api/taslaklar                  {kutuphane (the project library folder), taslaklar}
 *   POST /api/taslak  {islem, tur, id}   islem "al": take it in · "reddet": put it aside
 *                                        → {taslaklar, vocab} (the library's words, with the new asset)
 *   GET  /kutuphane-taslak/<tur>/<id>.svg   a good draft's drawing (all layers together)
 *
 * Taking a draft in is the person's decision, made in the panel; nothing else does it.
 */
import { listDrafts, draftSvg, approveDraft, rejectDraft } from "./proje-kutuphane.mjs";
import { vocabulary } from "./panel-kutuphane.mjs";
import { HttpError } from "./panel-proje.mjs";

/** @param {{project:string|null, loadLib:() => object}} opts */
export function draftRoutes({ project, loadLib }) {
  const list = () => listDrafts(project, loadLib());
  return {
    // with the project library's own problems (drawings left out because they are broken)
    "GET /api/taslaklar": () => ({ kutuphane: project, taslaklar: list(), sorunlar: loadLib().projectErrors || [] }),
    "POST /api/taslak": (body) => {
      if (!project) throw new HttpError(409, "bu panelin proje kütüphanesi yok");
      const { islem, tur, id } = body || {};
      try {
        if (islem === "al") approveDraft(project, tur, id, loadLib());
        else if (islem === "reddet") rejectDraft(project, tur, id);
        else throw new Error('islem "al" ya da "reddet" olmalı');
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      return { taslaklar: list(), vocab: vocabulary(loadLib(true)) }; // read again now: the drawing just moved
    },
  };
}

/** /kutuphane-taslak/<tur>/<id>.svg → the drawing, or undefined when the path is not one of these. */
export function draftFile(path, { project, loadLib }) {
  const m = /^\/kutuphane-taslak\/(mekan|nesne)\/([a-z0-9_-]+)\.svg$/.exec(path);
  if (!m) return undefined;
  const svg = draftSvg(project, m[1], m[2], loadLib());
  if (!svg) throw new HttpError(404, "taslak yok ya da hatalı");
  return svg;
}
