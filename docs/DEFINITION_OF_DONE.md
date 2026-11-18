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
| Static posing | Select named joints, rotate FK, root W/E/R, presets, neutral reset, undo/redo | PASS: source-rig tests on both sexes; browser left elbow -110, opposite elbow 0; neutral/reach/seated/contrapposto and undo/redo; root carries eyes/eyebrows too |
| Props | Lamp, table, chair, desk, couch, bed, windowed room; transforms and colors | PASS: four persisted prop tests (including nine window-opening rays and material isolation); all seven coexist in actual 10-object UI scene |
| Lighting | Position, target, color and intensity change actual scene illumination | PASS: actual image mean RGB differences 12.40 / 73.94 / 42.43 / 73.94 respectively |
| Camera | Independent position/aim/FOV/aspect, inspectable framed view, real toggleable depth of field | PASS: exact 50 mm projection test; camera-view UI; three-depth focus fixture and four-vs-one actual renderer calls |
| Export | PNG of composition camera, not editor overlays | PASS: real source-body UI export with DOF at 1600 × 900 (16:9), 386,820-byte PNG; separate DPR 2 export check |
| Persistence | IndexedDB named scene/pose library, localStorage preferences; visible failures | PASS: save/refresh/load restored root X -1.25, color #cc9966, elbow -95; preferences survive refresh; injected storage/preference denials visible |
| Portability | Versioned JSON scene/pose download/import with finite bounded schema validation and size limits | PASS: full scene roundtrip exactly equals stored document; pose JSON restored all 17 joints; version and non-finite imports visibly reject without mutation |
| Navigation | Orbit/pan/zoom, gizmos, shortcuts and discoverable help, usable narrow window | PASS: actual mouse gizmo drag changed root Y to 0.27976; orbit disabled during drag; Help workflow; 900 × 700 and 500 × 800 without horizontal overflow |
| Quality | Strict build, focused model tests and browser workflow, no uncaught application errors | PASS: 31/31 tests in three files; strict TypeScript + Vite build; fresh browser source-asset load without application errors |
| Privacy/license | No uploads/telemetry; licensed figures and original props; dependencies/license documented | PASS: original props, exact source CC0 + provenance/hashes, full deployed software notices; same-site static assets only |
| Deployment | Public repository under authenticated personal login; actual Pages HTTPS URL responds and renders | Interim release verified live; final sourced-figure deployment verification pending |

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
