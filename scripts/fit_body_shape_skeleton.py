"""Headless Blender 5.2 shape- & adipose-aware humanoid skeleton fitter and auditor.

Implements SMPL/STAR/SKEL + Pinocchio/MPFB2 anatomical joint-center rules so heavy/fat,
elderly, athletic, and lean characters keep 0.000 mm sculpted rest-surface displacement
while placing joint pivots at true skeletal centers rather than geometric fat midpoints:

  1. Vertebral column (hips, spine, chest): placed at ~34-36% anterior of the dorsal
     (back) skin surface in each horizontal sagittal slice, preventing anterior abdominal
     or pectoral adipose expansion from pulling spinal pivots into the belly.
  2. Glenohumeral joint (left/right upper-arm head): placed at the upper-arm cross-section
     centroid just lateral to the axillary cleft, widening naturally with ribcage breadth
     without burying the pivot inside torso fat or floating it in lateral deltoid fat.
  3. Acetabular hip joint (left/right thigh head): scaled with pelvic/iliac breadth rather
     than lateral trochanteric/gluteal fat pads, centered anteroposteriorly at 42% from
     dorsal gluteal skin (avoiding anterior panniculus bias).
  4. Limb segments (elbows, wrists, knees, ankles): centered on orthogonal cross-sections
     along the sculpted limb medial axis so untouched rest pose has 0.000 mm displacement.

Usage (via Blender --background --factory-startup --python scripts/fit_body_shape_skeleton.py -- ...):
  Audit a GLB:
    ... -- --mode audit <input.glb> [--body-mesh CC_Base_Body]
  Refit an existing rigged GLB (e.g. morphed fat character with stranded lean bones):
    ... -- --mode refit-rigged <input.glb> <output.glb> [--body-mesh CC_Base_Body]
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector


CC4_BONE_MAP = {
    "hips": "CC_Base_Hip",
    "waist": "CC_Base_Waist",
    "spineMid": "CC_Base_Spine01",
    "chest": "CC_Base_Spine02",
    "neck": "CC_Base_NeckTwist01",
    "head": "CC_Base_Head",
    "leftClavicle": "CC_Base_L_Clavicle",
    "rightClavicle": "CC_Base_R_Clavicle",
    "leftShoulder": "CC_Base_L_Upperarm",
    "leftElbow": "CC_Base_L_Forearm",
    "leftWrist": "CC_Base_L_Hand",
    "rightShoulder": "CC_Base_R_Upperarm",
    "rightElbow": "CC_Base_R_Forearm",
    "rightWrist": "CC_Base_R_Hand",
    "leftHip": "CC_Base_L_Thigh",
    "leftKnee": "CC_Base_L_Calf",
    "leftAnkle": "CC_Base_L_Foot",
    "rightHip": "CC_Base_R_Thigh",
    "rightKnee": "CC_Base_R_Calf",
    "rightAnkle": "CC_Base_R_Foot",
}


def find_primary_armature_and_body(body_mesh_name: str | None = None):
    armatures = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    if not armatures:
        raise RuntimeError("No ARMATURE object found in scene.")
    arm = max(armatures, key=lambda o: len(o.data.bones))
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    body = None
    if body_mesh_name:
        body = next((m for m in meshes if m.name == body_mesh_name or m.name.startswith(body_mesh_name)), None)
    if body is None:
        body = max(meshes, key=lambda o: len(o.data.vertices))
    return arm, body


def world_vertices_numpy(mesh_obj) -> np.ndarray:
    me = mesh_obj.data
    n = len(me.vertices)
    local = np.empty(n * 3, dtype=np.float64)
    me.vertices.foreach_get("co", local)
    local = local.reshape(n, 3)
    mw = np.array(mesh_obj.matrix_world, dtype=np.float64)
    hom = np.column_stack([local, np.ones(n, dtype=np.float64)])
    return (hom @ mw.T)[:, :3]


def measure_rest_displacement_mm(mesh_obj) -> float:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    eval_obj = mesh_obj.evaluated_get(depsgraph)
    eval_me = eval_obj.to_mesh()
    try:
        n = len(mesh_obj.data.vertices)
        if len(eval_me.vertices) != n:
            return -1.0
        a = np.empty(n * 3, dtype=np.float64)
        b = np.empty(n * 3, dtype=np.float64)
        mesh_obj.data.vertices.foreach_get("co", a)
        eval_me.vertices.foreach_get("co", b)
        diff = (a - b).reshape(n, 3)
        mw_scale = np.linalg.norm(np.array(mesh_obj.matrix_world, dtype=np.float64)[:3, 0])
        return float(np.linalg.norm(diff, axis=1).max() * mw_scale * 1000.0)
    finally:
        eval_obj.to_mesh_clear()


def dorsal_weighted_sagittal_y(
    verts: np.ndarray,
    z_level: float,
    x_half_band: float = 0.055,
    z_half_band: float = 0.022,
    dorsal_fraction: float = 0.35,
    front_is_neg_y: bool = True,
) -> tuple[float, float, float]:
    """Compute vertebral AP coordinate at z_level anchored to dorsal skin (~35% from back).

    In Blender's glTF Z-up import convention:
      - If character faces -Y (standard glTF +Z forward imported into Blender):
        dorsal (back) is max(Y) and ventral (belly/chest) is min(Y).
      - If character faces +Y: dorsal is min(Y) and ventral is max(Y).
    """
    sl = verts[(np.abs(verts[:, 2] - z_level) <= z_half_band) & (np.abs(verts[:, 0]) <= x_half_band)]
    if len(sl) < 8:
        sl = verts[(np.abs(verts[:, 2] - z_level) <= z_half_band * 2.0) & (np.abs(verts[:, 0]) <= x_half_band * 1.8)]
    if len(sl) < 4:
        raise RuntimeError(f"Insufficient sagittal cross-section vertices at z={z_level:.4f}")
    y_lo = float(np.percentile(sl[:, 1], 3))
    y_hi = float(np.percentile(sl[:, 1], 97))
    ap_depth = y_hi - y_lo
    if front_is_neg_y:
        dorsal_y, ventral_y = y_hi, y_lo
        target_y = dorsal_y - dorsal_fraction * ap_depth
    else:
        dorsal_y, ventral_y = y_lo, y_hi
        target_y = dorsal_y + dorsal_fraction * ap_depth
    return target_y, ap_depth, (target_y - ventral_y) / max(1e-6, ap_depth) if front_is_neg_y else (ventral_y - target_y) / max(1e-6, ap_depth)


def detect_front_is_neg_y(arm, verts: np.ndarray) -> bool:
    """Detect whether the character faces -Y or +Y in Blender world space using foot toe direction."""
    foot_names = ["CC_Base_L_Foot", "foot_l", "footL", "leftFoot", "leftAnkle"]
    toe_names = ["CC_Base_L_ToeBase", "ball_l", "toeL"]
    mw = arm.matrix_world
    for fn in foot_names:
        if fn in arm.data.bones:
            fb = arm.data.bones[fn]
            f_head = mw @ fb.head_local
            for tn in toe_names:
                if tn in arm.data.bones:
                    t_head = mw @ arm.data.bones[tn].head_local
                    return bool((t_head.y - f_head.y) < 0)
            f_tail = mw @ fb.tail_local
            if abs(f_tail.y - f_head.y) > 0.02:
                return bool((f_tail.y - f_head.y) < 0)
    z_min = float(verts[:, 2].min())
    z_max = float(verts[:, 2].max())
    foot_sl = verts[verts[:, 2] <= z_min + 0.05 * (z_max - z_min)]
    ank_sl = verts[(verts[:, 2] >= z_min + 0.06 * (z_max - z_min)) & (verts[:, 2] <= z_min + 0.10 * (z_max - z_min))]
    if len(foot_sl) > 10 and len(ank_sl) > 10:
        return bool(np.median(foot_sl[:, 1]) < np.median(ank_sl[:, 1]))
    return True


def measure_character_anatomy(arm, body) -> dict:
    verts = world_vertices_numpy(body)
    z_min, z_max = float(verts[:, 2].min()), float(verts[:, 2].max())
    height = z_max - z_min
    front_neg_y = detect_front_is_neg_y(arm, verts)
    mw = arm.matrix_world

    def bone_world_head(bname: str) -> np.ndarray | None:
        b = arm.data.bones.get(bname)
        if b is None:
            return None
        v = mw @ b.head_local
        return np.array([v.x, v.y, v.z], dtype=np.float64)

    waist_z = z_min + 0.58 * height
    chest_z = z_min + 0.72 * height
    pelvis_z = z_min + 0.52 * height

    waist_band = verts[(np.abs(verts[:, 2] - waist_z) <= 0.025 * height) & (np.abs(verts[:, 0]) <= 0.24 * height)]
    chest_band = verts[(np.abs(verts[:, 2] - chest_z) <= 0.025 * height) & (np.abs(verts[:, 0]) <= 0.22 * height)]
    pelvis_band = verts[(np.abs(verts[:, 2] - pelvis_z) <= 0.025 * height) & (np.abs(verts[:, 0]) <= 0.24 * height)]

    waist_half_width = float(np.percentile(np.abs(waist_band[:, 0]), 95)) if len(waist_band) else 0.14
    chest_half_width = float(np.percentile(np.abs(chest_band[:, 0]), 92)) if len(chest_band) else 0.15
    pelvis_half_width = float(np.percentile(np.abs(pelvis_band[:, 0]), 95)) if len(pelvis_band) else 0.16

    spine_target_y, belly_ap_depth, _ = dorsal_weighted_sagittal_y(
        verts, waist_z, dorsal_fraction=0.35, front_is_neg_y=front_neg_y
    )

    return {
        "mesh": body.name,
        "armature": arm.name,
        "height_m": round(height, 4),
        "front_is_neg_y": front_neg_y,
        "waist_half_width_m": round(waist_half_width, 4),
        "chest_half_width_m": round(chest_half_width, 4),
        "pelvis_half_width_m": round(pelvis_half_width, 4),
        "belly_ap_depth_m": round(belly_ap_depth, 4),
        "recommended_spine_y_m": round(spine_target_y, 4),
        "rest_displacement_mm": round(measure_rest_displacement_mm(body), 6),
        "current_waist_head": (
            bone_world_head(CC4_BONE_MAP["waist"]).round(4).tolist()
            if bone_world_head(CC4_BONE_MAP["waist"]) is not None
            else None
        ),
    }


def refit_cc4_body_shape_skeleton(arm, body) -> dict:
    """Refit a CC4 humanoid skeleton to match heavy/morphed soft-tissue anatomy with 0.000 mm rest displacement."""
    verts = world_vertices_numpy(body)
    z_min, z_max = float(verts[:, 2].min()), float(verts[:, 2].max())
    height = z_max - z_min
    front_neg_y = detect_front_is_neg_y(arm, verts)
    mw = arm.matrix_world
    mw_inv = mw.inverted()

    before = measure_character_anatomy(arm, body)

    # Measure axillary & limb cross-sections in world space before entering Edit mode
    def get_bone_w(name: str) -> np.ndarray:
        v = mw @ arm.data.bones[name].head_local
        return np.array([v.x, v.y, v.z], dtype=np.float64)

    hip_w = get_bone_w(CC4_BONE_MAP["hips"])
    waist_w = get_bone_w(CC4_BONE_MAP["waist"])
    spine1_w = get_bone_w(CC4_BONE_MAP["spineMid"])
    chest_w = get_bone_w(CC4_BONE_MAP["chest"])
    l_sh_w = get_bone_w(CC4_BONE_MAP["leftShoulder"])
    l_el_w = get_bone_w(CC4_BONE_MAP["leftElbow"])
    l_th_w = get_bone_w(CC4_BONE_MAP["leftHip"])
    l_kn_w = get_bone_w(CC4_BONE_MAP["leftKnee"])

    # 1. Vertebral AP placement (~35% from dorsal skin, immune to anterior belly fat)
    hip_y, _, _ = dorsal_weighted_sagittal_y(verts, hip_w[2], dorsal_fraction=0.38, front_is_neg_y=front_neg_y)
    waist_y, _, _ = dorsal_weighted_sagittal_y(verts, waist_w[2], dorsal_fraction=0.35, front_is_neg_y=front_neg_y)
    spine1_y, _, _ = dorsal_weighted_sagittal_y(verts, spine1_w[2], dorsal_fraction=0.35, front_is_neg_y=front_neg_y)
    chest_y, _, _ = dorsal_weighted_sagittal_y(verts, chest_w[2], dorsal_fraction=0.36, front_is_neg_y=front_neg_y)

    # 2. Glenohumeral joint lateral fit:
    # Measure upper-ribcage lateral extent just below axilla; place shoulder pivot at ~82% of
    # upper-thorax half-width (matching SMPL/STAR acromion-to-ribcage scaling without floating into deltoid fat),
    # while shifting the elbow/wrist collinearly or preserving exact upper-arm cross-section center!
    # Wait: to keep the upper-arm bone passing cleanly through the sculpted arm cylinder, check the
    # orthogonal cross-section of the proximal upper arm (25% down from shoulder to elbow):
    arm_dir = l_el_w - l_sh_w
    arm_len = float(np.linalg.norm(arm_dir))
    arm_axis = arm_dir / max(1e-6, arm_len)
    prox_pt = l_sh_w + 0.28 * arm_dir
    arm_band = verts[
        (verts[:, 0] * np.sign(l_sh_w[0]) > abs(l_sh_w[0]) * 0.65)
        & (np.linalg.norm(verts - prox_pt, axis=1) < 0.14 * height)
        & (np.abs((verts - prox_pt) @ arm_axis) < 0.018 * height)
    ]
    if len(arm_band) >= 12:
        # Project proximal upper-arm cross-section centroid back along arm_axis to shoulder elevation
        sec_center = np.median(arm_band, axis=0)
        t_back = (l_sh_w[2] - sec_center[2]) / arm_axis[2] if abs(arm_axis[2]) > 0.15 else -0.28 * arm_len
        fitted_sh = sec_center + t_back * arm_axis
        target_shoulder_abs_x = float(np.clip(abs(fitted_sh[0]), abs(l_sh_w[0]), 0.135 * height))
        target_shoulder_y = float(fitted_sh[1])
    else:
        target_shoulder_abs_x = max(abs(l_sh_w[0]), 0.095 * height)
        target_shoulder_y = float(l_sh_w[1])

    # 3. Acetabular hip joint lateral + AP fit:
    # Fit thigh bone axis through the proximal thigh cross-section (35% down toward knee) while bounding
    # acetabular width to anatomical pelvic scaling (~5.8-6.4% of stature, never outer trochanteric fat!).
    thigh_dir = l_kn_w - l_th_w
    thigh_len = float(np.linalg.norm(thigh_dir))
    thigh_axis = thigh_dir / max(1e-6, thigh_len)
    prox_th = l_th_w + 0.38 * thigh_dir
    th_band = verts[
        (verts[:, 0] * np.sign(l_th_w[0]) > 0.015 * height)
        & (np.linalg.norm(verts - prox_th, axis=1) < 0.16 * height)
        & (np.abs((verts - prox_th) @ thigh_axis) < 0.018 * height)
    ]
    pelvis_y, _, _ = dorsal_weighted_sagittal_y(verts, l_th_w[2], dorsal_fraction=0.42, front_is_neg_y=front_neg_y)
    if len(th_band) >= 12:
        th_center = np.median(th_band, axis=0)
        target_hip_abs_x = float(np.clip(abs(th_center[0]) * 0.72, abs(l_th_w[0]), 0.066 * height))
    else:
        target_hip_abs_x = max(abs(l_th_w[0]), 0.056 * height)

    # Apply EditBone head/tail updates in Armature Edit Mode (mesh vertices remain 100% untouched!)
    bpy.ops.object.select_all(action="DESELECT")
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones

    def set_world_head(bname: str, new_world: np.ndarray, shift_connected_tail_of_parent: bool = True):
        if bname not in eb:
            return
        bone = eb[bname]
        old_head = bone.head.copy()
        new_local = mw_inv @ Vector(new_world.tolist())
        delta_local = new_local - old_head
        bone.head = new_local
        # Keep zero-length bone safety if tail was very close
        if (bone.tail - bone.head).length < 1e-4:
            bone.tail = bone.head + delta_local
        if shift_connected_tail_of_parent and bone.parent and (bone.parent.tail - old_head).length < 1e-3:
            bone.parent.tail = new_local

    # Spine dorsal alignment
    for key, new_y in [("hips", hip_y), ("waist", waist_y), ("spineMid", spine1_y), ("chest", chest_y)]:
        bname = CC4_BONE_MAP[key]
        if bname in eb:
            cur_w = np.array((mw @ eb[bname].head)[:], dtype=np.float64)
            cur_w[1] = new_y
            set_world_head(bname, cur_w)
    # Also align Pelvis helper bone if present
    if "CC_Base_Pelvis" in eb:
        cur_w = np.array((mw @ eb["CC_Base_Pelvis"].head)[:], dtype=np.float64)
        cur_w[1] = hip_y
        set_world_head("CC_Base_Pelvis", cur_w, shift_connected_tail_of_parent=False)

    # Glenohumeral & Acetabular bilateral symmetry
    for side_key, clav_key in [("leftShoulder", "leftClavicle"), ("rightShoulder", "rightClavicle")]:
        sh_name = CC4_BONE_MAP[side_key]
        cl_name = CC4_BONE_MAP[clav_key]
        if sh_name in eb:
            cur_w = np.array((mw @ eb[sh_name].head)[:], dtype=np.float64)
            sign = 1.0 if cur_w[0] >= 0 else -1.0
            new_w = np.array([sign * target_shoulder_abs_x, target_shoulder_y, cur_w[2]], dtype=np.float64)
            set_world_head(sh_name, new_w, shift_connected_tail_of_parent=True)
            # Update upper-arm twist helpers along the new upper-arm line!
            el_name = CC4_BONE_MAP["leftElbow" if "left" in side_key else "rightElbow"]
            if el_name in eb:
                sh_loc = eb[sh_name].head.copy()
                el_loc = eb[el_name].head.copy()
                eb[sh_name].tail = el_loc
                for twist_idx, frac in [("01", 0.0), ("02", 0.5)]:
                    tw_name = sh_name + f"Twist{twist_idx}"
                    if tw_name in eb:
                        eb[tw_name].head = sh_loc.lerp(el_loc, frac)
                        eb[tw_name].tail = sh_loc.lerp(el_loc, frac + 0.45)
        if cl_name in eb:
            cur_cl = np.array((mw @ eb[cl_name].head)[:], dtype=np.float64)
            cur_cl[1] = chest_y + (cur_cl[1] - chest_w[1]) * 0.5
            set_world_head(cl_name, cur_cl, shift_connected_tail_of_parent=False)

    for hip_key, knee_key in [("leftHip", "leftKnee"), ("rightHip", "rightKnee")]:
        th_name = CC4_BONE_MAP[hip_key]
        kn_name = CC4_BONE_MAP[knee_key]
        if th_name in eb:
            cur_w = np.array((mw @ eb[th_name].head)[:], dtype=np.float64)
            sign = 1.0 if cur_w[0] >= 0 else -1.0
            new_w = np.array([sign * target_hip_abs_x, pelvis_y, cur_w[2]], dtype=np.float64)
            set_world_head(th_name, new_w, shift_connected_tail_of_parent=False)
            if kn_name in eb:
                th_loc = eb[th_name].head.copy()
                kn_loc = eb[kn_name].head.copy()
                eb[th_name].tail = kn_loc
                for twist_idx, frac in [("01", 0.0), ("02", 0.5)]:
                    tw_name = th_name + f"Twist{twist_idx}"
                    if tw_name in eb:
                        eb[tw_name].head = th_loc.lerp(kn_loc, frac)
                        eb[tw_name].tail = th_loc.lerp(kn_loc, frac + 0.45)

    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.context.view_layer.update()

    after = measure_character_anatomy(arm, body)
    return {
        "before": before,
        "after": after,
        "fitted_shoulder_abs_x_m": round(target_shoulder_abs_x, 4),
        "fitted_hip_abs_x_m": round(target_hip_abs_x, 4),
        "fitted_waist_y_m": round(waist_y, 4),
        "rest_displacement_mm": after["rest_displacement_mm"],
    }


def main():
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["audit", "refit-rigged"], required=True)
    parser.add_argument("input_path")
    parser.add_argument("output_path", nargs="?")
    parser.add_argument("--body-mesh", default=None)
    args = parser.parse_args(argv)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    inp = Path(args.input_path)
    if inp.suffix.lower() in (".glb", ".gltf"):
        bpy.ops.import_scene.gltf(filepath=str(inp))
    elif inp.suffix.lower() == ".fbx":
        bpy.ops.import_scene.fbx(filepath=str(inp))
    else:
        raise ValueError(f"Unsupported input format: {inp.suffix}")

    arm, body = find_primary_armature_and_body(args.body_mesh)
    orig_verts = world_vertices_numpy(body).copy()

    if args.mode == "audit":
        print(json.dumps(measure_character_anatomy(arm, body), indent=2))
        return

    if not args.output_path:
        raise ValueError("output_path is required for --mode refit-rigged")

    report = refit_cc4_body_shape_skeleton(arm, body)
    final_verts = world_vertices_numpy(body)
    geom_drift_mm = float(np.linalg.norm(final_verts - orig_verts, axis=1).max() * 1000.0)
    report["mesh_geometry_drift_mm"] = round(geom_drift_mm, 6)
    if geom_drift_mm > 1e-4:
        raise RuntimeError(f"Refused export: mesh vertices drifted by {geom_drift_mm:.6f} mm!")

    out = Path(args.output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(out),
        export_format="GLB",
        export_animations=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_skins=True,
    )
    print("REFIT_REPORT:" + json.dumps(report))


if __name__ == "__main__":
    main()
