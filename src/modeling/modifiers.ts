import * as THREE from 'three';
import {
  bevelEdges,
  bufferGeometryToEditableMesh,
  buildHalfEdgeOrAdjacency,
  cloneEditableMesh,
  compactEditableMesh,
  editableMeshToBufferGeometry,
  subdivideFaces,
  weldVertices,
} from './editableMesh';
import type {
  ArrayModifierParams,
  AxisId,
  BendModifierParams,
  BevelModifierParams,
  EditableMeshData,
  MeshFace,
  MirrorModifierParams,
  ModifierParamsMap,
  ModifierSpec,
  ModifierType,
  SolidifyModifierParams,
  SubdivisionModifierParams,
  TaperModifierParams,
  TwistModifierParams,
  Vec3,
} from './types';

export const DEFAULT_MODIFIER_PARAMS: { [K in ModifierType]: ModifierParamsMap[K] } = {
  bevel: {
    width: 0.05,
    segments: 2,
    angleThresholdDeg: 30,
    profile: 0.5,
  },
  subdivision: {
    levels: 1,
    smooth: true,
  },
  mirror: {
    axis: 'x',
    offset: 0,
    bisect: true,
    mergeThreshold: 0.001,
  },
  solidify: {
    thickness: 0.06,
    evenThickness: true,
  },
  bend: {
    angleDeg: 45,
    axis: 'y',
    directionDeg: 0,
  },
  twist: {
    angleDeg: 90,
    axis: 'y',
  },
  taper: {
    strength: 0.5,
    axis: 'y',
    curvature: 0,
  },
  array: {
    mode: 'linear',
    count: 3,
    offset: [1.2, 0, 0],
    radius: 1.5,
    stepRotationDeg: [0, 0, 0],
  },
};

export const MODIFIER_LABELS: Record<ModifierType, string> = {
  bevel: 'Bevel',
  subdivision: 'Subdivision Surface',
  mirror: 'Symmetry',
  solidify: 'Solidify',
  bend: 'Bend',
  twist: 'Twist',
  taper: 'Taper',
  array: 'Array',
};

export function createModifierSpec<K extends ModifierType>(
  type: K,
  id: string,
  overrides?: Partial<ModifierParamsMap[K]>,
): Extract<ModifierSpec, { type: K }> {
  return {
    id,
    type,
    name: MODIFIER_LABELS[type],
    enabled: true,
    params: {
      ...DEFAULT_MODIFIER_PARAMS[type],
      ...(overrides ?? {}),
    },
  } as Extract<ModifierSpec, { type: K }>;
}

function axisIndices(axis: AxisId): [number, number, number] {
  // Returns [primaryAxis, orthoU, orthoV] forming a right-handed frame
  if (axis === 'x') return [0, 1, 2];
  if (axis === 'y') return [1, 2, 0];
  return [2, 0, 1];
}

function computeAxisBounds(vertices: readonly Vec3[], axisIdx: number): { min: number; max: number; center: number; span: number } {
  if (vertices.length === 0) return { min: 0, max: 0, center: 0, span: 0 };
  let min = Infinity;
  let max = -Infinity;
  for (const v of vertices) {
    const c = v[axisIdx];
    if (c < min) min = c;
    if (c > max) max = c;
  }
  return { min, max, center: (min + max) * 0.5, span: max - min };
}

// ============================================================================
// INDIVIDUAL MODIFIER IMPLEMENTATIONS
// ============================================================================

function applyBevelModifier(mesh: EditableMeshData, params: BevelModifierParams): EditableMeshData {
  if (params.width <= 1e-6 || mesh.faces.length === 0) return cloneEditableMesh(mesh);
  const adj = buildHalfEdgeOrAdjacency(mesh);
  const cosLimit = Math.cos(((params.angleThresholdDeg ?? 30) * Math.PI) / 180);
  const sharpEdges: number[] = [];

  for (const edge of adj.edges) {
    if (edge.faces.length !== 2) continue;
    const n0 = adj.faceNormals[edge.faces[0]];
    const n1 = adj.faceNormals[edge.faces[1]];
    const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
    if (dot <= cosLimit + 1e-6) {
      sharpEdges.push(edge.index);
    }
  }

  if (sharpEdges.length === 0) return cloneEditableMesh(mesh);
  return bevelEdges(mesh, sharpEdges, {
    width: params.width,
    segments: Math.max(1, Math.min(16, Math.round(params.segments))),
    profile: params.profile ?? 0.5,
  }).mesh;
}

function applySubdivisionModifier(
  mesh: EditableMeshData,
  params: SubdivisionModifierParams,
): EditableMeshData {
  const levels = Math.max(1, Math.min(3, Math.round(params.levels)));
  const smooth = params.smooth ?? true;
  let curr = cloneEditableMesh(mesh);
  for (let l = 0; l < levels; l++) {
    curr = subdivideFaces(curr, [], { smooth }).mesh;
  }
  return curr;
}

/** Sutherland-Hodgman half-space clip keeping `v[axisIdx] >= planeCoord` when `bisect = true`. */
function bisectMeshPositiveHalfSpace(
  mesh: EditableMeshData,
  axisIdx: number,
  planeCoord: number,
  snapEps: number,
): EditableMeshData {
  const outVertices: Vec3[] = mesh.vertices.map((v) => {
    const copy: Vec3 = [v[0], v[1], v[2]];
    if (Math.abs(copy[axisIdx] - planeCoord) <= snapEps) {
      copy[axisIdx] = planeCoord;
    }
    return copy;
  });

  const intersectCache = new Map<string, number>();
  const getCutVertex = (iA: number, iB: number): number => {
    const key = iA < iB ? `${iA}_${iB}` : `${iB}_${iA}`;
    const ex = intersectCache.get(key);
    if (ex !== undefined) return ex;
    const pA = outVertices[iA];
    const pB = outVertices[iB];
    const dA = pA[axisIdx] - planeCoord;
    const dB = pB[axisIdx] - planeCoord;
    const denom = dA - dB;
    const t = Math.abs(denom) > 1e-9 ? dA / denom : 0.5;
    const pt: Vec3 = [
      pA[0] + (pB[0] - pA[0]) * t,
      pA[1] + (pB[1] - pA[1]) * t,
      pA[2] + (pB[2] - pA[2]) * t,
    ];
    pt[axisIdx] = planeCoord;
    const idx = outVertices.length;
    outVertices.push(pt);
    intersectCache.set(key, idx);
    return idx;
  };

  const clippedFaces: MeshFace[] = [];
  for (const face of mesh.faces) {
    const m = face.verts.length;
    const poly: number[] = [];
    for (let i = 0; i < m; i++) {
      const curr = face.verts[i];
      const next = face.verts[(i + 1) % m];
      const dCurr = outVertices[curr][axisIdx] - planeCoord;
      const dNext = outVertices[next][axisIdx] - planeCoord;
      const inCurr = dCurr >= -1e-7;
      const inNext = dNext >= -1e-7;

      if (inCurr && inNext) {
        poly.push(next);
      } else if (inCurr && !inNext) {
        if (Math.abs(dCurr) > 1e-7) poly.push(getCutVertex(curr, next));
      } else if (!inCurr && inNext) {
        if (Math.abs(dNext) > 1e-7) poly.push(getCutVertex(curr, next));
        poly.push(next);
      }
    }
    if (poly.length >= 3) {
      clippedFaces.push({
        verts: poly,
        ...(face.materialIndex !== undefined ? { materialIndex: face.materialIndex } : {}),
      });
    }
  }

  return compactEditableMesh({
    vertices: outVertices,
    faces: clippedFaces,
    ...(mesh.phongAngleDeg !== undefined ? { phongAngleDeg: mesh.phongAngleDeg } : {}),
  });
}

function applyMirrorModifier(mesh: EditableMeshData, params: MirrorModifierParams): EditableMeshData {
  if (mesh.faces.length === 0) return cloneEditableMesh(mesh);
  const [axisIdx] = axisIndices(params.axis);
  const offset = Number.isFinite(params.offset) ? params.offset : 0;
  const mergeThresh = Math.max(0, Number.isFinite(params.mergeThreshold) ? params.mergeThreshold : 1e-3);

  let source = cloneEditableMesh(mesh);
  if (params.bisect) {
    // Determine which side of the mirror plane actually contains geometry; if all geometry is on `< offset`, flip clip side!
    const bounds = computeAxisBounds(source.vertices, axisIdx);
    if (bounds.max > offset + 1e-6 || bounds.min >= offset - 1e-6) {
      source = bisectMeshPositiveHalfSpace(source, axisIdx, offset, mergeThresh);
    } else {
      // Geometry lies on negative side: negate temporarily, clip, and restore
      for (const v of source.vertices) v[axisIdx] = 2 * offset - v[axisIdx];
      for (const f of source.faces) f.verts.reverse();
      source = bisectMeshPositiveHalfSpace(source, axisIdx, offset, mergeThresh);
      for (const v of source.vertices) v[axisIdx] = 2 * offset - v[axisIdx];
      for (const f of source.faces) f.verts.reverse();
    }
  }

  const baseCount = source.vertices.length;
  const seamCandIndices: number[] = [];

  for (let i = 0; i < baseCount; i++) {
    const v = source.vertices[i];
    if (Math.abs(v[axisIdx] - offset) <= mergeThresh) {
      v[axisIdx] = offset;
      seamCandIndices.push(i);
    }
    const mirrored: Vec3 = [v[0], v[1], v[2]];
    mirrored[axisIdx] = 2 * offset - v[axisIdx];
    const newIdx = source.vertices.length;
    source.vertices.push(mirrored);
    if (Math.abs(mirrored[axisIdx] - offset) <= mergeThresh) {
      seamCandIndices.push(newIdx);
    }
  }

  const origFaceCount = source.faces.length;
  for (let fi = 0; fi < origFaceCount; fi++) {
    const f = source.faces[fi];
    source.faces.push({
      verts: f.verts.map((vi) => vi + baseCount).reverse(),
      ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
      ...(f.uvs ? { uvs: [...f.uvs].reverse() } : {}),
    });
  }

  if (mergeThresh > 0 && seamCandIndices.length >= 2) {
    return weldVertices(source, seamCandIndices, {
      mode: 'threshold',
      threshold: Math.max(mergeThresh * 2, 1e-5),
    }).mesh;
  }

  return compactEditableMesh(source);
}

function applySolidifyModifier(
  mesh: EditableMeshData,
  params: SolidifyModifierParams,
): EditableMeshData {
  const thickness = Number.isFinite(params.thickness) ? params.thickness : 0.05;
  if (Math.abs(thickness) <= 1e-6 || mesh.faces.length === 0) {
    return cloneEditableMesh(mesh);
  }

  const adj = buildHalfEdgeOrAdjacency(mesh);
  const vCount = mesh.vertices.length;
  const vertices: Vec3[] = mesh.vertices.map((v) => [v[0], v[1], v[2]]);

  for (let vi = 0; vi < vCount; vi++) {
    const vn = adj.vertexNormals[vi];
    let scale = 1;
    if (params.evenThickness) {
      const incFaces = adj.vertexFaces[vi] ?? [];
      if (incFaces.length > 0) {
        let cosSum = 0;
        for (const fi of incFaces) {
          const fn = adj.faceNormals[fi];
          cosSum += Math.abs(vn[0] * fn[0] + vn[1] * fn[1] + vn[2] * fn[2]);
        }
        const meanCos = Math.max(0.35, cosSum / incFaces.length);
        scale = Math.min(2.5, 1 / meanCos);
      }
    }
    const d = thickness * scale;
    const orig = mesh.vertices[vi];
    vertices.push([orig[0] + vn[0] * d, orig[1] + vn[1] * d, orig[2] + vn[2] * d]);
  }

  const outwardPositive = thickness > 0;
  const faces: MeshFace[] = [];

  // Base shell & offset shell with opposite outward normals
  for (const f of mesh.faces) {
    const baseVerts = outwardPositive ? [...f.verts].reverse() : [...f.verts];
    const offsetVerts = outwardPositive
      ? f.verts.map((vi) => vi + vCount)
      : f.verts.map((vi) => vi + vCount).reverse();

    faces.push({
      verts: baseVerts,
      ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
    });
    faces.push({
      verts: offsetVerts,
      ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
    });
  }

  // Stitch boundary rim quads so open surfaces become closed watertight solids
  for (const edge of adj.edges) {
    if (!edge.isBoundary || edge.faces.length !== 1) continue;
    const f = mesh.faces[edge.faces[0]];
    for (let i = 0; i < f.verts.length; i++) {
      const u = f.verts[i];
      const v = f.verts[(i + 1) % f.verts.length];
      if ((u === edge.a && v === edge.b) || (u === edge.b && v === edge.a)) {
        const rimVerts = outwardPositive
          ? [u, v, v + vCount, u + vCount]
          : [v, u, u + vCount, v + vCount];
        faces.push({
          verts: rimVerts,
          ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
        });
        break;
      }
    }
  }

  return compactEditableMesh({
    vertices,
    faces,
    ...(mesh.phongAngleDeg !== undefined ? { phongAngleDeg: mesh.phongAngleDeg } : {}),
  });
}

function applyBendModifier(mesh: EditableMeshData, params: BendModifierParams): EditableMeshData {
  const next = cloneEditableMesh(mesh);
  const angleRad = ((params.angleDeg ?? 0) * Math.PI) / 180;
  if (Math.abs(angleRad) <= 1e-5 || next.vertices.length === 0) return next;

  const [aIdx, uIdx, vIdx] = axisIndices(params.axis);
  const { center: centerA, span } = computeAxisBounds(next.vertices, aIdx);
  if (span <= 1e-6) return next;

  const dirRad = ((params.directionDeg ?? 0) * Math.PI) / 180;
  const cosD = Math.cos(dirRad);
  const sinD = Math.sin(dirRad);
  const radius = span / angleRad;

  for (const vert of next.vertices) {
    const s = vert[aIdx] - centerA;
    const uOrig = vert[uIdx];
    const vOrig = vert[vIdx];

    // Rotate perpendicular plane into bend azimuth direction
    const uRot = uOrig * cosD + vOrig * sinD;
    const vRot = -uOrig * sinD + vOrig * cosD;

    const phi = (s / span) * angleRad;
    const rho = radius - uRot;
    const aBent = rho * Math.sin(phi);
    const uBent = radius - rho * Math.cos(phi);

    // Rotate perpendicular coordinates back from bend azimuth
    vert[aIdx] = centerA + aBent;
    vert[uIdx] = uBent * cosD - vRot * sinD;
    vert[vIdx] = uBent * sinD + vRot * cosD;
  }

  return next;
}

function applyTwistModifier(mesh: EditableMeshData, params: TwistModifierParams): EditableMeshData {
  const next = cloneEditableMesh(mesh);
  const totalRad = ((params.angleDeg ?? 0) * Math.PI) / 180;
  if (Math.abs(totalRad) <= 1e-5 || next.vertices.length === 0) return next;

  const [aIdx, uIdx, vIdx] = axisIndices(params.axis);
  const { center: centerA, span } = computeAxisBounds(next.vertices, aIdx);
  if (span <= 1e-6) return next;

  for (const vert of next.vertices) {
    const normPos = (vert[aIdx] - centerA) / span; // [-0.5 .. +0.5]
    const phi = normPos * totalRad;
    const cosP = Math.cos(phi);
    const sinP = Math.sin(phi);
    const u = vert[uIdx];
    const v = vert[vIdx];
    vert[uIdx] = u * cosP - v * sinP;
    vert[vIdx] = u * sinP + v * cosP;
  }

  return next;
}

function applyTaperModifier(mesh: EditableMeshData, params: TaperModifierParams): EditableMeshData {
  const next = cloneEditableMesh(mesh);
  if (
    (Math.abs(params.strength ?? 0) <= 1e-6 && Math.abs(params.curvature ?? 0) <= 1e-6) ||
    next.vertices.length === 0
  ) {
    return next;
  }

  const [aIdx, uIdx, vIdx] = axisIndices(params.axis);
  const { min: minA, span } = computeAxisBounds(next.vertices, aIdx);
  if (span <= 1e-6) return next;

  const strength = params.strength ?? 0;
  const curvature = params.curvature ?? 0;

  for (const vert of next.vertices) {
    const t = (vert[aIdx] - minA) / span; // 0 at bottom, 1 at top
    const curveBell = curvature * 4 * t * (1 - t);
    const factor = Math.max(0.005, 1 - strength * t + curveBell);
    vert[uIdx] *= factor;
    vert[vIdx] *= factor;
  }

  return next;
}

function applyArrayModifier(mesh: EditableMeshData, params: ArrayModifierParams): EditableMeshData {
  const count = Math.max(1, Math.min(128, Math.round(params.count ?? 1)));
  if (count <= 1 || mesh.faces.length === 0) return cloneEditableMesh(mesh);

  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];
  const vCount = mesh.vertices.length;

  const stepRx = ((params.stepRotationDeg[0] ?? 0) * Math.PI) / 180;
  const stepRy = ((params.stepRotationDeg[1] ?? 0) * Math.PI) / 180;
  const stepRz = ((params.stepRotationDeg[2] ?? 0) * Math.PI) / 180;

  const mat = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const one = new THREE.Vector3(1, 1, 1);
  const tmp = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    if (params.mode === 'radial') {
      const theta = (i / count) * Math.PI * 2;
      const r = params.radius ?? 1.5;
      pos.set(
        Math.cos(theta) * r + (params.offset[0] ?? 0) * i * 0,
        (params.offset[1] ?? 0) * i,
        Math.sin(theta) * r,
      );
      euler.set(stepRx * i, -theta + stepRy * i, stepRz * i, 'XYZ');
    } else {
      pos.set(
        (params.offset[0] ?? 0) * i,
        (params.offset[1] ?? 0) * i,
        (params.offset[2] ?? 0) * i,
      );
      euler.set(stepRx * i, stepRy * i, stepRz * i, 'XYZ');
    }
    quat.setFromEuler(euler);
    mat.compose(pos, quat, one);

    const baseOffset = i * vCount;
    for (const v of mesh.vertices) {
      tmp.set(v[0], v[1], v[2]).applyMatrix4(mat);
      vertices.push([tmp.x, tmp.y, tmp.z]);
    }
    for (const f of mesh.faces) {
      faces.push({
        verts: f.verts.map((vi) => vi + baseOffset),
        ...(f.materialIndex !== undefined ? { materialIndex: f.materialIndex } : {}),
        ...(f.uvs ? { uvs: f.uvs.map((uv) => [uv[0], uv[1]]) } : {}),
      });
    }
  }

  return {
    vertices,
    faces,
    ...(mesh.phongAngleDeg !== undefined ? { phongAngleDeg: mesh.phongAngleDeg } : {}),
  };
}

// ============================================================================
// PUBLIC STACK EVALUATORS
// ============================================================================

export function applyModifier(mesh: EditableMeshData, modifier: ModifierSpec): EditableMeshData {
  if (!modifier.enabled) return cloneEditableMesh(mesh);
  switch (modifier.type) {
    case 'bevel':
      return applyBevelModifier(mesh, modifier.params);
    case 'subdivision':
      return applySubdivisionModifier(mesh, modifier.params);
    case 'mirror':
      return applyMirrorModifier(mesh, modifier.params);
    case 'solidify':
      return applySolidifyModifier(mesh, modifier.params);
    case 'bend':
      return applyBendModifier(mesh, modifier.params);
    case 'twist':
      return applyTwistModifier(mesh, modifier.params);
    case 'taper':
      return applyTaperModifier(mesh, modifier.params);
    case 'array':
      return applyArrayModifier(mesh, modifier.params);
  }
}

export function applyModifierStack(
  mesh: EditableMeshData,
  modifiers: readonly ModifierSpec[],
): EditableMeshData {
  let curr = cloneEditableMesh(mesh);
  for (const mod of modifiers) {
    if (!mod.enabled) continue;
    curr = applyModifier(curr, mod);
  }
  return curr;
}

export function applyModifierStackToGeometry(
  geometry: THREE.BufferGeometry,
  modifiers: readonly ModifierSpec[],
  options?: { phongAngleDeg?: number },
): THREE.BufferGeometry {
  const active = modifiers.filter((m) => m.enabled);
  if (active.length === 0) return geometry.clone();
  const baseMesh = bufferGeometryToEditableMesh(geometry);
  const modified = applyModifierStack(baseMesh, active);
  return editableMeshToBufferGeometry(modified, options);
}
