import * as T from 'three';

export const RENDER_QUALITY_TIERS = ['performance', 'balanced', 'ultra'] as const;
export type RenderQualityTier = (typeof RENDER_QUALITY_TIERS)[number];

export interface ShadowQualityConfig {
  readonly directionalMapSize: 1024 | 2048 | 4096;
  readonly spotMapSize: 1024 | 2048 | 4096;
  readonly pointMapSize: 512 | 1024 | 2048;
  readonly pcssBlockerSamples: 8 | 12 | 16;
  readonly pcssFilterSamples: 8 | 16 | 25;
  readonly defaultSoftness: number;
}

export const SHADOW_QUALITY_PRESETS: Record<RenderQualityTier, ShadowQualityConfig> = {
  performance: {
    directionalMapSize: 1024,
    spotMapSize: 1024,
    pointMapSize: 512,
    pcssBlockerSamples: 8,
    pcssFilterSamples: 8,
    defaultSoftness: 1.25,
  },
  balanced: {
    directionalMapSize: 2048,
    spotMapSize: 2048,
    pointMapSize: 1024,
    pcssBlockerSamples: 12,
    pcssFilterSamples: 16,
    defaultSoftness: 2.2,
  },
  ultra: {
    directionalMapSize: 4096,
    spotMapSize: 4096,
    pointMapSize: 2048,
    pcssBlockerSamples: 16,
    pcssFilterSamples: 25,
    defaultSoftness: 2.6,
  },
};

export interface ComputeCasterBoundsOptions {
  /** Explicit objects (e.g. 200m studio floor, grid helper, gizmos) to ignore. */
  readonly excludeObjects?: ReadonlySet<T.Object3D> | readonly T.Object3D[];
  /** Stage layer index (`0` in Studio). Objects not visible on this layer are ignored. */
  readonly stageLayer?: number;
  /** Meshes wider than this horizontal span (meters) are treated as infinite backdrops/floors and skipped. */
  readonly maxHorizontalMeshSpan?: number;
  /** Optional focus center for clamping huge outlier props when `maxFocusRadius` is set. */
  readonly focusPoint?: T.Vector3;
  /** Optional maximum radius (meters) around `focusPoint` when clamping distant outliers. */
  readonly maxFocusRadius?: number;
  /** Minimum half-extent (meters) applied around the computed center so tiny props stay stable. */
  readonly minHalfExtent?: number;
  /** Extra padding (meters) added around skinned bone joint positions to enclose posed limbs safely. */
  readonly skinnedBonePadding?: number;
}

export interface CalibratedShadowBias {
  readonly bias: number;
  readonly normalBias: number;
  readonly worldTexelSize: number;
}

export interface FitDirectionalShadowOptions {
  /** Optional floor Y height so cast shadows onto the ground inside `maxReceiverThrow` stay inside the frustum. */
  readonly receiverFloorY?: number | null;
  /** Max horizontal shadow throw (meters) toward `receiverFloorY` to include in frustum bounds. */
  readonly maxReceiverThrow?: number;
  /** World-space margin (meters) around caster bounds for soft penumbra kernels. */
  readonly paddingMeters?: number;
  /** Minimum half-extent (meters) so frustum never collapses on point-like casters. */
  readonly minHalfExtent?: number;
  /** Maximum half-extent (meters) safety cap. */
  readonly maxHalfExtent?: number;
  /** Quantize frustum bounds in light view space to shadow-texel multiples to eliminate shimmer. */
  readonly snapToTexelGrid?: boolean;
}

export interface DirectionalShadowFitResult {
  readonly widthMeters: number;
  readonly heightMeters: number;
  readonly depthSpanMeters: number;
  readonly worldTexelSize: number;
  readonly texelsPerMeter: number;
  readonly bias: number;
  readonly normalBias: number;
}

export interface FitSpotShadowOptions {
  /** Extra world-space padding (meters) around caster AABB corners. */
  readonly paddingMeters?: number;
  /** Minimum `SpotLightShadow.focus` factor (`(0, 1]`) so ultra-tiny casters don't over-pinch perspective. */
  readonly minFocus?: number;
  /** Minimum shadow camera `near` plane (meters). */
  readonly minNear?: number;
}

export interface SpotShadowFitResult {
  readonly focus: number;
  readonly effectiveFovDeg: number;
  readonly frustumWidthAtCasters: number;
  readonly worldTexelSize: number;
  readonly texelsPerMeter: number;
  readonly near: number;
  readonly far: number;
  readonly bias: number;
  readonly normalBias: number;
}

// Pre-allocated module-level scratch math primitives (zero per-frame GC allocations)
const _meshBox = new T.Box3();
const _boneBox = new T.Box3();
const _clampBox = new T.Box3();
const _vecA = new T.Vector3();
const _vecB = new T.Vector3();
const _vecC = new T.Vector3();
const _lightPos = new T.Vector3();
const _targetPos = new T.Vector3();
const _lightDir = new T.Vector3();
const _casterCenter = new T.Vector3();
const _casterSize = new T.Vector3();
const _frameExtents = new T.Vector2();
const _viewCamera = new T.OrthographicCamera();
const _corners: readonly T.Vector3[] = Array.from({ length: 16 }, () => new T.Vector3());

const DEFAULT_FALLBACK_HALF_EXTENT = 2.0;
const PCSS_MARKER = '/* STUDIO_PCSS_SHADOWS_V1 */';

let _originalShadowMapParsFragment: string | null = null;
let _installedPcssSignature: string | null = null;

function isExcluded(
  node: T.Object3D,
  excludeSet: ReadonlySet<T.Object3D> | null,
  excludeList: readonly T.Object3D[] | null,
): boolean {
  if (excludeSet && excludeSet.has(node)) return true;
  if (excludeList && excludeList.includes(node)) return true;
  return false;
}

/**
 * Computes a tight, conservative world-space AABB around all visible shadow-casting
 * stage objects (`STAGE_LAYER`), automatically skipping infinite ground planes,
 * editor gizmos/helpers (`HELPER_LAYER`), and hidden subtrees.
 *
 * For `SkinnedMesh` figures (whose `geometry.boundingBox` stays in bind pose on CPU),
 * expands conservatively by live world bone transforms so posed arms/legs are never clipped
 * without iterating 30k+ vertices on CPU.
 */
export function computeSceneCasterBounds(
  root: T.Object3D | readonly T.Object3D[],
  options: ComputeCasterBoundsOptions = {},
  outBox: T.Box3 = new T.Box3(),
): T.Box3 {
  outBox.makeEmpty();

  const stageLayer = options.stageLayer ?? 0;
  const stageMask = 1 << stageLayer;
  const maxHorizontalSpan = options.maxHorizontalMeshSpan ?? 60;
  const minHalfExtent = Math.max(0.15, options.minHalfExtent ?? 0.85);
  const bonePad = Math.max(0.05, options.skinnedBonePadding ?? 0.2);

  const excludeSet =
    options.excludeObjects instanceof Set
      ? (options.excludeObjects as ReadonlySet<T.Object3D>)
      : null;
  const excludeList = Array.isArray(options.excludeObjects) ? options.excludeObjects : null;

  const roots = Array.isArray(root) ? root : [root];
  let foundAnyCaster = false;

  const visit = (node: T.Object3D): void => {
    if (!node.visible) return;
    if (isExcluded(node, excludeSet, excludeList)) return;
    if (node.userData?.ignoreShadowBounds === true) return;

    const mesh = node as T.Mesh;
    if (mesh.isMesh && mesh.castShadow && (mesh.layers.mask & stageMask) !== 0) {
      const geom = mesh.geometry;
      const skinned = mesh as T.SkinnedMesh;

      if (skinned.isSkinnedMesh && skinned.skeleton && skinned.skeleton.bones.length > 0) {
        _boneBox.makeEmpty();
        const bones = skinned.skeleton.bones;
        for (let i = 0; i < bones.length; i++) {
          const bone = bones[i];
          _vecA.setFromMatrixPosition(bone.matrixWorld);
          _boneBox.expandByPoint(_vecA);
        }
        if (!_boneBox.isEmpty()) {
          _boneBox.expandByScalar(bonePad);
          outBox.union(_boneBox);
          foundAnyCaster = true;
        }
      } else if (geom) {
        if (!geom.boundingBox) {
          geom.computeBoundingBox();
        }
        if (geom.boundingBox && !geom.boundingBox.isEmpty()) {
          _meshBox.copy(geom.boundingBox).applyMatrix4(mesh.matrixWorld);
          const spanX = _meshBox.max.x - _meshBox.min.x;
          const spanZ = _meshBox.max.z - _meshBox.min.z;
          if (spanX <= maxHorizontalSpan && spanZ <= maxHorizontalSpan) {
            outBox.union(_meshBox);
            foundAnyCaster = true;
          }
        }
      }
    }

    const children = node.children;
    for (let i = 0; i < children.length; i++) {
      visit(children[i]);
    }
  };

  for (let i = 0; i < roots.length; i++) {
    roots[i].updateMatrixWorld(false);
    visit(roots[i]);
  }

  if (!foundAnyCaster || outBox.isEmpty()) {
    const center = options.focusPoint ?? _vecC.set(0, 0.9, 0);
    outBox.min.set(
      center.x - DEFAULT_FALLBACK_HALF_EXTENT,
      Math.max(0, center.y - 0.9),
      center.z - DEFAULT_FALLBACK_HALF_EXTENT,
    );
    outBox.max.set(
      center.x + DEFAULT_FALLBACK_HALF_EXTENT,
      center.y + DEFAULT_FALLBACK_HALF_EXTENT,
      center.z + DEFAULT_FALLBACK_HALF_EXTENT,
    );
    return outBox;
  }

  if (options.focusPoint && options.maxFocusRadius && options.maxFocusRadius > 0) {
    const r = options.maxFocusRadius;
    _clampBox.min.set(options.focusPoint.x - r, options.focusPoint.y - r, options.focusPoint.z - r);
    _clampBox.max.set(options.focusPoint.x + r, options.focusPoint.y + r, options.focusPoint.z + r);
    if (outBox.intersectsBox(_clampBox)) {
      outBox.intersect(_clampBox);
    }
  }

  outBox.getCenter(_casterCenter);
  outBox.getSize(_casterSize);
  const minSpan = minHalfExtent * 2;
  if (_casterSize.x < minSpan) {
    outBox.min.x = _casterCenter.x - minHalfExtent;
    outBox.max.x = _casterCenter.x + minHalfExtent;
  }
  if (_casterSize.y < minSpan * 0.5) {
    outBox.min.y = _casterCenter.y - minHalfExtent * 0.5;
    outBox.max.y = _casterCenter.y + minHalfExtent * 0.5;
  }
  if (_casterSize.z < minSpan) {
    outBox.min.z = _casterCenter.z - minHalfExtent;
    outBox.max.z = _casterCenter.z + minHalfExtent;
  }

  return outBox;
}

/**
 * Computes texel-size-proportional `normalBias` and minimal negative depth `bias`
 * so curved character skin is free of grazing-angle shadow acne while planted feet
 * exhibit zero peter-panning.
 */
export function computeCalibratedShadowBias(
  worldTexelSize: number,
  lightKind: 'directional' | 'spot' | 'point',
): CalibratedShadowBias {
  const safeTexel = Math.max(0.00025, Number.isFinite(worldTexelSize) ? worldTexelSize : 0.005);

  if (lightKind === 'directional') {
    return {
      worldTexelSize: safeTexel,
      normalBias: T.MathUtils.clamp(safeTexel * 1.35, 0.0014, 0.032),
      bias: -T.MathUtils.clamp(safeTexel * 0.075, 0.00004, 0.00038),
    };
  }
  if (lightKind === 'spot') {
    return {
      worldTexelSize: safeTexel,
      normalBias: T.MathUtils.clamp(safeTexel * 1.55, 0.0016, 0.038),
      bias: -T.MathUtils.clamp(safeTexel * 0.055, 0.00003, 0.00032),
    };
  }
  return {
    worldTexelSize: safeTexel,
    normalBias: T.MathUtils.clamp(safeTexel * 1.8, 0.003, 0.045),
    bias: -T.MathUtils.clamp(safeTexel * 0.11, 0.00008, 0.00055),
  };
}

/**
 * Applies quality-tier `mapSize` and softness (`shadow.radius`) to a shadow-casting light,
 * safely disposing and resetting `light.shadow.map` when dimensions change so Three.js's
 * `WebGLShadowMap` reallocates the underlying `WebGLRenderTarget` instead of clipping.
 */
export function applyLightShadowQuality(
  light: T.DirectionalLight | T.SpotLight | T.PointLight,
  tier: RenderQualityTier,
  softness?: number,
): number {
  const preset = SHADOW_QUALITY_PRESETS[tier];
  const targetSize = (light as T.DirectionalLight).isDirectionalLight
    ? preset.directionalMapSize
    : (light as T.SpotLight).isSpotLight
      ? preset.spotMapSize
      : preset.pointMapSize;

  const shadow = light.shadow;
  const sizeChanged = shadow.mapSize.x !== targetSize || shadow.mapSize.y !== targetSize;
  shadow.mapSize.set(targetSize, targetSize);

  if (shadow.map) {
    // Account for PointLightShadow's (4, 2) cube-atlas frame extents vs (1, 1) for 2D maps
    const shadowWithExtents = shadow as unknown as {
      getFrameExtents?: () => T.Vector2;
    };
    if (typeof shadowWithExtents.getFrameExtents === 'function') {
      _frameExtents.copy(shadowWithExtents.getFrameExtents());
    } else {
      _frameExtents.set((light as T.PointLight).isPointLight ? 4 : 1, (light as T.PointLight).isPointLight ? 2 : 1);
    }
    const expectedWidth = targetSize * _frameExtents.x;
    const expectedHeight = targetSize * _frameExtents.y;
    if (sizeChanged || shadow.map.width !== expectedWidth || shadow.map.height !== expectedHeight) {
      shadow.map.dispose();
      shadow.map = null;
    }
  }

  shadow.radius = Math.max(0.25, softness ?? preset.defaultSoftness);
  shadow.needsUpdate = true;
  return targetSize;
}

function writeBoxCorners(box: T.Box3, offset = 0): void {
  const { min, max } = box;
  _corners[offset + 0].set(min.x, min.y, min.z);
  _corners[offset + 1].set(min.x, min.y, max.z);
  _corners[offset + 2].set(min.x, max.y, min.z);
  _corners[offset + 3].set(min.x, max.y, max.z);
  _corners[offset + 4].set(max.x, min.y, min.z);
  _corners[offset + 5].set(max.x, min.y, max.z);
  _corners[offset + 6].set(max.x, max.y, min.z);
  _corners[offset + 7].set(max.x, max.y, max.z);
}

/**
 * Tightly fits a `DirectionalLight`'s orthographic shadow frustum (`left, right, top, bottom, near, far`)
 * to `casterBounds` (plus bounded downstream shadow projection onto `receiverFloorY`) in the exact
 * `shadow.camera` view space used by Three.js `LightShadow.updateMatrices`, without moving the user's
 * light gizmo position or target.
 *
 * Quantizes frustum bounds to exact shadow-texel increments so shadows remain 100% shimmer-free
 * and completely invariant to viewport camera orbit.
 */
export function fitDirectionalShadowFrustum(
  light: T.DirectionalLight,
  casterBounds: T.Box3,
  options: FitDirectionalShadowOptions = {},
): DirectionalShadowFitResult {
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);

  _lightPos.setFromMatrixPosition(light.matrixWorld);
  _targetPos.setFromMatrixPosition(light.target.matrixWorld);
  _lightDir.subVectors(_targetPos, _lightPos);
  if (_lightDir.lengthSq() < 1e-8) {
    _lightDir.set(-0.4, -1, -0.4).normalize();
    _targetPos.addVectors(_lightPos, _lightDir);
  } else {
    _lightDir.normalize();
  }

  // Match Three.js LightShadow.updateMatrices camera orientation exactly
  const shadowCam = light.shadow.camera;
  _viewCamera.up.copy(shadowCam.up);
  _viewCamera.position.copy(_lightPos);
  _viewCamera.lookAt(_targetPos);
  _viewCamera.updateMatrixWorld(true);

  writeBoxCorners(casterBounds, 0);
  let pointCount = 8;

  const receiverFloorY = options.receiverFloorY === undefined ? 0 : options.receiverFloorY;
  const maxThrow = Math.max(0, options.maxReceiverThrow ?? 6.5);
  if (receiverFloorY !== null && _lightDir.y < -0.08 && maxThrow > 0) {
    for (let i = 0; i < 8; i++) {
      const src = _corners[i];
      const dy = receiverFloorY - src.y;
      if (dy < 0) {
        const t = Math.min(dy / _lightDir.y, maxThrow);
        _corners[8 + (pointCount - 8)].copy(src).addScaledVector(_lightDir, t);
        pointCount++;
      }
    }
  }

  let minVx = Infinity;
  let maxVx = -Infinity;
  let minVy = Infinity;
  let maxVy = -Infinity;
  let minDepth = Infinity;
  let maxDepth = -Infinity;

  const viewInv = _viewCamera.matrixWorldInverse;
  for (let i = 0; i < pointCount; i++) {
    _vecA.copy(_corners[i]).applyMatrix4(viewInv);
    if (_vecA.x < minVx) minVx = _vecA.x;
    if (_vecA.x > maxVx) maxVx = _vecA.x;
    if (_vecA.y < minVy) minVy = _vecA.y;
    if (_vecA.y > maxVy) maxVy = _vecA.y;
    const depth = -_vecA.z;
    if (depth < minDepth) minDepth = depth;
    if (depth > maxDepth) maxDepth = depth;
  }

  // Ensure the 8 primary caster corners alone dictate tight X/Y cross-section,
  // while receiver throw extends along light ray (in light view space ray is along -Z, so X/Y are identical!).
  const pad = Math.max(0.05, options.paddingMeters ?? 0.3);
  const minHalf = Math.max(0.25, options.minHalfExtent ?? 1.0);
  const maxHalf = Math.max(minHalf, options.maxHalfExtent ?? 28.0);

  let cx = 0.5 * (minVx + maxVx);
  let cy = 0.5 * (minVy + maxVy);
  let halfW = T.MathUtils.clamp(0.5 * (maxVx - minVx) + pad, minHalf, maxHalf);
  let halfH = T.MathUtils.clamp(0.5 * (maxVy - minVy) + pad, minHalf, maxHalf);

  // Use a uniform square span in light space so texel aspect ratio stays 1:1 for isotropic PCSS kernels
  const halfSpan = Math.max(halfW, halfH);
  halfW = halfSpan;
  halfH = halfSpan;

  const mapRes = Math.max(256, light.shadow.mapSize.x || 2048);
  const snap = options.snapToTexelGrid !== false;
  let worldTexelSize = (2 * halfSpan) / mapRes;

  if (snap && worldTexelSize > 1e-6) {
    // Quantize halfSpan to a discrete step (0.125 m) so minor breathing/posing doesn't rescale texels
    const quantizedHalfSpan = Math.ceil(halfSpan * 8) / 8;
    halfW = quantizedHalfSpan;
    halfH = quantizedHalfSpan;
    worldTexelSize = (2 * quantizedHalfSpan) / mapRes;
    cx = Math.round(cx / worldTexelSize) * worldTexelSize;
    cy = Math.round(cy / worldTexelSize) * worldTexelSize;
  }

  shadowCam.left = cx - halfW;
  shadowCam.right = cx + halfW;
  shadowCam.bottom = cy - halfH;
  shadowCam.top = cy + halfH;
  // OrthographicCamera supports negative `near` when casters sit slightly behind the user's light icon
  shadowCam.near = minDepth - Math.max(1.5, pad * 3);
  shadowCam.far = Math.max(shadowCam.near + 1.0, maxDepth + Math.max(2.0, pad * 4));
  shadowCam.updateProjectionMatrix();

  const calibrated = computeCalibratedShadowBias(worldTexelSize, 'directional');
  light.shadow.bias = calibrated.bias;
  light.shadow.normalBias = calibrated.normalBias;
  light.shadow.needsUpdate = true;

  const widthMeters = shadowCam.right - shadowCam.left;
  const heightMeters = shadowCam.top - shadowCam.bottom;
  return {
    widthMeters,
    heightMeters,
    depthSpanMeters: shadowCam.far - shadowCam.near,
    worldTexelSize,
    texelsPerMeter: mapRes / widthMeters,
    bias: calibrated.bias,
    normalBias: calibrated.normalBias,
  };
}

/**
 * Tightly focuses a `SpotLight`'s perspective shadow cone (`SpotLightShadow.focus` and `near`)
 * onto `casterBounds` without narrowing the spotlight's actual visual illumination cone (`light.angle`).
 *
 * Because all cast-shadow rays originate at `light.position` and pass through `casterBounds`,
 * any downstream shadow on floors or walls subtends the exact same angle from `light.position`!
 */
export function fitSpotShadowFrustum(
  light: T.SpotLight,
  casterBounds: T.Box3,
  options: FitSpotShadowOptions = {},
): SpotShadowFitResult {
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);

  _lightPos.setFromMatrixPosition(light.matrixWorld);
  _targetPos.setFromMatrixPosition(light.target.matrixWorld);
  _lightDir.subVectors(_targetPos, _lightPos);
  if (_lightDir.lengthSq() < 1e-8) {
    _lightDir.set(0, -1, 0);
    _targetPos.addVectors(_lightPos, _lightDir);
  } else {
    _lightDir.normalize();
  }

  const shadowCam = light.shadow.camera;
  _viewCamera.up.copy(shadowCam.up);
  _viewCamera.position.copy(_lightPos);
  _viewCamera.lookAt(_targetPos);
  _viewCamera.updateMatrixWorld(true);

  const pad = Math.max(0.05, options.paddingMeters ?? 0.22);
  const minFocus = T.MathUtils.clamp(options.minFocus ?? 0.12, 0.05, 1.0);
  const minNear = Math.max(0.08, options.minNear ?? 0.15);

  writeBoxCorners(casterBounds, 0);
  const viewInv = _viewCamera.matrixWorldInverse;

  let minDepth = Infinity;
  let maxDepth = -Infinity;
  let maxTan = 0;
  let straddlesOrigin = false;

  for (let i = 0; i < 8; i++) {
    _vecA.copy(_corners[i]).applyMatrix4(viewInv);
    const depth = -_vecA.z;
    if (depth - pad <= minNear) {
      straddlesOrigin = true;
    }
    if (depth < minDepth) minDepth = depth;
    if (depth > maxDepth) maxDepth = depth;
    const safeZ = Math.max(minNear, depth - pad * 0.5);
    const tanX = (Math.abs(_vecA.x) + pad) / safeZ;
    const tanY = (Math.abs(_vecA.y) + pad) / safeZ;
    if (tanX > maxTan) maxTan = tanX;
    if (tanY > maxTan) maxTan = tanY;
  }

  const lightHalfAngle = T.MathUtils.clamp(light.angle, 0.05, Math.PI * 0.48);
  let focus = 1.0;
  if (!straddlesOrigin && maxTan > 0) {
    // 6% angular margin for soft PCSS penumbra taps at the outer caster silhouette
    const requiredHalfFov = Math.atan(maxTan) * 1.06;
    // Quantize focus to 1/64th increments to prevent perspective projection swimming
    const rawFocus = T.MathUtils.clamp(requiredHalfFov / lightHalfAngle, minFocus, 1.0);
    focus = Math.min(1.0, Math.ceil(rawFocus * 64) / 64);
  }

  light.shadow.focus = focus;

  const tightenedNear = straddlesOrigin
    ? minNear
    : Math.max(minNear, Math.min(minDepth - pad, minDepth * 0.78));
  shadowCam.near = tightenedNear;
  const effectiveFar = light.distance > 0 ? light.distance : Math.max(tightenedNear + 10, maxDepth + 12);
  shadowCam.far = Math.max(tightenedNear + 1.0, effectiveFar);

  const effectiveHalfFov = lightHalfAngle * focus;
  shadowCam.fov = T.MathUtils.radToDeg(2 * effectiveHalfFov);
  shadowCam.aspect = 1;
  shadowCam.updateProjectionMatrix();

  casterBounds.getCenter(_casterCenter);
  const centerDist = Math.max(tightenedNear, _lightPos.distanceTo(_casterCenter));
  const frustumWidthAtCasters = Math.max(0.25, 2 * centerDist * Math.tan(effectiveHalfFov));
  const mapRes = Math.max(256, light.shadow.mapSize.x || 2048);
  const worldTexelSize = frustumWidthAtCasters / mapRes;

  const calibrated = computeCalibratedShadowBias(worldTexelSize, 'spot');
  light.shadow.bias = calibrated.bias;
  light.shadow.normalBias = calibrated.normalBias;
  light.shadow.needsUpdate = true;

  return {
    focus,
    effectiveFovDeg: shadowCam.fov,
    frustumWidthAtCasters,
    worldTexelSize,
    texelsPerMeter: mapRes / frustumWidthAtCasters,
    near: shadowCam.near,
    far: shadowCam.far,
    bias: calibrated.bias,
    normalBias: calibrated.normalBias,
  };
}

/**
 * Builds the upgraded `shadowmap_pars_fragment` GLSL chunk replacing Three.js `0.181.0`'s
 * fixed 3x3 `PCFSoftShadowMap` (which ignores `shadowRadius` and has zero variable penumbra)
 * with Blocker-Search PCSS + Interleaved Gradient Noise (IGN) Rotated Vogel-Spiral Poisson Filtering.
 */
export function buildPcssShadowMapParsFragment(
  baseChunk: string,
  blockerSamples: number = 12,
  filterSamples: number = 16,
): string {
  if (baseChunk.includes(PCSS_MARKER)) {
    return baseChunk;
  }

  const safeBlockerSamples = Math.max(4, Math.min(24, Math.round(blockerSamples)));
  const safeFilterSamples = Math.max(8, Math.min(32, Math.round(filterSamples)));

  const pcssHelpersGlsl = `
	${PCSS_MARKER}
	#define STUDIO_PCSS_BLOCKER_SAMPLES ${safeBlockerSamples}
	#define STUDIO_PCSS_FILTER_SAMPLES ${safeFilterSamples}

	float studioIgnNoise( vec2 screenPos ) {
		return fract( 52.9829189 * fract( dot( screenPos, vec2( 0.06711056, 0.00583715 ) ) ) );
	}

	vec2 studioVogelDiskSample( int sampleIndex, int samplesCount, float phi ) {
		float goldenAngle = 2.39996323;
		float r = sqrt( ( float( sampleIndex ) + 0.5 ) / float( samplesCount ) );
		float theta = float( sampleIndex ) * goldenAngle + phi;
		return vec2( cos( theta ), sin( theta ) ) * r;
	}

	float studioFindBlockerDepth( sampler2D shadowMap, vec2 uv, float zReceiver, vec2 searchRadiusUv, float phi ) {
		float blockerDepthSum = 0.0;
		float numBlockers = 0.0;
		for ( int i = 0; i < STUDIO_PCSS_BLOCKER_SAMPLES; i ++ ) {
			vec2 sampleUv = clamp(
				uv + studioVogelDiskSample( i, STUDIO_PCSS_BLOCKER_SAMPLES, phi ) * searchRadiusUv,
				vec2( 0.0005 ),
				vec2( 0.9995 )
			);
			float shadowMapDepth = unpackRGBAToDepth( texture2D( shadowMap, sampleUv ) );
			#ifdef USE_REVERSED_DEPTH_BUFFER
				if ( shadowMapDepth > zReceiver ) {
					blockerDepthSum += shadowMapDepth;
					numBlockers += 1.0;
				}
			#else
				if ( shadowMapDepth < zReceiver ) {
					blockerDepthSum += shadowMapDepth;
					numBlockers += 1.0;
				}
			#endif
		}
		if ( numBlockers < 0.5 ) {
			return -1.0;
		}
		return blockerDepthSum / numBlockers;
	}

	float studioPcssShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowRadius, vec3 shadowCoord ) {
		vec2 texelSize = vec2( 1.0 ) / shadowMapSize;
		float phi = studioIgnNoise( gl_FragCoord.xy ) * 6.28318530718;

		// Graphic / NPR crisp mode when shadowRadius <= 1.05: tight anti-aliased rotated disk with zero stair-stepping
		if ( shadowRadius <= 1.05 ) {
			vec2 crispRadius = texelSize * max( 0.55, shadowRadius * 0.85 );
			float crispSum = 0.0;
			for ( int i = 0; i < 8; i ++ ) {
				vec2 sampleUv = clamp(
					shadowCoord.xy + studioVogelDiskSample( i, 8, phi ) * crispRadius,
					vec2( 0.0005 ),
					vec2( 0.9995 )
				);
				crispSum += texture2DCompare( shadowMap, sampleUv, shadowCoord.z );
			}
			return crispSum * ( 1.0 / 8.0 );
		}

		vec2 searchRadiusUv = texelSize * clamp( shadowRadius * 3.6, 1.5, 16.0 );
		float avgBlockerDepth = studioFindBlockerDepth( shadowMap, shadowCoord.xy, shadowCoord.z, searchRadiusUv, phi );
		if ( avgBlockerDepth < 0.0 ) {
			return 1.0;
		}

		#ifdef USE_REVERSED_DEPTH_BUFFER
			float penumbraRatio = clamp( ( avgBlockerDepth - shadowCoord.z ) / max( 1.0 - avgBlockerDepth, 0.001 ), 0.0, 1.0 );
		#else
			float penumbraRatio = clamp( ( shadowCoord.z - avgBlockerDepth ) / max( avgBlockerDepth, 0.001 ), 0.0, 1.0 );
		#endif

		float minContactTexels = 0.65;
		float maxPenumbraTexels = clamp( shadowRadius * 5.2, minContactTexels, 18.0 );
		float filterTexels = mix( minContactTexels, maxPenumbraTexels, smoothstep( 0.0, 0.32, penumbraRatio ) );
		vec2 filterRadiusUv = texelSize * filterTexels;

		float visibilitySum = 0.0;
		float filterPhi = phi + 1.04719755;
		for ( int i = 0; i < STUDIO_PCSS_FILTER_SAMPLES; i ++ ) {
			vec2 sampleUv = clamp(
				shadowCoord.xy + studioVogelDiskSample( i, STUDIO_PCSS_FILTER_SAMPLES, filterPhi ) * filterRadiusUv,
				vec2( 0.0005 ),
				vec2( 0.9995 )
			);
			visibilitySum += texture2DCompare( shadowMap, sampleUv, shadowCoord.z );
		}
		return visibilitySum * ( 1.0 / float( STUDIO_PCSS_FILTER_SAMPLES ) );
	}
`;

  const targetGetShadowStart = 'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {';
  const targetCubeFnStart = 'vec2 cubeToUV( vec3 v, float texelSizeY ) {';

  const startIdx = baseChunk.indexOf(targetGetShadowStart);
  const endIdx = baseChunk.indexOf(targetCubeFnStart);

  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // Graceful fallback if Three.js chunk layout differs
    return `${PCSS_MARKER}\n${baseChunk}`;
  }

  const replacementGetShadow = `${pcssHelpersGlsl}
	float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {

		float shadow = 1.0;

		shadowCoord.xyz /= shadowCoord.w;
		shadowCoord.z += shadowBias;

		bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
		bool frustumTest = inFrustum && shadowCoord.z <= 1.0;

		if ( frustumTest ) {

		#if defined( SHADOWMAP_TYPE_PCF ) || defined( SHADOWMAP_TYPE_PCF_SOFT )

			shadow = studioPcssShadow( shadowMap, shadowMapSize, shadowRadius, shadowCoord.xyz );

		#elif defined( SHADOWMAP_TYPE_VSM )

			shadow = VSMShadow( shadowMap, shadowCoord.xy, shadowCoord.z );

		#else

			shadow = texture2DCompare( shadowMap, shadowCoord.xy, shadowCoord.z );

		#endif

		}

		return mix( 1.0, shadow, shadowIntensity );

	}

	`;

  return baseChunk.slice(0, startIdx) + replacementGetShadow + baseChunk.slice(endIdx);
}

/**
 * Installs PCSS (Percentage-Closer Soft Shadows) + Interleaved Gradient Noise Vogel-disk
 * filtering into `THREE.ShaderChunk.shadowmap_pars_fragment`.
 *
 * Safe and idempotent across WebGL2 and headless/jsdom unit-test environments.
 */
export function installPcssSoftShadows(tier: RenderQualityTier = 'balanced'): boolean {
  const preset = SHADOW_QUALITY_PRESETS[tier];
  const signature = `${preset.pcssBlockerSamples}:${preset.pcssFilterSamples}`;

  if (_installedPcssSignature === signature && T.ShaderChunk.shadowmap_pars_fragment.includes(PCSS_MARKER)) {
    return false;
  }

  if (_originalShadowMapParsFragment === null) {
    _originalShadowMapParsFragment = T.ShaderChunk.shadowmap_pars_fragment;
  }

  T.ShaderChunk.shadowmap_pars_fragment = buildPcssShadowMapParsFragment(
    _originalShadowMapParsFragment,
    preset.pcssBlockerSamples,
    preset.pcssFilterSamples,
  );
  _installedPcssSignature = signature;
  return true;
}

/**
 * Restores Three.js's stock `shadowmap_pars_fragment` shader chunk.
 */
export function uninstallPcssSoftShadows(): void {
  if (_originalShadowMapParsFragment !== null) {
    T.ShaderChunk.shadowmap_pars_fragment = _originalShadowMapParsFragment;
  }
  _installedPcssSignature = null;
}

export function isPcssSoftShadowsInstalled(): boolean {
  return T.ShaderChunk.shadowmap_pars_fragment.includes(PCSS_MARKER);
}

export interface ShadowRendererLike {
  shadowMap: {
    enabled: boolean;
    autoUpdate: boolean;
    needsUpdate: boolean;
  };
}

/**
 * Dirty-flag shadow map cache controller.
 *
 * Keeps `renderer.shadowMap.autoUpdate = false` and triggers `renderer.shadowMap.needsUpdate = true`
 * (plus per-light `light.shadow.needsUpdate = true`) strictly when scene casters, poses, lights,
 * booleans, or room cutaways change — eliminating `60–144 Hz` shadow passes on idle frames
 * AND during pure viewport camera orbit/pan/zoom.
 */
export class ShadowCacheController {
  private dirty = true;
  private dirtyReasons = new Set<string>(['initial']);
  private lastSignature = '';
  private renderedShadowPasses = 0;
  private skippedShadowFrames = 0;

  markDirty(reason = 'mutation'): void {
    this.dirty = true;
    this.dirtyReasons.add(reason);
  }

  /**
   * Compares a compact scene/light/pose/cutaway state signature against the last rendered
   * shadow state and marks the shadow cache dirty only if it changed.
   */
  syncStateSignature(signature: string, reason = 'state-signature'): boolean {
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.markDirty(reason);
      return true;
    }
    return false;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  getDirtyReasons(): readonly string[] {
    return Array.from(this.dirtyReasons);
  }

  getStats(): { readonly renderedShadowPasses: number; readonly skippedShadowFrames: number } {
    return {
      renderedShadowPasses: this.renderedShadowPasses,
      skippedShadowFrames: this.skippedShadowFrames,
    };
  }

  resetStats(): void {
    this.renderedShadowPasses = 0;
    this.skippedShadowFrames = 0;
  }

  /**
   * Configures `renderer.shadowMap` and active shadow-casting lights immediately prior to `renderer.render(...)`.
   * Returns `true` when shadow maps will be updated on this frame, or `false` when cached shadow maps are reused.
   */
  beginFrame(
    renderer: ShadowRendererLike,
    shadowLights?: readonly T.Light[],
  ): boolean {
    renderer.shadowMap.autoUpdate = false;

    if (!renderer.shadowMap.enabled) {
      this.skippedShadowFrames++;
      return false;
    }

    if (!this.dirty) {
      renderer.shadowMap.needsUpdate = false;
      if (shadowLights) {
        for (let i = 0; i < shadowLights.length; i++) {
          const light = shadowLights[i];
          if (light.shadow) {
            light.shadow.autoUpdate = false;
            light.shadow.needsUpdate = false;
          }
        }
      }
      this.skippedShadowFrames++;
      return false;
    }

    renderer.shadowMap.needsUpdate = true;
    if (shadowLights) {
      for (let i = 0; i < shadowLights.length; i++) {
        const light = shadowLights[i];
        if (light.castShadow && light.visible && light.shadow) {
          light.shadow.autoUpdate = false;
          light.shadow.needsUpdate = true;
        }
      }
    }

    this.dirty = false;
    this.dirtyReasons.clear();
    this.renderedShadowPasses++;
    return true;
  }
}
