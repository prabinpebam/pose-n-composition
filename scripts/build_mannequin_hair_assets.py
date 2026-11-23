#!/usr/bin/env python3
"""
Compiles individually license-verified CC0 MakeHuman artist-authored polygon hair assets
onto Mannequin_Female.glb and Mannequin_Male.glb via exact hm08 .mhclo correspondence.

Outputs:
  - public/models/mannequin/hair/mannequin-hair.json
  - public/models/mannequin/hair/mannequin-hair.bin
  - public/models/mannequin/hair/textures/*_albedo.png & *_normal.png
"""

from __future__ import annotations

import argparse
import json
import math
import os
import struct
import sys
import tempfile
from collections import defaultdict
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

REPO_ROOT = Path(__file__).resolve().parent.parent
MANNEQUIN_DIR = REPO_ROOT / "public" / "models" / "mannequin"
OUT_DIR = MANNEQUIN_DIR / "hair"
TEX_OUT_DIR = OUT_DIR / "textures"

VERIFIED_CC0_HAIR_SPECS = [
    {
        "id": "faydaen_updo",
        "folder": "faydaen_hair_1",
        "mhclo": "faydaen_hair_1.mhclo",
        "obj": "hair1.obj",
        "diffuse": "hair.png",
        "normal": None,
        "alphaMode": "opaque",
        "subdivide": 1,
        "creaseDeg": 98.0,
        "author": "Faydaen (MakeHuman Community)",
        "license": "CC0-1.0",
        "licenseHeader": "# author: Faydaen | # license: CC0",
    },
    {
        "id": "culturalibre_parted",
        "folder": "culturalibre_hair_05",
        "mhclo": "culturalibre_hair_05.mhclo",
        "obj": "hair_05.obj",
        "diffuse": "hair_05.png",
        "normal": None,
        "alphaMode": "opaque",
        "subdivide": 1,
        "creaseDeg": 102.0,
        "author": "Culturalibre (MakeHuman Community)",
        "license": "CC0-1.0",
        "licenseHeader": "# author Culturalibre | # license CC-0",
    },
    {
        "id": "ponytail01",
        "folder": "ponytail01",
        "mhclo": "ponytail01.mhclo",
        "obj": "ponytail01.obj",
        "diffuse": "ponytail01_diffuse.png",
        "normal": "ponytail01_normal.png",
        "alphaMode": "mask",
        "subdivide": 0,
        "author": "Data Collection AB / Joel Palmius / Jonas Hauquier (MakeHuman System Assets)",
        "license": "CC0-1.0",
        "licenseHeader": "# Explicitly released as CC0 in September 2020. Copyright (C) 2020 Data Collection AB",
    },
    {
        "id": "toigo_bob",
        "folder": "toigo_inverted_bob",
        "mhclo": "toigo_inverted_bob.mhclo",
        "obj": "bob_inverted.obj",
        "diffuse": "GoldenBlondHair.png",
        "normal": None,
        "alphaMode": "mask",
        "subdivide": 0,
        "author": "Toigo (MakeHuman Community)",
        "license": "CC0-1.0",
        "licenseHeader": "# author Toigo | # license CC0",
    },
    {
        "id": "short02",
        "folder": "short02",
        "mhclo": "short02.mhclo",
        "obj": "short02.obj",
        "diffuse": "short02_diffuse.png",
        "normal": "short02_normal.png",
        "alphaMode": "mask",
        "subdivide": 0,
        "author": "Data Collection AB / Joel Palmius / Jonas Hauquier (MakeHuman System Assets)",
        "license": "CC0-1.0",
        "licenseHeader": "# Explicitly released as CC0 in September 2020. Copyright (C) 2020 Data Collection AB",
    },
    {
        "id": "short01",
        "folder": "short01",
        "mhclo": "short01.mhclo",
        "obj": "short01.obj",
        "diffuse": "short01_diffuse.png",
        "normal": "short01_normal.png",
        "alphaMode": "mask",
        "subdivide": 0,
        "author": "Data Collection AB / Joel Palmius / Jonas Hauquier (MakeHuman System Assets)",
        "license": "CC0-1.0",
        "licenseHeader": "# Explicitly released as CC0 in September 2020. Copyright (C) 2020 Data Collection AB",
    },
    {
        "id": "cortu_messy",
        "folder": "cortu_short_messy_hair",
        "mhclo": "cortu_short_messy_hair.mhclo",
        "obj": "short_messy.obj",
        "diffuse": "short_messy_diff.png",
        "normal": None,
        "alphaMode": "mask",
        "subdivide": 0,
        "author": "Cortu Johnstone (MakeHuman Community)",
        "license": "CC0-1.0",
        "licenseHeader": "# Cortu Johnstone - CC0",
    },
]

STYLE_MAP = {
    "female": {
        "long": "faydaen_updo",
        "bob": "toigo_bob",
        "parted": "toigo_bob",
        "buns": "ponytail01",
        "bun": "ponytail01",
        "short": "short02",
        "curly": "cortu_messy",
        "buzz": "short01",
        "partedBeard": "toigo_bob",
    },
    "male": {
        "parted": "culturalibre_parted",
        "partedBeard": "culturalibre_parted",
        "short": "short02",
        "curly": "cortu_messy",
        "buzz": "short01",
        "long": "faydaen_updo",
        "bob": "toigo_bob",
        "buns": "ponytail01",
        "bun": "ponytail01",
    },
}


def verify_cc0_header(mhclo_path: Path) -> None:
    head = mhclo_path.read_text(encoding="utf-8", errors="replace")[:1500].lower()
    if "cc0" not in head and "cc-0" not in head:
        raise ValueError(f"Refusing {mhclo_path}: missing explicit CC0 header")


def load_glb_body(glb_path: Path) -> tuple[np.ndarray, np.ndarray]:
    data = glb_path.read_bytes()
    jlen = struct.unpack_from("<I", data, 12)[0]
    gltf = json.loads(data[20 : 20 + jlen].decode("utf-8"))
    bin_chunk = data[20 + jlen + 8 :]

    def get_acc(idx: int) -> np.ndarray:
        acc = gltf["accessors"][idx]
        bv = gltf["bufferViews"][acc["bufferView"]]
        dt = {5126: np.float32, 5123: np.uint16, 5125: np.uint32}[acc["componentType"]]
        cnt = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}[acc["type"]]
        return np.frombuffer(
            bin_chunk, dtype=dt, count=acc["count"] * cnt, offset=bv.get("byteOffset", 0)
        ).reshape(acc["count"], cnt)

    prim = gltf["meshes"][0]["primitives"][0]
    return get_acc(prim["attributes"]["POSITION"]), get_acc(prim["indices"]).reshape(-1, 3)


def reconstruct_hm08_19158(
    gender: str,
    glb_pos: np.ndarray,
    base_verts: np.ndarray,
    arch: dict,
    abin: bytes,
) -> np.ndarray:
    w_info = arch["gender"][gender]["meshes"][0]["weld"]
    weld = np.frombuffer(
        abin, dtype=np.uint16, count=w_info["byteLength"] // 2, offset=w_info["byteOffset"]
    )
    full = np.zeros((19158, 3), dtype=np.float64)
    seen = np.zeros(13380, dtype=bool)
    for gi, wi in enumerate(weld):
        if wi < 13380 and not seen[wi]:
            full[wi] = glb_pos[gi]
            seen[wi] = True

    upper_mask = np.where(base_verts[:13380, 1] > -2.0)[0]
    upper_pts = base_verts[upper_mask]
    helper_hm08 = base_verts[13380:]

    sx_h = abs(full[5399, 0] - full[11998, 0]) / abs(base_verts[5399, 0] - base_verts[11998, 0])
    sy_h = abs(full[791, 1] - full[881, 1]) / abs(base_verts[791, 1] - base_verts[881, 1])
    sz_h = abs(full[962, 2] - full[5320, 2]) / abs(base_verts[962, 2] - base_verts[5320, 2])
    scale_vec = np.array([sx_h, sy_h, sz_h])

    for start in range(0, len(helper_hm08), 512):
        sub = helper_hm08[start : start + 512]
        d2 = ((sub[:, None, :] - upper_pts[None, :, :]) ** 2).sum(axis=2)
        nn4 = np.argpartition(d2, 4, axis=1)[:, :4]
        w = 1.0 / (np.take_along_axis(d2, nn4, axis=1) + 1e-4)
        w /= w.sum(axis=1, keepdims=True)
        b_ids = upper_mask[nn4]
        full[13380 + start : 13380 + start + len(sub)] = (
            w[:, :, None]
            * (full[b_ids] + (sub[:, None, :] - base_verts[b_ids]) * scale_vec[None, None, :])
        ).sum(axis=1)
    return full


def fit_mhclo_positions(full_m: np.ndarray, mhclo_path: Path) -> np.ndarray:
    scales: dict[str, tuple[int, int, float]] = {}
    mappings: list[tuple[float, ...]] = []
    in_verts = False
    for raw in mhclo_path.read_text(encoding="utf-8", errors="replace").splitlines():
        s = raw.strip()
        if not s or s.startswith("#"):
            continue
        parts = s.split()
        if parts[0] in ("x_scale", "y_scale", "z_scale"):
            scales[parts[0]] = (int(parts[1]), int(parts[2]), float(parts[3]))
        elif parts[0] == "verts":
            in_verts = True
        elif in_verts:
            if parts[0] == "material":
                continue
            try:
                nums = [float(x) for x in parts]
            except ValueError:
                in_verts = False
                continue
            if len(nums) == 1:
                vi = int(nums[0])
                mappings.append((vi, vi, vi, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0))
            elif len(nums) >= 9:
                mappings.append(
                    (
                        int(nums[0]),
                        int(nums[1]),
                        int(nums[2]),
                        nums[3],
                        nums[4],
                        nums[5],
                        nums[6],
                        nums[7],
                        nums[8],
                    )
                )

    sx = abs(full_m[scales["x_scale"][0], 0] - full_m[scales["x_scale"][1], 0]) / scales["x_scale"][2]
    sy = abs(full_m[scales["y_scale"][0], 1] - full_m[scales["y_scale"][1], 1]) / scales["y_scale"][2]
    sz = abs(full_m[scales["z_scale"][0], 2] - full_m[scales["z_scale"][1], 2]) / scales["z_scale"][2]
    mp = np.array(mappings, dtype=np.float64)
    v0, v1, v2 = mp[:, 0].astype(int), mp[:, 1].astype(int), mp[:, 2].astype(int)
    return (
        mp[:, 3:4] * full_m[v0]
        + mp[:, 4:5] * full_m[v1]
        + mp[:, 5:6] * full_m[v2]
        + mp[:, 6:9] * np.array([[sx, sy, sz]])
    )


def parse_obj_faces(obj_path: Path) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    uvs: list[list[float]] = []
    tris_v: list[list[int]] = []
    tris_uv: list[list[int]] = []
    for raw in obj_path.read_text(encoding="utf-8", errors="replace").splitlines():
        p = raw.strip().split()
        if not p:
            continue
        if p[0] == "vt":
            uvs.append([float(p[1]), float(p[2])])
        elif p[0] == "f":
            cs = [
                (
                    int(t.split("/")[0]) - 1,
                    int(t.split("/")[1]) - 1 if len(t.split("/")) > 1 and t.split("/")[1] else 0,
                )
                for t in p[1:]
            ]
            for k in range(1, len(cs) - 1):
                tris_v.append([cs[0][0], cs[k][0], cs[k + 1][0]])
                tris_uv.append([cs[0][1], cs[k][1], cs[k + 1][1]])
    if not uvs:
        uvs = [[0.5, 0.5]]
    return (
        np.array(uvs, dtype=np.float64),
        np.array(tris_v, dtype=np.int32),
        np.array(tris_uv, dtype=np.int32),
    )


def subdivide_uv_preserving_smooth(
    verts: np.ndarray,
    uvs: np.ndarray,
    tris_v: np.ndarray,
    tris_uv: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    1-level smooth Loop-inspired 3D subdivision that preserves UV seam islands cleanly.
    3D edge midpoints use shared 3D vertex indices so zero cracks ever form across UV seams.
    """
    edge_opp: dict[tuple[int, int], list[int]] = defaultdict(list)
    v_neighbors: dict[int, set[int]] = defaultdict(set)
    bnd_neighbors: dict[int, set[int]] = defaultdict(set)

    for a, b, c in tris_v:
        edge_opp[(min(a, b), max(a, b))].append(c)
        edge_opp[(min(b, c), max(b, c))].append(a)
        edge_opp[(min(c, a), max(c, a))].append(b)
        v_neighbors[a].update((b, c))
        v_neighbors[b].update((a, c))
        v_neighbors[c].update((a, b))

    for (u, v), opps in edge_opp.items():
        if len(opps) == 1:
            bnd_neighbors[u].add(v)
            bnd_neighbors[v].add(u)

    # Gently relax existing vertices (half-strength Loop weight so scalp base doesn't shrink)
    new_verts = verts.copy()
    for vi in range(len(verts)):
        if vi in bnd_neighbors and len(bnd_neighbors[vi]) == 2:
            b0, b1 = list(bnd_neighbors[vi])
            target = 0.75 * verts[vi] + 0.125 * (verts[b0] + verts[b1])
            new_verts[vi] = 0.55 * verts[vi] + 0.45 * target
        elif len(v_neighbors[vi]) >= 3 and vi not in bnd_neighbors:
            nbrs = list(v_neighbors[vi])
            n = len(nbrs)
            beta = (3.0 / (8.0 * n)) if n > 3 else (3.0 / 16.0)
            target = (1.0 - n * beta) * verts[vi] + beta * verts[nbrs].sum(axis=0)
            new_verts[vi] = 0.55 * verts[vi] + 0.45 * target

    v_list = new_verts.tolist()
    uv_list = uvs.tolist()
    edge_v_cache: dict[tuple[int, int], int] = {}
    edge_uv_cache: dict[tuple[int, int], int] = {}

    def get_mid_v(a: int, b: int) -> int:
        key = (min(a, b), max(a, b))
        if key in edge_v_cache:
            return edge_v_cache[key]
        opps = edge_opp[key]
        lin = 0.5 * (verts[a] + verts[b])
        if len(opps) == 2:
            loop_pt = 0.375 * (verts[a] + verts[b]) + 0.125 * (verts[opps[0]] + verts[opps[1]])
            pt = 0.45 * lin + 0.55 * loop_pt
        else:
            pt = lin
        idx = len(v_list)
        v_list.append(pt.tolist())
        edge_v_cache[key] = idx
        return idx

    def get_mid_uv(ua: int, ub: int) -> int:
        key = (min(ua, ub), max(ua, ub))
        if key in edge_uv_cache:
            return edge_uv_cache[key]
        mid = (0.5 * (uvs[ua] + uvs[ub])).tolist()
        idx = len(uv_list)
        uv_list.append(mid)
        edge_uv_cache[key] = idx
        return idx

    out_tv: list[list[int]] = []
    out_tuv: list[list[int]] = []
    for ti in range(len(tris_v)):
        v0, v1, v2 = int(tris_v[ti, 0]), int(tris_v[ti, 1]), int(tris_v[ti, 2])
        u0, u1, u2 = int(tris_uv[ti, 0]), int(tris_uv[ti, 1]), int(tris_uv[ti, 2])
        m01 = get_mid_v(v0, v1)
        m12 = get_mid_v(v1, v2)
        m20 = get_mid_v(v2, v0)
        mu01 = get_mid_uv(u0, u1)
        mu12 = get_mid_uv(u1, u2)
        mu20 = get_mid_uv(u2, u0)
        out_tv.extend(
            [[v0, m01, m20], [v1, m12, m01], [v2, m20, m12], [m01, m12, m20]]
        )
        out_tuv.extend(
            [[u0, mu01, mu20], [u1, mu12, mu01], [u2, mu20, mu12], [mu01, mu12, mu20]]
        )

    return (
        np.array(v_list, dtype=np.float64),
        np.array(uv_list, dtype=np.float64),
        np.array(out_tv, dtype=np.int32),
        np.array(out_tuv, dtype=np.int32),
    )


def groom_fitted_hair_mesh(
    asset_id: str,
    gender: str,
    hair_v: np.ndarray,
    body_pos: np.ndarray,
) -> np.ndarray:
    """
    Applies subtle anatomical studio grooming to fitted CC0 hair meshes so eyes/brows remain
    100% open & unoccluded and pre-auricular temple transitions have zero bare-scalp slits.
    """
    out = hair_v.copy()
    top_y = float(body_pos[:, 1].max())
    head_pts = body_pos[body_pos[:, 1] > top_y - 0.23]
    center_z = float(head_pts[:, 2].mean())

    if asset_id == "culturalibre_parted":
        # Lift & side-sweep the drooping front forelock cleanly above the eyebrows (`brow_floor`)
        # so both eyes & brows are 100% open without losing the swept side-part fringe!
        brow_floor = top_y - (0.070 if gender == "male" else 0.074)
        ceil_band = brow_floor + 0.042
        front_mask = (
            (out[:, 2] > center_z + 0.016)
            & (np.abs(out[:, 0]) < 0.062)
            & (out[:, 1] < ceil_band)
        )
        if front_mask.any():
            pts = out[front_mask]
            t = np.clip((ceil_band - pts[:, 1]) / 0.056, 0.0, 1.0)
            smooth_t = t * t * (3.0 - 2.0 * t)
            x_falloff = np.clip(1.0 - (np.abs(pts[:, 0]) / 0.062) ** 2, 0.0, 1.0)
            z_falloff = np.clip((pts[:, 2] - (center_z + 0.016)) / 0.024, 0.0, 1.0)
            w = smooth_t * x_falloff * z_falloff
            target_y = brow_floor + np.maximum(0.0, pts[:, 1] - (brow_floor - 0.052)) * 0.34
            pts[:, 1] = pts[:, 1] * (1.0 - w) + np.maximum(pts[:, 1], target_y) * w
            # Sweep lifted tip gently toward `-X` (character's left temple) following the part flow
            pts[:, 0] -= 0.0135 * w
            pts[:, 2] -= 0.0045 * w
            out[front_mask] = pts

    elif asset_id == "faydaen_updo":
        # 1. Soften upper-forehead hairline (`-7 mm` Y) and pull crown V-part slightly together
        fh_mask = (
            (np.abs(out[:, 0]) < 0.050)
            & (out[:, 2] > center_z + 0.010)
            & (out[:, 1] > top_y - 0.066)
            & (out[:, 1] < top_y - 0.012)
        )
        if fh_mask.any():
            pts = out[fh_mask]
            wx = np.clip(1.0 - (np.abs(pts[:, 0]) / 0.050) ** 2, 0.0, 1.0)
            wy = np.sin(
                np.clip((pts[:, 1] - (top_y - 0.066)) / 0.054, 0.0, 1.0) * math.pi
            )
            w = wx * wy
            pts[:, 1] -= 0.0072 * w
            pts[:, 2] += 0.0022 * w
            out[fh_mask] = pts

        # 2. Advance the pre-auricular side-cap edge (`z ~ 0.00..0.025`, `|x| > 0.058`) forward by +34 mm
        # so it tucks seamlessly behind the front cheek tendril (`z ~ 0.050`) with zero bare-temple crescent!
        temple_mask = (
            (np.abs(out[:, 0]) > 0.056)
            & (out[:, 1] > top_y - 0.138)
            & (out[:, 1] < top_y - 0.036)
            & (out[:, 2] > center_z - 0.056)
            & (out[:, 2] < center_z - 0.008)
        )
        if temple_mask.any():
            pts = out[temple_mask]
            wy = np.sin(
                np.clip((pts[:, 1] - (top_y - 0.138)) / 0.102, 0.0, 1.0) * math.pi
            )
            wz = np.sin(
                np.clip((pts[:, 2] - (center_z - 0.056)) / 0.048, 0.0, 1.0) * math.pi
            )
            pts[:, 2] += 0.034 * wy * (0.35 + 0.65 * wz)
            out[temple_mask] = pts

    elif asset_id == "ponytail01":
        # Add +4.5 mm natural parietal crown fullness above the ear line (`y > top_y - 0.115`)
        # so the sleek pulled-back cap clears the outer ear-tip skull envelope without covering the ears.
        crown_mask = out[:, 1] > (top_y - 0.115)
        if crown_mask.any():
            pts = out[crown_mask]
            wy = np.clip((pts[:, 1] - (top_y - 0.115)) / 0.045, 0.0, 1.0)
            pts[:, 0] *= 1.0 + 0.052 * wy
            out[crown_mask] = pts

    return out


def enforce_cranial_clearance(hair_v: np.ndarray, body_pos: np.ndarray, min_clear: float = 0.0022) -> np.ndarray:
    top_y = float(body_pos[:, 1].max())
    head_pts = body_pos[body_pos[:, 1] > top_y - 0.23]
    center = np.array([0.0, top_y - 0.105, float(head_pts[:, 2].mean())])
    out = hair_v.copy()
    mask = np.where(out[:, 1] > top_y - 0.195)[0]
    if len(mask) == 0:
        return out
    sub = out[mask]
    d2 = ((sub[:, None, :] - head_pts[None, :, :]) ** 2).sum(axis=2)
    nearest = head_pts[np.argmin(d2, axis=1)]
    r_hair = np.linalg.norm(sub - center, axis=1)
    r_skull = np.linalg.norm(nearest - center, axis=1)
    need = r_skull + min_clear - r_hair
    push = need > 0
    if push.any():
        dirs = (sub[push] - center) / (r_hair[push, None] + 1e-9)
        out[mask[push]] = sub[push] + dirs * need[push, None]
    return out


def build_split_vertex_buffers(
    verts: np.ndarray,
    uvs: np.ndarray,
    tris_v: np.ndarray,
    tris_uv: np.ndarray,
    crease_deg: float = 64.0,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """
    Computes crease-smoothed welded 3D normals (eliminating UV-seam creases on curved locks)
    and packs split (pos, normal, glTF-flipped uv) vertex arrays + Uint16 triangle indices.
    """
    cos_thresh = math.cos(math.radians(crease_deg))
    p0, p1, p2 = verts[tris_v[:, 0]], verts[tris_v[:, 1]], verts[tris_v[:, 2]]
    fn_raw = np.cross(p1 - p0, p2 - p0)
    fn_len = np.linalg.norm(fn_raw, axis=1, keepdims=True)
    fn_unit = fn_raw / (fn_len + 1e-12)

    # Weld coinciding 3D vertices (0.05 mm grid)
    quant = np.round(verts * 20000.0).astype(np.int64)
    _, weld_inv = np.unique(quant, axis=0, return_inverse=True)
    vert_tris: dict[int, list[int]] = defaultdict(list)
    for ti in range(len(tris_v)):
        for c in range(3):
            vert_tris[int(weld_inv[tris_v[ti, c]])].append(ti)

    corner_normals = np.zeros((len(tris_v), 3, 3), dtype=np.float32)
    for ti in range(len(tris_v)):
        f_u = fn_unit[ti]
        for c in range(3):
            wid = int(weld_inv[tris_v[ti, c]])
            acc = np.zeros(3, dtype=np.float64)
            for nti in vert_tris[wid]:
                if float(np.dot(f_u, fn_unit[nti])) >= cos_thresh:
                    acc += fn_raw[nti]
            nrm_len = float(np.linalg.norm(acc))
            if nrm_len < 1e-12:
                acc = f_u
                nrm_len = float(np.linalg.norm(acc)) + 1e-12
            corner_normals[ti, c] = (acc / nrm_len).astype(np.float32)

    # Deduplicate (vi, uvi, quantized_normal) corners
    out_pos: list[np.ndarray] = []
    out_nrm: list[np.ndarray] = []
    out_uv: list[list[float]] = []
    out_idx: list[int] = []
    corner_map: dict[tuple[int, int, int, int, int], int] = {}

    for ti in range(len(tris_v)):
        for c in range(3):
            vi = int(tris_v[ti, c])
            uvi = int(tris_uv[ti, c])
            cn = corner_normals[ti, c]
            key = (vi, uvi, int(round(cn[0] * 1000)), int(round(cn[1] * 1000)), int(round(cn[2] * 1000)))
            idx = corner_map.get(key)
            if idx is None:
                idx = len(out_pos)
                corner_map[key] = idx
                out_pos.append(verts[vi].astype(np.float32))
                out_nrm.append(cn)
                # Store glTF-convention UV [u, 1 - v] with flipY = false
                out_uv.append([float(uvs[uvi, 0]), float(1.0 - uvs[uvi, 1])])
            out_idx.append(idx)

    if len(out_pos) > 65535:
        raise ValueError(f"Hair mesh exceeded Uint16 vertex limit: {len(out_pos)}")

    return (
        np.array(out_pos, dtype=np.float32),
        np.array(out_nrm, dtype=np.float32),
        np.array(out_uv, dtype=np.float32),
        np.array(out_idx, dtype=np.uint16),
    )


def dilate_rgb_into_transparent(rgb: np.ndarray, alpha: np.ndarray, iterations: int = 10) -> np.ndarray:
    """Propagates valid strand RGB outward into transparent pixels to prevent dark mipmap fringes."""
    out = rgb.copy()
    valid = alpha > 24
    if valid.all() or not valid.any():
        return out
    for _ in range(iterations):
        empty = ~valid
        if not empty.any():
            break
        acc = np.zeros_like(out, dtype=np.float32)
        cnt = np.zeros(alpha.shape, dtype=np.float32)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            s_rgb = np.roll(np.roll(out, dy, axis=0), dx, axis=1)
            s_val = np.roll(np.roll(valid, dy, axis=0), dx, axis=1)
            acc += s_rgb * s_val[:, :, None]
            cnt += s_val.astype(np.float32)
        fill = empty & (cnt > 0)
        if not fill.any():
            break
        out[fill] = (acc[fill] / cnt[fill, None]).astype(np.uint8)
        valid = valid | fill
    return out


def build_calibrated_textures(
    spec: dict,
    src_folder: Path,
    albedo_out: Path,
    normal_out: Path,
) -> None:
    im = Image.open(src_folder / spec["diffuse"]).convert("RGBA")
    if im.size != (1024, 1024):
        im = im.resize((1024, 1024), Image.Resampling.LANCZOS)
    arr = np.array(im)
    rgb = arr[:, :, :3].astype(np.float32) / 255.0
    alpha = arr[:, :, 3]

    # Compute perceptual luminance & local high-frequency strand micro-contrast
    luma = 0.2126 * rgb[:, :, 0] + 0.7152 * rgb[:, :, 1] + 0.0722 * rgb[:, :, 2]
    mask = alpha > 96 if spec["alphaMode"] == "mask" else np.ones_like(alpha, dtype=bool)
    vals = luma[mask]
    p10 = float(np.percentile(vals, 10))
    p88 = float(np.percentile(vals, 88))
    raw_span = p88 - p10

    if raw_span < 0.03:
        # Source diffuse is a flat solid color swatch (e.g. culturalibre_hair_05):
        # synthesize seamless tileable multi-scale anisotropic hair-fiber sheen along both U and V
        # (locks in UV space run along V/U strips; fine silk striations catch natural light without flat plastic)
        rng = np.random.default_rng(4205)
        u_grid = np.linspace(0.0, 2.0 * math.pi, 1024, endpoint=False, dtype=np.float32)
        fiber_1d = np.zeros(1024, dtype=np.float32)
        for freq, amp in ((28, 0.28), (64, 0.26), (136, 0.22), (260, 0.15), (420, 0.09)):
            phase = float(rng.uniform(0.0, 2.0 * math.pi))
            fiber_1d += amp * np.sin(u_grid * freq + phase)
        along_1d = 0.5 + 0.5 * np.sin(u_grid * 3.0 + 0.7) * 0.16
        # Tile vertically with slight strand shimmer so both U-oriented and V-oriented UV islands get fine fibers
        grain_u = fiber_1d[None, :] * (0.85 + 0.15 * np.sin(u_grid[:, None] * 6.0))
        grain_v = fiber_1d[:, None] * 0.35
        combined = grain_u + grain_v + along_1d[:, None] * 0.25
        c_min, c_max = float(combined.min()), float(combined.max())
        norm_srgb = np.clip(0.58 + 0.38 * ((combined - c_min) / max(1e-5, c_max - c_min)), 0.52, 0.98)
    else:
        # Detect painted light-tan scalp-part regions inside dark-brown diffuse maps (e.g. faydaen_hair_1):
        # where luma sits far above the median hair strand tone (`> p78`), gently roll it into natural root shadow
        # instead of mapping a tan scalp strip to chalky white (`0.95+`)!
        p50 = float(np.percentile(vals, 50))
        p82 = float(np.percentile(vals, 82))
        if p50 < 0.35 and float(vals.max()) > p82 + 0.14:
            excess = np.clip((luma - p82) / max(0.08, float(vals.max()) - p82), 0.0, 1.0)
            luma = luma * (1.0 - excess) + (p10 + 0.15 * (p82 - p10)) * excess
            vals = luma[mask]
            p88 = float(np.percentile(vals, 88))
        span = max(0.08, p88 - p10)
        # Map strand grooves -> 0.48 sRGB and sunlit strand ridges -> 0.90 sRGB so `material.color`
        # tints accurately to any swatch without chalky white highlights!
        norm_srgb = np.clip(0.48 + 0.42 * ((luma - p10) / span), 0.38, 0.92)
    # Subtle sharpening of fine hair fiber ridges
    luma_pil = Image.fromarray((norm_srgb * 255.0).astype(np.uint8), mode="L")
    sharp_pil = luma_pil.filter(ImageFilter.UnsharpMask(radius=1.4, percent=75, threshold=2))
    gray_u8 = np.array(sharp_pil, dtype=np.uint8)
    rgb_u8 = np.stack([gray_u8, gray_u8, gray_u8], axis=-1)

    if spec["alphaMode"] == "mask":
        rgb_u8 = dilate_rgb_into_transparent(rgb_u8, alpha, iterations=10)
        out_rgba = np.dstack([rgb_u8, alpha])
        Image.fromarray(out_rgba, mode="RGBA").save(albedo_out, optimize=True)
    else:
        Image.fromarray(rgb_u8, mode="RGB").save(albedo_out, optimize=True)

    # Normal map (512x512 tangent space)
    if spec["normal"] and (src_folder / spec["normal"]).exists():
        nm = Image.open(src_folder / spec["normal"]).convert("RGB").resize(
            (512, 512), Image.Resampling.LANCZOS
        )
        nm.save(normal_out, optimize=True)
    else:
        # Synthesize clean tangent-space normal map from strand luminance heightfield
        h_im = sharp_pil.resize((512, 512), Image.Resampling.BILINEAR)
        h = np.array(h_im, dtype=np.float32) / 255.0
        dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 2.2
        dy = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) * 2.2
        nz = np.ones_like(h)
        inv_len = 1.0 / np.sqrt(dx * dx + dy * dy + nz * nz)
        nx = np.clip((dx * inv_len * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
        ny = np.clip((dy * inv_len * 0.5 + 0.5) * 255.0, 0, 255).astype(np.uint8)
        nzu = np.clip((nz * inv_len * 0.5 + 0.5) * 255.0, 128, 255).astype(np.uint8)
        Image.fromarray(np.stack([nx, ny, nzu], axis=-1), mode="RGB").save(
            normal_out, optimize=True
        )


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--src-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "pose-char-research" / "mh-cc0-hair",
    )
    parser.add_argument(
        "--hm08-cache",
        type=Path,
        default=Path(tempfile.gettempdir()) / "pose-char-research" / "pinned",
    )
    args = parser.parse_args()

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    TEX_OUT_DIR.mkdir(parents=True, exist_ok=True)

    base_verts = []
    for line in (args.hm08_cache / "3dobjs__base.obj").read_text(encoding="utf-8").splitlines():
        p = line.strip().split()
        if p and p[0] == "v":
            base_verts.append([float(p[1]), float(p[2]), float(p[3])])
    base_verts_np = np.array(base_verts, dtype=np.float64)

    arch = json.loads((MANNEQUIN_DIR / "archetypes.json").read_text(encoding="utf-8"))
    abin = (MANNEQUIN_DIR / "archetypes.bin").read_bytes()

    gender_data = {}
    for gender, glb_name in (("female", "Mannequin_Female.glb"), ("male", "Mannequin_Male.glb")):
        glb_pos, _ = load_glb_body(MANNEQUIN_DIR / glb_name)
        full_19158 = reconstruct_hm08_19158(gender, glb_pos, base_verts_np, arch, abin)
        top_y = float(glb_pos[:, 1].max())
        head_pts = glb_pos[glb_pos[:, 1] > top_y - 0.23]
        gender_data[gender] = {
            "glb_pos": glb_pos,
            "full": full_19158,
            "restHead": {
                "crownY": round(top_y, 6),
                "center": [
                    0.0,
                    round(top_y - 0.105, 6),
                    round(float(head_pts[:, 2].mean()), 6),
                ],
                "halfWidth": round(float(np.abs(head_pts[:, 0]).max()), 6),
                "headHeight": 0.235,
            },
        }

    bin_chunks: list[bytes] = []
    byte_cursor = 0

    def append_bytes(arr: np.ndarray) -> dict[str, int]:
        nonlocal byte_cursor
        raw = arr.tobytes()
        pad = (4 - (len(raw) % 4)) % 4
        entry = {"byteOffset": byte_cursor, "byteLength": len(raw), "count": int(len(arr))}
        bin_chunks.append(raw + (b"\x00" * pad))
        byte_cursor += len(raw) + pad
        return entry

    manifest_assets: dict[str, dict] = {}
    for spec in VERIFIED_CC0_HAIR_SPECS:
        src_folder = args.src_dir / spec["folder"]
        mhclo_path = src_folder / spec["mhclo"]
        obj_path = src_folder / spec["obj"]
        verify_cc0_header(mhclo_path)

        albedo_rel = f"models/mannequin/hair/textures/{spec['id']}_albedo.png"
        normal_rel = f"models/mannequin/hair/textures/{spec['id']}_normal.png"
        build_calibrated_textures(
            spec,
            src_folder,
            TEX_OUT_DIR / f"{spec['id']}_albedo.png",
            TEX_OUT_DIR / f"{spec['id']}_normal.png",
        )

        uvs_raw, tris_v_raw, tris_uv_raw = parse_obj_faces(obj_path)
        per_gender_meshes: dict[str, dict] = {}

        for gender in ("female", "male"):
            g = gender_data[gender]
            hv = fit_mhclo_positions(g["full"], mhclo_path)
            uvs, tv, tuv = uvs_raw, tris_v_raw, tris_uv_raw
            for _ in range(spec["subdivide"]):
                hv, uvs, tv, tuv = subdivide_uv_preserving_smooth(hv, uvs, tv, tuv)
            hv = groom_fitted_hair_mesh(spec["id"], gender, hv, g["glb_pos"])
            hv = enforce_cranial_clearance(hv, g["glb_pos"], min_clear=0.0022)
            pos_f32, nrm_f32, uv_f32, idx_u16 = build_split_vertex_buffers(
                hv, uvs, tv, tuv, crease_deg=float(spec.get("creaseDeg", 68.0))
            )

            per_gender_meshes[gender] = {
                "vertexCount": int(len(pos_f32)),
                "triangleCount": int(len(idx_u16) // 3),
                "positions": append_bytes(pos_f32),
                "normals": append_bytes(nrm_f32),
                "uvs": append_bytes(uv_f32),
                "indices": append_bytes(idx_u16),
            }
            print(
                f"  [{gender:6s}] {spec['id']:20s} -> {len(pos_f32):5d} verts, {len(idx_u16)//3:5d} tris"
            )

        manifest_assets[spec["id"]] = {
            "id": spec["id"],
            "alphaMode": spec["alphaMode"],
            "albedoPath": albedo_rel,
            "normalPath": normal_rel,
            "author": spec["author"],
            "license": spec["license"],
            "licenseHeader": spec["licenseHeader"],
            "meshes": per_gender_meshes,
        }

    manifest = {
        "version": 1,
        "binary": "models/mannequin/hair/mannequin-hair.bin",
        "styleMap": STYLE_MAP,
        "restHead": {
            "female": gender_data["female"]["restHead"],
            "male": gender_data["male"]["restHead"],
        },
        "assets": manifest_assets,
    }

    (OUT_DIR / "mannequin-hair.bin").write_bytes(b"".join(bin_chunks))
    (OUT_DIR / "mannequin-hair.json").write_text(
        json.dumps(manifest, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Wrote {OUT_DIR / 'mannequin-hair.bin'} ({byte_cursor / 1024:.1f} KB) and mannequin-hair.json")


if __name__ == "__main__":
    main()
