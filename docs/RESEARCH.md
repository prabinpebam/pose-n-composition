# Browser posing and composition: implementation research

Research/access date: **2026-11-18**. Scope: a desktop-first, entirely client-side,
static posing and composition application, functionally inspired by PoseMy.Art.
This document is research, not a claim that the application has been implemented,
benchmarked, licensed for third-party assets, or published.

## Implementation decision addendum

The implementation team subsequently selected **React 19 + direct Three 0.181
with OrbitControls/TransformControls + BokehPass, Vite 7 and Vitest 4**, and reported
successful dependency installation through the approved feed (2026-11-18).
This is the chosen implementation direction, distinct from the researched
Fiber/Drei alternative recommended below. The package manifest was also read and
declares the corresponding major/minor dependency lines; installation success is
team-reported, not a benchmark or independent dependency-tree audit.

Direct Three avoids the additional Fiber/Drei/postprocessing-wrapper dependency
and lifecycle layers. In exchange, the app must explicitly own imperative state
synchronization, controls/pointer interaction, render/composer ordering, camera
changes, resizing and resource cleanup. Those obligations need integration tests;
raw Three is not asserted to be universally faster or better. BokehPass-specific
focus semantics apply, not the React-wrapper focus API. Research acceptance gates
for body silhouettes, persistence, real-camera DOF and live Pages deployment remain
unchanged.

## Ready-made asset decision addendum

The owner subsequently requested ready-made rigged figures instead of original
procedural bodies. On 2026-11-18 the official free **Quaternius Universal Base
Characters [Standard]** archive was acquired and its actual included
`License_Standard.txt` verified as **CC0 1.0 Universal**. Only its Superhero
male/female pair is available in this free distribution; Regular and Teen bodies
advertised for the complete kit are not included. The selected original glTFs,
required binaries/PNGs and exact license are in
[the selected asset directory](../public/models/external/quaternius-universal-base/).

[Asset provenance and integration evidence](./ASSETS.md) records exact source
URLs, archive/model hashes, the pack-specific CC0 versus global QAL discrepancy,
two byte-identical filename repairs, the shared 65-joint rig, measured native
bounds and successful actual browser GLTFLoader checks. Selection relies on the
specific pack's explicit CC0 declarations and included license, not a blanket
assumption about the creator's current global terms. The earlier recommendation
for original bodies remains historical research, superseded for implementation
by this owner-requested asset decision. Body-quality and complete integration
gates still require visual and behavioral QA.

## 1. Decision in brief

**Recommend Vite + TypeScript + stable React + React Three Fiber + selected Drei
helpers + Three.js WebGLRenderer.** Use one typed, serializable scene document;
local FK joint rotation and independent figure-root transforms; original skinned
bodies and procedural furnishings; real-time raster lighting; a separate
composition camera; optional depth-aware DOF; IndexedDB scene/pose records and
localStorage preferences; versioned JSON download/import.

1. **Keep the engine choice small, not the body-quality standard.** R3F is a React
   renderer for Three, not a different rendering engine. Its current introduction
   pairs Fiber 9 with React 19 and labels Fiber 10 alpha. Use a compatible stable
   set available from the approved feed, not an alpha/WebGPU dependency [S03].
2. **Ship reliable FK before optional IK.** A named-joint picker, local rotation
   gizmo, numeric angles, presets, undo and reset are more useful than unstable
   drag-to-pose. Do not allow arbitrary bone translation/scale in normal posing.
3. **Make the body visibly useful.** A box skeleton or chain of capsules is an
   interaction proof of concept, not completion of the male/female body
   requirement. Gate silhouettes and bent-joint deformation independently.
4. **Treat DOF as an integration risk, not a checkbox.** Current documentation and
   older installed releases may use different focus units. Verify installed
   types and actual images; do not copy normalized-focus snippets [S16-S19].
5. **Save editable domain data, not a runtime scene dump.** Version the document,
   rig, body generator and asset identities independently. Preserve bind/rest
   transforms. Promise pose portability only across explicitly compatible rigs.
6. **Browser storage is not a backup.** Report successful save only after the
   IndexedDB transaction completes; show actionable failure states and always
   offer file download [S28-S31].
7. **Validate the deployed repository subpath.** A successful localhost build
   does not verify GitHub Pages asset paths, storage origin, or live rendering
   [S32-S34].

These recommendations support the current [implementation Definition of Done](./DEFINITION_OF_DONE.md);
they do not edit or replace its acceptance matrix. No backend, animation,
ray/path tracing, physics, rig-authoring UI, cloud sync, or generic retargeting
system is needed.

## 2. Evidence and limits

- Official project documentation, specifications, license texts and upstream
  source were preferred. The numbered source register below gives titles, URLs,
  observations and the access date.
- **Directly observed:** public PoseMy.Art application menus in an isolated
  browser session, without signing in, purchasing, uploading, or downloading its
  files/assets. Menu visibility is evidence of exposed functionality, not proof
  of file round-trip correctness or subscription entitlement.
- **Publisher-stated:** PoseMy.Art home-page feature/library/platform claims.
  Library counts are marketing snapshots, not independently counted assets.
- **Recommendations:** architecture, budgets, data shapes and quality thresholds
  below are engineering proposals. No browser/GPU performance benchmark was run.
- **Version-sensitive:** moving `latest`, `main`, `master` and `dev` sources were
  read on the access date. They are not evidence that an npm release contains
  identical code. Installed package versions, lockfile, declarations and runtime
  tests govern actual integration. This worker did not inspect an installed
  dependency tree or assert a version-specific implementation match.
- No packages were installed, npm metadata queried, or models downloaded. Only
  this research document was written; app, package, configuration, git and
  deployment files remain implementation-owned.

## 3. What to learn from PoseMy.Art, without cloning it

| Evidence | Observed or stated capability | Appropriate interpretation here |
|---|---|---|
| Public application [S02] | Add Models, Add Props, Premade Scenes, Camera, Export, Save & Load, Settings | Clear task-oriented entry points; do not reproduce its visual design |
| Camera menu, directly opened [S02] | Screenshot, reset/lock camera, FOV slider (displayed 45), save camera position | Camera framing must be explicit and recoverable |
| Props menu, directly opened [S02] | Search, pagination, primitive/furnishing/accessory entries, custom OBJ import, premium markers | Searchable small original prop catalog is sufficient; do not acquire its catalog |
| Save & Load menu, directly opened [S02] | Save/load file, replace-current-scene switch, OBJ export entry | Separate editable document persistence from image/mesh export |
| Selected figure toolbar [S02] | Poses, move/rotate/scale, switch pose sides, change model, save/load pose, hand poses, duplicate, color, hide, lock, delete | Root editing, posture editing and reusable poses are distinct workflows |
| Selected directional-light toolbar [S02] | Intensity, transform controls, visibility/lock | Light edits should visibly affect form and shadows |
| Publisher home page [S01] | IK and FK, model/prop libraries, model swapping, FOV, directional lighting, images, OBJ import/export, multiple image exports | Confirms functional inspiration; not a requirement to implement every feature |

The home page also promotes animation and very large libraries. Those are outside
this static application's scope. This research did **not** establish that the
reference app exposes photographic DOF, lens millimeters, IndexedDB, particular
rendering internals, or every feature without payment. Do not infer them from its
marketing.

Do not copy source, mesh data, presets, thumbnails, branding, screenshots, icon
arrangement, or paid assets. Its home page places conditions on exported base
figures; that is another reason not to use its output as this application's asset
source [S01]. Functional study is not an asset redistribution license.

## 4. Practical stack comparison

| Choice | Advantages for this app | Real cost/tradeoff | Decision |
|---|---|---|---|
| Three + React Three Fiber + Drei | Declarative figures/props and ordinary React inspector UI; direct access to Three bones/materials; established controls; component lifecycle and selection event integration [S03-S05] | React/Fiber/Three/helper peer compatibility; imperative drag mutations must be reconciled with document state; postprocessing still needs correct scene/camera ownership | **Preferred if the UI is React** |
| Raw Three + TypeScript/Vite | Fewest conceptual layers for a small canvas; direct renderer and control ownership; same rendering and skeleton capabilities | Must implement scene lifecycle, DOM inspector synchronization, event routing, cleanup, resize and history integration manually; React plus a separately managed raw scene can create two sources of truth | Sensible for a tiny non-React editor, not a reason to rewrite an established React implementation |
| Babylon.js + TypeScript/Vite | Integrated skeleton APIs, bone manipulation, gizmos and a supplied two-bone IK controller; built-in lens/postprocessing options [S20-S23] | A different engine architecture and APIs, not a drop-in helper; still requires a custom posing editor, asset pipeline, serialization and failure UX | Credible alternative when team familiarity favors it; insufficient benefit to switch this React/Three MVP |

There is no measured bundle-size or speed winner here. Do not repeat R3F's own
performance claims as a benchmark of this app. Assets, draw calls, pixel count,
shadows and effect passes will dominate practical results.

### State and dependency boundaries

- Use one typed domain document plus transient UI state. A React reducer is
  adequate for the initial editor; reducers must be pure, including under React
  Strict Mode [S42]. A selector-based external store such as Zustand is reasonable
  if already chosen, but is not necessary merely to save JSON.
- Runtime `Object3D`, `Bone`, `Material`, control refs and GPU resources are not
  persisted state. Maintain a runtime registry keyed by stable entity/joint IDs.
- During a drag, update the runtime transform and invalidate the view. Commit one
  before/after document change at drag end. Do not add a history entry or
  serialize the whole scene for each pointer move.
- Either render document changes into runtime objects, or explicitly commit
  runtime edits back into the document. Avoid two independently authoritative
  copies of the same pose.
- Add `idb` only if a Promise/typed IndexedDB wrapper improves correctness;
  native IndexedDB is sufficient if transaction completion, migration and error
  handling are implemented correctly. Dexie is unnecessary without richer query
  needs. Do not add several persistence layers.
- Import only needed Drei helpers. Avoid remote HDRIs, environment presets,
  decoder CDNs, hosted fonts and dynamic model URLs as hidden runtime dependencies.
- Dependency installs/lookups, if implementation needs them, must use
  `https://packagefeedproxy.microsoft.io/npm/`; lockfile artifact URLs and scoped
  overrides matter as well as the top-level registry setting. This report does
  not authorize global configuration changes or a public-registry fallback.

## 5. Bodies, rigging, file formats and licensing

### Recommended initial asset strategy

Use **original skinned, simplified anatomical bodies**, with distinct male/female
proportion profiles and the same semantic rig contract. Neutral materials and
simple surface anatomy are enough; photorealism and individual finger articulation
are not required.

A practical original-generation approach is anatomically placed cross-section
rings or an authored low-poly surface: tapered upper/lower limbs, shaped ribcage
and pelvis, waist transition, shoulder mass, neck, head, hands and feet. Smooth
normals alone cannot fix disconnected geometry, spherical joints, poor anatomy,
or incorrect weights. Give elbows/knees multiple deformation rings and smoothly
varying weights; avoid rigid one-bone weighting across an intended soft joint.
This is a proposed asset-authoring method, **not a demonstrated quality result**.

Distinct bodies should differ through shoulder/hip/waist/chest/limb profiles,
not merely tint or an entire body's nonuniform scale. They are two simplified
reference-body options, not a claim to represent every person's anatomy.

**Hard quality gate:** front, side and three-quarter views at neutral, overhead
arms, 90-degree elbows/knees, seated posture and torso twist must retain readable
human mass, connected-looking joints and credible silhouettes. No stacked boxes,
bead-like joints, detached limbs, collapsed knees, or obvious shoulder gaps at the
normal framing distance. A capsule prototype can prove interaction separately,
but cannot pass this gate.

### If procedural bodies fail that gate

The official MakeHuman/MPFB license page states that **core assets are CC0**,
while MPFB code is GPL and MakeHuman code is AGPL [S26]. A specifically verified
core body, exported/optimized and rigged to the app's contract, is therefore a
credible quality fallback. Important boundaries:

- The core-asset statement is not blanket permission for every community
  attachment, material, third-party target, garment or sample file.
- Record the exact source URL, file/version, creator, license and modifications
  for each redistributed asset. Preserve provenance even where CC0 attribution
  is not legally required.
- Do not embed tool code into the application on the assumption that CC0 covers
  it. Tool license and generated/asset license are different questions.
- This worker did not download, author, optimize or visually validate a
  MakeHuman export. Its suitability for the available implementation time is
  untested. Do not claim that sourcing alone solves skinning/topology.

### Format decision

| Format/approach | Suitable use | Why not make it the editable-document contract? |
|---|---|---|
| Original procedural geometry | Small original body/prop assets; deterministic rebuilding | Generator changes need versioning; quality costs real authoring time |
| glTF/GLB | Preferred runtime delivery of a vetted preauthored skinned mesh; GLB simplifies packaging [S24-S25] | Does not standardize this app's semantic joint IDs, presets, editor state, DOF, history, or model-use rights |
| VRM | Future humanoid interchange when user-owned avatars are a real requirement | Adds humanoid/material/meta conventions not needed now; model license settings can restrict redistribution/derivatives [S27] |
| OBJ | Optional future static prop import/mesh export | Not a rig/pose/scene-library format; no skeleton contract, editor cameras, lights or app metadata |
| Versioned application JSON | Scene/pose download, import, persistence and presets | **Recommended canonical editable data**, with schema validation |

glTF is a delivery format, not a blanket content license. Neither a loader's MIT
license nor the VRM format grants permission to publish someone else's model.
Public GitHub Pages assets are downloadable even if the UI hides them.

### Rig correctness and independence

Three `SkinnedMesh` needs skin indices/weights and a skeleton; glTF skinning uses
joint transforms together with inverse bind matrices [S08-S10, S25].

1. Define a documented rest pose, local axes, right-handed/Y-up convention and
   scene unit (recommend meters). Use semantic IDs such as `leftUpperArm`,
   `leftForearm`, `pelvis`, not array positions or exporter-generated UUIDs.
2. Build skeleton, geometry, weights and rest matrices consistently. Update world
   matrices before binding. Bind in the actual neutral pose; store rest local
   transforms separately.
3. Pose by changing bone local quaternions. Do **not** recompute inverse bind
   matrices after each pose: that redefines the rest relationship instead of
   recording a pose. Normalize weights and reject invalid indices.
4. Keep a separate figure-root group for scene translation/rotation/uniform scale.
   Avoid nonuniform root scale and negative mirror scales on skinned bodies.
5. Recompute posed bounds after edits when needed for framing, picking and
   culling; the initial skinned bounds do not necessarily enclose later poses
   [S08]. In a static editor this can happen after a pose change, not forever.
6. Duplicate imported rigs with `SkeletonUtils.clone` on an ancestor containing
   the skinned mesh **and all its bones**. Ordinary shallow object cloning is not
   a guarantee of independent skinning. The utility deliberately shares geometry
   and materials: clone recolorable materials so body A's color does not change
   body B [S10].
7. Reuse immutable geometry/materials only intentionally, and dispose resources
   with ownership/ref-count awareness. Deleting one instance must not dispose a
   shared resource still used by another.

## 6. Beginner-friendly 3D interaction

### Familiar concepts, explicit modes

Blender distinguishes global and local transform axes; its navigation gizmo
offers axis-aligned views, pan/zoom and camera/projection controls [S12-S13].
Unity explicitly documents W/E/R for move/rotate/scale plus numeric inspector
fields [S43]. There is no single universal shortcut layout.

Recommended workflow:

- **Select object -> transform root**, or **select named joint -> rotate pose**.
  Show the selected figure, joint, tool and coordinate space together.
- Keep W/E/R if following the current implementation plan. Do not simultaneously
  teach conflicting G/R/S semantics without an intentional configurable scheme.
- Root objects: translate/rotate and uniform scale. Joints: rotate only, local
  space by default. World-space joint rotation is an advanced convenience, not
  required for the initial product.
- Use standard X/Y/Z axis colors plus text labels; color must not be the only
  distinction. Provide Local/World as a clearly labeled selection.
- Frame selected/all, home/reset view, front/side/top and a small orientation
  gizmo prevent users becoming lost.
- Provide visible orbit/pan/dolly help and on-screen navigation alternatives.
  Three OrbitControls exposes configurable mouse/touch mappings [S07]. Do not
  require a middle button or numpad with no alternative.
- Separate click selection from drag navigation with a movement threshold.
  Ignore hidden/locked objects, helpers and light targets when appropriate.
  Prefer the active transform handle over underlying scene picking.
- Drei TransformControls automatically disables default controls during gizmo
  dragging when OrbitControls is registered with `makeDefault` [S05]. Verify this
  in the actual integration rather than assuming wrappers always resolve every
  selection/pointer-capture conflict.
- One drag equals one undo action. Escape cancels an active drag and restores its
  starting transform. A click without movement should not dirty the document.

### Joint limits, reset and mirroring

Start with understandable joint axes and soft anatomical bounds for elbows and
knees. Do not sell a few Euler clamps as a comprehensive biomechanical rig.
Quaternion storage avoids Euler serialization ambiguity but does not itself solve
anatomical constraints, twist limits, or UI discontinuities.

Offer Reset selected joint, Reset pose and Reset view as different actions.
Resetting posture should not unexpectedly move the figure root, recolor it, or
reset the composition camera.

Pose mirror is useful but secondary to reliable FK. Blender's documentation
shows bone-name matching, local-space copying and flipped poses, and warns that
different rest transforms change results [S14]. For this app:

- Explicitly map left/right semantic pairs.
- Reflect rotations in a documented symmetric rest coordinate system; do not
  negate every Euler angle or scale the entire figure by -1.
- With compatible symmetric bases, matrix reflection can be expressed as
  `R_mirrored = M * R * M`, followed by left/right mapping. Nonidentical bone
  bases require their basis transforms too; that expression alone is not generic
  retargeting.
- Gate release on mirror-twice restoring the original posture within tolerance.
  Label whether it mirrors the whole pose or copies one side onto the other.

### FK versus two-bone IK

| FK first | Optional analytical two-bone IK |
|---|---|
| Deterministic, few concepts, easy presets/history/serialization | Helpful for placing a wrist or ankle on a known surface |
| Precise but requires several joint edits to position an extremity | Needs a target, elbow/knee pole direction, reach clamping and local/world conversion |
| No solver iterations or singularity recovery | Collinear limbs, unreachable/too-close targets, rotated parents and changed body proportions require explicit handling |

Babylon supplies a two-bone `BoneIKController` with pole and bend-axis options
[S21]. Three's supplied CCD solver is iterative and indexes links in a skeleton;
it is not a plug-and-play human posing UX [S11]. A short custom solver is not
automatically safer.

If IK is later added, restrict it to arms/legs, preserve segment lengths, clamp
reach away from zero/full extension singularities, maintain a stable pole, and
solve in a well-defined coordinate frame. Bake the result into the same local FK
rotations at drag end. Test a rotated/scaled figure root and unequal limb lengths.
No full-body IK, automatic balance, collision or floor contact is implied.

### Desktop accessibility

The canvas cannot be the only way to select or modify content:

- Keyboard-operable scene list and joint list, labeled numeric transform fields,
  clickable step buttons, reset buttons and a focusable viewport.
- Visible focus rings; explicit accessible names/tooltips; mode indicated by
  text/state, not an unexplained icon toggle.
- Numeric/click alternatives to dragging. W3C distinguishes a single-pointer
  non-drag alternative from keyboard accessibility; one does not automatically
  satisfy the other [S41].
- Shortcuts only when appropriate: no object deletion, tool changes or camera
  movement while typing names/values or operating a dialog. Preserve browser
  shortcuts unless deliberately scoped and documented.
- Modal focus management, recoverable validation messages, and status
  announcements for save/import/export failure and completion.
- Respect reduced motion for transitions. A static editor needs no continuous
  object motion. Do not claim full WCAG compliance without a real audit.

## 7. Original props, recoloring and real-time lighting

### Small coherent prop catalog

Lamp, table, chair, desk, couch, bed and walls with windows can all be original
procedural assets with meaningful dimensions and pivots:

- Tables/desks: separate top and supports; chairs/couches: readable seat/back
  heights; bed: frame/mattress; lamp: base/stem/shade.
- Place pivots at floor-contact centers. Use dimensions compatible with seated
  figures and meter-based scenes; offer reset rotation/scale.
- Build window openings as actual empty space between wall pieces, not a dark
  rectangle painted over a solid wall. This avoids a CSG dependency and lets
  directional/spot lighting pass through.
- Reuse simple geometry where appropriate; do not produce dozens of separately
  rendered decorative pieces that add little composition value.
- A lamp prop and a light emitter are different entities. If paired, show the
  relationship and keep light position/target behavior explicit.

Recolor bodies, props, floor/walls and background through persisted material
parameters. Clone per-instance mutable materials. Background color is not ambient
light; an emissive lamp shade alone does not cast light onto other objects.

### Lighting contract

Use standard/rough neutral materials, a modest hemisphere/ambient fill, and one
shadowed directional or spotlight key. Allow more lights deliberately, but do not
enable shadows on every lamp by default.

Expose light position, target, color, intensity and visibility. Directional and
spot lights point from position toward target; the target must exist in the scene
to update away from its default location [S36-S37]. Changing an Euler rotation
alone is not the Three directional-light aiming contract.

For a spotlight, cone angle and penumbra are useful. Its documented intensity is
in candela and default decay is inverse-square [S37]. A beginner-facing intensity
slider can use a documented relative mapping; do not imply all light types share
identical physical units.

Raster shadows are approximate. Fit the key's shadow camera to the working scene,
use a bounded shadow-map size, and test acne versus detached-looking shadows when
adjusting bias/normalBias. Larger shadow maps cost computation; cached shadow maps
must be invalidated after relevant scene/light/pose edits [S38]. A window should
cast a visibly shaped shadow in a targeted test.

No ray tracing, indirect bounce solver, physically accurate area-light soft
shadows, or photorealistic skin is promised.

## 8. Composition camera, lens and depth of field

### Separate editor inspection from final framing

Keep the orbiting editor camera distinct from the composition camera. Scene
inspection should not silently alter the saved shot. Provide explicit
"Set camera from current view", "View through camera" and camera lock actions.

Persist composition position/orientation or position/target, lens convention,
aspect, clipping planes and DOF settings. If using a target, define behavior for
coincident position/target and an up vector nearly parallel to view direction.

Show an aspect-correct frame, optional thirds/center guides and safe margins.
Changing window size must not stretch the final shot; letterbox/pillarbox as
needed. Image export must use that camera/aspect and exclude joints, grid,
selection outlines, gizmos and helpers.

### Lens millimeters and FOV are not independent knobs

Blender documents lens units, sensor fit, FOV, clipping and focus objects [S15].
Three's perspective FOV is **vertical degrees**, not horizontal [S06].

For vertical sensor extent `h` and focal length `f` in the same units:

`verticalFovRadians = 2 * atan(h / (2 * f))`

`f = h / (2 * tan(verticalFovRadians / 2))`

The actual Three implementation uses
`getFilmHeight() = filmGauge / max(aspect, 1)`, and its default `filmGauge` is 35
[S06, S39]. That is not by itself a fixed, literal 36 x 24 mm photographic sensor.
The current generated prose for `getFilmHeight` is misleading about landscape
orientation; the actual method body resolves the ambiguity [S39].

**Recommendation:** declare the chosen fit convention, keep camera `zoom = 1`,
and make lens mm canonical, deriving FOV with `setFocalLength`. A simple convention
is a 36 mm larger-axis film gauge; label it accordingly instead of promising all
physical camera sensor/crop behaviors. At aspect 3:2, filmGauge 36 and lens 50 mm,
vertical FOV is approximately **26.99147 degrees** (calculated, not benchmarked).

When output aspect changes, set the new aspect and reapply canonical focal length.
Otherwise the displayed lens and projection can drift apart. If FOV is edited,
derive and persist the corresponding lens consistently. `setFocalLength` updates
the projection itself; other relevant direct camera changes require
`updateProjectionMatrix` [S06, S39].

Do not conflate orbit dolly (camera position changes) with lens/FOV changes:
moving the viewpoint changes perspective relationships. Changing lens alone crops
or expands the field from the same viewpoint.

### DOF: genuine depth-aware approximation, version-sensitive API

DOF must process actual scene depth. A CSS blur on the canvas is not DOF, and
setting `PerspectiveCamera.focus` alone does not enable any blur [S06].

Two reasonable implementations:

| Route | Benefits | Obligations |
|---|---|---|
| `@react-three/postprocessing` + `postprocessing` DOF | Camera-aware React composition, optional world target, effect resolution controls [S16-S19] | Match installed releases/peers, track camera/scene changes, account for multiple internal passes |
| Three `EffectComposer` + `BokehPass` | Fewer third-party effect abstractions; explicit scene/camera constructor and runtime focus/aperture/maxblur uniforms [S40] | Own composer lifecycle, render-loop priority, resizing, color/output handling and camera switching; different focus semantics |

Prefer the React wrapper when already using it, but a correctly integrated
`BokehPass` is an acceptable smaller fallback. **Do not mix their parameter
names or units.** BokehPass documents focus as distance along the camera look
direction; upstream postprocessing target-focus code currently calculates
camera-to-target distance [S19, S40]. Off-axis focus needs deliberate testing.

#### Specific verified API trap

On the access date, current React DOF docs describe `focusDistance` and
`focusRange` in **world units**, with `target` overriding manual focus and
`resolutionScale` defaulting to 0.5. They deprecate `worldFocusDistance`,
`worldFocusRange` and `focalLength` [S16].

Upstream `postprocessing/main` similarly initializes world-unit focus and keeps
deprecated aliases [S18-S19]. Wrapper `master` still contains compatibility
constructor paths and a mask workaround whose comment refers to shapes leaking
through blur after older behavior [S17]. Some source comments are inconsistent
(for example an older range comment remains). Therefore:

- Current web documentation is not proof of the installed release's semantics.
- Inspect the locked wrapper/effect versions and their declarations/source.
- For an older normalized-depth API, convert only according to that exact
  implementation; do not assume one universal `distance / far` formula.
- Use world-position autofocus if supported and correctly integrated, but still
  test it; a supported property name does not prove correct focus-plane behavior.
- Preserve app-level focus in scene/world units, with any release-specific
  conversion confined to one rendering adapter.
- Do not label `bokehScale`, focus-range or a shader aperture multiplier as a
  calibrated photographic f-stop unless a tested optics mapping exists.

#### Camera/render ownership and performance

The React composer supports explicit `camera` and `scene` inputs [S19a].
They must point to the active composition camera and the real content scene,
not an empty helper scene, a stale camera ref, or an editor camera that happens
to be default at mount time. Rebuild/update the effect when required by the
installed API. Merely changing a React ref's `.current` does not itself trigger
React dependency updates.

Use exactly one intended final render path: avoid raw rendering after the composer
overwriting its output. Resize renderer/composer consistently, preserve output
aspect, and dispose render targets on teardown. Keep gizmos outside the effect's
scene/layers or hide them in composition mode.

DOF uses several render targets/passes, not one cheap blur [S19]. High DPR,
multisampling, shadows and DOF combine their costs. Start with DOF off for editing,
an explicit composition preview toggle, half-resolution blur where supported and
bounded DPR. Do not enable normals/SSAO/bloom merely because a composer supports
them. Test foreground bleed, thin geometry, transparency, silhouette halos,
near/far changes, resize and camera switching.

**Minimal visual fixture:** three detailed objects at distinct depths, focus each
in turn, verify that the intended depth is sharp and another is blurred. Repeat
after switching cameras, changing lens, resizing and export. A frame that merely
changes when DOF is toggled is insufficient evidence.

## 9. Document, presets, portability and history

Suggested schema contract (field names are proposals, not generated app code):

| Level | Persisted fields/invariant |
|---|---|
| Envelope | `kind`, integer `schemaVersion`, application/generator version, scene ID/name, timestamps, unit/axis convention |
| Figure | Stable entity ID, body asset/profile ID and version, rig ID/version, root position/quaternion/uniform scale, color/material settings |
| Pose | Semantic joint IDs and normalized local quaternion deltas from a declared rest basis; explicit optional pelvis offset |
| Props | Catalog type/version, dimensions if parameterized, transform, per-instance material values, visibility/lock |
| Lights | Type, position, target or target entity relationship, color/intensity, relevant cone/shadow settings |
| Composition | Camera transform/target, canonical lens and sensor fit, aspect, near/far, DOF enable/focus/range/strength |
| Scene appearance | Background, floor/wall colors and relevant display configuration |

Store quaternion ordering explicitly (recommend x/y/z/w). If using rest-relative
deltas, document multiplication order, for example `qLocal = qRest * qDelta`.
Do not sometimes save absolute local rotations and sometimes deltas under the
same schema version.

Presets should be small original data records using the same import validator,
not opaque snapshots of runtime UUIDs. Start with neutral, contrapposto, seated,
reach and crouch, each checked on both bodies. Save-pose and save-scene are
different: a pose normally excludes camera, lights, props, root placement and
body color. Make any included root/pelvis motion explicit.

Compatibility policy:

- Same rig version/rest bases with proportion variants: rotation reuse is
  supported, but floor/chair/hand contact may change with limb lengths.
- Different rest axes, hierarchy or rig version: require a specific migration/
  retarget mapping, or reject with an actionable explanation.
- Unknown future schema: do not silently load partial data or overwrite it.
- Never infer compatibility solely because both models have a bone named "arm".
  Blender's own copy-pose documentation describes local-rest dependence [S14].
- Asset/generator changes must not silently change old documents. Retain the old
  implementation or provide a tested migration and disclose visual differences.

### Import validation and safe replacement

Validate before replacing current state: discriminated document kind, supported
integer versions, finite bounded numbers, expected array lengths, normalized
nonzero quaternions, positive scale/dimensions, valid IDs, allowed prop/body types,
bounded entity counts and input file size.

Construct a fresh typed object from allowed fields; do not blindly merge imported
objects into arbitrary application objects. Reject missing required joints or
unknown asset references rather than rendering a plausible but incorrect default.
No scripts, remote URLs, HTML, shader text, or arbitrary asset fetches should be
accepted through scene JSON.

Proposed initial limits: 5 MiB JSON, 20 figures, 100 props, 8 lights. These are
defensive product limits to tune through testing, **not measured browser limits**.
When importing a scene, show replace versus cancel clearly and preserve a dirty
scene until the new document passes validation.

History should record semantic edits and group drags/sliders sensibly. Keep a
bounded history; do not clone geometry, screenshots or GPU state into it.
Serialization and undo/redo should share the same domain transforms.

## 10. IndexedDB, localStorage and failure UX

### Data layout and scope

- IndexedDB: named scenes and poses, optional small thumbnails and explicitly
  retained autosave records. Namespace the database, e.g. `pose-n-composition`.
- localStorage: only small preferences such as panel layout, theme, selected
  quality preset and last-opened record ID. It is synchronous and can block the
  main thread; never serialize a whole scene on pointer move [S31a].
- All repository sites under the same `https://owner.github.io` origin share
  origin storage, regardless of repository subpath [S30-S31a]. Prefix localStorage
  keys as well as the DB name. A custom-domain migration creates a new origin;
  downloaded files are the portable recovery mechanism.

### Correctness requirements

IndexedDB schema changes use an integer database version and
`upgradeneeded`; schema version and scene-document version are separate [S28].
Migrate incrementally and preserve records instead of deleting a store to "fix"
an incompatible database.

Save is successful on transaction `complete` (or `idb`'s `tx.done`), not merely
the first `put` request succeeding [S29, S31]. Prepare thumbnails and validate data
before opening a transaction; unrelated awaited work can let the transaction
auto-close [S31]. An application shutdown before commit can still lose an
in-progress change.

Handle blocked upgrades and old open tabs: close obsolete DB connections on
versionchange, explain when another tab must reload/close, and never present a
permanent spinner as success. Keep current in-memory editing available when
persistence is unavailable, clearly labeled unsaved/session-only.

### Quota, privacy mode and eviction

MDN documents default best-effort storage, origin-wide quotas, browser-specific
eviction, limited Web Storage and `QuotaExceededError`; private browsing normally
removes data when that private session ends [S30].

- Use `navigator.storage.estimate()` for advisory usage, not a guaranteed reserve.
  Never promise a fixed available number of gigabytes.
- Persistent-storage requests may be denied or handled differently by browsers.
  They are not a replacement for download/backup.
- Catch and surface open/read/write/abort/serialization/storage-access errors.
  Do not silently fall back to localStorage for full scenes.
- On save failure: preserve dirty state, explain that the save did not complete,
  offer Retry and Download JSON, and avoid overwriting the last known good record.
- Announce an error accessibly. A normal success toast may auto-dismiss; a visible
  unsaved indicator and actionable failure must remain discoverable.
- Test corrupted preferences without clearing unrelated origin data. Offer
  targeted reset of this app's records, never `localStorage.clear()` or deletion
  of all origin databases.
- No telemetry, uploads or cloud synchronization are required. Browser-only
  storage does not mean data survives clearing site data or changing devices.

## 11. GPU/browser limits and performance policy

Three's current renderer source rejects WebGL1 and states that support was
removed in r163 [S35]. Test WebGL2 availability; do not claim a current Three app
has a WebGL1 fallback because an old tutorial did. GPU acceleration can be
disabled, blocked by drivers/policy, or lost on a nominally modern browser.

Use a DOM fallback/error boundary with a clear unsupported-GPU explanation and
retain accessible file recovery where possible [S04, S35a]. Listen on the canvas
for context loss; it does not bubble [S44]. Do not discard the domain document on
GPU failure. Recovery should re-create runtime/GPU resources from that document
and render a verification frame; provide a reload/download route if restoration
fails. Context loss can result from resource pressure or GPU switching, not just
an application bug [S45].

MDN recommends conservative VRAM use, quality options, resource cleanup and smaller
back buffers when needed [S46]. Suggested policy:

- One main canvas; no continuously rendering thumbnail canvases.
- Demand rendering for a static scene, with invalidation after bone/material/
  light/camera mutation. R3F documents that imperative mutations need explicit
  invalidation and Drei controls provide it [S47].
- Bounded DPR: propose 1 on constrained devices, up to 1.5-2 on desktop after
  testing. Pixel cost scales with both dimensions; a DPR of 2 uses four times the
  pixels of DPR 1 for the same CSS size.
- One shadowed key by default; conservative shadow resolution; no unbounded
  dynamic quality escalation. Low quality disables DOF before sacrificing basic
  selection/editing.
- Reuse immutable resources and avoid excessive prop submeshes. Use renderer
  statistics to find real draw-call/resource issues rather than optimizing by
  package reputation.
- Do not set `preserveDrawingBuffer` globally solely for screenshots. Render/
  capture the requested composition deliberately, then restore editor state.
- Dispose orphaned geometries, materials, textures, skeleton resources and
  effect targets without disposing shared live resources.

Desktop-first is honest. Test mobile/touch layout and GPU behavior, but do not
promise identical editing comfort or 60 fps on every phone. High-DPR phones and
multiple effect targets can be less forgiving than a desktop GPU. No universal
GPU-memory budget or fabricated device benchmark is provided here.

## 12. GitHub Pages and static delivery

Vite's official deployment guide requires repository-site `base: '/REPO/'`,
while a user root site or custom domain normally uses `'/'` [S32].

- Prefer bundled URL imports, including `?url` for model binaries, or static
  `new URL(..., import.meta.url)` patterns that Vite can analyze [S33].
- For runtime paths into the public directory, resolve against
  `import.meta.env.BASE_URL`; hard-coded `/models/body.glb` requests the host root,
  not necessarily the repository subpath. The same applies to thumbnails,
  decoders, workers and dynamically constructed catalog paths.
- Use a single application entry point with no router, or hash-based routes.
  GitHub Pages is not a general SPA rewrite server; refreshing an arbitrary
  path must not be a hidden deployment requirement.
- Build with the approved feed configuration and a consistent lockfile, then
  upload the built output, not TypeScript source.
- Pages Actions deployment requires the appropriate Pages source setting,
  `pages: write`, `id-token: write`, an environment and correctly ordered
  build/upload/deploy steps [S34]. Follow current approved action versions;
  official pages themselves can show different generation-era examples.
- Keep dependencies/assets local to the build. Do not introduce a runtime server
  to serve JSON presets, save files, or export images.
- Verify the actual HTTPS URL with a cold load, refresh and network inspection.
  Confirm no asset 404s, placeholder Git LFS content, missing decoder URLs,
  runtime CDN calls or incorrect case-sensitive filenames.

GitHub documents published-site and bandwidth/build limits [S34a]. They are ample
for a small original procedural app, not an argument for shipping a giant model
library. No service worker is required. "All client-side" does not by itself mean
the app can cold-start offline; do not promise offline reload without deliberately
implementing and testing caching/update behavior.

## 13. Measurable proposed acceptance and browser scenarios

**These are suggested tests/targets, not results.** Record actual browser version,
OS, GPU, viewport, DPR, scene and quality mode with performance evidence.

| Area | Concrete acceptance suggestion |
|---|---|
| Body quality | Both bodies pass front/side/three-quarter silhouette review in neutral, seated, overhead reach, crouch and twist; visually distinct proportions, no disconnected/collapsed joints at normal framing |
| Rig isolation | Two identical figures coexist; rotate/recolor/delete/duplicate one without changing the other's posture/material or losing shared resources |
| FK/root separation | Joint rotation changes posture but preserves segment rest lengths; root translation/rotation moves the whole figure; Reset pose preserves root and scene |
| Navigation | Select -> orbit -> drag joint -> cancel -> undo/redo works without simultaneous orbit/gizmo motion or unwanted background selection |
| Presets | At least five original representative poses apply correctly to both compatible bodies; floor/seat-contact limitations explicitly visible/documented |
| Numeric fidelity | JSON round trip preserves root position within 1e-5 scene units and joint orientation within 1e-4 radians; compare quaternion orientation accounting for q/-q equivalence |
| Compatibility | Wrong document kind, future version, missing joints, wrong rig version, nonfinite/bad bounds and excessive counts fail before current scene replacement |
| Mirror, if shipped | Mirror twice returns all supported joint orientations within tolerance; root placement remains unchanged unless explicitly requested |
| Props | Every requested prop spawns with sane pivot/scale, can be moved/rotated/recolored, survives round trip; window is an actual opening |
| Lights | Editing position AND target changes actual illumination; color/intensity persist; window casts a corresponding shadow; lamp emissive color is not confused with an emitter |
| Lens | At gauge36/aspect3:2/zoom1, 50mm gives ~26.99147deg vertical FOV; lens<->FOV round trip within 1e-4deg; resize/aspect changes follow declared fit policy |
| Framing | Editor navigation does not change saved shot; camera view and PNG have identical aspect/framing and omit editor helpers |
| DOF | Three-depth fixture proves selective focus, including camera switch, lens change, resized canvas, focus target movement and export; no claim based only on toggle pixel difference |
| Storage | Named scene/pose reloads after page restart; successful save only after transaction commit; blocked/denied/quota failure preserves dirty scene and permits JSON download |
| Migrations | Seed an older DB/document, upgrade without losing records; another open tab produces actionable blocked/versionchange behavior |
| Performance | Proposed desktop target: 2 figures + 8 props + 2 lights, 1280x720, declared DPR/quality, p95 interaction frame <=33.3ms over 30 seconds; measure DOF separately |
| Initial delivery | Proposed cold-transfer target <=5MiB for initial app/default scene; measure network transfer rather than source folder size |
| Idle | Static idle scene stops unnecessary rendering; moving a joint/light or changing a color still reliably invalidates and updates |
| Resource stability | Repeat add/duplicate/delete and DOF on/off 20 times; inspect renderer resource counts for unbounded growth after legitimate shared caches stabilize |
| GPU failure | WebGL2 unavailable produces actionable DOM UI; simulated loss of this app's own context preserves scene state and verifies restoration/recovery |
| Accessibility | Complete selection, joint edit, reset, save and file actions by keyboard/numeric controls; click/tap alternative to drag; no shortcuts fire inside text/number inputs |
| Deployment | Live project-subpath HTTPS cold load/refresh renders; no asset/network/console failures; save/download/import and composition export tested on the live origin |

### Browser test matrix

1. Current Chromium desktop (Chrome or Edge): full editing, storage, image export,
   pointer capture, context recovery and measured performance.
2. Current Firefox desktop: picking/gizmo differences, IndexedDB migrations,
   keyboard shortcuts, file import/download and DOF.
3. Current Safari desktop, if available: WebGL2/effect framebuffer support,
   color/export behavior, browser storage and file workflows.
4. Narrow desktop/trackpad and 200% page zoom: usable panels, focus visibility,
   no mandatory middle mouse, no clipped essential controls.
5. Android Chrome and iOS Safari smoke tests: touch navigation/selection,
   portrait/landscape resize, quality downgrade, storage/export behavior.
   Record untested devices rather than substituting desktop emulation for actual
   hardware evidence.
6. Private mode, denied storage, injected quota/transaction abort, corrupted JSON,
   unavailable GL context and two-tab DB upgrade scenarios.

Run fault injection only against this app's own test context/database. This is a
shared owner computer; no OS keyboard/mouse automation, focus stealing, broad
storage clearing or other applications' GPU-context manipulation is justified.

## 14. Order of work and honest limitations

1. Establish typed domain document and one verified skinned body/root/FK loop.
2. Pass the silhouette/deformation gate on both proportion profiles.
3. Add presets, selection, numeric controls, history, reset and independent
   duplicate/material behavior.
4. Add original furniture, lighting targets and composition framing.
5. Prove real-camera DOF/export with the depth fixture and installed API.
6. Prove JSON/IndexedDB round trips and failure UX.
7. Validate production subpath, public deployment and actual browser scenarios.

Do not defer basic document portability or body quality until after decorating
the UI. Conversely, do not block owner review on generic IK, VRM, a huge asset
catalog or photorealism.

Expected limitations to disclose: simplified anatomy/hands; no automatic physical
contact, collision or balance; no arbitrary-rig pose portability; raster shadow
artifacts; approximate screen-space DOF; browser/device-dependent GPU performance;
browser-local storage subject to deletion; no cloud sync; desktop-first ergonomics;
and only the browsers actually tested.

## 15. Source register

All sources below were accessed **2026-11-18**. Observations are paraphrases, not
copied implementation code. Upstream branches and latest documentation can move.

| ID | Official title/source | Directly verified relevance |
|---|---|---|
| [S01] | PoseMy.Art home | Publisher lists FK/IK, presets/scenes, models/props, FOV, directional light, imports/exports and conditions on base-figure use |
| [S02] | PoseMy.Art public app | Camera, props, save/load, selected-figure and selected-light menus directly opened; no authenticated/premium workflows tested |
| [S03] | React Three Fiber - Introduction | React renderer for Three; Fiber9/React19 pairing; Fiber10 identified as alpha |
| [S04] | React Three Fiber - Canvas | Renderer/camera defaults, fallback, DPR and frame-loop configuration |
| [S05] | Drei - TransformControls | Object attachment and automatic disabling of registered default controls while dragging |
| [S06] | Three - PerspectiveCamera | Vertical FOV, focal-length helpers, film gauge, clipping, focus and projection updates |
| [S07] | Three - OrbitControls | Target, navigation options, mouse/touch mappings and programmatic dolly |
| [S08] | Three - SkinnedMesh | Binding, weights, bind modes, pose reset and bounding-volume updates |
| [S09] | Three - Skeleton | Bone/inverse-bind arrays, calculateInverses, reset and serialization APIs |
| [S10] | Three - SkeletonUtils | Correct bone association when cloning; geometry/material reference reuse; retarget options |
| [S11] | Three - CCDIKSolver | Iterative solver, target/effector/link indices and iteration tradeoff |
| [S12] | Blender Manual - Navigation Introduction | Orientation gizmo, axis views, camera/projection, pan/zoom alternatives |
| [S13] | Blender Manual - Transform Orientation | Global/local/object/view/parent orientations and Euler gimbal concerns |
| [S14] | Blender Manual - Copy/Paste Pose | Name matching, mirror option, local transform/rest-pose limitations |
| [S15] | Blender Manual - Cameras | Lens/FOV/sensor-fit, framing, clipping and focus-object concepts |
| [S16] | React Postprocessing - DepthOfField | Current world-unit focus docs, target override, half-resolution default and deprecations |
| [S17] | React Postprocessing upstream - DepthOfField.tsx | Camera dependency, compatibility props, live focus updates and explicit mask workaround comment |
| [S18] | Postprocessing upstream - CircleOfConfusionMaterial.js | World-focus accessors/aliases; camera-setting copy; some stale comments |
| [S19] | Postprocessing upstream - DepthOfFieldEffect.js | Multiple targets/passes, constructor defaults, camera updates, target-distance calculation |
| [S19a] | React Postprocessing - EffectComposer | Explicit camera/scene, render priority, multisampling and pass-management options |
| [S20] | Babylon - Bones and Skeletons | Hierarchical local transforms, rest/bind concepts, weights, local/world bone operations |
| [S21] | Babylon upstream - BoneIKController | Two-bone controller, pole/bend-axis/reach options and prerequisites |
| [S22] | Babylon - Gizmos | Mesh/bone/node manipulation, local/world orientation and utility layer |
| [S23] | Babylon - Depth of Field and Other Lens Effects | Camera-attached lens pipeline and depth/focus/aperture options |
| [S24] | Khronos - glTF 2.0 Specification | Runtime asset-delivery/interoperability purpose |
| [S25] | Khronos glTF Tutorial - Skins | Joint/weight attributes and inverse-bind/current-global transform relationship |
| [S26] | MakeHuman/MPFB - License | Core assets CC0; tool code split GPL/AGPL |
| [S27] | VRM Public License 1.0 | Model License Settings govern redistribution, derivatives and permitted use |
| [S28] | MDN - Using IndexedDB | Async stores/transactions, integer DB versions and upgrade/migration behavior |
| [S29] | MDN - IDBTransaction complete event | Transaction completion is committed-success signal |
| [S30] | MDN - Storage quotas and eviction criteria | Origin scope, best-effort/persistent data, private mode, quota and storage estimates |
| [S31] | idb upstream README | Upgrade/blocked/blocking/terminated callbacks, transaction lifetime and tx.done |
| [S31a] | MDN - Web Storage API | Origin scope and synchronous localStorage behavior |
| [S32] | Vite - Deploying a Static Site | GitHub Pages repository base and Actions build/deployment |
| [S33] | Vite - Static Asset Handling | Asset URL imports, public directory and statically analyzable URL patterns |
| [S34] | GitHub Docs - Using custom workflows with GitHub Pages | Artifact/deploy permissions, environment and job dependencies |
| [S34a] | GitHub Docs - GitHub Pages limits | Published-site size, bandwidth/build constraints and educational-copy guidance |
| [S35] | Three upstream - WebGLRenderer.js | Explicit WebGL1 rejection since r163 |
| [S35a] | Three - WebGL capability addon | WebGL2 availability and unsupported message API |
| [S36] | Three - DirectionalLight | Position-to-target direction; target scene membership |
| [S37] | Three - SpotLight | Target, cone, penumbra, candela intensity and decay |
| [S38] | Three - LightShadow | Resolution cost, bias/normalBias and explicit cached-shadow invalidation |
| [S39] | Three upstream - PerspectiveCamera.js | Actual film-height, FOV/focal-length formulas and projection update behavior |
| [S40] | Three - BokehPass | Explicit scene/camera; focus/aperture/maxblur; focus along look direction |
| [S41] | W3C WAI - Understanding Dragging Movements | Non-drag pointer alternatives and distinction from keyboard requirements |
| [S42] | React - useReducer | Pure reducers, document-state updates and Strict Mode caveats |
| [S43] | Unity Manual - Position GameObjects | W/E/R, gizmos, numeric inspector edits and Local/Global |
| [S44] | MDN - webglcontextlost event | Canvas event does not bubble; own-context loss simulation |
| [S45] | MDN - isContextLost | GPU switching/resource pressure and recovery conditions |
| [S46] | MDN - WebGL best practices | Conservative VRAM, cleanup, quality controls and back-buffer sizing |
| [S47] | React Three Fiber - Scaling performance | Demand rendering, mutation invalidation, resource reuse and draw-call considerations |
| [S48] | Three - TransformControls | Translate/rotate/scale, local/world, snapping and change/drag events |

### Engine/helper licenses inspected

These are software licenses, not licenses to sample assets shipped elsewhere:

- [Three MIT license](https://raw.githubusercontent.com/mrdoob/three.js/dev/LICENSE).
- [React Three Fiber MIT license](https://raw.githubusercontent.com/pmndrs/react-three-fiber/master/LICENSE).
- [Drei MIT license](https://raw.githubusercontent.com/pmndrs/drei/master/LICENSE).
- [React Postprocessing MIT license](https://raw.githubusercontent.com/pmndrs/react-postprocessing/master/LICENSE).
- [Postprocessing license text](https://raw.githubusercontent.com/pmndrs/postprocessing/main/LICENSE.md):
  permissive zlib-style terms, including origin/misrepresentation and notice
  requirements; do not incorrectly label this dependency MIT.
- [Babylon Apache 2.0 license](https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/license.md).
- [idb repository/license declaration](https://github.com/jakearchibald/idb):
  repository identifies ISC.

Retain required dependency notices in distribution and audit the actual locked
dependency tree. This list is research, not a complete transitive-license audit
or legal opinion. No third-party model is approved by this document.

[S01]: https://posemy.art/ "PoseMy.Art home; accessed 2026-11-18"
[S02]: https://posemy.art/app/?lang=en "PoseMy.Art public application; accessed 2026-11-18"
[S03]: https://r3f.docs.pmnd.rs/getting-started/introduction "React Three Fiber Introduction; accessed 2026-11-18"
[S04]: https://r3f.docs.pmnd.rs/api/canvas "React Three Fiber Canvas; accessed 2026-11-18"
[S05]: https://drei.docs.pmnd.rs/gizmos/transform-controls "Drei TransformControls; accessed 2026-11-18"
[S06]: https://threejs.org/docs/pages/PerspectiveCamera.html "Three PerspectiveCamera; accessed 2026-11-18"
[S07]: https://threejs.org/docs/pages/OrbitControls.html "Three OrbitControls; accessed 2026-11-18"
[S08]: https://threejs.org/docs/pages/SkinnedMesh.html "Three SkinnedMesh; accessed 2026-11-18"
[S09]: https://threejs.org/docs/pages/Skeleton.html "Three Skeleton; accessed 2026-11-18"
[S10]: https://threejs.org/docs/pages/module-SkeletonUtils.html "Three SkeletonUtils; accessed 2026-11-18"
[S11]: https://threejs.org/docs/pages/CCDIKSolver.html "Three CCDIKSolver; accessed 2026-11-18"
[S12]: https://docs.blender.org/manual/en/latest/editors/3dview/navigate/introduction.html "Blender Navigation Introduction; accessed 2026-11-18"
[S13]: https://docs.blender.org/manual/en/latest/editors/3dview/controls/orientation.html "Blender Transform Orientation; accessed 2026-11-18"
[S14]: https://docs.blender.org/manual/en/latest/animation/armatures/posing/editing/copy_paste.html "Blender Copy/Paste Pose; accessed 2026-11-18"
[S15]: https://docs.blender.org/manual/en/latest/render/cameras.html "Blender Cameras; accessed 2026-11-18"
[S16]: https://react-postprocessing.docs.pmnd.rs/effects/depth-of-field "React Postprocessing DepthOfField; accessed 2026-11-18"
[S17]: https://raw.githubusercontent.com/pmndrs/react-postprocessing/master/src/effects/DepthOfField.tsx "React Postprocessing DepthOfField source; accessed 2026-11-18"
[S18]: https://raw.githubusercontent.com/pmndrs/postprocessing/main/src/materials/CircleOfConfusionMaterial.js "Postprocessing CircleOfConfusionMaterial source; accessed 2026-11-18"
[S19]: https://raw.githubusercontent.com/pmndrs/postprocessing/main/src/effects/DepthOfFieldEffect.js "Postprocessing DepthOfFieldEffect source; accessed 2026-11-18"
[S19a]: https://react-postprocessing.docs.pmnd.rs/effect-composer "React Postprocessing EffectComposer; accessed 2026-11-18"
[S20]: https://doc.babylonjs.com/features/featuresDeepDive/mesh/bonesSkeletons/ "Babylon Bones and Skeletons; accessed 2026-11-18"
[S21]: https://raw.githubusercontent.com/BabylonJS/Babylon.js/master/packages/dev/core/src/Bones/boneIKController.ts "Babylon BoneIKController source; accessed 2026-11-18"
[S22]: https://doc.babylonjs.com/features/featuresDeepDive/mesh/gizmo/ "Babylon Gizmos; accessed 2026-11-18"
[S23]: https://doc.babylonjs.com/features/featuresDeepDive/postProcesses/dofLenseEffects/ "Babylon Depth of Field and Other Lens Effects; accessed 2026-11-18"
[S24]: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html "Khronos glTF 2.0 Specification; accessed 2026-11-18"
[S25]: https://github.khronos.org/glTF-Tutorials/gltfTutorial/gltfTutorial_020_Skins.html "Khronos glTF Tutorial Skins; accessed 2026-11-18"
[S26]: https://static.makehumancommunity.org/about/license.html "MakeHuman/MPFB License; accessed 2026-11-18"
[S27]: https://vrm.dev/en/licenses/1.0/ "VRM Public License 1.0; accessed 2026-11-18"
[S28]: https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB "MDN Using IndexedDB; accessed 2026-11-18"
[S29]: https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event "MDN IDBTransaction complete event; accessed 2026-11-18"
[S30]: https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria "MDN Storage quotas and eviction criteria; accessed 2026-11-18"
[S31]: https://github.com/jakearchibald/idb "idb README; accessed 2026-11-18"
[S31a]: https://developer.mozilla.org/en-US/docs/Web/API/Web_Storage_API "MDN Web Storage API; accessed 2026-11-18"
[S32]: https://vite.dev/guide/static-deploy.html "Vite Deploying a Static Site; accessed 2026-11-18"
[S33]: https://vite.dev/guide/assets.html "Vite Static Asset Handling; accessed 2026-11-18"
[S34]: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages "GitHub Pages custom workflows; accessed 2026-11-18"
[S34a]: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits "GitHub Pages limits; accessed 2026-11-18"
[S35]: https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/WebGLRenderer.js "Three WebGLRenderer source; accessed 2026-11-18"
[S35a]: https://threejs.org/docs/pages/WebGL.html "Three WebGL capabilities; accessed 2026-11-18"
[S36]: https://threejs.org/docs/pages/DirectionalLight.html "Three DirectionalLight; accessed 2026-11-18"
[S37]: https://threejs.org/docs/pages/SpotLight.html "Three SpotLight; accessed 2026-11-18"
[S38]: https://threejs.org/docs/pages/LightShadow.html "Three LightShadow; accessed 2026-11-18"
[S39]: https://raw.githubusercontent.com/mrdoob/three.js/dev/src/cameras/PerspectiveCamera.js "Three PerspectiveCamera source; accessed 2026-11-18"
[S40]: https://threejs.org/docs/pages/BokehPass.html "Three BokehPass; accessed 2026-11-18"
[S41]: https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html "W3C Understanding Dragging Movements; accessed 2026-11-18"
[S42]: https://react.dev/reference/react/useReducer "React useReducer; accessed 2026-11-18"
[S43]: https://docs.unity3d.com/Manual/PositioningGameObjects.html "Unity Position GameObjects; accessed 2026-11-18"
[S44]: https://developer.mozilla.org/en-US/docs/Web/API/HTMLCanvasElement/webglcontextlost_event "MDN webglcontextlost event; accessed 2026-11-18"
[S45]: https://developer.mozilla.org/en-US/docs/Web/API/WebGLRenderingContext/isContextLost "MDN isContextLost; accessed 2026-11-18"
[S46]: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices "MDN WebGL best practices; accessed 2026-11-18"
[S47]: https://r3f.docs.pmnd.rs/advanced/scaling-performance "React Three Fiber Scaling performance; accessed 2026-11-18"
[S48]: https://threejs.org/docs/pages/TransformControls.html "Three TransformControls; accessed 2026-11-18"
