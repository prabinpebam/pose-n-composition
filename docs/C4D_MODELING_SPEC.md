# Cinema 4D Modeling Architecture & Interaction Specification

This specification defines the authoritative **Maxon Cinema 4D (2024/2025 Standard Layout)** workspace layout, hierarchical Object & Modifier architecture, step-by-step modeling taskflows, and module contracts connecting `src/modeling/*` and `src/importers/*` to the Pose & Composition viewport and UI.

---

## 1. Design Principles & Non-Negotiable Owner UI Rules

1. **Compact, Icon-Driven Professional Workspace (C4D 2024/2025)**:
   - Primary actions use **28–32 px square icon buttons** (`padding: 0`, crisp 16–18 px SVG glyphs) with **instant hover tooltips** showing `Tool Name + Shortcut Badge` (e.g. `Bevel / Fillet (B)`, `Make Editable (C)`).
   - Palette buttons that house sub-palettes display a subtle **3.5 px bottom-right corner flyout triangle (`▾`)**. Clicking the main icon triggers the default/last-used item immediately; **clicking the corner chevron or long-pressing (220 ms)** opens the compact icon grid flyout popover.
2. **100% Clawpilot Theme Token Compliance**:
   - Every surface, border, icon state, selection pill, active tool tint, and caddy overlay MUST use `var(--cp-*)` CSS custom properties (`--cp-bg`, `--cp-bg-elevated`, `--cp-surface`, `--cp-surface-soft`, `--cp-border`, `--cp-border-strong`, `--cp-text`, `--cp-text-muted`, `--cp-text-soft`, `--cp-accent`, `--cp-accent-hover`, `--cp-accent-soft`, `--cp-accent-fg`, `--cp-highlight`, `--cp-panel`, `--cp-panel-strong`, `--cp-danger`, `--cp-success`, `--cp-warning`).
   - **Zero hardcoded `#hex`, `rgb()`, or `hsl()` colors** in component styles.
3. **Zero One-Sided Accent Borders**:
   - **NEVER** use `border-left` / `border-top` / single-side stripes on Object Manager rows, active tabs, tool buttons, or callouts.
   - Indicate active/selected states using full-pill fills (`background: var(--cp-accent-soft)` with full `1px solid var(--cp-accent)` outline, or `background: var(--cp-accent); color: var(--cp-accent-fg)`), icon tinting, or subtle badges.
4. **Edge-Bleed Scroll Regions & Proper Padding Level**:
   - Never apply uniform wrapper padding around outer dock panels; apply horizontal padding 1–2 levels inside section bodies so **Object Manager and Attribute Manager scrollbars sit flush against the panel edge** and keyboard focus rings are never clipped.
5. **Toggle Clarity & Deduplicated Variants**:
   - Every toggle must pass the visual toggle test (segmented control, explicit `Switch`, iconic eye/checkmark/lock state icon with clear active/inactive glyph, or action-named button).
   - Reuse one unified numeric scrub/input row, one icon-button primitive, and one popover flyout pattern across all palettes and tabs.
   - Notifications (e.g. `"Imported 3 meshes from chair.obj"`, `"Converted Cube to Editable Polygon Object"`) **auto-dismiss by default** (3.5 s); reserve manual dismiss strictly for blocking errors.

---

## 2. Cinema 4D Workspace Zones

```text
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ TOP COMMAND PALETTE (36px compact bar: Undo/Redo │Transform│ Modes │ Generators/Scene )  │
├──────┬───────────────────────────────────────────────────────┬───────────────────────────┤
│ LEFT │                                                       │ RIGHT TOP:                │
│ MODE │                                                       │ C4D OBJECT MANAGER        │
│  &   │                 3D INTERACTIVE VIEWPORT               │ (Hierarchy, Boole Trees,  │
│ MODEL│                                                       │  Attached Modifiers,      │
│ TOOL │   • Quad Wireframe / Gouraud Shading HUD pill         │  ✓ Active · 👁 Vis · 🔒)  │
│ DOCK │   • Component Selection HUD (Pts / Edges / Polys)     ├───────────────────────────┤
│      │   • Floating Active-Tool Caddy (bottom-left viewport) │ RIGHT BOTTOM:             │
│ (40px│     [Offset] [Segments] [Profile] [Apply] [New Tfm]   │ C4D ATTRIBUTE MANAGER     │
│ wide │                                                       │ [Basic│Coord│Object│Tool] │
│ icon │                                                       │ Context-sensitive params  │
│ rail)│                                                       │ for Primitive/Mod/Tool    │
└──────┴───────────────────────────────────────────────────────┴───────────────────────────┘
```

### 2.1 Top Command Palette (Horizontal Icon Strip + Flyouts)
Compact 36 px header bar divided by subtle `1px` vertical dividers (`var(--cp-border)`):
- **Brand & File/Import Group**:
  - `Scene Menu ▾` (New, Save, Load, Export PNG/Scene JSON)
  - `Import 3D… (Ctrl+I)` — opens file picker accepting `.glb, .gltf, .obj, .mtl, .fbx, .stl, .ply, .dae, .3ds` (also supports drag-and-drop anywhere onto Viewport or Object Manager).
  - `Undo (Ctrl+Z)` / `Redo (Ctrl+Y)`
- **Create — Primitives & Generators Group (C4D Blue/Cyan & Green Icon Semantics via `var(--cp-*)`)**:
  - `Cube` *(default click adds Cube; corner `▾` opens **Primitives Flyout**: `Cube`, `Sphere`, `Cylinder`, `Cone`, `Pyramid`, `Torus`, `Capsule`, `Tube`, `Plane`, `Disc`, `Platonic`)*
  - `Boole` *(adds CSG Boole generator; `Alt + Click` wraps currently selected 1–2 objects automatically as Operand A & Operand B!)*
  - `Subdivision Surface` *(adds Catmull-Clark Subdivision modifier; `Alt + Click` or clicking with an object selected attaches it to the selected object)*
  - `Symmetry` *(attaches Mirror/Symmetry modifier)*
  - `Array / Cloner` *(attaches Linear/Radial Array modifier)*
  - `Modifiers / Deformers ▾` *(flyout: `Bevel (Fillet/Chamfer)`, `Subdivision Surface`, `Symmetry`, `Solidify (Thicken)`, `Bend`, `Twist`, `Taper`, `Array`)*
- **Scene Staging Group**:
  - `Characters ▾` (Mannequins & rigged characters)
  - `Props & Rooms ▾` (Furniture props & architectural rooms)
  - `Lights ▾` (`Spotlight`, `Parallel Light`, `Omni Light`)
  - `Camera View Toggle`
- **Shading & Conversion Group**:
  - `Make Editable (C)` — converts the selected Parametric Primitive, Boole Generator, or Imported 3D Mesh (including baking active modifiers if `Current State to Object` is chosen via `▾`) into a quad/n-gon `EditableMesh` ready for Point/Edge/Polygon modeling.
  - `Viewport Display ▾` (`Gouraud Shading`, `Gouraud Shading (Lines)` quad wireframe overlay, `Lines / Wireframe`, plus NPR render style selector).

### 2.2 Left Mode & Modeling Tool Dock (40 px Vertical Icon Strip)
Exact Cinema 4D left vertical palette:
1. **Interaction Mode Group (Mutually Exclusive Segmented Icons)**:
   - `Model / Object Mode (F1)` — object-level selection, hierarchy transform, character rig posing.
   - `Point Mode (F2)` — vertex selection & manipulation on `EditableMesh` items (renders vertex dots).
   - `Edge Mode (F3)` — topological quad/polygon edge selection & manipulation (renders true polygon edges, suppressing internal triangulation diagonals).
   - `Polygon Mode (F4)` — quad/n-gon face selection & manipulation (renders translucent face highlight tint).
   - *(Selecting Point, Edge, or Polygon Mode while a Parametric Primitive is selected shows a non-intrusive HUD prompt button: `"Parametric Primitive — Press C (Make Editable) to edit polygons"`).*
2. **Transform & Coordinate Group**:
   - `Live Selection / Box Select (9 / 0)`
   - `Move (W / E in C4D — keep W/E/R industry-standard with C4D tooltip note)`
   - `Rotate (E)`
   - `Scale (R)`
   - `Coordinate System Toggle` (`World` globe icon vs `Local / Selection Normal` axis icon — changes icon & tooltip clearly).
   - `Solo / X-Ray Wireframe Toggle`
3. **Polygon Modeling Operators Group (Context-Highlighted by Active Mode)**:
   - `Extrude (D)` — Polygon/Edge extrude (`extrudeFaces`).
   - `Inset / Extrude Inner (I)` — Polygon inset (`insetFaces`).
   - `Bevel / Chamfer / Fillet (B)` — Context-aware! Runs `bevelEdges` in Edge Mode, `bevelFaces` in Polygon Mode, `chamferVertices` in Point Mode.
   - `Loop / Path Cut (K)` — Interactive quad-ring slice preview & cut (`loopCut`).
   - `Bridge` — Connects two opposing face islands (`bridgeFaces`) or two open edge chains (`bridgeEdges`).
   - `Weld / Collapse` — Point weld (`weldVertices`) or Edge collapse (`collapseEdges`).
   - `Connect` — Splits shared faces between selected points (`connectVertices`) or bisects selected edges.
   - `Subdivide` — Faceted or Catmull-Clark smooth subdivision on selected/all faces (`subdivideFaces`).
   - `Dissolve / Delete (Backspace / Del)` — Cleanly dissolves interior edges/faces into quads/n-gons (`dissolveEdges`, `dissolveFaces`) vs hard `deleteFaces`.
   - `Normals / Holes ▾` — `Flip Normals`, `Align Normals Outside`, `Close Polygon Holes`.

### 2.3 Right Split Dock — Top: C4D Object Manager
Hierarchical tree view modeling Cinema 4D's Object Manager + Modifier Stack:
- **Row Anatomy (26 px compact height, full-outline selection pill, zero `border-left`)**:
  - `[Expand ▸]` `[Type Icon]` `[Editable Name]` ··· `[Phong/Mat Chip]` `[✓ Generator/Mod Toggle]` `[👁 Visibility]` `[🔒 Lock]`
- **Three Structural Relationships**:
  1. **Parametric / Editable / Imported / Character / Light / Room Row**: Top-level or grouped scene item. Expanding an item reveals its **Attached Modifiers Stack** directly underneath it (indented 16 px with a deformer glyph, evaluated top-to-bottom).
  2. **Attached Modifiers (`ModifierSpec[]`)**:
     - Drag-and-drop reorderable within an object's stack or onto another object.
     - Clicking a modifier row selects that modifier and opens its parameters immediately in the **Attribute Manager** below.
     - Toggling `[✓]` enables/disables that modifier non-destructively in real time (`modifier.enabled`).
  3. **`Boole` Generator Container**:
     - Displays `Boole (A − B)` (or `A ∪ B`, `A ∩ B`, multi-operand chain).
     - Expanding the `Boole` row reveals its ordered child operands (`[A] Cube`, `[B] Cylinder`).
     - **Reordering children swaps `A − B` vs `B − A` instantaneously**.
     - Selecting a child operand inside a `Boole` renders a translucent ghost wireframe of that operand in the viewport with full Move/Rotate/Scale gizmo control so the user can slide/rotate the cutter live inside the boolean!
     - `Boole` itself can also carry its own **Modifier Stack** (e.g., `Boole` → `Bevel` modifier to chamfer all boolean intersection seams, or `Symmetry`!).

### 2.4 Right Split Dock — Bottom: C4D Attribute Manager
Context-sensitive tabbed inspector displaying compact scrubbable numeric fields, segmented switches, and sliders:
- **`Basic` Tab**: Name, Layer/Color swatch, Visible, Locked, Cast Shadow, Phong Shading Angle (`phongAngleDeg`, default `40°`).
- **`Coord.` Tab**: Position `X / Y / Z` (m), Rotation `H / P / B` (°), Scale `X / Y / Z`, `Drop to Floor (Y=0)` action button, `Freeze / Reset Transform`.
- **`Object` Tab** *(changes dynamically based on selection)*:
  - **When a Parametric Primitive is selected**:
    - Dimensions & Segments (`Width/Height/Depth`, `Radius`, `Segments`, `Slice/Hemisphere`, etc.)
    - **Fillet / Chamfer Section** (on `Cube`, `Cylinder`, `Cone`, `Pyramid`, `Tube`, `Platonic`):
      - `Fillet` (`Switch`)
      - `Fillet Radius` (`number` scrub, clamped cleanly to max valid half-dimension)
      - `Fillet Subdivision` (`integer` scrub `1..16`): **`1` = crisp 45° Chamfer**, **`≥ 2` = smooth circular Fillet**!
  - **When a `Boole` Generator is selected**:
    - `Boolean Type` segmented control: `A union B (∪)`, `A subtract B (−)`, `A intersect B (∩)`.
    - `Hide New Edges / High Quality` toggle, quick `Swap A ↔ B` button, `Make Editable (C)` button.
  - **When a Modifier row is selected**:
    - Displays that modifier's exact parameters (`Bevel`: Width, Segments `1=Chamfer / ≥2=Fillet`, Angle Threshold; `Subdivision`: Viewport/Render Levels `1..3`; `Symmetry`: Plane `XY/YZ/XZ`, Axis `X/Y/Z`, Offset, Bisect, Weld Threshold; `Solidify`: Thickness, Even Thickness; `Bend`/`Twist`/`Taper`: Angle/Strength, Axis; `Array`: Linear/Radial, Count, Offset/Radius, Step Rotation).
  - **When a Character / Light / Room is selected**:
    - Preserves existing Pose, Body Proportions, Hair/Color, Light Cone/Intensity, and Room Cutaway controls cleanly inside compact tabs.
- **`Tool` Tab + Viewport Caddy** *(when in Point / Edge / Polygon Mode with an active Modeling Tool)*:
  - Displays live interactive parameters for the active operator (`Extrude`, `Inset`, `Bevel`, `Loop Cut`, etc.) synchronized with a compact floating **Viewport HUD Caddy** in the bottom-left corner of the canvas.

---

## 3. Exact Step-by-Step Modeling Taskflows

### Taskflow A: Parametric Primitive + Live Chamfer / Fillet
1. User clicks **`Cube`** (or selects `Cylinder`, `Pyramid`, `Tube`, etc. from `Primitives ▾`).
2. Primitive lands centered at `(0, height/2, 0)` resting on the ground plane (`y = 0`) and is selected in Object Manager.
3. In **Attribute Manager → Object**, user toggles **`Fillet = On`**.
   - Setting `Fillet Subdivision = 1` + `Fillet Radius = 0.08 m` produces an instant crisp **45° Chamfer** across all edges and corners.
   - Increasing `Fillet Subdivision = 4` turns the chamfer into a smooth **G1/G2-looking Rounded Fillet** while remaining 100% parametric (dimensions and segments can still be edited anytime).

### Taskflow B: Make Editable & Direct Quad Surface / Edge Manipulation (C4D Interactive Drag + Caddy)
1. With any Primitive, Boole, or Imported Mesh selected, user presses **`C`** (or clicks `Make Editable`).
2. Object converts to an `EditableMesh` item preserving true **quads** (no unwanted diagonal triangulation lines).
3. User switches to **Edge Mode (`F3`)**:
   - **Click** selects an edge; **`Shift + Click`** toggles/adds edges; **`Alt + Double-Click`** (or `Select Loop` button in Tool tab) runs `selectEdgeLoop` around the quad loop; **`Select Ring`** runs `selectEdgeRing`.
4. User presses **`B`** (**Bevel Tool**):
   - **Viewport Drag**: Dragging horizontally in empty viewport space adjusts `Width` live from a pre-drag snapshot of the mesh; **`Shift + Wheel`** (or dragging the `Segments` scrub in the bottom-left Viewport Caddy) increments `Segments` (`1` = Chamfer, `2..8` = Smooth Fillet).
   - **Post-Drag Live Tweak (Exact C4D Behavior)**: Releasing the mouse commits the bevel preview into an active operator session — tweaking `Width`, `Segments`, or `Profile` in the Caddy re-evaluates cleanly from the pre-op mesh snapshot without stacking duplicate bevels! Clicking **`New Transform`** or changing selection commits and starts fresh, with each committed step recorded as a single Undo entry.
5. User switches to **Polygon Mode (`F4`)**:
   - Selects top face(s), presses **`I`** (**Inset / Extrude Inner**), drags inward (`inset = 0.12 m`).
   - Presses **`D`** (**Extrude**), drags downward (`offset = -0.15 m`) to recess a panel, or outward (`+0.25 m`) to raise a tower.
6. User presses **`K`** (**Loop Cut**):
   - Hovering over any mesh edge projects a live highlighted **preview quad loop** around the ring at mouse position `factor ∈ [0, 1]`.
   - Clicking slices the quad ring via `loopCut(mesh, edgeIndex, { factor, cuts })` and selects the newly inserted edge loop for immediate scaling/sliding.

### Taskflow C: Live Non-Destructive CSG Boolean (`Boole`)
1. User creates a `Cube` (with Fillet) and a `Cylinder` intersecting it.
2. **Fast C4D Workflow**: Select both (`Cube` first, `Cylinder` second), hold **`Alt`** and click **`Boole`** in the Top Command Palette (or click `Boole` and drag `Cube` and `Cylinder` into it in the Object Manager).
3. `Boole` defaults to **`A subtract B`** (`Cube − Cylinder`), carving a clean cylindrical hole in real time via `three-bvh-csg`.
4. Clicking `[B] Cylinder` inside the Object Manager shows the cylinder's ghost wireframe + Move/Rotate/Scale gizmo; dragging the gizmo slides the carved hole across the cube at 60 fps!
5. Attaching a **`Bevel`** or **`Symmetry`** modifier onto the `Boole` row applies procedural beveling or mirroring to the boolean result. Pressing **`C`** on `Boole` bakes the CSG result into a clean `EditableMesh` (`bufferGeometryToEditableMesh` merges coplanar split triangles back into clean polygons).

### Taskflow D: Non-Destructive Modifier / Deformer Stack
1. User selects any object and chooses **`Subdivision Surface`**, **`Symmetry`**, **`Bend`**, **`Twist`**, **`Taper`**, **`Solidify`**, or **`Array`** from the Top Command Palette.
2. Modifier attaches under the object in the Object Manager.
3. User can reorder modifiers (e.g., `Symmetry` → `Subdivision Surface` welds the mirror seam *before* Catmull-Clark smoothing, producing a seamless organic mesh!), toggle `[✓]` to compare before/after, or delete any modifier at any time without losing base topology.

### Taskflow E: Multi-Format 3D Asset Import & Editing
1. User drags `.glb`, `.gltf`, `.obj` (+ `.mtl` + texture PNG/JPGs), `.fbx`, `.stl`, `.ply`, `.dae`, or `.3ds` onto the viewport (or clicks `Import 3D`).
2. `import3dFiles(files)` parses the format, auto-normalizes extreme CAD/FBX millimeter/centimeter unit scales into stage meters, centers X/Z pivot, grounds `minY = 0`, ensures valid vertex normals, and serializes a self-contained `.glb` binary asset into IndexedDB so autosave/reload works offline with zero broken file references.
3. Imported objects work immediately as `Boole` operands, accept any **Modifier Stack**, and support **`Make Editable (C)`** (`extractEditableMeshFromObject3D`) for direct polygon/edge/point modeling.

---

## 4. Module Integration Map (Ready for `model.ts` / `engine.ts` / `App.tsx` Wiring)

| Module | Primary Exports | Integration Responsibility |
| --- | --- | --- |
| `src/modeling/types.ts` | `PrimitiveKind`, `PrimitiveParamsMap`, `EditableMeshData`, `ComponentSelection`, `ModifierSpec`, `BooleanOpType`, `ModelingNodeSpec` | Extend `Item` in `src/model.ts` with optional `primitive`, `editableMesh`, `modifiers`, `booleanOp` + `children`, `importedAssetId`, `phongAngleDeg`. |
| `src/modeling/primitives.ts` | `PRIMITIVE_DEFAULTS`, `createPrimitiveEditableMesh`, `createPrimitiveGeometry` | Spawn any of the 11 C4D primitives with quad topology + live chamfer/fillet. |
| `src/modeling/editableMesh.ts` | `editableMeshToBufferGeometry`, `createQuadWireframeGeometry`, `bufferGeometryToEditableMesh`, selection & 20+ modeling ops | Power Point/Edge/Polygon viewport overlays, raycast picking, gizmo frames, and interactive modeling operators. |
| `src/modeling/modifiers.ts` | `DEFAULT_MODIFIER_PARAMS`, `applyModifier`, `applyModifierStack` | Evaluate non-destructive C4D modifier stacks on `EditableMeshData` or `BufferGeometry`. |
| `src/modeling/booleans.ts` | `evaluateBoolean`, `evaluateBooleanChain` | Execute `three-bvh-csg` Union / Subtract / Intersect with attribute normalization & `EditableMesh` conversion. |
| `src/modeling/evaluator.ts` | `evaluateModelingNode`, `makeNodeEditable` | Single entry point for `engine.ts` to build renderable `BufferGeometry` + quad wireframe `BufferGeometry` for any primitive/editable/boolean/imported node + modifier stack. |
| `src/importers/import3d.ts` | `SUPPORTED_3D_EXTENSIONS`, `import3dFiles`, `serializeImportedObjectToGlb`, `deserializeImportedObjectFromGlb`, `extractEditableMeshFromObject3D` | Handle file picker / drag-and-drop 3D imports, unit normalization, IndexedDB `.glb` persistence, and `Make Editable` conversion. |
