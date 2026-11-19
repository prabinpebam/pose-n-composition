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
| Static posing | Click visible joint nodes, rotate FK by real pointer drag, root W/E/R, presets, neutral reset, undo/redo | LOCAL PASS after Nov 19 repair: 16 actual node-click/ring-drag cases across both figures, sampled skin movement and one-step undo/redo; prior inspector/preset checks did not establish this workflow. Public gesture verification recorded separately below. |
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
intentional: FK only, no collision/ground snap, source Superhero proportions,
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

Deployment and fresh live gesture results are pending until the repair is
published; the local results above are not a live acceptance claim.
- Live DOF camera export encoded **1600 x 1067, 1,158,642-byte PNG**, matching the
  local verified rendering. Only uniquely named test saves created for these checks
  were removed; existing user records and preferences were not cleared.
