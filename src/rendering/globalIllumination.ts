import * as T from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import type { RenderModeId } from '../model';
import type { RenderQualityTier } from './shadowSystem';

export interface GiQualityConfig {
  readonly maxVplCount: number;
  readonly raysPerLight: number;
  readonly skyBounceRays: number;
  readonly enableAoPass: boolean;
  readonly aoResolutionScale: number;
  readonly aoSamples: number;
  readonly aoDenoiseSamples: number;
}

export const GI_QUALITY_PRESETS: Record<RenderQualityTier, GiQualityConfig> = {
  performance: {
    maxVplCount: 4,
    raysPerLight: 5,
    skyBounceRays: 0,
    enableAoPass: false,
    aoResolutionScale: 0.5,
    aoSamples: 8,
    aoDenoiseSamples: 8,
  },
  balanced: {
    maxVplCount: 8,
    raysPerLight: 7,
    skyBounceRays: 4,
    enableAoPass: true,
    aoResolutionScale: 0.5,
    aoSamples: 14,
    aoDenoiseSamples: 12,
  },
  ultra: {
    maxVplCount: 12,
    raysPerLight: 11,
    skyBounceRays: 6,
    enableAoPass: true,
    aoResolutionScale: 1.0,
    aoSamples: 20,
    aoDenoiseSamples: 16,
  },
};

export interface RealtimeGiOptions {
  readonly quality?: RenderQualityTier;
  readonly giIntensity?: number;
  readonly enabled?: boolean;
  /** Offset (meters) along surface hit normal so VPL `PointLight` sits cleanly off bounce geometry. */
  readonly normalOffset?: number;
  /** Temporal damping factor `(0, 1]` per update (`1` = immediate snap, `0.35` = smooth studio glide). */
  readonly smoothing?: number;
  /** Stage render layer (`0` in Studio). */
  readonly stageLayer?: number;
  /** Optional subtle sky-to-floor bounce strength when `sceneLightsOnly === false`. */
  readonly studioSkyBounceIntensity?: number;
  readonly studioSkyColor?: T.ColorRepresentation;
}

export interface RealtimeGiUpdateInput {
  /** Active scene lights (`SpotLight`, `DirectionalLight`, `PointLight`). */
  readonly lights: readonly T.Light[];
  /** Scene meshes/groups that reflect indirect bounce light (walls, floors, furniture, props, figures). */
  readonly bounceTargets: readonly T.Object3D[];
  /**
   * Strict studio lighting contract:
   * When `true`, ONLY visible scene lights with `intensity > 0` emit bounce energy;
   * when zero scene lights are active, all GI bounce emitters & indirect hemisphere equal exact `0`.
   */
  readonly sceneLightsOnly: boolean;
  /** Optional stage focus center for aiming directional light & sky bounce ray bundles. */
  readonly focusCenter?: T.Vector3;
  /** Snap VPL positions/colors immediately without temporal lerp (e.g. on scene load or hard light toggle). */
  readonly immediate?: boolean;
}

export interface RealtimeGiDiagnostics {
  readonly activeVplCount: number;
  readonly totalVplIntensity: number;
  readonly bounceHemiIntensity: number;
  readonly raysCast: number;
  readonly rayHits: number;
}

interface CandidateVpl {
  position: T.Vector3;
  normal: T.Vector3;
  fluxColor: T.Color;
  energy: number;
  distance: number;
}

const MAX_POOLED_VPLS = 12;
const GOLDEN_ANGLE = 2.399963229728653;

// Pre-allocated scratch math objects (zero per-frame GC allocations)
const _raycaster = new T.Raycaster();
const _intersections: T.Intersection[] = [];
const _rayOrigin = new T.Vector3();
const _rayDir = new T.Vector3();
const _lightPos = new T.Vector3();
const _targetPos = new T.Vector3();
const _lightAxis = new T.Vector3();
const _tangentU = new T.Vector3();
const _tangentV = new T.Vector3();
const _worldNormal = new T.Vector3();
const _normalMatrix = new T.Matrix3();
const _albedoColor = new T.Color();
const _texelColor = new T.Color();
const _lightLinearColor = new T.Color();
const _skyBounceColor = new T.Color();
const _accumSkyColor = new T.Color();
const _accumGroundColor = new T.Color();
const _focusDefault = new T.Vector3(0, 0.95, 0);
const _evalDelta = new T.Vector3();
const _evalDir = new T.Vector3();

const _textureAverageCache = new WeakMap<T.Texture, T.Color>();

function buildOrthonormalBasis(axis: T.Vector3, outU: T.Vector3, outV: T.Vector3): void {
  if (Math.abs(axis.y) < 0.92) {
    outU.set(0, 1, 0).cross(axis).normalize();
  } else {
    outU.set(1, 0, 0).cross(axis).normalize();
  }
  outV.crossVectors(axis, outU).normalize();
}

function sampleTextureColorCpu(texture: T.Texture, uv: T.Vector2 | undefined, outColor: T.Color): boolean {
  const img = texture.image as
    | {
        data?: ArrayLike<number>;
        width?: number;
        height?: number;
      }
    | undefined;

  if (!img || !img.data || typeof img.width !== 'number' || typeof img.height !== 'number') {
    const cached = _textureAverageCache.get(texture);
    if (cached) {
      outColor.copy(cached);
      return true;
    }
    return false;
  }

  const width = img.width;
  const height = img.height;
  const data = img.data;
  if (width <= 0 || height <= 0 || data.length < 3) return false;

  const channels = Math.max(3, Math.floor(data.length / (width * height)));
  const isFloat = data instanceof Float32Array;
  const scale = isFloat ? 1 : 1 / 255;
  const isSrgb = texture.colorSpace === T.SRGBColorSpace;

  if (uv) {
    const u = ((uv.x % 1) + 1) % 1;
    const v = ((uv.y % 1) + 1) % 1;
    const px = Math.min(width - 1, Math.max(0, Math.floor(u * width)));
    const py = Math.min(height - 1, Math.max(0, Math.floor(v * height)));
    const idx = (py * width + px) * channels;
    const r = (data[idx] ?? 255) * scale;
    const g = (data[idx + 1] ?? 255) * scale;
    const b = (data[idx + 2] ?? 255) * scale;
    if (isSrgb) {
      outColor.setRGB(r, g, b, T.SRGBColorSpace);
    } else {
      outColor.setRGB(r, g, b, T.LinearSRGBColorSpace);
    }
    return true;
  }

  let cached = _textureAverageCache.get(texture);
  if (!cached) {
    const totalPixels = width * height;
    const stride = Math.max(1, Math.floor(totalPixels / 64));
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    for (let p = 0; p < totalPixels; p += stride) {
      const idx = p * channels;
      sumR += (data[idx] ?? 255) * scale;
      sumG += (data[idx + 1] ?? 255) * scale;
      sumB += (data[idx + 2] ?? 255) * scale;
      count++;
    }
    cached = new T.Color();
    if (count > 0) {
      if (isSrgb) {
        cached.setRGB(sumR / count, sumG / count, sumB / count, T.SRGBColorSpace);
      } else {
        cached.setRGB(sumR / count, sumG / count, sumB / count, T.LinearSRGBColorSpace);
      }
    } else {
      cached.setRGB(1, 1, 1);
    }
    _textureAverageCache.set(texture, cached);
  }
  outColor.copy(cached);
  return true;
}

/**
 * Extracts physically bounded linear diffuse reflectance (`albedo`) at a raycast intersection,
 * combining `material.color` with CPU-accessible `material.map` UV texel data when present.
 */
export function extractSurfaceAlbedo(hit: T.Intersection, outColor: T.Color = new T.Color()): T.Color {
  const mesh = hit.object as T.Mesh;
  const rawMaterial = mesh.material;
  const mat = Array.isArray(rawMaterial)
    ? rawMaterial[hit.face?.materialIndex ?? 0] ?? rawMaterial[0]
    : rawMaterial;

  outColor.setRGB(0.65, 0.65, 0.65);
  if (!mat) return outColor;

  const matWithColor = mat as T.MeshStandardMaterial & {
    color?: T.Color;
    map?: T.Texture | null;
    metalness?: number;
    uniforms?: Record<string, { value: unknown }>;
  };

  if (matWithColor.color && matWithColor.color.isColor) {
    outColor.copy(matWithColor.color);
  } else if (matWithColor.uniforms?.diffuse?.value instanceof T.Color) {
    outColor.copy(matWithColor.uniforms.diffuse.value);
  }

  if (matWithColor.map) {
    if (sampleTextureColorCpu(matWithColor.map, hit.uv, _texelColor)) {
      outColor.multiply(_texelColor);
    }
  }

  // Pure metals reflect specularly rather than diffusely; attenuate diffuse radiosity bounce mildly
  const metalness = typeof matWithColor.metalness === 'number' ? T.MathUtils.clamp(matWithColor.metalness, 0, 1) : 0;
  const diffuseFactor = 1 - 0.65 * metalness;

  outColor.r = T.MathUtils.clamp(outColor.r * diffuseFactor, 0.01, 0.95);
  outColor.g = T.MathUtils.clamp(outColor.g * diffuseFactor, 0.01, 0.95);
  outColor.b = T.MathUtils.clamp(outColor.b * diffuseFactor, 0.01, 0.95);
  return outColor;
}

/**
 * Jimenez et al. (SIGGRAPH 2016) cubic multi-bounce ambient occlusion approximation.
 * Preserves warm saturated indirect interreflection in skin folds and colored corners
 * instead of grey scalar darkening, while keeping `ao = 0 -> 0` and `ao = 1 -> 1` exact.
 */
export function computeMultiBounceAo(
  visibility: number,
  surfaceAlbedo: T.Color,
  outColor: T.Color = new T.Color(),
): T.Color {
  const v = T.MathUtils.clamp(visibility, 0, 1);

  const evalChannel = (rho: number): number => {
    const r = T.MathUtils.clamp(rho, 0, 0.98);
    const a = 2.0404 * r - 0.3324;
    const b = -4.7951 * r + 0.6417;
    const c = 2.7552 * r + 0.6903;
    return T.MathUtils.clamp(Math.max(v, ((v * a + b) * v + c) * v), 0, 1);
  };

  outColor.setRGB(
    evalChannel(surfaceAlbedo.r),
    evalChannel(surfaceAlbedo.g),
    evalChannel(surfaceAlbedo.b),
  );
  return outColor;
}

/**
 * Real-Time BVH / Scene-Surface Radiosity Bounce GI Rig (`RealtimeGiController`).
 *
 * Casts deterministic primary light rays from active `SpotLight`, `DirectionalLight`, and `PointLight`
 * sources against scene bounce receivers (room walls/floors/furniture, props, primitives, studio ground),
 * samples hit surface normals and diffuse albedo (`color * map`), and drives a pre-allocated zero-GC pool
 * of non-shadow-casting virtual `PointLight` bounce emitters + secondary `HemisphereLight` room irradiance.
 */
export class RealtimeGiController {
  readonly group: T.Group;
  readonly vplLights: readonly T.PointLight[];
  readonly bounceHemi: T.HemisphereLight;

  private readonly candidatePool: readonly CandidateVpl[];
  private readonly filteredTargets: T.Object3D[] = [];
  private quality: RenderQualityTier;
  private giIntensity: number;
  private enabled: boolean;
  private readonly normalOffset: number;
  private smoothing: number;
  private readonly stageLayer: number;
  private studioSkyBounceIntensity: number;
  private readonly studioSkyColor: T.Color;
  private hasValidHistory = false;
  private lastDiagnostics: RealtimeGiDiagnostics = {
    activeVplCount: 0,
    totalVplIntensity: 0,
    bounceHemiIntensity: 0,
    raysCast: 0,
    rayHits: 0,
  };

  constructor(options: RealtimeGiOptions = {}) {
    this.quality = options.quality ?? 'balanced';
    this.giIntensity = Math.max(0, options.giIntensity ?? 1.0);
    this.enabled = options.enabled ?? true;
    this.normalOffset = Math.max(0.04, options.normalOffset ?? 0.18);
    this.smoothing = T.MathUtils.clamp(options.smoothing ?? 0.38, 0.05, 1.0);
    this.stageLayer = options.stageLayer ?? 0;
    this.studioSkyBounceIntensity = Math.max(0, options.studioSkyBounceIntensity ?? 0.28);
    this.studioSkyColor = new T.Color(options.studioSkyColor ?? '#d8e5ff');

    this.group = new T.Group();
    this.group.name = 'studio-realtime-gi';
    this.group.layers.set(this.stageLayer);
    this.group.userData.ignoreShadowBounds = true;

    const pool: T.PointLight[] = [];
    for (let i = 0; i < MAX_POOLED_VPLS; i++) {
      const vpl = new T.PointLight(0x000000, 0, 9.0, 2.0);
      vpl.name = `gi-vpl-${i}`;
      vpl.castShadow = false;
      vpl.visible = false;
      vpl.layers.set(this.stageLayer);
      vpl.userData.ignoreShadowBounds = true;
      this.group.add(vpl);
      pool.push(vpl);
    }
    this.vplLights = pool;

    this.bounceHemi = new T.HemisphereLight(0x000000, 0x000000, 0);
    this.bounceHemi.name = 'gi-indirect-hemisphere';
    this.bounceHemi.visible = false;
    this.bounceHemi.layers.set(this.stageLayer);
    this.bounceHemi.userData.ignoreShadowBounds = true;
    this.group.add(this.bounceHemi);

    const candidates: CandidateVpl[] = [];
    for (let i = 0; i < 96; i++) {
      candidates.push({
        position: new T.Vector3(),
        normal: new T.Vector3(0, 1, 0),
        fluxColor: new T.Color(0, 0, 0),
        energy: 0,
        distance: 8.5,
      });
    }
    this.candidatePool = candidates;
  }

  setQuality(quality: RenderQualityTier): void {
    this.quality = quality;
  }

  getQuality(): RenderQualityTier {
    return this.quality;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.zeroAllBounceLights();
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setGiIntensity(intensity: number): void {
    this.giIntensity = Math.max(0, Number.isFinite(intensity) ? intensity : 1.0);
    if (this.giIntensity <= 0) {
      this.zeroAllBounceLights();
    }
  }

  getGiIntensity(): number {
    return this.giIntensity;
  }

  setSmoothing(smoothing: number): void {
    this.smoothing = T.MathUtils.clamp(smoothing, 0.05, 1.0);
  }

  getDiagnostics(): RealtimeGiDiagnostics {
    return this.lastDiagnostics;
  }

  /**
   * Immediately extinguishes all pooled VPLs and indirect bounce hemisphere to exact `0`.
   */
  zeroAllBounceLights(): void {
    for (let i = 0; i < this.vplLights.length; i++) {
      const vpl = this.vplLights[i];
      vpl.intensity = 0;
      vpl.color.setRGB(0, 0, 0);
      vpl.visible = false;
    }
    this.bounceHemi.intensity = 0;
    this.bounceHemi.color.setRGB(0, 0, 0);
    this.bounceHemi.groundColor.setRGB(0, 0, 0);
    this.bounceHemi.visible = false;
    this.hasValidHistory = false;
    this.lastDiagnostics = {
      activeVplCount: 0,
      totalVplIntensity: 0,
      bounceHemiIntensity: 0,
      raysCast: 0,
      rayHits: 0,
    };
  }

  private collectBounceMeshes(roots: readonly T.Object3D[]): void {
    this.filteredTargets.length = 0;
    const stageMask = 1 << this.stageLayer;

    const visit = (node: T.Object3D): void => {
      if (!node.visible || node === this.group) return;
      if (node.userData?.ignoreGiBounce === true) return;

      const mesh = node as T.Mesh;
      if (mesh.isMesh && (mesh.layers.mask & stageMask) !== 0) {
        this.filteredTargets.push(mesh);
      }

      const children = node.children;
      for (let i = 0; i < children.length; i++) {
        visit(children[i]);
      }
    };

    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      if (!root || !root.visible || root === this.group) continue;
      root.updateMatrixWorld(true);
      visit(root);
    }
  }

  private castBounceRay(
    origin: T.Vector3,
    direction: T.Vector3,
    maxDist: number,
    incidentColor: T.Color,
    incidentWeight: number,
    candidateIndexRef: { count: number },
  ): boolean {
    _raycaster.layers.set(this.stageLayer);
    _raycaster.near = 0.05;
    _raycaster.far = maxDist;
    _raycaster.set(origin, direction);

    _intersections.length = 0;
    _raycaster.intersectObjects(this.filteredTargets, false, _intersections);
    if (_intersections.length === 0) {
      return false;
    }

    const hit = _intersections[0];
    if (hit.face) {
      _normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      _worldNormal.copy(hit.face.normal).applyMatrix3(_normalMatrix).normalize();
    } else {
      _worldNormal.copy(direction).negate();
    }

    // Orient normal toward incoming ray for DoubleSide walls/floors
    if (_worldNormal.dot(direction) > 0) {
      _worldNormal.negate();
    }

    const cosIncidence = Math.max(0, -direction.dot(_worldNormal));
    if (cosIncidence <= 0.02) {
      return false;
    }

    extractSurfaceAlbedo(hit, _albedoColor);

    const fluxScale = incidentWeight * cosIncidence * this.giIntensity;
    if (fluxScale <= 1e-5) {
      return false;
    }

    const slotIdx = candidateIndexRef.count;
    if (slotIdx < this.candidatePool.length) {
      const slot = this.candidatePool[slotIdx];
      slot.position.copy(hit.point).addScaledVector(_worldNormal, this.normalOffset);
      slot.normal.copy(_worldNormal);
      slot.fluxColor.copy(incidentColor).multiply(_albedoColor).multiplyScalar(fluxScale);
      slot.energy = Math.max(slot.fluxColor.r, slot.fluxColor.g, slot.fluxColor.b);
      slot.distance = T.MathUtils.clamp(4.5 + Math.sqrt(slot.energy) * 3.5, 5.0, 14.0);
      if (slot.energy > 1e-5) {
        candidateIndexRef.count++;
      }
    }

    // Accumulate secondary multi-bounce ambient room fill weighted by surface orientation
    const upWeight = 0.5 * (_worldNormal.y + 1.0); // 1 for floors facing +Y, 0 for ceilings facing -Y
    const hemiScale = fluxScale * 0.22;
    _texelColor.copy(incidentColor).multiply(_albedoColor).multiplyScalar(hemiScale);
    // Floor/upward hits illuminate undersides (`groundColor`); ceiling/wall hits illuminate tops (`skyColor`)
    _accumGroundColor.r += _texelColor.r * (0.35 + 0.65 * upWeight);
    _accumGroundColor.g += _texelColor.g * (0.35 + 0.65 * upWeight);
    _accumGroundColor.b += _texelColor.b * (0.35 + 0.65 * upWeight);

    _accumSkyColor.r += _texelColor.r * (1.0 - 0.55 * upWeight);
    _accumSkyColor.g += _texelColor.g * (1.0 - 0.55 * upWeight);
    _accumSkyColor.b += _texelColor.b * (1.0 - 0.55 * upWeight);

    return true;
  }

  /**
   * Updates virtual bounce lights and secondary room irradiance from active scene lights
   * and bounce receiver surfaces.
   */
  update(input: RealtimeGiUpdateInput): RealtimeGiDiagnostics {
    if (!this.enabled || this.giIntensity <= 0) {
      this.zeroAllBounceLights();
      return this.lastDiagnostics;
    }

    // Count active emitting scene lights first so the dark-room invariant short-circuits cleanly
    let activeSceneLights = 0;
    for (let i = 0; i < input.lights.length; i++) {
      const l = input.lights[i];
      if (l && l.visible && l.intensity > 0) {
        activeSceneLights++;
      }
    }

    if (input.sceneLightsOnly && activeSceneLights === 0) {
      this.zeroAllBounceLights();
      return this.lastDiagnostics;
    }

    this.collectBounceMeshes(input.bounceTargets);
    if (this.filteredTargets.length === 0) {
      this.zeroAllBounceLights();
      return this.lastDiagnostics;
    }

    const preset = GI_QUALITY_PRESETS[this.quality];
    const focus = input.focusCenter ?? _focusDefault;
    const candidateRef = { count: 0 };
    let raysCast = 0;
    let rayHits = 0;

    _accumSkyColor.setRGB(0, 0, 0);
    _accumGroundColor.setRGB(0, 0, 0);

    for (let li = 0; li < input.lights.length; li++) {
      const light = input.lights[li];
      if (!light || !light.visible || light.intensity <= 0) continue;

      light.updateMatrixWorld(true);
      _lightLinearColor.copy(light.color);

      const spot = light as T.SpotLight;
      const dirLight = light as T.DirectionalLight;
      const point = light as T.PointLight;

      if (spot.isSpotLight) {
        spot.target.updateMatrixWorld(true);
        _lightPos.setFromMatrixPosition(spot.matrixWorld);
        _targetPos.setFromMatrixPosition(spot.target.matrixWorld);
        _lightAxis.subVectors(_targetPos, _lightPos);
        if (_lightAxis.lengthSq() < 1e-8) {
          _lightAxis.set(0, -1, 0);
        } else {
          _lightAxis.normalize();
        }
        buildOrthonormalBasis(_lightAxis, _tangentU, _tangentV);

        const raysCount = preset.raysPerLight;
        const maxConeAngle = T.MathUtils.clamp(spot.angle * 0.78, 0.04, Math.PI * 0.44);
        const maxRange = spot.distance > 0 ? spot.distance : 45;
        const perRayFlux = (spot.intensity * 0.24) / raysCount;

        for (let r = 0; r < raysCount; r++) {
          if (r === 0) {
            _rayDir.copy(_lightAxis);
          } else {
            const frac = r / raysCount;
            const theta = Math.sqrt(frac) * maxConeAngle;
            const phi = r * GOLDEN_ANGLE;
            const sinTheta = Math.sin(theta);
            const cosTheta = Math.cos(theta);
            _rayDir
              .copy(_lightAxis)
              .multiplyScalar(cosTheta)
              .addScaledVector(_tangentU, Math.cos(phi) * sinTheta)
              .addScaledVector(_tangentV, Math.sin(phi) * sinTheta)
              .normalize();
          }

          // Pre-probe distance attenuation via raycast hit distance inside castBounceRay
          _raycaster.layers.set(this.stageLayer);
          _raycaster.near = 0.05;
          _raycaster.far = maxRange;
          _raycaster.set(_lightPos, _rayDir);
          _intersections.length = 0;
          _raycaster.intersectObjects(this.filteredTargets, false, _intersections);
          raysCast++;

          if (_intersections.length > 0) {
            const hit = _intersections[0];
            const d = hit.distance;
            const distAtten = 1 / (1 + 0.1 * d + 0.065 * d * d);
            const rangeWindow =
              spot.distance > 0 ? Math.pow(T.MathUtils.clamp(1 - Math.pow(d / spot.distance, 4), 0, 1), 2) : 1;
            const cosCone = Math.max(0, _rayDir.dot(_lightAxis));
            const cosOuter = Math.cos(spot.angle);
            const cosInner = Math.cos(spot.angle * (1 - T.MathUtils.clamp(spot.penumbra, 0, 1)));
            const spotConeAtten = T.MathUtils.smoothstep(cosCone, cosOuter, Math.max(cosOuter + 1e-4, cosInner));

            const effectiveWeight = perRayFlux * distAtten * rangeWindow * spotConeAtten;
            if (
              effectiveWeight > 1e-5 &&
              this.recordIntersectionBounce(hit, _rayDir, _lightLinearColor, effectiveWeight, candidateRef)
            ) {
              rayHits++;
            }
          }
        }
      } else if (dirLight.isDirectionalLight) {
        dirLight.target.updateMatrixWorld(true);
        _lightPos.setFromMatrixPosition(dirLight.matrixWorld);
        _targetPos.setFromMatrixPosition(dirLight.target.matrixWorld);
        _lightAxis.subVectors(_targetPos, _lightPos);
        if (_lightAxis.lengthSq() < 1e-8) {
          _lightAxis.set(-0.35, -1, -0.35).normalize();
        } else {
          _lightAxis.normalize();
        }
        buildOrthonormalBasis(_lightAxis, _tangentU, _tangentV);

        const raysCount = preset.raysPerLight;
        const diskRadius = 2.6;
        const perRayFlux = (dirLight.intensity * 1.45) / raysCount;

        for (let r = 0; r < raysCount; r++) {
          const rad = r === 0 ? 0 : Math.sqrt(r / raysCount) * diskRadius;
          const phi = r * GOLDEN_ANGLE;
          _rayOrigin
            .copy(focus)
            .addScaledVector(_tangentU, Math.cos(phi) * rad)
            .addScaledVector(_tangentV, Math.sin(phi) * rad)
            .addScaledVector(_lightAxis, -14.0);

          raysCast++;
          if (this.castBounceRay(_rayOrigin, _lightAxis, 32.0, _lightLinearColor, perRayFlux, candidateRef)) {
            rayHits++;
          }
        }
      } else if (point.isPointLight) {
        _lightPos.setFromMatrixPosition(point.matrixWorld);
        const raysCount = preset.raysPerLight;
        const maxRange = point.distance > 0 ? point.distance : 35;
        const perRayFlux = (point.intensity * 0.28) / raysCount;

        for (let r = 0; r < raysCount; r++) {
          // Deterministic Fibonacci sphere directions covering room walls, floor, and ceiling
          const y = 1 - ((r + 0.5) / raysCount) * 2;
          const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
          const phi = r * GOLDEN_ANGLE;
          _rayDir.set(Math.cos(phi) * radiusAtY, y, Math.sin(phi) * radiusAtY).normalize();

          _raycaster.layers.set(this.stageLayer);
          _raycaster.near = 0.05;
          _raycaster.far = maxRange;
          _raycaster.set(_lightPos, _rayDir);
          _intersections.length = 0;
          _raycaster.intersectObjects(this.filteredTargets, false, _intersections);
          raysCast++;

          if (_intersections.length > 0) {
            const hit = _intersections[0];
            const d = hit.distance;
            const distAtten = 1 / (1 + 0.12 * d + 0.08 * d * d);
            const rangeWindow =
              point.distance > 0 ? Math.pow(T.MathUtils.clamp(1 - Math.pow(d / point.distance, 4), 0, 1), 2) : 1;
            const effectiveWeight = perRayFlux * distAtten * rangeWindow;
            if (
              effectiveWeight > 1e-5 &&
              this.recordIntersectionBounce(hit, _rayDir, _lightLinearColor, effectiveWeight, candidateRef)
            ) {
              rayHits++;
            }
          }
        }
      }
    }

    // Optional subtle studio sky-to-floor color bounce ONLY when `!sceneLightsOnly`
    if (!input.sceneLightsOnly && this.studioSkyBounceIntensity > 0 && preset.skyBounceRays > 0) {
      const skyRays = preset.skyBounceRays;
      const skyWeight = (this.studioSkyBounceIntensity * 0.9) / skyRays;
      _skyBounceColor.copy(this.studioSkyColor);
      _rayDir.set(0, -1, 0);

      for (let r = 0; r < skyRays; r++) {
        const rad = r === 0 ? 0 : Math.sqrt(r / skyRays) * 2.2;
        const phi = r * GOLDEN_ANGLE;
        _rayOrigin.set(focus.x + Math.cos(phi) * rad, focus.y + 8.0, focus.z + Math.sin(phi) * rad);
        raysCast++;
        if (this.castBounceRay(_rayOrigin, _rayDir, 16.0, _skyBounceColor, skyWeight, candidateRef)) {
          rayHits++;
        }
      }
    }

    if (candidateRef.count === 0) {
      this.zeroAllBounceLights();
      this.lastDiagnostics = {
        activeVplCount: 0,
        totalVplIntensity: 0,
        bounceHemiIntensity: 0,
        raysCast,
        rayHits,
      };
      return this.lastDiagnostics;
    }

    // Select top `maxVplCount` highest-energy candidates in-place (selection sort over small <= 96 pool, zero allocations)
    const vplBudget = Math.min(preset.maxVplCount, this.vplLights.length, candidateRef.count);
    for (let i = 0; i < vplBudget; i++) {
      let bestIdx = i;
      let bestEnergy = this.candidatePool[i].energy;
      for (let j = i + 1; j < candidateRef.count; j++) {
        if (this.candidatePool[j].energy > bestEnergy) {
          bestEnergy = this.candidatePool[j].energy;
          bestIdx = j;
        }
      }
      if (bestIdx !== i) {
        const tmpPosX = this.candidatePool[i].position.x;
        const tmpPosY = this.candidatePool[i].position.y;
        const tmpPosZ = this.candidatePool[i].position.z;
        const tmpNormX = this.candidatePool[i].normal.x;
        const tmpNormY = this.candidatePool[i].normal.y;
        const tmpNormZ = this.candidatePool[i].normal.z;
        const tmpR = this.candidatePool[i].fluxColor.r;
        const tmpG = this.candidatePool[i].fluxColor.g;
        const tmpB = this.candidatePool[i].fluxColor.b;
        const tmpEnergy = this.candidatePool[i].energy;
        const tmpDist = this.candidatePool[i].distance;

        this.candidatePool[i].position.copy(this.candidatePool[bestIdx].position);
        this.candidatePool[i].normal.copy(this.candidatePool[bestIdx].normal);
        this.candidatePool[i].fluxColor.copy(this.candidatePool[bestIdx].fluxColor);
        this.candidatePool[i].energy = this.candidatePool[bestIdx].energy;
        this.candidatePool[i].distance = this.candidatePool[bestIdx].distance;

        this.candidatePool[bestIdx].position.set(tmpPosX, tmpPosY, tmpPosZ);
        this.candidatePool[bestIdx].normal.set(tmpNormX, tmpNormY, tmpNormZ);
        this.candidatePool[bestIdx].fluxColor.setRGB(tmpR, tmpG, tmpB);
        this.candidatePool[bestIdx].energy = tmpEnergy;
        this.candidatePool[bestIdx].distance = tmpDist;
      }
    }

    // Conserve total primary bounce energy if candidate count exceeded `vplBudget`
    let totalCandidateEnergy = 0;
    let selectedEnergy = 0;
    for (let i = 0; i < candidateRef.count; i++) {
      totalCandidateEnergy += this.candidatePool[i].energy;
      if (i < vplBudget) selectedEnergy += this.candidatePool[i].energy;
    }
    const energyConservationScale =
      selectedEnergy > 1e-6 ? T.MathUtils.clamp(totalCandidateEnergy / selectedEnergy, 1.0, 2.5) : 1.0;

    const alpha = input.immediate || !this.hasValidHistory ? 1.0 : this.smoothing;
    let totalVplIntensity = 0;
    let activeVplCount = 0;

    for (let i = 0; i < this.vplLights.length; i++) {
      const vpl = this.vplLights[i];
      if (i < vplBudget) {
        const cand = this.candidatePool[i];
        const peakChannel = Math.max(cand.fluxColor.r, cand.fluxColor.g, cand.fluxColor.b, 1e-6);
        _texelColor.setRGB(
          cand.fluxColor.r / peakChannel,
          cand.fluxColor.g / peakChannel,
          cand.fluxColor.b / peakChannel,
        );
        const targetIntensity = T.MathUtils.clamp(peakChannel * energyConservationScale, 0, 25);

        if (alpha >= 0.999 || !vpl.visible) {
          vpl.position.copy(cand.position);
          vpl.color.copy(_texelColor);
          vpl.intensity = targetIntensity;
          vpl.distance = cand.distance;
        } else {
          vpl.position.lerp(cand.position, alpha);
          vpl.color.lerp(_texelColor, alpha);
          vpl.intensity = T.MathUtils.lerp(vpl.intensity, targetIntensity, alpha);
          vpl.distance = T.MathUtils.lerp(vpl.distance, cand.distance, alpha);
        }
        vpl.visible = vpl.intensity > 1e-4;
        if (vpl.visible) {
          vpl.updateMatrixWorld(true);
          activeVplCount++;
          totalVplIntensity += vpl.intensity;
        }
      } else {
        vpl.intensity = 0;
        vpl.color.setRGB(0, 0, 0);
        vpl.visible = false;
      }
    }

    // Apply secondary multi-bounce room HemisphereLight
    const skyPeak = Math.max(_accumSkyColor.r, _accumSkyColor.g, _accumSkyColor.b);
    const groundPeak = Math.max(_accumGroundColor.r, _accumGroundColor.g, _accumGroundColor.b);
    const hemiPeak = Math.max(skyPeak, groundPeak);

    if (hemiPeak > 1e-5) {
      const invPeak = 1 / hemiPeak;
      _accumSkyColor.multiplyScalar(invPeak);
      _accumGroundColor.multiplyScalar(invPeak);
      const targetHemiIntensity = T.MathUtils.clamp(hemiPeak, 0, 2.5);

      if (alpha >= 0.999 || !this.bounceHemi.visible) {
        this.bounceHemi.color.copy(_accumSkyColor);
        this.bounceHemi.groundColor.copy(_accumGroundColor);
        this.bounceHemi.intensity = targetHemiIntensity;
      } else {
        this.bounceHemi.color.lerp(_accumSkyColor, alpha);
        this.bounceHemi.groundColor.lerp(_accumGroundColor, alpha);
        this.bounceHemi.intensity = T.MathUtils.lerp(this.bounceHemi.intensity, targetHemiIntensity, alpha);
      }
      this.bounceHemi.visible = this.bounceHemi.intensity > 1e-4;
    } else {
      this.bounceHemi.intensity = 0;
      this.bounceHemi.color.setRGB(0, 0, 0);
      this.bounceHemi.groundColor.setRGB(0, 0, 0);
      this.bounceHemi.visible = false;
    }

    this.hasValidHistory = activeVplCount > 0 || this.bounceHemi.visible;
    this.lastDiagnostics = {
      activeVplCount,
      totalVplIntensity,
      bounceHemiIntensity: this.bounceHemi.intensity,
      raysCast,
      rayHits,
    };
    return this.lastDiagnostics;
  }

  private recordIntersectionBounce(
    hit: T.Intersection,
    rayDirection: T.Vector3,
    incidentColor: T.Color,
    incidentWeight: number,
    candidateIndexRef: { count: number },
  ): boolean {
    if (hit.face) {
      _normalMatrix.getNormalMatrix(hit.object.matrixWorld);
      _worldNormal.copy(hit.face.normal).applyMatrix3(_normalMatrix).normalize();
    } else {
      _worldNormal.copy(rayDirection).negate();
    }
    if (_worldNormal.dot(rayDirection) > 0) {
      _worldNormal.negate();
    }

    const cosIncidence = Math.max(0, -rayDirection.dot(_worldNormal));
    if (cosIncidence <= 0.02) return false;

    extractSurfaceAlbedo(hit, _albedoColor);
    const fluxScale = incidentWeight * cosIncidence * this.giIntensity;
    if (fluxScale <= 1e-5) return false;

    const slotIdx = candidateIndexRef.count;
    if (slotIdx < this.candidatePool.length) {
      const slot = this.candidatePool[slotIdx];
      slot.position.copy(hit.point).addScaledVector(_worldNormal, this.normalOffset);
      slot.normal.copy(_worldNormal);
      slot.fluxColor.copy(incidentColor).multiply(_albedoColor).multiplyScalar(fluxScale);
      slot.energy = Math.max(slot.fluxColor.r, slot.fluxColor.g, slot.fluxColor.b);
      slot.distance = T.MathUtils.clamp(4.5 + Math.sqrt(slot.energy) * 3.5, 5.0, 14.0);
      if (slot.energy > 1e-5) {
        candidateIndexRef.count++;
      }
    }

    const upWeight = 0.5 * (_worldNormal.y + 1.0);
    const hemiScale = fluxScale * 0.22;
    _texelColor.copy(incidentColor).multiply(_albedoColor).multiplyScalar(hemiScale);
    _accumGroundColor.r += _texelColor.r * (0.35 + 0.65 * upWeight);
    _accumGroundColor.g += _texelColor.g * (0.35 + 0.65 * upWeight);
    _accumGroundColor.b += _texelColor.b * (0.35 + 0.65 * upWeight);
    _accumSkyColor.r += _texelColor.r * (1.0 - 0.55 * upWeight);
    _accumSkyColor.g += _texelColor.g * (1.0 - 0.55 * upWeight);
    _accumSkyColor.b += _texelColor.b * (1.0 - 0.55 * upWeight);

    return true;
  }

  /**
   * Evaluates total RGB bounce irradiance from all active VPLs + secondary bounce hemisphere
   * arriving at a world-space point `worldPoint` with optional surface normal `worldNormal`.
   */
  evaluateBounceIrradianceAt(
    worldPoint: T.Vector3,
    worldNormal?: T.Vector3,
    outColor: T.Color = new T.Color(),
  ): T.Color {
    outColor.setRGB(0, 0, 0);

    for (let i = 0; i < this.vplLights.length; i++) {
      const vpl = this.vplLights[i];
      if (!vpl.visible || vpl.intensity <= 0) continue;

      _evalDelta.subVectors(vpl.position, worldPoint);
      const dist = _evalDelta.length();
      if (dist <= 1e-5 || (vpl.distance > 0 && dist >= vpl.distance)) continue;

      _evalDir.copy(_evalDelta).multiplyScalar(1 / dist);
      const nDotL = worldNormal ? Math.max(0, worldNormal.dot(_evalDir)) : 1.0;
      if (nDotL <= 0) continue;

      const rangeFactor =
        vpl.distance > 0 ? Math.pow(T.MathUtils.clamp(1 - Math.pow(dist / vpl.distance, 4), 0, 1), 2) : 1;
      const atten = (vpl.intensity * nDotL * rangeFactor) / Math.max(0.15, Math.pow(dist, vpl.decay));
      outColor.r += vpl.color.r * atten;
      outColor.g += vpl.color.g * atten;
      outColor.b += vpl.color.b * atten;
    }

    if (this.bounceHemi.visible && this.bounceHemi.intensity > 0) {
      const hemiMix = worldNormal ? 0.5 * worldNormal.y + 0.5 : 0.5;
      const skyW = hemiMix * this.bounceHemi.intensity;
      const gndW = (1 - hemiMix) * this.bounceHemi.intensity;
      outColor.r += this.bounceHemi.color.r * skyW + this.bounceHemi.groundColor.r * gndW;
      outColor.g += this.bounceHemi.color.g * skyW + this.bounceHemi.groundColor.g * gndW;
      outColor.b += this.bounceHemi.color.b * skyW + this.bounceHemi.groundColor.b * gndW;
    }

    return outColor;
  }

  dispose(): void {
    this.zeroAllBounceLights();
    this.filteredTargets.length = 0;
    this.group.clear();
  }
}

/**
 * Determines whether screen-space GTAO + Multi-Bounce Contact Occlusion should execute
 * for the current shading mode, quality tier, and user toggle.
 */
export function shouldApplyStudioAo(
  renderMode: RenderModeId,
  quality: RenderQualityTier,
  aoEnabled = true,
): boolean {
  if (!aoEnabled) return false;
  if (quality === 'performance') return false;
  if (renderMode === 'flat' || renderMode === 'outline') return false;
  return renderMode === 'realistic' || renderMode === 'clay';
}

export interface StudioPostGiPipelineOptions {
  readonly width?: number;
  readonly height?: number;
  readonly quality?: RenderQualityTier;
  readonly aoIntensity?: number;
  readonly aoRadius?: number;
  readonly stageLayer?: number;
}

/**
 * Post-Processing Screen-Space GTAO + Jimenez Multi-Bounce Albedo Contact Shadow Pass (`StudioPostGiPipeline`).
 *
 * Wraps Three.js `0.181.0`'s `GTAOPass` (`output = Off` so raw denoised `gtaoMap` is produced at
 * tier-scaled resolution) followed by a custom `MultiBounceAoComposite` fullscreen shader that:
 * 1. Isolates `camera.layers` to `STAGE_LAYER` (`0`) during GTAO normal/depth rendering so `HELPER_LAYER`
 *    gizmos, joint spheres, and wireframes NEVER cast AO halos.
 * 2. Applies Jimenez cubic multi-bounce albedo interreflection (`GTAOMultiBounce`) so skin creases stay warm
 *    while deep contact seams (feet on floor, fingers over palm, furniture corners) ground crisply.
 * 3. Automatically bypasses heavy AO passes in `Flat` / `Outline` / `Illustration` NPR modes or `Performance` tier.
 * 4. Fixes Three.js `0.181.0`'s `GTAOPass.dispose()` leak by explicitly disposing `blendMaterial` and `depthTexture`.
 */
export class StudioPostGiPipeline extends Pass {
  readonly gtaoPass: GTAOPass;
  private readonly compositeMaterial: T.ShaderMaterial;
  private readonly compositeQuad: FullScreenQuad;
  private quality: RenderQualityTier;
  private renderMode: RenderModeId = 'realistic';
  private aoEnabled = true;
  private aoIntensity: number;
  private aoRadius: number;
  private fullWidth: number;
  private fullHeight: number;
  private readonly stageLayer: number;

  constructor(
    scene: T.Scene,
    camera: T.Camera,
    options: StudioPostGiPipelineOptions = {},
  ) {
    super();
    this.quality = options.quality ?? 'balanced';
    this.aoIntensity = T.MathUtils.clamp(options.aoIntensity ?? 1.0, 0, 2.0);
    this.aoRadius = T.MathUtils.clamp(options.aoRadius ?? 0.32, 0.05, 2.5);
    this.fullWidth = Math.max(1, Math.floor(options.width ?? 1024));
    this.fullHeight = Math.max(1, Math.floor(options.height ?? 768));
    this.stageLayer = options.stageLayer ?? 0;

    const preset = GI_QUALITY_PRESETS[this.quality];
    const scaledW = Math.max(1, Math.floor(this.fullWidth * preset.aoResolutionScale));
    const scaledH = Math.max(1, Math.floor(this.fullHeight * preset.aoResolutionScale));

    this.gtaoPass = new GTAOPass(scene, camera, scaledW, scaledH);
    this.gtaoPass.output = GTAOPass.OUTPUT.Off;
    this.applyPresetParameters();

    this.compositeMaterial = new T.ShaderMaterial({
      name: 'StudioMultiBounceAoComposite',
      uniforms: {
        tDiffuse: { value: null },
        tAo: { value: this.gtaoPass.gtaoMap },
        uAoIntensity: { value: this.aoIntensity },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tAo;
        uniform float uAoIntensity;
        varying vec2 vUv;

        vec3 studioGtaoMultiBounce( float visibility, vec3 albedo ) {
          vec3 a = 2.0404 * albedo - 0.3324;
          vec3 b = -4.7951 * albedo + 0.6417;
          vec3 c = 2.7552 * albedo + 0.6903;
          return clamp( max( vec3( visibility ), ( ( visibility * a + b ) * visibility + c ) * visibility ), 0.0, 1.0 );
        }

        void main() {
          vec4 baseTexel = texture2D( tDiffuse, vUv );
          float rawAo = texture2D( tAo, vUv ).r;
          float visibility = clamp( mix( 1.0, rawAo, uAoIntensity ), 0.0, 1.0 );

          // Estimate chromaticity albedo from lit buffer while keeping exact [0, 0, 0] dark-room invariance
          float peak = max( max( baseTexel.r, baseTexel.g ), baseTexel.b );
          vec3 approxAlbedo = peak > 0.0005 ? clamp( baseTexel.rgb / max( peak, 0.35 ), 0.04, 0.92 ) : vec3( 0.0 );
          vec3 multiBounceAo = studioGtaoMultiBounce( visibility, approxAlbedo );

          gl_FragColor = vec4( baseTexel.rgb * multiBounceAo, baseTexel.a );
        }
      `,
      depthTest: false,
      depthWrite: false,
    });

    this.compositeQuad = new FullScreenQuad(this.compositeMaterial);
    this.syncPassEnabledState();
  }

  private applyPresetParameters(): void {
    const preset = GI_QUALITY_PRESETS[this.quality];
    this.gtaoPass.updateGtaoMaterial({
      radius: this.aoRadius,
      distanceExponent: 1.4,
      thickness: 0.85,
      scale: 1.0,
      samples: preset.aoSamples,
      distanceFallOff: 1.0,
      screenSpaceRadius: false,
    });
    this.gtaoPass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 6,
      rings: 2,
      samples: preset.aoDenoiseSamples,
    });
  }

  private syncPassEnabledState(): void {
    this.enabled = shouldApplyStudioAo(this.renderMode, this.quality, this.aoEnabled) && this.aoIntensity > 1e-4;
    this.needsSwap = this.enabled;
  }

  setRenderMode(mode: RenderModeId): void {
    this.renderMode = mode;
    this.syncPassEnabledState();
  }

  setQuality(quality: RenderQualityTier): void {
    if (this.quality === quality) return;
    this.quality = quality;
    this.applyPresetParameters();
    this.setSize(this.fullWidth, this.fullHeight);
    this.syncPassEnabledState();
  }

  setAoEnabled(enabled: boolean): void {
    this.aoEnabled = enabled;
    this.syncPassEnabledState();
  }

  setAoIntensity(intensity: number): void {
    this.aoIntensity = T.MathUtils.clamp(intensity, 0, 2.0);
    this.compositeMaterial.uniforms.uAoIntensity.value = this.aoIntensity;
    this.syncPassEnabledState();
  }

  setAoRadius(radius: number): void {
    this.aoRadius = T.MathUtils.clamp(radius, 0.05, 2.5);
    this.gtaoPass.updateGtaoMaterial({ radius: this.aoRadius });
  }

  updateSceneBounds(sceneClipBox: T.Box3): void {
    if (!sceneClipBox.isEmpty()) {
      this.gtaoPass.setSceneClipBox(sceneClipBox);
    }
  }

  getDepthTexture(): T.DepthTexture {
    return this.gtaoPass.depthTexture;
  }

  override setSize(width: number, height: number): void {
    this.fullWidth = Math.max(1, Math.floor(width));
    this.fullHeight = Math.max(1, Math.floor(height));
    const preset = GI_QUALITY_PRESETS[this.quality];
    const scaledW = Math.max(1, Math.floor(this.fullWidth * preset.aoResolutionScale));
    const scaledH = Math.max(1, Math.floor(this.fullHeight * preset.aoResolutionScale));
    this.gtaoPass.setSize(scaledW, scaledH);
  }

  override render(
    renderer: T.WebGLRenderer,
    writeBuffer: T.WebGLRenderTarget,
    readBuffer: T.WebGLRenderTarget,
    deltaTime?: number,
    maskActive?: boolean,
  ): void {
    if (!this.enabled) return;

    // Strictly isolate camera to `STAGE_LAYER` so `HELPER_LAYER` gizmos/spheres/lines never cast AO halos
    const cam = this.gtaoPass.camera;
    const prevLayerMask = cam.layers.mask;
    cam.layers.set(this.stageLayer);
    try {
      this.gtaoPass.render(renderer, writeBuffer, readBuffer, deltaTime ?? 0, maskActive ?? false);
    } finally {
      cam.layers.mask = prevLayerMask;
    }

    this.compositeMaterial.uniforms.tDiffuse.value = readBuffer.texture;
    this.compositeMaterial.uniforms.tAo.value = this.gtaoPass.gtaoMap;
    this.compositeMaterial.uniforms.uAoIntensity.value = this.aoIntensity;

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.compositeQuad.render(renderer);
  }

  override dispose(): void {
    this.gtaoPass.dispose();
    // Fix Three.js 0.181.0 GTAOPass.dispose() omissions (`blendMaterial` and `depthTexture`)
    this.gtaoPass.blendMaterial?.dispose();
    this.gtaoPass.depthTexture?.dispose();
    this.compositeMaterial.dispose();
    this.compositeQuad.dispose();
  }
}
