/**
 * The project wizard's routes (panel/proje-sihirbaz.js). The person collects their wishes for an
 * episode in the panel; they are kept in the story (bolumler/<id>/hikaye.json, see hikaye.mjs) so an
 * episode can be "being made" before it has a bolum.json. "Oluştur" hands the story to Claude as a
 * panel request; Claude builds (or updates) bolum.json from it, with the wizard of panel_adim.
 *
 *   GET  /api/yapim                 {yapimlar: [{id, baslik}]}   folders with a story and no bolum.json yet
 *   GET  /api/yapim/oku?id=         {id, story, version, bolum, errors}   bolum: the episode file when it exists
 *   POST /api/yapim                 {id, story, version}   write the story (valid, over the version read)
 *   POST /api/yapim/olustur         {id, hizli?}   ask Claude to build the episode from it (needs a Claude session);
 *                                   hizli (the one-screen quick start): only the idea and the format, Claude
 *                                   makes the characters and the scene cards itself:
 *                                   straight to Claude's panel_dinle when it listens, else the request queue
 */
import { existsSync, mkdirSync, readdirSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readStory, writeStory, validateStory } from "./hikaye.mjs";
import { addRequest } from "./istekler.mjs";
import { EPISODE_FILE, EPISODE_ID, HttpError, NEW_EPISODE_DIR } from "./panel-proje.mjs";

const relOf = (id) => `${NEW_EPISODE_DIR}/${id}/${EPISODE_FILE}`;

function idOf(value) {
  if (typeof value !== "string" || !EPISODE_ID.test(value)) throw new HttpError(400, "kimlik yalnızca küçük harf, rakam ve tire olabilir (örnek: park-gunu)");
  return value;
}

/**
 * What a story must have before Claude can build an episode from it. A quick start needs only the
 * idea and the format: Claude writes the characters and the cards from the idea.
 */
export function missingForBuild(story, { quick = false } = {}) {
  const missing = [];
  if (!story.fikir?.trim()) missing.push("hikâyenin fikri");
  if (quick) return story.istekler?.format ? missing : [...missing, "format (9:16 ya da 16:9)"];
  if (!story.karakterler?.length) missing.push("en az bir karakter");
  if (!story.kartlar?.length) missing.push("en az bir sahne kartı");
  if (!story.istekler?.format) missing.push("format (9:16 ya da 16:9)");
  if (!story.istekler?.boyut) missing.push("2B ya da 3B");
  return missing;
}

/** @param {{root:string, loadLib:() => object, requests:string|null, channel?:object}} opts */
export function makingRoutes({ root, loadLib, requests, channel = null }) {
  const episodePath = (id) => join(root, NEW_EPISODE_DIR, id, EPISODE_FILE);
  const read = (id) => {
    try {
      return readStory(episodePath(id));
    } catch (err) {
      throw new HttpError(422, err.message);
    }
  };

  return {
    "GET /api/yapim": () => {
      const base = join(root, NEW_EPISODE_DIR);
      const yapimlar = [];
      const dirs = existsSync(base) ? readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && EPISODE_ID.test(d.name)) : [];
      for (const d of dirs.sort((a, b) => a.name.localeCompare(b.name))) {
        const dir = join(base, d.name);
        if (existsSync(join(dir, EPISODE_FILE)) || !existsSync(join(dir, "hikaye.json"))) continue;
        let baslik = null;
        try {
          baslik = readStory(join(dir, EPISODE_FILE)).story.baslik || null;
        } catch {
          /* broken: listed without a title, the wizard shows why */
        }
        yapimlar.push({ id: d.name, baslik });
      }
      return { yapimlar };
    },
    "GET /api/yapim/oku": (_, url) => {
      const id = idOf(url.searchParams.get("id"));
      const r = read(id);
      return { id, ...r, bolum: existsSync(episodePath(id)) ? relOf(id) : null, errors: validateStory(r.story, loadLib()).errors };
    },
    "POST /api/yapim": (body) => {
      const id = idOf(body?.id);
      const dir = join(root, NEW_EPISODE_DIR, id);
      const made = !existsSync(dir);
      const lib = loadLib();
      const { ok, errors } = validateStory(body?.story, lib);
      if (!ok) throw new HttpError(400, errors.join("\n"));
      mkdirSync(dir, { recursive: true });
      try {
        return writeStory(episodePath(id), body.story, lib, body?.version);
      } catch (err) {
        if (made && statSync(dir).isDirectory() && !readdirSync(dir).length) rmdirSync(dir); // leave no empty folder
        throw new HttpError(err.code === 409 ? 409 : 400, err.message);
      }
    },
    "POST /api/yapim/olustur": (body) => {
      const id = idOf(body?.id);
      const { story, exists } = read(id);
      if (!exists) throw new HttpError(404, "bu bölümün hikâyesi yok: önce sihirbazı kaydet");
      const { ok, errors } = validateStory(story, loadLib());
      if (!ok) throw new HttpError(400, errors.join("\n"));
      const quick = body?.hizli === true;
      const missing = missingForBuild(story, { quick });
      if (missing.length) throw new HttpError(400, `Oluşturmadan önce eksikler: ${missing.join(", ")}`);
      // Claude waits in panel_dinle while the person fills the wizard: a request in the queue would
      // only reach it after that wait (hooks run between turns), so hand it over directly
      if (channel?.durum().dinliyor) return { kanal: channel.iste({ proje: id, adim: "ozet", tur: "olustur" }) };
      if (!requests) throw new HttpError(409, "Bu panel bir Claude oturumuna bağlı değil: /cizgi-studyo ile aç");
      const update = existsSync(episodePath(id));
      const metin = [
        `Proje sihirbazından: "${story.baslik || id}" bölümünü ${update ? "güncelle" : "oluştur"}.`,
        `İstekler ${NEW_EPISODE_DIR}/${id}/hikaye.json içinde (baslik, istekler, karakterler, kartlar: mekan, saat, nesneler).`,
        update
          ? "Değişen istekleri bolum.json'a uygula; değişmeyenlere dokunma."
          : `${relOf(id)} dosyasını bu isteklere göre yaz.`,
        quick
          ? "Hızlı başlangıç: karakterleri ve sahne kartlarını fikirden sen çıkar, soru sormadan ilk bölümü kur (cizgi-proje skill'indeki \"Hızlı başlangıç\"), editörde aç ve stüdyo moduna geç."
          : "cizgi-proje skill'indeki adımlarla: panel_adim sihirbazıyla ilerle, eksik çizimleri taslak yap, kararları bolum.json kararlar'a yaz, sonra senaryo tablosunu göster.",
      ].join("\n");
      try {
        return { istek: addRequest(requests, { root, b: relOf(id), hedef: { tur: "bolum", etiket: (story.baslik || id).slice(0, 100) }, metin }) };
      } catch (err) {
        throw new HttpError(400, err.message);
      }
    },
  };
}
