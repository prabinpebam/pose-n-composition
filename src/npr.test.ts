import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { configureSkinAndOutfitMaterial } from './external-rig';
import { DEFAULT_RENDER_STYLE, initialScene, validatePortable, type RenderStyleState } from './model';
import { NprInkPass, StudioShadingController, setLayerRecursive } from './npr';

describe('studio shading', () => {
  it('chains the body outfit hook once and switches live shared uniforms without recompilation', () => {
    const material = new T.MeshStandardMaterial();
    const outfit = configureSkinAndOutfitMaterial(material, '#ffdecc', '#e63946');
    const controller = new StudioShadingController();
    controller.attachStudioShading(material);
    const key = material.customProgramCacheKey();
    controller.attachStudioShading(material);
    expect(material.customProgramCacheKey()).toBe(key);
    const shader = {
      uniforms: {}, vertexShader: T.ShaderLib.standard.vertexShader,
      fragmentShader: T.ShaderLib.standard.fragmentShader,
    } as T.WebGLProgramParametersWithUniforms;
    material.onBeforeCompile(shader, {} as T.WebGLRenderer);
    expect(shader.uniforms).toHaveProperty('uOutfitColor', outfit);
    expect(shader.uniforms).toHaveProperty('uShadeMode', controller.uniforms.uShadeMode);
    expect(shader.fragmentShader).toContain('pncRegionTint');
    expect(shader.fragmentShader).toContain('reflectedLight.directDiffuse');
    expect(shader.fragmentShader).toContain('fwidth(irradiance)');
    controller.update({ ...DEFAULT_RENDER_STYLE, mode: 'illustration', shadowSteps: 3 }, '#343231');
    expect(controller.uniforms.uShadeMode.value).toBe(1);
    expect(controller.uniforms.uShadowSteps.value).toBe(3);
    expect(material.customProgramCacheKey()).toBe(key);
  });
  it('hydrates legacy scenes and rejects malformed present settings', () => {
    const scene = initialScene();
    delete scene.renderStyle;
    const parsed = validatePortable(scene);
    expect(parsed).toHaveProperty('renderStyle', DEFAULT_RENDER_STYLE);
    for (const patch of [{ inkWidth: 0 }, { interiorDetail: 2 }, { shadowSteps: 4 }, { outlinePaper: 'bad' }, { inkColor: 'red' }, { clayOutlines: 'yes' }]) {
      expect(() => validatePortable({ ...scene, renderStyle: patch })).toThrow('Invalid file');
    }
    for (const mode of ['realistic', 'illustration', 'outline', 'clay', 'flat'] as const) {
      const style: RenderStyleState = { ...DEFAULT_RENDER_STYLE, mode, outlinePaper: 'transparent' };
      expect(validatePortable({ ...scene, renderStyle: style })).toHaveProperty('renderStyle', style);
    }
  });
  it('isolates nested helper children and configures a floating point depth/normal pass', () => {
    const parent = new T.Group(), child = new T.Mesh(new T.SphereGeometry(), new T.MeshBasicMaterial());
    parent.add(child); setLayerRecursive(parent, 1);
    expect(child.layers.test(new T.Layers())).toBe(false);
    const pass = new NprInkPass(new T.Scene(), new T.PerspectiveCamera());
    pass.setSize(1600, 1000);
    pass.update({ ...DEFAULT_RENDER_STYLE, mode: 'outline', outlinePaper: 'transparent' }, '#343231');
    expect(pass.gBuffer.width).toBe(1600);
    expect(pass.gBuffer.texture.type).toBe(T.HalfFloatType);
    expect(pass.gBuffer.depthTexture).toBeInstanceOf(T.DepthTexture);
    expect(pass.material.uniforms.transparentPaper.value).toBe(true);
    expect(pass.material.uniforms.outlineOnly.value).toBe(true);
    expect(pass.normalMaterial.fragmentShader).not.toContain('normalMap');
    pass.dispose(); child.geometry.dispose(); child.material.dispose();
  });
});
