---
name: cizgi-sinema
description: Film grammar for Çizgi Stüdyo episodes — shot progression, continuity rules (180°, 30°, screen direction, match on action, eyeline), camera choices (tracking, over-the-shoulder, insert, close-up with shallow focus) and ready shot recipes. Use whenever you plan or revise the shots of a bolum.json, before the senaryo gate; `cizgi dogrula` reports the rules it can check as warnings.
---

# Film grammar for episodes

A shot list is not a list of poses. It must tell the viewer **where we are, who this is, what they see, what they do and what it means to them**, in that order, and the cuts must never confuse space or direction. Plan the shots with these rules **before** writing `bolum.json`, then show the plan at the senaryo gate.

Sources: [continuity editing (StudioBinder)](https://www.studiobinder.com/blog/what-is-continuity/), [12 continuity techniques (Epidemic Sound)](https://www.epidemicsound.com/blog/what-is-continuity-editing/), [film language: sequence (learnaboutfilm)](https://learnaboutfilm.com/film-language/sequence/), [shallow focus (StudioBinder)](https://www.studiobinder.com/camera-shots/focus/shallow-focus-shot/), [over-the-shoulder (Adobe)](https://www.adobe.com/ca/creativecloud/video/production/cinematography/camera-shots-and-angles/over-the-shoulder-shot.html).

## 1. Shot progression (what the viewer needs, in order)
1. **Establish** place and character first: a wide shot, or a tracking shot that follows the character through the place. **Do not open on an unexplained detail**, such as a close-up of an object nobody has noticed yet. An object becomes important when a character notices it.
2. **Motivate every insert:** show the character noticing something (head turn, eyeline), then cut to what they see (insert or POV), then back to them.
3. **Go closer as emotion rises:** wide → medium → close. The decisive moment gets the closest shot, usually the face.
4. **End on meaning:** a close-up of the face reacting (shallow focus), or a wide that releases.

## 2. Continuity rules (checked by `cizgi dogrula` where possible)
| Rule | What it means here | Engine check |
|---|---|---|
| **180° / screen direction** | A character keeps the same screen direction across cuts: walking right stays walking right. Only a neutral shot (front or back view) may sit between opposite directions. | ✓ warns when consecutive shots show the same character facing opposite ways with no neutral view between |
| **30° rule (no jump cuts)** | Two consecutive shots of the same subject must change framing size **or** view (angle). Same view and same framing = jump cut. | ✓ warns |
| **Establishing first** | The first shot is wide, or a tracking shot. | ✓ warns when the first shot is close/detail |
| **Motivated insert** | An insert on a prop must follow a shot where a character looks at or reaches for it. | ✓ warns when an insert (camera target = prop) is the first shot or has no character in the shot before |
| **Match on action** | Cut while a movement is under way and continue it in the next shot (`cast[].from`). | – plan it: the action's time at the cut must equal `from` in the next shot (±0.1 s) |
| **Eyeline match** | After a character looks somewhere, the next shot shows what is there, framed from roughly their side of the axis. | – plan it |
| **Lead room** | A moving or looking character has more space in front of them than behind. | – camera `follow` keeps the walker left of centre when walking right |

## 3. Camera vocabulary (library: `cameras.json`)
- **wide**: geography and who is where; also the release at the end.
- **medium** (anchor: body): actions with the hands, decisions.
- **close** (anchor: face): reactions and feelings. The background is softly blurred (shallow focus).
- **detay** (insert): an object or hand in full frame, with a blurred background. Always motivated.
- **Moves:**
  - `static` is the default.
  - `push_in` moves closer as tension rises.
  - `pull_out` releases.
  - `follow` is a tracking shot: the camera moves with a walking character.
  - `acilis` (zoom out from a detail) only works when the detail has already been motivated, e.g. at the start of a second scene.
- **Views (separate rigs of the same person):** profile (`genc`), front 3/4 (`genc-on`), back 3/4 (`genc-arka`). Over-the-shoulder and third-person tracking shots use the back 3/4 view.

## 4. Recipe: a character notices and picks something up
1. **Tracking, back 3/4 (third person):** the character walks along the street, and the camera follows from behind. The object lies ahead on the ground. *Establish place, character and direction.*
2. **Medium, profile, same screen direction:** the character slows and **tilts the head toward the object**. *Motivation and eyeline.*
3. **Wide or medium, profile:** crouches and reaches. *Cut on action* just before the hand arrives.
4. **Insert, hand and object, shallow focus:** the open hand arrives, **the fingers close around the object** and lift it. *Continue the action (`from`).*
5. **Close-up, front 3/4, shallow focus:** the face looks at the object in the hand. *Meaning; the closest shot.*

## 5. Checklist before the senaryo gate
- [ ] Does the first shot establish place and character?
- [ ] Is every insert preceded by a look or reach?
- [ ] Do consecutive shots of the same subject change size or view?
- [ ] Does screen direction stay consistent (or pass through a neutral view)?
- [ ] Are cuts on action continued with `from`?
- [ ] Is the decisive moment the closest shot?
