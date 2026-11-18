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
| Distinct figures | Legally redistributable ready-made male/female rigged bodies, verified sources/licenses, semantic-joint mapping; multiple coexist | Asset acquisition in progress; procedural fallback implemented |
| Static posing | Select named joints, rotate FK, root W/E/R, presets, neutral reset, undo/redo | 21 automated cases overall; browser left elbow -95, opposite elbow 0, undo -65 / redo -95 |
| Props | Lamp, table, chair, desk, couch, bed, windowed room; transforms and colors | Pending |
| Lighting | Position, target, color and intensity change actual scene illumination | Pending |
| Camera | Independent position/aim/FOV/aspect, inspectable framed view, real toggleable depth of field | Pending |
| Export | PNG of composition camera, not editor overlays | Pending |
| Persistence | IndexedDB named scene/pose library, localStorage preferences; visible failures | Browser named scene/pose saved; refresh+load restored root X -1.25, color #cc9966, elbow -95 |
| Portability | Versioned JSON scene/pose download/import with finite bounded schema validation and size limits | Pending |
| Navigation | Orbit/pan/zoom, gizmos, shortcuts and discoverable help, usable narrow window | Pending |
| Quality | Strict build, focused model tests and browser workflow, no uncaught application errors | Strict build and 21/21 tests pass; browser workflow ongoing |
| Privacy/license | No uploads/telemetry; original procedural geometry; dependencies/license documented | Pending |
| Deployment | Public repository under authenticated personal login; actual Pages HTTPS URL responds and renders | Pending |

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
  Final URL is not yet a live-deployment completion claim.
