#!/usr/bin/env node
/**
 * Generates optimal-resolution (2048x2048 RGBA) AI-ready Front/Back Paper-Doll
 * UV Template Maps (`public/dress-templates/*.png`) and 10 built-in 2048x2048 RGBA
 * studio outfit image maps (`public/dress-maps/*.png`) directly from the exact
 * `_PNC_DRESS` paper-doll UV geometry of `Mannequin_Male.glb` and `Mannequin_Female.glb`.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANNEQUIN_DIR = join(ROOT, 'public', 'models', 'mannequin');
const TEMPLATE_DIR = join(ROOT, 'public', 'dress-templates');
const MAPS_DIR = join(ROOT, 'public', 'dress-maps');
const SIZE = 2048;
const HALF = SIZE / 2; // 1024: [0..1023] = FRONT, [1024..2047] = BACK

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

// Fast CRC32 for PNG encoding
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** Encodes a `width x height` RGBA `Uint8Array` into a compressed valid PNG buffer (with Sub filter for fast crisp compression). */
function encodeRgbaPng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * (stride + 1);
    raw[rowOff] = 1; // Sub filter (1) compresses smooth gradients & patterns sharply
    const srcRow = y * stride;
    for (let i = 0; i < stride; i++) {
      const prev = i >= 4 ? rgba[srcRow + i - 4] : 0;
      raw[rowOff + 1 + i] = (rgba[srcRow + i] - prev) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 6; // RGBA truecolor+alpha
  const compressed = deflateSync(raw, { level: 6 });
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Parses `Body` primitive attributes from `Mannequin_Male.glb` / `Mannequin_Female.glb`. */
function readMannequinGlb(glbPath) {
  const buf = readFileSync(glbPath);
  const jsonLen = buf.readUInt32LE(12);
  const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart);

  const readAcc = (accIdx) => {
    const acc = gltf.accessors[accIdx];
    const bv = gltf.bufferViews[acc.bufferView];
    const byteOffset = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
    const comps = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[acc.type];
    const len = acc.count * comps;
    const slice = bin.subarray(byteOffset, byteOffset + len * 4);
    if (acc.componentType === 5126) {
      return new Float32Array(slice.buffer, slice.byteOffset, len);
    }
    if (acc.componentType === 5125) {
      return new Uint32Array(slice.buffer, slice.byteOffset, len);
    }
    if (acc.componentType === 5123) {
      return new Uint16Array(slice.buffer, slice.byteOffset, acc.count * comps);
    }
    throw new Error(`Unsupported componentType ${acc.componentType}`);
  };

  const bodyMesh = gltf.meshes.find((m) => m.name === 'Body') ?? gltf.meshes[0];
  const prim = bodyMesh.primitives[0];
  const pos = readAcc(prim.attributes.POSITION);
  const nrm = readAcc(prim.attributes.NORMAL);
  const dress = readAcc(prim.attributes._PNC_DRESS);
  const joints = readAcc(prim.attributes.JOINTS_0);
  const weights = readAcc(prim.attributes.WEIGHTS_0);
  const indices = readAcc(prim.indices);

  const skin = gltf.skins[0];
  const boneNames = skin.joints.map((ni) => gltf.nodes[ni].name);
  const ibm = readAcc(skin.inverseBindMatrices);
  const bonePositions = new Map();
  // Invert each column-major 4x4 inverseBindMatrix `M_inv = [R^T, -R^T * t; 0, 1]` -> `t = -R * m[12..14]`
  skin.joints.forEach((_, bi) => {
    const o = bi * 16;
    const tx = ibm[o + 12], ty = ibm[o + 13], tz = ibm[o + 14];
    // Since R^T is stored in columns 0..2 of M_inv, R is its transpose:
    const wx = -(ibm[o + 0] * tx + ibm[o + 1] * ty + ibm[o + 2] * tz);
    const wy = -(ibm[o + 4] * tx + ibm[o + 5] * ty + ibm[o + 6] * tz);
    const wz = -(ibm[o + 8] * tx + ibm[o + 9] * ty + ibm[o + 10] * tz);
    bonePositions.set(boneNames[bi], [wx, wy, wz]);
  });

  return { pos, nrm, dress, joints, weights, indices, boneNames, bonePositions };
}

/**
 * Rasterizes the Front (`U in [0, 0.5]`) and Back (`U in [0.5, 1.0]`) body triangles onto a `2048x2048`
 * G-buffer, then dilates 24px into the lateral UV gutter so side seams never sample empty texels.
 */
function buildBodyPaperDollBuffer(model) {
  const { pos, nrm, dress, joints, weights, indices, boneNames, bonePositions } = model;
  const vCount = pos.length / 3;

  // Only free-hanging arm bones belong in `armSet` — NEVER `clavicle_l/r`, which form the top shoulder & strap bed!
  const armSet = new Set(['upperarm_l', 'lowerarm_l', 'hand_l', 'upperarm_r', 'lowerarm_r', 'hand_r']);
  const handSet = new Set(['hand_l', 'hand_r']);
  const legSet = new Set(['thigh_l', 'calf_l', 'foot_l', 'ball_l', 'thigh_r', 'calf_r', 'foot_r', 'ball_r']);
  const footSet = new Set(['foot_l', 'ball_l', 'foot_r', 'ball_r']);

  const vArm = new Float32Array(vCount);
  const vHand = new Float32Array(vCount);
  const vLeg = new Float32Array(vCount);
  const vFoot = new Float32Array(vCount);

  for (let i = 0; i < vCount; i++) {
    let aw = 0, hw = 0, lw = 0, fw = 0;
    for (let k = 0; k < 4; k++) {
      const bName = boneNames[joints[i * 4 + k]] ?? '';
      const w = weights[i * 4 + k];
      if (armSet.has(bName) || bName.includes('thumb') || bName.includes('index') || bName.includes('middle') || bName.includes('ring') || bName.includes('pinky')) aw += w;
      if (handSet.has(bName) || bName.includes('thumb') || bName.includes('index') || bName.includes('middle') || bName.includes('ring') || bName.includes('pinky')) hw += w;
      if (legSet.has(bName) || bName.includes('toe')) lw += w;
      if (footSet.has(bName) || bName.includes('toe')) fw += w;
    }
    vArm[i] = clamp(aw, 0, 1);
    vHand[i] = clamp(hw, 0, 1);
    vLeg[i] = clamp(lw, 0, 1);
    vFoot[i] = clamp(fw, 0, 1);
  }

  const N = SIZE * SIZE;
  const zBuf = new Float32Array(N).fill(-Infinity);
  const mask = new Uint8Array(N); // 1 = inside actual body silhouette (including head for template), 2 = dress-eligible body
  const pxX = new Float32Array(N);
  const pxY = new Float32Array(N);
  const pxZ = new Float32Array(N);
  const nxBuf = new Float32Array(N);
  const nyBuf = new Float32Array(N);
  const nzBuf = new Float32Array(N);
  const eligBuf = new Float32Array(N);
  const armBuf = new Float32Array(N);
  const handBuf = new Float32Array(N);
  const legBuf = new Float32Array(N);
  const footBuf = new Float32Array(N);

  const rasterHalf = (isFront) => {
    const triCount = indices.length / 3;
    for (let t = 0; t < triCount; t++) {
      const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];
      const f0 = dress[i0 * 4 + 2], f1 = dress[i1 * 4 + 2], f2 = dress[i2 * 4 + 2];
      if (isFront ? (f0 < 0 || f1 < 0 || f2 < 0) : (f0 > 0 || f1 > 0 || f2 > 0)) {
        continue;
      }
      // _PNC_DRESS.x already stores exact split island U ([0.012..0.488] Front, [0.512..0.988] Back)
      const u0 = dress[i0 * 4];
      const u1 = dress[i1 * 4];
      const u2 = dress[i2 * 4];
      // Image Y=0 is top (vPaper = 1), Y=SIZE-1 is bottom (vPaper = 0)
      const x0 = u0 * SIZE - 0.5, y0 = (1.0 - dress[i0 * 4 + 1]) * SIZE - 0.5;
      const x1 = u1 * SIZE - 0.5, y1 = (1.0 - dress[i1 * 4 + 1]) * SIZE - 0.5;
      const x2 = u2 * SIZE - 0.5, y2 = (1.0 - dress[i2 * 4 + 1]) * SIZE - 0.5;

      const minX = Math.max(isFront ? 0 : HALF, Math.floor(Math.min(x0, x1, x2)));
      const maxX = Math.min(isFront ? HALF - 1 : SIZE - 1, Math.ceil(Math.max(x0, x1, x2)));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
      const maxY = Math.min(SIZE - 1, Math.ceil(Math.max(y0, y1, y2)));
      if (minX > maxX || minY > maxY) continue;

      const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
      if (Math.abs(area) < 1e-5) continue;
      const invArea = 1 / area;

      // Prefer outermost front (+Z) or back (-Z) surface
      const d0 = isFront ? pos[i0 * 3 + 2] : -pos[i0 * 3 + 2];
      const d1 = isFront ? pos[i1 * 3 + 2] : -pos[i1 * 3 + 2];
      const d2 = isFront ? pos[i2 * 3 + 2] : -pos[i2 * 3 + 2];

      for (let py = minY; py <= maxY; py++) {
        for (let px = minX; px <= maxX; px++) {
          const w0 = ((x1 - px) * (y2 - py) - (x2 - px) * (y1 - py)) * invArea;
          const w1 = ((x2 - px) * (y0 - py) - (x0 - px) * (y2 - py)) * invArea;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const depth = w0 * d0 + w1 * d1 + w2 * d2;
          const idx = py * SIZE + px;
          if (depth <= zBuf[idx]) continue;
          zBuf[idx] = depth;
          const el = w0 * dress[i0 * 4 + 3] + w1 * dress[i1 * 4 + 3] + w2 * dress[i2 * 4 + 3];
          mask[idx] = el > 0.25 ? 2 : 1;
          pxX[idx] = w0 * pos[i0 * 3] + w1 * pos[i1 * 3] + w2 * pos[i2 * 3];
          pxY[idx] = w0 * pos[i0 * 3 + 1] + w1 * pos[i1 * 3 + 1] + w2 * pos[i2 * 3 + 1];
          pxZ[idx] = w0 * pos[i0 * 3 + 2] + w1 * pos[i1 * 3 + 2] + w2 * pos[i2 * 3 + 2];
          nxBuf[idx] = w0 * nrm[i0 * 3] + w1 * nrm[i1 * 3] + w2 * nrm[i2 * 3];
          nyBuf[idx] = w0 * nrm[i0 * 3 + 1] + w1 * nrm[i1 * 3 + 1] + w2 * nrm[i2 * 3 + 1];
          nzBuf[idx] = w0 * nrm[i0 * 3 + 2] + w1 * nrm[i1 * 3 + 2] + w2 * nrm[i2 * 3 + 2];
          eligBuf[idx] = el;
          armBuf[idx] = w0 * vArm[i0] + w1 * vArm[i1] + w2 * vArm[i2];
          handBuf[idx] = w0 * vHand[i0] + w1 * vHand[i1] + w2 * vHand[i2];
          legBuf[idx] = w0 * vLeg[i0] + w1 * vLeg[i1] + w2 * vLeg[i2];
          footBuf[idx] = w0 * vFoot[i0] + w1 * vFoot[i1] + w2 * vFoot[i2];
        }
      }
    }
  };

  rasterHalf(true);
  rasterHalf(false);

  // Compute smooth signed silhouette coverage (3x3 box filter on mask>0) + 24px outward attribute dilation
  // so lateral UV seams & bilinear mipmaps never sample undefined coordinates!
  const silCoverage = new Float32Array(N);
  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          sum += mask[(y + dy) * SIZE + (x + dx)] > 0 ? 1 : 0;
        }
      }
      silCoverage[y * SIZE + x] = sum / 9;
    }
  }

  const dilated = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (mask[i] === 2) dilated[i] = 1;

  const dirs = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
  ];
  let frontier = [];
  for (let y = 1; y < SIZE - 1; y++) {
    for (let x = 1; x < SIZE - 1; x++) {
      const idx = y * SIZE + x;
      if (!dilated[idx]) continue;
      for (const [dx, dy] of dirs) {
        if (!dilated[(y + dy) * SIZE + (x + dx)]) {
          frontier.push(idx);
          break;
        }
      }
    }
  }

  // Dilate 28px outward within each half ([0..1023] and [1024..2047]) — including over the top-shoulder ridge!
  // Note: allow dilation into head/neck pixels ONLY outside the neck core (|pxX| > 0.068) so shoulder ridge bleeds upward cleanly without painting the face!
  for (let step = 0; step < 28; step++) {
    const nextFrontier = [];
    for (const srcIdx of frontier) {
      const sx = srcIdx % SIZE;
      const sy = (srcIdx - sx) / SIZE;
      const halfMin = sx < HALF ? 0 : HALF;
      const halfMax = sx < HALF ? HALF - 1 : SIZE - 1;
      for (const [dx, dy] of dirs) {
        const nx = sx + dx, ny = sy + dy;
        if (nx < halfMin || nx > halfMax || ny < 0 || ny >= SIZE) continue;
        const dstIdx = ny * SIZE + nx;
        if (dilated[dstIdx]) continue;
        if (mask[dstIdx] === 1 && Math.abs(pxX[srcIdx]) < 0.068) continue;
        dilated[dstIdx] = 2; // 2 = seam-bleed safety margin pixel
        pxX[dstIdx] = pxX[srcIdx];
        pxY[dstIdx] = pxY[srcIdx];
        pxZ[dstIdx] = pxZ[srcIdx];
        nxBuf[dstIdx] = nxBuf[srcIdx];
        nyBuf[dstIdx] = nyBuf[srcIdx];
        nzBuf[dstIdx] = nzBuf[srcIdx];
        eligBuf[dstIdx] = Math.max(eligBuf[srcIdx], 0.98);
        armBuf[dstIdx] = armBuf[srcIdx];
        handBuf[dstIdx] = handBuf[srcIdx];
        legBuf[dstIdx] = legBuf[srcIdx];
        footBuf[dstIdx] = footBuf[srcIdx];
        nextFrontier.push(dstIdx);
      }
    }
    frontier = nextFrontier;
  }

  // Extract anatomical reference heights directly from skeleton joints
  const getBoneY = (name, fallback) => (bonePositions.get(name)?.[1] ?? fallback);
  const shL = bonePositions.get('upperarm_l') ?? [0.17, 1.44, 0];
  const wrL = bonePositions.get('hand_l') ?? [0.68, 1.12, 0];
  const armSpanLen = Math.hypot(wrL[0] - shL[0], wrL[1] - shL[1], wrL[2] - shL[2]) || 0.52;

  const landmarks = {
    neckY: getBoneY('neck_01', 1.51),
    clavicleY: getBoneY('clavicle_l', 1.45),
    chestY: getBoneY('spine_03', 1.29) + 0.035,
    waistY: getBoneY('spine_02', 1.11) - 0.015,
    pelvisY: getBoneY('pelvis', 0.96),
    thighY: getBoneY('thigh_l', 0.92),
    kneeY: getBoneY('calf_l', 0.50),
    ankleY: getBoneY('foot_l', 0.085),
    shoulderPos: shL,
    armSpanLen,
  };

  return {
    mask,
    dilated,
    silCoverage,
    pxX,
    pxY,
    pxZ,
    nxBuf,
    nyBuf,
    nzBuf,
    eligBuf,
    armBuf,
    handBuf,
    legBuf,
    footBuf,
    landmarks,
  };
}

// Tiny crisp 5x7 pixel font for template map labels (`FRONT`, `BACK`, `COLLAR`, `CHEST`, `WAIST`, `HIP`, `KNEE`, etc.)
const FONT_5X7 = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01111', '10000', '10000', '10111', '10001', '10001', '01110'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  '0': ['01110', '10011', '10101', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  ':': ['00000', '01100', '01100', '00000', '01100', '01100', '00000'],
  '/': ['00001', '00010', '00100', '01000', '10000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};

function drawPixelText(rgba, text, centerX, topY, scale, color) {
  const upper = text.toUpperCase();
  const charW = 6 * scale;
  const totalW = upper.length * charW - scale;
  let startX = Math.round(centerX - totalW * 0.5);
  for (let c = 0; c < upper.length; c++) {
    const glyph = FONT_5X7[upper[c]] ?? FONT_5X7[' '];
    for (let gy = 0; gy < 7; gy++) {
      const row = glyph[gy];
      for (let gx = 0; gx < 5; gx++) {
        if (row[gx] !== '1') continue;
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = startX + gx * scale + sx;
            const py = topY + gy * scale + sy;
            if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;
            const o = (py * SIZE + px) * 4;
            rgba[o] = color[0];
            rgba[o + 1] = color[1];
            rgba[o + 2] = color[2];
            rgba[o + 3] = color[3];
          }
        }
      }
    }
    startX += charW;
  }
}

/**
 * Generates the downloadable `2048x2048` AI-Ready Dress UV Template Map PNG:
 * - Transparent outside the mannequin silhouettes & subtle guides so AI / 2D painters can use alpha directly
 * - Crisp Front (`LEFT`) and Back (`RIGHT`) silhouettes, anatomical tailoring lines, and non-overlapping header labels.
 */
function renderDressTemplatePng(buf, sex) {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  const { mask, silCoverage, nxBuf, nyBuf, nzBuf, eligBuf, landmarks } = buf;
  const nomH = sex === 'male' ? 1.80 : 1.75;
  const scaleV = 0.91 / nomH;
  const yToRow = (bodyY) => Math.round((1.0 - (0.045 + bodyY * scaleV)) * SIZE);

  const guideLines = [
    { label: 'COLLAR', y: landmarks.clavicleY + 0.03, color: [52, 132, 212] },
    { label: sex === 'female' ? 'BUST' : 'CHEST', y: landmarks.chestY, color: [68, 158, 188] },
    { label: 'WAIST', y: landmarks.waistY, color: [46, 168, 126] },
    { label: 'HIP', y: landmarks.pelvisY - 0.02, color: [212, 138, 52] },
    { label: 'SHORTS HEM', y: (landmarks.thighY + landmarks.kneeY) * 0.54, color: [155, 112, 206] },
    { label: 'KNEE', y: landmarks.kneeY, color: [112, 128, 168] },
    { label: 'ANKLE HEM', y: landmarks.ankleY + 0.035, color: [92, 146, 184] },
  ];

  // 1. Subtle panel frame border & center divider (dashed) + CF / CB symmetry axes
  for (let y = 0; y < SIZE; y++) {
    // Center Front (x = 512) and Center Back (x = 1536) symmetry axes (dashed)
    if ((y >> 4) % 2 === 0) {
      for (const cx of [512, 1536]) {
        const o = (y * SIZE + cx) * 4;
        rgba[o] = 120; rgba[o + 1] = 148; rgba[o + 2] = 182; rgba[o + 3] = 115;
      }
    }
    // Central panel divider x = 1023..1024
    if ((y >> 3) % 2 === 0) {
      for (const dx of [HALF - 1, HALF]) {
        const o = (y * SIZE + dx) * 4;
        rgba[o] = 88; rgba[o + 1] = 112; rgba[o + 2] = 145; rgba[o + 3] = 180;
      }
    }
  }
  // Outer 2px registration border so AI tools preserve exact 2048x2048 canvas crop!
  for (let i = 0; i < SIZE; i++) {
    for (let t = 0; t < 3; t++) {
      for (const [px, py] of [[i, t], [i, SIZE - 1 - t], [t, i], [SIZE - 1 - t, i]]) {
        const o = (py * SIZE + px) * 4;
        rgba[o] = 74; rgba[o + 1] = 98; rgba[o + 2] = 128; rgba[o + 3] = 220;
      }
    }
  }

  // 2. Render 28px Seam-Bleed Safety Zone + Front & Back Mannequin Studio Silhouettes
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const idx = y * SIZE + x;
      const cov = silCoverage[idx];
      if (cov <= 0 && buf.dilated[idx] === 2) {
        // Subtle hatched 28px seam-bleed margin guide around shoulders, sleeves, torso & legs
        const hatch = ((x + y) & 15) < 3;
        let onBleedOuter = false;
        if (x >= 1 && x < SIZE - 1 && y >= 1 && y < SIZE - 1) {
          onBleedOuter =
            buf.dilated[idx - 1] === 0 || buf.dilated[idx + 1] === 0 ||
            buf.dilated[idx - SIZE] === 0 || buf.dilated[idx + SIZE] === 0;
        }
        if (onBleedOuter && ((x + y) >> 3) % 2 === 0) {
          const o = idx * 4;
          rgba[o] = 64; rgba[o + 1] = 156; rgba[o + 2] = 224; rgba[o + 3] = 175;
        } else if (hatch) {
          const o = idx * 4;
          rgba[o] = 92; rgba[o + 1] = 168; rgba[o + 2] = 228; rgba[o + 3] = 48;
        }
        continue;
      }
      if (cov <= 0) continue;
      const isFront = x < HALF;
      const nz = isFront ? nzBuf[idx] : -nzBuf[idx];
      const ny = nyBuf[idx];
      const lambert = clamp(0.56 + 0.30 * nz + 0.14 * ny, 0.32, 0.98);
      const isDressZone = eligBuf[idx] > 0.35;

      // Dressable body zone gets clean bright blueprint ivory-slate; head/face exclusion zone gets soft muted cool tint
      const baseR = isDressZone ? 236 : 196;
      const baseG = isDressZone ? 240 : 204;
      const baseB = isDressZone ? 246 : 216;

      // Crisp dark blueprint silhouette outline where coverage transitions (`0 < cov < 1`)
      const edgeFactor = cov > 0.02 && cov < 0.96 ? 1.0 : 0.0;
      // Check 2px neighborhood for thicker crisp 2.5px outer contour
      let nearOuter = edgeFactor;
      if (cov >= 0.96 && x >= 2 && x < SIZE - 2 && y >= 2 && y < SIZE - 2) {
        if (
          mask[idx - 2] === 0 || mask[idx + 2] === 0 ||
          mask[idx - SIZE * 2] === 0 || mask[idx + SIZE * 2] === 0
        ) {
          nearOuter = 0.85;
        }
      }

      const o = idx * 4;
      if (nearOuter > 0.4) {
        rgba[o] = 34;
        rgba[o + 1] = 52;
        rgba[o + 2] = 78;
        rgba[o + 3] = Math.round(clamp(cov * 255 * 1.25, 90, 255));
      } else {
        // Subtle 64px UV grid inside the dressable mannequin silhouette
        const onSubGrid = (x % 64 === 0 || y % 64 === 0) && isDressZone;
        rgba[o] = Math.round(baseR * lambert * (onSubGrid ? 0.92 : 1.0));
        rgba[o + 1] = Math.round(baseG * lambert * (onSubGrid ? 0.94 : 1.0));
        rgba[o + 2] = Math.round(baseB * lambert * (onSubGrid ? 0.97 : 1.0));
        rgba[o + 3] = isDressZone ? 245 : 165;
      }
    }
  }

  // 3. Draw horizontal tailoring guide lines across the silhouette + margin ticks & labels
  for (const g of guideLines) {
    const py = yToRow(g.y);
    if (py < 40 || py >= SIZE - 40) continue;
    for (let x = 24; x < SIZE - 24; x++) {
      const idx = py * SIZE + x;
      const inBody = mask[idx] === 2;
      const dashed = ((x >> 3) % 2) === 0;
      if (!inBody && !((x > 28 && x < 150) || (x > HALF + 28 && x < HALF + 150))) continue;
      if (!dashed) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const o = ((py + dy) * SIZE + x) * 4;
        rgba[o] = g.color[0];
        rgba[o + 1] = g.color[1];
        rgba[o + 2] = g.color[2];
        rgba[o + 3] = dy === 0 ? 235 : 140;
      }
    }
    drawPixelText(rgba, g.label, 96, py - 18, 2, [...g.color, 235]);
    drawPixelText(rgba, g.label, HALF + 96, py - 18, 2, [...g.color, 235]);
  }

  // 4. Crisp top & bottom safe-margin headers (`FRONT`, `BACK`, character label)
  const titleSex = sex === 'male' ? 'MANNEQUIN MALE' : 'MANNEQUIN FEMALE';
  drawPixelText(rgba, `${titleSex} - FRONT`, 512, 22, 4, [142, 188, 238, 255]);
  drawPixelText(rgba, `${titleSex} - BACK`, 1536, 22, 4, [142, 188, 238, 255]);
  drawPixelText(rgba, 'U: 0.00 - 0.50  CF AXIS', 512, SIZE - 42, 3, [128, 168, 214, 240]);
  drawPixelText(rgba, 'U: 0.50 - 1.00  CB AXIS', 1536, SIZE - 42, 3, [128, 168, 214, 240]);

  return encodeRgbaPng(SIZE, SIZE, rgba);
}

// Deterministic hash noise & procedural fabric micro-textures
function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
}

/** Antialiased garment step (`alpha` in `[0, 1]`) across a `featherMeters` transition width (~2.5mm = ~2.8px at 2048). */
const hemGreater = (val, edge, feather = 0.0028) => smooth(edge - feather, edge + feather, val);
const hemLess = (val, edge, feather = 0.0028) => 1 - smooth(edge - feather, edge + feather, val);
const bandMask = (val, center, halfWidth, feather = 0.0018) =>
  Math.max(0, 1 - smooth(halfWidth - feather, halfWidth + feather, Math.abs(val - center)));

/**
 * Renders one `2048x2048` RGBA outfit preset map onto the Front/Back Paper-Doll layout,
 * complete with woven micro-textures, soft sculptural cloth folds, flatlock/topstitched seams,
 * and dilated border RGB so mipmaps & alpha edges never produce dark fringes!
 */
function renderOutfitMapPng(buf, sex, presetId) {
  const rgba = new Uint8Array(SIZE * SIZE * 4);
  const { mask, dilated, pxX, pxY, pxZ, nxBuf, nyBuf, nzBuf, eligBuf, armBuf, handBuf, legBuf, footBuf, landmarks } = buf;
  const sh = landmarks.shoulderPos;
  const armLen = landmarks.armSpanLen;
  const nomH = sex === 'male' ? 1.80 : 1.75;
  const scaleV = 0.91 / nomH;

  /**
   * Pure 3D Neck / Collar Opening mask (`1.0` = clothed body/shoulder, `0.0` = bare neck/head opening).
   * CRITICAL: Outside `collarHalfW` (`|x| > collarHalfW`, i.e. over the entire clavicle, trapezius, acromion & deltoid),
   * there is NO horizontal ceiling cutoff at all — garment alpha stays `1.0` continuously across the top-of-shoulder
   * seam and throughout the entire 28px dilated UV bleed margin!
   */
  const evalCollarCoverage = (xSigned, absX, y, collarHalfW, frontCurveY, backCurveY, isFront, feather = 0.0026) => {
    const curveY = isFront ? frontCurveY : backCurveY;
    // Inside the lateral width of the neck hole (`|x| < collarHalfW`), cut out vertices above `curveY`.
    // Outside `collarHalfW` (`|x| >= collarHalfW`), `inLateralNeckSpan -> 0`, so top of shoulder is 100% covered!
    const inLateralNeckSpan = 1 - smooth(collarHalfW - feather, collarHalfW + feather, absX);
    const aboveCollarCurve = smooth(curveY - feather, curveY + feather, y);
    // Safety cap high on the head/jaw (`y > neckY + 0.055`) strictly near the head column (`|x| < 0.095`)
    const headSafety = smooth(landmarks.neckY + 0.048, landmarks.neckY + 0.062, y) * (1 - smooth(0.082, 0.098, absX));
    return clamp(1 - Math.max(inLateralNeckSpan * aboveCollarCurve, headSafety), 0, 1);
  };

  /** True 2D distance from the 3D collar opening rim curve `(s, curveY(s))` for `s in [0, collarHalfW]`. */
  const evalCollarRimDist = (absX, y, collarHalfW, curveY, cornerY) => {
    if (absX <= collarHalfW) {
      return Math.max(0, curveY - y);
    }
    return Math.hypot(absX - collarHalfW, y - cornerY);
  };

  for (let py = 0; py < SIZE; py++) {
    for (let px = 0; px < SIZE; px++) {
      const idx = py * SIZE + px;
      if (!dilated[idx]) continue;

      const isFront = px < HALF;
      const x = pxX[idx];
      const y = pxY[idx];
      const z = pxZ[idx];
      const absX = Math.abs(x);
      const nx = nxBuf[idx];
      const ny = nyBuf[idx];
      const nz = isFront ? nzBuf[idx] : -nzBuf[idx];
      const elig = eligBuf[idx];
      if (elig <= 0.02) continue;

      const wArm = armBuf[idx];
      const wHand = handBuf[idx];
      const wLeg = legBuf[idx];
      const wFoot = footBuf[idx];

      // Distance from shoulder socket along 3D rest arm (`0` = acromion/socket, `1` = wrist)
      const armDist = Math.hypot(absX - Math.abs(sh[0]), y - sh[1], z - sh[2]) / armLen;

      // Uniform 2D paper-doll coordinates (meters, centered on each island) for distortion-free textile weaves & prints
      const uLocal = isFront ? px / SIZE : (px - HALF) / SIZE;
      const paperX = (uLocal - 0.25) / scaleV;
      const paperY = ((1.0 - py / SIZE) - 0.045) / scaleV;

      // Subtle natural cloth drape & tension folds (sternum, waist gather, hip crease)
      const waistGather =
        0.026 * Math.sin(x * 86 + y * 28) * Math.exp(-(((y - (landmarks.waistY + 0.02)) / 0.14) ** 2)) * (1 - wArm);
      const sleeveFold = 0.020 * Math.sin(armDist * 52 + z * 40) * wArm;
      const studioShade = clamp(0.86 + 0.12 * nz + 0.05 * ny + waistGather + sleeveFold, 0.68, 1.09);

      // Authentic 2048px textile micro-textures matched to web garment references
      const jerseyGrain =
        0.972 +
        0.018 * Math.sin(px * 2.1) * Math.cos(py * 1.7) +
        0.022 * (valueNoise(px * 0.65, py * 0.65) - 0.5);
      const ribKnit2x2 = 0.942 + 0.058 * Math.sin(paperX * 520.0) * (0.9 + 0.1 * Math.cos(py * 1.4));
      const denimTwill =
        0.948 +
        0.042 * Math.sin((px + py) * 1.55) +
        0.028 * (valueNoise(px * 0.42, py * 0.9) - 0.5);
      const linenSlub =
        0.958 +
        0.024 * Math.sin(px * 1.35) * Math.exp(-(((valueNoise(px * 0.12, py * 0.85) - 0.5) / 0.28) ** 2)) +
        0.024 * Math.sin(py * 1.35) * Math.exp(-(((valueNoise(px * 0.85, py * 0.12) - 0.5) / 0.28) ** 2));
      const piqueWeave = 0.956 + 0.044 * (Math.sin(px * 1.5) * Math.sin(py * 1.5));

      // Stitched twin-needle seam helper (dashed thread micro-texture along a seam curve)
      const threadDash = 0.78 + 0.22 * Math.sin((px + py) * 1.9);

      let r = 210, g = 214, b = 220, alpha = 0;

      if (presetId === 'studio-briefs') {
        if (sex === 'male') {
          // Male: Tailored studio athletic trunk / boxer-briefs (jacquard elastic waistband + contoured pouch flatlock seams)
          const waistTop = landmarks.waistY - 0.052 - 0.008 * Math.cos(clamp(x / 0.16, -1, 1) * Math.PI * 0.5);
          const legHem = landmarks.thighY - 0.138 + 0.012 * absX;
          const torsoOnly = 1 - smooth(0.18, 0.52, wArm);
          alpha = hemLess(y, waistTop) * hemGreater(y, legHem) * torsoOnly;

          const inWaistband = hemLess(y, waistTop) * hemGreater(y, waistTop - 0.034);
          const pouchSeam = isFront
            ? (bandMask(absX, 0.050 + Math.max(0, y - legHem) * 0.075, 0.0028) +
               bandMask(absX, 0.002, 0.0020) * hemLess(y, landmarks.pelvisY - 0.02)) *
              hemLess(y, waistTop - 0.034)
            : 0;
          const backSeam = !isFront ? bandMask(absX, 0.0015, 0.0024) * hemLess(y, waistTop - 0.034) : 0;
          const outSeam = bandMask(absX, 0.132, 0.0024) * hemLess(y, waistTop - 0.034);
          const hemBind = bandMask(y, legHem + 0.009, 0.0045);

          let lum = 208 * ribKnit2x2 * studioShade;
          if (inWaistband > 0.04) {
            const doubleStripe = Math.max(
              bandMask(y, waistTop - 0.011, 0.0024),
              bandMask(y, waistTop - 0.022, 0.0024),
            );
            const centerTab = isFront ? hemLess(absX, 0.022, 0.002) * hemLess(y, waistTop - 0.006) * hemGreater(y, waistTop - 0.027) : 0;
            let wb = lerp(154, 232, doubleStripe * 0.85);
            wb = lerp(wb, 72, centerTab * 0.85);
            lum = lerp(lum, wb * studioShade, inWaistband);
          }
          const seam = clamp(Math.max(pouchSeam, backSeam, outSeam, hemBind * 0.75), 0, 1);
          lum = lerp(lum, lum * 0.78 * threadDash, seam * 0.85);
          r = lum * 0.97;
          g = lum * 0.99;
          b = lum * 1.02;
        } else {
          // Female: Sculpted studio activewear bralette & high-hip posing briefs (100% continuous over-shoulder straps!)
          const collarHalfW = 0.068;
          const frontNeckY = landmarks.clavicleY + 0.038 - 0.096 * Math.pow(Math.max(0, 1 - (absX / collarHalfW) ** 2), 0.85);
          const backNeckY = landmarks.clavicleY + 0.042 - 0.112 * Math.pow(Math.max(0, 1 - (absX / collarHalfW) ** 2), 0.9);
          const neckCov = evalCollarCoverage(x, absX, y, collarHalfW, frontNeckY, backNeckY, isFront);
          // Sleeveless curved armscye: strap outer edge stays at `|x|=0.106` over shoulder/clavicle and curves out smoothly below armpit
          const strapMaxX = lerp(0.168, 0.106, smooth(landmarks.chestY - 0.032, landmarks.clavicleY + 0.005, y));
          const armscyeCut = clamp(
            Math.max(
              smooth(strapMaxX - 0.003, strapMaxX + 0.003, absX),
              smooth(0.08, 0.15, armDist) * smooth(0.15, 0.42, wArm),
            ),
            0,
            1,
          );
          const underBust = landmarks.chestY - 0.066;
          const braAlpha = neckCov * (1 - armscyeCut) * hemGreater(y, underBust);

          const briefTop = landmarks.waistY - 0.068 - (isFront ? 0.018 : 0.006) * Math.cos(clamp(x / 0.16, -1, 1) * Math.PI * 0.5);
          // Both panels must end at the same height at the hip. Keep the
          // higher front opening and fuller seat away from the side seam.
          const legSlope = lerp(isFront ? 0.60 : 0.34, 0.47, smooth(0.11, 0.155, absX));
          const legCut = landmarks.pelvisY - 0.096 + legSlope * Math.max(0, absX - 0.042);
          const briefAlpha = hemLess(y, briefTop) * hemGreater(y, legCut) * (1 - smooth(0.18, 0.52, wArm));

          alpha = clamp(Math.max(braAlpha, briefAlpha), 0, 1);
          const underBand = hemLess(y, underBust + 0.024) * hemGreater(y, underBust) * braAlpha;
          const princessSeam = bandMask(absX, 0.076, 0.0022) * hemLess(y, underBust + 0.095) * hemGreater(y, underBust + 0.024) * braAlpha;
          const briefBand = hemLess(y, briefTop) * hemGreater(y, briefTop - 0.022) * briefAlpha;
          const legBind = bandMask(y, legCut + 0.007, 0.0045) * briefAlpha;

          let lum = 218 * jerseyGrain * studioShade;
          lum = lerp(lum, 184 * ribKnit2x2 * studioShade, Math.max(underBand, briefBand));
          lum = lerp(lum, lum * 0.80 * threadDash, clamp(Math.max(princessSeam, legBind), 0, 1) * 0.75);
          r = lum * 1.01;
          g = lum * 0.99;
          b = lum * 0.98;
        }
      } else if (presetId === 'athletic-sportswear') {
        if (sex === 'female') {
          // Directly matched to `ref-athletic-activewear.jpg`:
          // Crimson-berry surplice crossover V-neck sports bra + matte midnight-navy high-waist sculpt active shorts!
          const collarHalfW = 0.064;
          // Surplice crossover V-neck in front, athletic U-scoop in back; straps `|x| in [0.064, 0.114]` are 100% solid over shoulders!
          const vDepthFront = 0.128 * Math.max(0, 1 - absX / collarHalfW);
          const frontNeckY = landmarks.clavicleY + 0.048 - vDepthFront;
          const backNeckY = landmarks.clavicleY + 0.044 - 0.098 * Math.max(0, 1 - (absX / 0.070) ** 2);
          const neckCov = evalCollarCoverage(x, absX, y, isFront ? collarHalfW : 0.070, frontNeckY, backNeckY, isFront);
          const strapMaxX = lerp(0.168, 0.110, smooth(landmarks.chestY - 0.036, landmarks.clavicleY + 0.004, y));
          const armscyeCut = clamp(
            Math.max(
              smooth(strapMaxX - 0.003, strapMaxX + 0.003, absX),
              smooth(0.08, 0.15, armDist) * smooth(0.15, 0.42, wArm),
            ),
            0,
            1,
          );
          const underBust = landmarks.chestY - 0.072;
          const braAlpha = neckCov * (1 - armscyeCut) * hemGreater(y, underBust);

          // High-waist midnight-navy sculpt shorts (showing ~4.5cm toned midriff gap like the reference photo!)
          const shortTop = landmarks.waistY + 0.018 - (isFront ? 0.010 : 0.0) * Math.cos(clamp(x / 0.15, -1, 1) * Math.PI * 0.5);
          const shortHem = landmarks.thighY - 0.155;
          const shortAlpha = hemLess(y, shortTop) * hemGreater(y, shortHem) * (1 - smooth(0.18, 0.52, wArm));

          alpha = clamp(Math.max(braAlpha, shortAlpha), 0, 1);
          if (braAlpha >= shortAlpha && y >= underBust - 0.002) {
            // Crimson-berry performance jersey (`#ad233b`) + diagonal surplice wrap seam + ribbed underbust band
            const underBand = hemLess(y, underBust + 0.028);
            // Right-over-left diagonal surplice edge across front bust (`x` vs `y`)
            const surpliceEdgeY = landmarks.chestY - 0.044 + (x + 0.022) * 1.18;
            const surpliceSeam = isFront
              ? bandMask(y, surpliceEdgeY, 0.0042) * hemGreater(y, underBust + 0.026) * hemLess(absX, 0.095)
              : 0;
            const wrapShadow = isFront && y < surpliceEdgeY && y > underBust + 0.026 ? 0.93 : 1.0;
            const gatherPleat = isFront
              ? 0.035 * Math.sin((y - underBust) * 180 + x * 90) * hemLess(y, underBust + 0.075) * hemGreater(y, underBust + 0.026)
              : 0;
            const shade = (studioShade + gatherPleat) * wrapShadow * (underBand > 0.5 ? ribKnit2x2 : jerseyGrain);
            let cr = lerp(176, 148, underBand * 0.7);
            let cg = lerp(34, 26, underBand * 0.7);
            let cb = lerp(58, 46, underBand * 0.7);
            cr = lerp(cr, 122 * threadDash, surpliceSeam * 0.8);
            cg = lerp(cg, 20 * threadDash, surpliceSeam * 0.8);
            cb = lerp(cb, 38 * threadDash, surpliceSeam * 0.8);
            r = cr * shade;
            g = cg * shade;
            b = cb * shade;
          } else {
            // Matte midnight-navy (`#1e2638`) high-waist sculpt bike shorts with contoured V-yoke & flatlock seams
            const yokeBand = hemGreater(y, shortTop - 0.052);
            const yokeSeam = bandMask(y, shortTop - 0.052, 0.0028);
            const flatlockSide = bandMask(absX, 0.136, 0.0026) * hemLess(y, shortTop - 0.052);
            const hemStitch = bandMask(y, shortHem + 0.014, 0.0025);
            const seam = clamp(Math.max(yokeSeam, flatlockSide, hemStitch), 0, 1);
            const base = lerp(1.0, 0.91, yokeBand * 0.5) * jerseyGrain * studioShade;
            r = lerp(32 * base, 52 * threadDash * studioShade, seam * 0.75);
            g = lerp(40 * base, 62 * threadDash * studioShade, seam * 0.75);
            b = lerp(60 * base, 88 * threadDash * studioShade, seam * 0.75);
          }
        } else {
          // Male: Two-tone raglan performance training tee (slate-cobalt torso + charcoal raglan shoulder/sleeve panels) + charcoal athletic shorts!
          const collarHalfW = 0.076;
          const frontNeckY = landmarks.clavicleY + 0.044 - 0.058 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
          const backNeckY = landmarks.clavicleY + 0.054 - 0.022 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
          const neckCov = evalCollarCoverage(x, absX, y, collarHalfW, frontNeckY, backNeckY, isFront);
          const sleeveEnd = 0.34;
          const sleeveMask = 1 - smooth(sleeveEnd - 0.010, sleeveEnd + 0.010, armDist) * smooth(0.22, 0.60, wArm);
          const noHands = 1 - smooth(0.1, 0.4, wHand);
          const teeHem = landmarks.waistY - 0.068;
          const topAlpha = neckCov * hemGreater(y, teeHem) * sleeveMask * noHands;

          const shortTop = teeHem + 0.022;
          const shortHem = (landmarks.thighY + landmarks.kneeY) * 0.52;
          const shortAlpha = hemLess(y, shortTop) * hemGreater(y, shortHem) * (1 - smooth(0.2, 0.55, wArm));

          alpha = clamp(Math.max(topAlpha, shortAlpha), 0, 1);
          if (topAlpha >= shortAlpha && y >= teeHem - 0.002) {
            // Raglan diagonal seam running from collar (`|x|=0.072, y=clavicleY+0.03`) to underarm (`|x|=0.165, y=chestY-0.02`)
            const raglanLineY = (landmarks.clavicleY + 0.035) - (absX - 0.070) * 0.82;
            const inRaglanPanel = clamp(Math.max(smooth(raglanLineY - 0.004, raglanLineY + 0.004, y), smooth(0.25, 0.55, wArm)), 0, 1);
            const raglanPiping = bandMask(y, raglanLineY, 0.0038) * (1 - smooth(0.35, 0.65, wArm)) * hemGreater(absX, 0.068);
            const collarRib = evalCollarRimDist(absX, y, collarHalfW, isFront ? frontNeckY : backNeckY, isFront ? landmarks.clavicleY + 0.044 : landmarks.clavicleY + 0.054) < 0.018 ? 1 : 0;

            let tr = lerp(42, 44, inRaglanPanel);
            let tg = lerp(88, 50, inRaglanPanel);
            let tb = lerp(132, 62, inRaglanPanel);
            if (collarRib) {
              tr = 36; tg = 42; tb = 54;
            }
            tr = lerp(tr, 232, raglanPiping * 0.92);
            tg = lerp(tg, 238, raglanPiping * 0.92);
            tb = lerp(tb, 246, raglanPiping * 0.92);
            const shade = piqueWeave * studioShade;
            r = tr * shade; g = tg * shade; b = tb * shade;
          } else {
            // Deep charcoal athletic shorts with crisp ice-white lateral piping & waistband stitch
            const sidePipe = bandMask(absX, 0.156, 0.0075);
            const waistBand = hemGreater(y, shortTop - 0.032);
            const shade = piqueWeave * studioShade * (waistBand > 0.5 ? 0.88 : 1.0);
            r = lerp(38 * shade, 236 * studioShade, sidePipe * 0.92);
            g = lerp(44 * shade, 240 * studioShade, sidePipe * 0.92);
            b = lerp(56 * shade, 248 * studioShade, sidePipe * 0.92);
          }
        }
      } else if (presetId === 'casual-tee-jeans') {
        // Directly matched to `ref-cotton-tshirt.jpg`, `ref-breton-mariniere.jpg` (Female), & `ref-denim-jeans.jpg`!
        const collarHalfW = sex === 'female' ? 0.088 : 0.076; // Boat-neck (`bateau`) on Female Breton tee; classic ribbed crewneck on Male tee!
        const frontNeckY = sex === 'female'
          ? landmarks.clavicleY + 0.044 - 0.038 * Math.max(0, 1 - (absX / collarHalfW) ** 2)
          : landmarks.clavicleY + 0.046 - 0.062 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
        const backNeckY = sex === 'female'
          ? landmarks.clavicleY + 0.048 - 0.024 * Math.max(0, 1 - (absX / collarHalfW) ** 2)
          : landmarks.clavicleY + 0.056 - 0.022 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
        const neckCov = evalCollarCoverage(x, absX, y, collarHalfW, frontNeckY, backNeckY, isFront);

        const sleeveEnd = sex === 'female' ? 0.31 : 0.37;
        const sleeveMask = 1 - smooth(sleeveEnd - 0.010, sleeveEnd + 0.010, armDist) * smooth(0.22, 0.60, wArm);
        const noHands = 1 - smooth(0.1, 0.4, wHand);
        const teeHem = sex === 'female' ? landmarks.waistY - 0.035 : landmarks.waistY - 0.082;
        const teeAlpha = neckCov * hemGreater(y, teeHem) * sleeveMask * noHands;

        const jeansTop = teeHem + 0.024;
        const ankleHem = landmarks.ankleY + 0.042;
        const noFeet = 1 - smooth(0.25, 0.65, wFoot);
        const jeansAlpha = hemLess(y, jeansTop) * hemGreater(y, ankleHem) * noFeet * (1 - smooth(0.2, 0.55, wArm));

        alpha = clamp(Math.max(teeAlpha, jeansAlpha), 0, 1);
        if (teeAlpha >= jeansAlpha && y >= teeHem - 0.002) {
          const collarCornerY = sex === 'female'
            ? (isFront ? landmarks.clavicleY + 0.044 : landmarks.clavicleY + 0.048)
            : (isFront ? landmarks.clavicleY + 0.046 : landmarks.clavicleY + 0.056);
          const rimDist = evalCollarRimDist(absX, y, collarHalfW, isFront ? frontNeckY : backNeckY, collarCornerY);
          const inCollarBand = rimDist < (sex === 'female' ? 0.014 : 0.021) ? 1 : 0;
          const collarCoverstitch = bandMask(rimDist, sex === 'female' ? 0.014 : 0.021, 0.0022);
          const cuffTwinStitch = smooth(0.28, 0.65, wArm) * Math.max(
            bandMask(armDist, sleeveEnd - 0.016, 0.0022),
            bandMask(armDist, sleeveEnd - 0.022, 0.0022),
          );
          const hemTwinStitch = Math.max(
            bandMask(y, teeHem + 0.014, 0.0020),
            bandMask(y, teeHem + 0.020, 0.0020),
          );
          const armscyeSeam = bandMask(armDist, 0.055, 0.0030) * (1 - smooth(0.55, 0.85, wArm));

          if (sex === 'female') {
            // Authentic French Breton Marinière (`ref-breton-mariniere.jpg`):
            // True horizontal `paperY` stripes on torso (so stripes stay 100% horizontal across the 28px waist bleed!) + sleeve-axis stripes on arms!
            const yokeLineY = landmarks.chestY + 0.046;
            const sleeveAxisY = (landmarks.clavicleY + 0.015) - armDist * armLen * 0.92;
            const garmentY = lerp(paperY, sleeveAxisY, smooth(0.22, 0.58, wArm));
            const stripeCoord = (yokeLineY - garmentY) / 0.026; // 13mm ivory / 13mm marine-cobalt rhythm
            const stripeWave = Math.sin(stripeCoord * Math.PI * 2);
            const inBlueStripe = garmentY < yokeLineY && !inCollarBand ? smooth(-0.12, 0.12, stripeWave) : 0;

            let cr = lerp(243, 32, inBlueStripe);
            let cg = lerp(239, 64, inBlueStripe);
            let cb = lerp(230, 118, inBlueStripe);
            const stitch = clamp(Math.max(collarCoverstitch, cuffTwinStitch, hemTwinStitch, armscyeSeam * 0.7), 0, 1);
            const shade = (inCollarBand ? ribKnit2x2 : jerseyGrain) * studioShade * (1 - 0.10 * stitch * threadDash);
            r = cr * shade; g = cg * shade; b = cb * shade;
          } else {
            // Classic Slate-Cobalt Combed-Cotton Crewneck T-Shirt (`ref-cotton-tshirt.jpg`):
            // Distinct 1x1 ribbed crewneck band, armscye & shoulder seam, twin-needle sleeve/hem stitch, subtle torso drape!
            const cottonDrape = 0.022 * Math.sin(x * 64 - y * 32) * (1 - wArm);
            let cr = inCollarBand ? 50 : 58;
            let cg = inCollarBand ? 84 : 96;
            let cb = inCollarBand ? 128 : 144;
            const stitch = clamp(Math.max(collarCoverstitch, cuffTwinStitch, hemTwinStitch, armscyeSeam * 0.85), 0, 1);
            const shade = (inCollarBand ? ribKnit2x2 : jerseyGrain) * (studioShade + cottonDrape) * (1 - 0.13 * stitch * threadDash);
            r = cr * shade; g = cg * shade; b = cb * shade;
          }
        } else {
          // Wrangler-inspired Indigo 3x1 Twill Denim Jeans (`ref-denim-jeans.jpg`):
          // Diagonal twill weave, washed thigh fade + hip whiskers, V-back yoke, 5-point pockets with `W` stitch, amber topstitching & copper rivets!
          const jeanWaistRef = teeHem;
          const thighFade =
            smooth(landmarks.kneeY - 0.05, landmarks.thighY - 0.04, y) *
            Math.exp(-(((absX - 0.092) / 0.046) ** 2)) * 0.28;
          const whisker = isFront
            ? 0.09 * Math.max(0, Math.sin((y - landmarks.pelvisY + 0.055) * 165 + absX * 48)) *
              Math.exp(-(((y - (landmarks.pelvisY - 0.052)) / 0.042) ** 2))
            : 0;
          const denimLum = (74 + 98 * (thighFade + whisker)) * denimTwill * studioShade;
          let dr = denimLum * 0.54;
          let dg = denimLum * 0.74;
          let db = denimLum * 1.14;

          // Authentic golden-amber twin-needle topstitching (`ref-denim-jeans.jpg`)
          const waistSeam = bandMask(y, jeanWaistRef - 0.026, 0.0026);
          const centerRiseSeam = Math.max(bandMask(absX, 0.002, 0.0022), isFront ? bandMask(x, 0.024, 0.0022) * hemGreater(y, landmarks.pelvisY - 0.05) : 0) *
            hemGreater(y, landmarks.thighY - 0.04);
          // Thin twin-needle outseam thread strictly inside the leg silhouette (`mask[idx] === 2`), so the 28px bleed margin bleeds pure indigo denim!
          const outSeam =
            (mask[idx] === 2 ? bandMask(Math.abs(nx), 0.92, 0.028, 0.010) : 0) *
            hemGreater(absX, 0.095) *
            hemLess(y, jeanWaistRef - 0.026);
          // Front curved scoop pocket + right-side coin pocket
          const scoopPocket = isFront
            ? bandMask(Math.hypot(absX - 0.138, (y - (jeanWaistRef - 0.024)) * 1.25), 0.072, 0.0032) * hemLess(y, jeanWaistRef - 0.022)
            : 0;
          const coinPocket = isFront && x > 0.065 && x < 0.122
            ? bandMask(y, jeanWaistRef - 0.046, 0.0024)
            : 0;
          // Back V-angled yoke + 5-point patch pockets + Wrangler `W` decorative stitch!
          const yokeLineY = (jeanWaistRef - 0.062) + absX * 0.18;
          const backYoke = !isFront ? Math.max(bandMask(y, yokeLineY, 0.0026), bandMask(y, yokeLineY + 0.005, 0.0022)) : 0;
          let backPocket = 0;
          if (!isFront && absX >= 0.044 && absX <= 0.126 && y <= landmarks.pelvisY + 0.012 && y >= landmarks.pelvisY - 0.098) {
            const pTop = bandMask(y, landmarks.pelvisY + 0.010, 0.0024);
            const pSides = (bandMask(absX, 0.046, 0.0024) + bandMask(absX, 0.124, 0.0024)) * hemGreater(y, landmarks.pelvisY - 0.068);
            const vPointY = (landmarks.pelvisY - 0.094) + Math.abs(absX - 0.085) * 0.66;
            const pBottom = bandMask(y, vPointY, 0.0026) * hemLess(y, landmarks.pelvisY - 0.064);
            // Wrangler `W` arcuate stitch across middle of pocket
            const wWaveY = (landmarks.pelvisY - 0.036) + 0.012 * Math.cos(((absX - 0.046) / 0.078) * Math.PI * 4);
            const wArcuate = bandMask(y, wWaveY, 0.0024);
            backPocket = Math.max(pTop, pSides, pBottom, wArcuate);
          }
          // Belt loops
          const loopX = Math.min(Math.abs(absX - 0.056), Math.abs(absX - 0.126));
          const beltLoop = loopX < 0.006 && y < jeanWaistRef - 0.002 && y > jeanWaistRef - 0.034 ? 1 : 0;
          if (beltLoop) {
            dr *= 1.08; dg *= 1.08; db *= 1.08;
          }
          // Copper corner rivets at pocket stress points
          const rivetDist = isFront
            ? Math.min(
                Math.hypot(absX - 0.070, y - (jeanWaistRef - 0.032)),
                Math.hypot(absX - 0.132, y - (jeanWaistRef - 0.078)),
              )
            : Math.min(
                Math.hypot(absX - 0.048, y - (landmarks.pelvisY + 0.008)),
                Math.hypot(absX - 0.122, y - (landmarks.pelvisY + 0.008)),
              );
          const copperRivet = hemLess(rivetDist, 0.0042, 0.0012);

          // Selvedge cuffed hem turn-up on Male jeans
          const cuffTurn = sex === 'male' ? hemLess(y, ankleHem + 0.024) : 0;
          if (cuffTurn > 0.1) {
            dr = lerp(dr, 174 * denimTwill * studioShade, cuffTurn * 0.78);
            dg = lerp(dg, 182 * denimTwill * studioShade, cuffTurn * 0.78);
            db = lerp(db, 198 * denimTwill * studioShade, cuffTurn * 0.78);
          }

          const amberStitch = clamp(Math.max(waistSeam, centerRiseSeam, outSeam, scoopPocket, coinPocket, backYoke, backPocket), 0, 1);
          dr = lerp(dr, 218 * threadDash * studioShade, amberStitch * 0.88);
          dg = lerp(dg, 158 * threadDash * studioShade, amberStitch * 0.88);
          db = lerp(db, 68 * threadDash * studioShade, amberStitch * 0.88);

          dr = lerp(dr, 206 * studioShade, copperRivet);
          dg = lerp(dg, 126 * studioShade, copperRivet);
          db = lerp(db, 82 * studioShade, copperRivet);
          r = dr; g = dg; b = db;
        }
      } else if (presetId === 'fitted-bodysuit') {
        // Sculpted Fine 2x2 Rib-Knit Mock-Neck Long-Sleeve Studio Bodysuit (100% continuous over shoulders, tint-friendly!)
        const collarHalfW = 0.068;
        const frontNeckY = landmarks.neckY + 0.012 - 0.016 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
        const backNeckY = landmarks.neckY + 0.018 - 0.008 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
        const neckCov = evalCollarCoverage(x, absX, y, collarHalfW, frontNeckY, backNeckY, isFront);
        const wristCut = 1 - smooth(0.92, 0.99, armDist) * smooth(0.3, 0.8, wHand);
        const ankleCut = hemGreater(y, landmarks.ankleY + 0.032) * (1 - smooth(0.35, 0.75, wFoot));
        alpha = neckCov * wristCut * ankleCut;

        // Articulated princess / ergonomic contour panels + waist corset rib + twin-needle flatlock seams
        const panelWidth = 0.080 + 0.034 * smooth(landmarks.waistY, landmarks.chestY + 0.04, y) - 0.018 * smooth(landmarks.pelvisY, landmarks.kneeY, y);
        const inCorePanel = 1 - smooth(panelWidth - 0.004, panelWidth + 0.004, absX) * (1 - smooth(0.35, 0.75, wArm));
        const inWaistBand = hemLess(y, landmarks.waistY + 0.048) * hemGreater(y, landmarks.waistY - 0.024) * (1 - smooth(0.25, 0.6, wArm));
        const rimDist = evalCollarRimDist(
          absX,
          y,
          collarHalfW,
          isFront ? frontNeckY : backNeckY,
          isFront ? landmarks.neckY + 0.012 : landmarks.neckY + 0.018,
        );
        const inMockCollar = rimDist < 0.024 ? 1 : 0;
        const seamPiping = Math.max(
          bandMask(absX, panelWidth, 0.0030) * (1 - smooth(0.35, 0.75, wArm)),
          bandMask(y, landmarks.waistY + 0.048, 0.0026) * (1 - smooth(0.25, 0.6, wArm)),
          bandMask(y, landmarks.waistY - 0.024, 0.0026) * (1 - smooth(0.25, 0.6, wArm)),
          bandMask(rimDist, 0.024, 0.0025),
        );

        const knit = (inWaistBand > 0.3 || inMockCollar ? ribKnit2x2 : (0.55 * ribKnit2x2 + 0.45 * jerseyGrain)) * studioShade;
        const coreLum = 204 * knit;
        const flankLum = 142 * knit;
        let baseLum = lerp(flankLum, coreLum, inCorePanel);
        if (inWaistBand > 0.2) baseLum *= 0.92;
        r = lerp(baseLum * 0.96, 238 * threadDash * studioShade, seamPiping * 0.82);
        g = lerp(baseLum * 0.99, 242 * threadDash * studioShade, seamPiping * 0.82);
        b = lerp(baseLum * 1.04, 248 * threadDash * studioShade, seamPiping * 0.82);
      } else if (presetId === 'patterned-signature') {
        if (sex === 'female') {
          // Directly matched to `ref-dvf-wrap-dress.jpg` (Diane von Fürstenberg Cobalt & Ivory Botanical Surplice Wrap Dress):
          // Surplice crossover V-neckline with cobalt scalloped/ribbed trim, 100% continuous three-quarter sleeves over shoulders,
          // cobalt botanical scrollwork print on silk-ivory ground, wide cobalt wrap waist sash & tie, pleated knee-length A-line skirt!
          const collarHalfW = 0.076;
          // Asymmetric wrap V-neck in front; clean bound boat-scoop in back; shoulders 100% covered!
          const frontNeckY = landmarks.clavicleY + 0.048 - 0.142 * Math.pow(Math.max(0, 1 - absX / collarHalfW), 1.08);
          const backNeckY = landmarks.clavicleY + 0.052 - 0.036 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
          const neckCov = evalCollarCoverage(x, absX, y, collarHalfW, frontNeckY, backNeckY, isFront);
          const threeQuarterSleeve = 1 - smooth(0.58, 0.61, armDist) * smooth(0.25, 0.65, wArm);
          const noHands = 1 - smooth(0.1, 0.4, wHand);
          // Paper X is mirrored on the back panel; rest-space X is continuous.
          const skirtHem = (landmarks.thighY + landmarks.kneeY) * 0.50 + 0.006 * Math.sin(x * 85);
          alpha = neckCov * hemGreater(y, skirtHem) * threeQuarterSleeve * noHands;

          // Crisp 2048x2048 cobalt botanical scrollwork & leaf flourish motif (`ref-dvf-wrap-dress.jpg`)
          const uPat = paperX * 22.0;
          const vPat = paperY * 22.0;
          const gx = uPat - Math.floor(uPat) - 0.5;
          const gy = vPat - Math.floor(vPat) - 0.5;
          const cellParity = ((Math.floor(uPat) + Math.floor(vPat)) & 1) ? 1 : -1;
          const rad = Math.hypot(gx, gy);
          const ang = Math.atan2(gy, gx) * cellParity;
          // Organic swirling botanical vine + 5-lobed stylized leaf rosette
          const leafRadius = 0.30 + 0.11 * Math.cos(ang * 5 + rad * 4.5);
          const scrollArc1 = bandMask(Math.hypot(gx - 0.24 * cellParity, gy - 0.18), 0.27, 0.036);
          const scrollArc2 = bandMask(Math.hypot(gx + 0.22 * cellParity, gy + 0.20), 0.25, 0.034);
          const leafOutline = bandMask(rad, leafRadius, 0.038);
          const leafVein = (1 - smooth(leafRadius - 0.04, leafRadius, rad)) * bandMask(Math.sin(ang * 5), 0, 0.18, 0.08);
          const printInk = clamp(Math.max(scrollArc1, scrollArc2, leafOutline, leafVein * 0.85), 0, 1);

          // Silk-ivory ground (`#f5f1e8`) + rich DVF cobalt-cerulean botanical ink (`#1d4f9e`)
          let dr = lerp(245, 29, printInk);
          let dg = lerp(241, 79, printInk);
          let db = lerp(232, 158, printInk);

          // Cobalt scalloped/ribbed surplice collar trim (`ref-dvf-wrap-dress.jpg`) + diagonal crossover bodice trim!
          const rimDist = evalCollarRimDist(absX, y, collarHalfW, isFront ? frontNeckY : backNeckY, isFront ? landmarks.clavicleY + 0.048 : landmarks.clavicleY + 0.052);
          const surpliceDiagY = (landmarks.waistY + 0.036) + (x + 0.068) * 1.48;
          const onSurpliceTrim =
            isFront && y > landmarks.waistY + 0.025 && y < frontNeckY + 0.02
              ? bandMask(y, surpliceDiagY, 0.011 + 0.0025 * Math.sin(y * 260))
              : 0;
          const onNeckTrim = rimDist < (0.016 + 0.0025 * Math.sin(paperX * 260)) ? 1 : 0;
          const cuffTrim = smooth(0.3, 0.7, wArm) * bandMask(armDist, 0.57, 0.014);

          // Wide cobalt wrap waist sash (`y around waistY + 0.015`) + draped tie tails on left hip (`x > 0.055`)
          const waistSash = hemLess(y, landmarks.waistY + 0.036) * hemGreater(y, landmarks.waistY - 0.012) * (1 - smooth(0.22, 0.55, wArm));
          const sashTieTail =
            isFront && y < landmarks.waistY - 0.008 && y > landmarks.pelvisY - 0.085
              ? Math.max(
                  bandMask(x, 0.082 + (landmarks.waistY - y) * 0.08, 0.014),
                  bandMask(x, 0.106 + (landmarks.waistY - y) * 0.15, 0.013) * hemGreater(y, landmarks.pelvisY - 0.045),
                )
              : 0;
          const solidCobalt = clamp(Math.max(onNeckTrim, onSurpliceTrim, cuffTrim, waistSash, sashTieTail), 0, 1);
          if (solidCobalt > 0.02) {
            const sashFold = waistSash > 0.2 ? 0.92 + 0.08 * Math.sin((y - landmarks.waistY) * 280) : 1.0;
            dr = lerp(dr, 26 * sashFold, solidCobalt);
            dg = lerp(dg, 72 * sashFold, solidCobalt);
            db = lerp(db, 148 * sashFold, solidCobalt);
          }

          // Soft A-line skirt pleats below the waist sash
          const skirtPleat = y < landmarks.waistY - 0.012 ? 0.048 * Math.sin(paperX * 92) * smooth(landmarks.waistY - 0.02, skirtHem, y) : 0;
          const silkShade = (studioShade + skirtPleat) * jerseyGrain;
          r = dr * silkShade;
          g = dg * silkShade;
          b = db * silkShade;
        } else {
          // Directly matched to `ref-polo-shirt.jpg` (Uniqlo Forest-Green & Midnight-Navy Striped Rugger Polo with Ivory Collar & Placket)
          // + `ref-linen-shirt.jpg` weave Tailored Warm-Ecru Slub-Linen Chinos!
          const collarHalfW = 0.072;
          const frontNeckY = landmarks.clavicleY + 0.052 - 0.044 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
          const backNeckY = landmarks.clavicleY + 0.058 - 0.018 * Math.max(0, 1 - (absX / collarHalfW) ** 2);
          const neckCov = evalCollarCoverage(x, absX, y, collarHalfW, frontNeckY, backNeckY, isFront);

          const sleeveEnd = 0.39;
          const sleeveMask = 1 - smooth(sleeveEnd - 0.010, sleeveEnd + 0.010, armDist) * smooth(0.22, 0.60, wArm);
          const noHands = 1 - smooth(0.1, 0.4, wHand);
          const poloHem = landmarks.waistY - 0.080;
          const poloAlpha = neckCov * hemGreater(y, poloHem) * sleeveMask * noHands;

          const chinoTop = poloHem + 0.026;
          const chinoHem = landmarks.ankleY + 0.044;
          const chinoAlpha = hemLess(y, chinoTop) * hemGreater(y, chinoHem) * (1 - smooth(0.25, 0.65, wFoot)) * (1 - smooth(0.2, 0.55, wArm));

          alpha = clamp(Math.max(poloAlpha, chinoAlpha), 0, 1);
          if (poloAlpha >= chinoAlpha && y >= poloHem - 0.002) {
            // Bold horizontal Rugger stripes (`ref-polo-shirt.jpg`): 4.4cm forest green / 4.4cm midnight navy + crisp coral-crimson pin-stripe!
            const sleeveAxisY = (landmarks.clavicleY + 0.025) - armDist * armLen * 0.90;
            const garmentY = lerp(paperY, sleeveAxisY, smooth(0.24, 0.62, wArm));
            const bandPeriod = 0.088;
            const bandPhase = ((garmentY - poloHem) / bandPeriod) - Math.floor((garmentY - poloHem) / bandPeriod);
            const inNavyBand = smooth(0.48, 0.52, bandPhase) * (1 - smooth(0.96, 1.0, bandPhase));
            const coralPinstripe = Math.max(
              bandMask(bandPhase, 0.50, 0.032, 0.012),
              bandMask(bandPhase, 0.02, 0.028, 0.012),
            );

            // Forest green (`#1d4a3a`) vs Midnight navy (`#1a263c`) + Coral-crimson accent stripe (`#de5c52`)
            let sr = lerp(29, 26, inNavyBand);
            let sg = lerp(74, 38, inNavyBand);
            let sb = lerp(58, 60, inNavyBand);
            sr = lerp(sr, 222, coralPinstripe * 0.92);
            sg = lerp(sg, 92, coralPinstripe * 0.92);
            sb = lerp(sb, 82, coralPinstripe * 0.92);

            // Contrast warm-ivory woven spread collar (`ref-polo-shirt.jpg`) — 100% continuous around neck & trapezius!
            const spreadCollarBottomY = isFront
              ? (landmarks.clavicleY + 0.016) - 0.028 * Math.max(0, 1 - Math.abs(absX - 0.048) / 0.045)
              : landmarks.clavicleY + 0.032;
            const inSpreadCollar =
              absX < 0.104 && y > spreadCollarBottomY
                ? (1 - smooth(0.098, 0.106, absX)) * smooth(spreadCollarBottomY - 0.003, spreadCollarBottomY + 0.003, y)
                : 0;

            // Contrast ivory center-front button placket + box-stitch base + 4-hole mother-of-pearl buttons (`ref-polo-shirt.jpg`)
            const placketBottomY = landmarks.chestY + 0.018;
            const inPlacket = isFront && absX < 0.017 && y >= placketBottomY
              ? (1 - smooth(0.015, 0.018, absX)) * smooth(placketBottomY - 0.003, placketBottomY + 0.003, y)
              : 0;
            const ivoryTrim = clamp(Math.max(inSpreadCollar, inPlacket), 0, 1);
            if (ivoryTrim > 0.02) {
              const collarEdgeShadow = bandMask(y, spreadCollarBottomY, 0.003) * inSpreadCollar;
              const placketBoxStitch = isFront && absX < 0.016 ? bandMask(y, placketBottomY + 0.014, 0.0022) : 0;
              const iv = 240 * (1 - 0.14 * Math.max(collarEdgeShadow, placketBoxStitch));
              sr = lerp(sr, iv, ivoryTrim);
              sg = lerp(sg, iv * 0.98, ivoryTrim);
              sb = lerp(sb, iv * 0.93, ivoryTrim);
            }
            if (isFront && y > placketBottomY + 0.024) {
              const bDist = Math.min(
                Math.hypot(x, y - (placketBottomY + 0.052)),
                Math.hypot(x, y - (placketBottomY + 0.102)),
              );
              const button = hemLess(bDist, 0.0052, 0.0012);
              sr = lerp(sr, 250, button);
              sg = lerp(sg, 248, button);
              sb = lerp(sb, 240, button);
            }

            const shade = (ivoryTrim > 0.5 ? linenSlub : piqueWeave) * studioShade;
            r = sr * shade; g = sg * shade; b = sb * shade;
          } else {
            // Tailored Warm-Ecru Slub-Linen Chinos (`ref-linen-shirt.jpg` cross-slub weave) + cognac leather belt + pressed crease!
            const beltMask = hemLess(y, poloHem) * hemGreater(y, poloHem - 0.030);
            const buckle = isFront && absX < 0.022 && beltMask > 0.5 ? 1 : 0;
            const frontCrease = bandMask(absX, 0.088, 0.0035) * hemLess(y, landmarks.thighY - 0.03);
            const slashPocket = isFront
              ? bandMask(absX - (0.148 - Math.max(0, (poloHem - 0.032) - y) * 0.42), 0, 0.0028) *
                hemLess(y, poloHem - 0.032) * hemGreater(y, landmarks.pelvisY - 0.045)
              : 0;
            const weltBackPocket = !isFront && absX > 0.050 && absX < 0.118
              ? bandMask(y, landmarks.pelvisY + 0.012, 0.0028)
              : 0;

            const slubShade = linenSlub * studioShade * (1 + frontCrease * 0.055) * (1 - 0.10 * Math.max(slashPocket, weltBackPocket));
            let cr = 216 * slubShade;
            let cg = 198 * slubShade;
            let cb = 168 * slubShade;
            if (beltMask > 0.05) {
              const br = buckle ? 212 : 96;
              const bg = buckle ? 182 : 58;
              const bb = buckle ? 112 : 36;
              cr = lerp(cr, br * studioShade, beltMask);
              cg = lerp(cg, bg * studioShade, beltMask);
              cb = lerp(cb, bb * studioShade, beltMask);
            }
            r = cr; g = cg; b = cb;
          }
        }
      }

      if (alpha <= 0.002) continue;
      const o = idx * 4;
      rgba[o] = clamp(Math.round(r), 0, 255);
      rgba[o + 1] = clamp(Math.round(g), 0, 255);
      rgba[o + 2] = clamp(Math.round(b), 0, 255);
      rgba[o + 3] = clamp(Math.round(alpha * 255), 0, 255);
    }
  }

  // Color-bleed RGB outward by 4px around semi-transparent/zero-alpha garment edges so bilinear mipmaps
  // NEVER blend `(0, 0, 0)` dark fringes along collars, straps, waistbands, or hems!
  const bleedDirs = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (let pass = 0; pass < 4; pass++) {
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        const o = (y * SIZE + x) * 4;
        if (rgba[o + 3] > 0) continue;
        let sr = 0, sg = 0, sb = 0, cnt = 0;
        for (const [dx, dy] of bleedDirs) {
          const no = ((y + dy) * SIZE + (x + dx)) * 4;
          if (rgba[no + 3] > 24) {
            sr += rgba[no];
            sg += rgba[no + 1];
            sb += rgba[no + 2];
            cnt++;
          }
        }
        if (cnt > 0) {
          rgba[o] = Math.round(sr / cnt);
          rgba[o + 1] = Math.round(sg / cnt);
          rgba[o + 2] = Math.round(sb / cnt);
          // Keep alpha = 0! Only RGB is pre-filled for fringe-free linear/trilinear filtering.
        }
      }
    }
  }

  return encodeRgbaPng(SIZE, SIZE, rgba);
}

const PRESETS = [
  'studio-briefs',
  'athletic-sportswear',
  'casual-tee-jeans',
  'fitted-bodysuit',
  'patterned-signature',
];

function main() {
  mkdirSync(TEMPLATE_DIR, { recursive: true });
  mkdirSync(MAPS_DIR, { recursive: true });

  for (const [sex, glbName] of [
    ['male', 'Mannequin_Male.glb'],
    ['female', 'Mannequin_Female.glb'],
  ]) {
    const glbPath = join(MANNEQUIN_DIR, glbName);
    const model = readMannequinGlb(glbPath);
    const buf = buildBodyPaperDollBuffer(model);

    const templatePath = join(TEMPLATE_DIR, `mannequin-${sex}-dress-template.png`);
    const templatePng = renderDressTemplatePng(buf, sex);
    writeFileSync(templatePath, templatePng);
    console.log(`Wrote ${templatePath} (${SIZE}x${SIZE}, ${(templatePng.length / 1024).toFixed(1)} KB)`);

    for (const presetId of PRESETS) {
      const mapPath = join(MAPS_DIR, `mannequin-${sex}-${presetId}.png`);
      const mapPng = renderOutfitMapPng(buf, sex, presetId);
      writeFileSync(mapPath, mapPng);
      console.log(`Wrote ${mapPath} (${SIZE}x${SIZE}, ${(mapPng.length / 1024).toFixed(1)} KB)`);
    }
  }
}

main();
