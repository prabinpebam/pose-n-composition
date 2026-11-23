import type * as THREE from 'three';
import {
  bevelEdges,
  buildHalfEdgeOrAdjacency,
  compactEditableMesh,
  editableMeshToBufferGeometry,
  subdivideFaces,
} from './editableMesh';
import type {
  CapsuleParams,
  ConeParams,
  CubeParams,
  CylinderParams,
  DiscParams,
  EditableMeshData,
  MeshFace,
  PlaneParams,
  PlatonicParams,
  PrimitiveKind,
  PrimitiveParamsMap,
  PrimitiveSpec,
  PyramidParams,
  SphereParams,
  TorusParams,
  TubeParams,
  Vec2,
  Vec3,
} from './types';

export const PRIMITIVE_DEFAULTS: { [K in PrimitiveKind]: PrimitiveParamsMap[K] } = {
  cube: {
    width: 1,
    height: 1,
    depth: 1,
    segX: 1,
    segY: 1,
    segZ: 1,
    fillet: false,
    filletRadius: 0.08,
    filletSubdivisions: 3,
  },
  sphere: {
    radius: 0.5,
    widthSegments: 24,
    heightSegments: 16,
    hemisphere: false,
    sliceDeg: 360,
  },
  cylinder: {
    radiusTop: 0.5,
    radiusBottom: 0.5,
    height: 1,
    radialSegments: 24,
    heightSegments: 1,
    fillet: false,
    filletRadius: 0.06,
    filletSubdivisions: 3,
  },
  cone: {
    radiusBottom: 0.5,
    radiusTop: 0,
    height: 1,
    radialSegments: 24,
    heightSegments: 1,
    fillet: false,
    filletRadius: 0.06,
    filletSubdivisions: 3,
  },
  pyramid: {
    width: 1,
    height: 1,
    depth: 1,
    segments: 1,
    fillet: false,
    filletRadius: 0.06,
    filletSubdivisions: 3,
  },
  torus: {
    radius: 0.45,
    tube: 0.15,
    radialSegments: 16,
    tubularSegments: 32,
    arcDeg: 360,
  },
  capsule: {
    radius: 0.3,
    height: 1.1,
    radialSegments: 24,
    capSegments: 8,
  },
  tube: {
    innerRadius: 0.3,
    outerRadius: 0.5,
    height: 1,
    radialSegments: 24,
    heightSegments: 1,
    fillet: false,
    filletRadius: 0.04,
    filletSubdivisions: 3,
  },
  plane: {
    width: 2,
    depth: 2,
    segX: 4,
    segZ: 4,
  },
  disc: {
    innerRadius: 0,
    outerRadius: 0.6,
    radialSegments: 24,
    ringSegments: 2,
  },
  platonic: {
    polyhedron: 'dodecahedron',
    radius: 0.55,
    subdivisions: 0,
    fillet: false,
    filletRadius: 0.05,
    filletSubdivisions: 2,
  },
};

export function createDefaultPrimitiveSpec<K extends PrimitiveKind>(kind: K): {
  kind: K;
  params: PrimitiveParamsMap[K];
} {
  return {
    kind,
    params: { ...PRIMITIVE_DEFAULTS[kind] },
  };
}

/** Returns the Y height offset needed to rest a centered primitive cleanly on the `y = 0` stage floor. */
export function getPrimitiveGroundY(spec: PrimitiveSpec): number {
  switch (spec.kind) {
    case 'cube':
      return Math.max(0.01, spec.params.height) * 0.5;
    case 'sphere':
      return spec.params.hemisphere ? 0 : Math.max(0.01, spec.params.radius);
    case 'cylinder':
    case 'cone':
    case 'tube':
    case 'capsule':
    case 'pyramid':
      return Math.max(0.01, spec.params.height) * 0.5;
    case 'torus':
      return Math.max(0.01, spec.params.tube);
    case 'plane':
    case 'disc':
      return 0;
    case 'platonic':
      return Math.max(0.01, spec.params.radius);
  }
}

function clampInt(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(Number.isFinite(val) ? val : min)));
}

function clampPos(val: number, min = 1e-4): number {
  return Math.max(min, Number.isFinite(val) ? val : min);
}

// ============================================================================
// 1. CUBE (WITH CHAMFER & ALL-QUAD SMOOTH FILLET)
// ============================================================================

function buildSegmentedBoxMesh(
  width: number,
  height: number,
  depth: number,
  nx: number,
  ny: number,
  nz: number,
  evalPoint?: (ix: number, iy: number, iz: number) => Vec3,
): EditableMeshData {
  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;

  const vertices: Vec3[] = [];
  const gridVertMap = new Map<string, number>();

  const getVert = (ix: number, iy: number, iz: number): number => {
    const key = `${ix}_${iy}_${iz}`;
    const existing = gridVertMap.get(key);
    if (existing !== undefined) return existing;
    const p: Vec3 = evalPoint
      ? evalPoint(ix, iy, iz)
      : [
          -hx + (width * ix) / nx,
          -hy + (height * iy) / ny,
          -hz + (depth * iz) / nz,
        ];
    const idx = vertices.length;
    vertices.push(p);
    gridVertMap.set(key, idx);
    return idx;
  };

  const faces: MeshFace[] = [];

  // +Z front (x: 0..nx, y: 0..ny at iz = nz)
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      faces.push({
        verts: [
          getVert(ix, iy, nz),
          getVert(ix + 1, iy, nz),
          getVert(ix + 1, iy + 1, nz),
          getVert(ix, iy + 1, nz),
        ],
      });
    }
  }
  // -Z back (iz = 0)
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      faces.push({
        verts: [
          getVert(ix + 1, iy, 0),
          getVert(ix, iy, 0),
          getVert(ix, iy + 1, 0),
          getVert(ix + 1, iy + 1, 0),
        ],
      });
    }
  }
  // +X right (ix = nx)
  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nz; iz++) {
      faces.push({
        verts: [
          getVert(nx, iy, iz + 1),
          getVert(nx, iy, iz),
          getVert(nx, iy + 1, iz),
          getVert(nx, iy + 1, iz + 1),
        ],
      });
    }
  }
  // -X left (ix = 0)
  for (let iy = 0; iy < ny; iy++) {
    for (let iz = 0; iz < nz; iz++) {
      faces.push({
        verts: [
          getVert(0, iy, iz),
          getVert(0, iy, iz + 1),
          getVert(0, iy + 1, iz + 1),
          getVert(0, iy + 1, iz),
        ],
      });
    }
  }
  // +Y top (iy = ny)
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      faces.push({
        verts: [
          getVert(ix, ny, iz + 1),
          getVert(ix + 1, ny, iz + 1),
          getVert(ix + 1, ny, iz),
          getVert(ix, ny, iz),
        ],
      });
    }
  }
  // -Y bottom (iy = 0)
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      faces.push({
        verts: [
          getVert(ix, 0, iz),
          getVert(ix + 1, 0, iz),
          getVert(ix + 1, 0, iz + 1),
          getVert(ix, 0, iz + 1),
        ],
      });
    }
  }

  return { vertices, faces };
}

function createCubeMesh(params: CubeParams): EditableMeshData {
  const width = clampPos(params.width);
  const height = clampPos(params.height);
  const depth = clampPos(params.depth);
  const segX = clampInt(params.segX, 1, 64);
  const segY = clampInt(params.segY, 1, 64);
  const segZ = clampInt(params.segZ, 1, 64);

  const maxFillet = Math.min(width, height, depth) * 0.495;
  const r = params.fillet ? Math.max(0, Math.min(params.filletRadius, maxFillet)) : 0;
  const fSubs = clampInt(params.filletSubdivisions, 1, 24);

  if (r <= 1e-5) {
    return buildSegmentedBoxMesh(width, height, depth, segX, segY, segZ);
  }

  if (fSubs === 1) {
    // Crisp 45° Chamfer across all 12 sharp box edges (preserving segX/segY/segZ subdivisions)
    const baseBox = buildSegmentedBoxMesh(width, height, depth, segX, segY, segZ);
    const adj = buildHalfEdgeOrAdjacency(baseBox);
    const sharpEdges: number[] = [];
    for (const edge of adj.edges) {
      if (edge.faces.length === 2) {
        const n0 = adj.faceNormals[edge.faces[0]];
        const n1 = adj.faceNormals[edge.faces[1]];
        const dot = n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2];
        if (dot < 0.5) sharpEdges.push(edge.index);
      }
    }
    // Scale width when box is heavily segmented so chamfer radius stays generous up to segment limit
    return bevelEdges(baseBox, sharpEdges, { width: r, segments: 1, profile: 0.5 }).mesh;
  }

  // Smooth All-Quad Analytic Fillet Box (`filletSubdivisions >= 2`)
  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;
  const ix = Math.max(0, hx - r);
  const iy = Math.max(0, hy - r);
  const iz = Math.max(0, hz - r);

  const axisSample = (idx: number, flatSegs: number, innerHalf: number): { core: number; dir: number } => {
    if (idx <= fSubs) {
      const alpha = ((fSubs - idx) / fSubs) * (Math.PI * 0.5);
      return { core: -innerHalf, dir: -Math.sin(alpha) };
    }
    if (idx >= fSubs + flatSegs) {
      const alpha = ((idx - (fSubs + flatSegs)) / fSubs) * (Math.PI * 0.5);
      return { core: innerHalf, dir: Math.sin(alpha) };
    }
    const t = (idx - fSubs) / flatSegs;
    return { core: -innerHalf + 2 * innerHalf * t, dir: 0 };
  };

  const totalX = segX + 2 * fSubs;
  const totalY = segY + 2 * fSubs;
  const totalZ = segZ + 2 * fSubs;

  return buildSegmentedBoxMesh(width, height, depth, totalX, totalY, totalZ, (gx, gy, gz) => {
    const sx = axisSample(gx, segX, ix);
    const sy = axisSample(gy, segY, iy);
    const sz = axisSample(gz, segZ, iz);
    const len = Math.hypot(sx.dir, sy.dir, sz.dir);
    if (len <= 1e-8) {
      return [sx.core, sy.core, sz.core];
    }
    const scale = r / len;
    return [
      sx.core + sx.dir * scale,
      sy.core + sy.dir * scale,
      sz.core + sz.dir * scale,
    ];
  });
}

// ============================================================================
// 2. SPHERE (QUAD RINGS + HEMISPHERE + SLICE CAPS)
// ============================================================================

function createSphereMesh(params: SphereParams): EditableMeshData {
  const radius = clampPos(params.radius);
  const wSeg = clampInt(params.widthSegments, 4, 128);
  const hSeg = clampInt(params.heightSegments, 3, 128);
  const hemisphere = Boolean(params.hemisphere);
  const sliceDeg = Math.max(10, Math.min(360, Number.isFinite(params.sliceDeg) ? params.sliceDeg : 360));
  const isSliced = sliceDeg < 359.99;
  const phiMax = (sliceDeg * Math.PI) / 180;
  const thetaMax = hemisphere ? Math.PI * 0.5 : Math.PI;

  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];

  // Top pole at y = +radius
  const topPoleIdx = 0;
  vertices.push([0, radius, 0]);

  const cols = isSliced ? wSeg + 1 : wSeg;
  const ringRows: number[][] = [];
  const ringCount = hemisphere ? hSeg : hSeg - 1;

  for (let r = 1; r <= ringCount; r++) {
    const theta = (r / (hemisphere ? hSeg : hSeg)) * thetaMax;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);
    const row: number[] = [];
    for (let c = 0; c < cols; c++) {
      const phi = (c / wSeg) * phiMax;
      const x = -radius * Math.cos(phi) * sinT;
      const y = radius * cosT;
      const z = radius * Math.sin(phi) * sinT;
      const idx = vertices.length;
      vertices.push([x, y, z]);
      row.push(idx);
    }
    ringRows.push(row);
  }

  let bottomPoleIdx = -1;
  let bottomCenterIdx = -1;
  if (!hemisphere) {
    bottomPoleIdx = vertices.length;
    vertices.push([0, -radius, 0]);
  }

  // Top cap triangles (outward CCW)
  const firstRow = ringRows[0];
  for (let c = 0; c < wSeg; c++) {
    const cNext = isSliced ? c + 1 : (c + 1) % wSeg;
    faces.push({ verts: [topPoleIdx, firstRow[c], firstRow[cNext]] });
  }

  // Quad latitude bands
  for (let r = 0; r < ringRows.length - 1; r++) {
    const r0 = ringRows[r];
    const r1 = ringRows[r + 1];
    for (let c = 0; c < wSeg; c++) {
      const cNext = isSliced ? c + 1 : (c + 1) % wSeg;
      faces.push({ verts: [r0[c], r1[c], r1[cNext], r0[cNext]] });
    }
  }

  if (!hemisphere) {
    const lastRow = ringRows[ringRows.length - 1];
    for (let c = 0; c < wSeg; c++) {
      const cNext = isSliced ? c + 1 : (c + 1) % wSeg;
      faces.push({ verts: [lastRow[c], bottomPoleIdx, lastRow[cNext]] });
    }
  } else {
    // Close flat hemisphere base at y = 0
    bottomCenterIdx = vertices.length;
    vertices.push([0, 0, 0]);
    const eqRow = ringRows[ringRows.length - 1];
    for (let c = 0; c < wSeg; c++) {
      const cNext = isSliced ? c + 1 : (c + 1) % wSeg;
      faces.push({ verts: [eqRow[cNext], bottomCenterIdx, eqRow[c]] });
    }
  }

  // Close radial slice walls when sliceDeg < 360 so mesh remains watertight
  if (isSliced) {
    const axisVerts: number[] = [topPoleIdx];
    for (let r = 0; r < ringRows.length; r++) {
      const y = vertices[ringRows[r][0]][1];
      if (hemisphere && r === ringRows.length - 1) {
        axisVerts.push(bottomCenterIdx);
      } else {
        const idx = vertices.length;
        vertices.push([0, y, 0]);
        axisVerts.push(idx);
      }
    }
    if (!hemisphere) axisVerts.push(bottomPoleIdx);

    // Start slice wall (c = 0) & End slice wall (c = wSeg)
    // Top segment:
    faces.push({ verts: [topPoleIdx, axisVerts[1], ringRows[0][0]] });
    faces.push({ verts: [topPoleIdx, ringRows[0][wSeg], axisVerts[1]] });

    for (let r = 0; r < ringRows.length - 1; r++) {
      faces.push({ verts: [ringRows[r][0], axisVerts[r + 1], axisVerts[r + 2], ringRows[r + 1][0]] });
      faces.push({ verts: [ringRows[r][wSeg], ringRows[r + 1][wSeg], axisVerts[r + 2], axisVerts[r + 1]] });
    }

    if (!hemisphere) {
      const last = ringRows.length - 1;
      faces.push({ verts: [ringRows[last][0], axisVerts[last + 1], bottomPoleIdx] });
      faces.push({ verts: [ringRows[last][wSeg], bottomPoleIdx, axisVerts[last + 1]] });
    }
  }

  return compactEditableMesh({ vertices, faces });
}

// ============================================================================
// SHARED SURFACE-OF-REVOLUTION BUILDER (CYLINDER, CONE, CAPSULE, TUBE)
// ============================================================================

interface Profile2DPoint {
  r: number;
  y: number;
}

/**
 * Revolves an open (pole-to-pole) or closed 2D profile `(r >= 0, y)` around `+Y`
 * using `radialSegments` steps, generating clean quad rings and pole caps.
 */
function buildRevolvedMesh(
  profile: readonly Profile2DPoint[],
  radialSegments: number,
  closedProfile: boolean,
): EditableMeshData {
  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];

  // Map each profile station to either a single pole index (if r <= 1e-7) or a ring of `radialSegments` indices
  const stationRings: number[][] = [];

  for (let i = 0; i < profile.length; i++) {
    const { r, y } = profile[i];
    if (r <= 1e-7) {
      const poleIdx = vertices.length;
      vertices.push([0, y, 0]);
      stationRings.push([poleIdx]);
    } else {
      const ring: number[] = [];
      for (let s = 0; s < radialSegments; s++) {
        const phi = (s / radialSegments) * Math.PI * 2;
        const x = Math.sin(phi) * r;
        const z = Math.cos(phi) * r;
        const idx = vertices.length;
        vertices.push([x, y, z]);
        ring.push(idx);
      }
      stationRings.push(ring);
    }
  }

  const segCount = closedProfile ? profile.length : profile.length - 1;
  for (let i = 0; i < segCount; i++) {
    const rA = stationRings[i];
    const rB = stationRings[(i + 1) % profile.length];
    if (rA.length === 1 && rB.length === 1) continue;

    if (rA.length === 1) {
      // Pole at A -> ring at B
      const pole = rA[0];
      for (let s = 0; s < radialSegments; s++) {
        const sNext = (s + 1) % radialSegments;
        faces.push({ verts: [pole, rB[s], rB[sNext]] });
      }
    } else if (rB.length === 1) {
      // Ring at A -> pole at B
      const pole = rB[0];
      for (let s = 0; s < radialSegments; s++) {
        const sNext = (s + 1) % radialSegments;
        faces.push({ verts: [rA[s], pole, rA[sNext]] });
      }
    } else {
      // Quad band between ring A and ring B
      for (let s = 0; s < radialSegments; s++) {
        const sNext = (s + 1) % radialSegments;
        faces.push({ verts: [rA[s], rB[s], rB[sNext], rA[sNext]] });
      }
    }
  }

  return compactEditableMesh({ vertices, faces });
}

/**
 * Generates a 2D corner chamfer (`subs = 1`) or exact tangent circular fillet (`subs >= 2`)
 * at corner `B` between `A -> B -> C`, clamped to `maxDist` along `BA` and `BC`.
 */
function build2DCornerFillet(
  A: Profile2DPoint,
  B: Profile2DPoint,
  C: Profile2DPoint,
  requestedRadius: number,
  subs: number,
): Profile2DPoint[] {
  const ux = A.r - B.r;
  const uy = A.y - B.y;
  const vx = C.r - B.r;
  const vy = C.y - B.y;
  const lenU = Math.hypot(ux, uy);
  const lenV = Math.hypot(vx, vy);
  if (lenU <= 1e-6 || lenV <= 1e-6 || requestedRadius <= 1e-6) return [B];

  const du = { r: ux / lenU, y: uy / lenU };
  const dv = { r: vx / lenV, y: vy / lenV };
  const cosAngle = Math.max(-0.999, Math.min(0.999, du.r * dv.r + du.y * dv.y));
  const halfAngle = Math.acos(cosAngle) * 0.5;
  const tanHalf = Math.tan(halfAngle);
  if (tanHalf <= 1e-5) return [B];

  // Tangent offset `d = filletRadius / tan(halfAngle)`; clamp `d <= 0.48 * min(lenU, lenV)`
  const maxD = Math.min(lenU, lenV) * 0.48;
  const d = Math.min(requestedRadius / tanHalf, maxD);
  if (d <= 1e-6) return [B];

  const T1: Profile2DPoint = { r: B.r + du.r * d, y: B.y + du.y * d };
  const T2: Profile2DPoint = { r: B.r + dv.r * d, y: B.y + dv.y * d };

  if (subs <= 1) {
    return [T1, T2];
  }

  // Rational Quadratic Bézier with weight = sin(halfAngle) traces the EXACT tangent circular arc!
  const w = Math.max(0.05, Math.sin(halfAngle));
  const pts: Profile2DPoint[] = [];
  for (let s = 0; s <= subs; s++) {
    const t = s / subs;
    const omt = 1 - t;
    const b0 = omt * omt;
    const b1 = 2 * w * omt * t;
    const b2 = t * t;
    const den = b0 + b1 + b2;
    pts.push({
      r: (b0 * T1.r + b1 * B.r + b2 * T2.r) / den,
      y: (b0 * T1.y + b1 * B.y + b2 * T2.y) / den,
    });
  }
  return pts;
}

// ============================================================================
// 3 & 4. CYLINDER & CONE (WITH CAP CHAMFER & FILLET)
// ============================================================================

function createFrustumMesh(
  radiusTopRaw: number,
  radiusBottomRaw: number,
  heightRaw: number,
  radialSegRaw: number,
  heightSegRaw: number,
  fillet: boolean,
  filletRadiusRaw: number,
  filletSubsRaw: number,
): EditableMeshData {
  let rTop = Math.max(0, Number.isFinite(radiusTopRaw) ? radiusTopRaw : 0.5);
  let rBot = Math.max(0, Number.isFinite(radiusBottomRaw) ? radiusBottomRaw : 0.5);
  if (rTop <= 1e-5 && rBot <= 1e-5) rBot = 0.5;

  const height = clampPos(heightRaw);
  const radialSegments = clampInt(radialSegRaw, 3, 128);
  const heightSegments = clampInt(heightSegRaw, 1, 64);
  const fSubs = clampInt(filletSubsRaw, 1, 24);
  const fRad = fillet ? Math.max(0, filletRadiusRaw) : 0;

  const hy = height * 0.5;
  const topPole: Profile2DPoint = { r: 0, y: hy };
  const topRim: Profile2DPoint = { r: rTop, y: hy };
  const botRim: Profile2DPoint = { r: rBot, y: -hy };
  const botPole: Profile2DPoint = { r: 0, y: -hy };

  // Build profile from top pole (+Y) -> outer wall -> bottom pole (-Y) so outward normals face out!
  const profile: Profile2DPoint[] = [];

  // Top cap & top rim
  let wallStart: Profile2DPoint;
  if (rTop <= 1e-5) {
    // Pointed cone apex at top
    if (fRad > 1e-5) {
      // Fillet/chamfer the pointed cone tip by rounding symmetric virtual corner (-rBot,-hy) -> (0,hy) -> (+rBot,-hy)
      const tipArc = build2DCornerFillet(
        { r: -rBot, y: -hy },
        topPole,
        botRim,
        fRad,
        fSubs * 2,
      );
      const rightHalf = tipArc.filter((p) => p.r >= 1e-5);
      const apexY = rightHalf.length > 0 ? Math.min(hy, rightHalf[0].y + (rightHalf[0].r * 0.25)) : hy;
      profile.push({ r: 0, y: apexY });
      for (let i = 0; i < rightHalf.length - 1; i++) profile.push(rightHalf[i]);
      wallStart = rightHalf.length > 0 ? rightHalf[rightHalf.length - 1] : topPole;
    } else {
      profile.push(topPole);
      wallStart = topPole;
    }
  } else {
    profile.push(topPole);
    const topArc = fRad > 1e-5 ? build2DCornerFillet(topPole, topRim, botRim, fRad, fSubs) : [topRim];
    for (let i = 0; i < topArc.length - 1; i++) profile.push(topArc[i]);
    wallStart = topArc[topArc.length - 1];
  }

  // Bottom rim & bottom cap
  let wallEnd: Profile2DPoint;
  let bottomTail: Profile2DPoint[] = [];
  if (rBot <= 1e-5) {
    wallEnd = botPole;
    bottomTail = [];
  } else {
    const botArc = fRad > 1e-5 ? build2DCornerFillet(topRim, botRim, botPole, fRad, fSubs) : [botRim];
    wallEnd = botArc[0];
    bottomTail = [...botArc.slice(1), botPole];
  }

  profile.push(wallStart);
  for (let h = 1; h < heightSegments; h++) {
    const t = h / heightSegments;
    profile.push({
      r: wallStart.r + (wallEnd.r - wallStart.r) * t,
      y: wallStart.y + (wallEnd.y - wallStart.y) * t,
    });
  }
  if (Math.hypot(wallEnd.r - wallStart.r, wallEnd.y - wallStart.y) > 1e-6) {
    profile.push(wallEnd);
  }
  profile.push(...bottomTail);

  return buildRevolvedMesh(profile, radialSegments, false);
}

function createCylinderMesh(params: CylinderParams): EditableMeshData {
  return createFrustumMesh(
    params.radiusTop,
    params.radiusBottom,
    params.height,
    params.radialSegments,
    params.heightSegments,
    params.fillet,
    params.filletRadius,
    params.filletSubdivisions,
  );
}

function createConeMesh(params: ConeParams): EditableMeshData {
  return createFrustumMesh(
    params.radiusTop,
    params.radiusBottom,
    params.height,
    params.radialSegments,
    params.heightSegments,
    params.fillet,
    params.filletRadius,
    params.filletSubdivisions,
  );
}

// ============================================================================
// 5. PYRAMID (4-SIDED SEGMENTED + CHAMFER / FILLET)
// ============================================================================

function createPyramidMesh(params: PyramidParams): EditableMeshData {
  const width = clampPos(params.width);
  const height = clampPos(params.height);
  const depth = clampPos(params.depth);
  const segs = clampInt(params.segments, 1, 32);

  const hx = width * 0.5;
  const hy = height * 0.5;
  const hz = depth * 0.5;

  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];
  const vertMap = new Map<string, number>();

  const addGridVert = (key: string, pos: Vec3): number => {
    const ex = vertMap.get(key);
    if (ex !== undefined) return ex;
    const idx = vertices.length;
    vertices.push(pos);
    vertMap.set(key, idx);
    return idx;
  };

  // Base grid at y = -hy (viewed from below, outward normal is -Y)
  for (let iz = 0; iz < segs; iz++) {
    for (let ix = 0; ix < segs; ix++) {
      const p00 = addGridVert(`b_${ix}_${iz}`, [-hx + (width * ix) / segs, -hy, -hz + (depth * iz) / segs]);
      const p10 = addGridVert(`b_${ix + 1}_${iz}`, [-hx + (width * (ix + 1)) / segs, -hy, -hz + (depth * iz) / segs]);
      const p11 = addGridVert(`b_${ix + 1}_${iz + 1}`, [-hx + (width * (ix + 1)) / segs, -hy, -hz + (depth * (iz + 1)) / segs]);
      const p01 = addGridVert(`b_${ix}_${iz + 1}`, [-hx + (width * ix) / segs, -hy, -hz + (depth * (iz + 1)) / segs]);
      faces.push({ verts: [p00, p10, p11, p01] });
    }
  }

  const apexIdx = addGridVert('apex', [0, hy, 0]);

  // Helper to get vertex on one of the 4 sloped sides at tier `r ∈ [0..segs]` (0 = base, segs = apex)
  // Base perimeter corners in CCW order around +Y (looking from top):
  // Front (+Z): (-hx, +hz) -> (+hx, +hz)
  // Right (+X): (+hx, +hz) -> (+hx, -hz)
  // Back (-Z):  (+hx, -hz) -> (-hx, -hz)
  // Left (-X):  (-hx, -hz) -> (-hx, +hz)
  const sideDefs: {
    baseKey: (c: number) => string;
    sideId: string;
    nextSideId: string;
    pStart: Vec3;
    pEnd: Vec3;
  }[] = [
    {
      sideId: 'F',
      nextSideId: 'R',
      baseKey: (c) => `b_${c}_${segs}`,
      pStart: [-hx, -hy, hz],
      pEnd: [hx, -hy, hz],
    },
    {
      sideId: 'R',
      nextSideId: 'B',
      baseKey: (c) => `b_${segs}_${segs - c}`,
      pStart: [hx, -hy, hz],
      pEnd: [hx, -hy, -hz],
    },
    {
      sideId: 'B',
      nextSideId: 'L',
      baseKey: (c) => `b_${segs - c}_0`,
      pStart: [hx, -hy, -hz],
      pEnd: [-hx, -hy, -hz],
    },
    {
      sideId: 'L',
      nextSideId: 'F',
      baseKey: (c) => `b_0_${c}`,
      pStart: [-hx, -hy, -hz],
      pEnd: [-hx, -hy, hz],
    },
  ];

  const getSlopeVert = (sIdx: number, tier: number, col: number, colsInTier: number): number => {
    if (tier === segs) return apexIdx;
    const def = sideDefs[sIdx];
    if (tier === 0) {
      // Map directly to base perimeter vertex!
      const baseCol = Math.round((col / colsInTier) * segs);
      return vertMap.get(def.baseKey(baseCol))!;
    }
    // Shared ridge corners: col === 0 is ridge `sIdx`, col === colsInTier is ridge `(sIdx + 1) % 4`
    const vFrac = tier / segs;
    const uFrac = col / colsInTier;
    const basePt: Vec3 = [
      def.pStart[0] + (def.pEnd[0] - def.pStart[0]) * uFrac,
      -hy,
      def.pStart[2] + (def.pEnd[2] - def.pStart[2]) * uFrac,
    ];
    const pos: Vec3 = [
      basePt[0] * (1 - vFrac),
      -hy + height * vFrac,
      basePt[2] * (1 - vFrac),
    ];
    if (col === 0) return addGridVert(`ridge_${sIdx}_${tier}`, pos);
    if (col === colsInTier) return addGridVert(`ridge_${(sIdx + 1) % 4}_${tier}`, pos);
    return addGridVert(`slope_${sIdx}_${tier}_${col}`, pos);
  };

  for (let sIdx = 0; sIdx < 4; sIdx++) {
    for (let tier = 0; tier < segs; tier++) {
      const cols = segs;
      if (tier === segs - 1) {
        // Top tier triangles meeting at apex
        for (let c = 0; c < cols; c++) {
          const b0 = getSlopeVert(sIdx, tier, c, cols);
          const b1 = getSlopeVert(sIdx, tier, c + 1, cols);
          faces.push({ verts: [b0, b1, apexIdx] });
        }
      } else {
        for (let c = 0; c < cols; c++) {
          const b0 = getSlopeVert(sIdx, tier, c, cols);
          const b1 = getSlopeVert(sIdx, tier, c + 1, cols);
          const t1 = getSlopeVert(sIdx, tier + 1, c + 1, cols);
          const t0 = getSlopeVert(sIdx, tier + 1, c, cols);
          faces.push({ verts: [b0, b1, t1, t0] });
        }
      }
    }
  }

  const baseMesh = compactEditableMesh({ vertices, faces });
  const maxR = Math.min(width, height, depth) * 0.35;
  const fRad = params.fillet ? Math.max(0, Math.min(params.filletRadius, maxR)) : 0;
  if (fRad <= 1e-5) return baseMesh;

  const adj = buildHalfEdgeOrAdjacency(baseMesh);
  const sharpEdges = adj.edges
    .filter((e) => {
      if (e.faces.length !== 2) return false;
      const n0 = adj.faceNormals[e.faces[0]];
      const n1 = adj.faceNormals[e.faces[1]];
      return n0[0] * n1[0] + n0[1] * n1[1] + n0[2] * n1[2] < 0.95;
    })
    .map((e) => e.index);

  return bevelEdges(baseMesh, sharpEdges, {
    width: fRad,
    segments: clampInt(params.filletSubdivisions, 1, 16),
    profile: 0.5,
  }).mesh;
}

// ============================================================================
// 6. TORUS (PURE QUADS + PARTIAL ARC CAPS)
// ============================================================================

function createTorusMesh(params: TorusParams): EditableMeshData {
  const radius = clampPos(params.radius);
  const tube = clampPos(params.tube);
  const rSeg = clampInt(params.radialSegments, 3, 128);
  const tSeg = clampInt(params.tubularSegments, 3, 256);
  const arcDeg = Math.max(10, Math.min(360, Number.isFinite(params.arcDeg) ? params.arcDeg : 360));
  const isClosedArc = arcDeg >= 359.99;
  const arcRad = (arcDeg * Math.PI) / 180;

  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];
  const ringCount = isClosedArc ? tSeg : tSeg + 1;
  const rings: number[][] = [];

  for (let i = 0; i < ringCount; i++) {
    const u = (i / tSeg) * arcRad;
    const cosU = Math.cos(u);
    const sinU = Math.sin(u);
    const ring: number[] = [];
    for (let j = 0; j < rSeg; j++) {
      const v = (j / rSeg) * Math.PI * 2;
      const cosV = Math.cos(v);
      const sinV = Math.sin(v);
      const x = (radius + tube * cosV) * cosU;
      const y = tube * sinV;
      const z = -(radius + tube * cosV) * sinU;
      const idx = vertices.length;
      vertices.push([x, y, z]);
      ring.push(idx);
    }
    rings.push(ring);
  }

  for (let i = 0; i < tSeg; i++) {
    const r0 = rings[i];
    const r1 = rings[(i + 1) % rings.length];
    for (let j = 0; j < rSeg; j++) {
      const jNext = (j + 1) % rSeg;
      faces.push({ verts: [r0[j], r1[j], r1[jNext], r0[jNext]] });
    }
  }

  if (!isClosedArc) {
    // Cap start and end cross-sections so partial torus is watertight
    const startCenter = vertices.length;
    vertices.push([radius, 0, 0]);
    const endCenter = vertices.length;
    vertices.push([radius * Math.cos(arcRad), 0, -radius * Math.sin(arcRad)]);

    const firstRing = rings[0];
    const lastRing = rings[rings.length - 1];
    for (let j = 0; j < rSeg; j++) {
      const jNext = (j + 1) % rSeg;
      faces.push({ verts: [startCenter, firstRing[jNext], firstRing[j]] });
      faces.push({ verts: [endCenter, lastRing[j], lastRing[jNext]] });
    }
  }

  return { vertices, faces };
}

// ============================================================================
// 7. CAPSULE
// ============================================================================

function createCapsuleMesh(params: CapsuleParams): EditableMeshData {
  const radius = clampPos(params.radius);
  const totalHeight = Math.max(radius * 2, clampPos(params.height));
  const cylHeight = Math.max(0, totalHeight - radius * 2);
  const radialSegments = clampInt(params.radialSegments, 4, 128);
  const capSegments = clampInt(params.capSegments, 2, 64);

  const halfCyl = cylHeight * 0.5;
  const profile: Profile2DPoint[] = [];

  // Top hemisphere (+Y pole down to +halfCyl)
  for (let i = 0; i <= capSegments; i++) {
    const theta = (i / capSegments) * (Math.PI * 0.5);
    profile.push({
      r: radius * Math.sin(theta),
      y: halfCyl + radius * Math.cos(theta),
    });
  }

  // Bottom hemisphere (-halfCyl down to -Y pole)
  const startBottom = cylHeight > 1e-5 ? 0 : 1;
  for (let i = startBottom; i <= capSegments; i++) {
    const theta = (i / capSegments) * (Math.PI * 0.5);
    profile.push({
      r: radius * Math.cos(theta),
      y: -halfCyl - radius * Math.sin(theta),
    });
  }

  return buildRevolvedMesh(profile, radialSegments, false);
}

// ============================================================================
// 8. TUBE (HOLLOW C4D TUBE WITH 4-RIM CHAMFER / FILLET, 100% QUADS!)
// ============================================================================

function createTubeMesh(params: TubeParams): EditableMeshData {
  const rA = clampPos(params.innerRadius);
  const rB = clampPos(params.outerRadius);
  const innerR = Math.min(rA, rB);
  const outerR = Math.max(innerR + 1e-3, Math.max(rA, rB));
  const height = clampPos(params.height);
  const radialSegments = clampInt(params.radialSegments, 4, 128);
  const heightSegments = clampInt(params.heightSegments, 1, 64);
  const fSubs = clampInt(params.filletSubdivisions, 1, 24);
  const maxFillet = Math.min((outerR - innerR) * 0.48, height * 0.48);
  const fRad = params.fillet ? Math.max(0, Math.min(params.filletRadius, maxFillet)) : 0;

  const hy = height * 0.5;
  const topInner: Profile2DPoint = { r: innerR, y: hy };
  const topOuter: Profile2DPoint = { r: outerR, y: hy };
  const botOuter: Profile2DPoint = { r: outerR, y: -hy };
  const botInner: Profile2DPoint = { r: innerR, y: -hy };

  // Closed loop clockwise in (r, y) so revolved quads face outward on outer wall, +Y on top, -Y on bottom, inward on bore!
  const topOuterArc =
    fRad > 1e-5 ? build2DCornerFillet(topInner, topOuter, botOuter, fRad, fSubs) : [topOuter];
  const botOuterArc =
    fRad > 1e-5 ? build2DCornerFillet(topOuter, botOuter, botInner, fRad, fSubs) : [botOuter];
  const botInnerArc =
    fRad > 1e-5 ? build2DCornerFillet(botOuter, botInner, topInner, fRad, fSubs) : [botInner];
  const topInnerArc =
    fRad > 1e-5 ? build2DCornerFillet(botInner, topInner, topOuter, fRad, fSubs) : [topInner];

  const profile: Profile2DPoint[] = [];

  // Top outer arc + outer wall subdivisions
  profile.push(...topOuterArc);
  const outerStart = topOuterArc[topOuterArc.length - 1];
  const outerEnd = botOuterArc[0];
  for (let h = 1; h < heightSegments; h++) {
    const t = h / heightSegments;
    profile.push({
      r: outerStart.r + (outerEnd.r - outerStart.r) * t,
      y: outerStart.y + (outerEnd.y - outerStart.y) * t,
    });
  }

  // Bottom outer arc + bottom inner arc + inner bore subdivisions + top inner arc
  profile.push(...botOuterArc);
  profile.push(...botInnerArc);
  const innerStart = botInnerArc[botInnerArc.length - 1];
  const innerEnd = topInnerArc[0];
  for (let h = 1; h < heightSegments; h++) {
    const t = h / heightSegments;
    profile.push({
      r: innerStart.r + (innerEnd.r - innerStart.r) * t,
      y: innerStart.y + (innerEnd.y - innerStart.y) * t,
    });
  }
  profile.push(...topInnerArc);

  return buildRevolvedMesh(profile, radialSegments, true);
}

// ============================================================================
// 9 & 10. PLANE & DISC
// ============================================================================

function createPlaneMesh(params: PlaneParams): EditableMeshData {
  const width = clampPos(params.width);
  const depth = clampPos(params.depth);
  const segX = clampInt(params.segX, 1, 128);
  const segZ = clampInt(params.segZ, 1, 128);

  const hx = width * 0.5;
  const hz = depth * 0.5;
  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];

  for (let iz = 0; iz <= segZ; iz++) {
    const z = -hz + (depth * iz) / segZ;
    for (let ix = 0; ix <= segX; ix++) {
      const x = -hx + (width * ix) / segX;
      vertices.push([x, 0, z]);
    }
  }

  const stride = segX + 1;
  for (let iz = 0; iz < segZ; iz++) {
    for (let ix = 0; ix < segX; ix++) {
      const v00 = iz * stride + ix;
      const v10 = v00 + 1;
      const v01 = (iz + 1) * stride + ix;
      const v11 = v01 + 1;
      const u0 = ix / segX;
      const u1 = (ix + 1) / segX;
      const v0 = 1 - iz / segZ;
      const v1 = 1 - (iz + 1) / segZ;
      const uvs: Vec2[] = [[u0, v0], [u0, v1], [u1, v1], [u1, v0]];
      faces.push({ verts: [v00, v01, v11, v10], uvs });
    }
  }

  return { vertices, faces };
}

function createDiscMesh(params: DiscParams): EditableMeshData {
  const innerR = Math.max(0, Number.isFinite(params.innerRadius) ? params.innerRadius : 0);
  const outerR = Math.max(innerR + 1e-3, clampPos(params.outerRadius));
  const radialSegs = clampInt(params.radialSegments, 3, 128);
  const ringSegs = clampInt(params.ringSegments, 1, 64);

  const vertices: Vec3[] = [];
  const faces: MeshFace[] = [];

  const hasHole = innerR > 1e-5;
  const startRingIdx = hasHole ? 0 : 1;
  const rings: number[][] = [];

  let centerIdx = -1;
  if (!hasHole) {
    centerIdx = vertices.length;
    vertices.push([0, 0, 0]);
  }

  for (let r = startRingIdx; r <= ringSegs; r++) {
    const radius = innerR + ((outerR - innerR) * r) / ringSegs;
    const row: number[] = [];
    for (let s = 0; s < radialSegs; s++) {
      const phi = (s / radialSegs) * Math.PI * 2;
      const x = Math.sin(phi) * radius;
      const z = Math.cos(phi) * radius;
      const idx = vertices.length;
      vertices.push([x, 0, z]);
      row.push(idx);
    }
    rings.push(row);
  }

  if (!hasHole) {
    const first = rings[0];
    for (let s = 0; s < radialSegs; s++) {
      const sNext = (s + 1) % radialSegs;
      faces.push({ verts: [centerIdx, first[s], first[sNext]] });
    }
  }

  for (let r = 0; r < rings.length - 1; r++) {
    const r0 = rings[r];
    const r1 = rings[r + 1];
    for (let s = 0; s < radialSegs; s++) {
      const sNext = (s + 1) % radialSegs;
      faces.push({ verts: [r0[s], r1[s], r1[sNext], r0[sNext]] });
    }
  }

  return { vertices, faces };
}

// ============================================================================
// 11. PLATONIC SOLIDS (TETRA, OCTA, TRUE PENTAGONAL DODECA, ICOSA + FILLET)
// ============================================================================

function createPlatonicMesh(params: PlatonicParams): EditableMeshData {
  const radius = clampPos(params.radius);
  const subs = clampInt(params.subdivisions, 0, 4);

  let rawVerts: Vec3[] = [];
  let rawFaces: number[][] = [];

  if (params.polyhedron === 'tetrahedron') {
    rawVerts = [
      [1, 1, 1],
      [-1, -1, 1],
      [-1, 1, -1],
      [1, -1, -1],
    ];
    rawFaces = [
      [2, 1, 0],
      [0, 3, 2],
      [1, 3, 0],
      [2, 3, 1],
    ];
  } else if (params.polyhedron === 'octahedron') {
    rawVerts = [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 1, 0],
      [0, -1, 0],
      [0, 0, 1],
      [0, 0, -1],
    ];
    rawFaces = [
      [0, 2, 4],
      [4, 2, 1],
      [1, 2, 5],
      [5, 2, 0],
      [4, 3, 0],
      [1, 3, 4],
      [5, 3, 1],
      [0, 3, 5],
    ];
  } else if (params.polyhedron === 'icosahedron') {
    const t = (1 + Math.sqrt(5)) * 0.5;
    rawVerts = [
      [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
      [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
      [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
    ];
    rawFaces = [
      [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
      [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
      [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
      [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];
  } else {
    // True 12-pentagon regular dodecahedron!
    const phi = (1 + Math.sqrt(5)) * 0.5;
    const inv = 1 / phi;
    rawVerts = [
      // (±1, ±1, ±1) -> 0..7
      [-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1],
      [1, -1, -1], [1, -1, 1], [1, 1, -1], [1, 1, 1],
      // (0, ±1/phi, ±phi) -> 8..11
      [0, -inv, -phi], [0, -inv, phi], [0, inv, -phi], [0, inv, phi],
      // (±1/phi, ±phi, 0) -> 12..15
      [-inv, -phi, 0], [-inv, phi, 0], [inv, -phi, 0], [inv, phi, 0],
      // (±phi, 0, ±1/phi) -> 16..19
      [-phi, 0, -inv], [phi, 0, -inv], [-phi, 0, inv], [phi, 0, inv],
    ];
    rawFaces = [
      [3, 11, 7, 15, 13],
      [7, 19, 17, 6, 15],
      [17, 4, 8, 10, 6],
      [8, 0, 16, 2, 10],
      [0, 12, 1, 18, 16],
      [6, 10, 2, 13, 15],
      [2, 16, 18, 3, 13],
      [18, 1, 9, 11, 3],
      [4, 14, 12, 0, 8],
      [11, 9, 5, 19, 7],
      [19, 5, 14, 4, 17],
      [1, 12, 14, 5, 9],
    ];
  }

  // Project onto circumsphere of `radius`
  const projectToRadius = (v: Vec3): Vec3 => {
    const l = Math.hypot(v[0], v[1], v[2]) || 1;
    return [(v[0] / l) * radius, (v[1] / l) * radius, (v[2] / l) * radius];
  };

  let mesh: EditableMeshData = {
    vertices: rawVerts.map(projectToRadius),
    faces: rawFaces.map((verts) => ({ verts })),
  };

  for (let s = 0; s < subs; s++) {
    mesh = subdivideFaces(mesh, [], { smooth: false }).mesh;
    mesh.vertices = mesh.vertices.map(projectToRadius);
  }

  if (params.fillet && params.filletRadius > 1e-5) {
    const adj = buildHalfEdgeOrAdjacency(mesh);
    const allEdges = adj.edges.map((e) => e.index);
    mesh = bevelEdges(mesh, allEdges, {
      width: params.filletRadius,
      segments: clampInt(params.filletSubdivisions, 1, 16),
      profile: 0.5,
    }).mesh;
  }

  return mesh;
}

// ============================================================================
// PUBLIC DISPATCHERS
// ============================================================================

export function createPrimitiveEditableMesh(spec: PrimitiveSpec): EditableMeshData {
  switch (spec.kind) {
    case 'cube':
      return createCubeMesh(spec.params);
    case 'sphere':
      return createSphereMesh(spec.params);
    case 'cylinder':
      return createCylinderMesh(spec.params);
    case 'cone':
      return createConeMesh(spec.params);
    case 'pyramid':
      return createPyramidMesh(spec.params);
    case 'torus':
      return createTorusMesh(spec.params);
    case 'capsule':
      return createCapsuleMesh(spec.params);
    case 'tube':
      return createTubeMesh(spec.params);
    case 'plane':
      return createPlaneMesh(spec.params);
    case 'disc':
      return createDiscMesh(spec.params);
    case 'platonic':
      return createPlatonicMesh(spec.params);
  }
}

export function createPrimitiveGeometry(
  spec: PrimitiveSpec,
  options?: { phongAngleDeg?: number },
): THREE.BufferGeometry {
  const mesh = createPrimitiveEditableMesh(spec);
  return editableMeshToBufferGeometry(mesh, options);
}
