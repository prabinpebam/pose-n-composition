import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, gunzipSync, gzipSync, inflateSync } from 'node:zlib';
import * as T from 'three';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public', 'models', 'mannequin');
const CACHE = process.env.MANNEQUIN_CACHE || path.join(tmpdir(), 'pose-char-research', 'pinned');
const MPFB = '9de0707fdc88438d7c53a1a2ac7937d9221e2431';
const MH = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const DATA = `https://raw.githubusercontent.com/makehumancommunity/mpfb2/${MPFB}/src/mpfb/data/`;
const TYPES = ['realistic', 'heroic', 'lean', 'slender', 'busty', 'chubby', 'fat', 'obese', 'chibi'];
const SEXES = ['female', 'male'];
const N = 13380;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const v3 = a => new T.Vector3().fromArray(a);
const rename = n => n === 'Root' ? 'root' : n === 'head' ? 'Head' : n;
const provenance = [];
let sourceLock;

async function source(relative, url = DATA + relative) {
  const filename = path.join(CACHE, relative.replaceAll('/', '__'));
  let bytes;
  try { bytes = await readFile(filename); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    if (process.argv.includes('--offline')) throw new Error(`Missing pinned source: ${filename}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Asset download ${response.status}: ${url}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(path.dirname(filename), { recursive: true });
    await writeFile(filename, bytes);
  }
  const digest = sha(bytes);
  const expected = sourceLock?.sources.find(s => s.url === url);
  if (sourceLock && !expected && !process.argv.includes('--update-lock')) throw new Error(`Source absent from committed lock: ${url}; use --update-lock only when deliberately adding pinned CC0 inputs`);
  if (expected && expected.sha256 !== digest) throw new Error(`SHA-256 mismatch: ${filename}`);
  provenance.push({ path: relative, url, sha256: digest, bytes: bytes.length });
  return bytes;
}

function obj(text) {
  const vertices = [], uv = [], faces = [], groups = new Map();
  let group = 'default';
  for (const line of text.split(/\r?\n/)) {
    const [tag, ...parts] = line.trim().split(/\s+/);
    if (tag === 'v') vertices.push(parts.map(Number));
    if (tag === 'vt') uv.push(parts.slice(0, 2).map(Number));
    if (tag === 'g') group = parts[0];
    if (tag === 'f') {
      const face = parts.map(p => p.split('/').slice(0, 2).map(x => Number(x) - 1));
      faces.push({ group, face });
      if (!groups.has(group)) groups.set(group, new Set());
      face.forEach(([i]) => groups.get(group).add(i));
    }
  }
  return { vertices, uv, faces, groups };
}

const targets = new Map();
async function target(name) {
  if (!targets.has(name)) {
    const bytes = await source(`targets/${name}.target.gz`);
    const lines = gunzipSync(bytes).toString().split(/\r?\n/);
    targets.set(name, lines.filter(l => /^\d+\s/.test(l)).map(l => l.trim().split(/\s+/).map(Number)));
  }
  return targets.get(name);
}

function recipe(sex, type) {
  const result = [];
  const add = (name, weight = 1) => result.push([name, weight]);
  const age = type === 'chibi' ? [['baby', 0.45], ['child', 0.55]] : [['young', 1]];
  let muscle = 'averagemuscle', weight = 'averageweight';
  if (type === 'heroic' || type === 'lean' || (type === 'busty' && sex === 'male')) muscle = 'maxmuscle';
  if (type === 'slender' || ['chubby', 'fat', 'obese'].includes(type)) muscle = 'minmuscle';
  if (type === 'lean' || type === 'slender') weight = 'minweight';
  for (const [a, amount] of age) {
    const blend = type === 'chibi'
      ? { african: 1 / 3, asian: 1 / 3, caucasian: 1 / 3 }
      : { african: 0.30, asian: 0.25, caucasian: 0.45 };
    for (const ethnicity of ['african', 'asian', 'caucasian']) {
      add(`macrodetails/${ethnicity}-${sex}-${a}`, amount * blend[ethnicity]);
    }
    if (type === 'realistic') {
      add(`macrodetails/universal-${sex}-${a}-averagemuscle-averageweight`, amount * (sex === 'female' ? 0.88 : 0.72));
      add(`macrodetails/universal-${sex}-${a}-maxmuscle-averageweight`, amount * (sex === 'female' ? 0.12 : 0.28));
    } else if (type === 'heroic') {
      add(`macrodetails/universal-${sex}-${a}-maxmuscle-averageweight`, amount * (sex === 'male' ? 0.78 : 0.58));
      add(`macrodetails/universal-${sex}-${a}-averagemuscle-averageweight`, amount * (sex === 'male' ? 0.0 : 0.26));
      add(`macrodetails/universal-${sex}-${a}-maxmuscle-minweight`, amount * (sex === 'male' ? 0.08 : 0.16));
      if (sex === 'male') add(`macrodetails/universal-${sex}-${a}-maxmuscle-maxweight`, amount * 0.14);
    } else if (['chubby', 'fat', 'obese'].includes(type)) {
      const heavy = { chubby: 0.44, fat: 0.82, obese: 1.16 }[type];
      add(`macrodetails/universal-${sex}-${a}-${muscle}-averageweight`, amount * (1 - heavy));
      add(`macrodetails/universal-${sex}-${a}-${muscle}-maxweight`, amount * heavy);
    } else if (type === 'busty' && sex === 'male') {
      add(`macrodetails/universal-${sex}-${a}-maxmuscle-averageweight`, amount * 0.72);
      add(`macrodetails/universal-${sex}-${a}-maxmuscle-maxweight`, amount * 0.28);
    } else add(`macrodetails/universal-${sex}-${a}-${muscle}-${weight}`, amount);
  }
  if (['realistic', 'heroic', 'lean', 'busty'].includes(type)) {
    const idealWeight = {
      realistic: sex === 'female' ? 0.18 : 0.44,
      heroic: sex === 'female' ? 0.52 : 0.90,
      lean: sex === 'female' ? 0.26 : 0.48,
      busty: sex === 'female' ? 0.28 : 0.65,
    }[type];
    add(`macrodetails/proportions/${sex}-young-maxmuscle-averageweight-idealproportions`, idealWeight);
  }
  if (type === 'slender') {
    add(`macrodetails/proportions/${sex}-young-minmuscle-minweight-idealproportions`, 0.72);
    add('hip/hip-scale-horiz-incr', sex === 'male' ? -0.22 : -0.16);
  }
  if (sex === 'female' && type !== 'chibi') {
    // Anatomically grounded CC0 MakeHuman female breast proportions across all adult builds
    const cupAvg = {
      realistic: 0.30, heroic: 0.26, lean: 0.20, slender: 0.17,
      busty: 0.74, chubby: 0.38, fat: 0.44, obese: 0.50,
    }[type] ?? 0.30;
    const cupFirm = {
      realistic: 0.17, heroic: 0.21, lean: 0.16, slender: 0.13,
      busty: 0.28, chubby: 0.11, fat: 0.09, obese: 0.08,
    }[type] ?? 0.16;
    const pointRound = {
      realistic: 0.34, heroic: 0.32, lean: 0.26, slender: 0.22,
      busty: 0.62, chubby: 0.36, fat: 0.40, obese: 0.44,
    }[type] ?? 0.32;
    add('breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness', cupAvg);
    add('breast/female-young-averagemuscle-averageweight-maxcup-maxfirmness', cupFirm);
    add('breast/breast-point-decr', pointRound);
  }
  if (type === 'realistic') {
    add('torso/torso-vshape-incr', sex === 'male' ? 0.28 : 0.10);
    if (sex === 'male') {
      add('torso/torso-scale-horiz-incr', 0.07);
      add('torso/torso-scale-depth-incr', 0.05);
      add('hip/hip-scale-horiz-incr', -0.06);
    } else {
      add('hip/hip-scale-horiz-incr', -0.08);
    }
  }
  if (type === 'heroic') {
    add('torso/torso-vshape-incr', sex === 'male' ? 0.52 : 0.20);
    add('torso/torso-scale-horiz-incr', sex === 'male' ? 0.18 : 0.06);
    add('torso/torso-scale-depth-incr', sex === 'male' ? 0.16 : 0.04);
  }
  if (type === 'lean') {
    add('torso/torso-vshape-incr', sex === 'male' ? 0.28 : 0.10);
    add('hip/hip-scale-horiz-incr', sex === 'male' ? -0.10 : -0.12);
  }
  if (type === 'busty') {
    if (sex === 'female') {
      add('hip/hip-scale-horiz-incr', 0.24);
    } else {
      add('torso/torso-vshape-incr', 0.34);
      add('torso/torso-scale-depth-incr', 0.44);
      add('torso/torso-scale-horiz-incr', 0.24);
    }
  }
  const fat = { chubby: 0.16, fat: 0.38, obese: 0.68 }[type] || 0;
  if (fat) {
    add('stomach/stomach-tone-decr', fat);
    add('stomach/stomach-pregnant-incr', fat * 0.28);
    add('buttocks/buttocks-volume-incr', fat * 0.42);
    add('neck/neck-double-incr', fat * 0.62);
    for (const side of ['l', 'r']) {
      add(`arms/${side}-upperarm-fat-incr`, fat * 1.22);
      add(`legs/${side}-upperleg-fat-incr`, fat * 1.04);
      add(`cheek/${side}-cheek-volume-incr`, fat * 0.24);
    }
  }
  if (type === 'chibi') {
    for (const side of ['l', 'r']) {
      add(`eyes/${side}-eye-scale-incr`, 0.4);
      add(`cheek/${side}-cheek-volume-incr`, 0.25);
    }
    add('chin/chin-height-decr', 0.1);
    add('nose/nose-scale-depth-decr', 0.15);
  }
  add('breast/nipple-size-decr', sex === 'female' ? 0.82 : 1);
  add('breast/nipple-point-decr', sex === 'female' ? 0.78 : 1);
  return result;
}

function centroid(points, indices) {
  const result = new T.Vector3();
  for (const i of indices) result.add(v3(points[i]));
  return result.divideScalar(indices.size ?? indices.length);
}

function endpoint(spec, points, base) {
  if (spec.strategy === 'CUBE') {
    const indices = base.groups.get(spec.cube_name);
    assert(indices?.size, `Missing joint helper: ${spec.cube_name}`);
    return centroid(points, indices);
  }
  if (spec.vertex_indices) return centroid(points, spec.vertex_indices);
  throw new Error(`Unsupported joint strategy: ${JSON.stringify(spec)}`);
}

function skinWeights(weights, names) {
  const influences = Array.from({ length: N }, () => []);
  for (const [name, list] of Object.entries(weights.weights)) {
    const bone = names.indexOf(rename(name));
    assert(bone >= 0);
    for (const [vertex, weight] of list) if (vertex < N && weight > 0) influences[vertex].push([bone, weight]);
  }
  return influences.map((list, i) => {
    list.sort((a, b) => b[1] - a[1]);
    list = list.slice(0, 4);
    const total = list.reduce((s, p) => s + p[1], 0);
    assert(total > 0, `Unweighted body vertex ${i}`);
    return list.map(([bone, weight]) => [bone, weight / total]);
  });
}

function sourceOrientations(gltf) {
  const nodes = gltf.nodes.map(n => {
    const o = new T.Object3D();
    o.name = n.name;
    if (n.matrix) o.applyMatrix4(new T.Matrix4().fromArray(n.matrix));
    else {
      if (n.translation) o.position.fromArray(n.translation);
      if (n.rotation) o.quaternion.fromArray(n.rotation);
      if (n.scale) o.scale.fromArray(n.scale);
    }
    return o;
  });
  gltf.nodes.forEach((n, i) => n.children?.forEach(c => nodes[i].add(nodes[c])));
  const roots = nodes.filter(n => !n.parent);
  const update = () => roots.forEach(n => n.updateMatrixWorld(true));
  update();
  const measured = Object.fromEntries(nodes.map(n => [n.name, {
    position: n.getWorldPosition(new T.Vector3()).toArray(),
    quaternion: n.getWorldQuaternion(new T.Quaternion()).toArray(),
  }]));
  const find = name => nodes.find(n => n.name === name);
  for (const side of ['l', 'r']) {
    for (const [boneName, childName, direction] of [
      [`upperarm_${side}`, `lowerarm_${side}`, new T.Vector3(side === 'l' ? 0.12 : -0.12, -1, 0).normalize()],
      [`lowerarm_${side}`, `hand_${side}`, new T.Vector3(0, -1, 0)],
    ]) {
      const bone = find(boneName), child = find(childName);
      const from = child.getWorldPosition(new T.Vector3()).sub(bone.getWorldPosition(new T.Vector3())).normalize();
      const world = bone.getWorldQuaternion(new T.Quaternion());
      const parent = bone.parent.getWorldQuaternion(new T.Quaternion()).invert();
      bone.quaternion.copy(parent.multiply(new T.Quaternion().setFromUnitVectors(from, direction)).multiply(world));
      update();
    }
  }
  return {
    measured,
    world: Object.fromEntries(nodes.map(n => [n.name, n.getWorldQuaternion(new T.Quaternion())])),
  };
}

function dqs(point, influences, transforms) {
  const real = new T.Quaternion(0, 0, 0, 0), dual = new T.Quaternion(0, 0, 0, 0);
  const reference = transforms[influences[0][0]].q;
  for (const [i, weight] of influences) {
    const { q, d } = transforms[i];
    const w = q.dot(reference) < 0 ? -weight : weight;
    for (const key of ['x', 'y', 'z', 'w']) { real[key] += q[key] * w; dual[key] += d[key] * w; }
  }
  const length = Math.sqrt(real.dot(real));
  for (const key of ['x', 'y', 'z', 'w']) { real[key] /= length; dual[key] /= length; }
  const dot = real.dot(dual);
  for (const key of ['x', 'y', 'z', 'w']) dual[key] -= dot * real[key];
  const translation = dual.multiply(real.clone().conjugate());
  return point.clone().applyQuaternion(real).add(new T.Vector3(translation.x, translation.y, translation.z).multiplyScalar(2));
}

function alignRest(points, base, rig, names, weights) {
  const old = names.map(name => endpoint(rig[name === 'root' ? 'Root' : name === 'Head' ? 'head' : name].head, points, base));
  const tails = names.map(name => endpoint(rig[name === 'root' ? 'Root' : name === 'Head' ? 'head' : name].tail, points, base));
  const parents = names.map(name => names.indexOf(rename(rig[name === 'root' ? 'Root' : name === 'Head' ? 'head' : name].parent)));
  const posed = [], rotations = [];
  function solve(i) {
    if (posed[i]) return;
    const p = parents[i];
    if (p >= 0) solve(p);
    const parentQ = p >= 0 ? rotations[p] : new T.Quaternion();
    posed[i] = p >= 0 ? old[i].clone().sub(old[p]).applyQuaternion(parentQ).add(posed[p]) : old[i].clone();
    rotations[i] = parentQ.clone();
    const name = names[i];
    let direction;
    if (/^(thigh|calf)_/.test(name) || /^lowerarm_/.test(name)) direction = new T.Vector3(0, -1, 0);
    if (/^upperarm_/.test(name)) direction = new T.Vector3(name.endsWith('_l') ? 0.12 : -0.12, -1, 0).normalize();
    if (direction) {
      const from = tails[i].clone().sub(old[i]).applyQuaternion(parentQ).normalize();
      rotations[i].premultiply(new T.Quaternion().setFromUnitVectors(from, direction));
    }
    // Keep soles flat rather than carrying knee-straightening into the feet.
    if (/^foot_/.test(name)) rotations[i].identity();
  }
  names.forEach((_, i) => solve(i));
  const transforms = rotations.map((q, i) => {
    const t = posed[i].clone().sub(old[i].clone().applyQuaternion(q));
    const d = new T.Quaternion(t.x, t.y, t.z, 0).multiply(q);
    for (const k of ['x', 'y', 'z', 'w']) d[k] *= 0.5;
    return { q, d };
  });
  return {
    vertices: points.slice(0, N).map((p, i) => dqs(v3(p), weights[i], transforms)),
    bones: posed,
    parents,
    transformHead: p => dqs(v3(p), [[names.indexOf('Head'), 1]], transforms),
  };
}

function realignProportionedRest(meshes, bones, names, parents) {
  const old = bones.map(p => p.clone()), posed = [], rotations = [];
  function solve(i) {
    if (posed[i]) return;
    const parent = parents[i];
    if (parent >= 0) solve(parent);
    const parentQ = parent >= 0 ? rotations[parent] : new T.Quaternion();
    posed[i] = parent >= 0 ? old[i].clone().sub(old[parent]).applyQuaternion(parentQ).add(posed[parent]) : old[i].clone();
    rotations[i] = parentQ.clone();
    const name = names[i], side = name.endsWith('_l') ? 'l' : 'r';
    const childName = name.startsWith('upperarm_') ? `lowerarm_${side}` : name.startsWith('lowerarm_') ? `hand_${side}` :
      name.startsWith('thigh_') ? `calf_${side}` : name.startsWith('calf_') ? `foot_${side}` : null;
    if (childName) {
      const direction = new T.Vector3(name.startsWith('upperarm_') ? side === 'l' ? 0.12 : -0.12 : 0, -1, 0).normalize();
      const from = old[names.indexOf(childName)].clone().sub(old[i]).applyQuaternion(parentQ).normalize();
      rotations[i].premultiply(new T.Quaternion().setFromUnitVectors(from, direction));
    }
    if (name.startsWith('foot_')) rotations[i].identity();
  }
  names.forEach((_, i) => solve(i));
  const transforms = rotations.map((q, i) => {
    const t = posed[i].clone().sub(old[i].clone().applyQuaternion(q));
    const d = new T.Quaternion(t.x, t.y, t.z, 0).multiply(q);
    for (const k of ['x', 'y', 'z', 'w']) d[k] *= 0.5;
    return { q, d };
  });
  meshes.forEach(mesh => {
    for (let i = 0; i < mesh.position.length / 3; i++) {
      const influences = [];
      for (let k = 0; k < 4; k++) if (mesh.weights[i * 4 + k]) influences.push([mesh.joints[i * 4 + k], mesh.weights[i * 4 + k]]);
      dqs(new T.Vector3().fromArray(mesh.position, i * 3), influences, transforms).toArray(mesh.position, i * 3);
    }
  });
  bones.forEach((bone, i) => bone.copy(posed[i]));
}

function splitMesh(faces, points, uv, influences, originalCount, faceDressSides = null) {
  const keys = new Map(), positions = [], uvs = [], joints = [], weights = [], indices = [], weld = [], dressSides = [];
  faces.forEach(({ face }, fi) => {
    const side = faceDressSides ? faceDressSides[fi] : 0;
    const ids = face.map(([vi, ti]) => {
      const key = faceDressSides ? `${vi}/${ti}/${side}` : `${vi}/${ti}`;
      if (!keys.has(key)) {
        keys.set(key, keys.size);
        positions.push(...points[vi].toArray());
        uvs.push(uv[ti]?.[0] || 0, 1 - (uv[ti]?.[1] || 0));
        weld.push(vi);
        dressSides.push(side);
        const inf = influences[vi];
        for (let k = 0; k < 4; k++) { joints.push(inf[k]?.[0] || 0); weights.push(inf[k]?.[1] || 0); }
      }
      return keys.get(key);
    });
    for (let k = 1; k < ids.length - 1; k++) indices.push(ids[0], ids[k], ids[k + 1]);
  });
  assert(keys.size <= 65535, `Mesh exceeds uint16 index range (${keys.size})`);
  const mesh = {
    position: new Float32Array(positions), uv: new Float32Array(uvs),
    joints: new Uint16Array(joints), weights: new Float32Array(weights),
    indices: new Uint16Array(indices), weld: new Uint16Array(weld),
    dressSide: faceDressSides ? new Uint8Array(dressSides) : null,
    originalCount,
  };
  mesh.normal = normals(mesh);
  return mesh;
}

function subdivideBody(faces, points, uv, influences) {
  const edges = new Map(), vertexFaces = Array.from({ length: points.length }, () => []);
  const vertexEdges = Array.from({ length: points.length }, () => []);
  const facePoints = faces.map(({ face }, fi) => {
    face.forEach(([a], i) => {
      vertexFaces[a].push(fi);
      const b = face[(i + 1) % face.length][0], key = [a, b].sort((x, y) => x - y).join('/');
      if (!edges.has(key)) {
        const edge = { a, b, faces: [], index: edges.size };
        edges.set(key, edge); vertexEdges[a].push(edge); vertexEdges[b].push(edge);
      }
      edges.get(key).faces.push(fi);
    });
    return face.reduce((sum, [i]) => sum.add(points[i]), new T.Vector3()).divideScalar(face.length);
  });
  const faceWeights = faces.map(({ face }) => {
    const result = new Map();
    face.forEach(([i]) => influences[i].forEach(([bone, weight]) => result.set(bone, (result.get(bone) || 0) + weight / face.length)));
    return result;
  });
  function combine(terms) {
    const sums = new Map();
    for (const [weights, factor] of terms) for (const [bone, weight] of weights) sums.set(bone, (sums.get(bone) || 0) + weight * factor);
    const top = [...sums].filter(([, w]) => w > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = top.reduce((s, [, w]) => s + w, 0);
    return top.map(([bone, weight]) => [bone, weight / total]);
  }
  const resultPoints = points.map((p, i) => {
    const n = vertexFaces[i].length;
    const favg = vertexFaces[i].reduce((sum, fi) => sum.add(facePoints[fi]), new T.Vector3()).divideScalar(n);
    const ravg = vertexEdges[i].reduce((sum, e) => sum.add(points[e.a]).add(points[e.b]), new T.Vector3()).divideScalar(n * 2);
    return p.clone().multiplyScalar(n - 3).add(favg).addScaledVector(ravg, 2).divideScalar(n);
  });
  const resultWeights = points.map((_, i) => {
    const n = vertexFaces[i].length;
    return combine([
      [influences[i], (n - 3) / n],
      ...vertexFaces[i].map(fi => [faceWeights[fi], 1 / (n * n)]),
      ...vertexEdges[i].flatMap(e => [[influences[e.a], 1 / (n * n)], [influences[e.b], 1 / (n * n)]]),
    ]);
  });
  for (const edge of edges.values()) {
    assert.equal(edge.faces.length, 2, 'Catmull-Clark requires a closed body');
    resultPoints.push(points[edge.a].clone().add(points[edge.b]).add(facePoints[edge.faces[0]]).add(facePoints[edge.faces[1]]).multiplyScalar(0.25));
    resultWeights.push(combine([[influences[edge.a], 0.25], [influences[edge.b], 0.25], ...edge.faces.map(fi => [faceWeights[fi], 0.25])]));
  }
  resultPoints.push(...facePoints);
  resultWeights.push(...faceWeights.map(weights => combine([[weights, 1]])));
  const newUv = uv.map(p => [...p]), uvEdges = new Map(), newFaces = [];
  function edgeUv(a, b) {
    const key = [a, b].sort((x, y) => x - y).join('/');
    if (!uvEdges.has(key)) { uvEdges.set(key, newUv.length); newUv.push([(uv[a][0] + uv[b][0]) / 2, (uv[a][1] + uv[b][1]) / 2]); }
    return uvEdges.get(key);
  }
  faces.forEach(({ face }, fi) => {
    const center = points.length + edges.size + fi, centerUv = newUv.length;
    newUv.push([0, 1].map(axis => face.reduce((s, [, ti]) => s + uv[ti][axis], 0) / face.length));
    face.forEach(([vi, ti], i) => {
      const [next, nt] = face[(i + 1) % face.length], [prev, pt] = face[(i + face.length - 1) % face.length];
      const ne = points.length + edges.get([vi, next].sort((a, b) => a - b).join('/')).index;
      const pe = points.length + edges.get([prev, vi].sort((a, b) => a - b).join('/')).index;
      newFaces.push({ face: [[vi, ti], [ne, edgeUv(ti, nt)], [center, centerUv], [pe, edgeUv(pt, ti)]] });
    });
  });
  return { vertices: resultPoints, influences: resultWeights, uv: newUv, faces: newFaces };
}

function normals(mesh) {
  const acc = Array.from({ length: mesh.originalCount }, () => new T.Vector3());
  const a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ids = Array.from(mesh.indices.subarray(i, i + 3));
    a.fromArray(mesh.position, ids[0] * 3);
    b.fromArray(mesh.position, ids[1] * 3);
    c.fromArray(mesh.position, ids[2] * 3);
    const normal = b.sub(a).cross(c.sub(a));
    ids.forEach(id => acc[mesh.weld[id]].add(normal));
  }
  acc.forEach(n => n.normalize());
  return Float32Array.from(Array.from(mesh.weld).flatMap(w => acc[w].toArray()));
}

function sculptAnimeChibi(points, eyeMap) {
  const centers = [eyeMap.slice(0, 48), eyeMap.slice(48)].map(ids => centroid(points, ids));
  const original = points.map(p => [...p]);
  const eyeY = (centers[0].y + centers[1].y) / 2, eyeZ = (centers[0].z + centers[1].z) / 2;
  const eyeX = Math.abs(centers[0].x), offsetY = eyeY - 0.574, offsetZ = eyeZ - 0.767;
  // Monotone landmark warps enlarge sockets without folding the bridge or temples.
  function remap(value, source, destination) {
    let i = 0;
    while (i < source.length - 2 && value > source[i + 1]) i++;
    return T.MathUtils.lerp(destination[i], destination[i + 1], (value - source[i]) / (source[i + 1] - source[i]));
  }
  const mapX = x => Math.sign(x) * remap(Math.abs(x) * 0.232 / eyeX,
    [0, 0.07, 0.12, 0.23, 0.35, 0.5, 0.68, 0.9], [0, 0.045, 0.09, 0.32, 0.56, 0.67, 0.75, 0.91]);
  const mapY = y => remap(y, [-0.45, -0.143, 0.18, 0.35, 0.52, 0.574, 0.63, 0.75, 1, 1.5],
    [-0.45, -0.143, 0.12, 0.25, 0.36, 0.5, 0.65, 0.82, 1.05, 1.5]);
  function faceDepth(x, y) {
    return 0.91 - 0.22 * (x / 0.74) ** 2 - 0.09 * ((y - 0.55) / 0.85) ** 2
      + 0.045 * Math.exp(-((x / 0.055) ** 2 + ((y - 0.25) / 0.05) ** 2))
      - 0.009 * Math.exp(-((x / 0.075) ** 4 + ((y - 0.12) / 0.012) ** 2));
  }
  points.forEach((p, i) => {
    const [x, rawY, rawZ] = original[i], y = rawY - offsetY, z = rawZ - offsetZ;
    const head = smooth(-0.42, -0.22, y);
    if (!head) return;
    const silhouette = x * (0.68 + 0.44 * smooth(-0.13, 0.3, y));
    const eyes = smooth(-0.04, 0.24, y) * (1 - smooth(0.76, 1.06, y)) * smooth(0.15, 0.65, z);
    p[0] = T.MathUtils.lerp(x, T.MathUtils.lerp(silhouette, mapX(x), eyes), head);
    p[1] = T.MathUtils.lerp(y, mapY(y), head) + offsetY;
    const front = head * smooth(0.48, 0.81, z) * (1 - smooth(0.94, 1.3, y));
    p[2] = T.MathUtils.lerp(z, faceDepth(p[0], p[1] - offsetY), front) + offsetZ;
  });
  eyeMap.forEach(i => {
    const [x, y, z] = original[i], center = centers[x > 0 ? 0 : 1];
    points[i] = [mapX(x), mapY(y - offsetY) + offsetY, 0];
    points[i][2] = faceDepth(points[i][0], points[i][1] - offsetY) + offsetZ + 0.012 + (z - center.z) * 0.25;
  });
}

function sculptAdultProportions(points, base, rig, sex, type) {
  if (type === 'chibi') return;
  const pelvisY = endpoint(rig.pelvis.head, points, base).y;
  const spine2Y = endpoint(rig.spine_02.head, points, base).y;
  const chestY = endpoint(rig.spine_03.head, points, base).y;
  const neckY = endpoint(rig.neck_01.head, points, base).y;
  const kneeY = endpoint(rig.calf_l.head, points, base).y;
  const ankleY = endpoint(rig.foot_l.head, points, base).y;
  const hlEye = base.groups.get('helper-l-eye'), hrEye = base.groups.get('helper-r-eye');
  const eyeC = [hlEye, hrEye].map(g => centroid(points, g));

  // Smooth adult figure-drawing contour refinement: clean shoulder girdle, neck column, waist taper, pelvic/hip curve, and limb tapers
  const waistScaleX = sex === 'female'
    ? ({ realistic: 0.865, heroic: 0.86, lean: 0.885, slender: 0.87, busty: 0.865, chubby: 0.96, fat: 0.985, obese: 1.0 }[type] ?? 0.90)
    : ({ realistic: 0.925, heroic: 0.895, lean: 0.915, slender: 0.915, busty: 0.92, chubby: 0.98, fat: 1.0, obese: 1.0 }[type] ?? 0.94);
  const waistScaleZ = sex === 'female'
    ? ({ realistic: 0.915, heroic: 0.91, lean: 0.92, slender: 0.91, busty: 0.92, chubby: 0.98, fat: 1.0, obese: 1.0 }[type] ?? 0.93)
    : ({ realistic: 0.94, heroic: 0.925, lean: 0.935, slender: 0.935, busty: 0.945, chubby: 0.99, fat: 1.0, obese: 1.0 }[type] ?? 0.95);
  const hipFlareX = sex === 'female'
    ? ({ realistic: 0.935, heroic: 0.945, lean: 0.915, slender: 0.895, busty: 0.965, chubby: 0.99, fat: 1.005, obese: 1.01 }[type] ?? 0.935)
    : ({ realistic: 0.965, heroic: 0.955, lean: 0.94, slender: 0.905, busty: 0.96, chubby: 0.995, fat: 1.0, obese: 1.0 }[type] ?? 0.96);
  const ribLatScaleX = sex === 'male'
    ? ({ realistic: 1.06, heroic: 1.11, lean: 1.045, slender: 0.99, busty: 1.085, chubby: 1.025, fat: 1.015, obese: 1.005 }[type] ?? 1.04)
    : ({ realistic: 1.03, heroic: 1.08, lean: 1.02, slender: 0.985, busty: 1.035, chubby: 1.005, fat: 1.0, obese: 1.0 }[type] ?? 1.02);
  const shoulderGirdleX = sex === 'male'
    ? ({ realistic: 1.032, heroic: 1.125, lean: 1.02, slender: 0.945, busty: 1.075, chubby: 1.01, fat: 1.005, obese: 1.0 }[type] ?? 1.02)
    : ({ realistic: 0.972, heroic: 1.115, lean: 0.995, slender: 0.925, busty: 0.99, chubby: 0.99, fat: 0.995, obese: 1.0 }[type] ?? 0.98);
  const neckSlim = sex === 'female'
    ? ({ realistic: 0.935, heroic: 0.95, lean: 0.93, slender: 0.915, busty: 0.94 }[type] ?? 0.97)
    : ({ realistic: 0.96, heroic: 0.985, lean: 0.95, slender: 0.93, busty: 0.99 }[type] ?? 0.98);
  // Also scale upperarm/clavicle joint helper cubes above N so skeleton shoulder sockets match sculpted girdle
  for (const side of ['l', 'r']) {
    for (const grpName of [`helper-${side}-upperarm`, `helper-${side}-clavicle`]) {
      const grp = base.groups.get(grpName);
      if (!grp || shoulderGirdleX === 1) continue;
      for (const idx of grp) points[idx][0] *= shoulderGirdleX;
    }
  }
  const headY = endpoint(rig.head.head, points, base).y;
  const clavicleY = endpoint(rig.clavicle_l.head, points, base).y;
  const wristX = Math.abs(endpoint(rig.hand_l.head, points, base).x);
  const elbowX = Math.abs(endpoint(rig.lowerarm_l.head, points, base).x);

  for (let i = 0; i < N; i++) {
    const p = points[i];
    const [x, y, z] = p;
    const ax = Math.abs(x);
    // Clean shoulder girdle span (carries clavicles, acromion, and arms coherently without pinching axilla)
    if (shoulderGirdleX !== 1 && y > chestY - 0.15 && y < neckY + 0.25) {
      const girdleY = smooth(chestY - 0.15, chestY + 0.65, y) * (1 - smooth(neckY - 0.05, neckY + 0.25, y));
      const armReach = smooth(0.45, 1.55, ax);
      p[0] *= 1 + (shoulderGirdleX - 1) * girdleY * armReach;
    } else if (shoulderGirdleX !== 1 && ax > 1.55 && y > pelvisY - 0.8 && y <= chestY - 0.15) {
      // Keep hanging lower-arm/hand aligned with adjusted shoulder socket
      const armMask = smooth(1.55, 1.95, ax);
      p[0] += Math.sign(x) * (shoulderGirdleX - 1) * 1.78 * armMask;
    }
    // Graceful cylindrical neck taper into trapezius (eliminates blocky neck base)
    if (neckSlim !== 1 && y > neckY - 0.18 && y < headY + 0.08 && ax < 0.95) {
      const neckBell = Math.exp(-(((y - (neckY + (headY - neckY) * 0.48)) / 0.42) ** 2)) * (1 - smooth(0.68, 0.95, ax));
      p[0] *= 1 + (neckSlim - 1) * neckBell;
      p[2] *= 1 + (neckSlim - 1) * 0.75 * neckBell;
    }
    const torsoCore = 1 - smooth(1.58, 1.98, ax);
    if (torsoCore > 0 && y > pelvisY - 1.35 && y < neckY - 0.15) {
      const waistBell = Math.exp(-(((y - (spine2Y + 0.38)) / 0.86) ** 2)) * torsoCore;
      const hipBell = Math.exp(-(((y - (pelvisY - 0.22)) / 0.92) ** 2)) * torsoCore;
    // On female builds, keep lat/ribcage X expansion on posterior/lateral ribs so anterior breasts aren't pulled into the armpits
    const ribMask = sex === 'female' ? torsoCore * (1 - 0.82 * smooth(0.22, 0.72, z)) : torsoCore;
    const latBell = Math.exp(-(((y - (chestY + 1.02)) / 1.02) ** 2)) * ribMask;
      p[0] *= (1 + (waistScaleX - 1) * waistBell) * (1 + (hipFlareX - 1) * hipBell) * (1 + (ribLatScaleX - 1) * latBell);
      p[2] *= (1 + (waistScaleZ - 1) * waistBell);
    }
  // Anatomically grounded female ribcage & teardrop bust contour:
  // - Smooth upper-pole ramp starting gradually at the 2nd-3rd rib below the clavicles (zero shelf)
  // - Natural gravity-settled lower/slightly-lateral 4th-5th rib fullness + curved inframammary fold
  // - Clean ~2.2 cm sternum valley (never fused into uniboob, never caved in) & smooth anterior axillary blend
  if (sex === 'female' && z > 0.10 && y > chestY + 0.18 && y < clavicleY + 0.22 && ax < 1.48) {
    const bustScale = ({
      realistic: 0.78, heroic: 0.76, lean: 0.60, slender: 0.52,
      busty: 1.30, chubby: 0.92, fat: 0.98, obese: 1.04,
    }[type] ?? 0.78);
    const frontWeight = smooth(0.18, 0.62, z);
    // Curved inframammary crease (rises gently medially toward sternum & laterally toward 5th rib/axilla)
    const imfCurveY = (chestY + 0.40) + 0.17 * (((ax - 0.80) / 0.50) ** 2);
    const upperTopY = clavicleY + 0.08;
    const spanY = Math.max(0.65, upperTopY - imfCurveY);
    const uY = (y - imfCurveY) / spanY;

    // Gently gather laterally-splayed MakeHuman chest tissue toward natural pectoral axis (|x| ≈ 8.2 cm)
    if (uY > -0.05 && uY < 0.95 && ax > 0.26 && ax < 1.36) {
      const gatherY = smooth(-0.05, 0.18, uY) * (1 - smooth(0.68, 0.95, uY));
      const gatherX = smooth(0.26, 0.55, ax) * (1 - smooth(1.08, 1.36, ax));
      p[0] -= Math.sign(x) * (ax - 0.76) * 0.13 * gatherY * gatherX * frontWeight;
    }

    const curAx = Math.abs(p[0]);
    if (uY > -0.12 && uY < 1.0) {
      // Vertical teardrop profile: full rounded lower pole (uY in 0..0.34), gradual C1 taper up to 2nd rib (0.34..1.0)
      let profileY = 0;
      if (uY >= 0 && uY <= 0.34) {
        profileY = Math.sin((uY / 0.34) * Math.PI * 0.5) ** 0.82;
      } else if (uY > 0.34 && uY < 1.0) {
        const t = (uY - 0.34) / 0.66;
        profileY = ((1 - t) ** 2) * (1 + 1.15 * t);
      }
      // Horizontal mammary dome centered at |x| = 0.78 dm (7.8 cm), zero at sternum (|x| <= 0.13 dm) and axilla (|x| >= 1.24 dm)
      const medialRamp = smooth(0.13, 0.50, curAx);
      const lateralRamp = 1 - smooth(0.78, 1.24, curAx);
      const outerBias = 1 + 0.10 * clamp((curAx - 0.76) / 0.32, -0.5, 1);
      const mound = profileY * medialRamp * lateralRamp * outerBias * frontWeight;

      // Add subtle teardrop fullness + natural slight lateral cant + gentle gravity lower-pole settle
      p[2] += 0.145 * bustScale * mound;
      p[0] += Math.sign(x) * 0.016 * bustScale * mound * smooth(0.65, 1.02, curAx);
      p[1] -= 0.024 * bustScale * mound * (1 - smooth(0.15, 0.58, uY));

      // Subtle curved inframammary fold definition right along uY ≈ 0
      const imfCrease = Math.exp(-((uY / 0.075) ** 2)) * smooth(0.24, 0.52, curAx) * (1 - smooth(1.02, 1.26, curAx)) * frontWeight;
      p[2] -= 0.018 * bustScale * imfCrease;

      // Clean anatomical sternum valley (~2.0-2.4 cm medial separation so mounds never bridge into a uniboob)
      const sternalMask = (1 - smooth(0.08, 0.28, curAx)) * smooth(0.06, 0.25, uY) * (1 - smooth(0.58, 0.85, uY)) * frontWeight;
      p[2] -= 0.024 * bustScale * sternalMask;
    }
  }
    // Subtle forearm-to-wrist studio taper (prevents tubular wrists in MakeHuman base)
    if (ax > elbowX - 0.25 && ax < wristX + 0.35 && y > pelvisY + 0.2 && y < neckY - 0.1) {
      const wristT = smooth(elbowX + 0.1, wristX, ax);
      const wristTrim = (sex === 'female' ? 0.065 : 0.045) * wristT * (1 - smooth(wristX + 0.05, wristX + 0.35, ax));
      if (wristTrim > 0 && !['chubby', 'fat', 'obese'].includes(type)) {
        p[2] *= 1 - wristTrim;
      }
    }
    // Athletic thigh fullness + knee taper (matches classic figure-drawing quadriceps/vastus sweep)
    if (y > kneeY - 0.35 && y < pelvisY + 0.25 && Math.abs(x) < 1.65) {
      const thighU = clamp((y - kneeY) / Math.max(0.8, (pelvisY - 0.55) - kneeY), 0, 1);
      const quadSweep = Math.exp(-(((thighU - 0.62) / 0.28) ** 2));
      const kneeSlim = Math.exp(-(((thighU - 0.04) / 0.14) ** 2));
      const thighBoost = sex === 'female'
        ? ({ heroic: 0.055, realistic: 0.042, busty: 0.048, lean: 0.025 }[type] ?? 0)
        : ({ heroic: 0.065, realistic: 0.038, busty: 0.045, lean: 0.028 }[type] ?? 0);
      const kneeTrim = ({ heroic: 0.035, realistic: 0.032, lean: 0.038, slender: 0.04, busty: 0.03 }[type] ?? 0);
      if (thighBoost || kneeTrim) {
        const thighCenter = Math.sign(x) * Math.abs(endpoint(rig.thigh_l.head, points, base).x);
        const dx = p[0] - thighCenter;
        const isMedial = dx * Math.sign(x) < 0;
        // Lateral vastus sweep gets full fullness; medial inner-thigh stays cleanly cleared so thighs never chafe/cross midline
        const sThighX = (1 + thighBoost * (isMedial ? 0.35 : 1.05) * quadSweep) * (1 - kneeTrim * kneeSlim);
        const sThighZ = (1 + thighBoost * 0.78 * quadSweep) * (1 - kneeTrim * 0.65 * kneeSlim);
        p[0] = thighCenter + dx * sThighX;
        p[2] *= sThighZ;
      }
    }
    // Deltoid cap fullness on Heroic / Realistic / Busty so shoulders flow cleanly into upper arms
    if (y > chestY + 0.55 && y < neckY + 0.25 && Math.abs(x) > 1.25 && Math.abs(x) < 2.35) {
      const deltBoost = sex === 'male'
        ? ({ heroic: 0.048, busty: 0.042, realistic: 0.018, lean: 0.022 }[type] ?? 0)
        : ({ heroic: 0.036, realistic: 0.014, busty: 0.016, lean: 0.014 }[type] ?? 0);
      if (deltBoost) {
        const deltBell = Math.exp(-(((Math.abs(x) - 1.78) / 0.34) ** 2 + ((y - (neckY - 0.36)) / 0.38) ** 2));
        p[0] += Math.sign(x) * deltBoost * 0.45 * deltBell;
        p[1] += deltBoost * 0.28 * deltBell;
        p[2] *= 1 + deltBoost * deltBell;
      }
    }
    // Clean lower-leg taper (gastrocnemius fullness + tapered Achilles/ankle like classic figure reference)
    if (y > ankleY + 0.15 && y < kneeY + 0.4) {
      const u = (y - ankleY) / Math.max(0.5, kneeY - ankleY);
      const calfHigh = Math.exp(-(((u - 0.68) / 0.20) ** 2));
      const ankleTaper = Math.exp(-(((u - 0.22) / 0.17) ** 2));
      const calfBoost = ({ heroic: 0.045, realistic: 0.024, lean: 0.028, busty: 0.024, slender: 0.01 }[type] ?? 0);
      const ankleSlim = ({ heroic: 0.04, realistic: 0.045, lean: 0.05, slender: 0.055, busty: 0.04 }[type] ?? 0.02);
      const legCenter = Math.sign(x) * Math.abs(endpoint(rig.calf_l.head, points, base).x);
      const scaleXZ = (1 + calfBoost * calfHigh) * (1 - ankleSlim * ankleTaper);
      p[0] = legCenter + (p[0] - legCenter) * scaleXZ;
      p[2] *= scaleXZ;
    }
    // Natural relaxed upper eyelid drape (eliminates wide-eyed "stare" by resting upper lid across top ~18% of iris)
    const ec = eyeC[x >= 0 ? 0 : 1];
    const dx = (x - ec.x) / 0.155, dy = y - ec.y;
    if (Math.abs(dx) < 1.05 && dy > 0.004 && dy < 0.085 && z > ec.z + 0.075) {
      const horiz = Math.cos(clamp(dx, -1, 1) * Math.PI * 0.5) ** 1.35;
      const vert = Math.exp(-(((dy - (sex === 'female' ? 0.034 : 0.024)) / 0.028) ** 2));
      const front = smooth(ec.z + 0.085, ec.z + 0.135, z);
      const drape = horiz * vert * front;
      p[1] -= (sex === 'female' ? 0.0135 : 0.0038) * drape;
      p[2] += 0.0022 * drape;
    }
  }
}

function refineSurface(vertices, faces, neckY, type, sex) {
  const adjacent = Array.from({ length: N }, () => new Set());
  faces.forEach(({ face }) => face.forEach(([a], i) => {
    const b = face[(i + 1) % face.length][0];
    adjacent[a].add(b); adjacent[b].add(a);
  }));
  const nipple = new Set([
    ...targets.get('breast/nipple-size-decr').map(([i]) => i),
    ...targets.get('breast/nipple-point-decr').map(([i]) => i),
  ]);
  let region = new Map([...nipple].map(i => [i, 1]));
  const nippleRings = sex === 'female' ? 1 : 3;
  for (let ring = 0; ring < nippleRings; ring++) {
    const next = new Map(region);
    for (const [i, amount] of region) for (const j of adjacent[i]) next.set(j, Math.max(next.get(j) || 0, amount * 0.48));
    region = next;
  }
  const positions = Float64Array.from(vertices.flatMap(p => p.toArray()));
  const temp = positions.slice();
  function pass(factor, strength) {
    for (let i = 0; i < N; i++) {
      const amount = strength(i) * factor;
      for (let axis = 0; axis < 3; axis++) {
        let sum = 0;
        for (const j of adjacent[i]) sum += positions[j * 3 + axis];
        temp[i * 3 + axis] = positions[i * 3 + axis] + amount * (sum / adjacent[i].size - positions[i * 3 + axis]);
      }
    }
    positions.set(temp);
  }
  if (type === 'busty' && sex === 'female') {
    let bust = new Map(targets.get('breast/female-young-averagemuscle-averageweight-maxcup-averagefirmness').filter(([i]) => i < N).map(([i]) => [i, 1]));
    for (let ring = 0; ring < 2; ring++) {
      const next = new Map(bust);
      for (const [i, amount] of bust) for (const j of adjacent[i]) next.set(j, Math.max(next.get(j) || 0, amount * 0.45));
      bust = next;
    }
    for (let iteration = 0; iteration < 6; iteration++) pass(0.24, i => bust.get(i) || 0);
  }
  const nipplePasses = sex === 'female' ? 5 : 16;
  const nippleFactor = sex === 'female' ? 0.26 : 0.45;
  for (let iteration = 0; iteration < nipplePasses; iteration++) pass(nippleFactor, i => region.get(i) || 0);
  if (type === 'chibi') {
    for (let iteration = 0; iteration < 30; iteration++) pass(0.4, i => 1 - smooth(neckY - 0.3, neckY + 0.05, vertices[i].y));
    for (let iteration = 0; iteration < 12; iteration++) pass(0.35, i => smooth(neckY - 0.1, neckY + 0.08, vertices[i].y));
  }
  // Volume-preserving fairing removes bind-pose pinches while preserving adult muscular & skeletal landmarks.
  const strength = i => 1 - smooth(neckY - 0.4, neckY + 0.08, vertices[i].y);
  for (let iteration = 0; iteration < (type === 'chibi' ? 5 : 1); iteration++) {
    pass(0.38, strength); pass(-0.39, strength);
  }
  vertices.forEach((v, i) => v.fromArray(positions, i * 3));
}

function eyeMesh(points, base, eyeMap, head, anime = false, sex = 'female') {
  const fullSpheres = ['helper-l-eye', 'helper-r-eye'].map(name => [...base.groups.get(name)].map(i => v3(points[i])));
  const animeProxies = [eyeMap.slice(0, 48), eyeMap.slice(48)].map(ids => ids.map(i => v3(points[i])));
  const sources = anime ? animeProxies : fullSpheres;
  const centers = sources.map(vertices => centroid(vertices.map(v => v.toArray()), vertices.map((_, i) => i)));
  const bounds = sources.map(vertices => new T.Box3().setFromPoints(vertices));
  const radii = bounds.map(box => box.getSize(new T.Vector3()).multiplyScalar(0.5));
  if (!anime) {
    // True anatomical orbital placement: center sits in the deep socket (not biased forward to the anterior hemisphere!)
    // and is subtly recessed so 100% of the upper/lower eyelids & eyelashes overhang the eyeball cleanly in profile/oblique views.
    for (let s = 0; s < 2; s++) {
      centers[s].z -= 0.008;
      radii[s].multiplyScalar(0.965);
    }
  }
  const sphere = new T.SphereGeometry(1, 96, 64), unit = [], remap = [], lookup = new Map();
  for (let i = 0; i < sphere.attributes.position.count; i++) {
    const p = new T.Vector3().fromBufferAttribute(sphere.attributes.position, i);
    const key = p.toArray().map(x => Math.round(x * 1e6)).join('/');
    if (!lookup.has(key)) { lookup.set(key, unit.length); unit.push(p); }
    remap.push(lookup.get(key));
  }
  const vertices = [], faces = [];
  for (let side = 0; side < 2; side++) {
    const center = centers[side], radius = radii[side], start = vertices.length;
    for (const p of unit) {
      const v = p.clone().multiply(radius).add(center);
      if (anime) {
        // Exact analytical faceDepth curvature of sculptAnimeChibi (+0.7 mm clearance over cheek/socket skin, gentle 1.3 mm lens)
        // Guarantees 0 lower-rim skin overlap while keeping 68° oblique & 90° profile flush with the cheek/eyelid contour!
        const rNorm = Math.hypot(p.x, p.y);
        const rimTuck = smooth(0.84, 1.0, rNorm) * 0.004;
        v.z = center.z - 0.002 + Math.max(-0.4, p.z) * 0.013 - rimTuck
          - 0.22 * (v.x ** 2 - center.x ** 2) / (0.74 ** 2)
          - 0.09 * (((v.y - center.y - 0.05) ** 2 - 0.05 ** 2) / (0.85 ** 2));
      } else {
        // Subtle anterior corneal dome (+0.35 mm over the iris) for lifelike profile silhouette without protruding past lids
        const rNorm = Math.hypot(p.x, p.y);
        const cornea = Math.max(0, p.z) * Math.exp(-((rNorm / 0.42) ** 2)) * 0.0035;
        v.z += cornea;
      }
      vertices.push(v);
    }
    for (let i = 0; i < sphere.index.count; i += 3) faces.push([0, 1, 2].map(j => start + remap[sphere.index.array[i + j]]));
  }
  sphere.dispose();
  const colors = vertices.flatMap(p => {
    const sideIdx = p.x > 0 ? 0 : 1;
    const center = centers[sideIdx], radius = radii[sideIdx];
    if (anime) {
      const x = (p.x - center.x) / radius.x, y = (p.y - center.y) / radius.y;
      const r = Math.hypot(x, y), iris = 1 - smooth(0.79, 0.84, r), pupil = 1 - smooth(0.27, 0.31, r);
      const gradient = clamp(0.55 - y * 0.65);
      const bottom = sex === 'female' ? [0.26, 0.25, 0.65] : [0.07, 0.38, 0.6];
      const upperLidAo = 1 - 0.24 * smooth(0.36, 0.88, y);
      const shine = Math.max(1 - smooth(0.105, 0.14, Math.hypot(x + 0.26, y - 0.36)),
        1 - smooth(0.04, 0.065, Math.hypot(x - 0.32, y + 0.27)));
      return [0, 1, 2].map(j => {
        const tone = T.MathUtils.lerp(0.012, bottom[j], gradient);
        const color = T.MathUtils.lerp(0.94, tone * (1 - smooth(0.68, 0.82, r) * 0.8), iris) * upperLidAo;
        return T.MathUtils.lerp(T.MathUtils.lerp(color, 0.006, pupil), 1, shine);
      });
    }
    // Adult anatomical eye shading: warm ivory sclera, corner caruncle warmth, upper-eyelid shadow AO,
    // rich warm brown/hazel iris with dark limbal ring, deep pupil, and crisp specular catchlights.
    const nx = (p.x - center.x) / radius.x, ny = (p.y - center.y) / radius.y;
    const irisRadius = 0.062; // ~12.4 mm anatomical iris diameter
    const r = Math.hypot(p.x - center.x, p.y - (center.y + 0.003)) / irisRadius;
    const irisMask = 1 - smooth(0.92, 1.03, r);
    const limbal = smooth(0.70, 0.96, r) * irisMask;
    const pupilMask = 1 - smooth(0.34, 0.42, r);
    const lowerCaustic = clamp(0.5 - (p.y - center.y) / (irisRadius * 1.4));
    const irisOuter = [0.16, 0.075, 0.036];
    const irisInner = [0.42, 0.225, 0.098];
    const limbalCol = [0.032, 0.018, 0.011];
    // Sclera with subtle medial/lateral corner warmth & realistic upper-eyelid shadow (eliminates wide-eyed white glare)
    const corner = smooth(0.48, 0.95, Math.abs(nx));
    const upperShadow = 1 - 0.48 * smooth(0.04, 0.34, ny) - 0.16 * smooth(-0.32, -0.58, ny);
    const scleraBase = [
      T.MathUtils.lerp(0.86, 0.77, corner),
      T.MathUtils.lerp(0.84, 0.67, corner),
      T.MathUtils.lerp(0.82, 0.65, corner),
    ];
    const mainCatch = Math.exp(-(((p.x - center.x + 0.020) / 0.0095) ** 2 + ((p.y - center.y - 0.021) / 0.0095) ** 2));
    const secCatch = 0.42 * Math.exp(-(((p.x - center.x - 0.022) / 0.0065) ** 2 + ((p.y - center.y + 0.018) / 0.0065) ** 2));
    const catchlight = clamp(mainCatch + secCatch);
    return [0, 1, 2].map(cIdx => {
      let irisCol = T.MathUtils.lerp(irisOuter[cIdx], irisInner[cIdx], lowerCaustic * 0.85 + 0.15);
      irisCol = T.MathUtils.lerp(irisCol, limbalCol[cIdx], limbal * 0.82);
      let col = T.MathUtils.lerp(scleraBase[cIdx], irisCol, irisMask) * upperShadow;
      col = T.MathUtils.lerp(col, 0.01, pupilMask);
      return T.MathUtils.lerp(col, 0.98, catchlight);
    });
  });
  const mesh = splitMesh(faces.map(face => ({ face: face.map(i => [i, 0]) })), vertices, [[0, 0]],
    vertices.map(() => [[head, 1]]), vertices.length);
  // splitMesh visits vertices in face order, not original OBJ order.
  mesh.color = Float32Array.from(Array.from(mesh.weld).flatMap(i => colors.slice(i * 3, i * 3 + 3)));
  return { mesh, centers };
}

function browMesh(points, bodyFaces, centers, head, anime = false, sex = 'female') {
  const vertices = [], faces = [], rawColors = [];
  function surface(x, y) {
    let z = -Infinity;
    for (const { face } of bodyFaces) {
      for (let k = 1; k < face.length - 1; k++) {
        const [a, b, c] = [face[0][0], face[k][0], face[k + 1][0]].map(i => points[i]);
        const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(den) < 1e-10) continue;
        const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
        const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
        if (u >= 0 && v >= 0 && u + v <= 1) z = Math.max(z, u * a[2] + v * b[2] + (1 - u - v) * c[2]);
      }
    }
    assert(Number.isFinite(z), `Eyebrow missed face surface: ${x}, ${y}`);
    return z;
  }
  for (const center of centers) {
    const side = Math.sign(center.x) || 1;
    const start = vertices.length;
    for (let k = 0; k <= 16; k++) {
      // u = 0 is medial (inner brow head near nasal bridge), u = 1 is lateral (outer brow tail toward temple)
      const u = k / 16;
      const spanMedial = anime ? 0.19 : (sex === 'male' ? 0.175 : 0.165);
      const spanLateral = anime ? 0.21 : (sex === 'male' ? 0.225 : 0.215);
      const x = center.x + side * T.MathUtils.lerp(-spanMedial, spanLateral, u);
      const peakU = sex === 'female' ? 0.62 : 0.56;
      const arch = anime
        ? Math.sin(u * Math.PI) * 0.035
        : (sex === 'female' ? 0.042 : 0.026) * Math.sin(Math.PI * Math.pow(u, Math.log(0.5) / Math.log(peakU)))
          - (sex === 'female' ? 0.012 : 0.016) * (1 - u);
      const baseRise = anime ? 0.28 : (sex === 'female' ? 0.145 : 0.122);
      // Natural medial-to-lateral brow thickness profile (fuller medial body, tapered outer tail; >0.001 dm at ends avoids degenerate seam collapse)
      const halfThick = anime
        ? Math.max(0.0025, 0.016 * Math.sin(Math.PI * (u * 0.9 + 0.05)))
        : Math.max(0.003, (sex === 'male' ? 0.034 : 0.025) * (0.28 + 0.72 * smooth(0, 0.14, u)) * (1 - 0.68 * smooth(0.58, 1.0, u)));
      for (let w = 0; w < 3; w++) {
        const y = center.y + baseRise + arch + (w - 1) * halfThick;
        const zOff = anime ? 0.004 : (w === 1 ? 0.0042 : 0.0016);
        vertices.push(new T.Vector3(x, y, surface(x, y) + zOff));
        const browShade = w === 1 ? 0.95 : 0.78;
        rawColors.push([browShade, browShade, browShade]);
        if (k && w) {
          const i = start + k * 3 + w;
          faces.push({ face: [[i - 4, 0], [i - 1, 0], [i, 0], [i - 3, 0]] });
        }
      }
    }
    const lashStart = vertices.length;
    for (let k = 0; k <= 16; k++) {
      const u = k / 16;
      const x = center.x + side * T.MathUtils.lerp(anime ? -0.23 : -0.125, anime ? 0.23 : 0.148, u);
      for (let w = 0; w < 3; w++) {
        const y = center.y + (anime ? 0.015 : 0.018) + Math.sin(u * Math.PI) * (anime ? 0.115 : 0.032)
          + (w - 1) * (anime ? 0.014 : 0.007) * Math.sin(Math.PI * (u * 0.9 + 0.05));
        vertices.push(new T.Vector3(x, y, surface(x, y) + 0.003));
        // Dark charcoal/black upper lash canopy (stays rich dark regardless of hair tint)
        rawColors.push([0.04, 0.035, 0.035]);
        if (k && w) {
          const i = lashStart + k * 3 + w;
          faces.push({ face: [[i - 4, 0], [i - 1, 0], [i, 0], [i - 3, 0]] });
        }
      }
    }
  }
  const mesh = splitMesh(faces, vertices, [[0, 0]], vertices.map(() => [[head, 1]]), vertices.length);
  mesh.color = Float32Array.from(Array.from(mesh.weld).flatMap(i => rawColors[i]));
  return mesh;
}

function fitBrowsAndLashes(body, eyes, brows, anime = false, sex = 'female') {
  function sampler(mesh) {
    const bounds = new T.Box3().setFromArray(mesh.position), size = bounds.getSize(new T.Vector3()), bins = new Map(), count = 128;
    const bin = (value, axis) => clamp(Math.floor((value - bounds.min[axis]) / size[axis] * count), 0, count - 1);
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const p = [0, 1, 2].map(j => Array.from(mesh.position.subarray(mesh.indices[i + j] * 3, mesh.indices[i + j] * 3 + 3)));
      const minX = bin(Math.min(...p.map(v => v[0])), 'x'), maxX = bin(Math.max(...p.map(v => v[0])), 'x');
      const minY = bin(Math.min(...p.map(v => v[1])), 'y'), maxY = bin(Math.max(...p.map(v => v[1])), 'y');
      for (let x = minX; x <= maxX; x++) for (let y = minY; y <= maxY; y++) {
        const key = y * count + x;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(p);
      }
    }
    return (x, y) => {
      let front = -Infinity;
      for (const [a, b, c] of bins.get(bin(y, 'y') * count + bin(x, 'x')) || []) {
        const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
        if (Math.abs(den) < 1e-12) continue;
        const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / den;
        const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / den;
        if (u >= 0 && v >= 0 && u + v <= 1) front = Math.max(front, u * a[2] + v * b[2] + (1 - u - v) * c[2]);
      }
      return front;
    };
  }
  const skinZ = sampler(body), eyeZ = sampler(eyes), positions = Array.from({ length: brows.originalCount });
  for (const side of [1, -1]) {
    const eyePoints = [];
    for (let i = 0; i < eyes.position.length; i += 3) if (Math.sign(eyes.position[i]) === side) eyePoints.push(new T.Vector3().fromArray(eyes.position, i));
    const box = new T.Box3().setFromPoints(eyePoints), size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
    const visible = (x, y) => Number.isFinite(eyeZ(x, y)) && skinZ(x, y) < eyeZ(x, y) - 0.0001;
    const visibleX = [];
    for (let i = 0; i <= 96; i++) {
      const x = T.MathUtils.lerp(box.min.x, box.max.x, i / 96);
      // Scan narrow vertical window around eye center to find medial & lateral eye opening corners
      for (let j = -4; j <= 4; j++) {
        if (visible(x, center.y + j * size.y * 0.04)) { visibleX.push(x); break; }
      }
    }
    assert(visibleX.length > 8, `${anime ? 'Anime' : 'Adult'} eye opening is occluded`);
    const minVisX = Math.min(...visibleX), maxVisX = Math.max(...visibleX);
    const medialX = side === 1 ? minVisX : maxVisX;
    const lateralX = side === 1 ? maxVisX : minVisX;
    const start = side === 1 ? 0 : 102;
    for (let k = 0; k <= 16; k++) {
      // u = 0 is medial (inner corner), u = 1 is lateral (outer corner)
      const u = (k + 0.15) / 16.3;
      const x = T.MathUtils.lerp(medialX, lateralX, u);
      let top = center.y;
      for (let j = 0; j <= 110; j++) {
        const y = T.MathUtils.lerp(center.y - size.y * 0.08, box.max.y, j / 110);
        if (visible(x, y)) top = y;
      }
      if (anime) {
        for (let w = 0; w < 3; w++) {
          const taper = Math.sin(Math.PI * (u * 0.9 + 0.05));
          const lashY = top + (w - 1) * size.y * 0.028 * taper;
          positions[start + 51 + k * 3 + w] = [x, lashY, Math.max(skinZ(x, lashY), eyeZ(x, lashY)) + 0.00065];
          const browX = T.MathUtils.lerp(medialX - side * size.x * 0.06, lateralX + side * size.x * 0.08, k / 16);
          const browY = box.max.y + size.y * (0.18 + Math.sin((k / 16) * Math.PI) * 0.08) + (w - 1) * size.y * 0.020 * taper;
          positions[start + k * 3 + w] = [browX, browY, skinZ(browX, browY) + (w === 1 ? 0.0007 : 0.00035)];
        }
      } else {
        // Adult contoured 3D upper eyelash canopy + flush brow-ridge eyebrow fit on final subdivided skin!
        const lashTaper = Math.sin(Math.PI * clamp(u * 0.92 + 0.04, 0.02, 0.98));
        const lashFlare = (sex === 'female' ? 0.0022 : 0.0014) * (0.55 + 0.65 * u) * lashTaper;
        const rootZ = Math.max(skinZ(x, top + 0.0003), eyeZ(x, top));
        // w=0: tucked at upper eyelid margin; w=1: mid-canopy curving forward; w=2: lash tips flaring outward & slightly upward
        const lashRows = [
          [x, top - 0.0002, rootZ + 0.00018],
          [x + side * lashFlare * 0.18, top + lashFlare * 0.28, rootZ + lashFlare * 0.72],
          [x + side * lashFlare * 0.38, top + lashFlare * (sex === 'female' ? 0.62 : 0.38), rootZ + lashFlare * (sex === 'female' ? 1.15 : 0.85)],
        ];
        for (let w = 0; w < 3; w++) positions[start + 51 + k * 3 + w] = lashRows[w];

        // Re-snap existing adult brow vertices flush to the subdivided brow-ridge surface (zero floating gap in 90° profile!)
        for (let w = 0; w < 3; w++) {
          const origIdx = brows.weld.indexOf(start + k * 3 + w);
          const bx = brows.position[origIdx * 3], by = brows.position[origIdx * 3 + 1];
          const sz = skinZ(bx, by);
          if (Number.isFinite(sz)) {
            positions[start + k * 3 + w] = [bx, by, sz + (w === 1 ? 0.00042 : 0.00015)];
          } else {
            positions[start + k * 3 + w] = [bx, by, brows.position[origIdx * 3 + 2]];
          }
        }
      }
    }
  }
  for (let i = 0; i < brows.weld.length; i++) {
    const vi = brows.weld[i];
    assert(positions[vi]?.every(Number.isFinite), 'Brow/lash vertex missed skin');
    brows.position.set(positions[vi], i * 3);
    if (vi % 102 >= 51) {
      brows.color.set([0.04, 0.035, 0.035], i * 3);
    } else if (anime) {
      brows.color.set([0.92, 0.92, 0.92], i * 3);
    }
  }
}

function png(width, height, rgba) {
  const crc = bytes => {
    let c = 0xffffffff;
    for (const byte of bytes) {
      c ^= byte;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length, 0); bytes.write(type, 4);
    data.copy(bytes, 8); bytes.writeUInt32BE(crc(bytes.subarray(4, -4)), bytes.length - 4);
    return bytes;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

function bodyTexture(base, points, sex, rig, names, cleanFace = false) {
  const size = 1024, rgba = new Uint8Array(size * size * 4), covered = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) rgba.set([232, 232, 232, 0], i * 4);
  const pelvis = endpoint(rig.pelvis.head, points, base).y;
  const chest = endpoint(rig.spine_03.head, points, base).y;
  const head = endpoint(rig.head.head, points, base).y;
  const clavicle = endpoint(rig.clavicle_l.head, points, base).y;
  const vertices = points.slice(0, N).map(v3), adjacent = Array.from({ length: N }, () => new Set());
  const normal = Array.from({ length: N }, () => new T.Vector3());
  for (const { group, face } of base.faces) {
    if (group !== 'body') continue;
    face.forEach(([a], i) => { const b = face[(i + 1) % face.length][0]; adjacent[a].add(b); adjacent[b].add(a); });
    for (let k = 1; k < face.length - 1; k++) {
      const ids = [face[0][0], face[k][0], face[k + 1][0]];
      const n = vertices[ids[1]].clone().sub(vertices[ids[0]]).cross(vertices[ids[2]].clone().sub(vertices[ids[0]]));
      ids.forEach(i => normal[i].add(n));
    }
  }
  const cavity = vertices.map((p, i) => {
    const lap = new T.Vector3();
    let length = 0;
    for (const j of adjacent[i]) { lap.add(vertices[j]); length += p.distanceTo(vertices[j]); }
    lap.divideScalar(adjacent[i].size).sub(p);
    return clamp(lap.dot(normal[i].normalize()) / Math.max(0.001, length / adjacent[i].size), 0, 0.5) * 34;
  });
  const eyeL = centroid(points, base.groups.get('helper-l-eye'));
  function shade(x, y, z) {
    const ax = Math.abs(x);
    const torso = 1 - smooth(1.62, 1.92, ax);
    // Reference-matched athletic figure-drawing attire:
    // Female: contoured V-hip athletic briefs + scooped underbust sport-bra crop top (midriff, ribcage, waist & iliac crest exposed!)
    // Male: sleek low-rise contoured athletic posing trunks (iliac crest, obliques, navel & upper quadriceps exposed!)
    let bottom = 0, top = 0;
    if (sex === 'female') {
      const hipU = clamp(ax / 1.52, 0, 1);
      // Classic V-cut athletic bikini brief matching bundled reference: high iliac hip strap + dipped front V
      const waistFront = (pelvis + 0.14) + 0.36 * (hipU ** 1.35);
      const waistBack = (pelvis + 0.38) + 0.10 * (hipU ** 1.4);
      const waistTop = T.MathUtils.lerp(waistBack, waistFront, smooth(-0.35, 0.45, z));
      const legArchFront = (pelvis - 0.96) + 1.24 * (hipU ** 1.32);
      const legArchBack = (pelvis - 0.96) + 0.68 * (hipU ** 1.48);
      const legArch = T.MathUtils.lerp(legArchBack, legArchFront, smooth(-0.55, 0.45, z));
      bottom = smooth(legArch - 0.032, legArch + 0.032, y) * (1 - smooth(waistTop - 0.032, waistTop + 0.032, y));

      // Sleek sweetheart sport-bandeau + ultra-clean thin athletic straps (strictly torso-clipped so arms never catch mask!)
      const braTorso = 1 - smooth(1.16, 1.34, ax);
      const underbust = chest + 0.40 + 0.09 * Math.exp(-((ax / 0.34) ** 2)) * smooth(0.2, 0.9, z);
      const frontSweetheart = (chest + 1.38) - 0.28 * Math.exp(-((ax / 0.26) ** 2)) + 0.10 * Math.exp(-(((ax - 0.62) / 0.34) ** 2));
      const backBand = (chest + 1.12) - 0.10 * Math.exp(-((ax / 0.58) ** 2));
      const cupTop = T.MathUtils.lerp(backBand, frontSweetheart, smooth(-0.30, 0.42, z));
      const braBand = smooth(underbust - 0.032, underbust + 0.032, y) * (1 - smooth(cupTop - 0.032, cupTop + 0.032, y)) * braTorso;
      const strapT = smooth(chest + 1.22, clavicle + 0.52, y);
      const strapCenter = T.MathUtils.lerp(0.74, 0.62, strapT);
      const strapHalfW = T.MathUtils.lerp(0.085, 0.068, strapT);
      const straps = (1 - smooth(strapHalfW - 0.02, strapHalfW + 0.02, Math.abs(ax - strapCenter)))
        * smooth(chest + 1.12, chest + 1.20, y) * (1 - smooth(clavicle + 0.56, clavicle + 0.62, y))
        * (1 - smooth(1.02, 1.14, ax));
      top = Math.max(braBand, straps);
    } else {
      const hipU = clamp(ax / 1.58, 0, 1);
      // Tailored athletic compression shorts / trunks matching bundled Male reference
      const waistTop = pelvis + 0.42 - 0.07 * (1 - hipU ** 1.5) * smooth(-0.1, 0.7, z);
      const legHem = (pelvis - 1.28) + 0.24 * (hipU ** 1.7) * T.MathUtils.lerp(0.65, 1.0, smooth(-0.4, 0.5, z));
      bottom = smooth(legHem - 0.032, legHem + 0.032, y) * (1 - smooth(waistTop - 0.032, waistTop + 0.032, y));
    }
    const mask = clamp(Math.max(bottom, top) * torso);

    // Subtle grayscale studio tonal value (lips, eyelid socket warmth, nostrils, navel, linea alba, clavicle/underbust)
    const lips = Math.exp(-((x / 0.27) ** 2 + ((y - head + 0.19) / 0.062) ** 2)) * smooth(0.55, 1.05, z);
    const eyeSocket = Math.exp(-(((ax - eyeL.x) / 0.19) ** 2 + ((y - eyeL.y) / 0.11) ** 2)) * smooth(eyeL.z - 0.04, eyeL.z + 0.16, z);
    const navel = Math.exp(-((x / 0.058) ** 2 + ((y - pelvis - 1.14) / 0.062) ** 2)) * smooth(0.2, 0.9, z);
    const lineaAlba = Math.exp(-((x / 0.045) ** 2)) * smooth(pelvis + 0.6, pelvis + 1.1, y) * (1 - smooth(chest + 0.2, chest + 0.7, y)) * smooth(0.4, 1.1, z);
    const clavicleHollow = Math.exp(-(((ax - 0.68) / 0.45) ** 2 + ((y - clavicle - 0.08) / 0.14) ** 2)) * smooth(-0.1, 0.5, z);
    // Pure unblemished skin tonal shading (no garment seam scars baked into skin RGB, so unclothed & custom dress maps render cleanly!)
    const gray = 232 - 17 * lips - 9 * eyeSocket - 9 * navel - 4.5 * lineaAlba - 4 * clavicleHollow;
    return [clamp(gray, 194, 232), Math.round(mask * 255)];
  }
  for (const { group, face } of base.faces) {
    if (group !== 'body') continue;
    for (let k = 1; k < face.length - 1; k++) {
      const corners = [face[0], face[k], face[k + 1]];
      const tex = corners.map(([, ti]) => [base.uv[ti][0] * size, (1 - base.uv[ti][1]) * size]);
      const p = corners.map(([vi]) => points[vi]);
      const [a, b, c] = tex;
      const den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1]);
      if (Math.abs(den) < 1e-9) continue;
      const minx = clamp(Math.floor(Math.min(...tex.map(t => t[0]))), 0, size - 1);
      const maxx = clamp(Math.ceil(Math.max(...tex.map(t => t[0]))), 0, size - 1);
      const miny = clamp(Math.floor(Math.min(...tex.map(t => t[1]))), 0, size - 1);
      const maxy = clamp(Math.ceil(Math.max(...tex.map(t => t[1]))), 0, size - 1);
      for (let y = miny; y <= maxy; y++) for (let x = minx; x <= maxx; x++) {
        const xx = x + 0.5, yy = y + 0.5;
        const u = ((b[1] - c[1]) * (xx - c[0]) + (c[0] - b[0]) * (yy - c[1])) / den;
        const v = ((c[1] - a[1]) * (xx - c[0]) + (a[0] - c[0]) * (yy - c[1])) / den;
        if (u < -0.001 || v < -0.001 || u + v > 1.001) continue;
        const point = [0, 1, 2].map(j => u * p[0][j] + v * p[1][j] + (1 - u - v) * p[2][j]);
        const [baseGray, alpha] = shade(...point), offset = (y * size + x) * 4;
        const gray = cleanFace && point[1] > head - 0.4 ? 232
          : clamp(Math.round(baseGray - u * cavity[corners[0][0]] - v * cavity[corners[1][0]] - (1 - u - v) * cavity[corners[2][0]]), 192, 232);
        rgba.set([gray, gray, gray, alpha], offset); covered[y * size + x] = 1;
      }
    }
  }
  // Extend each chart's nearest texels into unused UV space for seamless mip filtering.
  for (let pass = 0; pass < 6; pass++) {
    const next = covered.slice();
    for (let y = 1; y < size - 1; y++) for (let x = 1; x < size - 1; x++) {
      const i = y * size + x;
      if (covered[i]) continue;
      const neighbor = [i - 1, i + 1, i - size, i + size].find(j => covered[j]);
      if (neighbor !== undefined) { rgba.set(rgba.subarray(neighbor * 4, neighbor * 4 + 4), i * 4); next[i] = 1; }
    }
    covered.set(next);
  }
  return png(size, size, rgba);
}

function computeCoronalFaceSides(subdivided, bones, names) {
  const wCount = subdivided.vertices.length;
  const fCount = subdivided.faces.length;
  const adjacent = Array.from({ length: wCount }, () => new Set());
  const wNorm = Array.from({ length: wCount }, () => new T.Vector3());
  const edgeToFaces = new Map();
  const faceNeighbors = Array.from({ length: fCount }, () => []);

  subdivided.faces.forEach(({ face }, fi) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i][0], b = face[(i + 1) % face.length][0];
      adjacent[a].add(b); adjacent[b].add(a);
      const eKey = a < b ? `${a}/${b}` : `${b}/${a}`;
      const prev = edgeToFaces.get(eKey);
      if (prev !== undefined) {
        faceNeighbors[fi].push(prev);
        faceNeighbors[prev].push(fi);
      } else {
        edgeToFaces.set(eKey, fi);
      }
    }
    for (let k = 1; k < face.length - 1; k++) {
      const va = subdivided.vertices[face[0][0]];
      const vb = subdivided.vertices[face[k][0]];
      const vc = subdivided.vertices[face[k + 1][0]];
      const fn = vb.clone().sub(va).cross(vc.clone().sub(va));
      wNorm[face[0][0]].add(fn);
      wNorm[face[k][0]].add(fn);
      wNorm[face[k + 1][0]].add(fn);
    }
  });
  wNorm.forEach(n => n.normalize());

  const wArmL = new Float32Array(wCount), wArmR = new Float32Array(wCount);
  const wLegL = new Float32Array(wCount), wLegR = new Float32Array(wCount);
  for (let w = 0; w < wCount; w++) {
    for (const [bIdx, wt] of subdivided.influences[w]) {
      const bName = names[bIdx] || '';
      if (!wt) continue;
      if (/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_.*_l$/.test(bName) || /^(upperarm|lowerarm|hand)_l$/.test(bName)) wArmL[w] += wt;
      if (/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_.*_r$/.test(bName) || /^(upperarm|lowerarm|hand)_r$/.test(bName)) wArmR[w] += wt;
      if (/^(thigh|calf|foot|ball)_l$/.test(bName)) wLegL[w] += wt;
      if (/^(thigh|calf|foot|ball)_r$/.test(bName)) wLegR[w] += wt;
    }
  }

  const smoothScalar = (arr, passes) => {
    let cur = Float32Array.from(arr), next = new Float32Array(wCount);
    for (let p = 0; p < passes; p++) {
      for (let w = 0; w < wCount; w++) {
        let sum = cur[w];
        for (const nb of adjacent[w]) sum += cur[nb];
        next[w] = sum / (adjacent[w].size + 1);
      }
      [cur, next] = [next, cur];
    }
    return cur;
  };

  const sArmL = smoothScalar(wArmL, 8);
  const sArmR = smoothScalar(wArmR, 8);
  const sLegL = smoothScalar(wLegL, 6);
  const sLegR = smoothScalar(wLegR, 6);

  const pivArmL = bones[names.indexOf('upperarm_l')];
  const pivArmR = bones[names.indexOf('upperarm_r')];
  const pivLegL = bones[names.indexOf('thigh_l')];
  const pivLegR = bones[names.indexOf('thigh_r')];
  const zAxis = new T.Vector3(0, 0, 1);
  const rotAroundZ = (vec, pivot, angle) => {
    if (Math.abs(angle) < 1e-6) return;
    vec.sub(pivot).applyAxisAngle(zAxis, angle).add(pivot);
  };

  let minY = Infinity, maxY = -Infinity;
  const unfoldedP = Array.from({ length: wCount }, (_, w) => {
    const p = subdivided.vertices[w].clone();
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
    rotAroundZ(p, pivArmL, +0.205 * sArmL[w]);
    rotAroundZ(p, pivArmR, -0.205 * sArmR[w]);
    rotAroundZ(p, pivLegL, +0.045 * sLegL[w]);
    rotAroundZ(p, pivLegR, -0.045 * sLegR[w]);
    return p;
  });
  const unfoldedN = Array.from({ length: wCount }, (_, w) => {
    const n = wNorm[w].clone();
    const angle = +0.205 * sArmL[w] - 0.205 * sArmR[w] + 0.045 * sLegL[w] - 0.045 * sLegR[w];
    if (Math.abs(angle) > 1e-6) n.applyAxisAngle(zAxis, angle).normalize();
    return n;
  });

  const depthSpan = Math.max(1e-4, (maxY - minY) * 0.025);
  const zMid = smoothScalar(Float32Array.from(unfoldedP, p => p.z), 22);
  const rawSfb = Float32Array.from({ length: wCount }, (_, w) => {
    const dz = clamp((unfoldedP[w].z - zMid[w]) / depthSpan, -1, 1);
    return clamp(0.54 * unfoldedN[w].z + 0.46 * dz, -1, 1);
  });
  const sFb = smoothScalar(rawSfb, 3);

  // Classify every quad 0 = Front Island, 1 = Back Island, then smooth isolated sawtooth quads
  let sides = new Uint8Array(fCount);
  for (let fi = 0; fi < fCount; fi++) {
    const face = subdivided.faces[fi].face;
    let avg = 0;
    for (let k = 0; k < face.length; k++) avg += sFb[face[k][0]];
    sides[fi] = avg >= 0 ? 0 : 1;
  }
  for (let pass = 0; pass < 4; pass++) {
    const next = sides.slice();
    for (let fi = 0; fi < fCount; fi++) {
      const nbs = faceNeighbors[fi];
      if (nbs.length < 3) continue;
      let opp = 0;
      for (const nb of nbs) if (sides[nb] !== sides[fi]) opp++;
      if (opp >= 3) next[fi] = 1 - sides[fi];
    }
    sides = next;
  }
  return sides;
}

function computePaperDollDressAttributes(mesh, bones, names, sex) {
  const vCount = mesh.position.length / 3;
  const wCount = mesh.originalCount;
  const adjacent = Array.from({ length: wCount }, () => new Set());
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const a = mesh.weld[mesh.indices[i]], b = mesh.weld[mesh.indices[i + 1]], c = mesh.weld[mesh.indices[i + 2]];
    adjacent[a].add(b); adjacent[b].add(a);
    adjacent[b].add(c); adjacent[c].add(b);
    adjacent[c].add(a); adjacent[a].add(c);
  }

  const wPos = Array.from({ length: wCount }, () => new T.Vector3());
  const wArmL = new Float32Array(wCount), wArmR = new Float32Array(wCount);
  const wLegL = new Float32Array(wCount), wLegR = new Float32Array(wCount);
  const wHead = new Float32Array(wCount), seen = new Uint8Array(wCount);

  for (let i = 0; i < vCount; i++) {
    const w = mesh.weld[i];
    if (seen[w]) continue;
    seen[w] = 1;
    wPos[w].fromArray(mesh.position, i * 3);
    for (let k = 0; k < 4; k++) {
      const bName = names[mesh.joints[i * 4 + k]] || '';
      const wt = mesh.weights[i * 4 + k];
      if (!wt) continue;
      if (bName === 'Head') wHead[w] += wt;
      if (/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_.*_l$/.test(bName) || /^(upperarm|lowerarm|hand)_l$/.test(bName)) wArmL[w] += wt;
      if (/^(upperarm|lowerarm|hand|thumb|index|middle|ring|pinky)_.*_r$/.test(bName) || /^(upperarm|lowerarm|hand)_r$/.test(bName)) wArmR[w] += wt;
      if (/^(thigh|calf|foot|ball)_l$/.test(bName)) wLegL[w] += wt;
      if (/^(thigh|calf|foot|ball)_r$/.test(bName)) wLegR[w] += wt;
    }
  }

  const smoothScalar = (arr, passes) => {
    let cur = Float32Array.from(arr), next = new Float32Array(wCount);
    for (let p = 0; p < passes; p++) {
      for (let w = 0; w < wCount; w++) {
        let sum = cur[w];
        for (const nb of adjacent[w]) sum += cur[nb];
        next[w] = sum / (adjacent[w].size + 1);
      }
      [cur, next] = [next, cur];
    }
    return cur;
  };

  const sArmL = smoothScalar(wArmL, 8);
  const sArmR = smoothScalar(wArmR, 8);
  const sLegL = smoothScalar(wLegL, 6);
  const sLegR = smoothScalar(wLegR, 6);
  const sHead = smoothScalar(wHead, 4);

  const pivArmL = bones[names.indexOf('upperarm_l')];
  const pivArmR = bones[names.indexOf('upperarm_r')];
  const pivLegL = bones[names.indexOf('thigh_l')];
  const pivLegR = bones[names.indexOf('thigh_r')];
  const zAxis = new T.Vector3(0, 0, 1);
  const rotAroundZ = (vec, pivot, angle) => {
    if (Math.abs(angle) < 1e-6) return;
    vec.sub(pivot).applyAxisAngle(zAxis, angle).add(pivot);
  };

  // Unfold into a clean ~18.5° tailoring A-pose so sleeves/hands & inner thighs have wide, non-overlapping daylight margins
  const unfoldedP = Array.from({ length: wCount }, (_, w) => {
    const p = wPos[w].clone();
    rotAroundZ(p, pivArmL, +0.205 * sArmL[w]);
    rotAroundZ(p, pivArmR, -0.205 * sArmR[w]);
    rotAroundZ(p, pivLegL, +0.045 * sLegL[w]);
    rotAroundZ(p, pivLegR, -0.045 * sLegR[w]);
    return p;
  });

  const nominalHeight = sex === 'female' ? 1.75 : 1.80;
  const scaleV = 0.91 / nominalHeight; // Exact 1:1 isometric aspect on square 2048x2048 map!
  const uv1 = new Float32Array(vCount * 2);
  const dressAttr = new Float32Array(vCount * 4);

  for (let i = 0; i < vCount; i++) {
    const w = mesh.weld[i];
    const p = unfoldedP[w];
    const uFront = clamp(0.25 + p.x * scaleV, 0.012, 0.488);
    const vPaper = clamp(0.045 + p.y * scaleV, 0.012, 0.988);
    const isBack = mesh.dressSide ? mesh.dressSide[i] === 1 : false;
    const uIsland = isBack ? (1.0 - uFront) : uFront;
    const sideSign = isBack ? -1.0 : 1.0;
    // Keep neck/collar, shoulders, torso, arms, hands, pelvis, legs, and feet 100% dress-eligible while protecting face/ears/mouth
    const eligibility = clamp(1 - smooth(0.28, 0.62, sHead[w]), 0, 1);

    // Every triangle belongs 100% to EITHER Front Island (U in [0.012, 0.488]) OR Back Island (U in [0.512, 0.988])!
    uv1[i * 2] = uIsland;
    uv1[i * 2 + 1] = 1.0 - vPaper;
    dressAttr[i * 4] = uIsland;
    dressAttr[i * 4 + 1] = vPaper;
    dressAttr[i * 4 + 2] = sideSign;
    dressAttr[i * 4 + 3] = eligibility;
  }

  let straddlingTris = 0;
  for (let i = 0; i < mesh.indices.length; i += 3) {
    const ua = uv1[mesh.indices[i] * 2];
    const ub = uv1[mesh.indices[i + 1] * 2];
    const uc = uv1[mesh.indices[i + 2] * 2];
    const allFront = ua < 0.5 && ub < 0.5 && uc < 0.5;
    const allBack = ua > 0.5 && ub > 0.5 && uc > 0.5;
    if (!allFront && !allBack) straddlingTris++;
  }
  assert.equal(straddlingTris, 0, `Found ${straddlingTris} coronal UV straddling triangles`);

  mesh.uv1 = uv1;
  mesh.dress = dressAttr;
}

function createGlb(meshes, bones, names, parents, worldQuaternions, texture) {
  const json = {
    asset: { version: '2.0', generator: 'Pose Studio offline CC0 mannequin builder', copyright: 'MakeHuman Community, CC0-1.0; generated refinements CC0-1.0' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: 'Mannequin', children: [] }],
    buffers: [], bufferViews: [], accessors: [], meshes: [], skins: [],
    images: [], textures: [{ source: 0, sampler: 0, extras: { pncOutfitMask: true } }], samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }],
    materials: [
      { name: 'Studio skin + outfit mask', pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicFactor: 0, roughnessFactor: 0.78 }, extras: { pncOutfitMask: true, skipAlbedoNormalization: true } },
      { name: 'Eyes', pbrMetallicRoughness: { metallicFactor: 0, roughnessFactor: 0.18 } },
      { name: 'Eyebrows', doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [0.11, 0.072, 0.052, 1], metallicFactor: 0, roughnessFactor: 0.78 } },
    ],
  };
  const chunks = [];
  let byteLength = 0;
  function bufferView(array, target) {
    const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4); data.copy(padded);
    const index = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length, ...(target ? { target } : {}) });
    chunks.push(padded); byteLength += padded.length;
    return index;
  }
  function accessor(array, type, target, bounds = false) {
    const count = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[type];
    const item = { bufferView: bufferView(array, target), componentType: array instanceof Float32Array ? 5126 : 5123, count: array.length / count, type };
    if (bounds) {
      item.min = Array(count).fill(Infinity); item.max = Array(count).fill(-Infinity);
      for (let i = 0; i < array.length; i++) {
        item.min[i % count] = Math.min(item.min[i % count], array[i]);
        item.max[i % count] = Math.max(item.max[i % count], array[i]);
      }
    }
    json.accessors.push(item); return json.accessors.length - 1;
  }
  names.forEach((name, i) => {
    const parent = parents[i];
    const q = worldQuaternions[name].clone();
    const localQ = parent >= 0 ? worldQuaternions[names[parent]].clone().invert().multiply(q) : q;
    const localP = parent >= 0 ? bones[i].clone().sub(bones[parent]).applyQuaternion(worldQuaternions[names[parent]].clone().invert()) : bones[i];
    json.nodes.push({ name, translation: localP.toArray(), rotation: localQ.toArray(), children: [] });
  });
  parents.forEach((parent, i) => json.nodes[parent >= 0 ? parent + 1 : 0].children.push(i + 1));
  const inverse = new Float32Array(names.length * 16);
  names.forEach((name, i) => new T.Matrix4().compose(bones[i], worldQuaternions[name], new T.Vector3(1, 1, 1)).invert().toArray(inverse, i * 16));
  json.skins.push({ name: 'UE-compatible MakeHuman game engine', inverseBindMatrices: accessor(inverse, 'MAT4'), joints: names.map((_, i) => i + 1), skeleton: 1 });
  meshes.forEach((mesh, i) => {
    const attributes = {
      POSITION: accessor(mesh.position, 'VEC3', 34962, true), NORMAL: accessor(mesh.normal, 'VEC3', 34962),
      TEXCOORD_0: accessor(mesh.uv, 'VEC2', 34962), JOINTS_0: accessor(mesh.joints, 'VEC4', 34962),
      WEIGHTS_0: accessor(mesh.weights, 'VEC4', 34962),
    };
    if (mesh.uv1) attributes.TEXCOORD_1 = accessor(mesh.uv1, 'VEC2', 34962);
    if (mesh.dress) attributes._PNC_DRESS = accessor(mesh.dress, 'VEC4', 34962);
    if (mesh.color) attributes.COLOR_0 = accessor(mesh.color, 'VEC3', 34962);
    json.meshes.push({ name: ['Body', 'Eyes', 'Eyebrows'][i], primitives: [{ attributes, indices: accessor(mesh.indices, 'SCALAR', 34963), material: i }] });
    json.nodes[0].children.push(json.nodes.length);
    json.nodes.push({ name: ['Body', 'Eyes', 'Eyebrows'][i], mesh: i, skin: 0 });
  });
  json.images.push({ bufferView: bufferView(texture), mimeType: 'image/png' });
  json.buffers.push({ byteLength });
  const rawJson = Buffer.from(JSON.stringify(json));
  const jsonBytes = Buffer.alloc(Math.ceil(rawJson.length / 4) * 4, 0x20); rawJson.copy(jsonBytes);
  const bin = Buffer.concat(chunks), result = Buffer.alloc(12 + 8 + jsonBytes.length + 8 + bin.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonBytes.length, 12); result.writeUInt32LE(0x4e4f534a, 16); jsonBytes.copy(result, 20);
  const off = 20 + jsonBytes.length;
  result.writeUInt32LE(bin.length, off); result.writeUInt32LE(0x004e4942, off + 4); bin.copy(result, off + 8);
  return result;
}

// Work in normalized bind space, after the coronal UV split: changing the
// chest must not recenter the skeleton or renumber garment donor vertices.
function roundFemaleChest(shapes) {
  const reference = shapes.realistic.meshes[0].position.slice();
  for (const [type, gain] of Object.entries({
    realistic: 1, heroic: 0.96, lean: 0.76, slender: 0.68,
    busty: 1.2, chubby: 0.92, fat: 0.88, obese: 0.84,
  })) {
    const body = shapes[type].meshes[0];
    for (let i = 0; i < reference.length; i += 3) {
      const x = reference[i], y = reference[i + 1], z = reference[i + 2];
      const ax = Math.abs(x), dx = ax - 0.093, dy = y - 1.245;
      const r2 = (dx / 0.094) ** 2 + (dy / (dy < 0 ? 0.052 : 0.135)) ** 2;
      if (r2 >= 1 || z <= 0.025) continue;
      const lobe = gain * (1 - smooth(0, 1, r2)) * smooth(0.025, 0.08, z) * smooth(0.009, 0.038, ax);
      // Fill the flanks more than the existing tip; slide the lower pole
      // slightly down and outward while leaving the sternal strip untouched.
      body.position[i] += Math.sign(x) * lobe * (0.003 + 0.15 * dx);
      body.position[i + 1] -= 0.005 * lobe;
      body.position[i + 2] += lobe * (0.040 - 0.010 * smooth(0.125, 0.148, z));
    }
    body.normal = normals(body);
  }
}

// Translate each arm chain with its socket; don't scale humerus length or
// pull the breast, ribcage and hand into a narrower whole-body silhouette.
function narrowShoulders(shape, names, orientation, inset) {
  const { bones, parents, local, transforms } = shape;
  const body = shape.meshes[0];
  const offset = new Float32Array(bones.length);
  for (const [suffix, sign] of [['l', -1], ['r', 1]]) {
    const socket = names.indexOf(`upperarm_${suffix}`);
    const shift = new T.Vector3(sign * inset, 0, 0);
    const shiftLocal = shift.clone().applyQuaternion(orientation[names[parents[socket]]].clone().invert());
    v3(local.subarray(socket * 3, socket * 3 + 3)).add(shiftLocal).toArray(local, socket * 3);
    for (let i = 0; i < bones.length; i++) {
      let ancestor = i;
      while (ancestor >= 0 && ancestor !== socket) ancestor = parents[ancestor];
      if (ancestor < 0) continue;
      bones[i].add(shift);
      transforms[i * 7] = bones[i].x;
      offset[i] = shift.x;
    }
  }
  for (let i = 0; i < body.position.length / 3; i++) {
    let dx = 0;
    for (let k = i * 4; k < i * 4 + 4; k++) dx += offset[body.joints[k]] * body.weights[k];
    body.position[i * 3] += dx;
  }
  body.normal = normals(body);
}

function anchorAxillaryFold(body, names) {
  const arms = ['upperarm_l', 'upperarm_r'].map(n => names.indexOf(n));
  const spine = names.indexOf('spine_03');
  for (let v = 0; v < body.position.length / 3; v++) {
    const y = body.position[v * 3 + 1], z = body.position[v * 3 + 2];
    if (y < 1.235 || y > 1.405 || z > 0.10) continue;
    const joints = body.joints.subarray(v * 4, v * 4 + 4);
    const a = joints.findIndex(j => arms.includes(j)), t = joints.indexOf(spine);
    if (a < 0 || t < 0) continue;
    const arm = body.weights[v * 4 + a], thorax = body.weights[v * 4 + t];
    // Only the web shared with the ribs, not the arm-side sleeve or deltoid.
    const blend = smooth(1.235, 1.29, y) * (1 - smooth(1.34, 1.405, y)) *
      (1 - smooth(0.045, 0.10, z)) * smooth(0.035, 0.32, thorax);
    const transfer = arm * 0.60 * blend;
    body.weights[v * 4 + a] -= transfer;
    body.weights[v * 4 + t] += transfer;
  }
}

async function build() {
  await mkdir(OUT, { recursive: true });
  try { sourceLock = JSON.parse(await readFile(path.join(OUT, 'sources.lock.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const [baseBytes, rigBytes, weightBytes, eyeBytes, eyeMapBytes, license] = await Promise.all([
    source('3dobjs/base.obj'), source('rigs/standard/rig.game_engine.json'), source('rigs/standard/weights.game_engine.json'),
    source('eyes/low-poly.obj', `https://raw.githubusercontent.com/makehumancommunity/makehuman/${MH}/makehuman/data/eyes/low-poly/low-poly.obj`),
    source('eyes/low-poly.mhclo', `https://raw.githubusercontent.com/makehumancommunity/makehuman/${MH}/makehuman/data/eyes/low-poly/low-poly.mhclo`),
    source('LICENSE.ASSETS.md', `https://raw.githubusercontent.com/makehumancommunity/mpfb2/${MPFB}/LICENSE.ASSETS.md`),
  ]);
  const base = obj(baseBytes.toString()), rig = JSON.parse(rigBytes), weightData = JSON.parse(weightBytes);
  const names = Object.keys(rig).map(rename);
  const bodyFaces = base.faces.filter(f => f.group === 'body');
  const eyeObj = obj(eyeBytes.toString());
  const eyeMap = eyeMapBytes.toString().split('verts 0')[1].trim().split(/\r?\n/).map(Number);
  assert.equal(eyeMap.length, 96);
  assert.equal(eyeObj.vertices.length, eyeMap.length);
  const weights = skinWeights(weightData, names);
  const recipes = Object.fromEntries(SEXES.map(sex => [sex, Object.fromEntries(TYPES.map(type => [type, recipe(sex, type)]))]));
  const required = [...new Set(SEXES.flatMap(sex => TYPES.flatMap(type => recipes[sex][type].map(([name]) => name))))].sort();
  // A bounded queue avoids hammering the public CC0 source host.
  for (let i = 0; i < required.length; i += 6) await Promise.all(required.slice(i, i + 6).map(target));
  const report = { schemaVersion: 1, sourceRevisions: { mpfb2: MPFB, makehuman: MH }, shapes: {}, sourceRigs: {}, validations: {} };
  const animationBytes = await readFile(path.join(ROOT, 'public', 'models', 'animations', 'quaternius-ual1', 'UAL1_Standard.glb'));
  const animationJson = JSON.parse(animationBytes.toString('utf8', 20, 20 + animationBytes.readUInt32LE(12)));
  report.animationRig = { sha256: sha(animationBytes), bones: sourceOrientations(animationJson).measured };
  const bundle = { schemaVersion: 1, encoding: 'int16-le-delta', baseBodyType: 'realistic', binary: 'archetypes.bin', compressedBinary: 'archetypes.bin.gz',
    coordinates: 'meters; Y up; +Z forward; anatomical left +X', boneNames: names, gender: {} };
  const binary = [];
  let binaryOffset = 0;
  function append(array) {
    const data = Buffer.from(array.buffer, array.byteOffset, array.byteLength);
    const entry = { byteOffset: binaryOffset, byteLength: data.byteLength };
    binary.push(data); binaryOffset += data.byteLength;
    const padding = (4 - binaryOffset % 4) % 4;
    if (padding) { binary.push(Buffer.alloc(padding)); binaryOffset += padding; }
    return entry;
  }
  for (const sex of SEXES) {
    const title = sex[0].toUpperCase() + sex.slice(1);
    const sourceFile = path.join(ROOT, 'public', 'models', 'external', 'quaternius-universal-base', `Superhero_${title}_FullBody.gltf`);
    const orientation = sourceOrientations(JSON.parse(await readFile(sourceFile, 'utf8')));
    const shapeData = {};
    let coronalFaceSides = null;
    report.sourceRigs[sex] = orientation.measured;
    for (const type of TYPES) {
      const points = base.vertices.map(p => [...p]);
      for (const [name, amount] of recipes[sex][type]) {
        for (const [i, x, y, z] of targets.get(name)) {
          points[i][0] += x * amount; points[i][1] += y * amount; points[i][2] += z * amount;
        }
      }
      if (type === 'chibi') sculptAnimeChibi(points, eyeMap);
      else sculptAdultProportions(points, base, rig, sex, type);
      const aligned = alignRest(points, base, rig, names, weights);
      refineSurface(aligned.vertices, bodyFaces, aligned.bones[names.indexOf('neck_01')].y, type, sex);
      const eyes = eyeMesh(points, base, eyeMap, names.indexOf('Head'), type === 'chibi', sex);
      const brows = browMesh(points, bodyFaces, eyes.centers, names.indexOf('Head'), type === 'chibi', sex);
      for (const mesh of [eyes.mesh, brows]) {
        for (let i = 0; i < mesh.position.length; i += 3) aligned.transformHead(Array.from(mesh.position.subarray(i, i + 3))).toArray(mesh.position, i);
      }
      const subdivided = subdivideBody(bodyFaces, aligned.vertices, base.uv, weights);
      if (!coronalFaceSides) coronalFaceSides = computeCoronalFaceSides(subdivided, aligned.bones, names);
      const mesh = splitMesh(subdivided.faces, subdivided.vertices, subdivided.uv, subdivided.influences, subdivided.vertices.length, coronalFaceSides);
      const meshes = [mesh, eyes.mesh, brows];
      const box = new T.Box3().setFromArray(mesh.position);
      const chinVertices = weightData.weights.head.filter(([i, weight]) =>
        i < N && weight > 0.45 && Math.abs(points[i][0]) < 0.16 && points[i][2] > 0.25).map(([i]) => i);
      assert(chinVertices.length > 0, 'Missing central chin landmarks');
      const chin = Math.min(...chinVertices.map(i => subdivided.vertices[i].y));
      const headHeight = box.max.y - chin;
      const headCount = (sex === 'female'
        ? { realistic: 7.62, heroic: 8.05, lean: 7.82, slender: 8.02, busty: 7.65, chubby: 7.46, fat: 7.35, obese: 7.24, chibi: 2.5 }
        : { realistic: 7.72, heroic: 8.15, lean: 7.90, slender: 8.08, busty: 7.78, chubby: 7.52, fat: 7.40, obese: 7.28, chibi: 2.5 }
      )[type];
      {
        const compression = (headCount - 1) * headHeight / (chin - box.min.y);
        const warp = p => {
          if (type === 'chibi') {
            const blend = smooth(chin - 0.5, chin + 0.15, p.y);
            p.x *= T.MathUtils.lerp(0.62, 1, blend);
            p.z *= T.MathUtils.lerp(0.75, 1, blend);
          }
          p.y = p.y < chin ? chin + (p.y - chin) * compression : p.y;
          return p;
        };
        meshes.forEach(m => {
          for (let i = 0; i < m.position.length; i += 3) warp(new T.Vector3().fromArray(m.position, i)).toArray(m.position, i);
        });
        aligned.bones.forEach(warp);
      }
      realignProportionedRest(meshes, aligned.bones, names, aligned.parents);
      if (type === 'chibi') {
        for (const side of ['l', 'r']) {
          const hand = aligned.bones[names.indexOf(`hand_${side}`)], ankle = aligned.bones[names.indexOf(`foot_${side}`)];
          for (let i = 0; i < mesh.position.length / 3; i++) {
            let handWeight = 0, footWeight = 0;
            for (let j = 0; j < 4; j++) {
              const name = names[mesh.joints[i * 4 + j]], weight = mesh.weights[i * 4 + j];
              if (!name.endsWith(`_${side}`)) continue;
              if (/^(hand|thumb|index|middle|ring|pinky)_/.test(name)) handWeight += weight;
              if (/^(foot|ball)_/.test(name)) footWeight += weight;
            }
            const p = new T.Vector3().fromArray(mesh.position, i * 3);
            p.lerp(p.clone().sub(hand).multiplyScalar(0.78).add(hand), handWeight);
            p.z = T.MathUtils.lerp(p.z, ankle.z + (p.z - ankle.z) * 0.65, footWeight);
            p.x = T.MathUtils.lerp(p.x, ankle.x + (p.x - ankle.x) * 1.12, footWeight);
            p.toArray(mesh.position, i * 3);
          }
          names.forEach((name, i) => {
            if (!name.endsWith(`_${side}`)) return;
            if (/^(thumb|index|middle|ring|pinky)_/.test(name)) aligned.bones[i].sub(hand).multiplyScalar(0.78).add(hand);
            if (name.startsWith('ball_')) aligned.bones[i].z = ankle.z + (aligned.bones[i].z - ankle.z) * 0.65;
          });
        }
      }
      box.setFromArray(mesh.position);
      const height = type === 'chibi' ? 1.05 : sex === 'female' ? 1.75 : 1.8;
      const scale = height / (box.max.y - box.min.y);
      const shift = new T.Vector3(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
      const normalize = p => p.add(shift).multiplyScalar(scale);
      meshes.forEach(m => {
        for (let i = 0; i < m.position.length; i += 3) normalize(new T.Vector3().fromArray(m.position, i)).toArray(m.position, i);
        m.normal = normals(m);
      });
      aligned.bones.forEach(normalize);
      fitBrowsAndLashes(meshes[0], meshes[1], meshes[2], type === 'chibi', sex);
      meshes[2].normal = normals(meshes[2]);
      const worldQuaternions = orientation.world;
      const local = aligned.bones.flatMap((p, i) => {
        const parent = aligned.parents[i];
        return (parent >= 0 ? p.clone().sub(aligned.bones[parent]).applyQuaternion(worldQuaternions[names[parent]].clone().invert()) : p).toArray();
      });
      const transforms = aligned.bones.flatMap((p, i) => [...p.toArray(), ...worldQuaternions[names[i]].toArray()]);
      const bounds = new T.Box3().setFromArray(mesh.position);
      for (const side of ['l', 'r']) {
        const thigh = aligned.bones[names.indexOf(`thigh_${side}`)], knee = aligned.bones[names.indexOf(`calf_${side}`)], ankle = aligned.bones[names.indexOf(`foot_${side}`)];
        assert(Math.abs(thigh.x - knee.x) < 1e-6 && Math.abs(knee.x - ankle.x) < 1e-6, 'Neutral leg not vertical');
        assert(Math.abs(thigh.z - knee.z) < 1e-6 && Math.abs(knee.z - ankle.z) < 1e-6, 'Neutral leg not vertical');
        const upper = aligned.bones[names.indexOf(`upperarm_${side}`)], elbow = aligned.bones[names.indexOf(`lowerarm_${side}`)], hand = aligned.bones[names.indexOf(`hand_${side}`)];
        assert(elbow.clone().sub(upper).normalize().distanceTo(new T.Vector3(side === 'l' ? 0.12 : -0.12, -1, 0).normalize()) < 1e-6, 'Incorrect upper-arm rest angle');
        assert(hand.clone().sub(elbow).normalize().distanceTo(new T.Vector3(0, -1, 0)) < 1e-6, 'Incorrect forearm rest angle');
      }
      assert(Math.abs(bounds.min.y) < 1e-6);
      assert(mesh.position.every(Number.isFinite));
      shapeData[type] = { meshes, bones: aligned.bones, parents: aligned.parents, local: new Float32Array(local), transforms: new Float32Array(transforms), points };
      report.shapes[`${sex}/${type}`] = {
        height: bounds.max.y, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() },
        shoulderWidth: aligned.bones[names.indexOf('upperarm_l')].distanceTo(aligned.bones[names.indexOf('upperarm_r')]),
        headHeight: headHeight * scale, headRatio: height / (headHeight * scale),
        vertices: meshes.map(m => m.position.length / 3), triangles: meshes.map(m => m.indices.length / 3),
      };
      console.log(`${sex}/${type}: ${height.toFixed(2)}m, ${mesh.position.length / 3} body split vertices`);
    }
    const baseline = shapeData.realistic;
    computePaperDollDressAttributes(baseline.meshes[0], baseline.bones, names, sex);
    if (sex === 'female') {
      roundFemaleChest(shapeData);
      for (const [type, shape] of Object.entries(shapeData)) {
        if (type !== 'chibi') {
          narrowShoulders(shape, names, orientation.world, 0.012);
          report.shapes[`${sex}/${type}`].shoulderWidth = shape.bones[names.indexOf('upperarm_l')].distanceTo(shape.bones[names.indexOf('upperarm_r')]);
        }
        const box = new T.Box3().setFromArray(shape.meshes[0].position);
        report.shapes[`${sex}/${type}`].bounds = { min: box.min.toArray(), max: box.max.toArray() };
      }
      anchorAxillaryFold(baseline.meshes[0], names);
    }
    const texture = bodyTexture(base, baseline.points, sex, rig, names);
    await writeFile(path.join(OUT, `Mannequin_${title}.png`), texture);
    await writeFile(path.join(OUT, `Mannequin_${title}_Chibi.png`), bodyTexture(base, baseline.points, sex, rig, names, true));
    await writeFile(path.join(OUT, `Mannequin_${title}.glb`), createGlb(baseline.meshes, baseline.bones, names, baseline.parents, orientation.world, texture));
    const gender = { glb: `Mannequin_${title}.glb`, meshes: baseline.meshes.map((m, i) => ({ name: ['Body', 'Eyes', 'Eyebrows'][i], vertexCount: m.position.length / 3, weld: append(m.weld), weldCount: m.originalCount })), archetypes: {} };
    for (const type of TYPES) {
      const shape = shapeData[type];
      const entry = { meshes: [] };
      let minimumQuantizedY = Infinity;
      for (let i = 0; i < shape.meshes.length; i++) {
        const delta = shape.meshes[i].position.map((x, k) => x - baseline.meshes[i].position[k]);
        const maximum = delta.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
        const scale = maximum > 0 ? maximum / 32760 : 1;
        const quantized = Int16Array.from(delta, x => Math.round(x / scale));
        const maximumError = delta.reduce((m, x, k) => Math.max(m, Math.abs(x - quantized[k] * scale)), 0);
        assert(maximumError <= 0.00002, 'Morph quantization exceeds 0.02 mm');
        if (i === 0) for (let k = 1; k < quantized.length; k += 3) {
          minimumQuantizedY = Math.min(minimumQuantizedY, baseline.meshes[i].position[k] + quantized[k] * scale);
        }
        entry.meshes.push({ name: ['Body', 'Eyes', 'Eyebrows'][i], ...append(quantized), scale, maximumError,
          ...(type === 'chibi' && shape.meshes[i].color ? { color: { ...append(shape.meshes[i].color), componentType: 'float32' } } : {}) });
      }
      if (type === 'chibi') entry.bodyTexture = `Mannequin_${title}_Chibi.png`;
      entry.floorOffsetY = -minimumQuantizedY;
      const local = shape.local.slice(), world = shape.transforms.slice();
      shape.parents.forEach((parent, i) => { if (parent < 0) local[i * 3 + 1] += entry.floorOffsetY; });
      for (let i = 1; i < world.length; i += 7) world[i] += entry.floorOffsetY;
      entry.boneLocalTranslations = append(local);
      entry.boneWorldTransforms = append(world);
      gender.archetypes[type] = entry;
    }
    bundle.gender[sex] = gender;
  }
  const edgeCount = new Map();
  bodyFaces.forEach(({ face }) => face.forEach(([a], i) => {
    const b = face[(i + 1) % face.length][0], key = [a, b].sort((x, y) => x - y).join('/');
    edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
  }));
  const boundaryEdges = [...edgeCount.values()].filter(n => n !== 2).length;
  assert.equal(boundaryEdges, 0, 'Body is not a closed two-manifold');
  report.validations = { authoringBodyVertices: N, bodyWeldedVertices: bundle.gender.female.meshes[0].weldCount,
    subdivisionLevels: 1, boundaryEdges, topFourWeightsNormalized: true, floorToleranceMeters: 1e-6,
    quantizationToleranceMeters: 0.00002, verticalLegs: true, exactArmRestDirections: true, uvSplitNormalsWelded: true };
  const bytes = Buffer.concat(binary);
  const compressed = gzipSync(bytes, { level: 9, mtime: 0 });
  bundle.byteLength = bytes.length; bundle.sha256 = sha(bytes);
  await Promise.all([
    writeFile(path.join(OUT, 'archetypes.bin'), bytes),
    writeFile(path.join(OUT, 'archetypes.bin.gz'), compressed),
    writeFile(path.join(OUT, 'archetypes.json'), JSON.stringify(bundle, null, 2) + '\n'),
    writeFile(path.join(OUT, 'build-report.json'), JSON.stringify(report, null, 2) + '\n'),
    writeFile(path.join(OUT, 'recipes.json'), JSON.stringify(recipes, null, 2) + '\n'),
    writeFile(path.join(OUT, 'LICENSE-MakeHuman.txt'), license),
    writeFile(path.join(OUT, 'sources.lock.json'), JSON.stringify({ schemaVersion: 1, sources: provenance.sort((a, b) => a.url.localeCompare(b.url)) }, null, 2) + '\n'),
  ]);
  console.log(`Wrote ${OUT}; morph bundle ${bytes.length} bytes (${compressed.length} gzip).`);
}

async function preview() {
  const vite = 'http://127.0.0.1:5173';
  const response = await fetch(`${vite}/src/external-rig.ts`);
  if (!response.ok) throw new Error(`Studio Vite server unavailable: ${response.status}`);
  const module = await response.text();
  const dependency = name => {
    const match = module.match(new RegExp(`from "([^"]*${name}[^"]*)"`));
    if (!match) throw new Error(`Could not resolve Vite module ${name}`);
    return vite + match[1];
  };
  const html = `<!doctype html><meta charset="utf-8"><title>Isolated mannequin asset verification</title>
<style>body{margin:0;background:#e8e7e4;font:16px system-ui}button{padding:10px;margin:6px}#status{padding:12px}canvas{display:block}</style>
<div id="status">Loading isolated asset verification...</div><div id="buttons"></div><canvas id="sheet"></canvas>
<script type="module">
import * as T from '${dependency('three\\.js')}';
import { GLTFLoader } from '${dependency('GLTFLoader__js')}';
import { clone } from '${dependency('SkeletonUtils__js')}';
import { preset, JOINTS } from '${vite}/src/model.ts';
import { SOURCE_BONES } from '${vite}/src/external-rig.ts';
import { setFigurePose } from '${vite}/src/rig.ts';
import { applyBodyProportion } from '${vite}/src/bodyProportions.ts';
import { createAnimationClipFromThree, extractPoseAtFrame } from '${vite}/src/animationPoseExtractor.ts';
const header = await fetch('/models/archetypes.json').then(r=>r.json());
const binary = await fetch('/models/archetypes.bin').then(r=>r.arrayBuffer());
const templates = {};
const animeTextures = {};
const loader = new GLTFLoader();
for(const sex of ['female','male']){
 templates[sex] = (await loader.loadAsync('/models/'+header.gender[sex].glb)).scene;
 animeTextures[sex]=await new T.TextureLoader().loadAsync('/models/'+header.gender[sex].archetypes.chibi.bodyTexture);
 animeTextures[sex].flipY=false;animeTextures[sex].colorSpace=T.SRGBColorSpace;
}
const renderer = new T.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.setSize(420,620);
renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
const scene = new T.Scene();scene.background=new T.Color('#e8e7e4');
scene.add(new T.HemisphereLight('#fff8ef','#8b8b92',2));
for(const [x,y,z,power] of [[-3,5,4,3.8],[3,3,-2,2.4],[2,2,4,0.5]]){
 const light = new T.DirectionalLight('#ffffff',power);light.position.set(x,y,z);scene.add(light);
}
const camera = new T.PerspectiveCamera(29,420/620,.01,30);
const canvas=document.querySelector('#sheet'),ctx=canvas.getContext('2d');
const baseline = {};
for(const sex of ['female','male']){baseline[sex]={};templates[sex].traverse(n=>{
 if(n.isSkinnedMesh)baseline[sex][n.name]=n.geometry.attributes.position.array.slice();
});}
const reports=[];
function figure(sex,type,mode='clay'){
 const root=clone(templates[sex]),allBones=new Map(),skins=[];
 root.traverse(n=>{if(n.isBone)allBones.set(n.name,n);if(n.isSkinnedMesh){
  n.geometry=n.geometry.clone();n.material=n.material.clone();n.frustumCulled=false;skins.push(n);
  const base=baseline[sex][n.name],record=header.gender[sex].archetypes[type].meshes.find(m=>m.name===n.name);
  const delta=new Int16Array(binary,record.byteOffset,record.byteLength/2);
  if(record.color)n.geometry.setAttribute('color',new T.BufferAttribute(new Float32Array(binary,record.color.byteOffset,record.color.byteLength/4).slice(),3));
  const pos=n.geometry.attributes.position;
  for(let i=0;i<pos.array.length;i++)pos.array[i]=base[i]+delta[i]*record.scale+(i%3===1?header.gender[sex].archetypes[type].floorOffsetY:0);
  const info=header.gender[sex].meshes.find(m=>m.name===n.name);
  const weld=new Uint16Array(binary,info.weld.byteOffset,info.weld.byteLength/2);
  n.geometry.computeVertexNormals();
  const normal=n.geometry.attributes.normal,acc=new Float32Array(info.weldCount*3);
  // Restore identical normals on UV duplicates.
  for(let i=0;i<weld.length;i++)for(let j=0;j<3;j++)acc[weld[i]*3+j]+=normal.array[i*3+j];
  const vector=new T.Vector3();
  for(let i=0;i<weld.length;i++)vector.fromArray(acc,weld[i]*3).normalize().toArray(normal.array,i*3);
  if(type==='chibi'&&n.name==='Body')n.material.map=animeTextures[sex];
  if(mode==='cel'){
   const original=n.material;
   n.material=new T.MeshToonMaterial({map:original.map,color:original.color,vertexColors:original.vertexColors,side:original.side});
   original.dispose();
  }
  if(mode==='clay'){n.material.map=null;n.material.vertexColors=false;n.material.color.set('#c7c3bb');n.material.roughness=.85;}
  else if(n.name==='Body'){
   n.material.color.set(sex==='female'?'#ffdecc':'#d99b78');
   n.material.onBeforeCompile=shader=>{
    shader.uniforms.uOutfitColor={value:new T.Color(sex==='female'?'#465f71':'#3e5366')};
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\\nuniform vec3 uOutfitColor;')
     .replace('#include <map_fragment>',\`#ifdef USE_MAP
     vec4 sampledDiffuseColor=texture2D(map,vMapUv);
     diffuseColor.rgb=sampledDiffuseColor.rgb*mix(diffuse,uOutfitColor,sampledDiffuseColor.a);
     #endif\`);
   };n.material.customProgramCacheKey=()=> 'verified-outfit';n.material.transparent=false;
  }
 }});
 const record=header.gender[sex].archetypes[type];
 const positions=new Float32Array(binary,record.boneLocalTranslations.byteOffset,record.boneLocalTranslations.byteLength/4);
 header.boneNames.forEach((name,i)=>allBones.get(name).position.fromArray(positions,i*3));
 root.updateMatrixWorld(true);
 skins.forEach(s=>{s.skeleton.calculateInverses();s.skeleton.update();s.bindMatrix.identity();s.bindMatrixInverse.identity();});
 const bones=Object.fromEntries(JOINTS.map(j=>[j,allBones.get(SOURCE_BONES[j])]));
 const rig={body:sex,root,skin:skins.find(s=>s.name==='Body'),skins,bones,
  restRotations:Object.fromEntries(JOINTS.map(j=>[j,bones[j].quaternion.clone()])),
  rotationBases:Object.fromEntries(JOINTS.map(j=>[j,bones[j].getWorldQuaternion(new T.Quaternion()).invert()])),
  tintMaterials:[],outfitColorUniforms:[],hairMaterials:[]};
 let maximumBindError=0;
 const transformed=new T.Vector3();
 for(const skin of skins)for(let i=0;i<skin.geometry.attributes.position.count;i++){
  const point=new T.Vector3().fromBufferAttribute(skin.geometry.attributes.position,i);
  transformed.copy(point);skin.applyBoneTransform(i,transformed);
  maximumBindError=Math.max(maximumBindError,point.distanceTo(transformed));
 }
 if(maximumBindError>1e-5)throw new Error('Bind mismatch '+sex+'/'+type+': '+maximumBindError);
 reports.push({sex,type,maximumBindError});
 return rig;
}
function dispose(rig){scene.remove(rig.root);rig.skins.forEach(s=>{s.geometry.dispose();s.material.dispose()});}
function renderCell(rig,angle,x,y,w,h,face=false){
 scene.add(rig.root);rig.root.updateMatrixWorld(true);
 const bounds=new T.Box3().setFromObject(rig.root),height=bounds.max.y-bounds.min.y;
 let center=bounds.getCenter(new T.Vector3()),range=height;
 if(face==='torso'){
  const chest=rig.bones.chest.getWorldPosition(new T.Vector3()),pelvis=rig.bones.hips.getWorldPosition(new T.Vector3());
  center.set(0,(chest.y+pelvis.y)*.5+.05,(chest.z+pelvis.z)*.5+.04);range=height*.55;
 }else if(face){
  const head=rig.bones.head.getWorldPosition(new T.Vector3());
  center.set(0,head.y+(bounds.max.y-head.y)*.4,head.z+.035);
  range=(bounds.max.y-head.y)*1.6;
 }
 const radius=range*2.35;
 camera.aspect=w/h;camera.updateProjectionMatrix();camera.position.set(center.x+Math.sin(angle)*radius,center.y+range*.055,center.z+Math.cos(angle)*radius);
 camera.lookAt(center);renderer.setSize(w,h);renderer.render(scene,camera);
 ctx.drawImage(renderer.domElement,x,y,w,h);scene.remove(rig.root);
}
window.renderSheet=async(kind='clay',sex='female')=>{
 document.querySelector('#status').textContent='Rendering '+sex+' '+kind;
 const types=${JSON.stringify(TYPES)},angles=[0,Math.PI/4,Math.PI/2];
 const w=300,h=510,title=42;canvas.width=w*9;canvas.height=(h+30)*3+title;
 ctx.fillStyle='#e8e7e4';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.fillStyle='#26292c';ctx.font='bold 23px system-ui';ctx.fillText('CC0 MANNEQUIN / '+sex.toUpperCase()+' / '+kind.toUpperCase(),18,30);
 for(let c=0;c<9;c++){
  const rig=figure(sex,types[c],kind);
  for(let r=0;r<3;r++){
   renderCell(rig,angles[r],c*w,title+r*(h+30),w,h);
   ctx.fillStyle='#26292c';ctx.font='18px system-ui';ctx.fillText(types[c]+' / '+['front','3/4','side'][r],c*w+12,title+r*(h+30)+h+22);
  }dispose(rig);await new Promise(r=>setTimeout(r,0));
 }
 document.querySelector('#status').textContent='Ready: '+sex+' '+kind;
 return {width:canvas.width,height:canvas.height,reports};
};
window.renderDetails=async(mode='lit')=>{
 const entries=[['female','busty','torso'],['female','obese','torso'],['male','obese','torso'],['female','chibi',true],['male','chibi',true]];
 const w=450,h=620;canvas.width=w*5;canvas.height=(h+34)*2;
 ctx.fillStyle='#e8e7e4';ctx.fillRect(0,0,canvas.width,canvas.height);
 for(let c=0;c<entries.length;c++){
  const [sex,type,face]=entries[c],rig=figure(sex,type,mode);
  for(let r=0;r<2;r++){renderCell(rig,r*Math.PI/4,c*w,r*(h+34),w,h,face);ctx.fillStyle='#222';ctx.font='20px system-ui';ctx.fillText(sex+' '+type,c*w+10,r*(h+34)+h+26);}
  dispose(rig);
 }return reports;
};
window.renderAnimeChibi=async(mode='lit')=>{
 const w=480,h=620;canvas.width=w*6;canvas.height=(h+34)*2;
 ctx.fillStyle='#e8e7e4';ctx.fillRect(0,0,canvas.width,canvas.height);
 for(let c=0;c<6;c++){
  const sex=c<3?'female':'male',angle=[0,Math.PI/4,Math.PI/2][c%3],rig=figure(sex,'chibi',mode);
  for(let r=0;r<2;r++){
   renderCell(rig,angle,c*w,r*(h+34),w,h,r===1);
   ctx.fillStyle='#222';ctx.font='20px system-ui';ctx.fillText(sex+' anime chibi / '+mode+' / '+['front','3/4','side'][c%3],c*w+8,r*(h+34)+h+26);
  }dispose(rig);
 }return reports;
};
window.renderPoses=async(advanced=false,type='realistic',options={})=>{
 const poses=['Neutral','Contrapposto','Seated','Reach','Kneeling'],w=460,h=650;
 canvas.width=w*5;canvas.height=(h+36)*2;ctx.fillStyle='#e8e7e4';ctx.fillRect(0,0,canvas.width,canvas.height);
 for(let r=0;r<2;r++)for(let c=0;c<poses.length;c++){
  const sex=['female','male'][r],rig=figure(sex,type,'lit');
  if(advanced){
   // Register the already-morphed geometry as the deformer baseline, without invoking the old warper.
   applyBodyProportion(rig.root,sex,'heroic');
   rig.deformation={bodyType:'heroic',limitMode:'anatomical',...options};
  }
  const start=performance.now();
  setFigurePose(rig,preset(poses[c]));
  if(advanced)reports.push({sex,type,preset:poses[c],options,advancedDeformerMilliseconds:performance.now()-start});
  renderCell(rig,Math.PI/5,c*w,r*(h+36),w,h);ctx.fillStyle='#222';ctx.font='20px system-ui';ctx.fillText(sex+' '+type+' '+poses[c],c*w+12,r*(h+36)+h+26);dispose(rig);
 }return reports;
};
window.renderMotion=async()=>{
 const animation=await loader.loadAsync('${vite}/models/animations/quaternius-ual1/UAL1_Standard.glb');
 const source=animation.animations.find(c=>c.name==='Walk_Loop');
 if(!source)throw new Error('UAL1 Walk_Loop clip missing');
 const clip=createAnimationClipFromThree(animation.scene,source,{source:'builtin',fps:30,loop:true});
 const times=[0,.25,.5,.75],w=460,h=650;canvas.width=w*4;canvas.height=(h+36)*2;
 ctx.fillStyle='#e8e7e4';ctx.fillRect(0,0,canvas.width,canvas.height);
 for(let r=0;r<2;r++)for(let c=0;c<times.length;c++){
  const sex=['female','male'][r],rig=figure(sex,'realistic','lit');
  const frame=extractPoseAtFrame(clip,times[c],{body:sex,figure:rig,normalized:true});
  if(!Object.values(frame.pose).every(v=>v.every(Number.isFinite)))throw new Error('Non-finite retargeted pose');
  setFigurePose(rig,frame.pose);renderCell(rig,Math.PI/5,c*w,r*(h+36),w,h);
  ctx.fillStyle='#222';ctx.font='20px system-ui';ctx.fillText(sex+' Walk_Loop '+times[c],c*w+12,r*(h+36)+h+26);dispose(rig);
 }
 window.motionVerification={sourceClip:source.name,frames:8,mappedJoints:clip.mappedJoints.length};return window.motionVerification;
};
window.benchmarkDeformer=async()=>{
 const output=[];
 for(const sex of ['female','male'])for(const type of ['realistic','chibi']){
  const rig=figure(sex,type,'lit');applyBodyProportion(rig.root,sex,'heroic');
  rig.deformation={bodyType:'heroic',limitMode:'anatomical',enableContactAndBulge:type!=='chibi'};
  const restHeadInverse=rig.bones.head.matrixWorld.clone().invert(),times=[];
  let maximumEyeError=0,maximumBrowError=0;
  for(let i=0;i<15;i++){
   const name=['Neutral','Contrapposto','Seated','Reach','Kneeling'][i%5],start=performance.now();
   setFigurePose(rig,preset(name));const elapsed=performance.now()-start;
   if(i>=5)times.push(elapsed);
   const transform=rig.bones.head.matrixWorld.clone().multiply(restHeadInverse);
   for(const name of ['Eyes','Eyebrows']){
    const mesh=rig.skins.find(s=>s.name===name);
    for(let j=0;j<mesh.geometry.attributes.position.count;j++){
     const point=new T.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,j);
     const expected=point.clone().applyMatrix4(transform);mesh.applyBoneTransform(j,point);
     if(name==='Eyes')maximumEyeError=Math.max(maximumEyeError,point.distanceTo(expected));
     else maximumBrowError=Math.max(maximumBrowError,point.distanceTo(expected));
    }
   }
   if(!rig.skin.geometry.attributes.position.array.every(Number.isFinite))throw new Error('Advanced deformation produced non-finite vertices');
  }
  if(Math.max(maximumEyeError,maximumBrowError)>1e-5)throw new Error('Face accessories detached during advanced deformation');
  times.sort((a,b)=>a-b);output.push({sex,type,enableContactAndBulge:type!=='chibi',warmPoseMedianMilliseconds:times[Math.floor(times.length/2)],warmPoseMaximumMilliseconds:times.at(-1),maximumEyeError,maximumBrowError});
  dispose(rig);await new Promise(r=>setTimeout(r,0));
 }window.deformerBenchmarks=output;return output;
};
window.saveVerification=async(images)=>{
 const result={ready:window.verificationReady,images,binds:reports,motion:window.motionVerification,deformerBenchmarks:window.deformerBenchmarks,
  maximumBindError:Math.max(...reports.filter(r=>r.maximumBindError!==undefined).map(r=>r.maximumBindError)),
  posePresets:['Neutral','Contrapposto','Seated','Reach','Kneeling']};
 const response=await fetch('/verification-report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(result)});
 if(!response.ok)throw new Error('Could not persist browser verification: '+response.status);
 return result;
};
window.verificationReports=reports;window.verificationReady=true;
document.querySelector('#status').textContent='Ready. All rendering is isolated; original studio untouched.';
for(const sex of ['female','male'])for(const kind of ['clay','lit']){
 const b=document.createElement('button');b.textContent=sex+' '+kind;b.onclick=()=>window.renderSheet(kind,sex);document.querySelector('#buttons').append(b);
}
for(const [name,fn]of[['Details',window.renderDetails],['Poses',window.renderPoses]]){const b=document.createElement('button');b.textContent=name;b.onclick=fn;document.querySelector('#buttons').append(b);}
</script>`;
  const scratch = path.join(tmpdir(), 'pose-char-research', 'verification');
  await mkdir(scratch, { recursive: true });
  await writeFile(path.join(scratch, 'verification.html'), html);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1:5187');
      if (request.method === 'POST' && url.pathname === '/verification-report') {
        const chunks = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 256000) throw new Error('Verification report exceeds 256 KB');
          chunks.push(chunk);
        }
        const report = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (report.ready !== true || !Array.isArray(report.binds) || !Array.isArray(report.images)) throw new Error('Invalid browser verification report');
        await writeFile(path.join(scratch, 'browser-verification.json'), JSON.stringify(report, null, 2) + '\n');
        response.writeHead(204); response.end(); return;
      }
      if (url.pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end(html); return; }
      if (!url.pathname.startsWith('/models/')) { response.writeHead(404); response.end('Not found'); return; }
      const name = decodeURIComponent(url.pathname.slice(8));
      if (path.basename(name) !== name) { response.writeHead(400); response.end('Invalid asset name'); return; }
      const bytes = await readFile(path.join(OUT, name));
      response.setHeader('Content-Type', name.endsWith('.json') ? 'application/json' : name.endsWith('.png') ? 'image/png' : name.endsWith('.glb') ? 'model/gltf-binary' : 'application/octet-stream');
      response.end(bytes);
    } catch (error) {
      console.error(error); response.writeHead(500); response.end(error.message);
    }
  });
  server.listen(5187, '127.0.0.1', () => console.log(`Isolated verification: http://127.0.0.1:5187/ ; scratch ${scratch}`));
}

async function verify() {
  const header = JSON.parse(await readFile(path.join(OUT, 'archetypes.json'), 'utf8'));
  const report = JSON.parse(await readFile(path.join(OUT, 'build-report.json'), 'utf8'));
  const binary = await readFile(path.join(OUT, 'archetypes.bin'));
  assert.equal(sha(binary), header.sha256);
  assert.equal(binary.length, header.byteLength);
  assert.deepEqual(gunzipSync(await readFile(path.join(OUT, 'archetypes.bin.gz'))), binary);
  const read = (record, Type) => {
    assert(record.byteOffset >= 0 && record.byteOffset + record.byteLength <= binary.length);
    assert.equal(record.byteOffset % Type.BYTES_PER_ELEMENT, 0);
    return new Type(binary.buffer, binary.byteOffset + record.byteOffset, record.byteLength / Type.BYTES_PER_ELEMENT);
  };
  function pngPixels(texture) {
    assert.equal(texture.readUInt32BE(16), 1024); assert.equal(texture.readUInt32BE(20), 1024);
    assert.equal(texture[25], 6, 'Expected RGBA PNG');
    const idat = [];
    for (let offset = 8; offset < texture.length;) {
      const length = texture.readUInt32BE(offset), type = texture.toString('ascii', offset + 4, offset + 8);
      if (type === 'IDAT') idat.push(texture.subarray(offset + 8, offset + 8 + length));
      offset += length + 12;
    }
    return inflateSync(Buffer.concat(idat));
  }
  const results = [];
  for (const sex of SEXES) {
    const gender = header.gender[sex], bytes = await readFile(path.join(OUT, gender.glb));
    assert.equal(bytes.readUInt32LE(0), 0x46546c67);
    assert.equal(bytes.readUInt32LE(8), bytes.length);
    const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.toString('utf8', 20, 20 + jsonLength));
    const binaryStart = 20 + jsonLength + 8;
    const texture = await readFile(path.join(OUT, gender.glb.replace('.glb', '.png')));
    const imageView = gltf.bufferViews[gltf.images[0].bufferView];
    assert.deepEqual(bytes.subarray(binaryStart + imageView.byteOffset, binaryStart + imageView.byteOffset + imageView.byteLength), texture);
    const pixels = pngPixels(texture);
    let skinPixels = 0, outfitPixels = 0, antialiasedPixels = 0;
    for (let y = 0; y < 1024; y++) {
      assert.equal(pixels[y * 4097], 0);
      for (let x = 0; x < 1024; x++) {
        const i = y * 4097 + 1 + x * 4, alpha = pixels[i + 3];
        assert(pixels[i] >= 190 && pixels[i] <= 232);
        assert.equal(pixels[i], pixels[i + 1]); assert.equal(pixels[i], pixels[i + 2]);
        if (alpha === 0) skinPixels++;
        else if (alpha === 255) outfitPixels++;
        else antialiasedPixels++;
      }
    }
    assert(skinPixels > 10000 && outfitPixels > 10000 && antialiasedPixels > 100);
    const animePixels = pngPixels(await readFile(path.join(OUT, gender.archetypes.chibi.bodyTexture)));
    let cleanedFacePixels = 0;
    for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
      const i = y * 4097 + 1 + x * 4;
      assert.equal(animePixels[i + 3], pixels[i + 3], 'Chibi texture changed the outfit selector');
      assert.equal(animePixels[i], animePixels[i + 1]); assert.equal(animePixels[i], animePixels[i + 2]);
      if (animePixels[i] === 232 && pixels[i] < 232) cleanedFacePixels++;
    }
    assert(cleanedFacePixels > 1000, 'Chibi face retained realistic cavity shading');
    function attribute(index) {
      const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
      const count = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[a.type];
      const Type = a.componentType === 5126 ? Float32Array : Uint16Array;
      return new Type(bytes.buffer, bytes.byteOffset + binaryStart + view.byteOffset + (a.byteOffset || 0), a.count * count);
    }
    const meshes = gltf.meshes.map((mesh, i) => {
      const p = mesh.primitives[0];
      const info = gender.meshes[i];
      const weights = attribute(p.attributes.WEIGHTS_0), joints = attribute(p.attributes.JOINTS_0);
      for (let k = 0; k < weights.length; k += 4) {
        assert(Math.abs(weights[k] + weights[k + 1] + weights[k + 2] + weights[k + 3] - 1) < 1e-6);
        assert(joints.subarray(k, k + 4).every(j => j < header.boneNames.length));
      }
      const position = attribute(p.attributes.POSITION), normal = attribute(p.attributes.NORMAL);
      for (let k = 0; k < normal.length; k += 3) assert(Math.abs(Math.hypot(...normal.subarray(k, k + 3)) - 1) < 1e-5);
      assert.equal(position.length, info.vertexCount * 3);
      return { position, weld: read(info.weld, Uint16Array), originalCount: info.weldCount, indices: attribute(p.indices) };
    });
    const edges = new Map(), body = meshes[0];
    for (let k = 0; k < body.indices.length; k += 3) {
      const tri = [...body.indices.subarray(k, k + 3)].map(i => body.weld[i]);
      for (let j = 0; j < 3; j++) {
        const key = [tri[j], tri[(j + 1) % 3]].sort((a, b) => a - b).join('/');
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    assert([...edges.values()].every(count => count === 2), 'Subdivided body has a boundary or non-manifold edge');
    for (const type of TYPES) {
      const record = gender.archetypes[type], positions = read(record.boneLocalTranslations, Float32Array);
      const world = read(record.boneWorldTransforms, Float32Array);
      const objects = header.boneNames.map((name, i) => {
        const node = gltf.nodes.find(n => n.name === name), o = new T.Object3D();
        o.position.fromArray(positions, i * 3); o.quaternion.fromArray(node.rotation);
        return o;
      });
      header.boneNames.forEach((name, i) => {
        const nodeIndex = gltf.nodes.findIndex(n => n.name === name);
        const parentIndex = gltf.nodes.findIndex(n => n.children?.includes(nodeIndex));
        const parent = header.boneNames.indexOf(gltf.nodes[parentIndex].name);
        if (parent >= 0) objects[parent].add(objects[i]);
      });
      objects.filter(o => !o.parent).forEach(o => o.updateMatrixWorld(true));
      let maximumBoneError = 0;
      objects.forEach((o, i) => {
        const expected = v3(world.subarray(i * 7, i * 7 + 3));
        maximumBoneError = Math.max(maximumBoneError, o.getWorldPosition(new T.Vector3()).distanceTo(expected));
      });
      assert(maximumBoneError < 1e-6);
      const bone = name => objects[header.boneNames.indexOf(name)].getWorldPosition(new T.Vector3());
      for (const side of ['l', 'r']) {
        const upper = bone(`upperarm_${side}`), elbow = bone(`lowerarm_${side}`), hand = bone(`hand_${side}`);
        assert(elbow.sub(upper).normalize().distanceTo(new T.Vector3(side === 'l' ? 0.12 : -0.12, -1, 0).normalize()) < 2e-6);
        assert(hand.sub(bone(`lowerarm_${side}`)).normalize().distanceTo(new T.Vector3(0, -1, 0)) < 2e-6);
        assert(bone(`calf_${side}`).sub(bone(`thigh_${side}`)).normalize().distanceTo(new T.Vector3(0, -1, 0)) < 2e-6);
        assert(bone(`foot_${side}`).sub(bone(`calf_${side}`)).normalize().distanceTo(new T.Vector3(0, -1, 0)) < 2e-6);
      }
      const head = objects[header.boneNames.indexOf('Head')].getWorldQuaternion(new T.Quaternion());
      assert(head.angleTo(new T.Quaternion().fromArray(report.sourceRigs[sex].Head.quaternion)) < 1e-6);
      let minimumY = Infinity, maximumY = -Infinity, maximumSeamGap = 0;
      meshes.forEach((mesh, mi) => {
        const r = record.meshes[mi], delta = read(r, Int16Array), first = new Map();
        if (type === 'chibi' && mi > 0) {
          assert.equal(r.color?.componentType, 'float32');
          const color = read(r.color, Float32Array);
          assert.equal(color.length, mesh.position.length);
          assert(color.every(x => Number.isFinite(x) && x >= 0 && x <= 1));
          assert(color.some(x => x < 0.05) && color.some(x => x > 0.9), 'Missing anime pupil/lash or catchlight color range');
        }
        for (let k = 0; k < mesh.position.length / 3; k++) {
          const point = [0, 1, 2].map(j => mesh.position[k * 3 + j] + delta[k * 3 + j] * r.scale + (j === 1 ? record.floorOffsetY : 0));
          assert(point.every(Number.isFinite));
          const previous = first.get(mesh.weld[k]);
          if (previous) maximumSeamGap = Math.max(maximumSeamGap, v3(point).distanceTo(v3(previous)));
          else first.set(mesh.weld[k], point);
          if (mi === 0) { minimumY = Math.min(minimumY, point[1]); maximumY = Math.max(maximumY, point[1]); }
        }
      });
      assert.equal(maximumSeamGap, 0, 'Morph opened a UV seam');
      assert(Math.abs(minimumY) <= 1e-10, 'Quantized feet missed floor');
      const expectedHeight = type === 'chibi' ? 1.05 : sex === 'female' ? 1.75 : 1.8;
      assert(Math.abs(maximumY - minimumY - expectedHeight) < 0.00004);
      if (type === 'chibi') assert(Math.abs(report.shapes[`${sex}/${type}`].headRatio - 2.5) < 0.001);
      results.push({ sex, type, maximumBoneError, maximumSeamGap, floorError: minimumY });
    }
  }
  console.log(JSON.stringify({ passed: true, archetypes: results.length, bodyVertices: header.gender.female.meshes[0].vertexCount,
    maximumBoneError: Math.max(...results.map(r => r.maximumBoneError)), maximumFloorError: Math.max(...results.map(r => Math.abs(r.floorError))),
    maximumSeamGap: Math.max(...results.map(r => r.maximumSeamGap)), results }, null, 2));
}

if (process.argv.includes('--preview')) await preview();
else if (process.argv.includes('--verify')) await verify();
else await build();
