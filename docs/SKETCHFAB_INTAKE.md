# Sketchfab intake receipt | 2026-11-20

## Preset room intake

Processed the 12 supplied archives in
`%USERPROFILE%\Downloads\3d-models\room`: **11 usable interiors included**,
one rights exclusion. Converted assets, incremental catalog, source hashes,
individual receipts and the complete decision ledger remain in ignored
`local-rooms/`. All room assets are **private local-only evaluation**;
redistribution grants are unverified. No room binaries or catalog are bundled
into the public production build.

Uniform scale comes from actual architectural/furniture surfaces, not a fixed
outer bounding-box height. Roofs, skyline geometry and slab undersides do not
determine human scale. Stylized prop ratios are documented, not grounds for
excluding an otherwise usable room.

| Preset | Measured human-scale landmarks (m) | Interior ceiling (m) |
|---|---|---:|
| American school classroom | Door 2.003432; cupped seat center 0.406633, rim 0.415-0.424; school writing tablet 0.572833 | 3.007791 |
| Furnished apartment | Dining tabletop 0.754; door 2.13 | 2.396781 |
| Loft 17 - city views | Counter 0.894; upholstered seat 0.453 | 6.926 |
| Interior 15 - panoramic hall | Counter 0.900; sofa seat 0.456833 | 8.368720 |
| Industrial living room | Side-table top 0.749950; sofa seat 0.430216 | 4.721230 |
| Loft 16 - black sectional | Sofa cushion 0.470; low coffee table 0.425199 | 3.886454 |
| Loft 5 - city-window lounge | Sofa 0.470; armchair 0.484988; low coffee table 0.349667 | 4.210634 |
| Modern attic bedroom | Sleeping spread 1.8895 x 2.0974; mattress top 0.484600; bay-window sill, not a desk | 2.600869 |
| Modular vintage living room | Tabletop 0.750; chair seat 0.484957 | 3.567887 |
| Pink bedroom - ornate vanity | Bed length 2.021860; bedding top 0.618077; vanity 0.897242 and paired high chair 0.578273 | 2.578908 |
| Interior 14 - spacious mezzanine | Sofa seat 0.470 | 7.426837 |

Modern bedroom uses scale **0.45**, anchored to its king bed and actual roof
underside; the rear roof slope reaches 1.750398 m. The vanity stool is 0.4146 m
above bare floor (normalized seat landmark 0.398843 m relative to the rug
origin), and the low bay ledge is 0.57117 m above bare floor. The original
decorative **Rug is retained intact**, never flattened or omitted: its selected
walking triangle is grounded at zero, while native peripheral folds remain.
The verification policy is **5 micrometers at the origin**, and **at most
10 mm outer-ring variation only on this authored soft rug**. Other tested
surfaces retain the 5-micrometer floor tolerance.

Pink bedroom uses scale **0.43**, anchored to its bed and ceiling. Its taller
vanity/chair pair is intentional stylized furniture, not conflicting scale.
The earlier classroom 0.755 m "desktop" observation was a chair back: the door
and actual seat, not that bounding-box maximum, confirm scale.

The classroom clear origin was moved laterally to avoid a native 2.0786 mm floor
overlay; no geometry was flattened or vertically warped. Interior 15's background
`Sphere` and Interior 14's background `Sphere` / `Sphere.001` were excluded from
the posing exports, not from the original archives. Native furniture and rugs
remain. Only **Girls' Frontline 2: Exilium dormitory** is excluded: its public
listing explicitly describes Assets Studio game extraction, without a
rights-holder grant.

Runtime: lazy room loading, independent cloned materials/geometry, original
furniture colors/textures, transparent tagged glazing, persistent transforms,
visibility and reversible architectural cutaway. Combined window sills remain
opaque; only actual glazing is treated as glass. Unassigned glTF surfaces receive
a neutral nonmetal fallback without altering authored metallic materials.
Cutaway uses a wall's camera-side bounding extent rather than its centroid, so
long multi-segment Vintage walls cannot conceal the posing area. Furniture and
walking floors are never cut away.
Inactive GPU textures are released, but visited CPU templates remain available
for synchronous scene Undo/Redo; restored textures upload again. Removing a room
and repeatedly undoing/redoing its removal was verified without scene errors.

Verification: all 11 final GLBs were independently re-imported for walking-floor
and standing-volume ray checks. Each preset was also checked with a posed
1.75 m character in an isolated browser, all five render styles, and exact
IndexedDB room/pose reload. Nonzero transforms, visibility/cutaway flags and
poses additionally roundtripped through the actual app-exported JSON payload,
file-input import and named Library load, without native file-dialog automation.
Per-room screenshots remain in this session's `files/` directory. The original
character appearances requested by the owner are preserved; room integration
does not replace their authored outfits.

### Remaining-four sequential intake

**Stylized Women Full Body - T pose** by **lawlietrecluze** —
[listing](https://sketchfab.com/models/7100adc9b611495b9a56894cb253458c),
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
The public API was rechecked and the supplied GLB inspected in headless Blender:
adult proportions, native sculpted long hair, an unrigged A-stance (despite the
listing's T-pose title). Enabled as **Stylized Women Full Body**, development-only.
No new redistribution decision is implied by local availability.

Changes: fitted 17-bone skeleton with measured sagittal/limb cross-sections,
normalized four-influence skin weights, opaque athletic top and mid-thigh shorts,
2048-square UV1 unpremultiplied RGBA outfit mask with baked cavity AO and seam
shading; original skin UV0/albedo retained. Native pink hair is segmented into
`SculptedHair`, weighted to the head and independently tinted over neutralized
native hair shading (the default remains pink). No studio hair or
hairstyle dropdown. No sculpted posture was changed or baked into a lean stance.
`preserveAuthoredRest` bypasses the legacy source arm realignment for this entry.
Height: 1.75 m; neutral skinned sole: 0.000 m. Neutral skin displacement rounds to
0.000 mm (all vertices checked against unskinned bind geometry).

The initial 40k reduction failed the owner's 0.5 mm gate and was discarded.
The accepted 249,999-triangle reduction was certified bidirectionally against
the original entire triangle surfaces, not just selected vertices: adaptive
patches bounded distance to a single opposite triangle by convexity. Certified
Hausdorff upper bound: **0.499800 mm**; vertex-to-surface maxima: 0.308100 mm
forward / 0.145324 mm reverse. Only uniform scaling and sole translation were
applied in addition to reduction; material/UV/weight changes do not change vertices.

Verification: source-rig tests 13/13 (including all pre-existing source entries);
all 17 joints deform skin, normalized `JOINTS_0`/`WEIGHTS_0`, independent skin,
outfit and native hair tints on two instances, Walking/Reach, and IndexedDB reload
verified in an isolated local browser. Screenshot:
`%USERPROFILE%\.copilot\session-state\ac79c6c1-4279-40e5-bd45-ceecac2e9001\files\stylized-verified.png`.
Source ZIP SHA-256: `8739e77236881d2a08d155aa82a088ba53799d4d0206d425109fcac03c6d94ee`;
integrated GLB: `56ae15beb5d7d2b881f213eab2cbd543ae9e48e1d278a5b156151cb0cb584136`.

**Base Mesh** by **enzohao** — [API](https://api.sketchfab.com/v3/models/d45729d834f34a38bfc466cc161fc08e).
Public metadata still says CC BY 4.0. Headless Blender confirms adult proportions,
static native T-stance, 53,406 polygons, no armature, and native hair/brow slots.
However, inspecting the actual FBX material image paths resolves the earlier
`pc_*_nk_*` provenance question: the body, face, brow and hair paths explicitly
name **Rise of Eros**. This is a commercial-game component signal, not a generic
adult-base provenance clearance. The uploader's CC BY label is not a rights-holder
grant for those components. **Skipped; no converted studio entry enabled.**
Continued immediately to Bailarina rather than treating this newly discovered
game-asset issue as permission to reuse it.

**Bailarina sexy** by **SALOMON13** —
[listing](https://sketchfab.com/models/4ec50fd369b640ba9dcd7947b169e0ab),
[Free Standard terms](https://sketchfab.com/licenses), sections 2.1/2.2.
This is **not CC BY**. Private adaptation/use by the supplied-archive licensee
is distinct from raw-file redistribution: **local single-seat evaluation only**,
not a public downloadable character, not licensed for distribution in `dist`.
No additional grant or CC license is claimed.

Headless inspection confirms an adult static A-stance OBJ, no armature/animation
or authored dance bind. All 23,871 original vertices / 47,762 triangles retained;
no decimation, posture warp, or posed geometry bake. Uniform orientation/height
normalization only. Fitted 17 bones to this sculpt's cross-sections, including its
native arm depth/leg stance; sagittal torso bones sit 37.5% from the posterior
surface. `preserveAuthoredRest` retains the authored stance and reconciles
float32 GLB inverse-bind rounding against the exact runtime rest transforms.
Neutral skin displacement rounds to 0.000 mm; height 1.72 m, sole 0.000 m.

Original skin/albedo remains on UV0; separate 2048-square RGBA UV1 athletic
top/mid-thigh shorts mask carries baked cavity AO and smooth seam/edge shading.
Native front and back curls are segmented as `SculptedHair` and follow the head,
with neutralized hair shading for literal independent hair colors. Hair tints do
not recolor the face or anterior garment. No external hair or hairstyle selector.
Source tests **14/14**; picker spawn, actual duplicate, Walking/Reach, independent
skin/outfit/hair tints and IndexedDB reload verified in the isolated local browser.
Screenshot:
`%USERPROFILE%\.copilot\session-state\ac79c6c1-4279-40e5-bd45-ceecac2e9001\files\bailarina-verified.png`.
Source ZIP SHA-256: `ca8df25c6005394b4cd13c3bc50f9667e38ef9588ff552bdbae20c10798c5b0e`;
integrated GLB: `f1246a633b65dd8bd4fee4eda70949480a65330541b13838342a26947860ee5e`.

**Elli** by **Joey_Joe_Joe_Jun** —
[API](https://api.sketchfab.com/v3/models/785b135da133419592e90f11bf5bd3b7).
CC BY 4.0 and the age-restricted flag were rechecked. The supplied USDZ contains
ten static mesh chunks, 951,446 triangles, no armature/animation, and native short
hair. Blender's world-space height is 1.69148 m; featureless front/side silhouettes
show long-limbed proportions. A separate head-only inspection, without exposed
anatomy, shows a youthful face with large eyes, rounded cheeks and a soft jaw.
The supplied nude subject is therefore **not unambiguously adult**; the listing
and embedded credit provide no adult-age confirmation. Under the strict safety
gate, **skipped immediately after inspection**, with no rigging, clothing
conversion or studio entry. This is a conservative age-ambiguity decision,
not a claim of a verified age or franchise identity. Neither the filename nor
the uploader's CC label resolves that safety question.

**Final sequential-intake verification:** `npm test` passes **122/122** across
11 files; `npm run build` passes TypeScript and Vite production build. All
11 previous rigged characters remain in the tested catalog, with two additions
for **13 rigged characters** total (plus the procedural mannequins).
The default test pool passed in this final run; an earlier native V8 fork crash
was checked with the existing thread pool, without weakening assertions.
Production output has neither local character assets/catalog nor the new model
labels/paths in its JavaScript bundle. The original Vite server still responds
HTTP 200 on `127.0.0.1:5173`; no push or server restart.

Stylized Women's final neutral-shading GLB was additionally checked on two
browser instances after reload: exact native hair, outfit/skin uniforms,
positions and all 17 bone transforms round-trip. Final screenshot:
`%USERPROFILE%\.copilot\session-state\ac79c6c1-4279-40e5-bd45-ceecac2e9001\files\stylized-final-verified.png`.
Reviewed landmark configurations and Blender conversion reports remain in the
persistent session's `files\stylized\` and `files\bailarina\` directories.
`scripts/rig-static-studio.py` consumes the inspected blend, reviewed
`config.json`, and output directory; `scripts/finish-studio-atlas.py` consumes
that output and packages the ignored local GLB/PNG. They do not acquire assets
or change a sculpt into a generic rest posture.

### Supplied-folder integration update (supersedes earlier acquisition counts)

**Local-only evaluation update:** Massimo Female, Massimo Fat Male, and
Massimo Fat Female are tested development-only entries. Their files and manifest
reside in ignored `local-characters/`, not the deployable public tree.
This does not change any public redistribution decision below. The females
retain their native hair and separate bra/bottoms. The male uses a second UV
set for a shirt and trousers and retains the original skin and hair textures.
The male/female fat bases are distinct FBXs, not proportions on another model.
Old Man now uses a separate 2048-square RGBA outfit atlas on the body itself.
Hair color tints the original scalp and both sculpted brows (628 triangles);
no additional hair mesh or hairstyle selector is used.

16 source ZIPs inventoried. Local picker availability and redistribution are
separate decisions. No new downloads.

| Supplied archive | Decision |
|---|---|
| `women-in-nightgown.zip` | Native rig, opaque gown and weighted hair integrated under [CC BY-SA](../public/models/unique/nightgown/NOTICE.txt). Excluded Rawpixel lash and externally referenced brows, dental and eye assets. |
| `old-man.zip` | Generic full-body OBJ integrated under [CC BY](../public/models/unique/old-man/NOTICE.txt) with new armature, weights and clothing. MTL and textures were absent. |
| `base-mesh-female-with-rig-and-textures.zip` | Confirmed CC_Base markers. Private evaluation is not redistribution clearance. |
| `base-mesh-fat-male.zip` | Its own FBX contains CC_Base_Body and CC_Base_Hip; no standalone grant identified. |
| `base-mesh-fat-female.zip` | Independently confirmed the same vendor markers in this FBX; no standalone grant identified. |
| `creepy-skinny-dancing-guy.zip` | Local picker verified: standing rest pose, mapped CC bones, second-UV clothing and fitted hair. Source motion not included; not cleared for redistribution. |
| `babar-azam-pakistans-star-cricketer.zip` | Local picker verified after grounding on the leg primitive and fixing skin, eye and hair opacity. Separate shirt/trousers and native beard/hair tints. [Listing](https://sketchfab.com/models/6b258a1940de49c889b7cae25ed6a94b) by abrarrajput is CC BY; the FBX also names Aprilysh Eliot Hair G3M. Likeness and component redistribution are not cleared. |
| `fat-king.zip` | Local picker verified: original metarig with consolidated DEF weights, textured body with a separate garment mask and native tinted hair. Source references `Kill_the_King`; not cleared for redistribution. |
| `base-mesh.zip` | Adult proportions inspected. Actual FBX texture paths explicitly name Rise of Eros; no rights-holder grant. Skipped, no rigged entry. |
| `hotfemale-1.zip` | Local picker verified. The MakeHuman source identifies adult and middle-aged components. Rebuilt the upright bind against the original vertices, retained native hair/brows, and added a 2048-square garment mask on UV1. No standalone redistribution clearance. |
| `elli.zip` | Actual USDZ/silhouettes and head inspected. Youthful face; the nude subject is not unambiguously adult. Skipped under the strict safety gate; no rigged entry or verified franchise/age claim. |
| `bailarina-sexy.zip` | Adult sculpt verified; native A-stance 17-joint rig, UV1 athletic outfit and native hair tints verified for local single-seat use only. Free Standard, not CC BY or raw redistribution clearance. |
| `stylized-women-full-body-t-pose.zip` | Adult proportions inspected; fitted native A-stance rig, UV1 athletic outfit and segmented native pink hair verified locally. See the remaining-four receipt above. |
| `ashley-game-nude-1-of-2.zip` | Named game-character package; no rights-holder grant. |
| `street-fighter-cammy-tpose-bikini.zip` | Named Street Fighter derivative; no franchise permission supplied. |
| `charlotte-nude-fortnite-nsfw-unrigged.zip` | Named Fortnite content; uploader disclaims ownership. |

SHA-256 (source ZIP → integrated GLB):

- Women in Nightgown: `a2ae55fdc248c1091be711eb6f75019da06168d32ba64025078fadbda65a37f2` → `c82a8f0b03f1bebfff506827632242f4ac61821cf7d10803905361703ac7afdb`.
- Old Man: `841f7607c9930b6b61b5c62b4dfb8d9db82b106f19f2801dfc1631f89f73176f` → `435b77ce240baf95a442dec9446d7f136885198ef9385a9e2fcbe565419a9570`.

### Earlier acquisition record

**26 listings inspected; one source ZIP verified, zero GLBs cleared to ship.** This is an acquisition record, not a shipping manifest. The existing Quaternius pair is separate. No MetaHumans or substitutes.

**Next downloads:** [Massimo heavyset male](https://sketchfab.com/models/d530917b05574610b736b825109543a8) and [heavyset female](https://sketchfab.com/models/39b02455c6854578a46eed4964852792). Use official Download 3D Model archives with textures and notices, identified by UID, **outside the public tree**. Inspect their provenance independently; no passwords, cookies or tokens. Do not download the first female a second time.

**Local receipt — Massimo female:** `%USERPROFILE%\Downloads\base-mesh-female-with-rig-and-textures.zip`; 126,637,902 bytes, SHA-256 `321df6472893612f2953cf6dfe8f8c1a953064b31bedde61ba6fa9f04dcb27c9`. All ZIP CRCs pass. Contains `source/Base_Mesh_Skinny_Female.fbx` and 43 PNGs including hair, bra and underwear maps; no license notice. The FBX contains `CC_Base_Body` and `CC_Base_Hip`, markers consistent with Reallusion Character Creator. This does not prove which components came from a vendor, but the uploader's CC BY tag does not resolve it. [Reallusion content policy](https://www.reallusion.com/license/content.html) distinguishes export/project use from distribution of reusable content. Require documented ownership or standalone redistribution rights covering the body, hair, outfit and textures before processing or publication.

## What the receipt establishes

- Each title below links to its official `GET /v3/models/{uid}` response (including `viewerUrl`, `user`, `license`, description, tags and download flag). Names are uploader display names, **not** findings of ownership. All 24 rows except the two marked **Fab** had `isDownloadable: true`; an anonymous `GET /v3/models/{uid}/download` returned **401, “Authentication credentials were not provided.”** The two Fab referrals had `license: null`, `isDownloadable: false`; the linked storefronts returned 403 to this client. No alternate host, viewer cache, browser session or credential was used to obtain media.
- **BY** = [Sketchfab license record](https://api.sketchfab.com/v3/licenses/322a749bcfa841b29dff1e8a1bb74b0b) → [CC BY 4.0, section 2(a)(1)](https://creativecommons.org/licenses/by/4.0/legalcode.en). For material the licensor controls, this expressly permits reproduction, sharing and adapting, including distribution of the adapted file itself. **BY-SA** = [Sketchfab record](https://api.sketchfab.com/v3/licenses/b9ddc40b93e34cdca1fc152f39b9f375) → [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/legalcode.en); publish the adapted model under the same license here. Neither cures unauthorized uploads or clears likeness rights.
- For each cleared CC asset, use **“[title] by [creator] — [viewerUrl], [linked license]. Changes: [actual rigging, clothing, materials and conversion].”** Retain supplied credits, copyright, license and disclaimer notices (including for components), disclose prior modifications when supplied, and put accessible notices alongside the public download. No suggestion of endorsement or additional legal/technical restrictions. Do not list unshipped candidates as shipped credits.
- **Standard** = [provider Free Standard record](https://api.sketchfab.com/v3/licenses/72eb2b1960364637901eacce19283624); not affirmative permission to distribute a standalone raw file. A referral, store purchase or [Fab Standard license](https://www.fab.com/eula) likewise does not establish that right. Obtain an explicit separate grant covering the downloadable mesh, rig **and** textures or omit. A CC listing with third-party signals requires authorization from the actual rights holders; a ZIP alone cannot lift that hold.
- **Candidate** means no specific conflicting franchise/asset-store claim identified in the metadata, not visual, technical or legal sign-off. **Hold** means do not acquire for integration unless the stated issue is resolved. Age-restricted flags are not proof of depicted age; exclude sexualized minors and do not source ambiguous sexualized characters.

## Per-model decisions

| Official listing / evidence | Creator | Terms | Decision and next action |
|---|---|---|---|
| [Base Mesh Female with Rig and Textures](https://api.sketchfab.com/v3/models/cae1b75bea294b6bae9ab5d06c086089) | Massimo Javer | BY | Archive verified; rights hold. See the local receipt above. Do not integrate or publish. |
| [Base Mesh - Fat Male](https://api.sketchfab.com/v3/models/d530917b05574610b736b825109543a8) | Massimo Javer | BY | Priority candidate. Advertised A-pose, rigged FBX. Confirm bones, neutral bind and materials. |
| [Base Mesh - Fat Female](https://api.sketchfab.com/v3/models/39b02455c6854578a46eed4964852792) | Massimo Javer | BY | Priority candidate. Advertised rigged FBX. Same reported face/vertex counts as first female; verify distinct silhouette, not merely a renamed file. |
| [Until Dawn - Jessica Underwear](https://api.sketchfab.com/v3/models/93a79dbbe307438182c9b6a0ca988104) | VITU6018 | BY | Hold: named game character, possible extracted asset; no rights-holder grant. |
| [Stylized Women Full Body - T pose](https://api.sketchfab.com/v3/models/7100adc9b611495b9a56894cb253458c) | lawlietrecluze | BY | Hold: Rapid Assets generation; “girl” with sexualized tags. Neither adult depiction nor rights in inputs established. |
| [Women in Nightgown](https://api.sketchfab.com/v3/models/06a185b36435427baec8d510bdcffccb) | work of Pseudonym | BY-SA | Conditional candidate. Author calls it their work and requests credit. Keep adapted GLB BY-SA, verify fabric transparency and any external components. |
| [Streer Fighter Juri Han T pose](https://api.sketchfab.com/v3/models/3b7fc93f59c04a668c108961168cf967) | lawlietrecluze | BY | Hold: named Street Fighter character; generator does not confer franchise rights. |
| [Street Fighter Cammy Tpose Bikini](https://api.sketchfab.com/v3/models/672560dce9494d76a735429d18c57fc8) | lawlietrecluze | BY | Hold: named Street Fighter character; no franchise authorization. |
| [Elizabeth Female 3 d Character](https://api.sketchfab.com/v3/models/9ac58e6a4f304c77ad915567b4ec5599) | Mesh Artech | BY | Hold for provenance: generic marketing description does not identify source. Name alone does not establish a franchise connection; verify original character and components. |
| [walking and dancing woman](https://api.sketchfab.com/v3/models/87fcc917c1c049acac1e449fcad4dc9e) | 3D Arena | BY | Hold for provenance: empty description, animation advertised. Establish mesh, clothing and motion sources separately. |
| [Sexy girl in black suit](https://api.sketchfab.com/v3/models/6ac6ce7599dc4faeb170e78147cae98e) | edu | BY | Hold: sexualized, age ambiguous; rig claim is not an age or source check. |
| [Daz Lady 1](https://api.sketchfab.com/v3/models/86dfc6b10626429481ccb14efd40a8fa) | forest | BY | Hold: Daz named. Require raw redistribution and adaptation grant for every Daz/vendor component; interactive use is not enough. |
| [Base Mesh](https://api.sketchfab.com/v3/models/d45729d834f34a38bfc466cc161fc08e) | enzohao | BY | Hold: age-restricted, “girl” tag and no description. Age, content and provenance not established. |
| [Creepy Skinny Dancing Guy](https://api.sketchfab.com/v3/models/3127f9c41c6f4415af9f73e95fa4b22c) | Roman | BY | Conditional candidate: naked/high-resolution tags; verify adult neutral anatomy, source of dance, usable neutral bind, performance and opaque outfit. |
| [Rigged Anime Girl Base Mesh 4](https://api.sketchfab.com/v3/models/d7bd93a808704fa0bdda240eaab52539) | vukhiemton | None / Fab | Hold: [Fab referral](https://fab.com/s/1b3ec566fd9b), no raw grant shown. Do not assume the storefront terms. |
| [Rigged Anime Male & Female Character Base](https://api.sketchfab.com/v3/models/b3ad28cfce01403d9f3c0d5842d7e90c) | vukhiemton | None / Fab | Hold: [Fab referral](https://fab.com/s/0c7f7a61848e), no raw grant shown for either character. |
| [Bailarina sexy](https://api.sketchfab.com/v3/models/4ec50fd369b640ba9dcd7947b169e0ab) | SALOMON13 | Standard | Hold: no standalone grant, sexualized tags with no age/provenance evidence. |
| [Elli](https://api.sketchfab.com/v3/models/785b135da133419592e90f11bf5bd3b7) | Joey_Joe_Joe_Jun | BY | Hold: age-restricted, no description, unidentified character. Verify origin, adult depiction and rights; do not infer identity from name. |
| [Hotfemale-1](https://api.sketchfab.com/v3/models/091c8b0d411840c482bc2ea25befa0ad) | HN Studio | BY | Hold: sexualized nude tags; no reliable adult depiction or source evidence. |
| [Old Man](https://api.sketchfab.com/v3/models/6ee41257347e4c9ca1b189ff6a5ce378) | thanhhuy2020 | BY | Candidate. High-poly per author; no rig promised. Verify original geometry/likeness and retopologize/weight if necessary. |
| [Ashley_game_nude 1 of 2](https://api.sketchfab.com/v3/models/18389714fd704e7987c7cf3cfd6ccc9b) | silentgamer55yt | BY | Hold: apparent nude game character, age-restricted, no source or permission. No extraction or assembly. |
| [Charlotte Nude - Fortnite - NSFW - Unrigged](https://api.sketchfab.com/v3/models/13e5373a6fc54c2088869422dbf5b2e0) | Zenirtye | Standard | Hold: named Fortnite character; uploader explicitly says “MODEL NOT MINE.” No standalone grant or owner credit. |
| [Fat_King](https://api.sketchfab.com/v3/models/3708b0bedf8d47efafe22bea1c00a951) | RubenBuchholz644c9d600cf24bcb | BY | Hold for provenance: no description, no source evidence for character or components. Seek original author confirmation. |
| [Male_Skinny_Base_Mesh](https://api.sketchfab.com/v3/models/395e9d2456ff41b38ae51d6b44fc6ac6) | Raj_Kumar_Jadhav | BY | Shortlist candidate. Generic male base, minimal description; verify source and inspect topology before weighting. |
| [Stylized Female Base Mesh](https://api.sketchfab.com/v3/models/ed45a59e679243be925ba34824d3b45f) | ijiklvn | BY | Shortlist candidate. Described as Blender-created with normal map; verify map and topology. No native rig promised. |
| [Chibi Base](https://api.sketchfab.com/v3/models/2e7dce8e19d64a71a765acf3f9ea959a) | Garrett Miller | BY | Shortlist, defer: expressly unrigged without clothes/hair/mouth; childlike design. Only consider nonsexual stylized reference with opaque authored clothing; do not ship a nude or sexualized childlike figure. |

## File acceptance and runtime handoff

For each supplied archive, record its UID, official source, acquisition date and SHA-256. Inventory and check component notices before moving anything into `public`. Do not execute embedded scripts. Preserve author materials, verify separate skin/outfit tint regions or author a UV-aligned mask; provide a neutral opaque outfit where needed. Keep eyes and hair independently shaded. A static mesh parented to bones is not a weighted rig.

Deliver only verified, local GLBs under `public/models/unique`. With each, give runtime the exact native node name for each of `hips`, `spine`, `chest`, `neck`, `head`, `leftShoulder`, `leftElbow`, `leftWrist`, `rightShoulder`, `rightElbow`, `rightWrist`, `leftHip`, `leftKnee`, `leftAnkle`, `rightHip`, `rightKnee`, `rightAnkle`; retain bind transforms. Record measured standing height/ground offset, head attachment and hair fit (or explicitly bald), material names/mask convention, final size/hash, credits and license notice. Verify nonzero normalized weights, matching inverse binds, independently moving left/right arms and legs, head/hair alignment, reversible neutral pose and texture loading. None of these technical values can be inferred from API tags.
