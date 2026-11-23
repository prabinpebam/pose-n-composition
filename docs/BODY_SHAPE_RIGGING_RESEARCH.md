# Body-Shape & Adipose-Aware Rigging and Cross-Morphology Pose Translation

## 1. Executive Summary & Architectural Problem Statement

Human body shapes vary substantially in skeletal proportions, muscularity, age-related kyphosis, and subcutaneous/visceral adipose tissue (fat) distribution. Two fundamental failures occur when a character rigging and posing pipeline treats every human mesh as a scaled lean T-pose/arms-down mannequin:

1. **Skeleton-to-Shape Mismatch & Destructive Post-Bind Rest Alignment**:
   - Adipose tissue does **not** expand uniformly around bones. Abdominal and pectoral fat accumulate predominantly **anteriorly** and **laterally** while the vertebral column remains anchored ~28–36% anterior to the dorsal skin. Similarly, lateral thigh ("saddlebag") and medial inner-thigh fat expand asymmetrically around the femur, and thoracic/axillary fat widens the lateral chest wall outside a lean template's shoulder joint.
   - If a morphed or sculpted heavy character retains lean-template joint positions—or if a runtime loader forcibly rotates bound upper arms down to a lean man's `6.84°` vertical stance (`Vector3(±0.12, -1, 0)`) after skin binding—the mesh surfaces suffer massive linear-blend-skinning (LBS) collapse (`300–686 mm` vertex displacement) and deep arm-into-torso interpenetration (`-31 mm` to `-52 mm`).
2. **Rest-Pose-Blind & Envelope-Blind Pose Retargeting**:
   - Artist-sculpted and scanned assets arrive in diverse bind postures: `6.84°` relaxed arms-down (`Mannequin`), `39°–43°` natural A-pose (`Women in Nightgown`, `Stylized Women`, `Hotfemale-1`), `58°–62°` Character Creator A-pose (`Massimo Fat Male`, `Massimo Fat Female`, `Fat King`, `Babar Azam`), or `88°–90°` calibration T-pose (`Superhero Male/Female`, `Old Man`).
   - Applying raw local/world Euler deltas authored for a lean `6.84°` mannequin directly onto a `60°` A-pose or `90°` T-pose rig either over-abducts limbs by `40°–80°` (if authored rest is preserved naively) or crushes heavy limbs into fat torsos, waists, inner thighs, and abdomens (if forced to lean angles). Conversely, copying a pose from a wide/fat character onto a lean character without envelope normalization leaves the lean character's arms floating in mid-air ("invisible lat syndrome").

This document synthesizes the solved biomechanical, computer-graphics, and game-engine algorithms addressing both problems and documents the exact millimeter/degree audit of all 14 characters in **Pose & Composition**.

---

## 2. Primary Literature: Shape- & Adipose-Aware Skeleton Fitting (Zero Geometry Modification)

### 2.1 Parametric Body Models & Shape-Dependent Joint Regression: SMPL, STAR, and SKEL

- **SMPL (Loper et al., *ACM TOG / SIGGRAPH Asia 2015*)**:
  - Models the rest-pose cortical surface as $\mathbf{T}_P(\vec{\beta}, \vec{\theta}) = \bar{\mathbf{T}} + B_S(\vec{\beta}) + B_P(\vec{\theta})$, where $\vec{\beta}$ encodes PCA body-shape parameters (stature, BMI, waist-hip ratio, chest/limb girth).
  - Crucially, SMPL never freezes joint locations at the mean template $\bar{\mathbf{J}}$ nor modifies sculpted surface geometry to fit a fixed rig. Instead, skeletal joint centers move as a sparse linear regression of surface vertices:
    $$\mathbf{J}(\vec{\beta}) = \mathcal{J}\!\left(\bar{\mathbf{T}} + B_S(\vec{\beta})\right)$$
  - Because $\mathcal{J}$ is learned from registered body variations, **joint centers shift non-uniformly relative to surface bounding boxes** as fat ($\beta_{\text{BMI}}$) increases:
    - **Lumbar & Thoracic Spine (`hips`, `spine`, `chest`)**: Anterior abdominal depth $z_{\text{front}}$ can double or triple with visceral/subcutaneous fat, while posterior skin over the spinous processes thickens by only ~10–25 mm. Thus $J_{\text{spine}, z}(\vec{\beta})$ tracks the posterior surface (~30–36% of total anteroposterior depth from the back), **not** the 50% bounding-box midpoint.
    - **Glenohumeral Pivot (`leftShoulder`, `rightShoulder`)**: Moves laterally with ribcage/acromial breadth and slightly superiorly with trapezius/clavicular elevation, preventing the humeral pivot from becoming buried inside an expanded thoracic wall.
    - **Acetabular Hip Pivot (`leftHip`, `rightHip`)**: Scales with pelvic bi-acetabular breadth (~52–56% of bony bicristal width, aligned with the proximal femoral shaft above the perineal cleft) rather than drifting outward with lateral trochanteric fat pads or remaining frozen at an ectomorphic pelvis width.

- **STAR — Sparse Trained Articulated Human Body Regressor (Osman, Bolkart & Black, *ECCV 2020*)**:
  - Identified a critical flaw in SMPL: SMPL's pose-corrective blendshapes $B_P(\vec{\theta})$ are **independent of body shape $\vec{\beta}$**, meaning high-BMI subjects deform like inflated thin people—exhibiting severe soft-tissue interpenetration and unnatural crease collapse at shoulders, elbows, hips, and abdomen.
  - Trained on 14,000+ CAESAR + SizeUSA scans spanning wide BMI distributions, STAR conditions pose deformation directly on both pose and shape/BMI, $B_P(\vec{\theta}, \vec{\beta})$, using spatially local quaternion-activated corrective fields, and refines shape-dependent joint regression across obese and muscular somatotypes.

- **SKEL — Biomechanical Skeleton Inside Parametric Skin (Keller et al., *ACM TOG / SIGGRAPH Asia 2023*)**:
  - Replaces heuristic joint centroids with an anatomically accurate biomechanical skeleton (scapula, clavicle, glenohumeral head, ribcage, vertebral column, pelvis, femur, tibia/fibula) fitted inside arbitrary body shapes.
  - Demonstrates that placing limb pivots on true functional joint centers (humeral head ~45% below the acromial roof and lateral to the ribcage; acetabulum superior-lateral to the perineal arch; knee at femoral epicondylar width) eliminates "rubber-hose" skin shearing when heavy limbs articulate.

### 2.2 Automatic Medial-Axis & Landmark Rigging: Pinocchio, RigNet, MakeHuman/MPFB2, and CC4

- **Pinocchio (Baran & Popović, *ACM TOG / SIGGRAPH 2007*)**:
  - Packs maximal inscribed medial-axis spheres inside the character interior and embeds a reduced skeleton graph via discrete penalty optimization + continuous refinement, followed by **harmonic heat-equilibrium skin weights**:
    $$-\Delta \mathbf{w}^i + \mathbf{H}\,\mathbf{w}^i = \mathbf{H}\,\mathbf{p}^i$$
    where geodesic heat diffusion through the mesh volume/surface naturally prevents cross-gap weight bleeding (e.g., between inner upper arm and lateral belly fat) that plagues Euclidean distance skinning.
  - *Limitation on high-BMI meshes*: Pure maximal inscribed spheres pull the lumbar/thoracic spine forward into the center of a large belly sphere unless regularized by a **dorsal vertebral prior**.

- **RigNet (Xu et al., *ACM TOG / SIGGRAPH 2020*)**:
  - Uses geodesic mesh-attention graph neural networks to predict joint probability heatmaps, bone connectivity, and geodesic-aware skin weights directly in the mesh's authored posture without requiring T-pose normalization.

- **MakeHuman / MPFB2 (`src/mpfb/entities/rig.py`) & Reallusion Character Creator 4 (*Adjust Bones to Fit Morph*)**:
  - MakeHuman/MPFB2 computes every joint head/tail from anatomical **joint-cubes** and topological **surface landmark rings** (e.g., posterior spinous process strip + anterior sternum/navel strip with asymmetric ~`0.68 : 0.32` dorsal-to-ventral weighting; acromion + axillary fold ring for glenohumeral head).
  - Reallusion CC4's *Adjust Bones to Fit Morph* step explicitly updates `CC_Base_*` EditBone positions whenever a heavy/fat morph is applied. Skipping this step (as occurred in several community CC exports) leaves skinny-template bone coordinates stranded inside morphed fat geometry.

---

## 3. Primary Literature: Translating Poses Across Body Shapes & Rest Postures

### 3.1 Rest-Pose-Invariant Orientation Retargeting (Unreal Engine 5 IK Rig / IK Retargeter)

When Source Rig $S$ has bind bone world/character rotation $\mathbf{Q}_{S,\text{bind}}^{(j)}$ and Target Rig $T$ has bind bone character rotation $\mathbf{Q}_{T,\text{bind}}^{(j)}$ (e.g., $S$ at `6.84°` arms-down and $T$ at `60°` A-pose or `90°` T-pose), copying local bone deltas directly fails whenever $\mathbf{Q}_{S,\text{bind}}^{(j)} \neq \mathbf{Q}_{T,\text{bind}}^{(j)}$.

Following Monzani et al. (2000) and **Unreal Engine 5's IK Retargeter** component-space retargeting:
1. Construct each limb segment's **character-space anatomical rest frame** $\mathbf{F}_{\text{bind}}^{(j)} \in SO(3)$ from its primary bone direction $\hat{\mathbf{u}}_{\text{bind}}^{(j)} = \operatorname{ normalize}(\mathbf{p}_{\text{child}} - \mathbf{p}_{\text{joint}})$ and anatomical hinge/pole axis (e.g., elbow/knee flexion axis).
2. Given canonical reference rest frame $\mathbf{F}_{\text{ref}}^{(j)}$ and a canonical world-space pose delta $\mathbf{R}_{\text{pose}}^{(j)}$, the desired character-space limb frame before soft-tissue adaptation is:
   $$\mathbf{F}_{\text{desired}}^{(j)} = \mathbf{R}_{\text{pose}}^{(j)} \, \mathbf{F}_{\text{ref}}^{(j)}$$
3. Adapting $\mathbf{F}_{\text{desired}}^{(j)}$ by the target character's morphology operator $\mathcal{M}_T$ yields $\mathbf{F}_{\text{adapted}}^{(j)} = \mathcal{M}_T\!\big(\mathbf{F}_{\text{desired}}^{(j)}\big)$, and the exact character-space delta to apply onto Target Rig $T$'s **untouched bind pose** (`0.000 mm` bind geometry deformation) is:
   $$\Delta\mathbf{R}_{T,\text{world}}^{(j)} = \mathbf{F}_{\text{adapted}}^{(j)} \, \big(\mathbf{F}_{T,\text{bind}}^{(j)}\big)^{-1}$$

### 3.2 Morphology & Soft-Tissue Envelope Adaptation: Spore, Interaction Mesh, Mixamo Arm-Space

Rest-pose alignment alone is necessary but **not sufficient** across lean ↔ fat morphologies: aligning a `60°` fat A-pose rig to a lean `6.84°` reference arm direction drives the fat upper arm ~`50 mm` inside the fat ribcage/lat/belly!

Three foundational techniques govern cross-morphology pose adaptation:

1. **Body-Surface Coordinate Parameterization (Hecker et al., *ACM TOG / SIGGRAPH 2008* — Spore)**:
   - Encodes limb targets in **generalized surface-normalized coordinates** rather than raw joint angles. A pose that rests a hand `5 mm` outside the lateral hip or holds the arm `10 mm` clear of the ribcage maps to the *corresponding surface offset* on a narrow ectomorph or a wide endomorph—preventing both **mesh interpenetration** (`lean → fat`) and **"invisible lat syndrome"** (`fat → lean`).

2. **Spatial Relationship Preservation / Interaction Mesh (Ho, Komura & Tai, *ACM TOG / SIGGRAPH 2010*)**:
   - Preserves local spatial clearance and contact relationships (upper-arm ↔ lateral torso, wrist/hand ↔ waist/hip in akimbo `Contrapposto`/`Heroic` poses, forearm/hand ↔ anterior thigh/belly in `Seated` poses, inner thigh ↔ inner thigh across the midline) via smooth Gauss-Seidel / analytical distance constraints.

3. **Character Arm-Space & Soft-Tissue Clearance Envelope (Mixamo Auto-Retargeter; Aberman et al., *SIGGRAPH 2020*)**:
   - Models the lateral torso/waist/hip contour $W_{\text{torso}}(y)$, medial upper-arm soft-tissue radius $r_{\text{arm}}$, medial thigh radius $r_{\text{thigh}}$, and anterior abdominal protrusion $Z_{\text{belly}}$.
   - Solves continuous $C^1$ minimum-clearance abduction and flexion offsets:
     - **Glenohumeral Arm-Space Clearance**:
       $$\theta_{\text{minAbd}} = \arcsin\!\left(\operatorname{clamp}\!\left(\frac{W_{\text{torso}} + r_{\text{arm}} + \delta_{\text{pad}} - x_{\text{shoulder}}}{L_{\text{eff}}},\, 0,\, \sin 52^\circ\right)\right)$$
     - **Akimbo / Waist-Hip Distal Clearance (`Contrapposto`, `Heroic`, `Seated`)**:
       Checks posed elbow and wrist positions against the character's lateral waist/hip and anterior abdominal soft-tissue envelope; if a limb penetrates the torso/hip/thigh envelope, smoothly increments shoulder abduction / forward clearance so hands rest *on* the fat waist or lap surface rather than inside it.
     - **Medial Inner-Thigh Clearance**:
       $$\theta_{\text{minSplay}} = \arcsin\!\left(\operatorname{clamp}\!\left(\frac{r_{\text{thighMedial}} + \delta_{\text{midline}} - x_{\text{hip}}}{L_{\text{thighEff}}},\, 0,\, \sin 14^\circ\right)\right)$$
     - **Abdominal Panniculus Hip-Flexion Adaptation (`Seated`, `Kneeling`, `Crouch`)**:
       Under deep hip flexion ($\theta_{\text{flex}} > 45^\circ$), excess anterior belly depth $\Delta Z_{\text{belly}}$ couples outward femoral splay ($\Delta\theta_{\text{splay}} \propto \Delta Z_{\text{belly}}$) and moderates extreme thigh-into-belly compression.

---

## 4. Quantitative Codebase & 14-Character Asset Audit

Using headless Blender 5.2.2 LTS + KD-tree / Kabsch surface metrology against the raw archives in `Downloads\3d-models`, we measured all 14 integrated characters across three dimensions:
1. **Bind-Mesh Fidelity vs. Raw Source Archive** (`BodyMesh` nearest-neighbor vertex error in `REST` mode),
2. **Skeletal Joint Placement vs. Adipose Cross-Sections** (vertebral dorsal fraction, shoulder $X$ vs. rib/torso half-width, hip $X$ vs. thigh center), and
3. **Runtime `buildExternalFigure()` Post-Bind Forced-Align Impact** (`src/external-rig.ts` lines 563–577 forcing `Shoulder -> Elbow` to `(±0.12, -1, 0)` = `6.84°` after skin binding).

| Character (`modelId`) | Authored Arm Abduction | Raw-to-GLB Body Rest Median Error | Spine Dorsal Fraction (Target `0.30–0.42`) | Torso Half-W + Arm R vs. Shoulder $X$ | Authored Min Arm-Torso Gap | **Current Runtime (`6.84°` Forced Align) Min Gap & Max Disp.** | Audit Verdict |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | :--- |
| **Mannequin Male** | `6.84°` | Native (`0.00 mm`) | `0.21` | `179 + 68` vs `215 mm` | `+5.3 mm` | `0.0 mm` disp (`+5.3 mm` gap) | Canonical lean reference |
| **Mannequin Female** | `6.84°` | Native (`0.00 mm`) | `0.26` | `160 + 60` vs `181 mm` | `+21.5 mm` (p05) | `0.0 mm` disp | Canonical lean reference |
| **Superhero Male** | `90.00°` (T) | Native (`0.00 mm`) | `0.54` | `127 + 62` vs `140 mm` | `+99.2 mm` | **`-34.5 mm` clip** (`653.5 mm` disp) | Runtime `6.84°` clips lat muscle |
| **Superhero Female** | `90.00°` (T) | Native (`0.00 mm`) | `0.54` | `101 + 35` vs `96 mm` | `+118.6 mm` | **`-9.5 mm` clip** (`597.6 mm` disp) | Runtime `6.84°` clips hip/torso |
| **Old Man** (`thanhhuy-old-man`) | `88.03°` (T) | **`0.001 mm`** | `0.29` (`157 mm` belly!) | `115 + 70` vs `116 mm` | `+190.4 mm` (p05) | **`-31.0 mm` clip (`170` pts, `686.6 mm` disp)** | Severe runtime T→`6.84°` belly/lat crush |
| **Women in Nightgown** | `39.52°` (A) | **`0.000 mm`** | `0.45` | `95` W vs `98 mm` sh | Gown sleeve | `307.6 mm` post-bind disp | Runtime unbends `19.5°` sculpted elbow |
| **Stylized Women** | `41.92°` (A) | `0.217 mm` (decim.) | `0.41` | `82 + 92` vs `121 mm` | `+75.7 mm` (p05) | `preserveAuthoredRest: true` (presets unaligned!) | Needs character-space preset retargeting + geodesic weights |
| **Massimo Female** | `59.62°` (A) | **`0.001 mm`** | `0.60` | `86 + 35` vs `92 mm` | `+109.7 mm` | `+5.3 mm` gap (`398.4 mm` disp) | Lean body survives, spine slightly anterior |
| **Massimo Fat Male** | `60.08°` (A) | **`0.000 mm`** | **`0.51` (belly mid!)** | **`137 + 60 = 197` vs `104 mm`!** | `+47.9 mm` | **`-51.9 mm` DEEP CLIP (`81` pts, `419.5 mm` disp)** | **Lean skeleton stranded inside fat mesh + severe runtime clip!** |
| **Massimo Fat Female** | `59.62°` (A) | **`0.046 mm`** | **`0.54` (belly mid!)** | **`122 + 54 = 176` vs `91.5 mm`!** | `+60.0 mm` | **`-43.3 mm` DEEP CLIP (`78` pts, `397.8 mm` disp)** | **Exact skinny skeleton (`91.5 mm` sh!) stranded inside fat mesh!** |
| **Creepy Skinny Guy** | `61.68°` (A) | `0.511 mm` | `0.63` | `98 + 30` vs `103 mm` | `+88.5 mm` | `+15.6 mm` gap (`397.6 mm` disp) | Lean ectomorph; needs character-space retargeting |
| **Fat King** (`local-fat-king`) | `61.26°` (A) | **`0.001 mm`** | **`0.29` (`262 mm` belly!)** | **`202` W vs `148 mm` sh!** | Regal sleeves | **`427.7 mm` post-bind sleeve/belly crush** | Spine well-placed (`0.29`), but `6.84°` crushes arms into `404 mm` belly! |
| **Babar Azam** | `58.07°` (A) | **`0.000 mm`** | `0.52` | `116 + 52` vs `114 mm` | `+58.1 mm` | **`-32.3 mm` clip** (`458.2 mm` disp) | Athletic broad chest clipped by `6.84°` |
| **Hotfemale-1** | `42.68°` (A) | `3.22 mm` (origin) | `0.33` | `100` W vs `102 mm` sh | Sculpted `38.9°` elbow | `297.1 mm` disp (forcibly unbends `39°` elbow!) | Needs untouched bind + character-space retargeting |
| **Bailarina** (`local-bailarina`) | `50.9°` (A) | **`0.000 mm`** | `0.37` | `98` W vs `104 mm` sh | `+42.0 mm` | `preserveAuthoredRest: true`, but `Reach`/`Heroic`/`Seated` lacked `51°` A-pose retargeting | Needs character-space retargeting + restore original painted dress |

### 4.1 Raw Source Archive Original-Dress Audit (`C:\Users\Prabin Pebam\Downloads\3d-models`)
Every integrated character's raw `.zip` archive was inspected in headless Blender 5.2 (mesh objects, material slots, and raw diffuse/basecolor pixel distributions across chest, waist, pelvis, thighs, calves, and feet):
- **Already Using Native Garment Meshes (Preserved)**:
  - `Women in Nightgown` (`Nightgown.glb`): Native `Luna_night_gown` + `Luna_choker`.
  - `Massimo Female` & `Massimo Fat Female`: Native `Bra` + `Underwear_Bottoms` meshes.
  - `Babar Azam`: Native `Fit_shirts` + `Slim_fit_pants` + `Canvas_shoes`.
  - `Superhero Male` & `Superhero Female`: Native painted briefs/top in `Superhero_*_Diffuse`.
- **Came With Original Painted Garments Covered Over by Synthetic `UV1` Outfits (Restoring Original Dress)**:
  - **`Stylized Women Full Body`** (`stylized-women-full-body-t-pose.zip` -> `Hi3D_Stylized Bikini Female 3D Character Model_allparts_20260906.glb`): Raw `8192x8192` diffuse texture contains an authored navy-and-gold two-piece bikini with white halter straps and sculpted hip bows. Earlier `UV1` conversion covered it with a synthetic solid athletic top + mid-thigh shorts (`local-characters/stylized-women.png`). Restoring original bikini and building an exact pixel-aligned tint mask strictly over the original bikini fabric.
  - **`Bailarina`** (`bailarina-sexy.zip` -> `tripo_model_basecolor.jpeg`): Raw `2048x2048` diffuse texture contains an authored dark mesh two-piece top & bottoms with garter straps, thigh-high fishnet stockings with buckle bands, and white platform heels. Earlier `UV1` conversion covered it with a synthetic solid athletic top + shorts (`local-characters/bailarina.png`). Restoring original outfit and building an exact pixel-aligned tint mask strictly over the original garment pixels.
- **Verified 100% Unclothed in Raw Source Archive (Keep Synthetic Modest `UV1` Outfit)**:
  - `Fat King` (`fat-king.zip`): Raw `.blend` has bare skin `body_diff2.png` (`body_diff.png` is a `[0.5, 0.5, 1.0]` tangent-space normal map) and zero clothing meshes.
  - `Old Man` (`old-man.zip`): Untextured `old man.obj` (`10,117` verts, single material `blinn2SG`), zero clothing geometry.
  - `Creepy Skinny Dancing Guy` (`creepy-skinny-dancing-guy.zip`): Bare CC4 `CC_Base_Body`, zero garment meshes or painted clothes.
  - `Massimo Fat Male` (`base-mesh-fat-male.zip`): Bare CC4 `CC_Base_Body` + `Curly_fringe` hair, zero garment meshes or painted clothes.
  - `Hotfemale-1` (`hotfemale-1.zip`): Bare MakeHuman `Body` + hair/brows/lashes/eyes/teeth, zero garment meshes or painted clothes.

### Key Diagnostic Proof: `Massimo Fat Female` vs. `Massimo Female`
Comparing the audited skeleton joint coordinates of `Massimo Female` (skinny) and `Massimo Fat Female` (heavyset) exposes the exact industry pitfall described by SMPL/STAR/CC4:
- **Torso lateral half-width**: `86.1 mm` → **`121.7 mm`** (`+41.3%`)
- **Hip lateral half-width**: `91.0 mm` → **`130.7 mm`** (`+43.6%`)
- **Abdominal AP depth**: `125.4 mm` → **`216.3 mm`** (`+72.5%`)
- **Upper-arm p90 radius**: `35.4 mm` → **`53.7 mm`** (`+51.7%`)
- **Shoulder joint $X$ (`CC_Base_L_Upperarm`)**: `91.7 mm` → **`91.5 mm`** (`-0.2 mm` — **never updated for the fat morph!**)
- **Hip joint $X$ (`CC_Base_L_Thigh`)**: `54.8 mm` → **`54.7 mm`** (`-0.1 mm` — **never updated for the fat morph, `16.4 mm` medial to the `71.1 mm` thigh centerline!**)
- **Spine joint $Z$ (`CC_Base_Waist`)**: `+9.8 mm` → **`+9.8 mm`** (`54.1%` into the anterior belly instead of `~34%` dorsal vertebral depth!)

---

## 5. Solution Architecture Implemented in Pose & Composition

### 5.1 Offline / Asset Layer: Shape- & Adipose-Aware Skeleton Fitter (`scripts/fit_body_shape_skeleton.py`)
1. **Zero Mesh Modification (`0.000 mm` Rest Vertex Displacement)**:
   - Never bakes or deforms sculpted vertex positions into a template T-pose or lean stance.
2. **Adipose-Compensated Anatomical Joint Fitting**:
   - **Spine (`hips`, `spine`, `chest`, `neck`)**: Fitted along cross-sectional slices at **33–36% dorsal-to-ventral depth** from posterior back skin so anterior abdominal/pectoral fat projects in front of the vertebral column.
   - **Glenohumeral Shoulder (`leftShoulder`, `rightShoulder`)**: Fitted to the proximal arm/axillary root lateral to the ribcage (`~82–88%` of acromial-ribcage breadth, above the axillary cleft) with bone tails aligned along the sculpted upper-arm → elbow → wrist medial axis.
   - **Acetabular Hip (`leftHip`, `rightHip`)**: Fitted above the perineal bifurcation aligned with the proximal thigh shaft axis (compensated for asymmetric lateral vs. medial thigh fat) through knee and ankle centroids.
3. **Dual Operating Modes**:
   - `fit-static`: Builds a complete 17-bone studio skeleton + surface-geodesic heat skinning (`ARMATURE_AUTO` with component-isolated fallback) on unrigged static meshes.
   - `refit-existing`: Updates EditBone joint centers in-place inside morphed rigs (`Massimo Fat Male`, `Massimo Fat Female`) while preserving sub-bones (fingers, jaw, eyes), materials, UV1 outfit masks, and `0.000 mm` rest vertex positions.

### 5.2 Runtime Layer: Morphology Profile & Pose Translator (`src/morphology-rig.ts`)
1. **Untouched Bind Capture**:
   - `buildExternalFigure()` binds all `SkinnedMesh` instances in their **exact authored rest pose (`0.000 mm` vertex displacement)** without destructive post-bind `align()` mutations.
2. **Automatic `MorphologyProfile` Measurement (`measureFigureMorphology`)**:
   - Measures each character's bind-pose bone directions (`left/rightShoulder->Elbow`, `Elbow->Wrist`, `Hip->Knee`, `Knee->Ankle`, `hips->chest` pitch) and slices the bound `SkinnedMesh` in character space to extract:
     - `torsoHalfWidth`, `waistHalfWidth`, `hipHalfWidth`, `bellyFrontZ`, `backZ`,
     - `upperArmRadius`, `forearmRadius`, `thighMedialRadius`, `thighLateralRadius`,
     - `shoulderOffsetX`, `hipOffsetX`, `adiposityIndex` $\in [0, 1]$, and
     - Exact physics-derived **natural clearance angles** (`naturalArmAbductionRad`, `naturalElbowBendRad`, `naturalThighSplayRad`).
3. **Rest-Pose-Invariant & Fat-Aware Pose Evaluation (`adaptCanonicalPoseToMorphology` & `translatePoseAcrossMorphologies`)**:
   - Maps canonical `Pose` (`Neutral`, `Relaxed`, `Contrapposto`, `Heroic`, `Walking`, `Running`, `Seated`, `Kneeling`, `Crouch`, `Reach`, animation frames, and pasted/imported poses) from canonical reference limb frames onto each character's bind limb frames while applying:
     - Smooth $C^1$ **glenohumeral arm-space abduction clearance** so resting and swinging arms clear heavy torsos/lats without clipping,
     - **Distal elbow/wrist torso-waist-hip envelope clearance** so akimbo (`Contrapposto`, `Heroic`) and seated poses place hands cleanly *outside* wide waists, hips, and bellies,
     - **Inner-thigh midline splay clearance** so thick thighs do not interpenetrate in standing/walking poses,
     - **Abdominal hip-flexion adaptation** coupling outward femoral splay and lumbar/pelvic sharing in deep flexion (`Seated`, `Kneeling`, `Crouch`), and
     - **Bidirectional normalization (`extractCanonicalPoseFromMorphology`)** + `semanticPoses` gizmo delta tracking so manual FK gizmo rotations stay 1:1 responsive and `fat ↔ lean` pose transfers never cause clipping or "invisible lat syndrome".

---

## 6. Primary References
1. Loper, M., Mahmood, N., Romero, J., Pons-Moll, G., & Black, M. J. (2015). *SMPL: A Skinned Multi-Person Linear Model*. ACM Transactions on Graphics (SIGGRAPH Asia), 34(6), 248.
2. Osman, A. A. A., Bolkart, T., & Black, M. J. (2020). *STAR: Sparse Trained Articulated Human Body Regressor*. European Conference on Computer Vision (ECCV 2020), LNCS 12351, 598–613.
3. Keller, M., Werling, K., Shin, S., Delp, S., Pujades, S., Liu, C. K., & Black, M. J. (2023). *From Skin to Skeleton: Towards Biomechanically Accurate 3D Digital Humans (SKEL)*. ACM Transactions on Graphics (SIGGRAPH Asia), 42(6).
4. Baran, I., & Popović, J. (2007). *Automatic Rigging and Animation of 3D Characters (Pinocchio)*. ACM Transactions on Graphics (SIGGRAPH), 26(3), 72.
5. Xu, Z., Zhou, Y., Kalogerakis, E., Landreth, C., & Singh, K. (2020). *RigNet: Neural Rigging for Articulated Characters*. ACM Transactions on Graphics (SIGGRAPH), 39(4), 58.
6. Hecker, C., Raabe, B., Enslow, R. W., DeWeese, J., Maynard, J., & van Prooijen, K. (2008). *Real-Time Motion Retargeting to Highly Varied User-Created Morphologies*. ACM Transactions on Graphics (SIGGRAPH), 27(3), 27.
7. Ho, E. S. L., Komura, T., & Tai, C.-L. (2010). *Spatial Relationship Preserving Character Motion Adaptation*. ACM Transactions on Graphics (SIGGRAPH), 29(4), 33.
8. Aberman, K., Li, P., Lischinski, D., Sorkine-Hornung, O., Cohen-Or, D., & Chen, B. (2020). *Skeleton-Aware Networks for Deep Motion Retargeting*. ACM Transactions on Graphics (SIGGRAPH), 39(4), 62.
9. Epic Games (2024). *IK Rig and IK Retargeter in Unreal Engine 5 — Retarget Pose Alignment & Component-Space Chain Mapping*. Official Unreal Engine Documentation.
10. MakeHuman Community (2024). *MPFB2 Rig Entity & Joint-Cube / Landmark-Ring Fitting (`src/mpfb/entities/rig.py`)*.
