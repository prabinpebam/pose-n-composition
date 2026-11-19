import * as T from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { DEFAULT_RENDER_STYLE, RENDER_MODES, type RenderStyleState } from './model';

export const STAGE_LAYER = 0;
export const HELPER_LAYER = 1;
export function setLayerRecursive(object: T.Object3D, layer: number): void {
  object.traverse(node => node.layers.set(layer));
}
export const CLAY_COLORS = { terracotta: '#c67d63', grey: '#9ea3aa', plaster: '#ded7cb' };
export function paperColor(style: RenderStyleState, background: string): string {
  return style.outlinePaper === 'white' ? '#ffffff' : style.outlinePaper === 'scene' ? background : '#faf6ee';
}
export function needsInk(style: RenderStyleState): boolean {
  return style.mode === 'illustration' || style.mode === 'outline' || (style.mode === 'clay' && style.clayOutlines);
}
export class StudioShadingController {
  private attached = new WeakSet<T.MeshStandardMaterial>();
  readonly uniforms = {
    uShadeMode: { value: 0 }, uClayColor: { value: new T.Color() },
    uShadowSteps: { value: 2 }, uShadowTint: { value: new T.Vector3() },
    uPaperColor: { value: new T.Color() },
  };
  update(style: RenderStyleState, background: string): void {
    const u = this.uniforms;
    u.uShadeMode.value = RENDER_MODES.indexOf(style.mode);
    u.uClayColor.value.set(CLAY_COLORS[style.clayFinish]);
    u.uPaperColor.value.set(paperColor(style, background));
    u.uShadowSteps.value = style.shadowSteps;
    u.uShadowTint.value.fromArray(style.shadowTemp === 'cool' ? [0.72, 0.77, 0.96] : style.shadowTemp === 'warm' ? [0.95, 0.78, 0.68] : [0.82, 0.82, 0.84]);
  }
  attachStudioShading(material: T.MeshStandardMaterial): void {
    if (this.attached.has(material)) return;
    this.attached.add(material);
    const previous = material.onBeforeCompile;
    const key = material.customProgramCacheKey();
    material.customProgramCacheKey = () => `${key}-studio-npr-v1`;
    material.onBeforeCompile = (shader, renderer) => {
      previous.call(material, shader, renderer);
      Object.assign(shader.uniforms, this.uniforms);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
uniform int uShadeMode;
uniform vec3 uClayColor, uShadowTint, uPaperColor;
uniform float uShadowSteps;`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', `
vec3 pncBaseAlbedo = diffuseColor.rgb;
if (uShadeMode == 3) {
  diffuseColor.rgb = uClayColor;
  roughnessFactor = 0.86;
  metalnessFactor = 0.0;
} else if (uShadeMode != 0) {
  metalnessFactor = 0.0;
  roughnessFactor = max(roughnessFactor, 0.92);
}
#include <lights_physical_fragment>`);
      shader.fragmentShader = shader.fragmentShader.replace('vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;', `
vec3 outgoingLight = totalDiffuse + totalSpecular + totalEmissiveRadiance;
if (uShadeMode == 4) outgoingLight = pncBaseAlbedo;
if (uShadeMode == 2) outgoingLight = uPaperColor;
if (uShadeMode == 1) {
  float albedoLuma = max(dot(pncBaseAlbedo, vec3(0.2126, 0.7152, 0.0722)), 0.0001);
  float irradiance = 3.14159265 * dot(reflectedLight.directDiffuse, vec3(0.2126, 0.7152, 0.0722)) / albedoLuma;
  float aa = clamp(fwidth(irradiance) * 1.35, 0.008, 0.06);
  float band = smoothstep(0.48 - aa, 0.48 + aa, irradiance);
  vec3 shadow = mix(pncBaseAlbedo * 0.56, pncBaseAlbedo * uShadowTint + 0.025 * uShadowTint, 0.48);
  vec3 lightTint = reflectedLight.directDiffuse / max(dot(reflectedLight.directDiffuse, vec3(0.333333)), 0.0001);
  vec3 lit = pncBaseAlbedo * mix(vec3(1.0), clamp(lightTint, 0.5, 1.6), 0.35);
  if (uShadowSteps > 2.5) {
    vec3 midtone = mix(shadow, lit, 0.55);
    outgoingLight = mix(mix(shadow, midtone, band), lit, smoothstep(0.92-aa, 0.92+aa, irradiance));
  } else outgoingLight = mix(shadow, lit, band);
}`);
    };
    material.needsUpdate = true;
  }
}

export class NormalIdMaterial extends T.ShaderMaterial {
  private ids = new WeakMap<T.Object3D, number>();
  private nextId = 2;
  beginFrame(): void {
    // Only simultaneous IDs need to be unique. Recycle between passes to keep
    // outfit-region bits exact in half floats after long add/delete sessions.
    this.ids = new WeakMap(); this.nextId = 2;
  }
  constructor() {
    super({
      name: 'Studio geometric normal + region ID', side: T.DoubleSide,
      uniforms: { uObjectId: { value: 0 }, uHasMask: { value: false }, uMask: { value: null }, uMaskTransform: { value: new T.Matrix3() } },
      vertexShader: `
#include <common>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>
varying vec3 vViewNormal;
varying vec2 vMaskUv;
uniform mat3 uMaskTransform;
void main() {
  vMaskUv = (uMaskTransform * vec3(uv, 1.0)).xy;
  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  vViewNormal = normalize(normalMatrix * objectNormal);
  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>
}`,
      fragmentShader: `
varying vec3 vViewNormal;
varying vec2 vMaskUv;
uniform float uObjectId;
uniform bool uHasMask;
uniform sampler2D uMask;
void main() {
  float region = uHasMask ? step(0.5, texture2D(uMask, vMaskUv).a) : 0.0;
  gl_FragColor = vec4(normalize(vViewNormal) * (gl_FrontFacing ? 1.0 : -1.0), 2.0 * uObjectId + region);
}`,
    });
    this.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
      let id = object.userData.nprFloor ? 1 : this.ids.get(object);
      if (id === undefined) { id = this.nextId++; this.ids.set(object, id); }
      const mesh = object as T.Mesh;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const map = material instanceof T.MeshStandardMaterial && material.userData.outfitColorUniform ? material.map : null;
      this.uniforms.uObjectId.value = id;
      this.uniforms.uHasMask.value = Boolean(map);
      this.uniforms.uMask.value = map;
      if (map) { map.updateMatrix(); this.uniforms.uMaskTransform.value.copy(map.matrix); }
      this.uniformsNeedUpdate = true;
    };
  }
}

const inkFragment = `
uniform sampler2D tDiffuse, tNormalId, tDepth;
uniform mat4 projectionInverse;
uniform vec2 resolution;
uniform float inkWidth, detail;
uniform vec3 inkColor, paper;
uniform bool outlineOnly, transparentPaper;
varying vec2 vUv;
vec3 positionAt(vec2 uv) {
  vec4 p = projectionInverse * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).x * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
bool horizon(float a, float b) { return (a == 0.0 && b == 2.0) || (a == 2.0 && b == 0.0); }
void main() {
  vec4 center = texture2D(tNormalId, vUv);
  vec3 pc = positionAt(vUv);
  float radius = inkWidth * resolution.y / 900.0;
  radius *= pow(clamp(2.6 / max(abs(pc.z), 0.01), 0.72, 1.28), 0.35);
  vec2 stepUv = vec2(radius) / resolution;
  float depthEdge = 0.0, objectEdge = 0.0, regionEdge = 0.0;
  vec3 gx = vec3(0.0), gy = vec3(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      if (x == 0 && y == 0) continue;
      vec2 offset = vec2(float(x), float(y));
      vec2 uv = clamp(vUv + offset * stepUv, vec2(0.0), vec2(1.0));
      vec4 neighbor = texture2D(tNormalId, uv);
      if (!horizon(center.a, neighbor.a)) {
        if (center.a == 0.0 || neighbor.a == 0.0) {
          if (center.a != neighbor.a) depthEdge = 1.0;
        } else {
          vec3 pn = positionAt(uv);
          bool cNear = abs(pc.z) <= abs(pn.z);
          vec3 nn = cNear ? center.rgb : neighbor.rgb;
          float plane = abs(dot(nn, pn - pc)) / max(cNear ? abs(pc.z) : abs(pn.z), 0.01);
          depthEdge = max(depthEdge, smoothstep(0.022, 0.0352, plane));
          if (floor(center.a / 2.0) != floor(neighbor.a / 2.0)) objectEdge = 1.0;
        }
      }
      vec4 inner = texture2D(tNormalId, clamp(vUv + offset * stepUv * 0.62, vec2(0.0), vec2(1.0)));
      vec3 n = inner.a > 0.0 && center.a > 0.0 && !horizon(center.a, inner.a) ? inner.rgb : center.rgb;
      gx += n * float(x) * (y == 0 ? 2.0 : 1.0);
      gy += n * float(y) * (x == 0 ? 2.0 : 1.0);
      if (center.a > 0.0 && floor(center.a / 2.0) == floor(inner.a / 2.0) && center.a != inner.a) regionEdge = 0.65 * detail;
    }
  }
  float threshold = mix(2.4, 0.75, detail);
  float normalEdge = detail > 0.0 ? 0.82 * smoothstep(threshold, threshold + 0.65, sqrt(dot(gx,gx) + dot(gy,gy))) : 0.0;
  float ink = max(max(depthEdge, objectEdge), max(normalEdge * (1.0-depthEdge), regionEdge));
  vec4 base = texture2D(tDiffuse, vUv);
  gl_FragColor = outlineOnly ? (transparentPaper ? vec4(inkColor, ink) : vec4(mix(paper, inkColor, ink), 1.0)) : vec4(mix(base.rgb, inkColor, ink), base.a);
}`;

export class NprInkPass extends Pass {
  readonly gBuffer = new T.WebGLRenderTarget(1, 1, {
    type: T.HalfFloatType, format: T.RGBAFormat, minFilter: T.NearestFilter, magFilter: T.NearestFilter,
    depthTexture: new T.DepthTexture(1, 1, T.UnsignedIntType),
  });
  readonly normalMaterial = new NormalIdMaterial();
  readonly material = new T.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null }, tNormalId: { value: this.gBuffer.texture }, tDepth: { value: this.gBuffer.depthTexture },
      projectionInverse: { value: new T.Matrix4() }, resolution: { value: new T.Vector2(1, 1) },
      inkWidth: { value: DEFAULT_RENDER_STYLE.inkWidth }, detail: { value: DEFAULT_RENDER_STYLE.interiorDetail },
      inkColor: { value: new T.Color() }, paper: { value: new T.Color() },
      outlineOnly: { value: false }, transparentPaper: { value: false },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: inkFragment, depthTest: false, depthWrite: false,
  });
  private quad = new FullScreenQuad(this.material);
  readonly scene: T.Scene;
  camera: T.Camera;
  constructor(scene: T.Scene, camera: T.Camera) { super(); this.scene = scene; this.camera = camera; }
  update(style: RenderStyleState, background: string): void {
    const u = this.material.uniforms;
    u.inkWidth.value = style.inkWidth; u.detail.value = style.interiorDetail;
    u.inkColor.value.set(style.inkColor); u.paper.value.set(paperColor(style, background));
    u.outlineOnly.value = style.mode === 'outline';
    u.transparentPaper.value = style.outlinePaper === 'transparent';
  }
  setSize(width: number, height: number): void {
    this.gBuffer.setSize(width, height); this.material.uniforms.resolution.value.set(width, height);
  }
  render(renderer: T.WebGLRenderer, writeBuffer: T.WebGLRenderTarget, readBuffer: T.WebGLRenderTarget): void {
    const { scene, camera } = this;
    const override = scene.overrideMaterial, background = scene.background, mask = camera.layers.mask;
    const clearColor = renderer.getClearColor(new T.Color()), clearAlpha = renderer.getClearAlpha();
    const target = renderer.getRenderTarget();
    try {
      this.normalMaterial.beginFrame();
      camera.layers.set(STAGE_LAYER); scene.background = null; scene.overrideMaterial = this.normalMaterial;
      renderer.setRenderTarget(this.gBuffer); renderer.setClearColor(0x000000, 0); renderer.clear();
      renderer.render(scene, camera);
    } finally {
      scene.overrideMaterial = override; scene.background = background; camera.layers.mask = mask;
      renderer.setClearColor(clearColor, clearAlpha); renderer.setRenderTarget(target);
    }
    this.material.uniforms.projectionInverse.value.copy(camera.projectionMatrixInverse);
    this.material.uniforms.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }
  dispose(): void { this.gBuffer.dispose(); this.normalMaterial.dispose(); this.material.dispose(); this.quad.dispose(); }
}
