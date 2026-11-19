/**
 * Backgrounds of an episode. A scene has one place (scene.bg); a shot may look at it from another
 * angle (shot.bg: another drawing of the same place, a reverse angle or a close set-up such as the
 * scale), cut straight with no fade. Everything that lists the drawings an episode uses goes through here.
 */

/** The background a shot is drawn on. */
export const shotBg = (scene, shot) => shot.bg || scene.bg;

/** Every background the episode uses, scenes' and shots' own, in order of first use. */
export const episodeBgs = (episode) => [...new Set((episode.scenes || []).flatMap((sc) => [sc.bg, ...(sc.shots || []).map((s) => s.bg).filter(Boolean)]))];
