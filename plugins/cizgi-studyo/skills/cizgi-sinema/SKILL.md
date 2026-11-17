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
| **Not only from the side** | A scene of 3 or more shots that shows people only in profile reads flat. Add a front 3/4 close-up, an over-the-shoulder shot or a tracking shot from behind. | ✓ warns (on the scene's first shot) |
| **Over the shoulder in a conversation** | When two people talk in a scene, at least one shot shows the speaker over the listener's shoulder: the listener's back 3/4 view in front (`back` 0), the speaker's front 3/4 further back (`back` ~0.35), medium, camera on the speaker. | ✓ warns (on the scene's first shot) |
| **30° rule (no jump cuts)** | Two consecutive shots of the same subject must change framing size **or** view (angle). Same view and same framing = jump cut. | ✓ warns |
| **Establishing first** | The first shot is wide, or a tracking shot. | ✓ warns when the first shot is close/detail |
| **Motivated insert** | An insert on a prop must follow a shot where a character looks at or reaches for it. | ✓ warns when an insert (camera target = prop) is the first shot or has no character in the shot before |
| **Match on action** | Cut while a movement is under way and continue it in the next shot (`cast[].from`). | – plan it: the action's time at the cut must equal `from` in the next shot (±0.1 s) |
| **Eyeline match** | After a character looks somewhere, the next shot shows what is there, framed from roughly their side of the axis. | – plan it |
| **Walk along a deep street** | On a background in perspective (`sokak-derinlik`), people walk along the street: toward or away from the camera, in a front or back view with a `follow` or `dolly_ileri` move. A profile walk crosses the pavement sideways and looks wrong. | ✓ warns on a profile walk on a deep background |
| **A crowd moves** | A crowd (`kalabalik-*` decor) walks: give each piece `akis` (`dx` sideways, `back` + going away / - coming closer, per second; e.g. `kalabalik-uzaklasan` `{"back": 0.04}`, `kalabalik-gelen` `{"back": -0.04}`, `kalabalik-karisik` `{"dx": 30}`). A frozen row of people reads as a wall. Far decor goes soft in close framings by itself. | ✓ warns on a crowd without akis |
| **Shot / reverse shot** | Two people talking: each line on its speaker (close or over the shoulder), not both in one static shot. | ✓ warns on lines of two people in one static shot |
| **Lead room** | A moving or looking character has more space in front of them than behind. | – camera `follow` keeps the walker left of centre when walking right |

**Between scenes:** a scene that goes on in the same place at the same time of day as the one before begins with a hard cut (`kesme`): it is the same moment. Any other scene begins with a short dip to black, about 0.3 s out and 0.3 s in (`kararma`). Set `scene.gecis` only to change that, for example a cut to keep a chase going, or a dip for a jump in time in the same place. The person changes it in the place window (**Sahneye geçiş**).

## 3. Camera vocabulary (library: `cameras.json`)
**Choose the framing by what the shot needs, not by habit.** Köşe Başı opened every scene "wide → medium → medium → close": 23 of 37 shots read as wide, and the person asked "niye sürekli geniş plan".
- **Wide:** only when entering a new place, or when movement across the place matters.
- **Talk:** shot / reverse shot in `gogus` or `close`, over the shoulder for the listener.
- **A feeling or a reaction:** `close`, or `detay` on the face or hands.
- **Talk:** frame both speakers of a conversation **the same size**, and change size for both together. In Köşe Başı the reverse shots jumped close → detay → chest → close at every cut, and the person said "yüz yakınlaştırma devamlılığı garip". `dogrula` warns.
- Do not repeat the same framing on **the same person** more than twice in a row. Alternating two speakers in matched close-ups is right.
- `push_in` at most once or twice a scene, at its peak. Use `detay` on a face only for the one strongest moment; never give `detay` to someone with no line.

Framings are measured on the person, the same in 16:9 and 9:16, however tall the drawing:
- `close`: head and shoulders.
- `gogus`: to the waist.
- `medium`: from the thighs up.
- `detay`: the face.

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
