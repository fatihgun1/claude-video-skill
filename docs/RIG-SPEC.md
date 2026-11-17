# Character rig specification (v2)

A character is one SVG file (`library/characters/<id>/rig.svg`) plus `character.json`. The engine only animates what the drawing exposes, so an illustrator can work in any vector tool (Inkscape, Affinity, Illustrator) as long as the file follows these rules. The library loader and `cizgi dogrula` check them automatically (`engine/src/rigspec.mjs`); a rig that breaks a rule is refused.

One person seen from several sides is several rigs (for example `genc`, `genc-on`, `genc-arka`) that share a `same_as` id.

## Canvas
- `viewBox="0 0 1000 1000"`. The feet rest on **y = 950** and the character is centred on **x = 500**.
- Flat shapes; strokes may stay as strokes. Gradients, `<pattern>`, `<clipPath>` and `<use href="#id">` are allowed (clip a part's shadow to the part with a `<clipPath>`). The checker refuses `<script>`, `<style>` elements, `<image>`, `<foreignObject>`, `<iframe>`, `<object>`, `<embed>`, `<link>`, event handlers and any link or `url(...)` that does not start with `#`.
- No filters and no masks in a character. The checker does not refuse them, but the player redraws every character every frame and the scene light already filters it.
- **No `transform` attribute on any `<g>`**: the player owns transforms. Bake positions into the shapes.
- Colours may use CSS variables with a fallback, e.g. `fill="var(--top, #8fb3a0)"`, so an episode can recolour the character without touching the drawing. List the variables in `character.json` → `palette_vars`.
- Paint order is document order: far parts first, near parts last.

## Group tree
Nesting matters: a child moves with its parent. `_L` / `_R` are the **character's** left and right; in a front view `_L` appears on the viewer's right.

```
root                                  outermost group
├─ body_back (optional)               data-pivot = hips; turns with the body channel
│  └─ arm_R (hose) → hand_R           far arm and anything worn on the back, drawn behind the legs
├─ leg_R, leg_L                       a rotating group (data-pivot = hip)
│                                     or a hose (data-hose = hip knee ankle) with foot_R / foot_L inside
└─ body                               data-pivot = hips (the whole upper body tilts around it)
   ├─ tail (optional)                 data-pivot = tail root
   ├─ head                            data-pivot = neck
   │  ├─ ear_R, ear_L (optional)      data-pivot = ear root
   │  ├─ brow_R, brow_L (expressions)  data-pivot = middle of the brow
   │  ├─ eye_R → eye_R_open, eye_R_closed   (data-pivot = eye centre, for expressions)
   │  ├─ eye_L → eye_L_open, eye_L_closed
   │  └─ mouth → mouth_rest, mouth_A, mouth_E, mouth_O, mouth_U,
   │             mouth_MBP, mouth_FV, mouth_L, mouth_smile,
   │             mouth_sad, mouth_angry, mouth_scared (expressions)
   └─ arm_L (hose) → hand_L           near arm, drawn over the body
```

Rules the checker enforces:
- `data-pivot="x,y"` on every group the player rotates: `body`, `head`, `hand_*`, non-hose legs, `foot_*` of hose legs, and `ear_*`, `tail`, `body_back` when present.
- `body_back`, when present, is a direct child of `root`. Only arms may live in it instead of in `body`.
- Only `eye_*_open` and `mouth_rest` are visible by default. Every other eye and mouth group has `display="none"`.

## Hoses: arms and knee legs
An arm is one continuous stroke from shoulder through elbow to wrist, redrawn every frame, so no joint seam can show.

```xml
<g id="arm_L" data-hose="516,284 524,415 528,548">   <!-- rest shoulder, elbow, wrist -->
  <path class="hose-line" .../>                       <!-- outline (drawn wider) -->
  <path class="hose-fill" .../>                       <!-- sleeve colour on top -->
  <path class="hose-shade" d="..." fill="none" stroke="var(--top-dark, #b8862e)"
        stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>  <!-- optional shadow band -->
  <g id="hand_L" data-pivot="528,548"> ... </g>       <!-- follows the wrist -->
</g>
```

- Channels: `arm_L_upper` bends at the shoulder, `arm_L_lower` at the elbow.
- A leg drawn the same way gets a knee: `data-hose="hip knee ankle"` with channels `leg_L_upper` and `leg_L_lower`. Its `foot_L` group (pivot = ankle) follows the ankle and turns with `foot_L`.
- `leg_L_lift` raises the foot of a hose leg (stepping toward or away from the camera).
- Only `hose-line`, `hose-fill` and `hose-shade` (and a round cap on the shoulder or hip) may sit directly in a hose group: anything else stays put while the limb bends and slides off (`dogrula` warns, `taslaklar` refuses).

### Shading a hose: `path.hose-shade`
An optional band of shadow, redrawn every frame from the same curve as `hose-fill` (core `hoseShade`):
- Its `stroke-width` is the band's width at full strength (about 0.38 of the fill's; never wider than the fill, the checker refuses that). The fill's `stroke-width` must be set too.
- The band lies along the side of the limb away from the light, its outer edge on the fill's edge, so it stays inside the fill and follows every bend. The `d` in the file is only the rest pose (facing right); the player rewrites `d` and `stroke-width`.
- **Light rule:** the scene's light comes from the upper left of the screen, always. The side is chosen in screen terms from the limb's shoulder-to-wrist direction, after the body's turn and the mirror of a character facing left (`facing: "sol"`), so a mirrored character keeps its shade on the same screen side as the others. When the limb points along the light (down-right or up-left) the band narrows to nothing before it changes side, so it never jumps.
- Colour: the fill's `-dark` partner (`--top-dark`, `--pants-dark`, `--skin-dark`), so recolouring and costume variants recolour it. On a limb already filled with a `-dark` colour (the far arm or leg), use `stroke="var(--line, #3f3530)" stroke-opacity="0.3"`.
- Shadows on rigid parts (torso, head, hands, feet) are ordinary shapes inside the part's group, clipped to it (`<clipPath clipPathUnits="userSpaceOnUse"><use href="#govde"/></clipPath>`). They turn with the part, and a mirrored character mirrors them: unlike the hose bands they do not follow the scene's light when the character faces left.

## Hands that hold things
A hand can carry three optional parts, in this order:

```xml
<g id="hand_L" data-pivot="528,548" data-grip="530,583" data-grip-angle="90">
  <path .../>                                  <!-- palm: behind the held object -->
  <g id="hand_L_slot"/>                        <!-- the held prop is drawn here -->
  <g id="hand_L_open"> ... </g>                <!-- fingers open (visible) -->
  <g id="hand_L_grip" display="none"> ... </g> <!-- fingers closed around the object -->
</g>
```

- `data-grip`: the point where a prop's own grip point sits. Without it the wrist pivot is used.
- `data-grip-angle`: turns the prop in the hand, in degrees. Use 90 for an object that lies across a hand hanging down.
- Channel `grip_L` ≥ 0.5 shows `hand_L_grip`, otherwise `hand_L_open`.
- Shapes before the slot are behind the prop and shapes after it are in front, so the fingers wrap the object.

## Eyes and mouth
- Channels `gaze_x` and `gaze_y` (rig units) move both eye groups, open and closed, so a character looks at what it attends to. Keep the pupils far enough inside the eye shape for about 6 units of travel.
- Blinking is automatic.

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

## Facial expressions
An episode gives a face per shot with `cast[].ifade`: `notr`, `gulumse`, `kizgin` (angry), `uzgun` (sad), `sasirmis` (surprised) or `korkmus` (scared), or a list of `{ifade, at}` moments. Without it, the face follows the `duygu` of the line the character is speaking (kizgin, uzgun, korkmus; heyecanli → sasirmis; neseli → gulumse). The player (`engine/src/runtime/yuz.js`) uses these parts; all of them are optional, but **draw them on every new character that shows its face**:

| Part | What the player does | Rule |
|---|---|---|
| `brow_L`, `brow_R` | Moves and turns each brow around its `data-pivot`: angry turns the inner ends (toward the other brow, or toward the nose in a profile) down, sad and scared turn them up, surprise lifts them. They keep the expression while the character speaks. | One brow stroke per group inside `head`, `data-pivot="x,y"` at its middle. A profile needs only the brow it shows. |
| `data-pivot` on `eye_L` / `eye_R` | Widens the eye (surprise, fear) or narrows it (anger, sadness) around that point. | The centre of the open eye. Leave it off an eye the view does not show. |
| `mouth_sad` | Shows outside speech for `uzgun`: corners down. | Inside `mouth`, `display="none"`. |
| `mouth_angry` | Shows outside speech for `kizgin`: a tight, downturned mouth. | Inside `mouth`, `display="none"`. |
| `mouth_scared` | Shows outside speech for `korkmus`: a wide, wobbly grimace with the teeth showing; without it `mouth_E`. | Inside `mouth`, `display="none"`. |

`sasirmis` uses `mouth_O` outside speech. During a line the lip-sync mouth always wins; the brows and the eye size keep the expression. Keep the brows clear of hair drawn in their colour: a lifted brow that meets the fringe disappears into it. A drawing without the parts shows a neutral face, and `cizgi dogrula` warns ("this drawing has no angry face"); a back view needs none.

## character.json

```json
{
  "name": { "tr": "Genç (profil)", "en": "Young man (profile)" },
  "view": "profile-right",
  "same_as": "genc",
  "license": "CC0-1.0",
  "palette_vars": ["skin", "hair", "top", "line"],
  "face_y": 125,
  "limits": { "arm_L_upper": [-90, 10], "arm_L_lower": [-145, 5], "hand_L": [-55, 55], "head": [-25, 25] }
}
```

| Field | Meaning |
|---|---|
| `view` | `front`, `profile-right`, `three-quarter-right`, `back-three-quarter-right`. The cinema checks use it for screen direction and to stop front or back views from walking sideways. Draw facing right; the `facing` field of a cast member mirrors the rig. |
| `same_as` | Rig id of the person this view belongs to. The 30° and jump-cut checks treat all views of one person as one subject. |
| `face_y` | Height of the eyes in rig units. Close-ups and inserts frame on it. |
| `limits` | `[min, max]` degrees per channel. An action that bends a joint past its limit is an **error**: anatomy is checked before anything is rendered. |
| `temporary` | `true` while the drawing is a placeholder; starter-pack characters drop it. |

## Costume variants

One drawing can carry several costumes. Mark a part with `data-varyant="temiz"` to show it only in that variant, or with `data-varyant-yok="temiz"` to hide it there (both take a space-separated list). Declare the variants in `character.json`:

```json
"varyantlar": { "temiz": { "ad": { "tr": "Temiz kıyafet", "en": "Clean clothes" }, "palette": { "top": "#3a5f8a" } } }
```

`palette` may only name the drawing's `palette_vars`. An episode picks a variant per shot with `cast[].varyant`; without it the drawing shows as drawn. Do not put variant parts on a bending limb (see Hoses).

## Motion conventions
Action files (`library/actions/*.json`) give rotation angles in degrees around each pivot. In SVG, positive angles turn clockwise. A hanging `_R` arm swings outward with a positive angle; a hanging `_L` arm swings outward with a negative angle. Special channels:
- `root_y`: lift, in rig units; negative is up.
- `root_x`: sideways, in rig units; positive is where the character faces (sitting down, the hips go back so the feet stay put).
- `root_sx` / `root_sy`: squash and stretch around the feet; 1 is neutral.

## Backgrounds and props
- A background is an SVG with `viewBox="0 0 1920 1080"` in `library/backgrounds/`; the ground line is at y = 870 (`world.json` → `ground_y`). A perspective background (for camera dollies) gives its vanishing point as `data-vp="x,y"` on the `<svg>` element.
- A prop is an SVG in `library/props/` with `data-base="x,y"` (the point that rests on the ground) and `data-grip="x,y"` (the point that sits in a hand).
- The same elements are refused as in a rig; gradients, `<pattern>` and `<clipPath>` are allowed. Filters only on a still background layer (`derinlik` 0, the sky), for example a light `feTurbulence` grain; never in a layer that moves with the camera, in a prop, and no `feGaussianBlur` (the camera's depth of field already blurs).

## Hand-off checklist for an illustrator
- One SVG per view that follows the tree above, with ids spelled exactly as shown.
- A model sheet (front, profile, 3/4, back), a size line-up with the other characters, and the colour codes.
- Joint limits measured on the drawing: how far each arm, leg and the head can turn before the shapes break.
- Written commercial-use permission and copyright assignment, so the asset can be published under CC0.
