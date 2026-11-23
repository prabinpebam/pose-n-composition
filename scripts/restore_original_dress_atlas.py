"""Extract an exact UV1 RGBA outfit atlas strictly from a model's original UV0 painted dress.

Used when a character's raw source mesh already has an authored painted garment in its
UV0 diffuse texture (e.g. Stylized Women's navy-and-gold bikini, Bailarina's mesh outfit,
stockings, and heels) so no synthetic crop-top/shorts are invented over the artist's work.

At default outfitColor = #ffffff, `garment.rgb * uOutfitColor` reproduces the exact
original UV0 garment colors; when outfitColor is customized, only the original garment
pixels tint while skin remains untouched.
"""
from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

import bpy
import numpy as np


def write_rgba_png(path: Path, rgba: np.ndarray) -> None:
    h, w, c = rgba.shape
    assert c == 4 and rgba.dtype == np.uint8

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    raw_rows = b"".join(b"\x00" + rgba[row].tobytes() for row in range(h))
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw_rows, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)


def linear_to_srgb(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1.0 / 2.4) - 0.055)


def sample_bilinear_srgb(img_srgb: np.ndarray, u: np.ndarray, v: np.ndarray) -> np.ndarray:
    h, w, _ = img_srgb.shape
    fx = np.mod(u, 1.0) * (w - 1)
    fy = np.mod(v, 1.0) * (h - 1)
    x0 = np.floor(fx).astype(np.int32)
    y0 = np.floor(fy).astype(np.int32)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    wx = (fx - x0)[:, None]
    wy = (fy - y0)[:, None]
    c00 = img_srgb[y0, x0]
    c10 = img_srgb[y0, x1]
    c01 = img_srgb[y1, x0]
    c11 = img_srgb[y1, x1]
    return (c00 * (1 - wx) + c10 * wx) * (1 - wy) + (c01 * (1 - wx) + c11 * wx) * wy


def classify_stylized_women_garment(
    pos: np.ndarray, srgb: np.ndarray, z_min: float, height: float
) -> np.ndarray:
    """Classify original navy/gold/white bikini + halter straps + hip bows vs peachy skin."""
    zn = (pos[:, 2] - z_min) / height
    ax = np.abs(pos[:, 0]) / height
    r, g, b = srgb[:, 0], srgb[:, 1], srgb[:, 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    sat_span = np.maximum(np.maximum(r, g), b) - np.minimum(np.minimum(r, g), b)
    warm_skin_gap = r - b  # Peachy skin has R - B ~ 0.11..0.18, G - B ~ 0.02..0.05
    yellow_gap = g - b     # Gold stripes have G - B ~ 0.12..0.28

    # Exclude head/neck above halter strap & arms outside torso/hip-bow envelope & lower legs
    in_top_zone = (zn >= 0.66) & (zn <= 0.855) & (ax <= 0.105)
    in_bottom_zone = (zn >= 0.44) & (zn <= 0.60) & (ax <= 0.125)
    in_zone = in_top_zone | in_bottom_zone

    # Original bikini components:
    # 1) Navy blue fabric: B >= R - 0.03 and darker than skin
    navy_score = np.clip(((b - r) + 0.04) / 0.07, 0.0, 1.0) * np.clip((0.78 - lum) / 0.14, 0.0, 1.0)
    # 2) Gold/mustard accent stripes: strong G - B compared to peachy skin
    gold_score = np.clip((yellow_gap - 0.075) / 0.045, 0.0, 1.0)
    # 3) White halter straps / trim & neutral grey-taupe hip bows: low R-B warmth compared to skin
    neutral_trim_score = np.clip((0.088 - warm_skin_gap) / 0.035, 0.0, 1.0) * np.clip(
        (0.095 - sat_span) / 0.04, 0.0, 1.0
    )
    # Darker taupe hip bows / shadow seams inside garment zone
    dark_bow_score = np.clip((0.66 - lum) / 0.10, 0.0, 1.0) * np.clip((0.12 - warm_skin_gap) / 0.05, 0.0, 1.0)

    raw_alpha = np.maximum.reduce([navy_score, gold_score, neutral_trim_score, dark_bow_score])
    return np.where(in_zone, raw_alpha, 0.0)


def classify_bailarina_garment(
    pos: np.ndarray, srgb: np.ndarray, z_min: float, height: float
) -> np.ndarray:
    """Classify Bailarina's original dark mesh top/bottoms, garter straps, fishnet stockings, buckles & white heels."""
    zn = (pos[:, 2] - z_min) / height
    ax = np.abs(pos[:, 0]) / height
    r, g, b = srgb[:, 0], srgb[:, 1], srgb[:, 2]
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    warm_skin_gap = r - b  # Bailarina warm tan skin has R - B ~ 0.19..0.26 and lum ~ 0.66..0.80

    # Exclude head/face (zn > 0.845) and bare arms/hands (ax > 0.105 above waist)
    in_upper_torso = (zn >= 0.64) & (zn <= 0.84) & (ax <= 0.102)
    in_pelvis_garter = (zn >= 0.38) & (zn <= 0.635) & (ax <= 0.115)
    in_stockings = (zn >= 0.075) & (zn < 0.395) & (ax <= 0.115)
    in_heels = (zn <= 0.095) & (ax <= 0.115)

    # Dark lace/straps/mesh/fishnet threads: distinctly darker or cooler than tan skin
    dark_garment = np.clip((0.58 - lum) / 0.12, 0.0, 1.0)
    cool_buckle_or_heel = np.clip((0.11 - warm_skin_gap) / 0.05, 0.0, 1.0)

    alpha = np.zeros_like(lum)
    torso_mask = in_upper_torso | in_pelvis_garter
    alpha = np.where(torso_mask, np.maximum(dark_garment, cool_buckle_or_heel), alpha)
    alpha = np.where(in_stockings, np.maximum(dark_garment, cool_buckle_or_heel), alpha)
    # White platform heels & soles + dark toe mesh at feet
    heel_white = np.clip((0.12 - warm_skin_gap) / 0.05, 0.0, 1.0) * np.clip((lum - 0.45) / 0.15, 0.0, 1.0)
    alpha = np.where(in_heels, np.maximum(dark_garment, heel_white), alpha)
    return alpha


def build_original_dress_atlas(mode: str, glb_path: Path, out_png: Path, n: int = 2048) -> dict:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb_path))

    body = next(o for o in bpy.data.objects if o.type == "MESH" and o.name == "StudioBody")
    me = body.data
    me.calc_loop_triangles()

    skin_mat = next(m for m in me.materials if m and m.name == "Skin")
    tex_node = next(nd for nd in skin_mat.node_tree.nodes if nd.type == "TEX_IMAGE" and nd.image)
    im = tex_node.image
    w, h = im.size
    raw_lin = np.empty(w * h * 4, dtype=np.float32)
    im.pixels.foreach_get(raw_lin)
    img_srgb = linear_to_srgb(raw_lin.reshape(h, w, 4)[:, :, :3])

    mw = np.array(body.matrix_world, dtype=np.float64)
    v_cnt = len(me.vertices)
    v_loc = np.empty(v_cnt * 3, dtype=np.float64)
    me.vertices.foreach_get("co", v_loc)
    verts_w = (np.column_stack([v_loc.reshape(v_cnt, 3), np.ones(v_cnt)]) @ mw.T)[:, :3]
    z_min = float(verts_w[:, 2].min())
    height = float(verts_w[:, 2].max() - z_min)

    uv0_data = me.uv_layers[0].data
    uv1_data = me.uv_layers[1].data
    l_cnt = len(me.loops)
    uv0_all = np.empty(l_cnt * 2, dtype=np.float64)
    uv1_all = np.empty(l_cnt * 2, dtype=np.float64)
    uv0_data.foreach_get("uv", uv0_all)
    uv1_data.foreach_get("uv", uv1_all)
    uv0_all = uv0_all.reshape(l_cnt, 2)
    uv1_all = uv1_all.reshape(l_cnt, 2)

    rgba = np.zeros((n, n, 4), dtype=np.uint8)
    covered_px = 0

    for tri in me.loop_triangles:
        # Skip sculpted hair material faces (material_index == 1)
        if tri.material_index != 0:
            continue
        loops = list(tri.loops)
        v_ids = list(tri.vertices)
        # glTF UV1 -> PNG row mapping matching scripts/rig-static-studio.py
        pts = uv1_all[loops] * np.array([n, -n]) + np.array([-0.5, n - 0.5])
        a, b, c = pts[0], pts[1], pts[2]
        lo = np.maximum(0, np.ceil(np.minimum(np.minimum(a, b), c)).astype(int))
        hi = np.minimum(n - 1, np.floor(np.maximum(np.maximum(a, b), c)).astype(int))
        if np.any(hi < lo):
            continue
        yy, xx = np.mgrid[lo[1] : hi[1] + 1, lo[0] : hi[0] + 1]
        p, q = b - a, c - a
        den = p[0] * q[1] - p[1] * q[0]
        if abs(den) < 1e-8:
            continue
        u_b = ((xx - a[0]) * q[1] - (yy - a[1]) * q[0]) / den
        v_b = (p[0] * (yy - a[1]) - p[1] * (xx - a[0])) / den
        hit = (u_b >= -1e-4) & (v_b >= -1e-4) & (u_b + v_b <= 1.0001)
        if not np.any(hit):
            continue

        bary = np.stack([1.0 - u_b[hit] - v_b[hit], u_b[hit], v_b[hit]], axis=1)
        pos_hit = bary @ verts_w[v_ids]
        uv0_hit = bary @ uv0_all[loops]
        srgb_hit = sample_bilinear_srgb(img_srgb, uv0_hit[:, 0], uv0_hit[:, 1])

        if mode == "stylized-women":
            alpha = classify_stylized_women_garment(pos_hit, srgb_hit, z_min, height)
        elif mode == "bailarina":
            alpha = classify_bailarina_garment(pos_hit, srgb_hit, z_min, height)
        else:
            raise ValueError(f"Unknown mode: {mode}")

        keep = alpha > 0.01
        if not np.any(keep):
            continue
        yh = yy[hit][keep]
        xh = xx[hit][keep]
        rgb_u8 = np.rint(np.clip(srgb_hit[keep], 0.0, 1.0) * 255.0).astype(np.uint8)
        a_u8 = np.rint(np.clip(alpha[keep], 0.0, 1.0) * 255.0).astype(np.uint8)
        rgba[yh, xh, :3] = rgb_u8
        rgba[yh, xh, 3] = np.maximum(rgba[yh, xh, 3], a_u8)
        covered_px += int(np.count_nonzero(a_u8 > 32))

    # 2-pixel RGB gutter dilation (preserving alpha=0 outside mask, preventing dark mip fringes on edges)
    for _ in range(2):
        empty_rgb = (rgba[:, :, 0] == 0) & (rgba[:, :, 1] == 0) & (rgba[:, :, 2] == 0) & (rgba[:, :, 3] == 0)
        for dy, dx in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
            nb = np.roll(rgba, (dy, dx), axis=(0, 1))
            has_nb = nb[:, :, 3] > 0
            fill = empty_rgb & has_nb
            rgba[fill, :3] = nb[fill, :3]
            empty_rgb[fill] = False

    write_rgba_png(out_png, rgba)
    return {"mode": mode, "out_png": str(out_png), "garment_pixels": int(np.count_nonzero(rgba[:, :, 3] > 32))}


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1 :]
    m_mode, in_glb, out_atlas = argv[0], Path(argv[1]), Path(argv[2])
    res = build_original_dress_atlas(m_mode, in_glb, out_atlas)
    print("ORIGINAL_DRESS_ATLAS:", res)
