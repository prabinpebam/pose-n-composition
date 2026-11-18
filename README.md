# Pose & Composition

An original, browser-only figure posing and composition studio. Build a static
reference scene with rigged male/female artist mannequins, furniture, lights and
an independent composition camera. No accounts, backend, uploads or telemetry.

## Run

Node 22.12+ (or a current supported Node LTS) and npm:

```powershell
npm ci --registry=https://packagefeedproxy.microsoft.io/npm/
npm run dev
npm test
npm run build
npm run preview
```

The project registry is deliberately pinned to the approved Microsoft public
package proxy. Do not substitute public registries on feed failure. A lockfile
pins exact installed versions. Development listens on loopback only. In this
workspace an old globally redirected npm 9 failed dependency resolution; invoking
the npm 11 CLI bundled alongside Node resolved it without global configuration changes.

## Two workflows

**Pose:** Add/select Male or Female → choose a preset → select a gold joint or
choose **Editing** → drag local rotation rings or enter XYZ degrees → save pose
locally / download pose JSON. **Neutral / reset** resets joints, not the root.
Seated/kneeling presets intentionally preserve root height: lower the figure to
the floor or furniture using Root Position Y.

**Compose:** Arrange multiple figures and props → edit studio-light position,
target, surface color and intensity → open **Camera** → set position, aim, lens,
aspect and focus → **Camera view** → **Export PNG** / save scene.
The floor is a fixed neutral stage; background color changes the space above it.
Lamp is a furnishing; add a separate Studio light for illumination.

### Controls

| Action | Control |
|---|---|
| Orbit / pan / zoom | Left drag / right drag / wheel |
| Whole-object move / rotate / scale | Labeled toolbar or W / E / R |
| Joint rotate | Gold marker or Editing dropdown; local rotation rings |
| Frame selected / camera view | Frame or F / Camera view or C |
| Return to root / dismiss help | Escape |
| Undo / redo | Buttons or Ctrl/Cmd Z / Ctrl/Cmd Shift Z |
| Delete selected / help | Delete / ? |

Dragging a gizmo disables orbit until release. Named joint editing affects only
that bone and its descendants. Left/right are the figure's anatomical sides.
Helper visibility is a localStorage preference. Small windows place the inspector
below the viewport; desktop is the primary workflow.

## Persistence and portable files

- **Save scene** stores all object transforms, joint-local rotations, colors,
  props, lights, background and composition-camera settings in IndexedDB.
- **Save pose** stores every semantic joint, body provenance and rig version;
  root placement is deliberately excluded. Both bodies share rig v1, so poses
  can be applied across them without retargeting.
- Named saves appear under **Save / Load** after a browser refresh. The initial
  stage is fresh on refresh; click a named save to restore it. Same type/name
  overwrites that library entry. Clearing browser data deletes local saves.
- Download JSON for durable backups. Import validates the complete file before
  changing anything. Scene import replaces the scene and is undoable.
- Files use `schemaVersion: 1`, `rigVersion: 1`, `type: "scene" | "pose"`.
  Imports require bounded finite values, every known joint, unique object IDs,
  valid colors and clipping planes. Limits: **1 MB, 64 objects, 8 studio lights**.
- IndexedDB transaction completion is required before reporting success.
  Quota, blocked database, import and preference errors are visible.
- Storage keys are app-prefixed because GitHub Pages repositories on the same
  owner domain share an origin. Browser storage is not a guaranteed backup.

## Camera and rendering

Editor orbit never modifies the saved composition camera. **Use editor angle**
explicitly copies its position/aim. Lens is canonical millimeters; the perspective
camera uses Three.js `filmGauge = 36`, zoom 1, horizontal fit in landscape and
vertical fit in portrait. Aspect changes reapply focal length. At 3:2, 50 mm has
approximately 26.99147° vertical FOV.

Depth of field is a real depth-texture **Three.js BokehPass**, enabled only for
camera view and PNG. Focus is axial camera-space distance in meters; aperture is
the shader's artistic blur-strength parameter, **not an f-stop**. Disabling DOF
bypasses the composer entirely (no depth or postprocess rendering passes).
Camera preview and 1600 px-wide PNG share the same camera, lens, aspect and DOF.
PNG hides joints, light icons, gizmos and grid.

## Architecture and rationale

- React + strict TypeScript for inspectable UI and typed, validated data.
- Vite with a **relative base** for static subpath deployment.
- Direct Three.js WebGLRenderer, OrbitControls and TransformControls: a small
  dependency surface with explicit camera/drag/resource ownership. R3F/Drei are
  credible alternatives; not needed to wrap this small imperative renderer.
- Procedural originals: a real 17-bone `Skeleton` and `SkinnedMesh`, continuous
  weighted torso/limbs with blended elbow/knee neighborhoods. Distinct torso,
  shoulder and hip proportions, rather than a renamed shared dummy.
- Native IndexedDB and localStorage avoid a backend and persistence dependencies.
- Three's installed BokehPass implementation/types—not unrelated wrapper docs—
  define the DOF contract. See [research](docs/RESEARCH.md).

## Scope and limitations

Static FK posing only: no IK, joint constraints, animation, finger articulation,
rig authoring or imported models. Mannequins are stylized reference bodies, not
medical anatomy. Extreme rotations can self-intersect; shoulder/hand/foot joins
are simplified mannequin anatomy. Furniture and windowed walls are original,
simple procedural references, not architectural CAD. No collision/ground snap.
The window openings are real geometry gaps; no external textures.

WebGL2 is required by the current Three.js renderer; software GPU rendering can
be slower. Raster bokeh is not a physically exact lens simulation and may show
edge halos. Ambient/fill illumination is fixed; added studio spots are editable.
Undo keeps up to 100 scene snapshots in memory; history does not survive reload.
PNG output is 1600 px wide, with height derived from aspect, not print-resolution
rendering. Lights always aim at their target; root Euler rotation is not light aim.

## Verification and deployment

`npm test` covers portable scene/pose round trips, rejected malformed/unbounded
files, presets, actual skeleton hierarchy and isolation, skin-root movement,
distinct body proportions and camera projection. The
[Definition of Done](docs/DEFINITION_OF_DONE.md) records browser and live evidence.

GitHub Actions runs tests and a strict build, uploads `dist`, and deploys to
GitHub Pages. Enable Pages with source **GitHub Actions**. The project makes no
runtime network requests except its own static assets.

## License and privacy

Original code and procedural assets are MIT licensed. No code, models, textures,
branding or interface from PoseMy.Art was copied; its public capabilities were
used only as functional reference. Dependency notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
All authored scene/pose content stays on your device unless you choose to share
downloaded files. GitHub Pages hosting itself has GitHub's normal request logging.
