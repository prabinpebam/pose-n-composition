import * as T from 'three';
import { garmentFitLimit, type Garment, type Vec3 } from './model';
import type { Figure } from './rig';
import { posedSkinBindInverses } from './skinDeformer';

export interface FitTopology {
  nodes: { id: string; kind: 'edge' | 'surface' }[];
  weld: Uint32Array;
  members: number[][];
  links: Map<number, number>[];
  influence: Map<number, readonly (readonly [number, number])[]>;
}

/** Sample the authored, welded surface once so pose and fit edits never change IDs. */
export function buildFitTopology(rest: Float32Array, index: ArrayLike<number>, held: number[] = []): FitTopology {
  const weld = new Uint32Array(rest.length / 3), members: number[][] = [];
  const unique = new Map<string, number>();
  for (let i = 0; i < weld.length; i++) {
    const key = [0, 1, 2].map(d => Math.round(rest[i * 3 + d] * 100000)).join(',');
    let id = unique.get(key);
    if (id === undefined) { id = members.length; unique.set(key, id); members.push([]); }
    weld[i] = id; members[id].push(i);
  }
  const links = members.map(() => new Map<number, number>()), edges = new Map<number, number>();
  const visible = new Set<number>(), count = members.length;
  const point = (id: number) => new T.Vector3().fromArray(rest, members[id][0] * 3);
  for (let k = 0; k < index.length; k += 3) for (let s = 0; s < 3; s++) {
    const a = weld[index[k + s]], b = weld[index[k + (s + 1) % 3]];
    visible.add(a); visible.add(b);
    if (a === b) continue;
    const key = Math.min(a, b) * count + Math.max(a, b);
    edges.set(key, (edges.get(key) ?? 0) + 1);
    const length = point(a).distanceTo(point(b));
    links[a].set(b, length); links[b].set(a, length);
  }
  const boundary = new Set<number>();
  for (const [key, uses] of edges) if (uses === 1) {
    boundary.add(Math.floor(key / count)); boundary.add(key % count);
  }
  const selected = new Map<number, { id: string; kind: 'edge' | 'surface' }>();
  for (const id of held) {
    if (!visible.has(weld[id])) throw new Error(`Missing held garment vertex ${id}`);
    selected.set(weld[id], { id: String(id), kind: 'edge' });
  }
  function sample(candidates: number[], kind: 'edge' | 'surface', spacing: number, cap: number) {
    const distance = new Map(candidates.map(id => [id, Infinity]));
    const update = (chosen: number) => {
      const p = point(chosen);
      for (const id of candidates) distance.set(id, Math.min(distance.get(id)!, p.distanceToSquared(point(id))));
    };
    for (const [id, node] of selected) if (kind === 'edge' || node.kind === 'surface') update(id);
    if (kind === 'surface' && candidates.length) {
      const back = candidates.reduce((a, b) => point(a).z < point(b).z ? a : b);
      selected.set(back, { id: String(members[back][0]), kind }); update(back);
    }
    for (let n = kind === 'surface' && candidates.length ? 1 : 0; n < cap; n++) {
      let best = -1, farthest = spacing * spacing;
      for (const id of candidates) if (!selected.has(id) && distance.get(id)! > farthest) {
        best = id; farthest = distance.get(id)!;
      }
      if (best < 0) break;
      selected.set(best, { id: String(members[best][0]), kind }); update(best);
    }
  }
  sample([...boundary], 'edge', .105, 48);
  sample([...visible].filter(id => !boundary.has(id)), 'surface', .13, 32);
  return { nodes: [...selected.values()], weld, members, links, influence: new Map() };
}

function influences(topology: FitTopology, vertex: number, radius: number) {
  const cached = topology.influence.get(vertex);
  if (cached) return cached;
  const start = topology.weld[vertex], distance = new Map([[start, 0]]), queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const id = queue[k], d = distance.get(id)!;
    for (const [next, length] of topology.links[id]) {
      const total = d + length;
      if (total >= radius || total >= (distance.get(next) ?? Infinity)) continue;
      distance.set(next, total); queue.push(next);
    }
  }
  const result = [...distance].map(([id, d]) => [id, (1 - d / radius) ** 2] as const);
  topology.influence.set(vertex, result);
  return result;
}

export function fitNodeId(topology: FitTopology, node: string): number {
  if (!/^(0|[1-9]\d*)$/.test(node) || !topology.nodes.some(n => n.id === node)) {
    throw new Error(`Unknown garment fit node ${node}`);
  }
  return Number(node);
}

export function clampFitOffset(id: Garment, offset: T.Vector3): T.Vector3 {
  if (![offset.x, offset.y, offset.z].every(Number.isFinite)) throw new Error('Invalid garment fit target');
  return offset.clampLength(0, garmentFitLimit(id));
}

/** Skin-local rotations exclude root transforms and retain the posed donor frame. */
export function fitFrames(figure: Figure, binds: Uint16Array, vertices: number[]): T.Quaternion[] {
  const skin = figure.skin;
  skin.updateWorldMatrix(true, false);
  const inverse = skin.matrixWorld.clone().invert(), matrix = new T.Matrix4();
  const bindInverses = posedSkinBindInverses(figure);
  const rotations = skin.skeleton.bones.map((bone, i) => {
    bone.updateWorldMatrix(true, false);
    matrix.copy(inverse).multiply(bone.matrixWorld).multiply(bindInverses[i]).multiply(skin.bindMatrix);
    return new T.Quaternion().setFromRotationMatrix(new T.Matrix4().extractRotation(matrix));
  });
  const joints = skin.geometry.getAttribute('skinIndex'), weights = skin.geometry.getAttribute('skinWeight');
  const frames: T.Quaternion[] = [];
  for (const i of vertices) {
    const sum = new T.Quaternion(0, 0, 0, 0);
    let reference: T.Quaternion | undefined;
    for (let k = 0; k < 4; k++) {
      const donor = binds[i * 9 + k], w = binds[i * 9 + k + 4] / 65535;
      if (!w) continue;
      for (let j = 0; j < 4; j++) {
        const q = rotations[joints.getComponent(donor, j)], weight = w * weights.getComponent(donor, j);
        if (!weight) continue;
        reference ??= q;
        const sign = reference.dot(q) < 0 ? -1 : 1;
        sum.x += q.x * weight * sign; sum.y += q.y * weight * sign;
        sum.z += q.z * weight * sign; sum.w += q.w * weight * sign;
      }
    }
    if (sum.lengthSq() < 1e-12) throw new Error(`Missing garment donor frame ${i}`);
    frames[i] = sum.normalize();
  }
  return frames;
}

export function applyGarmentFit(
  id: Garment, topology: FitTopology, authored: Float32Array, frames: T.Quaternion[],
  fit: Record<string, Vec3> | undefined, result: Float32Array, travel: Float32Array,
): void {
  result.set(authored);
  const entries = Object.entries(fit ?? {}).sort(([a], [b]) => Number(a) - Number(b));
  if (!entries.length) return;
  const deltas = new Float64Array(result.length), sums = new Float64Array(topology.members.length);
  const edited = new Map<number, T.Vector3>();
  for (const [node, value] of entries) {
    const vertex = fitNodeId(topology, node);
    const delta = clampFitOffset(id, new T.Vector3(...value)).applyQuaternion(frames[vertex]);
    edited.set(topology.weld[vertex], delta);
    for (const [weld, weight] of influences(topology, vertex, .18)) {
      sums[weld] += weight;
      for (const member of topology.members[weld]) {
        deltas[member * 3] += delta.x * weight;
        deltas[member * 3 + 1] += delta.y * weight;
        deltas[member * 3 + 2] += delta.z * weight;
      }
    }
  }
  for (let i = 0; i < travel.length; i++) {
    const weld = topology.weld[i], delta = edited.get(weld), divisor = Math.max(1, sums[weld]);
    for (let d = 0; d < 3; d++) result[i * 3 + d] += delta ? delta.getComponent(d) : deltas[i * 3 + d] / divisor;
    if (delta) travel[i] = 0;
  }
}
