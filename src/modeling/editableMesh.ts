import * as THREE from 'three';
import type {
  ComponentElementType,
  ComponentSelection,
  EditableMeshData,
  GizmoFrame,
  MeshAdjacency,
  MeshEdge,
  MeshFace,
  MeshOperationResult,
  Vec2,
  Vec3,
} from './types';

const EPS = 1e-7;

export function cloneEditableMesh(mesh: EditableMeshData): EditableMeshData {
  return {
    vertices: mesh.vertices.map((v) => [v[0], v[1], v[2]] as Vec3),
    faces: mesh.faces.map((f) => ({
      verts: [...f.verts],
      ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
      ...(f.uvs ? { uvs: f.uvs.map((uv) => [uv[0], uv[1]] as Vec2) } : {}),
    })),
    ...(mesh.phongAngleDeg !== undefined ? { phongAngleDeg: mesh.phongAngleDeg } : {}),
  };
}

export function createEmptySelection(mode: ComponentElementType = 'polygon'): ComponentSelection {
  return { mode, vertices: [], edges: [], faces: [] };
}

export function canonicalEdgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function add3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function lerp3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross3(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function len3(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

function dist3(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

function normalize3(a: Vec3, fallback: Vec3 = [0, 1, 0]): Vec3 {
  const l = len3(a);
  return l > EPS ? [a[0] / l, a[1] / l, a[2] / l] : [...fallback] as Vec3;
}

/** Newell's method for robust polygon normal calculation on triangles, quads, and n-gons. */
export function computeFaceNormal(vertices: readonly Vec3[], faceVerts: readonly number[]): Vec3 {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const n = faceVerts.length;
  for (let i = 0; i < n; i++) {
    const curr = vertices[faceVerts[i]];
    const next = vertices[faceVerts[(i + 1) % n]];
    if (!curr || !next) continue;
    nx += (curr[1] - next[1]) * (curr[2] + next[2]);
    ny += (curr[2] - next[2]) * (curr[0] + next[0]);
    nz += (curr[0] - next[0]) * (curr[1] + next[1]);
  }
  return normalize3([nx, ny, nz], [0, 1, 0]);
}

export function computeFaceCenter(vertices: readonly Vec3[], faceVerts: readonly number[]): Vec3 {
  if (faceVerts.length === 0) return [0, 0, 0];
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const vi of faceVerts) {
    const v = vertices[vi];
    if (!v) continue;
    sx += v[0];
    sy += v[1];
    sz += v[2];
  }
  const inv = 1 / faceVerts.length;
  return [sx * inv, sy * inv, sz * inv];
}

/** Sanitizes faces (removing consecutive duplicates & <3-vert faces) and drops orphaned vertices. */
export function compactEditableMesh(mesh: EditableMeshData): EditableMeshData {
  const cleanFaces: MeshFace[] = [];
  for (const face of mesh.faces) {
    const verts: number[] = [];
    const uvs: Vec2[] = [];
    const hasUvs = Boolean(face.uvs && face.uvs.length === face.verts.length);
    for (let i = 0; i < face.verts.length; i++) {
      const curr = face.verts[i];
      const prev = verts.length > 0 ? verts[verts.length - 1] : -1;
      if (curr !== prev && curr >= 0 && curr < mesh.vertices.length) {
        verts.push(curr);
        if (hasUvs) uvs.push([face.uvs![i][0], face.uvs![i][1]]);
      }
    }
    while (verts.length >= 2 && verts[0] === verts[verts.length - 1]) {
      verts.pop();
      if (hasUvs) uvs.pop();
    }
    if (verts.length >= 3 && new Set(verts).size >= 3) {
      cleanFaces.push({
        verts,
        ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
        ...(hasUvs ? { uvs } : {}),
      });
    }
  }

  const oldToNew = new Int32Array(mesh.vertices.length).fill(-1);
  const newVertices: Vec3[] = [];
  for (const f of cleanFaces) {
    for (let i = 0; i < f.verts.length; i++) {
      const oldIdx = f.verts[i];
      let mapped = oldToNew[oldIdx];
      if (mapped === -1) {
        mapped = newVertices.length;
        oldToNew[oldIdx] = mapped;
        const v = mesh.vertices[oldIdx];
        newVertices.push([v[0], v[1], v[2]]);
      }
      f.verts[i] = mapped;
    }
  }

  return {
    vertices: newVertices,
    faces: cleanFaces,
    ...(mesh.phongAngleDeg !== undefined ? { phongAngleDeg: mesh.phongAngleDeg } : {}),
  };
}

export function buildHalfEdgeOrAdjacency(mesh: EditableMeshData): MeshAdjacency {
  const edges: MeshEdge[] = [];
  const edgeKeyToIndex = new Map<string, number>();
  const vertexEdges: number[][] = Array.from({ length: mesh.vertices.length }, () => []);
  const vertexFaces: number[][] = Array.from({ length: mesh.vertices.length }, () => []);
  const faceEdges: number[][] = [];
  const faceNormals: Vec3[] = [];
  const vertexNormalsAccum: Vec3[] = Array.from({ length: mesh.vertices.length }, () => [0, 0, 0]);

  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    const n = face.verts.length;
    const fn = computeFaceNormal(mesh.vertices, face.verts);
    faceNormals.push(fn);

    const fEdges: number[] = [];
    for (let i = 0; i < n; i++) {
      const u = face.verts[i];
      const v = face.verts[(i + 1) % n];
      if (vertexFaces[u] && !vertexFaces[u].includes(fi)) {
        vertexFaces[u].push(fi);
      }
      if (vertexNormalsAccum[u]) {
        vertexNormalsAccum[u] = add3(vertexNormalsAccum[u], fn);
      }
      const key = canonicalEdgeKey(u, v);
      let ei = edgeKeyToIndex.get(key);
      if (ei === undefined) {
        ei = edges.length;
        edgeKeyToIndex.set(key, ei);
        const a = Math.min(u, v);
        const b = Math.max(u, v);
        edges.push({ index: ei, a, b, faces: [fi], isBoundary: true });
        if (vertexEdges[a]) vertexEdges[a].push(ei);
        if (vertexEdges[b]) vertexEdges[b].push(ei);
      } else {
        const edge = edges[ei];
        if (!edge.faces.includes(fi)) {
          edge.faces.push(fi);
        }
        edge.isBoundary = edge.faces.length < 2;
      }
      fEdges.push(ei);
    }
    faceEdges.push(fEdges);
  }

  for (const edge of edges) {
    edge.isBoundary = edge.faces.length < 2;
  }

  const vertexNormals: Vec3[] = vertexNormalsAccum.map((acc) => normalize3(acc, [0, 1, 0]));

  return {
    edges,
    edgeKeyToIndex,
    vertexEdges,
    vertexFaces,
    faceEdges,
    faceNormals,
    vertexNormals,
  };
}

function buildOrthonormalBasis(normal: Vec3): { tangent: Vec3; bitangent: Vec3 } {
  const up: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const tangent = normalize3(cross3(up, normal), [1, 0, 0]);
  const bitangent = normalize3(cross3(normal, tangent), [0, 0, 1]);
  return { tangent, bitangent };
}

/** Triangulates an arbitrary polygon (convex or concave n-gon) into local index triples. */
function triangulateFaceIndices(vertices: readonly Vec3[], faceVerts: readonly number[], normal: Vec3): [number, number, number][] {
  const n = faceVerts.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];
  if (n === 4) {
    const p0 = vertices[faceVerts[0]];
    const p1 = vertices[faceVerts[1]];
    const p2 = vertices[faceVerts[2]];
    const p3 = vertices[faceVerts[3]];
    const c0 = dot3(cross3(sub3(p1, p0), sub3(p2, p1)), normal);
    const c2 = dot3(cross3(sub3(p3, p2), sub3(p0, p3)), normal);
    if (c0 < 0 || c2 < 0) {
      return [[1, 2, 3], [1, 3, 0]];
    }
    const d02 = dist3(p0, p2);
    const d13 = dist3(p1, p3);
    return d02 <= d13 ? [[0, 1, 2], [0, 2, 3]] : [[0, 1, 3], [1, 2, 3]];
  }

  // Ear clipping in projected 2D plane for n-gons >= 5
  const { tangent, bitangent } = buildOrthonormalBasis(normal);
  const pts2d: Vec2[] = faceVerts.map((vi) => {
    const p = vertices[vi];
    return [dot3(p, tangent), dot3(p, bitangent)];
  });

  const remaining = Array.from({ length: n }, (_, i) => i);
  const tris: [number, number, number][] = [];

  const cross2d = (a: Vec2, b: Vec2, c: Vec2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  const pointInTri2d = (p: Vec2, a: Vec2, b: Vec2, c: Vec2) => {
    const d1 = cross2d(a, b, p);
    const d2 = cross2d(b, c, p);
    const d3 = cross2d(c, a, p);
    return d1 >= -EPS && d2 >= -EPS && d3 >= -EPS;
  };

  let guard = 0;
  while (remaining.length > 3 && guard < n * n + 8) {
    guard++;
    let earFound = false;
    const m = remaining.length;
    for (let i = 0; i < m; i++) {
      const iPrev = remaining[(i - 1 + m) % m];
      const iCurr = remaining[i];
      const iNext = remaining[(i + 1) % m];
      const a = pts2d[iPrev];
      const b = pts2d[iCurr];
      const c = pts2d[iNext];
      if (cross2d(a, b, c) <= EPS) continue;

      let containsOther = false;
      for (let j = 0; j < m; j++) {
        const idx = remaining[j];
        if (idx === iPrev || idx === iCurr || idx === iNext) continue;
        if (pointInTri2d(pts2d[idx], a, b, c)) {
          containsOther = true;
          break;
        }
      }
      if (!containsOther) {
        tris.push([iPrev, iCurr, iNext]);
        remaining.splice(i, 1);
        earFound = true;
        break;
      }
    }
    if (!earFound) {
      // Fallback fan if polygon is self-touching or nearly degenerate
      for (let i = 1; i < remaining.length - 1; i++) {
        tris.push([remaining[0], remaining[i], remaining[i + 1]]);
      }
      return tris;
    }
  }
  if (remaining.length === 3) {
    tris.push([remaining[0], remaining[1], remaining[2]]);
  }
  return tris;
}

function computeBoxUv(pos: Vec3, normal: Vec3): Vec2 {
  const ax = Math.abs(normal[0]);
  const ay = Math.abs(normal[1]);
  const az = Math.abs(normal[2]);
  if (ay >= ax && ay >= az) return [pos[0] * 0.5 + 0.5, pos[2] * 0.5 + 0.5];
  if (ax >= ay && ax >= az) return [pos[2] * 0.5 + 0.5, pos[1] * 0.5 + 0.5];
  return [pos[0] * 0.5 + 0.5, pos[1] * 0.5 + 0.5];
}

/**
 * Converts `EditableMeshData` to a renderable `THREE.BufferGeometry` with optional
 * Cinema 4D Phong crease angle shading (`phongAngleDeg`, default 40°).
 */
export function editableMeshToBufferGeometry(
  mesh: EditableMeshData,
  options?: { phongAngleDeg?: number },
): THREE.BufferGeometry {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const phongDeg = options?.phongAngleDeg ?? mesh.phongAngleDeg ?? 40;
  const cosThreshold = phongDeg <= 0 ? 2 : Math.cos((phongDeg * Math.PI) / 180);

  // Group triangles by materialIndex so multi-material meshes preserve groups
  interface TriBucket {
    materialIndex: number;
    positions: number[];
    normals: number[];
    uvs: number[];
    faceMap: number[];
  }
  const buckets = new Map<number, TriBucket>();

  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    if (face.verts.length < 3) continue;
    const fn = adj.faceNormals[fi];
    const matIdx = face.materialIndex ?? 0;
    let bucket = buckets.get(matIdx);
    if (!bucket) {
      bucket = { materialIndex: matIdx, positions: [], normals: [], uvs: [], faceMap: [] };
      buckets.set(matIdx, bucket);
    }

    // Compute per-corner Phong-smoothed normals
    const cornerNormals: Vec3[] = face.verts.map((vi) => {
      if (phongDeg <= 0) return fn;
      const incident = adj.vertexFaces[vi] ?? [];
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const otherFi of incident) {
        const otherFn = adj.faceNormals[otherFi];
        if (otherFi === fi || dot3(fn, otherFn) >= cosThreshold - 1e-6) {
          sx += otherFn[0];
          sy += otherFn[1];
          sz += otherFn[2];
        }
      }
      return normalize3([sx, sy, sz], fn);
    });

    const localTris = triangulateFaceIndices(mesh.vertices, face.verts, fn);
    const hasFaceUvs = Boolean(face.uvs && face.uvs.length === face.verts.length);

    for (const [i0, i1, i2] of localTris) {
      for (const li of [i0, i1, i2]) {
        const vi = face.verts[li];
        const pos = mesh.vertices[vi];
        const nrm = cornerNormals[li];
        const uv = hasFaceUvs ? face.uvs![li] : computeBoxUv(pos, fn);
        bucket.positions.push(pos[0], pos[1], pos[2]);
        bucket.normals.push(nrm[0], nrm[1], nrm[2]);
        bucket.uvs.push(uv[0], uv[1]);
      }
      bucket.faceMap.push(fi);
    }
  }

  const sortedBuckets = [...buckets.values()].sort((a, b) => a.materialIndex - b.materialIndex);
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const triToFaceIndex: number[] = [];

  const geometry = new THREE.BufferGeometry();
  let vertexCursor = 0;
  for (const bucket of sortedBuckets) {
    const count = bucket.positions.length / 3;
    if (sortedBuckets.length > 1 || bucket.materialIndex !== 0) {
      geometry.addGroup(vertexCursor, count, bucket.materialIndex);
    }
    for (let i = 0; i < bucket.positions.length; i++) positions.push(bucket.positions[i]);
    for (let i = 0; i < bucket.normals.length; i++) normals.push(bucket.normals[i]);
    for (let i = 0; i < bucket.uvs.length; i++) uvs.push(bucket.uvs[i]);
    for (let i = 0; i < bucket.faceMap.length; i++) triToFaceIndex.push(bucket.faceMap[i]);
    vertexCursor += count;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.userData.triToFaceIndex = triToFaceIndex;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

/**
 * Generates a `LineSegments` wireframe `BufferGeometry` containing ONLY true
 * quad/polygon edges (suppressing internal triangulation diagonals).
 */
export function createQuadWireframeGeometry(mesh: EditableMeshData): THREE.BufferGeometry {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const positions = new Float32Array(adj.edges.length * 6);
  const edgeIndexMap = new Int32Array(adj.edges.length);

  for (let i = 0; i < adj.edges.length; i++) {
    const edge = adj.edges[i];
    const pa = mesh.vertices[edge.a];
    const pb = mesh.vertices[edge.b];
    const base = i * 6;
    positions[base] = pa[0];
    positions[base + 1] = pa[1];
    positions[base + 2] = pa[2];
    positions[base + 3] = pb[0];
    positions[base + 4] = pb[1];
    positions[base + 5] = pb[2];
    edgeIndexMap[i] = edge.index;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.userData.edgeIndexMap = edgeIndexMap;
  geo.computeBoundingSphere();
  return geo;
}

/**
 * Converts any `THREE.BufferGeometry` (Parametric, CSG Boolean, or Imported 3D mesh)
 * into a clean `EditableMeshData` ("Make Editable"), welding coincident vertices and
 * merging coplanar diagonal-sharing triangle pairs back into clean convex quads.
 */
export function bufferGeometryToEditableMesh(
  geometry: THREE.BufferGeometry,
  options?: {
    weldTolerance?: number;
    mergeCoplanarQuads?: boolean;
    coplanarAngleDeg?: number;
  },
): EditableMeshData {
  const posAttr = geometry.getAttribute('position');
  if (!posAttr || posAttr.count < 3) {
    return { vertices: [], faces: [] };
  }

  const weldTol = Math.max(1e-8, options?.weldTolerance ?? 1e-5);
  const invTol = 1 / weldTol;
  const mergeQuads = options?.mergeCoplanarQuads ?? true;
  const cosCoplanar = Math.cos(((options?.coplanarAngleDeg ?? 1.5) * Math.PI) / 180);

  const uvAttr = geometry.getAttribute('uv');
  const indexAttr = geometry.getIndex();

  const vertices: Vec3[] = [];
  const spatialMap = new Map<string, number[]>();

  const getOrAddVertex = (x: number, y: number, z: number): number => {
    const gx = Math.round(x * invTol);
    const gy = Math.round(y * invTol);
    const gz = Math.round(z * invTol);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = spatialMap.get(`${gx + dx}_${gy + dy}_${gz + dz}`);
          if (!bucket) continue;
          for (const candidate of bucket) {
            const cv = vertices[candidate];
            if (
              Math.abs(cv[0] - x) <= weldTol &&
              Math.abs(cv[1] - y) <= weldTol &&
              Math.abs(cv[2] - z) <= weldTol
            ) {
              return candidate;
            }
          }
        }
      }
    }
    const idx = vertices.length;
    vertices.push([x, y, z]);
    const key = `${gx}_${gy}_${gz}`;
    let bucket = spatialMap.get(key);
    if (!bucket) {
      bucket = [];
      spatialMap.set(key, bucket);
    }
    bucket.push(idx);
    return idx;
  };

  interface RawTri {
    verts: [number, number, number];
    uvs?: [Vec2, Vec2, Vec2];
    materialIndex: number;
    normal: Vec3;
  }

  const groups = geometry.groups.length > 0
    ? geometry.groups
    : [{ start: 0, count: indexAttr ? indexAttr.count : posAttr.count, materialIndex: 0 }];

  const tris: RawTri[] = [];
  for (const grp of groups) {
    const matIdx = grp.materialIndex ?? 0;
    const end = grp.start + grp.count;
    for (let i = grp.start; i + 2 < end; i += 3) {
      const ia = indexAttr ? indexAttr.getX(i) : i;
      const ib = indexAttr ? indexAttr.getX(i + 1) : i + 1;
      const ic = indexAttr ? indexAttr.getX(i + 2) : i + 2;

      const va = getOrAddVertex(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia));
      const vb = getOrAddVertex(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib));
      const vc = getOrAddVertex(posAttr.getX(ic), posAttr.getY(ic), posAttr.getZ(ic));
      if (va === vb || vb === vc || vc === va) continue;

      const normal = computeFaceNormal(vertices, [va, vb, vc]);
      if (len3(cross3(sub3(vertices[vb], vertices[va]), sub3(vertices[vc], vertices[va]))) <= 1e-11) {
        continue;
      }

      const triUvs: [Vec2, Vec2, Vec2] | undefined = uvAttr
        ? [
            [uvAttr.getX(ia), uvAttr.getY(ia)],
            [uvAttr.getX(ib), uvAttr.getY(ib)],
            [uvAttr.getX(ic), uvAttr.getY(ic)],
          ]
        : undefined;

      tris.push({ verts: [va, vb, vc], uvs: triUvs, materialIndex: matIdx, normal });
    }
  }

  if (!mergeQuads || tris.length < 2) {
    return compactEditableMesh({
      vertices,
      faces: tris.map((t) => ({
        verts: [...t.verts],
        ...(t.materialIndex !== 0 ? { materialIndex: t.materialIndex } : {}),
        ...(t.uvs ? { uvs: [...t.uvs] } : {}),
      })),
    });
  }

  // Pair coplanar triangles sharing their longest interior diagonal into clean convex quads
  interface CandidatePair {
    t1: number;
    t2: number;
    diagLenSq: number;
    quadVerts: [number, number, number, number];
    quadUvs?: [Vec2, Vec2, Vec2, Vec2];
  }

  const edgeToTris = new Map<string, { triIdx: number; localEdge: number }[]>();
  for (let ti = 0; ti < tris.length; ti++) {
    const tv = tris[ti].verts;
    for (let e = 0; e < 3; e++) {
      const key = canonicalEdgeKey(tv[e], tv[(e + 1) % 3]);
      let list = edgeToTris.get(key);
      if (!list) {
        list = [];
        edgeToTris.set(key, list);
      }
      list.push({ triIdx: ti, localEdge: e });
    }
  }

  const candidates: CandidatePair[] = [];
  for (const sharers of edgeToTris.values()) {
    if (sharers.length !== 2) continue;
    const { triIdx: t1, localEdge: e1 } = sharers[0];
    const { triIdx: t2, localEdge: e2 } = sharers[1];
    const triA = tris[t1];
    const triB = tris[t2];
    if (triA.materialIndex !== triB.materialIndex) continue;
    if (dot3(triA.normal, triB.normal) < cosCoplanar) continue;

    // Require opposite winding on shared edge so normals point to the same side
    const uA = triA.verts[e1];
    const vA = triA.verts[(e1 + 1) % 3];
    const uB = triB.verts[e2];
    const vB = triB.verts[(e2 + 1) % 3];
    if (!(uA === vB && vA === uB)) continue;

    const oppA = (e1 + 2) % 3;
    const oppB = (e2 + 2) % 3;
    const qVerts: [number, number, number, number] = [
      triA.verts[oppA],
      uA,
      triB.verts[oppB],
      vA,
    ];

    // Check strict convexity of the candidate quad
    let convex = true;
    for (let k = 0; k < 4; k++) {
      const pPrev = vertices[qVerts[(k + 3) % 4]];
      const pCurr = vertices[qVerts[k]];
      const pNext = vertices[qVerts[(k + 1) % 4]];
      const turn = dot3(cross3(sub3(pCurr, pPrev), sub3(pNext, pCurr)), triA.normal);
      if (turn <= 1e-8) {
        convex = false;
        break;
      }
    }
    if (!convex) continue;

    const dVec = sub3(vertices[uA], vertices[vA]);
    const diagLenSq = dot3(dVec, dVec);
    const qUvs: [Vec2, Vec2, Vec2, Vec2] | undefined =
      triA.uvs && triB.uvs
        ? [
            triA.uvs[oppA],
            triA.uvs[e1],
            triB.uvs[oppB],
            triA.uvs[(e1 + 1) % 3],
          ]
        : undefined;

    candidates.push({ t1, t2, diagLenSq, quadVerts: qVerts, quadUvs: qUvs });
  }

  candidates.sort((a, b) => b.diagLenSq - a.diagLenSq);
  const usedTri = new Uint8Array(tris.length);
  const faces: MeshFace[] = [];

  for (const cand of candidates) {
    if (usedTri[cand.t1] || usedTri[cand.t2]) continue;
    usedTri[cand.t1] = 1;
    usedTri[cand.t2] = 1;
    const matIdx = tris[cand.t1].materialIndex;
    faces.push({
      verts: [...cand.quadVerts],
      ...(matIdx !== 0 ? { materialIndex: matIdx } : {}),
      ...(cand.quadUvs ? { uvs: cand.quadUvs.map((uv) => [uv[0], uv[1]] as Vec2) } : {}),
    });
  }

  for (let ti = 0; ti < tris.length; ti++) {
    if (usedTri[ti]) continue;
    const t = tris[ti];
    faces.push({
      verts: [...t.verts],
      ...(t.materialIndex !== 0 ? { materialIndex: t.materialIndex } : {}),
      ...(t.uvs ? { uvs: t.uvs.map((uv) => [uv[0], uv[1]] as Vec2) } : {}),
    });
  }

  return compactEditableMesh({ vertices, faces });
}

// ============================================================================
// SELECTION OPERATIONS
// ============================================================================

/** Selects a topological valence-4 quad edge loop (or open boundary edge loop). */
export function selectEdgeLoop(mesh: EditableMeshData, edgeIndex: number): number[] {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  if (edgeIndex < 0 || edgeIndex >= adj.edges.length) return [];

  const visited = new Set<number>([edgeIndex]);
  const startEdge = adj.edges[edgeIndex];

  const stepFrom = (currEdgeIdx: number, vertexIdx: number): number | null => {
    const currEdge = adj.edges[currEdgeIdx];
    const incEdges = adj.vertexEdges[vertexIdx];
    if (!incEdges) return null;

    if (currEdge.isBoundary) {
      const boundaryNeighbors = incEdges.filter(
        (ei) => ei !== currEdgeIdx && adj.edges[ei].isBoundary,
      );
      return boundaryNeighbors.length === 1 ? boundaryNeighbors[0] : null;
    }

    // Standard interior valence-4 topological loop continuation:
    // pick the unique incident edge at vertexIdx that shares NO face with currEdge
    const incFaces = adj.vertexFaces[vertexIdx];
    if (incEdges.length !== 4 || !incFaces || incFaces.length !== 4) {
      return null;
    }
    const currFaces = new Set(currEdge.faces);
    const candidates = incEdges.filter((ei) => {
      if (ei === currEdgeIdx) return false;
      return !adj.edges[ei].faces.some((fi) => currFaces.has(fi));
    });
    return candidates.length === 1 ? candidates[0] : null;
  };

  for (const startVert of [startEdge.a, startEdge.b]) {
    let currE = edgeIndex;
    let currV = startVert;
    while (true) {
      const nextE = stepFrom(currE, currV);
      if (nextE === null || visited.has(nextE)) break;
      visited.add(nextE);
      const eObj = adj.edges[nextE];
      currV = eObj.a === currV ? eObj.b : eObj.a;
      currE = nextE;
    }
  }

  return [...visited].sort((a, b) => a - b);
}

interface DirectedRingEntry {
  edgeIndex: number;
  u: number;
  v: number;
}

/** Traces an ordered quad ring with consistent edge orientation `(u -> v)`. */
function traceDirectedEdgeRing(
  mesh: EditableMeshData,
  adj: MeshAdjacency,
  edgeIndex: number,
): DirectedRingEntry[] {
  if (edgeIndex < 0 || edgeIndex >= adj.edges.length) return [];
  const startEdge = adj.edges[edgeIndex];
  const visitedEdges = new Set<number>([edgeIndex]);

  const walk = (initialFaceIdx: number, startU: number, startV: number): DirectedRingEntry[] => {
    const chain: DirectedRingEntry[] = [];
    let fi = initialFaceIdx;
    let u = startU;
    let v = startV;

    while (fi >= 0) {
      const face = mesh.faces[fi];
      if (!face || face.verts.length !== 4) break;
      // Locate u and v as adjacent vertices in this quad
      let idxU = -1;
      let idxV = -1;
      for (let k = 0; k < 4; k++) {
        if (face.verts[k] === u && face.verts[(k + 1) % 4] === v) {
          idxU = k;
          idxV = (k + 1) % 4;
          break;
        }
        if (face.verts[k] === v && face.verts[(k + 1) % 4] === u) {
          idxV = k;
          idxU = (k + 1) % 4;
          break;
        }
      }
      if (idxU === -1 || idxV === -1) break;

      // Opposite edge preserving parallel direction:
      // If face is [u, v, c, d] (idxU=0, idxV=1), parallel to u->v is d->c (idx 3 -> idx 2)
      let nextU: number;
      let nextV: number;
      if ((idxU + 1) % 4 === idxV) {
        nextU = face.verts[(idxU + 3) % 4];
        nextV = face.verts[(idxU + 2) % 4];
      } else {
        nextV = face.verts[(idxV + 3) % 4];
        nextU = face.verts[(idxV + 2) % 4];
      }

      const oppEdgeIdx = adj.edgeKeyToIndex.get(canonicalEdgeKey(nextU, nextV));
      if (oppEdgeIdx === undefined || visitedEdges.has(oppEdgeIdx)) break;
      visitedEdges.add(oppEdgeIdx);
      chain.push({ edgeIndex: oppEdgeIdx, u: nextU, v: nextV });

      const oppEdge = adj.edges[oppEdgeIdx];
      const nextFace = oppEdge.faces.find((f) => f !== fi);
      if (nextFace === undefined) break;
      fi = nextFace;
      u = nextU;
      v = nextV;
    }
    return chain;
  };

  const forward =
    startEdge.faces.length >= 1 ? walk(startEdge.faces[0], startEdge.a, startEdge.b) : [];
  const backward =
    startEdge.faces.length >= 2 ? walk(startEdge.faces[1], startEdge.a, startEdge.b) : [];

  return [
    ...backward.reverse(),
    { edgeIndex, u: startEdge.a, v: startEdge.b },
    ...forward,
  ];
}

/** Selects a parallel quad edge ring across quad strips. */
export function selectEdgeRing(mesh: EditableMeshData, edgeIndex: number): number[] {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  return traceDirectedEdgeRing(mesh, adj, edgeIndex)
    .map((r) => r.edgeIndex)
    .sort((a, b) => a - b);
}

/** Selects the entire topologically connected mesh island containing `index`. */
export function selectConnectedComponent(
  mesh: EditableMeshData,
  elementType: ComponentElementType,
  index: number,
): ComponentSelection {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const visitedVerts = new Set<number>();
  const queue: number[] = [];

  if (elementType === 'point') {
    if (index >= 0 && index < mesh.vertices.length) queue.push(index);
  } else if (elementType === 'edge') {
    const e = adj.edges[index];
    if (e) queue.push(e.a, e.b);
  } else {
    const f = mesh.faces[index];
    if (f) queue.push(...f.verts);
  }

  for (const v of queue) visitedVerts.add(v);
  let head = 0;
  while (head < queue.length) {
    const v = queue[head++];
    for (const ei of adj.vertexEdges[v] ?? []) {
      const e = adj.edges[ei];
      const other = e.a === v ? e.b : e.a;
      if (!visitedVerts.has(other)) {
        visitedVerts.add(other);
        queue.push(other);
      }
    }
  }

  const vertices = [...visitedVerts].sort((a, b) => a - b);
  const edges = adj.edges
    .filter((e) => visitedVerts.has(e.a) && visitedVerts.has(e.b))
    .map((e) => e.index);
  const faces: number[] = [];
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    if (mesh.faces[fi].verts.some((v) => visitedVerts.has(v))) {
      faces.push(fi);
    }
  }

  return { mode: elementType, vertices, edges, faces };
}

export function growSelection(mesh: EditableMeshData, selection: ComponentSelection): ComponentSelection {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  if (selection.mode === 'point') {
    const next = new Set<number>(selection.vertices);
    for (const v of selection.vertices) {
      for (const ei of adj.vertexEdges[v] ?? []) {
        const e = adj.edges[ei];
        next.add(e.a);
        next.add(e.b);
      }
    }
    return { ...selection, vertices: [...next].sort((a, b) => a - b) };
  }
  if (selection.mode === 'edge') {
    const verts = new Set<number>();
    for (const ei of selection.edges) {
      const e = adj.edges[ei];
      if (e) {
        verts.add(e.a);
        verts.add(e.b);
      }
    }
    const next = new Set<number>(selection.edges);
    for (const v of verts) {
      for (const ei of adj.vertexEdges[v] ?? []) next.add(ei);
    }
    return { ...selection, edges: [...next].sort((a, b) => a - b) };
  }
  const verts = new Set<number>();
  for (const fi of selection.faces) {
    const f = mesh.faces[fi];
    if (f) for (const v of f.verts) verts.add(v);
  }
  const next = new Set<number>(selection.faces);
  for (const v of verts) {
    for (const fi of adj.vertexFaces[v] ?? []) next.add(fi);
  }
  return { ...selection, faces: [...next].sort((a, b) => a - b) };
}

export function shrinkSelection(mesh: EditableMeshData, selection: ComponentSelection): ComponentSelection {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  if (selection.mode === 'point') {
    const sel = new Set(selection.vertices);
    const kept = selection.vertices.filter((v) =>
      (adj.vertexEdges[v] ?? []).every((ei) => {
        const e = adj.edges[ei];
        return sel.has(e.a) && sel.has(e.b);
      }),
    );
    return { ...selection, vertices: kept };
  }
  if (selection.mode === 'edge') {
    const sel = new Set(selection.edges);
    const kept = selection.edges.filter((ei) => {
      const e = adj.edges[ei];
      if (!e) return false;
      const aAll = (adj.vertexEdges[e.a] ?? []).every((other) => sel.has(other));
      const bAll = (adj.vertexEdges[e.b] ?? []).every((other) => sel.has(other));
      return aAll && bAll;
    });
    return { ...selection, edges: kept };
  }
  const sel = new Set(selection.faces);
  const kept = selection.faces.filter((fi) => {
    const f = mesh.faces[fi];
    if (!f) return false;
    return f.verts.every((v) => (adj.vertexFaces[v] ?? []).every((otherFi) => sel.has(otherFi)));
  });
  return { ...selection, faces: kept };
}

export function convertSelection(
  mesh: EditableMeshData,
  selection: ComponentSelection,
  targetMode: ComponentElementType,
  options?: { boundaryOnly?: boolean },
): ComponentSelection {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  if (selection.mode === targetMode && !options?.boundaryOnly) {
    return { ...selection };
  }

  // Gather active vertex, edge, face sets from source mode
  if (selection.mode === 'polygon') {
    const faceSet = new Set(selection.faces);
    if (targetMode === 'point') {
      const verts = new Set<number>();
      for (const fi of faceSet) {
        const f = mesh.faces[fi];
        if (f) for (const v of f.verts) verts.add(v);
      }
      return { mode: 'point', vertices: [...verts].sort((a, b) => a - b), edges: [], faces: [] };
    }
    if (targetMode === 'edge') {
      const edges: number[] = [];
      for (const edge of adj.edges) {
        const count = edge.faces.filter((fi) => faceSet.has(fi)).length;
        if (options?.boundaryOnly ? count === 1 : count >= 1) {
          edges.push(edge.index);
        }
      }
      return { mode: 'edge', vertices: [], edges, faces: [] };
    }
  }

  if (selection.mode === 'edge') {
    const edgeSet = new Set(selection.edges);
    if (targetMode === 'point') {
      const verts = new Set<number>();
      for (const ei of edgeSet) {
        const e = adj.edges[ei];
        if (e) {
          verts.add(e.a);
          verts.add(e.b);
        }
      }
      return { mode: 'point', vertices: [...verts].sort((a, b) => a - b), edges: [], faces: [] };
    }
    if (targetMode === 'polygon') {
      const faces = new Set<number>();
      for (const ei of edgeSet) {
        const e = adj.edges[ei];
        if (e) for (const fi of e.faces) faces.add(fi);
      }
      return { mode: 'polygon', vertices: [], edges: [], faces: [...faces].sort((a, b) => a - b) };
    }
  }

  // Source is 'point'
  const vertSet = new Set(selection.vertices);
  if (targetMode === 'edge') {
    const edges = adj.edges
      .filter((e) => vertSet.has(e.a) && vertSet.has(e.b))
      .map((e) => e.index);
    return { mode: 'edge', vertices: [], edges, faces: [] };
  }
  if (targetMode === 'polygon') {
    const faces: number[] = [];
    for (let fi = 0; fi < mesh.faces.length; fi++) {
      if (mesh.faces[fi].verts.every((v) => vertSet.has(v))) {
        faces.push(fi);
      }
    }
    return { mode: 'polygon', vertices: [], edges: [], faces };
  }

  return { ...selection, mode: targetMode };
}

// ============================================================================
// COMPONENT GIZMO FRAME & TRANSFORM
// ============================================================================

function collectSelectedVertices(
  mesh: EditableMeshData,
  adj: MeshAdjacency,
  selection: ComponentSelection,
): number[] {
  const verts = new Set<number>();
  if (selection.mode === 'point') {
    for (const vi of selection.vertices) {
      if (vi >= 0 && vi < mesh.vertices.length) verts.add(vi);
    }
  } else if (selection.mode === 'edge') {
    for (const ei of selection.edges) {
      const e = adj.edges[ei];
      if (e) {
        verts.add(e.a);
        verts.add(e.b);
      }
    }
  } else {
    for (const fi of selection.faces) {
      const f = mesh.faces[fi];
      if (f) for (const v of f.verts) verts.add(v);
    }
  }
  return [...verts];
}

export function computeSelectionGizmoFrame(
  mesh: EditableMeshData,
  selection: ComponentSelection,
  space: 'local' | 'world' = 'local',
): GizmoFrame {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const selVerts = collectSelectedVertices(mesh, adj, selection);

  if (selVerts.length === 0) {
    return {
      origin: [0, 0, 0],
      normal: [0, 1, 0],
      tangent: [1, 0, 0],
      bitangent: [0, 0, 1],
    };
  }

  let ox = 0;
  let oy = 0;
  let oz = 0;
  for (const vi of selVerts) {
    const v = mesh.vertices[vi];
    ox += v[0];
    oy += v[1];
    oz += v[2];
  }
  const origin: Vec3 = [ox / selVerts.length, oy / selVerts.length, oz / selVerts.length];

  if (space === 'world') {
    return {
      origin,
      normal: [0, 1, 0],
      tangent: [1, 0, 0],
      bitangent: [0, 0, 1],
    };
  }

  let nAccum: Vec3 = [0, 0, 0];
  let hintTangent: Vec3 | null = null;

  if (selection.mode === 'polygon') {
    for (const fi of selection.faces) {
      if (adj.faceNormals[fi]) nAccum = add3(nAccum, adj.faceNormals[fi]);
      const f = mesh.faces[fi];
      if (!hintTangent && f && f.verts.length >= 2) {
        hintTangent = sub3(mesh.vertices[f.verts[1]], mesh.vertices[f.verts[0]]);
      }
    }
  } else if (selection.mode === 'edge') {
    for (const ei of selection.edges) {
      const e = adj.edges[ei];
      if (!e) continue;
      for (const fi of e.faces) nAccum = add3(nAccum, adj.faceNormals[fi]);
      if (!hintTangent) hintTangent = sub3(mesh.vertices[e.b], mesh.vertices[e.a]);
    }
  } else {
    for (const vi of selVerts) {
      if (adj.vertexNormals[vi]) nAccum = add3(nAccum, adj.vertexNormals[vi]);
    }
  }

  const normal = normalize3(nAccum, [0, 1, 0]);
  let tangent: Vec3;
  if (hintTangent) {
    const proj = sub3(hintTangent, scale3(normal, dot3(hintTangent, normal)));
    tangent = len3(proj) > EPS ? normalize3(proj) : buildOrthonormalBasis(normal).tangent;
  } else {
    tangent = buildOrthonormalBasis(normal).tangent;
  }
  const bitangent = normalize3(cross3(normal, tangent), [0, 0, 1]);

  return { origin, normal, tangent, bitangent };
}

export function transformSelectedComponents(
  mesh: EditableMeshData,
  selection: ComponentSelection,
  matrix4: THREE.Matrix4,
): MeshOperationResult {
  const next = cloneEditableMesh(mesh);
  const adj = buildHalfEdgeOrAdjacency(next);
  const selVerts = collectSelectedVertices(next, adj, selection);
  const tmp = new THREE.Vector3();

  for (const vi of selVerts) {
    const v = next.vertices[vi];
    tmp.set(v[0], v[1], v[2]).applyMatrix4(matrix4);
    next.vertices[vi] = [tmp.x, tmp.y, tmp.z];
  }

  return { mesh: next, selection: { ...selection } };
}

// ============================================================================
// POLYGON / SURFACE OPERATIONS
// ============================================================================

function groupConnectedSelectedFaces(
  mesh: EditableMeshData,
  adj: MeshAdjacency,
  faceIndices: readonly number[],
): number[][] {
  const selSet = new Set(faceIndices.filter((fi) => fi >= 0 && fi < mesh.faces.length));
  const visited = new Set<number>();
  const islands: number[][] = [];

  for (const startFi of selSet) {
    if (visited.has(startFi)) continue;
    const island: number[] = [];
    const queue = [startFi];
    visited.add(startFi);
    while (queue.length > 0) {
      const fi = queue.shift()!;
      island.push(fi);
      for (const ei of adj.faceEdges[fi] ?? []) {
        for (const otherFi of adj.edges[ei].faces) {
          if (selSet.has(otherFi) && !visited.has(otherFi)) {
            visited.add(otherFi);
            queue.push(otherFi);
          }
        }
      }
    }
    islands.push(island);
  }
  return islands;
}

/**
 * Extrudes selected polygon faces along group normals (`groupNormals: true`)
 * or per-polygon individual normals (`groupNormals: false`).
 */
export function extrudeFaces(
  mesh: EditableMeshData,
  faceIndices: readonly number[],
  params: { offset: number; groupNormals?: boolean; createCaps?: boolean },
): MeshOperationResult {
  const validFaces = [...new Set(faceIndices)].filter((fi) => fi >= 0 && fi < mesh.faces.length);
  if (validFaces.length === 0) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('polygon') };
  }

  const groupNormals = params.groupNormals ?? true;
  const createCaps = params.createCaps ?? false;
  const next = cloneEditableMesh(mesh);
  const adj = buildHalfEdgeOrAdjacency(next);
  const selSet = new Set(validFaces);

  const retainedFaces: MeshFace[] = [];
  for (let fi = 0; fi < next.faces.length; fi++) {
    if (!selSet.has(fi)) {
      retainedFaces.push(next.faces[fi]);
    } else if (createCaps) {
      const f = next.faces[fi];
      retainedFaces.push({
        verts: [...f.verts].reverse(),
        ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
        ...(f.uvs ? { uvs: [...f.uvs].reverse() } : {}),
      });
    }
  }

  const newTopFaceIndices: number[] = [];

  if (!groupNormals) {
    // Individual polygon extrusion
    for (const fi of validFaces) {
      const face = next.faces[fi];
      const fn = adj.faceNormals[fi];
      const disp = scale3(fn, params.offset);
      const topVerts = face.verts.map((vi) => {
        const idx = next.vertices.length;
        next.vertices.push(add3(next.vertices[vi], disp));
        return idx;
      });
      const n = face.verts.length;
      for (let i = 0; i < n; i++) {
        const b0 = face.verts[i];
        const b1 = face.verts[(i + 1) % n];
        const t1 = topVerts[(i + 1) % n];
        const t0 = topVerts[i];
        retainedFaces.push({
          verts: [b0, b1, t1, t0],
          ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
        });
      }
      newTopFaceIndices.push(retainedFaces.length);
      retainedFaces.push({
        verts: topVerts,
        ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
        ...(face.uvs ? { uvs: face.uvs.map((uv) => [uv[0], uv[1]] as Vec2) } : {}),
      });
    }
  } else {
    // Connected island extrusion along coherent island normals
    const islands = groupConnectedSelectedFaces(next, adj, validFaces);
    for (const island of islands) {
      const islandSet = new Set(island);
      // Compute island average normal + per-vertex mitered normal
      let avgN: Vec3 = [0, 0, 0];
      const vertNormals = new Map<number, Vec3>();
      for (const fi of island) {
        const fn = adj.faceNormals[fi];
        avgN = add3(avgN, fn);
        for (const vi of next.faces[fi].verts) {
          vertNormals.set(vi, add3(vertNormals.get(vi) ?? [0, 0, 0], fn));
        }
      }
      const islandDir = normalize3(avgN, [0, 1, 0]);

      // Check if all faces in this island are nearly parallel (e.g. flat multi-quad cap)
      const allParallel = island.every((fi) => dot3(adj.faceNormals[fi], islandDir) > 0.995);

      const topVertMap = new Map<number, number>();
      for (const [vi, vnRaw] of vertNormals.entries()) {
        let dir: Vec3;
        if (allParallel) {
          dir = islandDir;
        } else {
          const vn = normalize3(vnRaw, islandDir);
          // Even-thickness miter scale so multi-face extrusions keep uniform wall depth
          const sampleFi = island.find((fi) => next.faces[fi].verts.includes(vi))!;
          const cosA = Math.max(0.35, Math.abs(dot3(vn, adj.faceNormals[sampleFi])));
          dir = scale3(vn, 1 / cosA);
        }
        const newVi = next.vertices.length;
        next.vertices.push(add3(next.vertices[vi], scale3(dir, params.offset)));
        topVertMap.set(vi, newVi);
      }

      // Build side walls along every directed boundary half-edge of the island
      for (const fi of island) {
        const face = next.faces[fi];
        const n = face.verts.length;
        for (let i = 0; i < n; i++) {
          const u = face.verts[i];
          const v = face.verts[(i + 1) % n];
          const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v))!;
          const edge = adj.edges[ei];
          const selectedNeighbors = edge.faces.filter((otherFi) => islandSet.has(otherFi));
          if (selectedNeighbors.length === 1) {
            retainedFaces.push({
              verts: [u, v, topVertMap.get(v)!, topVertMap.get(u)!],
              ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
            });
          }
        }
      }

      // Build extruded top faces
      for (const fi of island) {
        const face = next.faces[fi];
        newTopFaceIndices.push(retainedFaces.length);
        retainedFaces.push({
          verts: face.verts.map((vi) => topVertMap.get(vi)!),
          ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
          ...(face.uvs ? { uvs: face.uvs.map((uv) => [uv[0], uv[1]] as Vec2) } : {}),
        });
      }
    }
  }

  next.faces = retainedFaces;
  const compacted = compactEditableMesh(next);
  return {
    mesh: compacted,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: newTopFaceIndices },
  };
}

/** Solves a 2D in-plane offset displacement `delta` such that `delta·u1 = d1` and `delta·u2 = d2`. */
function solveInPlaneMiterOffset(u1: Vec3, d1: number, u2: Vec3, d2: number): Vec3 {
  const g = dot3(u1, u2);
  const det = 1 - g * g;
  if (Math.abs(det) > 1e-4) {
    const c1 = (d1 - g * d2) / det;
    const c2 = (d2 - g * d1) / det;
    const raw = add3(scale3(u1, c1), scale3(u2, c2));
    const maxMag = Math.max(Math.abs(d1), Math.abs(d2)) * 2.75;
    const mag = len3(raw);
    return mag > maxMag && mag > EPS ? scale3(raw, maxMag / mag) : raw;
  }
  return scale3(normalize3(add3(u1, u2), u1), 0.5 * (d1 + d2));
}

/**
 * Cinema 4D *Extrude Inner* / *Inset*: insets selected faces individually or as connected regions.
 */
export function insetFaces(
  mesh: EditableMeshData,
  faceIndices: readonly number[],
  params: { inset: number; depth?: number; individual?: boolean },
): MeshOperationResult {
  const validFaces = [...new Set(faceIndices)].filter((fi) => fi >= 0 && fi < mesh.faces.length);
  if (validFaces.length === 0) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('polygon') };
  }

  const depth = params.depth ?? 0;
  const individual = params.individual ?? false;
  const next = cloneEditableMesh(mesh);
  const adj = buildHalfEdgeOrAdjacency(next);
  const selSet = new Set(validFaces);

  const retainedFaces: MeshFace[] = [];
  for (let fi = 0; fi < next.faces.length; fi++) {
    if (!selSet.has(fi)) retainedFaces.push(next.faces[fi]);
  }

  const innerFaceIndices: number[] = [];

  if (individual) {
    for (const fi of validFaces) {
      const face = next.faces[fi];
      const fn = adj.faceNormals[fi];
      const center = computeFaceCenter(next.vertices, face.verts);
      const n = face.verts.length;

      // Clamp inset to 85% of min corner radius so inner face never inverts
      let maxAllowed = Infinity;
      for (let i = 0; i < n; i++) {
        maxAllowed = Math.min(maxAllowed, dist3(next.vertices[face.verts[i]], center) * 0.85);
      }
      const clampedInset = Math.max(0, Math.min(params.inset, maxAllowed));

      const edgeInward: Vec3[] = [];
      for (let i = 0; i < n; i++) {
        const p0 = next.vertices[face.verts[i]];
        const p1 = next.vertices[face.verts[(i + 1) % n]];
        edgeInward.push(normalize3(cross3(fn, sub3(p1, p0)), [0, 0, 0]));
      }

      const innerVerts: number[] = [];
      for (let i = 0; i < n; i++) {
        const uPrev = edgeInward[(i - 1 + n) % n];
        const uCurr = edgeInward[i];
        const miter = solveInPlaneMiterOffset(uPrev, clampedInset, uCurr, clampedInset);
        const pos = add3(add3(next.vertices[face.verts[i]], miter), scale3(fn, depth));
        const newVi = next.vertices.length;
        next.vertices.push(pos);
        innerVerts.push(newVi);
      }

      for (let i = 0; i < n; i++) {
        const b0 = face.verts[i];
        const b1 = face.verts[(i + 1) % n];
        const t1 = innerVerts[(i + 1) % n];
        const t0 = innerVerts[i];
        retainedFaces.push({
          verts: [b0, b1, t1, t0],
          ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
        });
      }

      innerFaceIndices.push(retainedFaces.length);
      retainedFaces.push({
        verts: innerVerts,
        ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
      });
    }
  } else {
    // Group region inset
    const islands = groupConnectedSelectedFaces(next, adj, validFaces);
    for (const island of islands) {
      const islandSet = new Set(island);
      // Collect boundary directed edges (u -> v) where island face is on left
      const boundaryInwardByVert = new Map<number, Vec3[]>();
      const vertNormalByVert = new Map<number, Vec3>();
      let minEdgeLen = Infinity;

      for (const fi of island) {
        const face = next.faces[fi];
        const fn = adj.faceNormals[fi];
        const n = face.verts.length;
        for (let i = 0; i < n; i++) {
          const u = face.verts[i];
          const v = face.verts[(i + 1) % n];
          vertNormalByVert.set(u, add3(vertNormalByVert.get(u) ?? [0, 0, 0], fn));
          minEdgeLen = Math.min(minEdgeLen, dist3(next.vertices[u], next.vertices[v]));

          const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v))!;
          const isIslandBoundary =
            adj.edges[ei].faces.filter((otherFi) => islandSet.has(otherFi)).length === 1;
          if (isIslandBoundary) {
            const inward = normalize3(
              cross3(fn, sub3(next.vertices[v], next.vertices[u])),
              [0, 0, 0],
            );
            for (const endV of [u, v]) {
              let arr = boundaryInwardByVert.get(endV);
              if (!arr) {
                arr = [];
                boundaryInwardByVert.set(endV, arr);
              }
              arr.push(inward);
            }
          }
        }
      }

      const clampedInset = Math.max(0, Math.min(params.inset, minEdgeLen * 0.45));
      const innerMap = new Map<number, number>();

      for (const [vi, vnRaw] of vertNormalByVert.entries()) {
        const vn = normalize3(vnRaw, [0, 1, 0]);
        const inwards = boundaryInwardByVert.get(vi);
        let miter: Vec3 = [0, 0, 0];
        if (inwards && inwards.length >= 2) {
          miter = solveInPlaneMiterOffset(
            inwards[0],
            clampedInset,
            inwards[inwards.length - 1],
            clampedInset,
          );
        } else if (inwards && inwards.length === 1) {
          miter = scale3(inwards[0], clampedInset);
        }
        const newVi = next.vertices.length;
        next.vertices.push(add3(add3(next.vertices[vi], miter), scale3(vn, depth)));
        innerMap.set(vi, newVi);
      }

      // Boundary collar quads
      for (const fi of island) {
        const face = next.faces[fi];
        const n = face.verts.length;
        for (let i = 0; i < n; i++) {
          const u = face.verts[i];
          const v = face.verts[(i + 1) % n];
          const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v))!;
          const isIslandBoundary =
            adj.edges[ei].faces.filter((otherFi) => islandSet.has(otherFi)).length === 1;
          if (isIslandBoundary) {
            retainedFaces.push({
              verts: [u, v, innerMap.get(v)!, innerMap.get(u)!],
              ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
            });
          }
        }
      }

      // Inner top faces
      for (const fi of island) {
        const face = next.faces[fi];
        innerFaceIndices.push(retainedFaces.length);
        retainedFaces.push({
          verts: face.verts.map((vi) => innerMap.get(vi)!),
          ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
        });
      }
    }
  }

  next.faces = retainedFaces;
  return {
    mesh: next,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: innerFaceIndices },
  };
}

/** Bevels selected faces with multi-segment curved or chamfered profile (`inset` + `offset`). */
export function bevelFaces(
  mesh: EditableMeshData,
  faceIndices: readonly number[],
  params: { inset: number; offset: number; segments?: number },
): MeshOperationResult {
  const segs = Math.max(1, Math.min(16, Math.round(params.segments ?? 1)));
  let currMesh = cloneEditableMesh(mesh);
  let currFaces = [...faceIndices];

  let prevSin = 0;
  let prevOneMinusCos = 0;
  for (let s = 1; s <= segs; s++) {
    const t = s / segs;
    const theta = (t * Math.PI) / 2;
    const curSin = segs === 1 ? 1 : Math.sin(theta);
    const curOneMinusCos = segs === 1 ? 1 : 1 - Math.cos(theta);

    const stepOffset = params.offset * (curSin - prevSin);
    const stepInset = params.inset * (curOneMinusCos - prevOneMinusCos);
    prevSin = curSin;
    prevOneMinusCos = curOneMinusCos;

    const res = insetFaces(currMesh, currFaces, {
      inset: stepInset,
      depth: stepOffset,
      individual: false,
    });
    currMesh = res.mesh;
    currFaces = res.selection.faces;
  }

  return {
    mesh: currMesh,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: currFaces },
  };
}

/** Extracts ordered closed vertex loop(s) from a set of directed half-edges `[u, v]`. */
function traceOrderedBoundaryLoops(directedEdges: [number, number][]): number[][] {
  const outMap = new Map<number, number[]>();
  for (const [u, v] of directedEdges) {
    let arr = outMap.get(u);
    if (!arr) {
      arr = [];
      outMap.set(u, arr);
    }
    arr.push(v);
  }

  const loops: number[][] = [];
  const used = new Set<string>();

  for (const [startU, startV] of directedEdges) {
    const firstKey = `${startU}->${startV}`;
    if (used.has(firstKey)) continue;
    used.add(firstKey);
    const loop = [startU];
    let curr = startV;
    while (curr !== startU) {
      loop.push(curr);
      const nextCandidates = outMap.get(curr) ?? [];
      const nextV = nextCandidates.find((cand) => !used.has(`${curr}->${cand}`));
      if (nextV === undefined) break;
      used.add(`${curr}->${nextV}`);
      curr = nextV;
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

/** Connects two opposing face islands (or two faces) with a quad bridge tunnel. */
export function bridgeFaces(
  mesh: EditableMeshData,
  faceIndices: readonly number[],
): MeshOperationResult {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const islands = groupConnectedSelectedFaces(mesh, adj, faceIndices);
  if (islands.length !== 2) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('polygon') };
  }

  const extractIslandBoundaryLoop = (island: number[]): number[] | null => {
    const set = new Set(island);
    const dirEdges: [number, number][] = [];
    for (const fi of island) {
      const f = mesh.faces[fi];
      for (let i = 0; i < f.verts.length; i++) {
        const u = f.verts[i];
        const v = f.verts[(i + 1) % f.verts.length];
        const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v))!;
        if (adj.edges[ei].faces.filter((other) => set.has(other)).length === 1) {
          dirEdges.push([u, v]);
        }
      }
    }
    const loops = traceOrderedBoundaryLoops(dirEdges);
    return loops.length > 0 ? loops[0] : null;
  };

  const loopA = extractIslandBoundaryLoop(islands[0]);
  const loopB = extractIslandBoundaryLoop(islands[1]);
  if (!loopA || !loopB || loopA.length < 3 || loopB.length < 3) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('polygon') };
  }

  // Reverse loopB so opposing windings match around the bridge tunnel without crossing
  const alignedB = [...loopB].reverse();

  // Rotate alignedB to minimize total squared chord distance to loopA
  const lenA = loopA.length;
  const lenB = alignedB.length;
  let bestShift = 0;
  let bestCost = Infinity;
  const samples = Math.max(lenA, lenB);

  for (let shift = 0; shift < lenB; shift++) {
    let cost = 0;
    for (let k = 0; k < samples; k++) {
      const va = loopA[Math.floor((k * lenA) / samples) % lenA];
      const vb = alignedB[(Math.floor((k * lenB) / samples) + shift) % lenB];
      const d = dist3(mesh.vertices[va], mesh.vertices[vb]);
      cost += d * d;
    }
    if (cost < bestCost) {
      bestCost = cost;
      bestShift = shift;
    }
  }
  const rotatedB = Array.from({ length: lenB }, (_, i) => alignedB[(i + bestShift) % lenB]);

  const removedSet = new Set([...islands[0], ...islands[1]]);
  const next = cloneEditableMesh(mesh);
  const keptFaces = next.faces.filter((_, fi) => !removedSet.has(fi));
  const newBridgeFaces: number[] = [];

  if (lenA === lenB) {
    for (let i = 0; i < lenA; i++) {
      const a0 = loopA[i];
      const a1 = loopA[(i + 1) % lenA];
      const b1 = rotatedB[(i + 1) % lenB];
      const b0 = rotatedB[i];
      newBridgeFaces.push(keptFaces.length);
      keptFaces.push({ verts: [a0, a1, b1, b0] });
    }
  } else {
    // General step stitch when loop vertex counts differ
    let ia = 0;
    let ib = 0;
    while (ia < lenA || ib < lenB) {
      const aCurr = loopA[ia % lenA];
      const aNext = loopA[(ia + 1) % lenA];
      const bCurr = rotatedB[ib % lenB];
      const bNext = rotatedB[(ib + 1) % lenB];
      if (ia < lenA && (ib >= lenB || (ia + 1) / lenA <= (ib + 1) / lenB)) {
        newBridgeFaces.push(keptFaces.length);
        keptFaces.push({ verts: [aCurr, aNext, bCurr] });
        ia++;
      } else {
        newBridgeFaces.push(keptFaces.length);
        keptFaces.push({ verts: [aCurr, bNext, bCurr] });
        ib++;
      }
    }
  }

  next.faces = keptFaces;
  return {
    mesh: compactEditableMesh(next),
    selection: { mode: 'polygon', vertices: [], edges: [], faces: newBridgeFaces },
  };
}

/**
 * Subdivides selected faces (or all faces if `faceIndices` covers the mesh)
 * using either faceted quad splitting or true Catmull-Clark smoothing (`smooth: true`).
 */
export function subdivideFaces(
  mesh: EditableMeshData,
  faceIndices: readonly number[],
  params?: { smooth?: boolean },
): MeshOperationResult {
  const smooth = params?.smooth ?? false;
  const targetFaces =
    faceIndices.length > 0
      ? new Set(faceIndices.filter((fi) => fi >= 0 && fi < mesh.faces.length))
      : new Set(mesh.faces.map((_, fi) => fi));

  if (targetFaces.size === 0) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('polygon') };
  }

  const adj = buildHalfEdgeOrAdjacency(mesh);
  const nextVertices: Vec3[] = mesh.vertices.map((v) => [v[0], v[1], v[2]]);

  // 1. Face points for all selected faces
  const facePointIdx = new Map<number, number>();
  const allFaceCenters: Vec3[] = mesh.faces.map((f) => computeFaceCenter(mesh.vertices, f.verts));
  for (const fi of targetFaces) {
    const idx = nextVertices.length;
    nextVertices.push([...allFaceCenters[fi]]);
    facePointIdx.set(fi, idx);
  }

  // 2. Edge points for every edge touched by at least one selected face
  const edgePointIdx = new Map<number, number>();
  for (const edge of adj.edges) {
    const touchedSelected = edge.faces.some((fi) => targetFaces.has(fi));
    if (!touchedSelected) continue;
    const pa = mesh.vertices[edge.a];
    const pb = mesh.vertices[edge.b];
    const mid = lerp3(pa, pb, 0.5);

    let pos = mid;
    if (smooth && !edge.isBoundary && edge.faces.length === 2 && edge.faces.every((fi) => targetFaces.has(fi))) {
      const fc0 = allFaceCenters[edge.faces[0]];
      const fc1 = allFaceCenters[edge.faces[1]];
      pos = scale3(add3(add3(pa, pb), add3(fc0, fc1)), 0.25);
    }
    const idx = nextVertices.length;
    nextVertices.push(pos);
    edgePointIdx.set(edge.index, idx);
  }

  // 3. Catmull-Clark original vertex smoothing when smooth = true
  if (smooth) {
    const touchedVerts = new Set<number>();
    for (const fi of targetFaces) {
      for (const v of mesh.faces[fi].verts) touchedVerts.add(v);
    }

    for (const vi of touchedVerts) {
      const incEdges = adj.vertexEdges[vi] ?? [];
      const incFaces = adj.vertexFaces[vi] ?? [];
      const boundaryIncEdges = incEdges.filter((ei) => adj.edges[ei].isBoundary);
      const P = mesh.vertices[vi];

      if (boundaryIncEdges.length >= 2) {
        // Boundary Catmull-Clark rule: (6*P + M0 + M1) / 8 using neighbor vertices
        const e0 = adj.edges[boundaryIncEdges[0]];
        const e1 = adj.edges[boundaryIncEdges[1]];
        const n0 = mesh.vertices[e0.a === vi ? e0.b : e0.a];
        const n1 = mesh.vertices[e1.a === vi ? e1.b : e1.a];
        nextVertices[vi] = add3(scale3(P, 0.75), scale3(add3(n0, n1), 0.125));
      } else if (incFaces.length >= 3 && incFaces.every((fi) => targetFaces.has(fi))) {
        const n = incFaces.length;
        let F: Vec3 = [0, 0, 0];
        for (const fi of incFaces) F = add3(F, allFaceCenters[fi]);
        F = scale3(F, 1 / n);

        let R: Vec3 = [0, 0, 0];
        for (const ei of incEdges) {
          const e = adj.edges[ei];
          R = add3(R, lerp3(mesh.vertices[e.a], mesh.vertices[e.b], 0.5));
        }
        R = scale3(R, 1 / incEdges.length);

        // (F + 2R + (n - 3)P) / n
        nextVertices[vi] = scale3(
          add3(add3(F, scale3(R, 2)), scale3(P, n - 3)),
          1 / n,
        );
      }
    }
  }

  // 4. Rebuild faces: selected faces split into n quads; unselected faces splice split edge midpoints (no T-junctions)
  const newFaces: MeshFace[] = [];
  const newSelectedFaces: number[] = [];

  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    const m = face.verts.length;
    if (targetFaces.has(fi)) {
      const fp = facePointIdx.get(fi)!;
      for (let i = 0; i < m; i++) {
        const vPrev = face.verts[(i - 1 + m) % m];
        const vCurr = face.verts[i];
        const vNext = face.verts[(i + 1) % m];
        const ePrev = edgePointIdx.get(adj.edgeKeyToIndex.get(canonicalEdgeKey(vPrev, vCurr))!)!;
        const eCurr = edgePointIdx.get(adj.edgeKeyToIndex.get(canonicalEdgeKey(vCurr, vNext))!)!;
        newSelectedFaces.push(newFaces.length);
        newFaces.push({
          verts: [vCurr, eCurr, fp, ePrev],
          ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
        });
      }
    } else {
      const splicedVerts: number[] = [];
      for (let i = 0; i < m; i++) {
        const u = face.verts[i];
        const v = face.verts[(i + 1) % m];
        splicedVerts.push(u);
        const ep = edgePointIdx.get(adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v))!);
        if (ep !== undefined) splicedVerts.push(ep);
      }
      newFaces.push({
        verts: splicedVerts,
        ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
      });
    }
  }

  return {
    mesh: {
      vertices: nextVertices,
      faces: newFaces,
      ...(mesh.phongAngleDeg !== undefined ? { phongAngleDeg: mesh.phongAngleDeg } : {}),
    },
    selection: { mode: 'polygon', vertices: [], edges: [], faces: newSelectedFaces },
  };
}

export function deleteFaces(
  mesh: EditableMeshData,
  faceIndices: readonly number[],
): MeshOperationResult {
  const delSet = new Set(faceIndices);
  const kept = mesh.faces.filter((_, fi) => !delSet.has(fi));
  const compacted = compactEditableMesh({ ...mesh, faces: kept });
  return { mesh: compacted, selection: createEmptySelection('polygon') };
}

/** Merges connected selected faces into clean outer-boundary n-gons. */
export function dissolveFaces(
  mesh: EditableMeshData,
  faceIndices: readonly number[],
): MeshOperationResult {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const islands = groupConnectedSelectedFaces(mesh, adj, faceIndices);
  if (islands.length === 0) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('polygon') };
  }

  const removeSet = new Set<number>();
  const mergedPolys: MeshFace[] = [];

  for (const island of islands) {
    if (island.length < 2) continue;
    const set = new Set(island);
    const dirEdges: [number, number][] = [];
    for (const fi of island) {
      const f = mesh.faces[fi];
      for (let i = 0; i < f.verts.length; i++) {
        const u = f.verts[i];
        const v = f.verts[(i + 1) % f.verts.length];
        const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v))!;
        if (adj.edges[ei].faces.filter((other) => set.has(other)).length === 1) {
          dirEdges.push([u, v]);
        }
      }
    }
    const loops = traceOrderedBoundaryLoops(dirEdges);
    if (loops.length === 1 && loops[0].length >= 3) {
      for (const fi of island) removeSet.add(fi);
      const matIdx = mesh.faces[island[0]].materialIndex;
      mergedPolys.push({
        verts: loops[0],
        ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
      });
    }
  }

  const kept = mesh.faces.filter((_, fi) => !removeSet.has(fi));
  const newIndices: number[] = [];
  for (const poly of mergedPolys) {
    newIndices.push(kept.length);
    kept.push(poly);
  }

  const compacted = compactEditableMesh({ ...mesh, faces: kept });
  return {
    mesh: compacted,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: newIndices },
  };
}

export function flipFaceNormals(
  mesh: EditableMeshData,
  faceIndices?: readonly number[],
): MeshOperationResult {
  const next = cloneEditableMesh(mesh);
  const target =
    faceIndices && faceIndices.length > 0
      ? faceIndices.filter((fi) => fi >= 0 && fi < next.faces.length)
      : next.faces.map((_, fi) => fi);

  for (const fi of target) {
    next.faces[fi].verts.reverse();
    if (next.faces[fi].uvs) next.faces[fi].uvs!.reverse();
  }
  return {
    mesh: next,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: [...target] },
  };
}

/** Harmonizes winding across each connected shell and orients signed volume outward. */
export function recalculateNormalsOutside(mesh: EditableMeshData): MeshOperationResult {
  const next = cloneEditableMesh(mesh);
  const adj = buildHalfEdgeOrAdjacency(next);
  const visited = new Uint8Array(next.faces.length);

  const hasDirectedHalfEdge = (faceVerts: readonly number[], u: number, v: number): boolean => {
    for (let i = 0; i < faceVerts.length; i++) {
      if (faceVerts[i] === u && faceVerts[(i + 1) % faceVerts.length] === v) return true;
    }
    return false;
  };

  for (let startFi = 0; startFi < next.faces.length; startFi++) {
    if (visited[startFi]) continue;
    const comp: number[] = [];
    const queue = [startFi];
    visited[startFi] = 1;

    while (queue.length > 0) {
      const fi = queue.shift()!;
      comp.push(fi);
      const f = next.faces[fi];
      for (let i = 0; i < f.verts.length; i++) {
        const u = f.verts[i];
        const v = f.verts[(i + 1) % f.verts.length];
        const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v))!;
        for (const nbFi of adj.edges[ei].faces) {
          if (visited[nbFi]) continue;
          visited[nbFi] = 1;
          // Neighbor across manifold edge (u -> v) MUST traverse (v -> u)
          if (hasDirectedHalfEdge(next.faces[nbFi].verts, u, v)) {
            next.faces[nbFi].verts.reverse();
            if (next.faces[nbFi].uvs) next.faces[nbFi].uvs!.reverse();
          }
          queue.push(nbFi);
        }
      }
    }

    // Compute signed volume (or outward dot product wrt centroid) for this component
    let center: Vec3 = [0, 0, 0];
    let count = 0;
    for (const fi of comp) {
      for (const vi of next.faces[fi].verts) {
        center = add3(center, next.vertices[vi]);
        count++;
      }
    }
    if (count > 0) center = scale3(center, 1 / count);

    let signedVol = 0;
    for (const fi of comp) {
      const fv = next.faces[fi].verts;
      const fn = computeFaceNormal(next.vertices, fv);
      const tris = triangulateFaceIndices(next.vertices, fv, fn);
      for (const [i0, i1, i2] of tris) {
        const a = sub3(next.vertices[fv[i0]], center);
        const b = sub3(next.vertices[fv[i1]], center);
        const c = sub3(next.vertices[fv[i2]], center);
        signedVol += dot3(a, cross3(b, c));
      }
    }

    if (signedVol < 0) {
      for (const fi of comp) {
        next.faces[fi].verts.reverse();
        if (next.faces[fi].uvs) next.faces[fi].uvs!.reverse();
      }
    }
  }

  return { mesh: next, selection: createEmptySelection('polygon') };
}

/** Detects all open boundary edge loops and caps each hole with a matching polygon face. */
export function closePolygonHoles(mesh: EditableMeshData): MeshOperationResult {
  const next = cloneEditableMesh(mesh);
  const adj = buildHalfEdgeOrAdjacency(next);
  const holeDirectedEdges: [number, number][] = [];

  for (const edge of adj.edges) {
    if (!edge.isBoundary || edge.faces.length !== 1) continue;
    const f = next.faces[edge.faces[0]];
    // Find orientation of edge in existing face; hole cap must traverse the opposite direction
    for (let i = 0; i < f.verts.length; i++) {
      const u = f.verts[i];
      const v = f.verts[(i + 1) % f.verts.length];
      if ((u === edge.a && v === edge.b) || (u === edge.b && v === edge.a)) {
        holeDirectedEdges.push([v, u]);
        break;
      }
    }
  }

  const loops = traceOrderedBoundaryLoops(holeDirectedEdges);
  const addedFaces: number[] = [];
  for (const loop of loops) {
    if (loop.length >= 3) {
      addedFaces.push(next.faces.length);
      next.faces.push({ verts: loop });
    }
  }

  return {
    mesh: next,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: addedFaces },
  };
}

/** Detaches selected faces into an independent shell with dedicated unshared vertices. */
export function splitDisconnectFaces(
  mesh: EditableMeshData,
  faceIndices: readonly number[],
): MeshOperationResult {
  const next = cloneEditableMesh(mesh);
  const selSet = new Set(faceIndices.filter((fi) => fi >= 0 && fi < next.faces.length));
  if (selSet.size === 0) {
    return { mesh: next, selection: createEmptySelection('polygon') };
  }

  // Check if any unselected face also uses vertices in selSet
  const unselVerts = new Set<number>();
  for (let fi = 0; fi < next.faces.length; fi++) {
    if (!selSet.has(fi)) {
      for (const v of next.faces[fi].verts) unselVerts.add(v);
    }
  }

  const dupMap = new Map<number, number>();
  for (const fi of selSet) {
    const f = next.faces[fi];
    f.verts = f.verts.map((vi) => {
      if (!unselVerts.has(vi)) return vi;
      let mapped = dupMap.get(vi);
      if (mapped === undefined) {
        mapped = next.vertices.length;
        const p = next.vertices[vi];
        next.vertices.push([p[0], p[1], p[2]]);
        dupMap.set(vi, mapped);
      }
      return mapped;
    });
  }

  return {
    mesh: next,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: [...selSet] },
  };
}

// ============================================================================
// EDGE MANIPULATION (FILLET & CHAMFER BEVEL, LOOP CUT, BRIDGE, SLIDE, DISSOLVE)
// ============================================================================

/** Evaluates a Rational Quadratic Bézier point for exact circular/conic fillet profiles. */
function evalRationalQuadraticBezier(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  weight: number,
  t: number,
): Vec3 {
  const omt = 1 - t;
  const b0 = omt * omt;
  const b1 = 2 * weight * omt * t;
  const b2 = t * t;
  const denom = Math.max(EPS, b0 + b1 + b2);
  return [
    (b0 * p0[0] + b1 * p1[0] + b2 * p2[0]) / denom,
    (b0 * p0[1] + b1 * p1[1] + b2 * p2[1]) / denom,
    (b0 * p0[2] + b1 * p1[2] + b2 * p2[2]) / denom,
  ];
}

/**
 * Cinema 4D Edge Bevel (Chamfer & Smooth Fillet):
 * - `segments = 1`: produces crisp flat 45°/mitered Chamfer strips + clean corner polygons.
 * - `segments >= 2`: produces smooth Rational-Bézier circular Fillet arcs (`profile = 0.5`
 *   exact tangent circle, adjustable `0..1`) + watertight dome-projected corner patches.
 */
export function bevelEdges(
  mesh: EditableMeshData,
  edgeIndices: readonly number[],
  params: { width: number; segments?: number; profile?: number },
): MeshOperationResult {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const validEdges = [...new Set(edgeIndices)].filter(
    (ei) => ei >= 0 && ei < adj.edges.length && adj.edges[ei].faces.length === 2,
  );
  if (validEdges.length === 0 || params.width <= 1e-6) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('edge') };
  }

  const segments = Math.max(1, Math.min(24, Math.round(params.segments ?? 1)));
  const profile = Math.max(0, Math.min(1, params.profile ?? 0.5));
  const bevEdgeSet = new Set(validEdges);

  // Clamp bevel width safely against minimum incident edge length so faces never invert
  let minIncidentLen = Infinity;
  const bevVertSet = new Set<number>();
  for (const ei of validEdges) {
    const e = adj.edges[ei];
    bevVertSet.add(e.a);
    bevVertSet.add(e.b);
  }
  for (const vi of bevVertSet) {
    for (const ei of adj.vertexEdges[vi] ?? []) {
      const e = adj.edges[ei];
      minIncidentLen = Math.min(minIncidentLen, dist3(mesh.vertices[e.a], mesh.vertices[e.b]));
    }
  }
  const width = Math.min(params.width, minIncidentLen * 0.46);
  if (width <= 1e-6) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('edge') };
  }

  const outVertices: Vec3[] = [];
  const addVert = (p: Vec3): number => {
    const idx = outVertices.length;
    outVertices.push(p);
    return idx;
  };

  // Copy untouched vertices (vertices with zero incident beveled edges keep single position)
  const untouchedVertMap = new Map<number, number>();
  for (let vi = 0; vi < mesh.vertices.length; vi++) {
    if (!bevVertSet.has(vi)) {
      untouchedVertMap.set(vi, addVert([...mesh.vertices[vi]]));
    }
  }

  // Step 1: Compute raw face-corner offset positions for every (fi, localCornerIdx)
  // where the vertex has at least 1 beveled incident edge.
  const rawCornerPos = new Map<string, Vec3>();
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    const fn = adj.faceNormals[fi];
    const m = face.verts.length;

    const edgeInward: Vec3[] = [];
    const edgeOffset: number[] = [];
    for (let k = 0; k < m; k++) {
      const u = face.verts[k];
      const v = face.verts[(k + 1) % m];
      const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v))!;
      edgeInward.push(normalize3(cross3(fn, sub3(mesh.vertices[v], mesh.vertices[u])), [0, 0, 0]));
      edgeOffset.push(bevEdgeSet.has(ei) ? width : 0);
    }

    for (let k = 0; k < m; k++) {
      const vi = face.verts[k];
      if (!bevVertSet.has(vi)) continue;
      const prevIdx = (k - 1 + m) % m;
      const dPrev = edgeOffset[prevIdx];
      const dCurr = edgeOffset[k];
      const miter = solveInPlaneMiterOffset(edgeInward[prevIdx], dPrev, edgeInward[k], dCurr);
      rawCornerPos.set(`${fi}_${k}`, add3(mesh.vertices[vi], miter));
    }
  }

  // Step 2: Unify vertices across UNBEVELED edges that touch a beveled vertex!
  // When >= 2 beveled edges meet at `vi`, union corners within each contiguous unbeveled sector.
  // When ONLY 1 beveled edge terminates at `vi`, keep the two beveled-face corners distinct so
  // the bevel strip has non-zero width, and splice the end arc into the adjacent end-cap face(s)!
  const cornerVertIndex = new Map<string, number>();
  const singleBevelVertSet = new Set<number>();

  for (const vi of bevVertSet) {
    const bevCountAtVi = (adj.vertexEdges[vi] ?? []).filter((ei) => bevEdgeSet.has(ei)).length;
    if (bevCountAtVi === 1) {
      singleBevelVertSet.add(vi);
      const theBevEdge = (adj.vertexEdges[vi] ?? []).find((ei) => bevEdgeSet.has(ei))!;
      const bevFaces = adj.edges[theBevEdge].faces;
      // Assign distinct corner vertices for the two faces flanking `theBevEdge`;
      // other faces at `vi` temporarily hold `origP` and will splice the arc in Step 5b!
      const fallbackVi = addVert([...mesh.vertices[vi]]);
      for (const fi of adj.vertexFaces[vi] ?? []) {
        const fv = mesh.faces[fi].verts;
        const k = fv.indexOf(vi);
        if (k === -1) continue;
        if (bevFaces.includes(fi)) {
          const cPos = rawCornerPos.get(`${fi}_${k}`)!;
          cornerVertIndex.set(`${fi}_${k}`, addVert(cPos));
        } else {
          cornerVertIndex.set(`${fi}_${k}`, fallbackVi);
        }
      }
      continue;
    }

    // Collect all (fi, k) corners at vertex vi (bevCountAtVi >= 2)
    const corners: { fi: number; k: number; prevEdge: number; nextEdge: number }[] = [];
    for (const fi of adj.vertexFaces[vi] ?? []) {
      const fv = mesh.faces[fi].verts;
      const m = fv.length;
      for (let k = 0; k < m; k++) {
        if (fv[k] !== vi) continue;
        const prevV = fv[(k - 1 + m) % m];
        const nextV = fv[(k + 1) % m];
        const prevEdge = adj.edgeKeyToIndex.get(canonicalEdgeKey(prevV, vi))!;
        const nextEdge = adj.edgeKeyToIndex.get(canonicalEdgeKey(vi, nextV))!;
        corners.push({ fi, k, prevEdge, nextEdge });
      }
    }

    // Union corners connected across an UNBEVELED incident edge
    const parent = corners.map((_, idx) => idx);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const union = (a: number, b: number) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    };

    for (let i = 0; i < corners.length; i++) {
      for (let j = i + 1; j < corners.length; j++) {
        const ci = corners[i];
        const cj = corners[j];
        if (
          (!bevEdgeSet.has(ci.prevEdge) && (ci.prevEdge === cj.prevEdge || ci.prevEdge === cj.nextEdge)) ||
          (!bevEdgeSet.has(ci.nextEdge) && (ci.nextEdge === cj.prevEdge || ci.nextEdge === cj.nextEdge))
        ) {
          union(i, j);
        }
      }
    }

    const clusters = new Map<number, number[]>();
    for (let i = 0; i < corners.length; i++) {
      const r = find(i);
      let list = clusters.get(r);
      if (!list) {
        list = [];
        clusters.set(r, list);
      }
      list.push(i);
    }

    for (const memberIndices of clusters.values()) {
      let avg: Vec3 = [0, 0, 0];
      for (const idx of memberIndices) {
        const c = corners[idx];
        avg = add3(avg, rawCornerPos.get(`${c.fi}_${c.k}`)!);
      }
      avg = scale3(avg, 1 / memberIndices.length);
      const sharedVi = addVert(avg);
      for (const idx of memberIndices) {
        const c = corners[idx];
        cornerVertIndex.set(`${c.fi}_${c.k}`, sharedVi);
      }
    }
  }

  const getFaceCornerVert = (fi: number, k: number): number => {
    const origVi = mesh.faces[fi].verts[k];
    if (!bevVertSet.has(origVi)) return untouchedVertMap.get(origVi)!;
    return cornerVertIndex.get(`${fi}_${k}`)!;
  };

  const outFaces: MeshFace[] = [];
  const bevelFaceIndices: number[] = [];

  // Step 3: Emit inset original faces
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const face = mesh.faces[fi];
    const m = face.verts.length;
    const newFv: number[] = [];
    for (let k = 0; k < m; k++) {
      newFv.push(getFaceCornerVert(fi, k));
    }
    outFaces.push({
      verts: newFv,
      ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
    });
  }

  // Step 4: Build Bevel Strips along every beveled edge AND store arc vertices at endpoints
  // For each beveled edge `ei` and endpoint `vi` (either e.a or e.b), store ordered arc
  // vertices from `fLeft` corner to `fRight` corner so Step 5 stitches corner patches watertightly!
  interface EndpointArcInfo {
    fromFace: number;
    toFace: number;
    /** Length `segments + 1`: `[corner(fromFace), ...interiorArcVerts, corner(toFace)]` */
    verts: number[];
  }
  const vertexArcs = new Map<number, EndpointArcInfo[]>();

  for (const ei of validEdges) {
    const edge = adj.edges[ei];
    const [f0, f1] = edge.faces;

    // Orient edge so fL traverses a -> b and fR traverses b -> a
    let fL = f0;
    let fR = f1;
    const f0Verts = mesh.faces[f0].verts;
    let f0Forward = false;
    for (let k = 0; k < f0Verts.length; k++) {
      if (f0Verts[k] === edge.a && f0Verts[(k + 1) % f0Verts.length] === edge.b) {
        f0Forward = true;
        break;
      }
    }
    if (!f0Forward) {
      fL = f1;
      fR = f0;
    }

    const findLocalIdx = (fi: number, vi: number) => mesh.faces[fi].verts.indexOf(vi);
    const cLa = getFaceCornerVert(fL, findLocalIdx(fL, edge.a));
    const cLb = getFaceCornerVert(fL, findLocalIdx(fL, edge.b));
    const cRa = getFaceCornerVert(fR, findLocalIdx(fR, edge.a));
    const cRb = getFaceCornerVert(fR, findLocalIdx(fR, edge.b));

    // Compute Rational Bézier weight for exact circular arc when profile = 0.5
    const nL = adj.faceNormals[fL];
    const nR = adj.faceNormals[fR];
    const cosTheta = Math.max(-0.999, Math.min(0.999, dot3(nL, nR)));
    const theta = Math.acos(cosTheta);
    const circleWeight = Math.max(0.05, Math.cos(theta * 0.5));
    // Map profile in [0..1]: 0 -> flat chord (weight->0), 0.5 -> circleWeight, 1 -> sharp corner
    const bezierWeight =
      profile <= 0.5
        ? Math.max(1e-3, (profile / 0.5) * circleWeight)
        : circleWeight + ((profile - 0.5) / 0.5) * 4.0;

    // Project sharp apex control point for each endpoint onto the plane perpendicular to edge
    const edgeDir = normalize3(sub3(mesh.vertices[edge.b], mesh.vertices[edge.a]), [1, 0, 0]);
    const computeEndpointApex = (origVi: number, pStart: Vec3, pEnd: Vec3): Vec3 => {
      const midChord = lerp3(pStart, pEnd, 0.5);
      const origP = mesh.vertices[origVi];
      // Slide origP along edgeDir so it lies in the same cross-sectional plane as midChord
      const along = dot3(sub3(midChord, origP), edgeDir);
      return add3(origP, scale3(edgeDir, along));
    };

    const apexA = computeEndpointApex(edge.a, outVertices[cLa], outVertices[cRa]);
    const apexB = computeEndpointApex(edge.b, outVertices[cLb], outVertices[cRb]);

    const arcA: number[] = [cLa];
    const arcB: number[] = [cLb];

    for (let s = 1; s < segments; s++) {
      const t = s / segments;
      const pa =
        profile <= 1e-4
          ? lerp3(outVertices[cLa], outVertices[cRa], t)
          : evalRationalQuadraticBezier(outVertices[cLa], apexA, outVertices[cRa], bezierWeight, t);
      const pb =
        profile <= 1e-4
          ? lerp3(outVertices[cLb], outVertices[cRb], t)
          : evalRationalQuadraticBezier(outVertices[cLb], apexB, outVertices[cRb], bezierWeight, t);
      arcA.push(addVert(pa));
      arcB.push(addVert(pb));
    }
    arcA.push(cRa);
    arcB.push(cRb);

    // Emit `segments` quad faces along the edge strip!
    // Check winding: in fL, edge goes a -> b, so fL's shrunk edge goes cLa -> cLb;
    // therefore adjacent bevel strip must traverse cLb -> cLa on the fL side so outward normal aligns!
    const matIdx = mesh.faces[fL].materialIndex;
    for (let s = 0; s < segments; s++) {
      bevelFaceIndices.push(outFaces.length);
      outFaces.push({
        verts: [arcB[s], arcA[s], arcA[s + 1], arcB[s + 1]],
        ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
      });
    }

    for (const [vi, info] of [
      [edge.a, { fromFace: fL, toFace: fR, verts: arcA }] as const,
      [edge.b, { fromFace: fR, toFace: fL, verts: [...arcB].reverse() }] as const,
    ]) {
      let arr = vertexArcs.get(vi);
      if (!arr) {
        arr = [];
        vertexArcs.set(vi, arr);
      }
      arr.push(info);
    }
  }

  // Step 5: Build Corner Polygons / Smooth Fillet Corner Patches at vertices with >= 2 beveled edges,
  // AND stitch single-bevel-edge terminations (`singleBevelVertSet`) watertightly into adjacent end faces!
  for (const vi of singleBevelVertSet) {
    const arcs = vertexArcs.get(vi);
    if (!arcs || arcs.length !== 1) continue;
    const arcInfo = arcs[0]; // fromFace -> toFace with `verts = [cFrom, ...mid, cTo]`
    const incFaces = adj.vertexFaces[vi] ?? [];
    const nonBevFaces = incFaces.filter((fi) => fi !== arcInfo.fromFace && fi !== arcInfo.toFace);
    if (nonBevFaces.length === 1) {
      // Standard valence-3 corner (e.g. box/prism end cap): splice the fillet arc directly into `endFi`!
      const endFi = nonBevFaces[0];
      const origFv = mesh.faces[endFi].verts;
      const m = origFv.length;
      const k = origFv.indexOf(vi);
      if (k !== -1) {
        const prevV = origFv[(k - 1 + m) % m];
        const inEdge = adj.edgeKeyToIndex.get(canonicalEdgeKey(prevV, vi))!;
        const sharesWithFrom = adj.edges[inEdge].faces.includes(arcInfo.fromFace);
        const orderedArc = sharesWithFrom ? arcInfo.verts : [...arcInfo.verts].reverse();
        const currentOut = outFaces[endFi].verts;
        const placeholderVi = getFaceCornerVert(endFi, k);
        const posInOut = currentOut.indexOf(placeholderVi);
        if (posInOut !== -1) {
          currentOut.splice(posInOut, 1, ...orderedArc);
        }
      }
    } else if (nonBevFaces.length >= 2) {
      // Higher-valence single-edge termination: splice cFrom into neighbor of fromFace, cTo into neighbor of toFace, and fan arc to fallbackVi!
      const placeholderVi = getFaceCornerVert(nonBevFaces[0], mesh.faces[nonBevFaces[0]].verts.indexOf(vi));
      const cFrom = arcInfo.verts[0];
      const cTo = arcInfo.verts[arcInfo.verts.length - 1];
      for (const endFi of nonBevFaces) {
        const origFv = mesh.faces[endFi].verts;
        const m = origFv.length;
        const k = origFv.indexOf(vi);
        if (k === -1) continue;
        const prevV = origFv[(k - 1 + m) % m];
        const nextV = origFv[(k + 1) % m];
        const inEdge = adj.edgeKeyToIndex.get(canonicalEdgeKey(prevV, vi))!;
        const outEdge = adj.edgeKeyToIndex.get(canonicalEdgeKey(vi, nextV))!;
        const currentOut = outFaces[endFi].verts;
        const posInOut = currentOut.indexOf(placeholderVi);
        if (posInOut === -1) continue;
        const repl: number[] = [];
        if (adj.edges[inEdge].faces.includes(arcInfo.fromFace)) repl.push(cFrom);
        if (adj.edges[inEdge].faces.includes(arcInfo.toFace)) repl.push(cTo);
        repl.push(placeholderVi);
        if (adj.edges[outEdge].faces.includes(arcInfo.fromFace)) repl.push(cFrom);
        if (adj.edges[outEdge].faces.includes(arcInfo.toFace)) repl.push(cTo);
        currentOut.splice(posInOut, 1, ...repl);
      }
      // Cap triangle fan between placeholderVi and arcInfo.verts
      const matIdx = mesh.faces[arcInfo.fromFace].materialIndex;
      const testPoly = [placeholderVi, ...arcInfo.verts];
      const flip = dot3(computeFaceNormal(outVertices, testPoly), adj.vertexNormals[vi]) < 0;
      for (let s = 0; s < arcInfo.verts.length - 1; s++) {
        const a0 = arcInfo.verts[s];
        const a1 = arcInfo.verts[s + 1];
        bevelFaceIndices.push(outFaces.length);
        outFaces.push({
          verts: flip ? [placeholderVi, a1, a0] : [placeholderVi, a0, a1],
          ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
        });
      }
    }
  }

  for (const [vi, arcs] of vertexArcs.entries()) {
    if (arcs.length < 2) continue;

    // Order faces around `vi` in CCW order around vertexNormal[vi]
    const incFaces = adj.vertexFaces[vi] ?? [];
    // Notice each arc transitions from `fromFace` to `toFace` across a beveled edge!
    // Across an UNBEVELED edge between fX and fY, `corner(fX) === corner(fY)` (already unified in Step 2!).
    // Let's walk the cyclic fan of faces around `vi` using half-edges!
    const nextFaceAroundVert = new Map<number, { nextFace: number; sharedEdge: number }>();
    for (const fi of incFaces) {
      const fv = mesh.faces[fi].verts;
      const m = fv.length;
      const k = fv.indexOf(vi);
      if (k === -1) continue;
      // Incoming edge to vi in fi is (fv[k-1] -> vi); outgoing edge is (vi -> fv[k+1]).
      // Walking around vi consistent with outward normal: from `fi`, cross incoming edge `(fv[k-1], vi)`!
      const prevV = fv[(k - 1 + m) % m];
      const inEdgeIdx = adj.edgeKeyToIndex.get(canonicalEdgeKey(prevV, vi))!;
      const otherFace = adj.edges[inEdgeIdx].faces.find((f) => f !== fi);
      if (otherFace !== undefined) {
        nextFaceAroundVert.set(fi, { nextFace: otherFace, sharedEdge: inEdgeIdx });
      }
    }

    // Only close interior closed fans
    if (nextFaceAroundVert.size !== incFaces.length) continue;

    const orderedFaces: number[] = [];
    const orderedEdges: number[] = [];
    let currF = incFaces[0];
    const seenF = new Set<number>();
    while (!seenF.has(currF)) {
      seenF.add(currF);
      orderedFaces.push(currF);
      const step = nextFaceAroundVert.get(currF);
      if (!step) break;
      orderedEdges.push(step.sharedEdge);
      currF = step.nextFace;
    }
    if (orderedFaces.length !== incFaces.length) continue;

    // Assemble the closed perimeter of vertex indices around the corner patch!
    const perimeter: number[] = [];
    for (let idx = 0; idx < orderedFaces.length; idx++) {
      const fCurr = orderedFaces[idx];
      const fNext = orderedFaces[(idx + 1) % orderedFaces.length];
      const sharedEi = orderedEdges[idx];

      if (bevEdgeSet.has(sharedEi)) {
        // Find matching arc between fCurr and fNext
        const forwardArc = arcs.find((a) => a.fromFace === fCurr && a.toFace === fNext);
        const reverseArc = arcs.find((a) => a.fromFace === fNext && a.toFace === fCurr);
        const arcVerts = forwardArc
          ? forwardArc.verts
          : reverseArc
            ? [...reverseArc.verts].reverse()
            : [
                getFaceCornerVert(fCurr, mesh.faces[fCurr].verts.indexOf(vi)),
                getFaceCornerVert(fNext, mesh.faces[fNext].verts.indexOf(vi)),
              ];
        // Push all except last (which starts the next segment)
        for (let s = 0; s < arcVerts.length - 1; s++) {
          if (perimeter.length === 0 || perimeter[perimeter.length - 1] !== arcVerts[s]) {
            perimeter.push(arcVerts[s]);
          }
        }
      } else {
        // Unbeveled edge: fCurr and fNext share the same corner vertex
        const cv = getFaceCornerVert(fCurr, mesh.faces[fCurr].verts.indexOf(vi));
        if (perimeter.length === 0 || perimeter[perimeter.length - 1] !== cv) {
          perimeter.push(cv);
        }
      }
    }
    while (perimeter.length >= 2 && perimeter[0] === perimeter[perimeter.length - 1]) {
      perimeter.pop();
    }
    if (perimeter.length < 3) continue;

    // Ensure perimeter winding faces outward (aligned with vertexNormal[vi])
    const testN = computeFaceNormal(outVertices, perimeter);
    if (dot3(testN, adj.vertexNormals[vi]) < 0) {
      perimeter.reverse();
    }

    const matIdx = mesh.faces[orderedFaces[0]].materialIndex;

    if (segments === 1 || arcs.length < 2) {
      // Chamfer: crisp single corner polygon (triangle on 3-edge box corner, quad on 4-edge apex, etc.)
      bevelFaceIndices.push(outFaces.length);
      outFaces.push({
        verts: perimeter,
        ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
      });
    } else {
      // Smooth Fillet (`segments >= 2`): build concentric curved dome rings projecting onto the fillet sphere!
      // Compute corner base centroid & sphere center for smooth fillet curvature:
      const faceCornerVerts = orderedFaces.map((fi) =>
        getFaceCornerVert(fi, mesh.faces[fi].verts.indexOf(vi)),
      );
      const uniqueCornerPts: Vec3[] = [...new Set(faceCornerVerts)].map((idx) => outVertices[idx]);
      let baseCentroid: Vec3 = [0, 0, 0];
      for (const p of uniqueCornerPts) baseCentroid = add3(baseCentroid, p);
      baseCentroid = scale3(baseCentroid, 1 / uniqueCornerPts.length);

      const origCorner = mesh.vertices[vi];
      // Compute arc midpoints average to gauge exact fillet dome height!
      let arcMidSum: Vec3 = [0, 0, 0];
      for (const a of arcs) {
        const midPt = evalRationalQuadraticBezier(
          outVertices[a.verts[0]],
          origCorner,
          outVertices[a.verts[a.verts.length - 1]],
          0.7071,
          0.5,
        );
        arcMidSum = add3(arcMidSum, midPt);
      }
      arcMidSum = scale3(arcMidSum, 1 / arcs.length);

      // Sphere center estimation: on a cube corner of inset `w`, `origCorner` is `(1,1,1)`,
      // `uniqueCornerPts` are `(1-w,1-w,1), (1,1-w,1-w), (1-w,1,1-w)`.
      // Notice `sphereCenter = origCorner + sum_of_unique_offsets`? Let's check!
      // On a 3-face orthogonal corner, offsets are `(-w,-w,0), (0,-w,-w), (-w,0,-w)` -> sum is `(-2w,-2w,-2w)`,
      // so half-sum is `(-w,-w,-w)` -> `sphereCenter = (1-w, 1-w, 1-w)`!!
      // Let's generalize for ANY valence `d`: least-squares / average normal offset!
      // Even simpler & exact for ALL regular/general corners:
      // The vector `u = origCorner - baseCentroid` points along the corner axis!
      // On a cube corner: `baseCentroid = (1 - 2w/3, 1 - 2w/3, 1 - 2w/3)`, `origCorner = (1,1,1)`,
      // `sphereCenter = (1-w, 1-w, 1-w) = origCorner - (3/2)*(origCorner - baseCentroid)`!
      // In general, find scalar `alpha` along axis `axis = normalize(origCorner - baseCentroid)`
      // so sphere center `O = baseCentroid - s * axis` has equal distance `R` to `uniqueCornerPts` and `arcMidSum`!
      const axisRaw = sub3(origCorner, baseCentroid);
      const axisLen = len3(axisRaw);
      let domeApex = lerp3(baseCentroid, origCorner, profile * 1.15);
      let sphereCenter: Vec3 | null = null;
      let sphereRadius = 0;

      if (axisLen > 1e-6 && profile > 0.05) {
        const axis = scale3(axisRaw, 1 / axisLen);
        // Mean squared radial distance of base corners perpendicular to `axis`:
        let rPerpSq = 0;
        for (const p of uniqueCornerPts) {
          const rel = sub3(p, baseCentroid);
          const perp = sub3(rel, scale3(axis, dot3(rel, axis)));
          rPerpSq += dot3(perp, perp);
        }
        rPerpSq /= uniqueCornerPts.length;
        // Height of arc midpoints above baseCentroid along `axis`:
        const hArc = Math.max(0, dot3(sub3(arcMidSum, baseCentroid), axis));
        // On a sphere passing through (rPerp, 0) and (rArcMid, hArc), dome apex height hApex:
        // For cube corner: rPerp = sqrt(2/3)*w, sphere R = w, s = w/sqrt(3), so hApex = R - s = w*(1 - 1/sqrt(3)) ≈ 0.42265 * w!
        // Notice `axisLen` on cube corner is `(2/sqrt(3))*w`? Wait: `|(2w/3, 2w/3, 2w/3)| = (2/sqrt(3))*w = 1.1547*w`!
        // And `(1 - 1/sqrt(3)) / (2/sqrt(3)) = (sqrt(3) - 1) / 2 ≈ 0.366025`!!
        // Let's check from sphere equation: R^2 = rPerpSq + s^2! And tangent planes have normal dot axis = cos(phi) = rPerp / R?
        // Actually we KNOW the face normals `n_f`! For each incident face `f`, the sphere of radius `R` tangent to `f` at `p_f` has center `O = p_f - R * n_f`!
        // Look at that identity: `(p_f - O) = R * n_f` => `(p_f - p_g) · (n_f - n_g) = R * |n_f - n_g|^2`!!
        let numR = 0;
        let denR = 0;
        for (let a = 0; a < orderedFaces.length; a++) {
          const b = (a + 1) % orderedFaces.length;
          const pa = outVertices[faceCornerVerts[a]];
          const pb = outVertices[faceCornerVerts[b]];
          const na = adj.faceNormals[orderedFaces[a]];
          const nb = adj.faceNormals[orderedFaces[b]];
          const dp = sub3(pa, pb);
          const dn = sub3(na, nb);
          numR += Math.abs(dot3(dp, dn));
          denR += dot3(dn, dn);
        }
        if (denR > 1e-6) {
          sphereRadius = numR / denR;
          let centerSum: Vec3 = [0, 0, 0];
          for (let a = 0; a < orderedFaces.length; a++) {
            const pa = outVertices[faceCornerVerts[a]];
            const na = adj.faceNormals[orderedFaces[a]];
            centerSum = add3(centerSum, sub3(pa, scale3(na, sphereRadius)));
          }
          sphereCenter = scale3(centerSum, 1 / orderedFaces.length);
          const outDir = normalize3(sub3(origCorner, sphereCenter), adj.vertexNormals[vi]);
          const sphericalApex = add3(sphereCenter, scale3(outDir, sphereRadius));
          // Blend sphericalApex with profile (profile=0.5 -> exact sphericalApex!)
          domeApex =
            profile <= 0.5
              ? lerp3(baseCentroid, sphericalApex, profile / 0.5)
              : lerp3(sphericalApex, origCorner, Math.min(0.85, (profile - 0.5) / 0.5));
        }
      }

      const ringCount = Math.max(1, Math.ceil(segments / 2));
      const P = perimeter.length;
      let prevRing = perimeter;

      for (let r = 1; r < ringCount; r++) {
        const u = r / ringCount; // 0 = perimeter, 1 = center
        const currRing: number[] = [];
        for (let idx = 0; idx < P; idx++) {
          const pPerim = outVertices[perimeter[idx]];
          const linearPt = lerp3(pPerim, domeApex, u);
          let finalPt = linearPt;
          if (sphereCenter && sphereRadius > 1e-6 && profile > 0.05) {
            const radial = normalize3(sub3(linearPt, sphereCenter), adj.vertexNormals[vi]);
            const onSphere = add3(sphereCenter, scale3(radial, sphereRadius));
            const sphereBlend = profile <= 0.5 ? profile / 0.5 : 1;
            finalPt = lerp3(linearPt, onSphere, sphereBlend * Math.sin((u * Math.PI) / 2));
          }
          currRing.push(addVert(finalPt));
        }
        for (let idx = 0; idx < P; idx++) {
          const nextIdx = (idx + 1) % P;
          bevelFaceIndices.push(outFaces.length);
          outFaces.push({
            verts: [prevRing[idx], prevRing[nextIdx], currRing[nextIdx], currRing[idx]],
            ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
          });
        }
        prevRing = currRing;
      }

      // Center cap: fan into clean quads (pairing adjacent segments) + at most 1 triangle if odd
      const centerVi = addVert(domeApex);
      let idx = 0;
      while (idx + 2 <= P) {
        if (idx + 2 === P - 1) {
          // 3 left: 1 quad + 1 triangle
          bevelFaceIndices.push(outFaces.length);
          outFaces.push({
            verts: [prevRing[idx], prevRing[idx + 1], prevRing[idx + 2], centerVi],
            ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
          });
          bevelFaceIndices.push(outFaces.length);
          outFaces.push({
            verts: [prevRing[idx + 2], prevRing[0], centerVi],
            ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
          });
          idx = P;
          break;
        }
        bevelFaceIndices.push(outFaces.length);
        outFaces.push({
          verts: [prevRing[idx], prevRing[idx + 1], prevRing[(idx + 2) % P], centerVi],
          ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
        });
        idx += 2;
      }
      if (idx < P) {
        bevelFaceIndices.push(outFaces.length);
        outFaces.push({
          verts: [prevRing[idx], prevRing[(idx + 1) % P], centerVi],
          ...(matIdx !== undefined ? { materialIndex: matIdx } : {}),
        });
      }
    }
  }

  const resultMesh = compactEditableMesh({
    vertices: outVertices,
    faces: outFaces,
    ...(mesh.phongAngleDeg !== undefined ? { phongAngleDeg: mesh.phongAngleDeg } : {}),
  });
  const resultSel = convertSelection(
    resultMesh,
    { mode: 'polygon', vertices: [], edges: [], faces: bevelFaceIndices.filter((f) => f < resultMesh.faces.length) },
    'edge',
  );
  return { mesh: resultMesh, selection: resultSel };
}

/**
 * Cinema 4D Loop Cut (`K`): slices an entire parallel quad ring cleanly at `factor ∈ (0, 1)`
 * (or `cuts` evenly spaced cuts) and returns the newly inserted edge loop indices selected.
 */
export function loopCut(
  mesh: EditableMeshData,
  edgeIndex: number,
  params?: { factor?: number; cuts?: number },
): MeshOperationResult {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const ring = traceDirectedEdgeRing(mesh, adj, edgeIndex);
  if (ring.length === 0) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('edge') };
  }

  const cuts = Math.max(1, Math.min(32, Math.round(params?.cuts ?? 1)));
  const rawFactor = Math.max(0.02, Math.min(0.98, params?.factor ?? 0.5));
  const factors: number[] =
    cuts === 1
      ? [rawFactor]
      : Array.from({ length: cuts }, (_, c) => {
          const base = (c + 1) / (cuts + 1);
          const shift = (rawFactor - 0.5) / (cuts + 1);
          return Math.max(0.02, Math.min(0.98, base + shift));
        });

  const next = cloneEditableMesh(mesh);
  // Map each ring edgeIndex -> { u, v, newVerts: number[] }
  const splitInfo = new Map<number, { u: number; v: number; cutVerts: number[] }>();
  for (const entry of ring) {
    const pu = next.vertices[entry.u];
    const pv = next.vertices[entry.v];
    const cutVerts = factors.map((t) => {
      const idx = next.vertices.length;
      next.vertices.push(lerp3(pu, pv, t));
      return idx;
    });
    splitInfo.set(entry.edgeIndex, { u: entry.u, v: entry.v, cutVerts });
  }

  const newFaces: MeshFace[] = [];
  const loopEdgePairs: [number, number][] = [];

  for (let fi = 0; fi < next.faces.length; fi++) {
    const face = next.faces[fi];
    const m = face.verts.length;

    if (m === 4) {
      // Check if two opposite edges of this quad are in `splitInfo`
      const e0 = adj.edgeKeyToIndex.get(canonicalEdgeKey(face.verts[0], face.verts[1]))!;
      const e1 = adj.edgeKeyToIndex.get(canonicalEdgeKey(face.verts[1], face.verts[2]))!;
      const e2 = adj.edgeKeyToIndex.get(canonicalEdgeKey(face.verts[2], face.verts[3]))!;
      const e3 = adj.edgeKeyToIndex.get(canonicalEdgeKey(face.verts[3], face.verts[0]))!;

      const pair02 = splitInfo.has(e0) && splitInfo.has(e2);
      const pair13 = splitInfo.has(e1) && splitInfo.has(e3);

      if (pair02 || pair13) {
        const rot = pair02 ? 0 : 1;
        const v0 = face.verts[rot];
        const v1 = face.verts[(rot + 1) % 4];
        const v2 = face.verts[(rot + 2) % 4];
        const v3 = face.verts[(rot + 3) % 4];

        const eA = adj.edgeKeyToIndex.get(canonicalEdgeKey(v0, v1))!;
        const eB = adj.edgeKeyToIndex.get(canonicalEdgeKey(v3, v2))!;
        const infoA = splitInfo.get(eA)!;
        const infoB = splitInfo.get(eB)!;

        // Cuts ordered from v0 -> v1 on side A and v3 -> v2 on side B
        const cutsA = infoA.u === v0 ? infoA.cutVerts : [...infoA.cutVerts].reverse();
        const cutsB = infoB.u === v3 ? infoB.cutVerts : [...infoB.cutVerts].reverse();

        const chainA = [v0, ...cutsA, v1];
        const chainB = [v3, ...cutsB, v2];
        for (let c = 0; c < cuts; c++) {
          loopEdgePairs.push([cutsA[c], cutsB[c]]);
        }
        for (let s = 0; s <= cuts; s++) {
          newFaces.push({
            verts: [chainA[s], chainA[s + 1], chainB[s + 1], chainB[s]],
            ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
          });
        }
        continue;
      }
    }

    // Non-quad or end-cap face touching a split edge: splice new vertices in-order along split edges (zero T-junctions)
    const spliced: number[] = [];
    for (let k = 0; k < m; k++) {
      const a = face.verts[k];
      const b = face.verts[(k + 1) % m];
      spliced.push(a);
      const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(a, b))!;
      const info = splitInfo.get(ei);
      if (info) {
        const ordered = info.u === a ? info.cutVerts : [...info.cutVerts].reverse();
        spliced.push(...ordered);
      }
    }
    newFaces.push({
      verts: spliced,
      ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
    });
  }

  next.faces = newFaces;
  const newAdj = buildHalfEdgeOrAdjacency(next);
  const newEdgeIndices: number[] = [];
  for (const [a, b] of loopEdgePairs) {
    const ei = newAdj.edgeKeyToIndex.get(canonicalEdgeKey(a, b));
    if (ei !== undefined && !newEdgeIndices.includes(ei)) newEdgeIndices.push(ei);
  }
  newEdgeIndices.sort((a, b) => a - b);

  return {
    mesh: next,
    selection: { mode: 'edge', vertices: [], edges: newEdgeIndices, faces: [] },
  };
}

/** Orders an open or closed chain of edges into a vertex polyline. */
function orderEdgeChainVertices(
  mesh: EditableMeshData,
  adj: MeshAdjacency,
  edgeIndices: readonly number[],
): number[] {
  const valid = edgeIndices.filter((ei) => ei >= 0 && ei < adj.edges.length);
  if (valid.length === 0) return [];
  if (valid.length === 1) {
    const e = adj.edges[valid[0]];
    // Orient consistent with boundary face if available
    if (e.faces.length === 1) {
      const fv = mesh.faces[e.faces[0]].verts;
      for (let i = 0; i < fv.length; i++) {
        const u = fv[i];
        const v = fv[(i + 1) % fv.length];
        if ((u === e.a && v === e.b) || (u === e.b && v === e.a)) {
          return [u, v];
        }
      }
    }
    return [e.a, e.b];
  }

  const nbrs = new Map<number, number[]>();
  const addNbr = (u: number, v: number) => {
    let arr = nbrs.get(u);
    if (!arr) {
      arr = [];
      nbrs.set(u, arr);
    }
    arr.push(v);
  };
  for (const ei of valid) {
    const e = adj.edges[ei];
    addNbr(e.a, e.b);
    addNbr(e.b, e.a);
  }

  // Start at a degree-1 endpoint if open chain; otherwise first vertex
  let startV = adj.edges[valid[0]].a;
  for (const [v, list] of nbrs.entries()) {
    if (list.length === 1) {
      startV = v;
      break;
    }
  }

  const chain = [startV];
  const visitedEdges = new Set<string>();
  let curr = startV;
  while (true) {
    const candidates = nbrs.get(curr) ?? [];
    const nextV = candidates.find((cand) => !visitedEdges.has(canonicalEdgeKey(curr, cand)));
    if (nextV === undefined) break;
    visitedEdges.add(canonicalEdgeKey(curr, nextV));
    chain.push(nextV);
    curr = nextV;
  }
  return chain;
}

/** Builds clean quad bridge faces connecting two open edge chains (`edgeAIndices` & `edgeBIndices`). */
export function bridgeEdges(
  mesh: EditableMeshData,
  edgeAIndices: readonly number[],
  edgeBIndices: readonly number[],
): MeshOperationResult {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const chainA = orderEdgeChainVertices(mesh, adj, edgeAIndices);
  let chainB = orderEdgeChainVertices(mesh, adj, edgeBIndices);
  if (chainA.length < 2 || chainB.length < 2) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('polygon') };
  }

  // ChoosechainB direction to prevent self-crossing X-twist
  const directDist =
    dist3(mesh.vertices[chainA[0]], mesh.vertices[chainB[0]]) +
    dist3(mesh.vertices[chainA[chainA.length - 1]], mesh.vertices[chainB[chainB.length - 1]]);
  const revDist =
    dist3(mesh.vertices[chainA[0]], mesh.vertices[chainB[chainB.length - 1]]) +
    dist3(mesh.vertices[chainA[chainA.length - 1]], mesh.vertices[chainB[0]]);
  if (revDist < directDist) {
    chainB = [...chainB].reverse();
  }

  // Orient quad winding consistent with adjacent face on chainA[0]->chainA[1] if present
  let flipWinding = false;
  const firstEdgeIdx = adj.edgeKeyToIndex.get(canonicalEdgeKey(chainA[0], chainA[1]));
  if (firstEdgeIdx !== undefined && adj.edges[firstEdgeIdx].faces.length === 1) {
    const fv = mesh.faces[adj.edges[firstEdgeIdx].faces[0]].verts;
    for (let i = 0; i < fv.length; i++) {
      if (fv[i] === chainA[0] && fv[(i + 1) % fv.length] === chainA[1]) {
        // Existing face already uses chainA[0]->chainA[1], so bridge face must use chainA[1]->chainA[0]
        flipWinding = true;
        break;
      }
    }
  }

  const next = cloneEditableMesh(mesh);
  const createdFaces: number[] = [];
  const segA = chainA.length - 1;
  const segB = chainB.length - 1;
  const count = Math.min(segA, segB);

  for (let i = 0; i < count; i++) {
    const a0 = chainA[i];
    const a1 = chainA[i + 1];
    const b0 = chainB[i];
    const b1 = chainB[i + 1];
    const verts = flipWinding ? [a1, a0, b0, b1] : [a0, a1, b1, b0];
    createdFaces.push(next.faces.length);
    next.faces.push({ verts });
  }

  return {
    mesh: next,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: createdFaces },
  };
}

/** Slides selected edges along transverse incident mesh edges (`delta ∈ [-1, 1]`). */
export function slideEdges(
  mesh: EditableMeshData,
  edgeIndices: readonly number[],
  delta: number,
): MeshOperationResult {
  const clamped = Math.max(-0.95, Math.min(0.95, delta));
  if (Math.abs(clamped) < 1e-6 || edgeIndices.length === 0) {
    return {
      mesh: cloneEditableMesh(mesh),
      selection: { mode: 'edge', vertices: [], edges: [...edgeIndices], faces: [] },
    };
  }

  const next = cloneEditableMesh(mesh);
  const adj = buildHalfEdgeOrAdjacency(next);
  const selSet = new Set(edgeIndices);
  const selVerts = new Set<number>();
  for (const ei of edgeIndices) {
    const e = adj.edges[ei];
    if (e) {
      selVerts.add(e.a);
      selVerts.add(e.b);
    }
  }

  // Establish a coherent reference direction perpendicular to the edge loop
  let refDir: Vec3 | null = null;
  for (const ei of edgeIndices) {
    const e = adj.edges[ei];
    if (e && e.faces.length >= 1) {
      const tangent = normalize3(sub3(next.vertices[e.b], next.vertices[e.a]), [1, 0, 0]);
      refDir = normalize3(cross3(adj.faceNormals[e.faces[0]], tangent), [0, 0, 1]);
      break;
    }
  }
  const slideDir = refDir ?? [1, 0, 0];

  for (const vi of selVerts) {
    const transverseNeighbors: number[] = [];
    for (const ei of adj.vertexEdges[vi] ?? []) {
      if (selSet.has(ei)) continue;
      const e = adj.edges[ei];
      const other = e.a === vi ? e.b : e.a;
      if (!selVerts.has(other)) transverseNeighbors.push(other);
    }
    if (transverseNeighbors.length === 0) continue;

    const p = mesh.vertices[vi];
    // Pick neighbor aligned with +slideDir (if delta > 0) or -slideDir (if delta < 0)
    let bestTarget: Vec3 | null = null;
    let bestScore = -Infinity;
    const signDir = clamped >= 0 ? slideDir : scale3(slideDir, -1);
    for (const nb of transverseNeighbors) {
      const dir = normalize3(sub3(mesh.vertices[nb], p), [0, 0, 0]);
      const score = dot3(dir, signDir);
      if (score > bestScore) {
        bestScore = score;
        bestTarget = mesh.vertices[nb];
      }
    }
    if (bestTarget) {
      next.vertices[vi] = lerp3(p, bestTarget, Math.abs(clamped));
    }
  }

  return {
    mesh: next,
    selection: { mode: 'edge', vertices: [], edges: [...edgeIndices], faces: [] },
  };
}

/** Dissolves interior edges by splicing their two incident faces into a single quad or n-gon. */
export function dissolveEdges(
  mesh: EditableMeshData,
  edgeIndices: readonly number[],
): MeshOperationResult {
  let curr = cloneEditableMesh(mesh);
  // Track dissolved edges by endpoint vertex pair so indices staying updated across merges are exact
  const initialAdj = buildHalfEdgeOrAdjacency(curr);
  const targetPairs: [number, number][] = [];
  for (const ei of edgeIndices) {
    const e = initialAdj.edges[ei];
    if (e && !e.isBoundary && e.faces.length === 2) {
      targetPairs.push([e.a, e.b]);
    }
  }

  for (const [u, v] of targetPairs) {
    const adj = buildHalfEdgeOrAdjacency(curr);
    const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(u, v));
    if (ei === undefined) continue;
    const edge = adj.edges[ei];
    if (edge.faces.length !== 2) continue;

    const [fAIdx, fBIdx] = edge.faces;
    const vA = curr.faces[fAIdx].verts;
    const vB = curr.faces[fBIdx].verts;

    // Find directed occurrence in fA: say vA[iA] -> vA[(iA+1)%nA] is x -> y, then fB has y -> x
    let iA = -1;
    let x = u;
    let y = v;
    for (let i = 0; i < vA.length; i++) {
      const a0 = vA[i];
      const a1 = vA[(i + 1) % vA.length];
      if ((a0 === u && a1 === v) || (a0 === v && a1 === u)) {
        iA = i;
        x = a0;
        y = a1;
        break;
      }
    }
    if (iA === -1) continue;

    let iB = -1;
    for (let j = 0; j < vB.length; j++) {
      if (vB[j] === y && vB[(j + 1) % vB.length] === x) {
        iB = j;
        break;
      }
    }
    if (iB === -1) continue;

    // Splice: walk fA from y..(around)..x, then walk fB from x..(around)..y
    const merged: number[] = [];
    for (let step = 1; step < vA.length; step++) {
      merged.push(vA[(iA + step) % vA.length]);
    }
    for (let step = 1; step < vB.length; step++) {
      merged.push(vB[(iB + step) % vB.length]);
    }

    // Strip any degree-1 spurs `[..., p, q, p, ...]`
    let changed = true;
    while (changed && merged.length >= 3) {
      changed = false;
      for (let k = 0; k < merged.length; k++) {
        const prev = merged[(k - 1 + merged.length) % merged.length];
        const nextV = merged[(k + 1) % merged.length];
        if (prev === nextV) {
          merged.splice(k, 1);
          const dupIdx = k % merged.length;
          merged.splice(dupIdx, 1);
          changed = true;
          break;
        }
      }
    }

    if (merged.length >= 3) {
      const matIdx = curr.faces[fAIdx].materialIndex;
      const kept = curr.faces.filter((_, fi) => fi !== fAIdx && fi !== fBIdx);
      kept.push({ verts: merged, ...(matIdx !== undefined ? { materialIndex: matIdx } : {}) });
      curr.faces = kept;
    }
  }

  return { mesh: compactEditableMesh(curr), selection: createEmptySelection('edge') };
}

/** Collapses each connected group of selected edges into its midpoint vertex. */
export function collapseEdges(
  mesh: EditableMeshData,
  edgeIndices: readonly number[],
): MeshOperationResult {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const valid = edgeIndices.filter((ei) => ei >= 0 && ei < adj.edges.length);
  if (valid.length === 0) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('point') };
  }

  const parent = Array.from({ length: mesh.vertices.length }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (const ei of valid) {
    const e = adj.edges[ei];
    const ra = find(e.a);
    const rb = find(e.b);
    if (ra !== rb) parent[rb] = ra;
  }

  const groups = new Map<number, number[]>();
  for (let vi = 0; vi < mesh.vertices.length; vi++) {
    const r = find(vi);
    let g = groups.get(r);
    if (!g) {
      g = [];
      groups.set(r, g);
    }
    g.push(vi);
  }

  const next = cloneEditableMesh(mesh);
  for (const [root, members] of groups.entries()) {
    if (members.length < 2) continue;
    let sum: Vec3 = [0, 0, 0];
    for (const m of members) sum = add3(sum, mesh.vertices[m]);
    next.vertices[root] = scale3(sum, 1 / members.length);
  }

  for (const f of next.faces) {
    f.verts = f.verts.map((v) => find(v));
  }

  return { mesh: compactEditableMesh(next), selection: createEmptySelection('point') };
}

// ============================================================================
// POINT / VERTEX MANIPULATION
// ============================================================================

/** Chamfers selected vertices by splitting each corner along its incident edges at `width`. */
export function chamferVertices(
  mesh: EditableMeshData,
  vertexIndices: readonly number[],
  params: { width: number },
): MeshOperationResult {
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const validVerts = [...new Set(vertexIndices)].filter(
    (vi) => vi >= 0 && vi < mesh.vertices.length && (adj.vertexFaces[vi]?.length ?? 0) >= 2,
  );
  if (validVerts.length === 0 || params.width <= 1e-6) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('polygon') };
  }

  const selSet = new Set(validVerts);
  const next = cloneEditableMesh(mesh);

  // Create a cut vertex on every directed half-edge `(vi -> other)` for `vi` in selSet
  const cutVertMap = new Map<string, number>();
  for (const vi of validVerts) {
    const p = mesh.vertices[vi];
    for (const ei of adj.vertexEdges[vi] ?? []) {
      const e = adj.edges[ei];
      const other = e.a === vi ? e.b : e.a;
      const q = mesh.vertices[other];
      const len = dist3(p, q);
      const maxFactor = selSet.has(other) ? 0.45 : 0.85;
      const t = len > EPS ? Math.min(maxFactor, params.width / len) : 0.25;
      const newVi = next.vertices.length;
      next.vertices.push(lerp3(p, q, t));
      cutVertMap.set(`${vi}->${other}`, newVi);
    }
  }

  // Replace selected vertices inside every face with the two cut vertices along its incident edges
  const outFaces: MeshFace[] = [];
  for (let fi = 0; fi < mesh.faces.length; fi++) {
    const f = mesh.faces[fi];
    const m = f.verts.length;
    const newVerts: number[] = [];
    for (let k = 0; k < m; k++) {
      const curr = f.verts[k];
      if (!selSet.has(curr)) {
        newVerts.push(curr);
      } else {
        const prev = f.verts[(k - 1 + m) % m];
        const nextV = f.verts[(k + 1) % m];
        const cIn = cutVertMap.get(`${curr}->${prev}`);
        const cOut = cutVertMap.get(`${curr}->${nextV}`);
        if (cIn !== undefined) newVerts.push(cIn);
        if (cOut !== undefined && cOut !== cIn) newVerts.push(cOut);
      }
    }
    outFaces.push({
      verts: newVerts,
      ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
    });
  }

  // Cap each chamfered interior vertex with its ordered cycle of cut vertices
  const capFaces: number[] = [];
  for (const vi of validVerts) {
    const incFaces = adj.vertexFaces[vi] ?? [];
    // Build directed chords across each incident face `(cOut -> cIn)` to trace the cap polygon!
    const chords: [number, number][] = [];
    for (const fi of incFaces) {
      const fv = mesh.faces[fi].verts;
      const m = fv.length;
      const k = fv.indexOf(vi);
      if (k === -1) continue;
      const prev = fv[(k - 1 + m) % m];
      const nextV = fv[(k + 1) % m];
      const cIn = cutVertMap.get(`${vi}->${prev}`);
      const cOut = cutVertMap.get(`${vi}->${nextV}`);
      if (cIn !== undefined && cOut !== undefined && cIn !== cOut) {
        // Trimmed face traversed cIn -> cOut, so adjacent chamfer cap traverses cOut -> cIn!
        chords.push([cOut, cIn]);
      }
    }
    const loops = traceOrderedBoundaryLoops(chords);
    for (const loop of loops) {
      if (loop.length >= 3) {
        const capN = computeFaceNormal(next.vertices, loop);
        if (dot3(capN, adj.vertexNormals[vi]) < 0) loop.reverse();
        capFaces.push(outFaces.length);
        outFaces.push({ verts: loop });
      }
    }
  }

  next.faces = outFaces;
  const compacted = compactEditableMesh(next);
  return {
    mesh: compacted,
    selection: { mode: 'polygon', vertices: [], edges: [], faces: capFaces },
  };
}

/** Welds selected vertices either to their shared centroid (`'center'`) or within `threshold`. */
export function weldVertices(
  mesh: EditableMeshData,
  vertexIndices: readonly number[],
  params: { mode: 'center' | 'threshold'; threshold?: number },
): MeshOperationResult {
  const candidates =
    vertexIndices.length > 0
      ? [...new Set(vertexIndices)].filter((vi) => vi >= 0 && vi < mesh.vertices.length)
      : mesh.vertices.map((_, i) => i);

  if (candidates.length < 2) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('point') };
  }

  const parent = Array.from({ length: mesh.vertices.length }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  if (params.mode === 'center') {
    const first = candidates[0];
    for (let i = 1; i < candidates.length; i++) union(first, candidates[i]);
  } else {
    const thresh = Math.max(1e-7, params.threshold ?? 0.01);
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        const va = candidates[i];
        const vb = candidates[j];
        if (dist3(mesh.vertices[va], mesh.vertices[vb]) <= thresh) {
          union(va, vb);
        }
      }
    }
  }

  const clusters = new Map<number, number[]>();
  for (const vi of candidates) {
    const r = find(vi);
    let arr = clusters.get(r);
    if (!arr) {
      arr = [];
      clusters.set(r, arr);
    }
    arr.push(vi);
  }

  const next = cloneEditableMesh(mesh);
  const weldedRoots = new Set<number>();
  for (const [root, members] of clusters.entries()) {
    if (members.length < 2) continue;
    let sum: Vec3 = [0, 0, 0];
    for (const m of members) sum = add3(sum, mesh.vertices[m]);
    next.vertices[root] = scale3(sum, 1 / members.length);
    weldedRoots.add(root);
  }

  for (const f of next.faces) {
    f.verts = f.verts.map((v) => find(v));
  }

  // Track welded positions after compaction
  const weldedPositions = [...weldedRoots].map((r) => next.vertices[r]);
  const compacted = compactEditableMesh(next);
  const resultVerts: number[] = [];
  for (const wp of weldedPositions) {
    const idx = compacted.vertices.findIndex((v) => dist3(v, wp) <= 1e-6);
    if (idx !== -1 && !resultVerts.includes(idx)) resultVerts.push(idx);
  }

  return {
    mesh: compacted,
    selection: { mode: 'point', vertices: resultVerts, edges: [], faces: [] },
  };
}

/** Splits any shared faces along new edges connecting selected non-adjacent vertices. */
export function connectVertices(
  mesh: EditableMeshData,
  vertexIndices: readonly number[],
): MeshOperationResult {
  const selSet = new Set(vertexIndices);
  if (selSet.size < 2) {
    return { mesh: cloneEditableMesh(mesh), selection: createEmptySelection('edge') };
  }

  const next = cloneEditableMesh(mesh);
  const newFaces: MeshFace[] = [];
  const createdPairs: [number, number][] = [];

  for (const face of next.faces) {
    const m = face.verts.length;
    const selLocals: number[] = [];
    for (let k = 0; k < m; k++) {
      if (selSet.has(face.verts[k])) selLocals.push(k);
    }

    if (selLocals.length === 2) {
      const [i0, i1] = selLocals;
      const isAdjacent = i1 - i0 === 1 || (i0 === 0 && i1 === m - 1);
      if (!isAdjacent) {
        const polyA = face.verts.slice(i0, i1 + 1);
        const polyB = [...face.verts.slice(i1), ...face.verts.slice(0, i0 + 1)];
        newFaces.push(
          { verts: polyA, ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}) },
          { verts: polyB, ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}) },
        );
        createdPairs.push([face.verts[i0], face.verts[i1]]);
        continue;
      }
    }
    newFaces.push(face);
  }

  next.faces = newFaces;
  const adj = buildHalfEdgeOrAdjacency(next);
  const createdEdges: number[] = [];
  for (const [a, b] of createdPairs) {
    const ei = adj.edgeKeyToIndex.get(canonicalEdgeKey(a, b));
    if (ei !== undefined && !createdEdges.includes(ei)) createdEdges.push(ei);
  }

  return {
    mesh: next,
    selection: { mode: 'edge', vertices: [], edges: createdEdges, faces: [] },
  };
}
