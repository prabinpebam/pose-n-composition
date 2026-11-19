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
