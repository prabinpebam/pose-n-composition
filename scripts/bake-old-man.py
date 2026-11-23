"""Blender background script: input rig GLB, output directory (after --)."""
import sys
from pathlib import Path

import bpy
import numpy as np

args = sys.argv[sys.argv.index('--') + 1:]
source, dest = map(Path, args[:2])
extra = len(args) > 2
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
body = bpy.data.objects[args[2] if extra else 'OldMan']
for ob in list(bpy.data.objects):
    if not extra and ob.type == 'MESH' and ob != body:
        bpy.data.objects.remove(ob, do_unlink=True)
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
bpy.context.view_layer.objects.active = body
if extra:
    body.data.uv_layers.new(name='GarmentUV')
    body.data.uv_layers.active_index = len(body.data.uv_layers)-1
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(island_margin=.003, margin_method='FRACTION', correct_aspect=False)
bpy.ops.object.mode_set(mode='OBJECT')
mesh = body.data
mesh.calc_loop_triangles()
uv = mesh.uv_layers.active.data
verts = np.array([list(body.matrix_world @ v.co) for v in mesh.vertices])
if extra:
    verts -= [0,0,verts[:,2].min()]
    verts *= 1.813 / verts[:,2].max()
norms = np.array([list((body.matrix_world.to_3x3() @ v.normal).normalized()) for v in mesh.vertices])
print('REST BOUNDS', verts.min(0), verts.max(0))
cranium = verts[verts[:, 2] > 1.71]
print('SKULL BAND', cranium.min(0), cranium.max(0))
n = 2048
rgb = np.zeros((n, n, 4), dtype='uint8')
for tri in mesh.loop_triangles:
    ids = list(tri.vertices)
    a,b,c = np.array([list(uv[i].uv) for i in tri.loops]) * [n,-n] + [-.5,n-.5]
    lo = np.maximum(0,np.ceil(np.minimum(np.minimum(a,b),c)).astype(int))
    hi = np.minimum(n-1,np.floor(np.maximum(np.maximum(a,b),c)).astype(int))
    if np.any(hi < lo): continue
    yy,xx = np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
    p = b-a; q=c-a; den=p[0]*q[1]-p[1]*q[0]
    if abs(den)<1e-8: continue
    u=((xx-a[0])*q[1]-(yy-a[1])*q[0])/den
    v=(p[0]*(yy-a[1])-p[1]*(xx-a[0]))/den
    hit=(u>=0)&(v>=0)&(u+v<=1)
    w=np.stack([1-u[hit]-v[hit],u[hit],v[hit]],axis=1)
    x,y,z=(w@verts[ids]).T
    nx,ny,nz=(w@norms[ids]).T
    neck = 1.526 - .055*np.exp(-(x/.091)**2)*np.clip(.65-y*4,0,1)
    dist = np.minimum.reduce([neck-z, z-.085, .322-np.abs(x)])
    alpha=np.clip(.5+dist/.004,0,1)
    seam=np.exp(-(np.minimum.reduce([abs(neck-z-.007),abs(abs(x)-.314),abs(z-.094)])/.0028)**2)
    belt=np.exp(-((z-.942)/.019)**6)
    folds=.024*(.5+.5*np.cos(z*85+3*np.sin(x*31)))*np.exp(-((z-.98)/.33)**2)
    shade=np.clip(.977+.039*nz-.017*np.abs(ny)-alpha*(.075*belt+.034*seam+folds),.82,1)
    pix=np.column_stack([shade,shade,shade,alpha])
    rgb[yy[hit],xx[hit]]=np.rint(pix*255).astype('uint8')
np.save(str(dest/'atlas.npy'),rgb)
if extra: mesh.uv_layers.active_index=0
bpy.ops.export_scene.gltf(filepath=str(dest/('Body.glb' if extra else 'OldMan.glb')),export_format='GLB',export_animations=False)
