# Character rig specification

A character is one SVG file (`library/characters/<id>/rig.svg`) plus `character.json`. The engine only animates what the drawing exposes, so an illustrator can work in any vector tool (Inkscape, Affinity, Illustrator) as long as the file follows these rules. `cizgi dogrula` and the library loader check them automatically (`engine/src/rigspec.mjs`).

## Canvas
- `viewBox="0 0 1000 1000"`. The feet rest on **y = 950** and the character is centred on **x = 500**.
- Flat shapes; strokes may stay as strokes. No masks, filters or effects. Gradients are allowed but keep them simple.
- **No `transform` attribute on any `<g>`**: the player owns transforms. Bake positions into the shapes.
- Colours may use CSS variables with a fallback, e.g. `fill="var(--fur, #d9a877)"`, so an episode can recolour the character without touching the drawing. List the variables in `character.json` → `palette_vars`.

## Required groups (ids)
Nesting matters: a child moves with its parent.

```
root                      outermost group
├─ leg_R, leg_L           data-pivot = hip
└─ body                   data-pivot = hips (whole upper body tilts around it)
   ├─ tail (optional)     data-pivot = tail root
   ├─ head                data-pivot = neck
   │  ├─ ear_R, ear_L (optional)     data-pivot = ear root
   │  ├─ eye_R → eye_R_open, eye_R_closed
   │  ├─ eye_L → eye_L_open, eye_L_closed
   │  └─ mouth → mouth_rest, mouth_A, mouth_E, mouth_O, mouth_U,
   │             mouth_MBP, mouth_FV, mouth_L, mouth_smile
   ├─ arm_R_upper         data-pivot = shoulder
   │  └─ arm_R_lower      data-pivot = elbow
   │     └─ hand_R        data-pivot = wrist
   └─ arm_L_upper → arm_L_lower → hand_L   (same as right)
```

- `_L` / `_R` are the **character's** left and right. In a front view `_L` appears on the viewer's right.
- `data-pivot="x,y"` is required on every group the player rotates: body, head, upper and lower arms, hands, legs, and ears or tail if present.
- Only `eye_*_open` and `mouth_rest` are visible by default. Give the other eye and mouth groups `display="none"`.
- Overlap the shapes at the joints (round ends work best) so no gap opens when a joint bends 15–20°.
- Paint order is document order: back limbs, then body, then head, then front arms.

## Mouth shapes
| Group | Sound | Rhubarb shape |
|---|---|---|
| `mouth_MBP` | m, b, p (lips closed) | A |
| `mouth_E` | e, i, most consonants | B |
| `mouth_A` | a (wide open) | C, D |
| `mouth_O` | o | E |
| `mouth_U` | u, w | F |
| `mouth_FV` | f, v | G |
| `mouth_L` | l | H |
| `mouth_rest` | silence | X |
| `mouth_smile` | expression, not speech | – |

## Motion conventions
Action files (`library/actions/*.json`) give rotation angles in degrees around each pivot. In SVG, positive angles turn clockwise. A hanging `_R` arm swings outward with a positive angle; a hanging `_L` arm swings outward with a negative angle. Special channels:
- `root_y`: lift, in rig units; negative is up.
- `root_sx` / `root_sy`: squash and stretch around the feet; 1 is neutral.

## Hand-off checklist for an illustrator
- One SVG per character that follows the tree above, with ids spelled exactly as shown.
- A front and 3/4 model sheet, a size line-up with the other characters, and the colour codes.
- Written commercial-use permission and copyright assignment, so the asset can be published under CC0.
