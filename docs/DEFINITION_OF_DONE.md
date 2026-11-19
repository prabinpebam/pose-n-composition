# Implementation plan and Definition of Done

## Product boundary

Original, desktop-first static figure-posing and composition studio. No copied source,
models or visual design. No accounts, backend, animation, physics, rig authoring,
photorealistic anatomy, individual finger articulation or cloud synchronization.
FK posing is deliberately preferred to a fragile partial IK solver.

## Plan

1. Establish strict React/TypeScript/Vite + Three.js foundation and validated scene model.
2. Build joints, presets and transform workflow; use legally redistributable ready-made
   rigged male/female bodies per the owner's updated preference. Procedural bodies are
   a temporary working fallback, not the final external-model acceptance claim.
3. Add procedural furnishings, editable lighting and independent composition camera.
4. Add real optical postprocessing, PNG export, history and local/portable persistence.
5. Verify automated cases and actual browser workflows; document limitations.
6. Publish authorized personal public repository and GitHub Pages; verify live app.

## Measurable acceptance matrix

Unchecked items are not completion claims. Evidence is recorded after execution.

| Requirement | Acceptance | Evidence |
|---|---|---|
| Distinct figures | Legally redistributable ready-made male/female rigged bodies, verified sources/licenses, semantic-joint mapping; multiple coexist | PASS: Quaternius free Standard Superhero pair, exact included CC0; 65 bones / three skins each, 17 mapped controls; actual browser screenshots and source-rig tests |
| Static posing | Click visible joint nodes, rotate FK by real pointer drag, root W/E/R, presets, neutral reset, undo/redo | PASS after Nov 19 repair: two fresh-stage LIVE 16-case node-click/ring-drag runs across both figures at 1024 x 768 and 1440 x 1000, sampled skin movement, before/after screenshots and one-step undo/redo. Prior inspector/preset checks did not establish this workflow. |
| Hair appearance | Visible scalp hair, brows and lashes on both source figures; independent per-figure hair color follows head; scene persistence, old-save compatibility and history | PASS: 40-test suite; local and LIVE close-ups, both-sex duplicate/delete isolation, head turns, color undo/redo and scene save-refresh-load; live DOF PNG includes both hair colors |
| Props | Lamp, table, chair, desk, couch, bed, windowed room; transforms and colors | PASS: four persisted prop tests (including nine window-opening rays and material isolation); all seven coexist in actual 10-object UI scene |
| Lighting | Position, target, color and intensity change actual scene illumination | PASS: actual image mean RGB differences 12.40 / 73.94 / 42.43 / 73.94 respectively |
| Camera | Independent position/aim/FOV/aspect, inspectable framed view, real toggleable depth of field | PASS: exact 50 mm projection test; camera-view UI; three-depth focus fixture and four-vs-one actual renderer calls |
| Export | PNG of composition camera, not editor overlays | PASS: real source-body UI export with DOF at 1600 × 900 (16:9), 386,820-byte PNG; separate DPR 2 export check |
| Persistence | IndexedDB named scene/pose library, localStorage preferences; visible failures | PASS: save/refresh/load restored root X -1.25, color #cc9966, elbow -95; preferences survive refresh; injected storage/preference denials visible |
| Portability | Versioned JSON scene/pose download/import with finite bounded schema validation and size limits | PASS: full scene roundtrip exactly equals stored document; pose JSON restored all 17 joints; version and non-finite imports visibly reject without mutation |
| Navigation | Orbit/pan/zoom, gizmos, shortcuts and discoverable help, usable narrow window | PASS: actual mouse gizmo drag changed root Y to 0.27976; orbit disabled during drag; Help workflow; 900 × 700 and 500 × 800 without horizontal overflow |
| Quality | Strict build, focused model tests and browser workflow, no uncaught application errors | PASS: 40/40 tests in three files; strict TypeScript + Vite build; fresh browser source-asset load without application errors |
| Privacy/license | No uploads/telemetry; licensed figures and original props; dependencies/license documented | PASS: original props, exact source CC0 + provenance/hashes, full deployed software notices; same-site static assets only |
| Deployment | Public repository under authenticated personal login; actual Pages HTTPS URL responds and renders | PASS: public prabinpebam/pose-n-composition; hair implementation cb59744, Actions 44376686602 successful; actual live model loading and hair workflows verified |

## Evidence log (2026-11-18)

- First usable browser milestone delivered to owner main within about 15 active minutes.
- Native renderer three-depth fixture: near-board horizontal contrast 33.77 with
  focus at 6 m, 8.43 with focus at 10 m; far-board contrast 4.15 at 6 m versus
  56.31 at 10 m. Actual focus-plane-dependent blur, not an inert control.
- Instrumented renderer calls per frame: DOF enabled **4**, disabled **1**.
- PNG at renderer DPR 2 still encodes exactly **1600 × 1067** for 3:2.
- Transform drag event disables orbit; releasing enables it. Camera view keeps it disabled.
- Invalid schema/rig import produced visible alert and preserved edited elbow at -70°.
- All seven props added in the actual UI alongside both figures and a light (10 objects).
- Public repo created under authenticated `prabinpebam`; Pages configured for Actions.
  Interim release f65ed9e deployed successfully (Actions 44359186224); HTTPS index,
  JS and CSS under the repository subpath returned 200 and rendered in browser.
- Exact source files/license/provenance: [ASSETS.md](./ASSETS.md). Source GLTF,
  buffers and all required PNGs returned 200 in the local browser. Skin weight
  and actual loader checks were independently completed before adapter integration.
- New adapter preserves native root/bind quaternions, normalizes inside a logical
  scale-1 wrapper, and uses per-body semantic neutral/basis transforms.
  Ten actual-source tests cover both bodies, all presets, source-rest math,
  independent clone materials/skeletons, posed bounds/raycast and every skin's
  combined root position/rotation/nonuniform scale.
- Independent browser QA loaded **all three pre-external-model** named records:
  scene and pose reproduced root/joints/colors; complete scene reproduced all
  10 objects, light settings, background and 75 mm / 4:5 / DOF / focus 8 camera.
  No storage clearing or migration rewrite was performed.
- Aborted model request produced a persistent explanatory error and Retry, with
  export disabled and no custom fallback. Retry restored the editor; existing
  named saves remained intact.
- Deliberately injected network/storage failures and pre-integration development
  hot-reload errors are not counted as clean-run errors. Fresh final loads and
  normal UI workflows are the relevant runtime evidence.

## Baseline public release verification

- **App:** https://prabinpebam.github.io/pose-n-composition/
- **Source:** https://github.com/prabinpebam/pose-n-composition
- **Verified implementation release:** `0dd2aba`.
- **Successful Pages build/deploy:** https://github.com/prabinpebam/pose-n-composition/actions/runs/44362640034
- Live index, production JavaScript/CSS, full software notices and the exact
  806-byte model license returned **HTTP 200**. Both original model glTF SHA-256
  hashes and license hash also match their committed Git blobs.
- Actual live browser made **18 model-related requests / 16 unique asset URLs**
  (two shared eye textures requested by both figures). Every glTF, BIN and PNG
  returned **200** under `/pose-n-composition/models/`, with no new application errors.
- Live UI changed left elbow to -80° while right elbow remained 0°, added a chair,
  inspected a 60 mm / 1:1 camera with DOF, and exported a **552,311-byte
  1600 × 1600 PNG**. Named scene save → browser refresh → load reproduced all four
  objects, elbow -80°, lens 60 mm, aspect 1:1 and enabled DOF.
- Final local full suite: **31/31 tests in three files**, strict TypeScript and
  production build successful. CI repeats those checks before deploying.
- Final DPR 2 + enabled DOF portrait export encoded **1600 × 2000**, restored the
  **640 × 800** preview drawing buffer and DPR 2, without context loss or errors.
- Output-color verification used four flat in-focus color patches at exposure
  1.3: direct rendering versus enabled DOF differed by at most **1/255** in any
  channel; camera-view versus decoded exported PNG differed by **0/255**.
  Example direct `[228,203,165]`, DOF/PNG `[228,202,165]`; gray remained
  `[186,186,186]` in all three. DOF does not introduce an exposure/gamma shift.
- Independent browser verification inspected **all 17 semantic joint triples**
  from the pre-replacement male pose and applied it to the sourced female:
  **17/17 matched exactly**, while female root `[0.55, 0, 0.05]` remained unchanged.
  Male and female Neutral, Seated, Reach and Contrapposto remained coherent.

Historical rows describe the checks actually executed, not a guarantee of
uncovered workflows: the Nov 19 report exposed a missing point-selection test
despite earlier numeric/preset posing checks. Known scope limits remain
intentional at that historical milestone: FK only, no collision/ground snap, source Superhero proportions,
roughly 31.5 MB initial assets, artistic raster bokeh rather than calibrated
f-stops, browser-local storage requiring portable backups, and desktop-first UI.
The production bundle emits Vite's non-failing size advisory; no type/build/test
failures are hidden by that warning.

## Hair appearance update (2026-11-19)

- Added original short scalp hair fitted to each source head's actual weighted
  triangles; 32 curved strand ridges are merged with the cap into one mesh.
  Head attachment preserves the source bind/rest transform. Source brows and
  modeled lashes remain skinned and are recolored together with scalp hair.
- Added independent **Hair color** per figure. Body tint and eye materials stay
  separate. Appearance is scene data; presets/reset and portable pose application
  do not replace it.
- Optional additive v1 `hairColor` defaults missing legacy fields to `#3b2720`.
  Present malformed values reject visibly without mutating the scene. No database
  version change, record rewrite, storage clearing or pose-format change.
- **40/40 tests, strict TypeScript and production build pass.** Nine new cases
  cover old scenes, independent colors, malformed values, appearance-free poses,
  actual scalp fit, head/neck/root transformations of scalp/brows/lashes, and
  same-body material/geometry isolation.
- Actual browser: male `#c48a38`, female `#653c90`, female body `#e0b894`;
  save -> refresh -> named load restores those independent values. Color undo
  restores `#3b2720` and redo restores `#c48a38`.
- Both male and female duplicates were recolored `#00dd88`, moved away, head-rotated
  35 degrees and deleted: each survivor kept its original hair color and head Y 0.
  Opposite head turns of +/-30 degrees and roll +/-8 visibly carry hair/facial
  details with the head.
- Exported scene JSON contains both colors; exported pose has all 17 joints and
  no appearance. Legacy scene import defaults both colors while preserving roots
  (-0.14 / 0.14); undo restores colors. `hairColor: null` produces the visible
  `Invalid file: expected #rrggbb color` error and leaves hair unchanged.
- Actual hair close-up with enabled DOF exported a **1600 x 1067 PNG,
  1,158,642 bytes**; both gold and purple hair are present in decoded pixels.
- Runtime accessories are original MIT geometry; source facial surfaces retain
  the exact CC0 distribution license. No new dependencies, assets or downloads.
  Basic short hairstyles only: no hairstyle editing, separate lash/brow colors
  or hair simulation.

### Public hair release verification

- Implementation commit: `cb59744ecc24b3bf317a4c64d806af56feb58f23`.
  [Pages workflow 44376686602](https://github.com/prabinpebam/pose-n-composition/actions/runs/44376686602)
  passed installation, all 40 tests, strict production build and deployment.
- Fresh actual live browser loaded **18 requests / 16 unique model URLs**, all
  **HTTP 200** under the correct repository subpath; zero application errors.
- Live color undo/redo restored default brown / gold respectively; the untouched
  female remained brown until explicitly edited. Close-up screenshots show both
  scalp hair and facial hair recolored, with the original body/eye materials separate.
- Live named save -> refresh -> load restored male `#c48a38`, female `#653c90`,
  separate female body `#e0b894`, head yaw +30 / -30 and roll -8 / +8 degrees.
  Camera framing was restored and inspected after reload.
- Actual live male and female duplicates were separately recolored and head-rotated
  65 degrees, then deleted. Survivors retained their original colors and respective
  +30 / -30 head angles; both rendered without errors.
- Live DOF camera export encoded **1600 x 1067, 1,158,642-byte PNG**, matching the
  local verified rendering. Only uniquely named test saves created for these checks
  were removed; existing user records and preferences were not cleared.

## Visible-node posing repair (2026-11-19)

### Reproduction and root cause

- On the old live release `bac4103`, at 1440 x 1000, exact clicks on the male's
  visible head (603.8, 418.1), left shoulder (637.2, 447.0), elbow (630.7, 488.5),
  wrist (590.2, 500.6) and knee (625.7, 596.2) all left Root selected.
- Gold markers rendered with depth testing disabled, but picking sorted skin and
  nodes together by physical ray distance. Skin won even though the node was
  visibly on top: head skin 6.358 m versus marker 6.423 m; elbow 6.399 versus
  6.422 m. Previous inspector, preset and state/render tests missed that defect.
- Picking now uses the visible node's screen position first, with a 10 CSS pixel
  radius and a constant 5 px visible radius across distance/root scale. Capture-
  phase pointer ownership gives nodes priority over skin and overlapping gizmos.
  Selected nodes turn coral; hover is white with a joint-name tooltip.
- Clicking a node attaches rotation controls immediately, without a dropdown.
  Ring dragging still belongs to TransformControls; background dragging belongs
  to OrbitControls. Only changed transforms create a history entry. Release and
  pointer cancellation restore navigation.

### Local verification

- `npm test`: **43/43 tests in four files**, including three focused marker
  regressions. `npm run build`: strict TypeScript and production build pass.
  Vite's existing non-failing bundle-size advisory remains.
- `scripts/posing-smoke.mjs` used actual Playwright mouse clicks and 16-step
  ring drags, never engine setters, injected poses or numeric joint inputs.
  All **16 cases passed**: shoulder, elbow, wrist, head, neck, hip, knee and ankle
  on male and female. Sampled actual skin movement was **0.01677-0.12238 m**.
- Every case checked the correct attached bone/coral marker; camera and root
  unchanged; opposite limb and every other figure unchanged; orbit disabled
  during drag/restored afterward; one Undo restores the previous skin and one
  Redo restores the dragged skin. Head/neck also carry the scalp geometry.
- Both figures then passed **10 more gestures** after the Reach preset, including
  three consecutive elbow drags each. Male/female same-gender copies passed
  **eight gestures**, with originals and all other skins unchanged.
- Named scene save -> refresh -> load restored all five objects, all joint
  values, camera/background, independent gold/purple hair and brown copies.
  A further **six actual pointer gestures** passed after loading. Preferences
  were unchanged; no owner tab, existing save, license or source asset was touched.
- Canvas skin click selected the other figure; background drag changed only the
  editor camera; camera-view navigation stayed disabled and restored on return.
  A pointer-cancel event after an actual ring press restored orbit and ended
  dragging. No application/console errors occurred during the gesture runs.

### Public verification

- Functional release: **`854445696933819a1c033b2bd0eec80562905d0c`**.
  [Pages workflow 44463656732](https://github.com/prabinpebam/pose-n-composition/actions/runs/44463656732)
  completed **successfully**, including all 43 tests, strict build and deployment.
  The fresh live page loaded the matching `index-Bjg9vI_Q.js` production bundle.
- On the actual HTTPS app, an isolated fresh page passed all **16 node clicks
  and real ring drags** at 1024 x 768. Twelve before/after screenshots capture
  male/female shoulder, head and ankle gestures. They visibly show the skin/head
  changing, not merely numbers or a root/camera movement.
- Reloaded the fresh stage and repeated **all 16 cases at 1440 x 1000**. Both
  bodies passed shoulder, elbow, wrist, head, neck, hip, knee and ankle. Actual
  skin motion ranged **0.01313-0.12238 m**. Correct attachment/highlight,
  unchanged root/camera/opposite limb/other figure, scalp following head/neck,
  orbit gating and one-step undo/redo passed in every case. No joint dropdown,
  numeric joint input, pose injection or engine setter was used to perform them.
- LIVE also passed the **10 post-Reach/repeated-drag cases**, **eight same-gender
  copy isolation cases**, and named save -> refresh -> load of five objects with
  all joint transforms, camera/background and independent hair colors intact.
  **Six more pointer gestures** passed after the load. Preferences were unchanged.
- Every live gesture run reported **zero application/console errors**.
  All mutations were in the task's isolated page; the owner's tab/storage was
  not used. No data migration, storage clearing, model/license changes or new
  package dependencies were needed.
- Limits remain explicit: click a figure first to reveal its nodes (or use its
  Outliner row); helpers must be enabled and editor view active. Coincident nodes
  are resolved by nearest screen center/depth; orbit to separate exactly
  overlapping joints. This is FK, not IK or anatomical joint limiting.

## Sculpted hairstyles, 10 grounded presets, Mixamo/CC0 animation pose extractor & UI overhaul (2026-11-19)

- **Sculpted CC0 Hairstyles (`src/hair.ts`, `src/external-rig.ts`)**: Replaced the
  procedural ray-projected cap with 6 official sculpted CC0 Quaternius hairstyles
  (`Side parted`, `Long waves`, `Twin buns`, `Short crop`, `Parted + beard`, and
  `None (bald)`) with cross-body crown-aligned skull adaptation and luminance-normalized
  albedo textures so any `hairColor` tints sculpted locks, eyebrows, and eyelashes cleanly.
- **10 Anatomically Grounded Studio Presets (`src/model.ts`, `src/engine.ts`)**:
  Rebuilt `PRESETS` (`Neutral`, `Relaxed`, `Contrapposto`, `Heroic`, `Walking`,
  `Running`, `Seated`, `Kneeling`, `Crouch`, `Reach`) calibrated to the 65-bone
  semantic rig axes and paired with deformed-skin vertex floor grounding (`groundPoseY`)
  so feet/knees plant naturally on the studio floor without floating or sinking.
- **Animation-Cycle Pose Extractor (`src/animationPoseExtractor.ts`, `src/App.tsx`)**:
  Added 12 built-in CC0 humanoid motion cycles (`UAL1_Standard.glb`) plus 100%
  client-side Mixamo `.fbx` / `.glb` / `.gltf` import (supporting `mixamorig:`
  bone names, With Skin & Without Skin FBX rest reconstruction, and T/A-pose to
  arms-down neutral retargeting), frame timeline scrubbing, play/pause preview,
  floor grounding toggle, and one-click **Use this pose** committing all 17 FK
  joints with single-step Undo/Redo.
- **Studio UI Design Audit & Overhaul (`src/components/ui.tsx`, `src/App.tsx`, `src/styles.css`)**:
  Replaced every native `<select>` and unstructured list with unified accessible
  components (`SelectDropdown` portal combobox with smart viewport flip and
  keyboard navigation, structured `ListRow` for Scene Outliner & Saved Studies,
  `SegmentedControl`, `SwitchRow`, `ColorField`, `SliderField`, `Vector3Field`),
  enforcing 100% Clawpilot `var(--cp-*)` theme tokens across Dark and Light themes,
  flush panel-edge scrollbars, and zero one-sided accent borders.
- **Verification**: **54/54 Vitest tests across 6 test suites**, strict `tsc --noEmit`
  and production Vite build pass; headless Playwright verified all 16 viewport
  node-click + ring-drag gestures, keyboard combobox navigation, synthetic Mixamo
  `.glb` upload + frame pose extraction, and full Dark/Light + `1440×950` /
  `1024×768` visual QA with zero console or network errors.

## True-color skin & outfit tinting, Camera View navigation & Pose JSON interchange (2026-11-19)

- **True-Color Skin & Independent Outfit / Dress Tinting (`src/external-rig.ts`, `src/rig.ts`, `src/model.ts`, `src/App.tsx`)**:
  Added runtime albedo luminance normalization + sub-pixel chroma/luminance/roughness
  outfit masking (`buildNormalizedBodyOutfitRgba`) uploaded via unpremultiplied RGBA
  `THREE.DataTexture` (`SRGBColorSpace`, `premultiplyAlpha = false`) and a per-clone
  `uOutfitColor` `MeshStandardMaterial` shader hook (`configureSkinAndOutfitMaterial`),
  leaving raw CC0 glTF/PNG assets untouched on disk. Added `outfitColor` to figure
  scene items with additive v1 backward compatibility and independent clone uniforms.
- **Interactive Orbit / Pan / Zoom in Camera View (`src/engine.ts`, `src/App.tsx`)**:
  Attached a dedicated `OrbitControls` instance (`cameraOrbit`) to the composition
  camera when `Camera` view is active so left-drag orbit, right-drag pan, wheel zoom,
  and `Frame F` adjust `compositionCamera.position` and `target` live, recording one
  Undo/Redo step per gesture and autosaving to IndexedDB while leaving `editorCamera`
  untouched.
- **First-Class Export & Import Pose JSON (`src/model.ts`, `src/App.tsx`)**:
  Added **Export pose JSON** and **Import pose JSON** buttons directly in
  **Joint & preset posing**, validating `.pose.json` (`validatePoseFile` /
  `parsePoseFile`) strictly as 17 semantic joints without appearance fields,
  supporting cross-body (`Male <-> Female`) application, single-step Undo/Redo, and
  immediate IndexedDB autosave.
- **Verification**: Vitest unit suites (`model`, `external-rig`, `storage`, `hair`,
  `picking`, `presets`, `poses`), `tsc -b && vite build`, WebGL `gl.readPixels`
  verification across `#FFDECC`, `#D99B78`, `#6B3E26`, `#40E0D0` skin swatches and
  `#E63946`, `#F1FAEE`, `#2A9D8F` outfit swatches on both Male & Female, Camera View
  orbit/pan/zoom + Undo/Redo + reload, Export/Import `.pose.json` round-trip, and
  `16/16` `runPosingSmoke` FK gestures passed with zero errors, followed by live
  GitHub Pages verification.

## Final milestone: proportions and authoritative deformation (2026-11-19)

The final release retains true skin/outfit tinting, Camera View orbit/pan/zoom,
appearance-free pose JSON import/export, all five NPR modes (including hand-drawn
Illustration and transparent Outline PNG), Shift-click/Ctrl-drag multi-selection,
group Move/Rotate/Flip, individual X/Y/Z flips, full pose transfer and the
17-joint Skeleton Tree for partial copies.

Newly integrated capabilities:

- Nine proportion archetypes: Realistic, Heroic, Lean, Slender, Busty, Chubby,
  Fat, Obese and Chibi. Choose before adding or switch any existing figure;
  pose/colors survive, hair/eyes scale with the skull, and the actual deformed
  surface is re-grounded. Changes are undoable and immediately autosaved.
- Three-layer pose-change-only deformation: coupled clavicle/spine/toe helpers;
  continuous axial twist, hybrid DQS and welded tangent Delta Mush; muscle bulges,
  crease-bisector contact/lateral squish and body-scaled capsule pushout.
- Anatomical joint limits default on, with an explicit free-rotation switch.
  Semantic XYZ readback compensates helper rotations so FK drags and pose files
  do not accumulate helper-bone drift.
- CPU-authoritative main-body vertices and welded normals feed the existing
  skin/outfit shader, NPR normal/depth pass, shadows, Bokeh depth, picking and
  grounding. Identity pass-through skinning avoids applying the pose twice;
  eyes/brows/hair/markers retain the live skeleton. World reflection/nonuniform
  scale is excluded from the rigid character-space solve.
- Additive v1 scene fields default legacy `bodyType` to `heroic` and
  `anatomicalLimits` to `true`; malformed options reject. Pose JSON excludes both.
  Existing IndexedDB data is neither cleared nor migrated destructively.

Executed local evidence:

- Full Vitest suite: **101 passing tests in 10 files**, including both standalone
  modules, integration, storage and NPR tests; strict production build passes.
  Integration cases cover all nine archetypes on both source rigs, signed-root
  shader/CPU pass-through agreement, semantic FK recovery, limits, hair swaps,
  unchanged-pose caching and exact return-to-Heroic restoration.
- Inspected **18 actual viewport screenshots**: every archetype in Realistic and
  Illustration, with female skin `#ffdecc` and outfit `#e63946`. Hair head-scale
  matched exactly (Chibi **1.78**); max CPU-versus-buffer vertex error was
  **less than 8e-8 m**; standing ground error was **less than 3e-7 m**.
- Inspected Seated/Kneeling/Crouch/Reach on Realistic/Busty/Obese/Chibi:
  **16 screenshots**, every deformed body grounded within **0.00005 m** and
  welded normals within **5e-8** of unit length. These are analytical contact
  corrections, not a guarantee of collision-free impossible free poses.
- Actual 180-degree wrist twist and 135-degree elbow flexion; default anatomical
  bounds clamp a backwards elbow to 2 degrees, while free mode allows 60.
- Real-pointer ring gestures for head, chest, shoulder, elbow, wrist and knee,
  plus head/elbow on a mirrored Chibi: skin moved, camera/other figure/opposite
  limb stayed isolated, and single-step Undo/Redo restored geometry.
- Added Chibi directly, checked grounded geometry, and undid in one step.
  A full reload exactly restored the scene, Chibi archetype, disabled limits,
  180-degree wrist twist, free elbow and swapped Twin buns at head scale 1.78;
  zero console/network errors during the reload.
- All 12 built-in animation cycles sampled and committed on Obese: preview and
  committed vertex buffers matched exactly, with no floor penetration beyond
  0.00005 m. Existing airborne lift in jog, sprint and jump was preserved.
- X/Y/Z reflections retained CPU/shader vertex agreement within **7e-8 m**.
  Enabled-DOF transparent Outline export encoded **1600 x 1067 RGBA PNG** with
  both transparent pixels and visible ink.
- Repeated the Batch 2A real-pointer smoke against deformed figures: Outliner
  and viewport Shift-selection, Editor/Camera marquees, group Move/Rotate and
  all-axis flips, full paste and Left arm + Head partial paste all passed,
  including atomic Undo/Redo and preservation of the other 13 joints.

Screenshots are session evidence outside the repository, not production assets.
Remaining boundaries: static FK/frame extraction rather than simulation, no IK,
finger articulation, furniture/inter-character collisions, or medical guarantees.
