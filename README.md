# Pose & Composition

An original, browser-only figure posing and composition studio. Build a static
reference scene with ready-made rigged male/female bodies, furniture, lights and
an independent composition camera. No accounts, backend, uploads or telemetry.

[Open the app](https://prabinpebam.github.io/pose-n-composition/) ·
[Source](https://github.com/prabinpebam/pose-n-composition) ·
[Research](docs/RESEARCH.md) · [Acceptance evidence](docs/DEFINITION_OF_DONE.md)

The figures are **CC0 1.0 artist-sculpted MakeHuman / MPFB2 `hm08` anatomical mannequins** (`Mannequin_Female.glb` at `1.75 m` and `Mannequin_Male.glb` at `1.80 m`, plus 18 pre-baked proportion archetypes including a `1.05 m` 2.5-head **Anime Chibi**), paired with **CC0 Quaternius sculpted hairstyles** and **CC0 Quaternius Universal Animation Library** motion cycles. See [asset provenance and license](docs/ASSETS.md). First load downloads about 18 MB of same-site model/morph/texture assets; load errors are visible and retryable.

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

**Pose:** Click a figure in the viewport (or its Outliner row), then click any gold
joint node on its body. The node turns coral and the local rotation rings attach
there. Drag a colored ring to rotate that bone and its skin. You can also pick a
joint from the grouped **Editing target** popover, apply any of the **10 auto-grounded
studio presets** (`Neutral`, `Relaxed`, `Contrapposto`, `Heroic`, `Walking`,
`Running`, `Seated`, `Kneeling`, `Crouch`, `Reach`), or use **Pose from animation**:
choose any of the **12 built-in CC0 motion cycles** (or import a Mixamo `.fbx` /
`.glb` / `.gltf` animation locally in your browser), scrub the **Frame timeline**
slider with live character preview, and click **Use this pose** to commit that
exact frame into all 17 editable FK joints with single-step Undo/Redo. Use
**Export pose JSON** and **Import pose JSON** directly in **Joint & preset posing**
to download or apply portable `.pose.json` files across male and female figures.

**Compose:** Arrange multiple figures and props → edit studio-light position,
target, surface color and intensity → open **Camera** (or switch to **Camera**
view and orbit/pan/zoom directly in the viewport to frame the shot) → tune lens,
aspect and focus → **Export PNG** / save scene in **Library**.
The floor is a fixed neutral stage; background color changes the space above it.
Lamp is a furnishing; add a separate Studio light for illumination.

**Render styles:** The viewport's top-right switcher (shortcuts **1–5**) offers
Realistic PBR, cel-shaded Illustration with geometric ink contours, pure Outline,
matte Clay and unlit Flat color. **Camera → Render style** adjusts ink color,
thickness, interior detail, two/three-tone shadows, paper and clay finish.
Outline's **Transparent PNG** exports a 1600 px RGBA ink layer, including with DOF.
Render settings travel with scenes, autosave and Undo/Redo; legacy scenes use Realistic.

**Selection & pose transfer:** Shift-click viewport objects or Outliner rows to
toggle a group. Ctrl/Cmd-drag a viewport marquee (also in Camera view); add Shift
to extend selection. Move/Rotate operate about the selected position centroid.
**Flip X/Y/Z** reflects a selected object or the entire group about that centroid.
**Copy Pose / Paste Pose** transfers all 17 joints between figures in this session;
**Advanced Copy · Skeleton Tree** copies checked joints only, preserving every
other target joint. These edits are single-step undoable and immediately autosaved.

**Appearance, Swap & Scene Workflow:** Select any figure to swap **Base figure** (`Female` | `Male`) or **Body proportion** (`Realistic`, `Heroic`, `Lean`, `Slender`, `Busty`, `Chubby`, `Fat`, `Obese`, or 2.5-head `Chibi`) **in-place** while preserving world X/Z placement and support contact height (`minWorldY`, keeping floor-grounded characters planted at `y = 0` and elevated/seated characters at their support height). Selecting or adding **Chibi** automatically switches the viewport from `Realistic` to anime cel-shaded `Illustration` mode. Customize **Skin color** and **Outfit / dress color** independently via unpremultiplied RGBA `DataTexture`s (`RGB` cavity-AO grayscale + `Alpha` tailored two-piece / compression-trunk outfit mask), switch **Hairstyle** (`Side parted`, `Long waves`, `Twin buns`, `Short crop`, `Parted + beard`, or `None (bald)`) dynamically fitted to each morphed skull envelope, and use **Hair & brow color** to tint scalp locks and sculpted 3D eyebrows while keeping upper-eyelash canopies crisp charcoal. Use **New scene** in either the top **App Bar** or the **Library** tab to reset to a clean studio stage with single-step **Undo** restoration. Toggle **Light / Dark** studio themes anytime from the top bar.

### Controls

| Action | Control |
|---|---|
| Orbit / pan / zoom | Left drag / right drag / wheel |
| Whole-object move / rotate / scale | Labeled toolbar or W / E / R |
| Joint rotate | Click a gold node, then drag a colored ring; Editing is optional |
| Frame selected / camera view | Frame or F / Camera view or C |
| Return to root / dismiss help | Escape |
| Undo / redo | Buttons or Ctrl/Cmd Z / Ctrl/Cmd Shift Z |
| Delete selected / help | Delete / ? |

Dragging a gizmo disables orbit until release. Named joint editing affects only
that bone and its descendants. Left/right are the figure's anatomical sides.
Gold nodes have constant screen size with a 10 px picking radius and take
priority over skin and overlapping gizmos. Hover highlights a node white;
selection is coral. Drag away from nodes and rings to orbit.
Helper visibility is a localStorage preference. Small windows place the inspector
below the viewport; desktop is the primary workflow.

### Gesture regression check

`npm test` includes overlay picking, hidden/clipped targets and constant-size
marker regressions. [scripts/posing-smoke.mjs](scripts/posing-smoke.mjs) additionally
exports `runPosingSmoke(page, options)` for an existing Playwright host; it is not
part of the Node-only unit suite and adds no dependency.
Use a fresh isolated page, wait for assets, then run it against localhost or the
live app. It clicks the rendered nodes and drags rendered rotation rings for
eight joints on both figures, checks actual skinned vertices, correct attachment,
hair following head/neck, camera/root/opposite-limb/other-figure isolation, and
one-step undo/redo. Optional `screenshotDirectory`, `bodies` and `joints` select
evidence capture or repeated/duplicate-figure cases. Instrumentation observes
the React-held engine only; it never sets poses or invokes engine editing methods.
Do not run it in an owner's working tab.

[scripts/batch2a-smoke.mjs](scripts/batch2a-smoke.mjs) exports
`runBatch2ASmoke(page)` for a two-figure scene. It verifies Outliner/viewport
Shift-click, Ctrl-drag in both views, real group Move/Rotate handle drags,
three-axis group flips, atomic Undo/Redo, full pose transfer and left-arm-plus-head
partial transfer with all other joints unchanged.

## Persistence and portable files

- **Immediate IndexedDB working-draft autosave:** Every manual viewport edit
  (joint rotation ring drag, root move/rotate/scale gizmo, object add/duplicate/delete,
  editor orbit/pan/zoom viewpoint, active selection), preset/animation pose extraction,
  Undo/Redo, and inspector change (hairstyle, hair/surface color, lighting, backdrop,
  composition camera & DOF) is saved automatically to a dedicated internal record in
  IndexedDB and restored seamlessly on browser reload.
- **Reset:** Top-bar **Reset** returns the stage and editor orbit camera to the
  default two-figure studio scene, updates the autosaved draft, and remains
  one-step undoable (`Ctrl/Cmd Z`).
- **Save scene** stores named snapshots of all object transforms, joint-local
  rotations, colors, props, lights, background and composition-camera settings in
  IndexedDB independently of the live working draft.
- **Save pose** stores every semantic joint, body provenance and rig version;
  root placement is deliberately excluded. Both bodies share rig v1, so poses
  can be applied across them without retargeting.
- Named saves appear under **Library** after a browser refresh without being
  polluted by working-draft autosaves; click a named save to load it. Same
  type/name overwrites that library entry. Clearing browser data deletes local saves.
- Download JSON for durable backups. Import validates the complete file before
  changing anything. Scene import replaces the scene and is undoable.
- Files use `schemaVersion: 1`, `rigVersion: 1`, `type: "scene" | "pose"`.
  Imports require bounded finite values, every known joint, unique object IDs,
  valid colors and clipping planes. Limits: **1 MB, 64 objects, 8 studio lights**.
- Figure scene items include `hairColor: "#rrggbb"` and `outfitColor: "#rrggbb"`.
  These additive v1 fields are optional in older files/saves: absent `hairColor`
  loads as dark brown (`#3b2720`) and absent `outfitColor` loads per-body defaults
  (`#2f435e` male, `#8f304d` female); malformed present values reject the whole
  import. Existing records are not rewritten or cleared. Pose files (`.pose.json`)
  deliberately exclude all appearance (`color`, `outfitColor`, `hairColor`, `hairStyle`).
- IndexedDB transaction completion is required before reporting success.
  Quota, blocked database, import and preference errors are visible.
- Storage keys are app-prefixed because GitHub Pages repositories on the same
  owner domain share an origin. Browser storage is not a guaranteed backup.

### Rig v1 compatibility

Pose angles are **semantic neutral-relative XYZ radians in the character's
anatomical frame**, not native glTF bone Euler rotations. The adapter preserves
the source's nonidentity bind quaternions and uses a per-body neutral/basis
transform. Left/right are anatomical; +X is left, +Y up, +Z forward. Neutral
lowers the source T-pose arms into a relaxed standing reference.

Existing v1 local scenes/poses created with the earlier procedural bodies retain
their semantic angles, root transforms and colors on the source rigs. The body
surface/proportions differ; world-space joint positions are not promised equal
across bodies. No IndexedDB or preference data is cleared or rewritten by this
model change. Unit/height normalization lives inside the figure wrapper (male
1.85 m, female 1.75 m); the user's root scale remains 1.

### Body proportions and extreme poses

Choose **New figure proportion** before adding Male/Female, or change **Body
proportion** on any existing character: **Realistic, Heroic, Lean, Slender, Busty,
Chubby, Fat, Obese, Chibi**. Changes preserve pose/colors, scale the eyes and
swappable scalp hair with the skull, re-ground the deformed body, and support
single-step Undo/Redo plus immediate autosave.

The pose-change-only CPU pipeline combines coupled clavicle/spine/toe helpers,
continuous axial twist with hybrid dual-quaternion skinning and welded Delta
Mush, then muscle bulges, crease-bisector contact and body-scaled capsule pushout.
The same deformed vertices/normals drive PBR, NPR ink, shadows, DOF, picking and
floor grounding; unchanged poses do not rerun deformation. **Anatomical joint
limits** defaults on; turn it off for unconstrained rotations.

Scene v1 adds optional `bodyType` (legacy default `heroic`) and
`anatomicalLimits` (legacy default `true`). Invalid present options reject.
Pose JSON remains strictly joints-only: proportions, limits and all appearance
stay with the target character. No storage reset or schema-version bump.

## Camera and rendering

Editor orbit never modifies the saved composition camera. Switching to **Camera**
view lets you orbit, pan, and wheel-zoom the composition camera directly in the
viewport (recording one Undo/Redo step per gesture and autosaving immediately to
IndexedDB) while leaving the Editor camera untouched. **Use editor angle**
explicitly copies the Editor camera's position/aim into the composition camera. Lens is canonical millimeters; the perspective
camera uses Three.js `filmGauge = 36`, zoom 1, horizontal fit in landscape and
vertical fit in portrait. Aspect changes reapply focal length. At 3:2, 50 mm has
approximately 26.99147° vertical FOV.

Depth of field is a real depth-texture **Three.js BokehPass**, enabled only for
camera view and PNG. Focus is axial camera-space distance in meters; aperture is
the shader's artistic blur-strength parameter, **not an f-stop**. Disabling DOF
bypasses the blur pass; Illustration/Outline and optional Clay ink still use
their geometric contour pass before output color conversion.
Camera preview and 1600 px-wide PNG share the same camera, lens, aspect and DOF.
PNG hides joints, light icons, gizmos and grid.

## Architecture and rationale

- React + strict TypeScript for inspectable UI and typed, validated data.
- Vite with a **relative base** for static subpath deployment.
- Direct Three.js WebGLRenderer, OrbitControls and TransformControls: a small
  dependency surface with explicit camera/drag/resource ownership. R3F/Drei are
  credible alternatives; not needed to wrap this small imperative renderer.
- Ready-made original-source Quaternius male/female meshes: 65 bones and three
  skinned meshes each; 17 meaningful joint controls keep posing simple. Actual
  source rest orientations are preserved. Skeleton-aware clones have independent
  bones, geometry and materials, so posing/recoloring one never mutates another.
- Furnishings are original procedural geometry. A legacy procedural figure
  generator remains only as a regression fixture; it is not the live model
  source or a silent fallback on asset errors.
- Native IndexedDB and localStorage avoid a backend and persistence dependencies.
- Three's installed BokehPass implementation/types—not unrelated wrapper docs—
  define the DOF contract. See [research](docs/RESEARCH.md).

## Scope and limitations

Static FK posing with optional anatomical bounds and animation-frame extraction:
no IK, finger articulation, rig authoring or user model import. Figures are stylized
reference bodies, not medical anatomy. Analytical contact reduces extreme-pose
pinching/intersection, but is not a full cloth/soft-body or inter-character collision
simulation; impossible free rotations can still intersect. Skin and outfit albedo maps are
luminance-normalized at runtime so chosen colors render without baked orange/grey
tint bias while preserving anatomical shading and seams under studio lighting. Furniture and windowed walls are original,
simple procedural references, not architectural CAD. Presets, proportion changes
and **Snap to floor** ground the actual deformed mesh; there is no furniture collision.
The window openings are real geometry gaps; no external textures.

WebGL2 is required by the current Three.js renderer; software GPU rendering can
be slower. Raster bokeh is not a physically exact lens simulation and may show
edge halos. Ambient/fill illumination is fixed; added studio spots are editable.
Undo keeps up to 100 scene snapshots in memory; history does not survive reload.
PNG output is 1600 px wide, with height derived from aspect, not print-resolution
rendering. Lights always aim at their target; root Euler rotation is not light aim.

## Verification and deployment

`npm test` covers portable scene/pose round trips, rejected malformed/unbounded
files, presets, actual source skeletons/rest math and isolation, all three skins'
root movement, reached-wrist picking, prop/window geometry and camera projection. The
[Definition of Done](docs/DEFINITION_OF_DONE.md) records browser and live evidence.

GitHub Actions runs tests and a strict build, uploads `dist`, and deploys to
GitHub Pages. Enable Pages with source **GitHub Actions**. The project makes no
runtime network requests except its own static assets.

## License and privacy

Original code, generated scalp hair and procedural furnishings are MIT licensed. Quaternius figure
assets retain their included CC0 license and are credited in [ASSETS.md](docs/ASSETS.md).
No code, models, textures, branding or interface from PoseMy.Art was copied; its
public capabilities were used only as functional reference. Dependency notices are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the
[deployed full license notices](https://prabinpebam.github.io/pose-n-composition/THIRD_PARTY_NOTICES.txt),
also linked from the viewport footer.
All authored scene/pose content stays on your device unless you choose to share
downloaded files. GitHub Pages hosting itself has GitHub's normal request logging.
