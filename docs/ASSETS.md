# Ready-made figure assets

Verified and acquired **2026-11-18**. Author: **Quaternius**. These figures are
third-party assets, not original artwork by this application's authors.

## Selected distribution and license

The selected male/female pair comes from the official free
**Universal Base Characters [Standard]** distribution:

- [Official pack page](https://quaternius.com/packs/universalbasecharacters.html).
- [Official creator download page](https://quaternius.itch.io/universal-base-characters).
- Original archive filename: `Universal Base Characters[Standard].zip`.
- Actual downloaded size: **128,968,391 bytes**; the storefront labels it 122 MB.
- Storefront file date observed: **2025-12-16**.
- Archive SHA-256:
  `FDBF1804C90DFC1EA03E992BFF7DA2DFD1A79318E13270A660180F9308455F40`.
- Selected archive directory:
  `Universal Base Characters[Standard]/Base Characters/Godot - UE/`.
- Exact included license:
  [License_Standard.txt](../public/models/external/quaternius-universal-base/License_Standard.txt).
  Its 806 bytes are preserved unchanged from the archive root.

The archive's license explicitly states **CC0 1.0 Universal / Public Domain
Dedication**, linking to the
[CC0 deed](https://creativecommons.org/publicdomain/zero/1.0/). The official pack
page and creator storefront also explicitly identify this pack as CC0 on the
access date. CC0 permits copying, modification and redistribution, including
commercial use. Credit is not required by CC0; retain the provenance and credit
Quaternius as a courtesy, without implying endorsement.

**Important discrepancy:** the site's
[global license page](https://quaternius.com/license.html) currently presents
Quaternius Asset License v1.0, updated 2026-08-28, with standalone-asset
redistribution restrictions. This selection relies on the **specific pack's
current CC0 declarations and its actual included CC0 license**, not on an
assumption that all Quaternius assets are CC0. Do not silently substitute another
pack, a later differently licensed archive, or the paid Source edition. Preserve
this evidence and recheck licensing when replacing assets.

The **free Standard archive contains only the Superhero male/female base-body
pair**, plus a subset of hairstyles. Regular and Teen base bodies advertised for
the full kit are not present in this free archive. No paid Source files were
accessed. These are stylized, muscular bodies rather than neutral anatomical
scans; suitability for a particular drawing reference remains a visual judgment.

## Shipped files

Final directory:
[public/models/external/quaternius-universal-base/](../public/models/external/quaternius-universal-base/).

Entry points:

- [Superhero_Male_FullBody.gltf](../public/models/external/quaternius-universal-base/Superhero_Male_FullBody.gltf).
- [Superhero_Female_FullBody.gltf](../public/models/external/quaternius-universal-base/Superhero_Female_FullBody.gltf).

Both are **glTF 2.0**, exported by Khronos glTF Blender I/O v4.3.47, with separate
binary buffers and PNG textures. The original glTF and binary files are
unchanged. Alongside the two base bodies, the six official sculpted hairstyles
from the same CC0 `Universal Base Characters[Standard].zip` archive
(`Universal Base Characters[Standard]/Hairstyles/glTF/`) are shipped in the same
folder so they share `T_Hair_1_Albedo.png` and `T_Hair_1_Normal_png.png`:

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `Superhero_Male_FullBody.gltf` | 30,989 | `E7FCEA214ECF8855AFBF910B50DE6F9C7D1DECFB71CA28BAD8A4481452DAFEB4` |
| `Superhero_Male_FullBody.bin` | 720,076 | `459003F9745853AE562A85506A2B94DD56515C1F37728F9FA3D2CE1A3E4CD92F` |
| `Superhero_Female_FullBody.gltf` | 31,656 | `ADEDF28000A0716F689B009A70314506FC62F827498F77BA852ACB5610F3F3F4` |
| `Superhero_Female_FullBody.bin` | 990,808 | `3A8220A485B33D05D879115A50697728B45A151781106033AFB8B8C243FCA208` |
| `Hair_SimpleParted.gltf` | 2,010 | `CE6C666D00BCCA2BAA0C58D0442505F90F8FEFF952592EFFC4697A2341E9E56D` |
| `Hair_SimpleParted.bin` | 32,032 | `57C6359703A37E346EE38A9C7BA55C8DEE761C0A02DA99847D06F5A91728F3CC` |
| `Hair_Long.gltf` | 2,056 | `94500E2E37E09EFC8B8B920B8C6437EF1C76CA35863992B82D0D5DE6E77122E9` |
| `Hair_Long.bin` | 115,996 | `13996DA35C7AFBF8CB5097DA37207EE5B7C2E2904D4AB9E2ACE9843030FFF8D5` |
| `Hair_Buns.gltf` | 2,243 | `2BB3593575E21C9AF39A53E48C42C1314B0A894E9577F3F14ABFFCB145CD56C5` |
| `Hair_Buns.bin` | 131,768 | `4F6D4C010201278483DA8D6D46EC40E3BEB8D9E679EC2139BED216C561BCCD38` |
| `Hair_Buzzed.gltf` | 2,006 | `43752A4C8F2464EB2494A8AB179BF7AD237638A3D47FB3DE0A38361DB40E1451` |
| `Hair_Buzzed.bin` | 19,892 | `89992FC7A5319DF6F2908E44A3B694329FAC4B500629A573224702E5FDD16F77` |
| `Hair_BuzzedFemale.gltf` | 2,191 | `3F30E5A7B0FC6D04D2980A4E937CC5E4B03CA923C9247869168EF13E1B40B747` |
| `Hair_BuzzedFemale.bin` | 19,892 | `6F1AB9BC997B01311DC0635EE165EDFE27BD9715222718BC4CF4265E10B933AF` |
| `Hair_Beard.gltf` | 2,005 | `C91EF54606AAD25A9D1191DEABA90CB411C0067D8CEF262B2F4819F242E5B365` |
| `Hair_Beard.bin` | 25,276 | `781CF9B719D75A9F8D73881D2CA0713FE580D774EDC96ADADED392AAD37A72B7` |
| `License_Standard.txt` | 806 | `0F4BEAF0FE360A7732E58BBE3DBF60A2422367FBEA60CB9EA4ADD968F383268E` |

### Upstream texture filename repairs

Two image URIs in the original glTF refer to filenames missing from the archive.
The intended original PNGs are present under slightly different names. The
selected distribution supplies byte-identical copies at the referenced names:

| Shipped URI filename | Original archive filename | SHA-256 |
| --- | --- | --- |
| `T_Eye_Normal_png.png` | `T_Eye_Normal.png` | `9ED61F7726A54FE346A78B9E5A18905D8E2B88F86235D97F53CD207A26F3F8C7` |
| `T_Hair_1_Normal_png.png` | `T_Hair_1_Normal.png` | `57FD0AD8C96A4D01B38769637E066CECAA285B456F6E48CE00863754A457AFFB` |

No pixel edits, geometry changes, invented textures, glTF rewrites or
re-exports were needed. All other shipped dependency filenames match the archive
exactly.

### Sculpted CC0 hairstyles and facial hair color

The application loads the six sculpted CC0 hairstyle meshes from the same
`Universal Base Characters[Standard]` archive (`Hair_SimpleParted`, `Hair_Long`,
`Hair_Buns`, `Hair_Buzzed`, `Hair_BuzzedFemale`, and `Hair_Beard`) in
`src/hair.ts` and attaches the selected hairstyle directly to the figure's
`Head` bone (`Scalp hair`) using the exact inverse bind-pose transform plus a
crown-aligned cross-body skull adapter so every hairstyle (`Side parted`,
`Long waves`, `Twin buns`, `Short crop`, `Parted + beard`, or `None (bald)`)
fits both male and female heads cleanly.

Because `T_Hair_1_Albedo.png` is authored as dark brown (`~#4c362c`), `src/hair.ts`
normalizes its luminance at runtime into a grayscale strand-detail map (`158..255`)
while retaining `T_Hair_1_Normal_png.png`, allowing any user-selected `hairColor`
(from platinum blonde to black or vivid tints) to color scalp locks, eyebrows,
and modeled eyelashes consistently without losing sculpted strand highlights.

## Built-in animation library for pose extraction

To let users scrub real motion-capture/keyframed animation cycles and extract any
frame as an editable static 17-joint pose—without redistributing raw Adobe Mixamo
downloads (which Adobe's Mixamo FAQ/Terms prohibit redistributing in open-source
repositories)—the repository ships **Quaternius — Universal Animation Library
[Standard]** under its archive-included **CC0 1.0 Universal** dedication, while
supporting local in-browser import of user-downloaded Mixamo `.fbx` / `.glb` /
`.gltf` files via `loadUserAnimationFile` (`src/animationPoseExtractor.ts`):

- [Official pack page](https://quaternius.com/packs/universalanimationlibrary.html).
- Original archive: `Universal Animation Library[Standard].zip` (**15,904,933 bytes**,
  SHA-256 `CC73FC4E495B82958207316596317A38065BDE1027937452DA537724` — see
  [RESEARCH.md](./RESEARCH.md) Section 14.2).
- Shipped directory:
  [public/models/animations/quaternius-ual1/](../public/models/animations/quaternius-ual1/).

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `UAL1_Standard.glb` | 7,618,436 | `69591853D817488EDAA8FD9BF8FC1D821EAEAF789F8627B3CD23B41C4ED67997` |
| `License.txt` | 332 | `6D01F55C6E4C49A2C9963E147E561945AE2C83958C8CA667D90A6BFFDBFAC061` |
| `README.txt` | 702 | `CCD02718886B5A57F10F0A8911A38CFE10C36880E1D6DFA3445923FBA32D2A72` |

## Observed rig and coordinates

Both files have **one 65-joint humanoid skin**, shared by three skinned meshes:
body, eyes and eyebrows. Both have **zero animation clips**. The native bind pose
is a standing **T-pose**, with Y up, anatomical left toward +X, and front/toes
toward +Z. Coordinates are already approximately meters; do not apply a
centimeter-to-meter conversion.

Measured after an actual Three GLTFLoader browser load, world-matrix update and
precise skinned-vertex bounds calculation, before application normalization:

| Figure | Native min Y | Native max Y | Height | Vertices, all meshes | Triangles, all meshes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Male | -0.00950985 | 1.81007667 | 1.81958651 | 8,483 | 14,318 |
| Female | -0.00840711 | 1.76664385 | 1.77505096 | 8,844 | 15,060 |

For floor alignment, translate the complete imported group upward by the
negative native minimum Y, or calculate equivalent bounds in the adapter.
Do not move individual bones to force the soles onto the floor.

### Semantic mapping

Names and capitalization are exact:

| App concept | Imported bone |
| --- | --- |
| Skeleton origin | `root` |
| Hips | `pelvis` |
| Lower spine | `spine_01` |
| Middle spine | `spine_02` |
| Chest | `spine_03` |
| Neck | `neck_01` |
| Head | `Head` |
| Collarbone | `clavicle_l`, `clavicle_r` |
| Shoulder / upper arm | `upperarm_l`, `upperarm_r` |
| Elbow / forearm | `lowerarm_l`, `lowerarm_r` |
| Wrist / hand | `hand_l`, `hand_r` |
| Hip / upper leg | `thigh_l`, `thigh_r` |
| Knee / lower leg | `calf_l`, `calf_r` |
| Ankle / foot | `foot_l`, `foot_r` |
| Toe ball | `ball_l`, `ball_r` |

Hierarchy:

```text
Armature
  root
    pelvis
      spine_01 -> spine_02 -> spine_03 -> neck_01 -> Head
        [spine_03] clavicle_l/r -> upperarm_l/r -> lowerarm_l/r -> hand_l/r
      thigh_l/r -> calf_l/r -> foot_l/r -> ball_l/r -> ball_leaf_l/r
```

Each hand also has `index`, `middle`, `pinky`, `ring` and `thumb` chains, named
`<finger>_01_l/r` through `<finger>_03_l/r`, ending in
`<finger>_04_leaf_l/r`. The 65 joints comprise 15 central/upper-body joints,
40 finger joints and 10 leg/toe joints. Finger availability in the source does
not imply that the application exposes finger-editing controls.

### Integration constraints

- Preserve the entire `Armature` ancestor and all three skinned meshes. Loading
  only the body mesh loses separate eyes/eyebrows and can break skeleton cloning.
- Native bone quaternions are **not identity**. The `root` bone has quaternion
  approximately `[-0.7071068, 0, 0, 0.7071068]`, while its parent `Armature` is
  identity. Zeroing native bone rotations breaks the bind pose.
- Store per-body neutral quaternions and use a semantic axis basis for FK deltas.
  Male and female rest orientations differ; do not copy raw Euler values or
  native quaternions between bodies as a portable pose format.
- Use skeleton-aware cloning and independent per-instance materials. Cloning
  object transforms alone is insufficient. Preserve bind matrices, bone scales
  and inverse-bind matrices; transform the imported ancestor for root placement.
- Materials include separate body, eye and eyebrow materials. Preserve facial
  details when applying a body tint. Texture tinting multiplies the base-color
  texture; a chosen UI color is not automatically an exact flat surface color.
- Recalculate posed skinned bounds for framing/culling; the native T-pose bounds
  do not cover every pose. Test head, wrist, elbow and knee edits on all meshes.
- Every image/buffer request must use the deployment base path and case-sensitive
  original filenames. glTF resolves its relative dependencies from the model URL.

## Verification and limitations

Completed independently:

1. Downloaded through the official free creator flow, without payment or login.
2. Read the actual archive's license and enumerated the actual free contents.
3. Extracted only selected assets and exact dependencies into the reserved folder.
4. Verified every referenced buffer/image exists, including the two original-byte
   filename aliases.
5. Loaded both complete models, including all PNG dependencies, with the installed
   Three GLTFLoader in the task's isolated local-preview browser.
6. Confirmed three skinned meshes per figure, 65 bones per skin, zero animations
   and finite skin-weight sums within 0.001 of one for every vertex.
7. Measured native coordinates, mesh counts and bounds above; recorded hashes of
   the shipped glTFs, binaries, license and repaired filename aliases.

These are source/acquisition and load checks, not a claim that the application's
adapter, presets, recoloring, clone disposal, joint deformation, scene portability,
mobile performance or deployed Pages URLs have passed integration QA. Those gates
must be checked against the integrated models. No browser/GPU benchmark is claimed.
The source PNG payload is substantial; decoded GPU texture memory can be much
larger than the roughly 31.5 MB downloaded asset set.

## Offline sculpted mannequin assets — active runtime figures (2026-11-19)

The active runtime character assets in
[public/models/mannequin/](../public/models/mannequin/) derive from the
**MakeHuman Community hm08 basemesh and official artist-authored targets**
(CC0 1.0 Universal), replacing the earlier heuristic warps of the Quaternius
superhero mesh while retaining the CC0 Quaternius sculpted hairstyles and CC0
`UAL1_Standard.glb` motion library.

### License and reproducible sources

The basemesh, game-engine rig/weights, eyes, and targets are **CC0 1.0 Universal**.
The source OBJ and eye-proxy headers explicitly record the September 2020 CC0
release and credit Data Collection AB, Joel Palmius, and Jonas Hauquier.
Credit MakeHuman Community as a courtesy, without implying endorsement.
Generated textures and anatomical surface refinements are also dedicated to
CC0 1.0. No MakeHuman/MPFB program code is copied or executed.

- MPFB2 revision: `9de0707fdc88438d7c53a1a2ac7937d9221e2431`.
- MakeHuman eye revision: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`.
- [Exact source URLs, sizes, and SHA-256 lock](../public/models/mannequin/sources.lock.json).
- [Upstream CC0 text, preserved unchanged](../public/models/mannequin/LICENSE-MakeHuman.txt).
- [Every gender/archetype sculpt recipe](../public/models/mannequin/recipes.json).
- [Geometry checks and measured original Superhero/UAL1 bone transforms](../public/models/mannequin/build-report.json).

Run the original Node/Three builder from the repository root:

```powershell
node scripts\build-mannequin-assets.mjs
node scripts\build-mannequin-assets.mjs --offline
node scripts\build-mannequin-assets.mjs --verify
```

The first command downloads only public CC0 inputs from the two pinned official
GitHub revisions. Subsequent builds verify the committed SHA-256 lock.
`--offline` requires the complete cache, normally
`%TEMP%\pose-char-research\pinned`; `MANNEQUIN_CACHE` can select another directory.
`--update-lock` is only for deliberately adding new pinned CC0 inputs; an existing
input with a different digest is still rejected. No packages are installed.

### Delivered geometry and materials

- [Mannequin_Female.glb](../public/models/mannequin/Mannequin_Female.glb):
  approximately 4.85 MB, baseline height 1.75 m.
- [Mannequin_Male.glb](../public/models/mannequin/Mannequin_Male.glb):
  approximately 4.83 MB, baseline height 1.80 m.
- Each contains `Body`, `Eyes`, and `Eyebrows` skinned meshes and 53 bones,
  including all three phalanges of each finger. Optional Quaternius terminal
  finger/toe leaf bones are not needed by these weights.
- The body is a closed two-manifold: 13,380 authoring vertices, one offline
  Catmull-Clark level, **53,514 welded / 55,784 UV-split vertices** and
  **107,024 triangles**. Smooth shared normals are computed across UV charts (`maximumSeamGap = 0`).
- Eyes are built as full anatomical orbital spheres (`12,162` split vertices across
  `2 × 96 × 64` UV spheres with welded poles) centered on the morphed CC0
  `helper-l-eye` / `helper-r-eye` landmarks (`center.z -= 0.008 dm`, `radius *= 0.965`,
  subtle `+0.35 mm` corneal dome) with natural upper-eyelid drape so eyes sit cleanly
  inside the orbital socket in front, oblique (`68°`), and `90°` profile views.
  Vertex colors (`COLOR_0`) supply warm ivory/caruncle sclera, upper-lid AO shadow,
  limbal-ringed espresso-amber irises, pupils, and dual catchlights.
  `Eyebrows` (`272` split / `204` welded vertices = `2 × (51 brow + 51 upper lash)`),
  weighted entirely to `Head`, combines skin-snapped arched 3D eyebrows (tinted by
  `hairColor`) with a dark charcoal 3D upper-eyelash canopy (`[0.04, 0.035, 0.035]`)
  fitted directly to the subdivided eyelid margin (`fitBrowsAndLashes`).
- Embedded 1024 x 1024 unpremultiplied RGBA PNGs are also supplied alongside
  each GLB (`Mannequin_Female.png`, `Mannequin_Male.png`, `Mannequin_Female_Chibi.png`,
  `Mannequin_Male_Chibi.png`). RGB is neutral cavity-AO grayscale around 232.
  **Alpha is an outfit selector, not transparency**: `0` = skin, `255` = reference-matched
  athletic attire (sweetheart underbust sport-bandeau with thin shoulder straps + V-hip
  athletic briefs on Female; tailored low-rise compression trunks on Male).
  Both the texture and material carry the `pncOutfitMask` extras marker and are decoded
  at runtime into unpremultiplied RGBA `THREE.DataTexture`s bypassing `Canvas2D` alpha premultiplication.
- No comic-book normal maps or painted abdominal trenches are used.

The subdivision is a deliberate quality/performance tradeoff over the raw hm08
cage. It smooths large-bust, cheek, and skull silhouettes but increases CPU
deformation work about fourfold. The earlier raw-cage Delta Mush benchmark must
**not** be presented as a benchmark for these subdivided assets.

All 18 shapes face +Z, with anatomical left +X and Y up. Adult head counts,
measured from the central chin landmarks to the crown, are 7.5 / 8.0 / 7.8 /
8.2 / 7.6 / 7.4 / 7.3 / 7.2 for realistic through obese. Both Chibi shapes are
**2.50 heads and 1.05 m tall**, including shortened pelvis, torso, limbs, hands,
and feet. Chibi is intentionally **anime**, not a realistic baby: rounded upper
cranium, softened heart/V chin, smooth face plane, tiny button nose/mouth,
enlarged low-set eye openings, flattened glossy purple/blue anime eyes with
gradient irises and two catchlights, and dark upper lash arcs. Dedicated Chibi
PNGs remove realistic facial cavity shading without changing the outfit mask.
Body mass comes from the official muscle/weight and localized adipose sculpts,
not large lateral shifts of the shoulder/hip joints. Male busty uses muscle,
ribcage depth, and width targets; it never uses female cup targets.

Rest geometry is baked with normalized top-four-weight dual-quaternion skinning,
then realigned after proportion changes: thigh/calf directions `(0,-1,0)`,
upper arms `normalize(+/-0.12,-1,0)`, forearms `(0,-1,0)`. This matches the
application adapter's arms-down neutral stance, **not** the unmodified
Quaternius file's authored T-pose. Per-gender bone world orientations, including
the exact `Head` orientation, follow the measured Superhero source. Every
shape has independently recomputed joint-helper locations and bind transforms.

### Archetype bundle schema, version 1

[archetypes.json](../public/models/mannequin/archetypes.json) describes
[archetypes.bin](../public/models/mannequin/archetypes.bin) (7,959,312 bytes);
[archetypes.bin.gz](../public/models/mannequin/archetypes.bin.gz) is an equivalent
gzip representation, approximately 5.65 MB. The JSON gives the uncompressed
SHA-256 and length. All typed data is **little endian**; offsets are relative to
the uncompressed binary and aligned to four bytes.

```text
schemaVersion: 1
baseBodyType: "realistic"
boneNames: string[53]                    # exact glTF skeleton index order
gender.female | gender.male:
  glb: string
  meshes: [{ name, vertexCount, weld: {byteOffset, byteLength}, weldCount }]
  archetypes.<BodyTypeId>:
    meshes: [{ name, byteOffset, byteLength, scale, maximumError, color? }]
    bodyTexture?: string
    floorOffsetY: number
    boneLocalTranslations: { byteOffset, byteLength }
    boneWorldTransforms: { byteOffset, byteLength }
```

For each mesh, preserve the GLB's immutable **realistic** POSITION array and
decode the corresponding `Int16` array in its existing split-vertex order:

```text
newPosition[i] = realisticPosition[i] + int16Delta[i] * scale
newPosition[y component] += floorOffsetY
```

Always decode against the baseline, never against the previous archetype.
`floorOffsetY` corrects sub-0.02-mm quantization drift so the lowest body vertex
is exactly at Y=0. It applies to all three meshes. The bone tables already
include that correction.

For Chibi, `Eyes` and `Eyebrows` mesh records additionally contain
`color: {byteOffset, byteLength, componentType: "float32"}`: absolute
`Float32[vertexCount*3]` **linear RGB COLOR_0**, not deltas. Both baseline
materials already enable vertex colors. `bodyTexture` names the corresponding
`Mannequin_Female_Chibi.png` or `Mannequin_Male_Chibi.png`, using the same UVs,
sRGB color space, `flipY=false`, and the same outfit-selector alpha as baseline.
Restore immutable baseline colors and the baseline body texture when leaving
Chibi; do not retain its anime colors or clean-face map on adult archetypes.

`boneLocalTranslations` is `Float32[53*3]`, parent-local XYZ; retain the GLB's
local rest quaternions. `boneWorldTransforms` is `Float32[53*7]`, interleaved
`x,y,z,qx,qy,qz,qw`, in native asset coordinates. Recompute inverse-bind matrices
after applying translations, in a consistent asset-local coordinate frame.
`meshes[].weld` is `Uint16[vertexCount]` mapping each split vertex to a welded
vertex. Accumulate triangle-area-weighted normals by this mapping and scatter
them back to split vertices, then update geometry and posed bounds.

### Required runtime integration before enabling

1. Load both new GLBs plus the bundle before synchronous body-type application.
   The existing heuristic body warper treats **heroic** as its baseline; this
   bundle deliberately uses **realistic**. Do not mix those assumptions.
2. Bypass legacy `normalizeBodyAlbedoAndOutfitMap` for `pncOutfitMask` materials
   or textures. Canvas2D would discard RGB in alpha-zero skin texels and the
   color-inference step would erase the authored outfit selector.
3. Keep the existing figure root transform, pose, selection, and independent
   instance buffers when applying a shape. Apply bind changes in native model
   space, preserving source rest quaternions; do not zero rotations or apply
   world-space bone positions as local translations.
   Keep independent `Skeleton` objects and cloned inverse-bind matrix arrays
   for Body/Eyes/Eyebrows, sharing only the Bone objects. The CPU body's
   pass-through inverse-bind updates must not overwrite accessory inverse binds.
4. Reuse the proportion module's existing bind/deformer reset mechanism and
   increment `figure.root.userData.__bodyProportionRevision`; update `bodyType`
   and `bodyProportionHeadScale`. The current checkout does not export the
   blueprint's proposed `notifyFigureRestChanged` helper.
5. Fit hairstyles from measured morphed scalp bounds. The current hair adapter's
   hardcoded Superhero skull envelopes do not guarantee fit on these heads,
   especially Chibi. This asset-only task does not change that adapter.
6. For Chibi, set `figure.deformation.enableContactAndBulge = false` until
   anatomical contact/bulge correctives are calibrated for its compact torso.
   The unchanged adult-calibrated pass creates torso foldovers in Chibi
   Kneeling. GPU skinning and the advanced pipeline with **only this option
   disabled** render the five tested poses cleanly, retaining anatomical limits,
   coupled joints, twist distribution, hybrid DQS, and Delta Mush. Leave adult
   contact/bulge enabled. Do not silently enable the uncalibrated pass for Chibi.

### Isolated visual verification

With the existing studio Vite server running, start the dedicated, read-only
asset harness (it does not stop or change that server):

```powershell
node scripts\build-mannequin-assets.mjs --preview
```

Open `http://127.0.0.1:5187/` in a new isolated browser page. The harness resolves
the running studio's actual Three modules and uses its actual `preset` and
`setFigurePose` implementations. It exposes `renderSheet(mode, gender)`,
`renderDetails(mode)`, `renderPoses(advanced=false, type="realistic", options={})`,
`renderAnimeChibi("lit" | "cel")`, `renderMotion()`,
`benchmarkDeformer()`, and `saveVerification(images)` for Playwright. The latter
persists actual results only to the temporary verification directory.
Contact sheets show
all nine archetypes at front / three-quarter / side angles in clay and lit
skin/outfit modes, plus torso/Chibi-eye closeups and both genders in Neutral,
Contrapposto, Seated, Reach, and Kneeling presets.

The anime sheets show both genders, full body and face closeups, front /
three-quarter / side in lit and Three `MeshToonMaterial` cel modes. This is a
native cel check, not a claim that the application's NPR shader integration is
already complete. The motion smoke uses the actual UAL1 `Walk_Loop` extraction,
four normalized times per gender, with all 17 semantic joints mapped.
Advanced-pose checks exercise the existing anatomical CPU pipeline on the
already-shaped native geometry, including Chibi with contact/bulge disabled and
head-attached accessories. The uncalibrated Chibi contact/bulge comparison is
preserved separately as a known-failing visual probe, not counted as a pass.
Across 15 pose changes per tested gender/type, eyes and brows exactly followed
the posed Head transform (maximum attachment error zero).

One isolated Chromium run measured synchronous warm `setFigurePose` medians of
23.9 / 33.3 ms for female/male realistic and 31.9 / 31.7 ms for female/male
Chibi with contact/bulge disabled. Each median uses ten changes after five
warmups; the largest measured change was 49.9 ms. These timings exclude WebGL
drawing and are machine/load-dependent, not a 60-fps animation benchmark.

Verification also checks all 18 quantized floors and UV seam positions (both
exactly zero error), reconstructed bone positions (maximum 0.000000113 m),
normalized weights/normals, closed body topology, Chibi color ranges, and
unchanged Chibi outfit alpha. All 13 generated files were byte-for-byte identical
after a repeated offline build. These checks do not install dependencies.

These are native asset/bundle and semantic-pose checks, not a claim that the
unchanged studio already consumes this new asset family. Full shader-mode,
hairstyle, animation-library coverage, multi-figure CPU performance, and deployed
application QA remain integration gates. This high-density body is not a
60-fps guarantee; benchmark the final integrated workload rather than reusing
the raw-cage timing.
