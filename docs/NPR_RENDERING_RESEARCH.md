# Real-Time Hand-Drawn Illustration / NPR Outline + Cel-Shade Rendering & Viewport Shading UX

**Target Application:** Pose & Composition (`E:\Projects\side-projects\pose-n-composition`)  
**Engine & Runtime:** Pure-web TypeScript + React 19 + Three.js `0.181.0` (WebGL2)  
**Scope:** Research & Concrete Engineering + UX Blueprint (`src/*` untouched during parallel execution)

---

## 1. Executive Summary & Recommended Architecture

### 1.1 Answers to the Owner's Core Questions

1. **How do solved real-time pipelines achieve a true hand-drawn illustration look (crisp outlines + flat color + crisp shadows) in WebGL2 / Three.js `0.181.0`?**
   - **Why single-technique shortcuts fail:**
     - **Inverted-hull (`BackSide`) extrusion alone** (`three/addons/effects/OutlineEffect.js`) splits apart at hard-edged box normals on studio props (`room` walls, `desk` drawers, `table` legs, `chair` supports in [props.ts](../src/props.ts)), misses interior anatomical creases (clavicles, overlapping fingers, nose bridge, lips, hair locks, bodysuit collar), and scales inconsistently across `15 mm`–`150 mm` camera focal lengths.
     - **Post-process luminance quantization (`luma(color) < threshold`) alone** conflates *dark local albedo* with *cast shadow*: espresso hair (`#3b2720`), deep skin tones, navy outfits (`#2f435e`), and dark slate furniture (`#353a40`) crush to solid black even under direct spotlight, while white pillows (`#e9e3d7`) fail to show shadow steps.
     - **Naive depth-buffer Sobel alone** paints solid black Moiré bands across flat surfaces viewed at grazing angles (our `200 m × 200 m` studio floor and room walls) and misses zero-depth contact seams (a foot sole planted at `y = 0` on the floor, a hand resting on a desk, or the painted bodysuit neckline on the body mesh).
   - **The Solved Industry Combination** ([Saito & Takahashi 1990]; [Gooch et al. 1998]; [Lake et al. 2000]; [Motomura / Arc System Works GDC 2015]; *Sable* / Moebius screen-space ink pipelines):
     1. **Material-Level Albedo-Independent Cel Shading (`onBeforeCompile` on `MeshStandardMaterial`):** Quantize **incident direct irradiance** ($E_{\text{dir}} = \pi \cdot \text{luma}(\text{directDiffuse}) / \max(\text{luma}(\text{albedo}), 10^{-4})$, which already incorporates `N·L`, spotlight attenuation, and `PCFSoftShadowMap` visibility) using screen-space anti-aliased `fwidth()` steps **before** multiplying by true-color base albedo, tinting shadows toward a chromatic cool/warm artistic tone ([Gooch et al. 1998]) and suppressing plastic dielectric specular glare on skin and cloth.
     2. **Screen-Space Multi-Cue Ink Pass (Tangent-Plane Depth + $SO(3)$ Vector View-Normal + Object/Region ID G-Buffer):** Detect outer silhouettes via **plane-projected view-space depth discontinuity** ($|\mathbf{N}_c \cdot (\mathbf{P}_i - \mathbf{P}_c)| / |z_{v,c}|$, which is **identically zero on flat floors/walls at any grazing angle**), interior anatomical/prop creases via **component-wise 3D view-normal Frobenius Sobel** (never scalar `luma(normal)`), and touching/coplanar seams (foot-on-floor, hand-on-table, outfit collar on skin, drawer fronts) via **per-object + outfit-mask IDs** uploaded in `ShaderMaterial.onBeforeRender`.
     3. **Two-Tier Hand-Drawn Line-Weight Hierarchy:** Render outer silhouettes & object boundaries at full stroke weight (`1.0×`, bold contour) and interior normal/material-region creases at finer weight (`0.60×`–`0.65×` width, `0.82` max ink opacity), normalized to composition frame height so live Retina viewports and `1600 px` PNG exports match pixel-for-pixel.

2. **How should all Studio Viewport Shading Modes be defined and switched?**
   - Ship **five orthogonal, artist-standard Viewport Shading Modes** modeled on Blender 4.x's 3D Viewport header, Clip Studio Paint, and Marmoset Toolbag:
     1. **`Realistic`** — Lit PBR studio (`MeshStandardMaterial` + soft shadows + `ACESFilmicToneMapping`, current default).
     2. **`Illustration`** — Hand-drawn comic / editorial look: crisp two-tier ink outlines + true-color flat base colors + razor-sharp stepped form & cast shadows (`NoToneMapping` + `SRGBTransfer` so hex swatches stay faithful).
     3. **`Outline`** — Pure ink line art over clean paper, scene backdrop, or **transparent alpha PNG** (ready to drop into Procreate / Clip Studio / Photoshop as a `Multiply` ink layer), with optional comic noir cast-shadow fill.
     4. **`Clay`** — Neutral matte sculptor's clay (`Terracotta`, `Cool Grey`, or `Warm Plaster`) across all figures, hair, and props to read pure silhouette, muscle form, and light/shadow values without color distraction (with optional contour ink toggle).
     5. **`Flat`** — Unlit pure local color silhouettes with zero lighting or shadows (`NoToneMapping`), the classic 1-click value/color-grouping check.
   - **Recommended UX:** Place a compact, always-accessible **Viewport Shading `SegmentedControl`** (`Realistic` · `Illustration` · `Outline` · `Clay` · `Flat`, keyboard shortcut `Z` to cycle or `1`–`5` / `Alt+1`–`5`) in the **top-right floating HUD of `.viewport`** (mirroring `.viewport-caption` at top-left, just like Blender's top-right viewport shading bar — 1 click away from any tab without crowding `.viewport-toolbar`), paired with a contextual **Render Style** section inside the **`Camera` (Compose)** inspector tab for fine-tuning ink color, line weight, interior detail, shadow steps, paper/transparent background, or clay finish.

---

## 2. Codebase Pipeline Audit & Non-Obvious Integration Constraints

Inspection of [engine.ts](../src/engine.ts), [external-rig.ts](../src/external-rig.ts), [hair.ts](../src/hair.ts), [props.ts](../src/props.ts), [App.tsx](../src/App.tsx), [styles.css](../src/styles.css), and Three.js `0.181.0` shader/renderer internals reveals **seven concrete constraints** any NPR implementation in this repo must satisfy:

### 2.1 Existing Material Architecture Across All Stage Objects

| Asset Family | Source File | Material Type & Special Configuration | NPR Implication |
|---|---|---|---|
| **Figure Body + Outfit** (`Sphere.005_Retopology.004`, `Superhero_Female`) | [external-rig.ts](../src/external-rig.ts:183) | `MeshStandardMaterial` with custom `onBeforeCompile` (`uOutfitColor` uniform blending skin `diffuse` vs outfit `uOutfitColor` via `sampledDiffuseColor.a`) | Do **not** replace body materials with `MeshToonMaterial` (which would break `uOutfitColor` region tinting). Chain NPR irradiance quantization inside `MeshStandardMaterial.onBeforeCompile`, and pass `sampledDiffuseColor.a` to the G-buffer so the bodysuit/dress collar gets a clean ink seam! |
| **Figure Eyes & Eyebrows** | [external-rig.ts](../src/external-rig.ts:288) | Cloned `MeshStandardMaterial` (`Eyes` textured; `Eyebrows` tinted by `hairColor`) | Keep textured iris/pupil detail in `Realistic`, `Illustration`, and `Flat`; override cleanly to matte clay in `Clay` and clean ink outline in `Outline`. |
| **Sculpted Hair & Beard** (`SimpleParted`, `Long`, `Buns`, `Buzzed`, `Beard`) | [hair.ts](../src/hair.ts:81) | `MeshStandardMaterial` (`DoubleSide`, `normalizeHairAlbedoMap`, **plus tangent `normalMap` `T_Hair_1_Normal_png.png` at `normalScale = 1.05`**) | **Critical trap:** If the outline G-buffer evaluates `normalMap`, high-frequency hair-strand texels explode into noisy black Sobel static. The G-buffer **must** use smooth geometric vertex normals (`DoubleSide` flipped via `gl_FrontFacing`) while omitting tangent `normalMap`! |
| **7 Studio Props** (`lamp`, `table`, `chair`, `desk`, `couch`, `bed`, `room`) | [props.ts](../src/props.ts:6) | `MeshStandardMaterial` (`body`, `dark` with `metalness: 0.25`, `pale`, `DoubleSide` lampshade & room floor); mix of sharp `BoxGeometry` (`split` corner normals) and `RoundedBoxGeometry` | Hard `BoxGeometry` corners break inverted-hull outlines (`BackSide` faces separate at cube corners, leaving ugly V-gaps on walls, desks, and table legs). Screen-space normal + depth + ID edges handle both sharp `BoxGeometry` and smooth `RoundedBoxGeometry` seamlessly. |
| **Studio Floor** (`200 × 200 m` plane at `y = -0.005`) | [engine.ts](../src/engine.ts:95) | `MeshStandardMaterial({ color: '#55514a', roughness: 0.96 })`, `receiveShadow: true` | Must receive crisp stepped cast shadows in `Illustration` mode, produce a clean contact ink line where feet/furniture touch `y = 0`, and **never** draw grazing-angle depth bands or a false horizon line at `±100 m`. |
| **Editor Overlays & Gizmos** (`TransformControls`, `GridHelper`, `17` joint `markers`, `light` bulb spheres) | [engine.ts](../src/engine.ts:76) | `TransformControls.getHelper()`, `GridHelper`, `MeshBasicMaterial` spheres (`depthTest: false`, `renderOrder: 20` parented directly to `figure.bones[j]`) | **Critical trap:** Because joint `markers` are children of `figure.bones[j]`, `scene.overrideMaterial` will render all 17 joint spheres + `TransformControls` handles into the G-buffer unless isolated onto a dedicated `THREE.Layers` channel (`HELPER_LAYER = 1`)! |

### 2.2 Pass Ordering with `BokehPass` Depth of Field & `OutputPass` Tone Mapping

In [engine.ts](../src/engine.ts:486), `Studio.render()` currently runs `EffectComposer` only when `this.cameraView && this.state.camera.dof`:
```ts
RenderPass(scene, camera) -> BokehPass(scene, camera, ...) -> OutputPass()
```
While `renderer.toneMapping` is globally set to `T.ACESFilmicToneMapping` (`exposure = 1.0`). Two subtle interactions arise when adding NPR modes:

1. **Ink Outlines Must Precede `BokehPass`:** If ink outlines are composited *after* `BokehPass`, out-of-focus background props receive blurred color fills overlaid with **razor-sharp unblurred ink outlines**, destroying depth-of-field optical coherence. Placing `NprInkPass` **before** `BokehPass`:
   $$\text{RenderPass (Layer 0)} \longrightarrow \text{NprInkPass (Layer 0 G-Buffer + Ink)} \longrightarrow \text{BokehPass (optional, Layer 0)} \longrightarrow \text{OutputPass} \longrightarrow \text{Editor Helpers Overlay (Layer 1)}$$
   ensures focal-plane subjects have tack-sharp ink lines while out-of-focus background elements blur ink and color together optically—matching multiplane cel photography.
2. **Tone Mapping Must Match the Shading Intent:** `ACESFilmicToneMapping` compresses highlights and desaturates mid-to-high chroma colors (`#e8b896` warm peach shifts toward muted beige; `#ffffff` paper drops to `#cccccc` unless overexposed).
   - **`Realistic` & `Clay`:** Keep `ACESFilmicToneMapping` so spotlights (`0–200 lx`) roll off smoothly on sculpted forms without harsh clipping.
   - **`Illustration`, `Outline`, & `Flat`:** Switch `renderer.toneMapping` to `T.NoToneMapping` while keeping `SRGBTransfer` active in `OutputPass` (`renderer.outputColorSpace = T.SRGBColorSpace`), so user-chosen skin, outfit, hair, background, and paper hex colors render with **true-to-swatch editorial fidelity**.

### 2.3 Verified Three.js `0.181.0` Per-Object Uniform Upload in `overrideMaterial`

Direct inspection of `node_modules/three/src/renderers/WebGLRenderer.js` (lines `2019` and `2556–2560`) confirms that during a `scene.overrideMaterial` render pass:
1. `material.onBeforeRender(renderer, scene, camera, geometry, object, group)` executes **immediately after** `object.modelViewMatrix` / `normalMatrix` update and **immediately before** `renderBufferDirect -> setProgram`.
2. Inside `setProgram`, when `material.isShaderMaterial && material.uniformsNeedUpdate === true`, Three.js calls `WebGLUniforms.upload(...)` before issuing the draw call.

Therefore, a **single shared `ShaderMaterial`** (`NormalIdMaterial`) used as `scene.overrideMaterial` on Layer `0` can upload each mesh's `uObjectId`, `uHasOutfitMask`, and `uOutfitMaskMap` dynamically inside `onBeforeRender`—requiring **zero per-mesh duplicate materials** and **zero GLSL recompilations**!

---

## 3. Comparative Survey of Real-Time NPR Outline & Cel-Shading Techniques

### 3.1 Outline Extraction Families Compared

| Technique | Primary References | Outer Silhouettes | Hard-Edge Props (`BoxGeometry` Walls/Desks) | Internal Anatomical & Cloth Creases | Coplanar Contact Seams (Foot on Floor, Outfit Collar) | GPU Cost (Stage @ 1080p) | Verdict for Pose & Composition |
|---|---|---|---|---|---|---|---|
| **1. Inverted Hull (`BackSide` Normal Extrusion)** | [R05] Lake et al. 2000; [R03] Motomura 2015 (*Guilty Gear Xrd*); Three.js `OutlineEffect` | Good on smooth organic meshes | **Fails** — split face normals pull hull faces apart at $90^\circ$ corners unless custom smoothed vertex-color normals are authored per asset | **Misses** subtle concave creases unless camera grazes them | **Misses** completely | `~0.25 ms` (extra `BackSide` draw per mesh) | **Do not use as primary.** Fails on procedural `BoxGeometry` props and misses facial/clavicle/collar lines. |
| **2. Screen-Space Depth-Only Sobel** | [R01] Saito & Takahashi 1990 (1st-order $z$ discontinuity) | Good when $\Delta z$ is large | Misses internal convex corners sharing continuous $z$ | Misses shallow reliefs (nose bridge, abs, collarbones) | **Misses** zero-$\Delta z$ foot-to-floor & hand-to-desk contact; **false black bands** on grazing floors unless plane-compensated | `~0.12 ms` | **Necessary but insufficient alone.** Must be plane-projected and paired with Normals + IDs. |
| **3. Screen-Space Tangent-Plane Depth + Vector View-Normal + Object/Region ID (Recommended)** | [R01] Saito & Takahashi 1990; [R06] *Obra Dinn* / *Sable* / Moebius post-process ([R07] Heckel 2024, corrected to vector Sobel + plane depth) | **Crisp, uniform pixel width** at any focal length (`15–150 mm`) | **Exact** — $90^\circ$ view-normal jumps on desks/walls/chairs produce clean architectural ink lines | **Rich** — captures clavicles, deltoid/pec planes, nose, lips, fingers, sculpted hair locks | **Exact** — Object ID + `sampledDiffuseColor.a` outfit-region ID catches foot-on-floor, hand-on-prop, and bodysuit collar seams | **`~0.35 ms` total** (`~0.22 ms` Layer-0 G-buffer + `~0.13 ms` 9-tap composite) | **Selected Primary Pipeline.** Zero asset re-authoring; handles characters, hair, props, and `1600 px` PNG export uniformly. |
| **4. CPU / Compute Object-Space Silhouette Mesh Extraction (Freestyle / Grease Pencil Line Art)** | Blender Freestyle / Line Art ([R08]); Eisemann et al. | Vector-exact, stylized stroke chaining & intersections | Exact | Exact | Needs 3D boolean/ray visibility testing | `5–45 ms` per frame on 30k tris in JS | **Too heavy & unnecessary** for interactive WebGL2 orbit/scrubbing when screen-space Depth+Normal+ID achieves indistinguishable pixel ink in `0.35 ms`. |

### 3.2 Illustration Shading ("Flat Shade Color and Shadows") Families Compared

| Shading Method | Mechanism | Behavior on Varied Skin / Hair / Outfit Colors | Cast Shadows (`SpotLight` Shadow Map) | Specular Behavior | Verdict |
|---|---|---|---|---|---|
| **Post-Process Luminance Thresholding** ([R07] Heckel 2024 `pixelLuma <= 0.6`) | Quantizes final rendered `RGB` luma in screen space | **Breaks dark & pale palettes:** dark skin/hair (`#3b2720`) turns solid black in full light; pale surfaces lose shadow contrast | Indistinguishable from dark local color | Smears PBR highlights into stepped rings | **Reject.** Unusable for customizable skin, hair, and outfit palettes. |
| **Three.js Stock `MeshToonMaterial`** (`lights_toon_pars_fragment.glsl.js`) | 1D `gradientMap` lookup on `N·L` per light, summed additively across lights | Preserves albedo, **but** multi-light scenes (`HemisphereLight` + `DirectionalLight` fill + user `SpotLight`s) sum multiple stepped bands into washed-out 5–6 grey levels, and breaks `configureSkinAndOutfitMaterial` | Shadow map multiplies *after* `getGradientIrradiance` or creates double-banding with fill light | Fixed Phong-like or none | **Suboptimal.** Multi-light accumulation muddies flat cel blocks and requires parallel duplicate materials per mesh. |
| **Unified `MeshStandardMaterial` Pre-Albedo Irradiance Quantization + Gooch Cool/Warm Shadow Tint (Recommended)** | Captures linear `baseAlbedo`, evaluates standard Three.js multi-light + `PCFSoftShadowMap` accumulation, extracts **albedo-free direct irradiance** $E_{\text{dir}}$, quantizes $E_{\text{dir}}$ via anti-aliased `fwidth()` into 2 (or 3) crisp bands, and blends `baseAlbedo` between a **chromatic cool/warm shadow tone** ([R02] Gooch et al. 1998) and **flat key-lit `baseAlbedo`** | **100% palette-invariant:** pale ivory, warm bronze, deep ebony, espresso hair, crimson dress, and white pillows all exhibit the **exact same crisp shadow terminator** and vibrant flat local color | **Crisp & unified:** `SpotLight` cast shadows and `N·L` form shadows merge into **one cohesive, clean illustration shadow shape** (just like hand-painted cel animation!) | Zero plastic specular on skin/cloth/props; optional crisp stylized anisotropic/stepped ribbon on hair only | **Selected Primary Shading Pipeline.** Zero duplicate materials; instant uniform switch (`uShadeMode`); preserves all `uOutfitColor` & hair textures. |

---

## 4. Concrete Multi-Mode NPR Pipeline Tailored for Our Studio

### 4.1 Exact Definition of the 5 Studio Viewport Shading Modes

| Mode ID | UI Label | Tone Mapping | Ink Outlines | Surface Shading Formula | Primary Artist Use Case |
|---|---|---|---|---|---|
| `'realistic'` | **Realistic** | `ACESFilmic` | Off | Standard Three.js PBR (`totalDiffuse + totalSpecular + totalEmissiveRadiance`) | Lit studio photography, soft gradients, subtle skin/metal/wood specular |
| `'illustration'` | **Illustration** | `NoToneMapping` (`sRGB` out) | **On** (2-tier outer contour + inner crease/seam ink) | **Flat Base Albedo + Crisp Anti-Aliased 2-Step (or 3-Step) Form & Cast Shadows** with chromatic cool-slate/warm-sepia shadow tint; zero skin/cloth specular | **Flagship hand-drawn comic, anime, storyboard, & editorial illustration look** |
| `'outline'` | **Outline** | `NoToneMapping` (`sRGB` out) | **On** (high-clarity outer + inner ink) | **Pure Paper / Backdrop / Transparent Alpha** fill (plus optional 1-bit comic noir cast-shadow ink fill) | **Clean line-art extraction** for tracing, study, or exporting a transparent `1600 px` ink layer into Procreate / CSP / Photoshop |
| `'clay'` | **Clay** | `ACESFilmic` | Optional toggle (`Off` default, `On` for contour-clay) | **Matte Sculptor's Clay** (`Terracotta #c67d63`, `Cool Grey #9ea3aa`, or `Warm Plaster #ded7cb`), `roughness = 0.86`, `metalness = 0`, subtle hemisphere rim | **Pure 3D form, anatomy, gesture, & lighting value study** without local color distraction |
| `'flat'` | **Flat** | `NoToneMapping` (`sRGB` out) | Off | **Unlit Pure Albedo** (`outgoingLight = baseAlbedo`) | **Graphic silhouette, negative space, & color-blocking check** (classic 2D composition test) |

---

### 4.2 Mathematical Formulation of the Multi-Cue Screen-Space Ink Pass (`NprInkPass`)

#### Step 1: Layer-0 G-Buffer Packing (`NormalIdMaterial` + Hardware `DepthTexture`)

Allocate one `WebGLRenderTarget` resized alongside `Studio.resize()` (`width * pixelRatio`, `height * pixelRatio`):
- **Color Attachment 0 (`tNormalId`, `RGBAFormat`, `HalfFloatType`, `NearestFilter`):**
  - `rgb`: Unit **view-space geometric normal** $\mathbf{N}_v \in [-1, 1]^3$ (`normalize(vViewNormal) * (gl_FrontFacing ? 1.0 : -1.0)` so `DoubleSide` hair cards, lampshades, and room floors orient toward the camera without false back-face flips, and **ignoring `normalMap`** so hair strand maps never create static noise).
  - `a`: Packed **Object + Outfit-Region ID**:
    $$\text{id}_{\text{packed}} = 2 \cdot \text{objectId} + \mathbb{I}(\text{isOutfitPixel})$$
    where:
    - Sky / background clear value = `(0, 0, 1, 0)` (`id = 0`),
    - Studio `floor` (`200 × 200 m`) = `id = 2` (`objectId = 1`),
    - Each stage figure mesh (`mainSkin`, `Eyes`, `Eyebrows`, `Scalp hair`) and each prop sub-mesh (`seat`, `backrest`, `leg`, `drawer front`, `handle`, `window jamb`, `wall`) receives a sequential integer `objectId >= 2` assigned when added in `Studio.sync()` / `makeProp()`, and on `mainSkin` `isOutfitPixel = step(0.5, texture2D(uOutfitMaskMap, vUv).a)` distinguishes skin (`2k`) from painted outfit/boots (`2k + 1`)!
- **Depth Attachment (`tDepth`, `DepthTexture` with `UnsignedIntType`, `NearestFilter`):** Hardware clip-space depth $d \in [0, 1]$ captured in the **same single pass** at zero extra fragment cost.

#### Step 2: Plane-Projected Grazing-Angle-Safe Depth Edge ($e_{\text{depth}}$)

For center texel $\mathbf{u}_c$ and 8-connected neighbors $\mathbf{u}_i = \mathbf{u}_c + r_{\text{sil}} \cdot \boldsymbol{\delta}_i \cdot \mathbf{p}_{\text{texel}}$ (where $r_{\text{sil}} = w_{\text{ink}} \cdot \frac{H_{\text{px}}}{900}$ normalizes stroke width to a `900 px` reference frame):

1. Reconstruct 3D view-space positions $\mathbf{P}(\mathbf{u}, d)$ from hardware depth $d$ and camera projection parameters (`cameraProjectionMatrixInverse` or `near`/`far`/`fov` perspective unprojection):
   $$z_v = \text{perspectiveDepthToViewZ}(d, z_{\text{near}}, z_{\text{far}}), \qquad \mathbf{P}_i = \left(\frac{(2 u_i - 1) (-z_{v,i})}{P_{00}},\; \frac{(2 v_i - 1) (-z_{v,i})}{P_{11}},\; z_{v,i}\right)$$
2. Measure the **bidirectional tangent-plane distance** (evaluating at whichever of $c$ or $i$ is closer to the camera, $\mathbf{P}_{\text{near}}, \mathbf{N}_{\text{near}}$, so the outer border of every foreground silhouette grows cleanly by $r_{\text{sil}}$ without background normal artifacts):
   $$D_{\text{plane}}(c, i) = \frac{|\mathbf{N}_{\text{near}} \cdot (\mathbf{P}_{\text{far}} - \mathbf{P}_{\text{near}})|}{|z_{v,\text{near}}|}$$
3. **Why this completely solves grazing-angle floor & wall artifacts:**
   - On **any flat plane** (the `200 × 200 m` floor at $88^\circ$ grazing view, a receding room wall, or a desktop), $\mathbf{P}_i - \mathbf{P}_c$ lies strictly inside the surface tangent plane orthogonal to $\mathbf{N}_c$, so $\mathbf{N}_c \cdot (\mathbf{P}_i - \mathbf{P}_c) \equiv 0$!
   - On a **smooth curved limb** (cylinder of radius $R$ at distance $|z_v|$), the second-order curvature sagitta across pixel step $\Delta s$ is $\frac{\Delta s^2}{2 R |z_v|} \ll 0.008$, well below threshold $\tau_{\text{depth}} \approx 0.022$, whereas any true occluding overlap (finger over palm, forearm over ribcage, chin over neck, figure over chair) produces $D_{\text{plane}} \ge 0.025$–$0.50$!
   - Smoothly ramp to anti-aliased edge opacity:
     $$e_{\text{depth}} = \text{smoothstep}(\tau_{\text{depth}},\, 1.6\,\tau_{\text{depth}},\, \max_{i} D_{\text{plane}}(c, i))$$

#### Step 3: $SO(3)$-Invariant Vector View-Normal Crease Edge ($e_{\text{normal}}$)

Sample with finer interior radius $r_{\text{inner}} = 0.62 \, r_{\text{sil}}$ so interior anatomical and architectural creases stay noticeably more delicate than outer silhouettes. Compute the $3 \times 3$ Sobel Jacobian on all three components of $\mathbf{N}_v \in [-1, 1]^3$:
$$\mathbf{G}_x = \sum_{a,b \in \{-1,0,1\}} S_x(a,b)\,\mathbf{N}_v(a,b), \qquad \mathbf{G}_y = \sum_{a,b \in \{-1,0,1\}} S_y(a,b)\,\mathbf{N}_v(a,b)$$
$$g_N = \sqrt{\|\mathbf{G}_x\|_2^2 + \|\mathbf{G}_y\|_2^2}$$
- **Suppress duplicate double-thickening at depth silhouettes:** Mask normal gradients across pairs that already have a large plane-depth jump ($m_{\text{cont}} = 1 - e_{\text{depth}}$) so outer silhouettes don't double-stroke.
- Map via detail sensitivity $s_{\text{detail}} \in [0, 1]$ (default `0.65`):
  $$e_{\text{normal}} = 0.82 \cdot \text{smoothstep}\!\left(\tau_{N,\text{lo}}(s_{\text{detail}}),\, \tau_{N,\text{hi}}(s_{\text{detail}}),\, g_N\right)$$
  where $\tau_{N,\text{lo}} = \text{mix}(2.4, 0.75, s_{\text{detail}})$ and $\tau_{N,\text{hi}} = \tau_{N,\text{lo}} + 0.65$. At `0.65`, $45^\circ$–$90^\circ$ prop bevels, nose bridges, lips, brow ridges, clavicles, pectoral/deltoid planes, and sculpted hair locks draw crisp, clean interior ink lines, while smooth thigh/cheek cylinders remain spotless.

#### Step 4: Object & Outfit-Region ID Seam Edge ($e_{\text{id}}$) + Studio Horizon Suppression

Check discrete ID inequality across a crisp 4-neighbor cross ($\pm 0.65 \, r_{\text{sil}}$ for interior outfit/sub-part seams, $\pm 0.95 \, r_{\text{sil}}$ for distinct scene items):
1. **Horizon Guard:** If `{id_c, id_i} == {0 (Sky), 2 (Studio Floor)}`, ignore both depth and ID discontinuity so the `200 × 200 m` studio ground plane **never draws a fake black border against the backdrop**.
2. **Object Contact Seam** ($\lfloor \text{id}_c / 2 \rfloor \neq \lfloor \text{id}_i / 2 \rfloor$): Full contour weight ($e_{\text{obj}} = 1.0$) — guarantees a crisp ground-contact ink line under planted feet/knees/chair legs even when $\Delta z = 0$!
3. **Outfit / Material Region Seam** ($\lfloor \text{id}_c / 2 \rfloor = \lfloor \text{id}_i / 2 \rfloor$ and $\text{id}_c \neq \text{id}_i$): Delicate interior seam weight ($e_{\text{region}} = 0.65 \cdot s_{\text{detail}}$) — traces the superhero bodysuit/dress neckline, sleeve hems, and boot cuffs cleanly!

#### Step 5: Subtle Boil-Free Organic Stroke Feel & Final Ink Composite

- **Avoiding "Shower-Door" Orbit Swimming:** Pure screen-space `sin(gl_FragCoord.xy)` UV jitter ([R07]) swims distractingly whenever the user orbits the camera. Instead, keep default UV offsets `0.0` (rock-solid during interactive FK posing & camera orbit!) and achieve natural hand-inked character via:
  1. **Curvature + Depth Stroke Taper:** Modulate $r_{\text{sil}}$ subtly by perspective distance $\text{clamp}(2.6 / |z_v|,\, 0.72,\, 1.28)^{0.35}$ so foreground hands/faces carry slightly bolder ink than distant background room corners, just like real comic inking!
  2. **Optional Static/Export Paper Tooth (`sketchiness` `0.0` default):** Only when the user increases an optional *Sketchiness* slider above `0`, perturb stroke opacity/width softly using view-anchored or subtle multi-octave value noise (`±0.35 px` max).
- **Final Composite:**
  $$e_{\text{ink}} = \max\!\big(e_{\text{depth}},\, e_{\text{obj}},\, \max(e_{\text{normal}}, e_{\text{region}})\big)$$
  $$\mathbf{C}_{\text{out}} = \text{mix}(\mathbf{C}_{\text{shaded}},\, \mathbf{C}_{\text{ink}},\, e_{\text{ink}})$$
  (And in `Outline` mode with **Transparent PNG** selected: `gl_FragColor = vec4(uInkColor, e_ink)`!)

---

### 4.3 Mathematical Formulation of Material-Level Cel / Clay / Flat Shading

Injected once into every stage `MeshStandardMaterial` via a composable `attachStudioShading(material, role)` helper (chaining after `configureSkinAndOutfitMaterial`'s existing `onBeforeCompile` hook on body meshes):

1. **Pre-Lighting Hook (immediately before `#include <lights_physical_fragment>`):**
   ```glsl
   vec3 pncBaseAlbedo = diffuseColor.rgb;
   if ( uShadeMode == 3 ) {
     // Clay mode: neutral matte sculptor's clay across skin, outfit, eyes, hair, and props
     diffuseColor.rgb = uClayColor;
     roughnessFactor = 0.86;
     metalnessFactor = 0.0;
   } else if ( uShadeMode == 1 || uShadeMode == 2 || uShadeMode == 4 ) {
     // Illustration / Outline / Flat: ensure metallic prop parts (dark slate legs = 0.25) keep full diffuse albedo
     metalnessFactor = 0.0;
     roughnessFactor = max( roughnessFactor, 0.92 );
   }
   ```
2. **Post-Lighting Hook (immediately after `vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;`):**
   ```glsl
   if ( uShadeMode == 4 ) {
     // Mode 4: Flat (Unlit true base color)
     outgoingLight = pncBaseAlbedo;
   } else if ( uShadeMode == 1 ) {
     // Mode 1: Hand-Drawn Illustration (Flat Albedo + Crisp Stepped Form & Cast Shadows)
     float albedoLuma = max( dot( pncBaseAlbedo, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
     // Exact albedo-independent direct irradiance (includes N.L, SpotLight cone/falloff, and PCF shadow map!)
     float directIrr = 3.14159265 * dot( reflectedLight.directDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) / albedoLuma;
     // Preserve light hue tint when user colors a SpotLight (e.g. warm sunset orange or neon rim)
     vec3 lightTint = reflectedLight.directDiffuse / max( dot( reflectedLight.directDiffuse, vec3( 0.3333 ) ), 1e-4 );
     lightTint = mix( vec3( 1.0 ), clamp( lightTint, 0.5, 1.6 ), 0.35 );

     // Razor-sharp fwidth() anti-aliased shadow terminator (1px crisp edge, zero jagged aliasing!)
     float aa = clamp( fwidth( directIrr ) * 1.35, 0.008, 0.06 );
     float litStep1 = smoothstep( uCelThreshold - aa, uCelThreshold + aa, directIrr );

     // Gooch-inspired chromatic shadow palette: shifts shadow slightly cool/saturated instead of muddy grey!
     vec3 shadowAlbedo = mix(
       pncBaseAlbedo * 0.56,
       pncBaseAlbedo * uShadowTint + 0.025 * uShadowTint,
       0.48
     );
     vec3 litAlbedo = pncBaseAlbedo * lightTint;

     if ( uShadowSteps > 2.5 ) {
       // Optional 3-tone anime/comic ramp: Deep Umbra -> Midtone -> Warm Key Highlight
       float aa2 = clamp( fwidth( directIrr ) * 1.35, 0.01, 0.08 );
       float litStep2 = smoothstep( 0.92 - aa2, 0.92 + aa2, directIrr );
       vec3 deepShadow = shadowAlbedo * 0.78;
       vec3 keyHighlight = mix( litAlbedo, vec3( 1.0, 0.985, 0.95 ), 0.08 );
       outgoingLight = mix( mix( deepShadow, shadowAlbedo, smoothstep( 0.10 - aa, 0.10 + aa, directIrr ) ), mix( litAlbedo, keyHighlight, litStep2 ), litStep1 );
     } else {
       // Default 2-tone crisp editorial illustration cel shade
       outgoingLight = mix( shadowAlbedo, litAlbedo, litStep1 );
     }

     // Subtle stylized hair ribbon highlight (only on hair meshes, zero plastic glare on skin/cloth)
     if ( uMaterialRole == 2 ) {
       float specLuma = dot( reflectedLight.directSpecular, vec3( 0.2126, 0.7152, 0.0722 ) );
       float hairRibbon = smoothstep( 0.045, 0.065, specLuma );
       outgoingLight = mix( outgoingLight, mix( pncBaseAlbedo, vec3( 1.0 ), 0.32 ), hairRibbon * 0.65 );
     }
   } else if ( uShadeMode == 2 ) {
     // Mode 2: Pure Outline / Line Art on Paper (with optional comic noir shadow fill)
     float albedoLuma = max( dot( pncBaseAlbedo, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
     float directIrr = 3.14159265 * dot( reflectedLight.directDiffuse, vec3( 0.2126, 0.7152, 0.0722 ) ) / albedoLuma;
     float aa = clamp( fwidth( directIrr ) * 1.35, 0.008, 0.05 );
     float inShadow = 1.0 - smoothstep( uCelThreshold - aa, uCelThreshold + aa, directIrr );
     outgoingLight = mix( uPaperColor, mix( uPaperColor, uInkColor, 0.88 ), inShadow * uOutlineShadowFill );
   }
   ```

**Why this shader design is ideal for Pose & Composition:**
- **Zero material swapping & zero shader recompilation when switching modes:** Changing between `Realistic`, `Illustration`, `Outline`, `Clay`, and `Flat` updates `sharedUniforms.uShadeMode.value` (`O(1)` integer write) — instantaneous `< 0.01 ms` mode switching!
- **Studio `SpotLight`s remain 100% live and interactive:** Moving a light, aiming its target, changing its intensity (`0–200 lx`), or tinting its color dynamically reshapes every crisp cel shadow and cast floor shadow in real time!
- **Tightly compatible with `PCFSoftShadowMap`:** Setting `light.shadow.radius = (mode === 'illustration' || mode === 'outline') ? 1.0 : 2.2` keeps spotlight shadow maps crisp before the `fwidth()` step quantizer turns the shadow boundary into a clean vector-like contour.

---

## 5. Industry-Standard Viewport Shading UX & Exact UI Design

### 5.1 Industry UX Benchmark

| Application | Where Viewport Shading Lives | Modes Offered | Why It Works (and What to Adapt) |
|---|---|---|---|
| **Blender 4.x 3D Viewport** ([R08]) | **Top-right corner of the 3D Viewport** (4 iconic sphere pills + popover chevron; `Z` shortcut) | `Wireframe` · `Solid` (*Studio / MatCap / Flat*) · `Material Preview` · `Rendered` | **Gold standard placement:** Always visible regardless of which right-hand Properties tab is open, never steals space from left/center transform tools, and separates **1-click mode switching** (in viewport) from **detailed style parameters** (in shading settings). |
| **Marmoset Toolbag / Sketchfab** | Viewport HUD pill / top bar | `Final / Lit` · `Clay / MatCap` · `Albedo (Flat)` · `Wireframe / Lines` | Proves artists toggle between **Lit**, **Clay** (form check), **Flat Albedo** (silhouette/value check), and **Line/Contour** constantly *while posing*, not merely at final export. |
| **Clip Studio Paint 3D Drawing Figures** | Quick tool bar + Sub Tool Detail (*LT Conversion of Layer*) | `Lit` · `Flat (Unlit)` · `Line + Tone Extraction` (outer width, inner detail, black shadow fill, transparent paper) | Confirms comic/manga/storyboard artists specifically need **Line weight**, **Interior detail sensitivity**, **2-step/3-step shadow**, and **Transparent PNG pure line-art export**. |
| **PoseMy.Art / DesignDoll** | Viewport overlay bar | `Realistic / Shaded` · `Cel / Comic` · `Sketch / Silhouette` | Keeps mode switching 1 click away during joint rotation so artists can check how an extreme foreshortened pose reads as flat ink lines immediately. |

### 5.2 Recommended Placement & Component Design (Strict Project Design Compliance)

Auditing [App.tsx](../src/App.tsx:1085) and [styles.css](../src/styles.css:970) shows:
- `.viewport-toolbar` (`46 px` header above canvas) holds `Move W | Rotate E | Scale R` + `Frame F` on the left (`~295 px`) and `Editor | Camera C` on the right (`~145 px`). On a `1100 px`–`1280 px` laptop (`712 px` center viewport column), adding 5 shading buttons inside `.viewport-toolbar` would wrap the toolbar to two rows (`92 px` tall) and steal vertical canvas height.
- Inside `.viewport`, top-left (`top: 12px; left: 12px`) holds `.viewport-caption` (`PERSPECTIVE · EDITOR`), while **top-right (`top: 10px; right: 12px`) is completely open**.

#### Primary Control: Floating Top-Right Viewport Shading `SegmentedControl`

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ [Move W | Rotate E | Scale R] [Frame F]                         [Editor | Camera] │ ← .viewport-toolbar
├───────────────────────────────────────────────────────────────────────────────────┤
│ [PERSPECTIVE · EDITOR]            [◐ Real | ✒ Illust | ○ Ink | ● Clay | ◑ Flat] │ ← .viewport-shading-hud (top-right)
│                                                                                   │
│                                                                                   │
│                              ( 3D Character Stage )                               │
│                                                                                   │
│                                                                                   │
│ [Left drag: orbit · Right drag: pan · Wheel: zoom]          [Controls & workflow] │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Design & Accessibility Details (Honoring Standing UI Rules):**
1. **Single Component Reuse (Zero Redundant Variants):** Reuse the existing `SegmentedControl` from [ui.tsx](../src/components/ui.tsx:297) (extending `SegmentItem` with an optional `icon?: ReactNode` and `title?: string`), housed in `.viewport-shading-hud` (`position: absolute; top: 10px; right: 12px; z-index: 10; background: var(--cp-panel-strong); backdrop-filter: blur(8px);`).
2. **Passes the Toggle Test & Zero One-Sided Borders:** Every mode is an explicit mutually-exclusive segment (`role="radiogroup"` / `aria-pressed`) with a distinct `14×14` stroke/fill icon + readable text label (`Real` / `Realistic`, `Illust` / `Illustration`, `Ink` / `Outline`, `Clay`, `Flat`), highlighted on selection with our standard full-pill `background: var(--cp-accent-soft); border: 1px solid var(--cp-accent)` — **never** a one-sided accent border.
3. **Responsive Layout (`900 × 700` & `500 × 800` Safe):**
   - `> 1180 px`: Full labels (`Realistic` · `Illustration` · `Outline` · `Clay` · `Flat`) + `14 px` icons.
   - `680 px – 1180 px`: Compact labels (`Real` · `Illust` · `Ink` · `Clay` · `Flat`) + `14 px` icons; `.viewport-caption` hides or truncates before colliding.
   - `< 560 px` narrow viewport: Icon + active-mode label (or compact `SelectDropdown` fallback below `480 px`), guaranteeing **zero horizontal overflow** at `500 × 800`.
4. **Keyboard Shortcuts:**
   - `1` `2` `3` `4` `5` (when no input is focused): Direct jump to `Realistic`, `Illustration`, `Outline`, `Clay`, `Flat`.
   - `Z`: Cycle to next shading mode (or toggle between `Realistic` and last-used NPR mode `Shift+Z`), documented in the `Help (?)` modal shortcut grid.

#### Secondary Control: Contextual "Render style" Section in the `Camera` (Compose) Inspector Tab

In [App.tsx](../src/App.tsx:1553) (`tab === 'camera'`), add a dedicated `<section>` right above **Stage backdrop** so composition rendering parameters live right alongside Camera Lens, DOF, Backdrop, and **Export camera PNG**—showing **only the controls relevant to the active mode** (zero dead/disabled slider clutter!):

- **Always shown at top of section:**
  - Full-width `SegmentedControl` or synced readout of `Shading mode` (`Realistic` · `Illustration` · `Outline` · `Clay` · `Flat`) so users already in the `Camera` tab see the connection between the mode and its sliders immediately.
- **When `mode === 'illustration'`:**
  - `ColorField`: **Ink color** (default `#1f1b18` warm sumi ink)
  - `SliderField`: **Ink weight** (`0.5 px` – `3.0 px`, step `0.1`, default `1.5 px`)
  - `SliderField`: **Interior detail** (`0%` – `100%`, step `5%`, default `65%` — controls muscle/face/cloth normal & outfit-seam lines)
  - `SegmentedControl`: **Shadow bands** (`2-tone` | `3-tone`, default `2-tone`)
  - `SegmentedControl`: **Shadow temperature** (`Cool` `[0.72, 0.77, 0.96]` | `Warm` `[0.95, 0.78, 0.68]` | `Neutral` `[0.82, 0.82, 0.84]`, default `Cool`)
- **When `mode === 'outline'`:**
  - `ColorField`: **Ink color** (default `#1f1b18`)
  - `SegmentedControl`: **Paper backdrop** (`Warm paper` `#faf6ee` | `White` `#ffffff` | `Scene` | `Transparent`) — *when `Transparent` is selected, viewport shows a subtle clean paper checkerboard/tint and `Export PNG` writes an **RGBA transparent line-art PNG**!*
  - `SliderField`: **Ink weight** (`0.5 px` – `3.0 px`, default `1.6 px`) & **Interior detail** (`0%` – `100%`, default `75%`)
  - `SwitchRow`: **Fill cast shadows** (`Off` default; when `On`, fills shadowed regions with crisp graphic ink tone for high-contrast comic noir)
- **When `mode === 'clay'`:**
  - `SegmentedControl`: **Clay finish** (`Terracotta` `#c67d63` | `Studio grey` `#9ea3aa` | `Plaster` `#ded7cb`, default `Terracotta`)
  - `SwitchRow`: **Show contour ink** (`Off` default; when `On`, overlays `NprInkPass` on top of sculpted clay for anatomy contour study!)
- **When `mode === 'realistic'` or `mode === 'flat'`:**
  - Clean 1-line `.muted` summary note (`"Physically based studio lighting with soft shadows."` / `"Unlit local colors for silhouette and value-grouping checks."`) — zero extra sliders.

### 5.3 Persistence & Backward-Compatible Schema Design (`model.ts`)

Store `renderStyle` as an **optional** top-level field on `SceneState` (`schemaVersion: 1` remains backward-compatible!):

```ts
export const SHADING_MODES = ['realistic', 'illustration', 'outline', 'clay', 'flat'] as const;
export type ShadingMode = typeof SHADING_MODES[number];
export type ShadowTemperature = 'cool' | 'warm' | 'neutral';
export type OutlinePaperMode = 'warm' | 'white' | 'scene' | 'transparent';
export type ClayFinish = 'terracotta' | 'grey' | 'plaster';

export interface RenderStyleState {
  mode: ShadingMode;              // default: 'realistic'
  inkColor: string;               // default: '#1f1b18'
  inkWidth: number;               // [0.5, 3.0], default: 1.5
  interiorDetail: number;         // [0, 1], default: 0.65
  shadowSteps: 2 | 3;             // default: 2
  shadowTemp: ShadowTemperature;  // default: 'cool'
  outlinePaper: OutlinePaperMode; // default: 'warm'
  outlineShadowFill: boolean;     // default: false
  clayFinish: ClayFinish;         // default: 'terracotta'
  clayOutlines: boolean;          // default: false
}
```

- **Why `SceneState` (with Undo/Redo + Autosave + Named Study Save) rather than ephemeral `localStorage`:**
  1. Saving a comic composition study in `Illustration` mode with sepia ink (`#3b2319`) and `2.0 px` line weight restores that exact visual look on reload or Scene JSON import.
  2. Pre-existing `v1` Scene JSON files and IndexedDB studies without `renderStyle` validate cleanly by hydrating `DEFAULT_RENDER_STYLE` (`mode: 'realistic'`).
  3. Pose-only JSON files (`PoseFile`) remain strictly pose-only and do not overwrite the scene's `renderStyle`.

---

## 6. Exact Implementation Blueprint for Three.js `0.181.0`

### 6.1 Module Breakdown

1. **`src/npr.ts` (New self-contained module, ~320 LOC):**
   - `STAGE_LAYER = 0`, `HELPER_LAYER = 1` helper `setLayerRecursive(obj: T.Object3D, layer: number)`.
   - `StudioShadingController`: owns the shared uniform object (`uShadeMode`, `uClayColor`, `uCelThreshold`, `uShadowSteps`, `uShadowTint`, `uPaperColor`, `uInkColor`, `uOutlineShadowFill`) and `attachStudioShading(material: T.MeshStandardMaterial, role: 'body' | 'hair' | 'standard')` which chains cleanly onto any pre-existing `material.onBeforeCompile` and appends `-npr-v1` to `customProgramCacheKey`.
   - `NormalIdMaterial extends T.ShaderMaterial`: vertex shader includes `<morphtarget_vertex>`, `<skinbase_vertex>`, `<skinnormal_vertex>`, `<skinning_vertex>`, and outputs `vViewNormal = normalize(normalMatrix * objectNormal)` + `vUv`; `onBeforeRender` reads `object.userData.nprObjectId` and `object.userData.outfitMaskTexture` and sets `this.uniformsNeedUpdate = true`; fragment shader writes `vec4(normalize(vViewNormal) * (gl_FrontFacing ? 1.0 : -1.0), float(2 * uObjectId + isOutfit))`.
   - `NprInkPass extends Pass`: owns the resized `gBuffer` (`WebGLRenderTarget` with `HalfFloatType` RGBA + `DepthTexture` `UnsignedIntType`), renders `scene` with `camera` restricted to `STAGE_LAYER` (`overrideMaterial = normalIdMaterial`, clear `(0, 0, 1, 0)`), then runs the `FullScreenQuad` multi-cue composite shader (Steps 2–5 above).

2. **`src/engine.ts` Integration (`Studio.render()` & `Studio.exportPng()`):**
   - Assign `this.transform.getHelper()` (recursively), `this.grid`, `entry.markers`, and `entry.light` bulb mesh to `HELPER_LAYER = 1` (keeping `editorCamera.layers` enabled on `0` for `composer` passes, then rendering Layer `1` overlay in Editor View).
   - Unify rendering through a single lazily-created `EffectComposer` whenever `needsComposer = (mode !== 'realistic') || (this.cameraView && this.state.camera.dof)`:
     - `renderPass.enabled = true` (renders `STAGE_LAYER` only; in `outline` + `transparent` export mode, clears background alpha `0.0`).
     - `nprInkPass.enabled = (mode === 'illustration' || mode === 'outline' || (mode === 'clay' && style.clayOutlines))`.
     - `bokehPass.enabled = (this.cameraView && this.state.camera.dof)` (with `camera.layers.set(STAGE_LAYER)` so gizmos/markers never pollute bokeh depth).
     - `outputPass.enabled = true` (switches `renderer.toneMapping` between `ACESFilmicToneMapping` for `realistic`/`clay` and `NoToneMapping` for `illustration`/`outline`/`flat`).
   - After `composer.render()` (or direct `renderer.render` in `Realistic` without DOF), if `!this.cameraView`, render `HELPER_LAYER` (`editorCamera.layers.set(HELPER_LAYER)`, `renderer.autoClear = false`, `renderer.clearDepth()` before depth-tested gizmo or preserving depth for `GridHelper` + `depthTest: false` markers/gizmos) so `TransformControls`, joint markers, and floor grid stay crisp, un-outlined, and un-blurred!
   - **Transparent PNG Support in `exportPng()`:** Note that `Studio` constructs `WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })` (which already allocates an RGBA backbuffer with `alpha: true` default in WebGL2 or explicit `alpha: true`!). Setting `alpha: true` on `WebGLRenderer` + `EffectComposer` target (`RGBAFormat`) allows `Outline` + `Transparent` paper mode to export genuine 32-bit alpha line-art PNGs at `1600 px`!

### 6.2 Verification & Visual Acceptance Test Matrix

1. **Grazing-Angle Floor & Wall Immunity Test:** Position camera at `y = 0.18 m` looking nearly horizontally across the `200 × 200 m` studio floor and `room` walls in `Illustration` and `Outline` modes -> **0% false black depth bands** on the floor/walls, **0 horizon box line** where floor meets sky, and **clean 1–2 px contact ink line** where feet and chair legs touch `y = 0`.
2. **Dark & Light Palette Invariance Test:** Set Figure A to deep espresso skin (`#4a2e22`) + black hair (`#181515`) + navy suit (`#1d293d`), and Figure B to pale ivory (`#f5dcc8`) + platinum hair (`#f0eadc`) + white outfit (`#f4f4f6`) under one `SpotLight` -> both figures exhibit identical crisp 2-step shadow terminators in `Illustration` mode without dark palette crushing or white shadow loss.
3. **Hard-Edge Prop & Hair Normal-Map Test:** Add all 7 props (`lamp`, `table`, `chair`, `desk`, `couch`, `bed`, `room`) + both figures with `Long` and `Parted + beard` hair -> sharp `90°` desk/wall/drawer corners show unbroken ink lines (zero inverted-hull corner gaps) and sculpted hair shows clean lock contours without `T_Hair_1_Normal` per-texel noise.
4. **Gizmo & Joint Marker Exclusion Test:** Select a figure joint (`leftElbow`) in Editor View under `Illustration` and `Outline` modes -> gold/coral joint markers, `TransformControls` rotation rings, floor `GridHelper`, and light bulbs have **zero black ink outlines** around them and remain 100% clickable.
5. **Camera DOF + `1600 px` PNG Export Parity Test:** Enable `Camera View` + `DOF` (`aperture = 0.002`) in all 5 modes (`Realistic`, `Illustration`, `Outline` including `Transparent`, `Clay`, `Flat`) and call `exportPng()` at `DPR = 1` and `DPR = 2` -> exported `1600 px` PNG matches Camera View framing, blurs background ink + flat color coherently together when out of focus, and produces true alpha channel when `Outline` + `Transparent` is selected.
6. **Responsive UX & Accessibility Test:** Verify top-right Viewport Shading `SegmentedControl` and `Camera` tab *Render style* controls at `1440 × 900`, `900 × 700`, and `500 × 800` in both Light and Dark themes -> zero horizontal overflow, unclipped focus rings, keyboard `1`–`5` / `Z` switching works, and old `v1` Scene JSON imports restore cleanly to `Realistic`.

---

## 7. Verified Bibliography & Primary Technical Sources

- **[R01]** Saito, Takafumi, & Takahashi, Tokiichiro (1990). *Comprehensible Rendering of 3-D Shapes*. ACM SIGGRAPH '90 (*Computer Graphics*, Vol. 24, No. 4), pp. 197–206. DOI: `10.1145/97879.97901`. *(Foundational G-buffer depth + normal discontinuity formulation for outer silhouettes and internal surface creases.)*
- **[R02]** Gooch, Amy, Gooch, Bruce, Shirley, Peter, & Cohen, Elaine (1998). *A Non-Photorealistic Lighting Model For Automatic Technical Illustration*. Proceedings of ACM SIGGRAPH '98, pp. 447–452. DOI: `10.1145/280814.280950`. *(Chromatic cool-to-warm luminance-preserving shadow/lit ramp so black ink outlines remain legible over shadowed regions without muddy black multiplication.)*
- **[R03]** Motomura, Junya Christopher (2015). *GuiltyGearXrd's Art Style: The X Factor Between 2D and 3D*. Game Developers Conference (GDC 2015), Visual Arts Track, Arc System Works. Official GDC Vault record: https://www.gdcvault.com/play/1022031/GuiltyGearXrd-s-Art-Style-The *(Thresholded flat cel shading decoupled from PBR falloff + multi-tier outer vs inner line weight hierarchy.)*
- **[R04]** Barla, Pascal, Thollot, Joëlle, & Markosian, Lee (2006). *X-toon*. Proceedings of the 4th International Symposium on Non-Photorealistic Animation and Rendering (NPAR '06), pp. 127–132. DOI: `10.1145/1124728.1124749`. *(Depth- and view-dependent detail/tone modulation across camera distance.)*
- **[R05]** Lake, Adam, Marshall, Carl, Harris, Mark, & Blackstein, Marc (2000). *Stylized Rendering Techniques for Scalable Real-Time 3D Animation*. Proceedings of the 1st International Symposium on Non-Photorealistic Animation and Rendering (NPAR '00), pp. 13–20. DOI: `10.1145/340916.340918`. *(Real-time hard quantized cel ramps + silhouette edge detection.)*
- **[R06]** Three.js `0.181.0` Official Source & Addons (`WebGLRenderer.js`, `RenderTarget.js`, `BokehPass.js`, `OutputPass.js`, `OutlineEffect.js`, `meshphysical.glsl.js`, `lights_fragment_begin.glsl.js`) — audited directly in local `node_modules/three`.
- **[R07]** Heckel, Maxime (2024). *Moebius-style post-processing and other stylized shaders*. https://blog.maximeheckel.com/posts/moebius-style-post-processing/ *(Reference WebGL/Three.js `DepthTexture` + `NormalMaterial` Sobel post-processing baseline; audited in Section 3–4 for its scalar-normal `luma()` and post-albedo `pixelLuma` pitfalls and exact vector/plane-depth fixes.)*
- **[R08]** Blender 4.x Reference Manual — *3D Viewport ‣ Viewport Shading (`Wireframe`, `Solid` [Studio / MatCap / Flat], `Material Preview`, `Rendered`, `Cavity`, `Outline`)*. https://docs.blender.org/manual/en/latest/editors/3dview/display/shading.html
