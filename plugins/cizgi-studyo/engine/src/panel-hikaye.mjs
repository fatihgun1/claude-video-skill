/**
 * The panel's story cards (hikaye.json, see hikaye.mjs):
 *
 *   GET  /api/hikaye?b=   {story, exists, version}
 *   POST /api/hikaye      {b, story, version}   write it (refused when invalid or changed on disk meanwhile)
 *
 * A draft: writing it never touches bolum.json or any approval.
 */
import { readStory, writeStory, validateStory } from "./hikaye.mjs";
import { HttpError } from "./panel-proje.mjs";

/** @param {{episodeOf:(rel:string) => {path:string}, loadLib:() => object}} opts */
export function storyRoutes({ episodeOf, loadLib }) {
  return {
    // with the file's problems (Claude or a hand edit may have written something off): the window shows them
    "GET /api/hikaye": (_, url) => {
      const ep = episodeOf(url.searchParams.get("b"));
      let read;
      try {
        read = readStory(ep.path);
      } catch (err) {
        throw new HttpError(422, err.message);
      }
      return { ...read, errors: validateStory(read.story, loadLib()).errors };
    },
    "POST /api/hikaye": (body) => {
      const ep = episodeOf(body?.b);
      try {
        return writeStory(ep.path, body?.story, loadLib(), body?.version);
      } catch (err) {
        throw new HttpError(err.code === 409 ? 409 : 400, err.message);
      }
    },
  };
}

/** The story file's version now, for the panel's poll; null when it cannot be read. */
export function storyVersion(episodePath) {
  try {
    return readStory(episodePath).version;
  } catch {
    return null;
  }
}
