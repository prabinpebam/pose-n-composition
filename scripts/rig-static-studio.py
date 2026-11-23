"""Headless adult mesh conversion. Requires a reviewed geometry/landmark JSON."""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix

source, config_path, dest = map(Path, sys.argv[sys.argv.index("--") + 1:][:3])
config = json.loads(config_path.read_text())
bpy.ops.wm.open_mainfile(filepath=str(source))
print("Preparing mesh", flush=True)
body = bpy.data.objects[config["mesh"]]
for ob in list(bpy.data.objects):
    if ob != body:
        bpy.data.objects.remove(ob, do_unlink=True)
bpy.context.view_layer.objects.active = body
body.select_set(True)
body.parent = None
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
if config.get("yawDegrees"):
    body.data.transform(Matrix.Rotation(math.radians(config["yawDegrees"]), 4, "Z"))
coords = np.array([v.co[:] for v in body.data.vertices])
scale = config["height"] / (coords[:, 2].max() - coords[:, 2].min())
center = (coords.min(0) + coords.max(0)) / 2
min_z = coords[:, 2].min()
for v in body.data.vertices:
    v.co.x = (v.co.x-center[0])*scale
    v.co.y = (v.co.y-center[1])*scale
    v.co.z = (v.co.z-min_z)*scale
body.name = "StudioBody"
if len(body.data.polygons) > config.get("triangles", 40000):
    mod = body.modifiers.new("Studio topology reduction", "DECIMATE")
    mod.ratio = config.get("triangles", 40000) / len(body.data.polygons)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
print("Segmenting materials", flush=True)
mesh = body.data
mesh.calc_loop_triangles()
verts = np.array([v.co[:] for v in mesh.vertices])
ground_offset = float(verts[:, 2].min())
for vertex in mesh.vertices:
    vertex.co.z -= ground_offset
verts[:, 2] -= ground_offset
normals = np.array([v.normal[:] for v in mesh.vertices])
native_material = mesh.materials[0]
native_image = next((n.image for n in native_material.node_tree.nodes if n.type == "TEX_IMAGE"), None)
hair_faces = np.zeros(len(mesh.polygons), dtype=bool)
hair_luminances = []
if config.get("nativeHair"):
    if native_image is None:
        raise ValueError("Native hair segmentation needs its source albedo")
    width, height = native_image.size
    image_pixels = np.empty(width*height*4, dtype=np.float32)
    native_image.pixels.foreach_get(image_pixels)
    image_pixels = image_pixels.reshape(height, width, 4)
    uv0 = mesh.uv_layers[0].data
    for face in mesh.polygons:
        points = verts[list(face.vertices)]
        uv = np.array([uv0[i].uv[:] for i in face.loop_indices])
        pix = image_pixels[np.clip((uv[:, 1]*height).astype(int), 0, height-1),
                           np.clip((uv[:, 0]*width).astype(int), 0, width-1), :3]
        native_color = (np.median(pix.mean(1)) < config["hairMaxLum"] or
                        (config.get("pinkHair") and np.median(pix[:, 2]-pix[:, 1]) > .003))
        side_lock = (config.get("hairSideMinZ") and abs(points[:, 0].mean()) > .075 and
                     points[:, 2].mean() > config["hairSideMinZ"] and
                     (points[:, 1].mean() > -.115 or points[:, 2].mean() > 1.4) and
                     np.median(pix[:, 0]-pix[:, 1]) > .007 and
                     np.median(pix[:, 1]-pix[:, 2]) > .0015)
        hair_faces[face.index] = (points[:, 2].mean() > config["hairMinZ"] and native_color and
                                 (points[:, 1].mean() > config.get("hairBackY", -1) or
                                  points[:, 2].mean() > config.get("hairFrontZ", 0) or
                                  side_lock or
                                  (config.get("pinkHair") and abs(points[:, 0].mean()) > .055 and
                                   points[:, 2].mean() > 1.45)))
        if hair_faces[face.index]:
            hair_luminances.extend(pix @ [.299, .587, .114])
    if hair_faces.sum() < 100:
        raise ValueError("Native hair segmentation found too few polygons")
skin = bpy.data.materials.new("Skin")
skin.use_nodes = True
bsdf = skin.node_tree.nodes.get("Principled BSDF")
bsdf.inputs["Roughness"].default_value = .8
if native_image:
    texture = skin.node_tree.nodes.new("ShaderNodeTexImage")
    texture.image = native_image
    skin.node_tree.links.new(texture.outputs["Color"], bsdf.inputs["Base Color"])
hair = bpy.data.materials.new("SculptedHair")
hair.diffuse_color = (.16, .09, .05, 1)
hair.use_nodes = True
hair.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = .7
if native_image and config.get("nativeHair"):
    texture = hair.node_tree.nodes.new("ShaderNodeTexImage")
    lo, hi = np.percentile(hair_luminances, [5, 95])
    luminance = image_pixels[:, :, :3] @ [.299, .587, .114]
    gray = .58+.42*np.clip((luminance-lo)/max(.01, hi-lo), 0, 1)
    pixels = np.ones((height, width, 4), dtype=np.float32)
    pixels[:, :, :3] = gray[:, :, None]
    neutral_hair = bpy.data.images.new("Native hair neutral shading", width=width, height=height)
    neutral_hair.pixels.foreach_set(pixels.ravel())
    texture.image = neutral_hair
    hair.node_tree.links.new(texture.outputs["Color"],
                            hair.node_tree.nodes.get("Principled BSDF").inputs["Base Color"])
mesh.materials.clear()
mesh.materials.append(skin)
if config.get("nativeHair"):
    mesh.materials.append(hair)
for face in mesh.polygons:
    face.material_index = int(hair_faces[face.index])
    face.use_smooth = True

hair_vertices = set()
for face in mesh.polygons:
    if face.material_index == 1:
        hair_vertices.update(face.vertices)
surface = verts[[i for i in range(len(verts)) if i not in hair_vertices]]
landmarks = {}
for name, data in config["bones"].items():
    point = np.array(data["head"], dtype=float)
    if name in ("hips", "spine", "chest", "neck", "head"):
        section = surface[(abs(surface[:, 2]-point[2]) < .012) & (abs(surface[:, 0]) < .025)]
        if len(section) < 6:
            raise ValueError(f"No sagittal cross-section for {name}")
        posterior, anterior = section[:, 1].max(), section[:, 1].min()
        point[1] = posterior-.375*(posterior-anterior) if name in ("hips", "spine", "chest") else (posterior+anterior)/2
    else:
        axis = np.array(data["tail"])-point
        axis /= np.linalg.norm(axis)
        nearby = surface[np.linalg.norm(surface-point, axis=1) < .105]
        section = nearby[abs((nearby-point) @ axis) < .012]
        if len(section) < 6:
            raise ValueError(f"No limb cross-section for {name}")
        # Depth midpoint of the native limb, without moving its authored stance.
        point[1] = (section[:, 1].min()+section[:, 1].max())/2
    data["head"] = point.tolist()
    landmarks[name] = {"head": point.tolist(), "sectionVertices": len(section)}
for name, data in config["bones"].items():
    children = [d for d in config["bones"].values() if d.get("parent") == name]
    if len(children) == 1:
        data["tail"] = children[0]["head"]
print("Measured anatomical landmarks", json.dumps(landmarks), flush=True)

armdata = bpy.data.armatures.new("Studio17")
arm = bpy.data.objects.new("Studio17", armdata)
bpy.context.collection.objects.link(arm)
bpy.ops.object.select_all(action="DESELECT")
arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for name, data in config["bones"].items():
    bone = armdata.edit_bones.new(name)
    bone.head = data["head"]
    bone.tail = data["tail"]
    if data.get("parent"):
        bone.parent = armdata.edit_bones[data["parent"]]
bpy.ops.object.mode_set(mode="OBJECT")
body.select_set(True)
print("Assigning smooth four-joint segment weights", flush=True)
body.parent = arm
modifier = body.modifiers.new("Studio skin", "ARMATURE")
modifier.object = arm
names = list(config["bones"])
for name in names:
    body.vertex_groups.new(name=name)
distances = []
for data in config["bones"].values():
    start, end = np.array(data["head"]), np.array(data["tail"])
    axis = end-start
    along = np.clip(((verts-start) @ axis)/(axis @ axis), 0, 1)
    distances.append(((verts-start-along[:, None]*axis)**2).sum(1))
distances = np.column_stack(distances)
# Prevent cross-leg and cross-arm influence, while retaining proximal torso blending.
for i, name in enumerate(names):
    if name.startswith("left"):
        distances[verts[:, 0] < -.015, i] = 100
    elif name.startswith("right"):
        distances[verts[:, 0] > .015, i] = 100
    if "Arm" in name or "Hand" in name:
        distances[verts[:, 2] < .88, i] = 100
    if "Leg" in name or "Foot" in name:
        distances[verts[:, 2] > 1.02, i] = 100
closest = np.argsort(distances, axis=1)[:, :4]
selected = np.take_along_axis(distances, closest, axis=1)
sigma = .06
smooth_weights = np.exp(-(selected-selected[:, :1])/(2*sigma*sigma))
smooth_weights /= smooth_weights.sum(1)[:, None]
# Long sculpted locks travel with the head, not with the nearby shoulders.
vertex_weights = []
for v in mesh.vertices:
    weights = [(body.vertex_groups["head"].index, 1)] if v.index in hair_vertices else list(
        zip(closest[v.index], smooth_weights[v.index]))
    if not weights:
        raise ValueError(f"Unweighted vertex {v.index}")
    total = sum(w for _, w in weights)
    vertex_weights.append([(g, w/total) for g, w in weights])
all_indices = list(range(len(mesh.vertices)))
for group in body.vertex_groups:
    group.remove(all_indices)
for index, weights in enumerate(vertex_weights):
    for group, weight in weights:
        body.vertex_groups[int(group)].add([index], float(weight), "REPLACE")

bpy.context.view_layer.objects.active = body
arm.select_set(False)
print("Unwrapping garment atlas", flush=True)
mesh.uv_layers.new(name="GarmentUV")
mesh.uv_layers.active_index = len(mesh.uv_layers)-1
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(island_margin=.003, margin_method="FRACTION", correct_aspect=False)
bpy.ops.object.mode_set(mode="OBJECT")
mesh.calc_loop_triangles()
uv = mesh.uv_layers.active.data
n = 2048
print("Baking cavity AO", flush=True)
ao = bpy.data.images.new("Studio cavity AO", width=n, height=n, alpha=False)
ao.colorspace_settings.name = "Non-Color"
for material in mesh.materials:
    node = material.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = ao
    material.node_tree.nodes.active = node
bpy.context.scene.render.engine = "CYCLES"
bpy.context.scene.cycles.samples = 16
bpy.context.scene.render.bake.margin = 3
bpy.ops.object.bake(type="AO")
ao_pixels = np.empty(n*n*4, dtype=np.float32)
ao.pixels.foreach_get(ao_pixels)
ao_pixels = np.flipud(ao_pixels.reshape(n, n, 4)[:, :, 0])
print("Rasterizing garment", flush=True)
rgba = np.zeros((n, n, 4), dtype=np.uint8)
garment = config["garment"]
for tri in mesh.loop_triangles:
    ids = list(tri.vertices)
    a, b, c = np.array([uv[i].uv[:] for i in tri.loops])*[n, -n]+[-.5, n-.5]
    lo = np.maximum(0, np.ceil(np.minimum(np.minimum(a, b), c)).astype(int))
    hi = np.minimum(n-1, np.floor(np.maximum(np.maximum(a, b), c)).astype(int))
    if np.any(hi < lo):
        continue
    yy, xx = np.mgrid[lo[1]:hi[1]+1, lo[0]:hi[0]+1]
    p, q = b-a, c-a
    den = p[0]*q[1]-p[1]*q[0]
    if abs(den) < 1e-8:
        continue
    u = ((xx-a[0])*q[1]-(yy-a[1])*q[0])/den
    v = (p[0]*(yy-a[1])-p[1]*(xx-a[0]))/den
    hit = (u >= 0) & (v >= 0) & (u+v <= 1)
    w = np.stack([1-u[hit]-v[hit], u[hit], v[hit]], axis=1)
    x, y, z = (w @ verts[ids]).T
    nx, ny, nz = (w @ normals[ids]).T
    neck = garment["neck"]-.03*np.exp(-(x/.075)**2)*np.clip(.5-y*3, 0, 1)
    distance = np.minimum.reduce([neck-z, z-garment["hem"], garment["width"]-abs(x)])
    t = np.clip(.5+distance/.006, 0, 1)
    alpha = t*t*(3-2*t)
    seam = np.exp(-((abs(distance)-.006)/.002)**2)
    belt = np.exp(-((z-garment["waist"])/.014)**4)
    shade = np.clip(.96+.035*nz-.018*abs(ny)-.035*seam-.05*belt, .82, 1)
    shade *= .82+.18*np.sqrt(np.clip(ao_pixels[yy[hit], xx[hit]], 0, 1))
    rgba[yy[hit], xx[hit]] = np.rint(np.column_stack([shade, shade, shade, alpha])*255).astype(np.uint8)
# Two-pixel island dilation keeps bilinear/mipmap edges from sampling empty UV gutters.
for _ in range(2):
    empty = rgba[:, :, 0] == 0
    for dy, dx in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
        neighbor = np.roll(rgba, (dy, dx), (0, 1))
        use = empty & (neighbor[:, :, 0] != 0)
        rgba[use] = neighbor[use]
        empty[use] = False
dest.mkdir(parents=True, exist_ok=True)
np.save(str(dest/"atlas.npy"), rgba)
mesh.uv_layers.active_index = 0
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True)
arm.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(dest/"Body.glb"), export_format="GLB",
                          export_animations=False, use_selection=True)
report = {"height": config["height"], "minZ": float(verts[:, 2].min()),
          "vertices": len(mesh.vertices), "triangles": len(mesh.loop_triangles),
          "nativeHairTriangles": int(hair_faces.sum()), "joints": list(config["bones"]),
          "landmarks": landmarks, "groundOffset": ground_offset}
(dest/"conversion.json").write_text(json.dumps(report, indent=2))
bpy.ops.wm.save_as_mainfile(filepath=str(dest/"converted.blend"))
print(json.dumps(report))
