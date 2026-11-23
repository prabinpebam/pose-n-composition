import { afterEach, describe, expect, it, vi } from 'vitest';
import * as T from 'three';
import {
  applyLightShadowQuality,
  computeCalibratedShadowBias,
  computeMultiBounceAo,
  computeSceneCasterBounds,
  extractSurfaceAlbedo,
  fitDirectionalShadowFrustum,
  fitSpotShadowFrustum,
  installPcssSoftShadows,
  isPcssSoftShadowsInstalled,
  RealtimeGiController,
  ShadowCacheController,
  shouldApplyStudioAo,
  StudioPostGiPipeline,
  uninstallPcssSoftShadows,
} from './index';

function assertBoxInsideShadowCameraFrustum(box: T.Box3, shadowCam: T.Camera): void {
  shadowCam.updateMatrixWorld(true);
  if ((shadowCam as T.PerspectiveCamera).isPerspectiveCamera || (shadowCam as T.OrthographicCamera).isOrthographicCamera) {
    (shadowCam as T.PerspectiveCamera | T.OrthographicCamera).updateProjectionMatrix();
  }
  const viewProj = new T.Matrix4().multiplyMatrices(
    shadowCam.projectionMatrix,
    shadowCam.matrixWorldInverse,
  );

  const corners = [
    new T.Vector3(box.min.x, box.min.y, box.min.z),
    new T.Vector3(box.min.x, box.min.y, box.max.z),
    new T.Vector3(box.min.x, box.max.y, box.min.z),
    new T.Vector3(box.min.x, box.max.y, box.max.z),
    new T.Vector3(box.max.x, box.min.y, box.min.z),
    new T.Vector3(box.max.x, box.min.y, box.max.z),
    new T.Vector3(box.max.x, box.max.y, box.min.z),
    new T.Vector3(box.max.x, box.max.y, box.max.z),
  ];

  for (const corner of corners) {
    const ndc = corner.clone().applyMatrix4(viewProj);
    expect(ndc.x).toBeGreaterThanOrEqual(-1.0001);
    expect(ndc.x).toBeLessThanOrEqual(1.0001);
    expect(ndc.y).toBeGreaterThanOrEqual(-1.0001);
    expect(ndc.y).toBeLessThanOrEqual(1.0001);
    expect(ndc.z).toBeGreaterThanOrEqual(-1.0001);
    expect(ndc.z).toBeLessThanOrEqual(1.0001);
  }
}

describe('Shadow System (`src/rendering/shadowSystem.ts`)', () => {
  afterEach(() => {
    uninstallPcssSoftShadows();
  });

  it('computes tight caster bounds around posed figures & props while ignoring 200m floor and HELPER_LAYER gizmos', () => {
    const scene = new T.Scene();

    // 200m x 200m studio floor (even if accidentally marked castShadow=true, horizontal span filter skips it)
    const floor = new T.Mesh(new T.PlaneGeometry(200, 200), new T.MeshStandardMaterial());
    floor.rotation.x = -Math.PI / 2;
    floor.castShadow = true;
    floor.receiveShadow = true;
    scene.add(floor);

    // Posed SkinnedMesh character (~1.72m tall with outstretched arm)
    const rootBone = new T.Bone();
    rootBone.position.set(0, 0.95, 0);
    const headBone = new T.Bone();
    headBone.position.set(0, 0.72, 0);
    const handBone = new T.Bone();
    handBone.position.set(0.75, 0.35, 0.15);
    rootBone.add(headBone);
    rootBone.add(handBone);
    scene.add(rootBone);

    const skeleton = new T.Skeleton([rootBone, headBone, handBone]);
    const skinMesh = new T.SkinnedMesh(new T.BoxGeometry(0.4, 1.7, 0.25), new T.MeshStandardMaterial());
    skinMesh.castShadow = true;
    skinMesh.bind(skeleton);
    scene.add(skinMesh);

    // Helper gizmo far away on HELPER_LAYER = 1 (must NOT bloat shadow frustum!)
    const gizmoSphere = new T.Mesh(new T.SphereGeometry(0.5), new T.MeshBasicMaterial());
    gizmoSphere.position.set(45, 30, -40);
    gizmoSphere.castShadow = true;
    gizmoSphere.layers.set(1);
    scene.add(gizmoSphere);

    scene.updateMatrixWorld(true);
    const bounds = computeSceneCasterBounds(scene, { stageLayer: 0 });

    const size = bounds.getSize(new T.Vector3());
    expect(size.x).toBeLessThan(3.0);
    expect(size.z).toBeLessThan(3.0);
    // Outstretched hand at world (0.75, 1.30, 0.15) is strictly enclosed
    expect(bounds.containsPoint(new T.Vector3(0.75, 1.3, 0.15))).toBe(true);
    // Distant helper gizmo was ignored
    expect(bounds.containsPoint(new T.Vector3(45, 30, -40))).toBe(false);
  });

  it('fits DirectionalLight ortho shadow bounds tightly (>= 4x texelsPerMeter vs static ±12m) and never clips casters', () => {
    const scene = new T.Scene();
    const characterProxy = new T.Mesh(new T.BoxGeometry(0.55, 1.72, 0.35), new T.MeshStandardMaterial());
    characterProxy.position.set(-0.35, 0.86, 0.1);
    characterProxy.castShadow = true;
    scene.add(characterProxy);

    const dirLight = new T.DirectionalLight('#ffffff', 2.6);
    dirLight.position.set(4, 7, 4);
    dirLight.target.position.set(0, 0.9, 0);
    dirLight.castShadow = true;
    scene.add(dirLight);
    scene.add(dirLight.target);

    applyLightShadowQuality(dirLight, 'balanced'); // 2048x2048
    const static12mTexelsPerMeter = dirLight.shadow.mapSize.x / 24; // ±12m -> 24m span

    const casterBounds = computeSceneCasterBounds(scene);
    const fit = fitDirectionalShadowFrustum(dirLight, casterBounds, { receiverFloorY: 0 });

    // Effective texels/meter increases well over 4x compared to static ±12m
    expect(fit.texelsPerMeter).toBeGreaterThanOrEqual(static12mTexelsPerMeter * 4);
    expect(fit.normalBias).toBeGreaterThan(0);
    expect(fit.bias).toBeLessThan(0);

    // Sync shadow camera view matrix asLightShadow.updateMatrices does and assert zero caster clipping
    dirLight.shadow.camera.position.copy(dirLight.position);
    dirLight.shadow.camera.lookAt(dirLight.target.position);
    assertBoxInsideShadowCameraFrustum(casterBounds, dirLight.shadow.camera);
  });

  it('fits SpotLight shadow cone via shadow.focus (>= 4x texelsPerMeter vs 120° cone) without clipping casters or narrowing light.angle', () => {
    const scene = new T.Scene();
    const maleProxy = new T.Mesh(new T.BoxGeometry(0.5, 1.75, 0.3), new T.MeshStandardMaterial());
    maleProxy.position.set(-0.5, 0.875, 0);
    maleProxy.castShadow = true;
    const femaleProxy = new T.Mesh(new T.BoxGeometry(0.48, 1.66, 0.28), new T.MeshStandardMaterial());
    femaleProxy.position.set(0.55, 0.83, 0.05);
    femaleProxy.castShadow = true;
    scene.add(maleProxy, femaleProxy);

    // Default studio spotlight from model.ts: pos [3, 5, 3] -> target [0, 1, 0], half-angle 60° (120° FOV)
    const spot = new T.SpotLight('#fff6eb', 60, 70, T.MathUtils.degToRad(60), 0.35, 2);
    spot.position.set(3, 5, 3);
    spot.target.position.set(0, 1, 0);
    spot.castShadow = true;
    scene.add(spot, spot.target);

    applyLightShadowQuality(spot, 'balanced'); // 2048x2048
    const casterBounds = computeSceneCasterBounds(scene);
    const centerDist = spot.position.distanceTo(casterBounds.getCenter(new T.Vector3()));
    const unfocusedWidth = 2 * centerDist * Math.tan(spot.angle);
    const unfocusedTexelsPerMeter = spot.shadow.mapSize.x / unfocusedWidth;

    const fit = fitSpotShadowFrustum(spot, casterBounds);

    // Visual spotlight cone angle stays untouched at 60°
    expect(spot.angle).toBeCloseTo(T.MathUtils.degToRad(60), 5);
    expect(fit.focus).toBeLessThan(0.4);
    expect(fit.texelsPerMeter).toBeGreaterThanOrEqual(unfocusedTexelsPerMeter * 4);
    expect(fit.near).toBeGreaterThan(1.5); // Tightened from default 0.5m -> better depth precision

    spot.shadow.camera.position.copy(spot.position);
    spot.shadow.camera.lookAt(spot.target.position);
    assertBoxInsideShadowCameraFrustum(casterBounds, spot.shadow.camera);
  });

  it('disposes and nulls stale shadow.map render targets when switching quality tiers', () => {
    const spot = new T.SpotLight('#ffffff', 50);
    spot.castShadow = true;
    applyLightShadowQuality(spot, 'performance');
    expect(spot.shadow.mapSize.x).toBe(1024);

    const disposeSpy = vi.fn();
    spot.shadow.map = {
      width: 1024,
      height: 1024,
      dispose: disposeSpy,
    } as unknown as T.WebGLRenderTarget;

    applyLightShadowQuality(spot, 'ultra', 2.8);
    expect(spot.shadow.mapSize.x).toBe(4096);
    expect(disposeSpy).toHaveBeenCalledTimes(1);
    expect(spot.shadow.map).toBeNull();
    expect(spot.shadow.radius).toBeCloseTo(2.8, 5);

    const bias = computeCalibratedShadowBias(0.002, 'spot');
    expect(bias.normalBias).toBeGreaterThan(0.0015);
    expect(bias.bias).toBeLessThan(0);
  });

  it('installs and uninstalls PCSS + IGN Vogel soft shadow GLSL chunk cleanly', () => {
    expect(isPcssSoftShadowsInstalled()).toBe(false);
    expect(installPcssSoftShadows('balanced')).toBe(true);
    expect(isPcssSoftShadowsInstalled()).toBe(true);
    expect(T.ShaderChunk.shadowmap_pars_fragment).toContain('studioPcssShadow');
    expect(T.ShaderChunk.shadowmap_pars_fragment).toContain('studioFindBlockerDepth');
    // Idempotent second call at same tier returns false
    expect(installPcssSoftShadows('balanced')).toBe(false);

    uninstallPcssSoftShadows();
    expect(isPcssSoftShadowsInstalled()).toBe(false);
  });

  it('ShadowCacheController triggers shadow render on dirty mutations and skips redundant updates on idle frames', () => {
    const cache = new ShadowCacheController();
    const mockRenderer = {
      shadowMap: {
        enabled: true,
        autoUpdate: true,
        needsUpdate: false,
      },
    };
    const keyLight = new T.SpotLight('#ffffff', 60);
    keyLight.castShadow = true;

    // Frame 1 (initial dirty): updates shadow map once and disables autoUpdate
    expect(cache.beginFrame(mockRenderer, [keyLight])).toBe(true);
    expect(mockRenderer.shadowMap.autoUpdate).toBe(false);
    expect(mockRenderer.shadowMap.needsUpdate).toBe(true);
    expect(keyLight.shadow.needsUpdate).toBe(true);

    // Frame 2 & 3 (idle / camera orbit only): zero shadow map updates
    cache.syncStateSignature('pose-v1|lights-v1');
    expect(cache.beginFrame(mockRenderer, [keyLight])).toBe(true); // signature changed from '' -> 'pose-v1|lights-v1'
    expect(cache.syncStateSignature('pose-v1|lights-v1')).toBe(false);
    expect(cache.beginFrame(mockRenderer, [keyLight])).toBe(false);
    expect(mockRenderer.shadowMap.needsUpdate).toBe(false);
    expect(keyLight.shadow.needsUpdate).toBe(false);

    // Frame 4: pose joint rotated -> marks dirty for 1 frame, then settles back to 0 updates
    cache.markDirty('pose-drag');
    expect(cache.isDirty()).toBe(true);
    expect(cache.beginFrame(mockRenderer, [keyLight])).toBe(true);
    expect(mockRenderer.shadowMap.needsUpdate).toBe(true);

    expect(cache.beginFrame(mockRenderer, [keyLight])).toBe(false);
    expect(cache.getStats().renderedShadowPasses).toBe(3);
    expect(cache.getStats().skippedShadowFrames).toBe(2);
  });
});

describe('Real-Time Global Illumination (`src/rendering/globalIllumination.ts`)', () => {
  it('produces physically tinted colored bounce light matching hit wall/texture albedo (true color bleeding)', () => {
    const gi = new RealtimeGiController({ quality: 'balanced', giIntensity: 1.2, smoothing: 1.0 });

    // Vertical wall at z = -1.5 facing +Z toward a character standing at (0, 1.2, 0)
    const wallMaterial = new T.MeshStandardMaterial({ color: '#e61e1e', roughness: 0.85 });
    const redWall = new T.Mesh(new T.PlaneGeometry(6, 4), wallMaterial);
    redWall.position.set(0, 1.5, -1.5);
    redWall.updateMatrixWorld(true);

    // White spotlight shining onto the red wall
    const spot = new T.SpotLight('#ffffff', 80, 30, T.MathUtils.degToRad(40), 0.3, 2);
    spot.position.set(0, 1.6, 1.5);
    spot.target.position.set(0, 1.5, -1.5);

    const statsRed = gi.update({
      lights: [spot],
      bounceTargets: [redWall],
      sceneLightsOnly: true,
      immediate: true,
    });

    expect(statsRed.rayHits).toBeGreaterThan(0);
    expect(statsRed.activeVplCount).toBeGreaterThan(0);
    expect(statsRed.totalVplIntensity).toBeGreaterThan(0);

    // Character back facing the wall at (0, 1.4, -0.4) with normal (0, 0, -1) receives warm red-dominant bounce!
    const subjectPos = new T.Vector3(0, 1.4, -0.4);
    const subjectBackNormal = new T.Vector3(0, 0, -1);
    const redIrradiance = gi.evaluateBounceIrradianceAt(subjectPos, subjectBackNormal);

    expect(redIrradiance.r).toBeGreaterThan(0.05);
    expect(redIrradiance.r).toBeGreaterThan(redIrradiance.g * 5);
    expect(redIrradiance.r).toBeGreaterThan(redIrradiance.b * 5);

    // Repaint wall deep cobalt blue -> bounce light immediately shifts to blue-dominant
    wallMaterial.color.set('#1858e8');
    gi.update({
      lights: [spot],
      bounceTargets: [redWall],
      sceneLightsOnly: true,
      immediate: true,
    });
    const blueIrradiance = gi.evaluateBounceIrradianceAt(subjectPos, subjectBackNormal);
    expect(blueIrradiance.b).toBeGreaterThan(blueIrradiance.r * 5);

    // Verify CPU DataTexture sampling in extractSurfaceAlbedo modulates white material color
    const texBytes = new Uint8Array([30, 220, 45, 255]);
    const greenTex = new T.DataTexture(texBytes, 1, 1, T.RGBAFormat);
    greenTex.colorSpace = T.SRGBColorSpace;
    const texturedMat = new T.MeshStandardMaterial({ color: '#ffffff', map: greenTex });
    const texturedWall = new T.Mesh(new T.PlaneGeometry(4, 4), texturedMat);
    const mockHit: T.Intersection = {
      distance: 2,
      point: new T.Vector3(0, 1, -1.5),
      object: texturedWall,
      uv: new T.Vector2(0.5, 0.5),
    };
    const sampledAlbedo = extractSurfaceAlbedo(mockHit);
    expect(sampledAlbedo.g).toBeGreaterThan(sampledAlbedo.r * 4);
    expect(sampledAlbedo.g).toBeGreaterThan(sampledAlbedo.b * 4);

    gi.dispose();
  });

  it('strictly enforces sceneLightsOnly dark-room invariant: exact 0 GI bounce & 0 hemisphere when 0 scene lights are active', () => {
    const gi = new RealtimeGiController({
      quality: 'ultra',
      giIntensity: 1.5,
      smoothing: 0.25, // Even with slow temporal smoothing enabled, 0 lights must extinguish immediately!
      studioSkyBounceIntensity: 0.5,
    });

    const floor = new T.Mesh(
      new T.PlaneGeometry(10, 10),
      new T.MeshStandardMaterial({ color: '#d8a878' }),
    );
    floor.rotation.x = -Math.PI / 2;

    const spot = new T.SpotLight('#ffffff', 90, 40, T.MathUtils.degToRad(45), 0.3, 2);
    spot.position.set(2, 4, 2);
    spot.target.position.set(0, 0, 0);

    // 1. First light up the room so GI history has active VPLs + hemisphere energy
    const litDiag = gi.update({
      lights: [spot],
      bounceTargets: [floor],
      sceneLightsOnly: true,
    });
    expect(litDiag.totalVplIntensity).toBeGreaterThan(0);
    expect(litDiag.bounceHemiIntensity).toBeGreaterThan(0);

    // 2. Hide scene light while `sceneLightsOnly === true` -> ALL bounce lights & hemisphere MUST be exact 0!
    spot.visible = false;
    const darkHiddenDiag = gi.update({
      lights: [spot],
      bounceTargets: [floor],
      sceneLightsOnly: true,
    });
    expect(darkHiddenDiag.activeVplCount).toBe(0);
    expect(darkHiddenDiag.totalVplIntensity).toBe(0);
    expect(darkHiddenDiag.bounceHemiIntensity).toBe(0);
    expect(gi.bounceHemi.intensity).toBe(0);
    expect(gi.bounceHemi.visible).toBe(false);
    for (const vpl of gi.vplLights) {
      expect(vpl.intensity).toBe(0);
      expect(vpl.visible).toBe(false);
    }

    const darkSample = gi.evaluateBounceIrradianceAt(new T.Vector3(0, 1, 0), new T.Vector3(0, -1, 0));
    expect(darkSample.r).toBe(0);
    expect(darkSample.g).toBe(0);
    expect(darkSample.b).toBe(0);

    // 3. Same check when light is visible but intensity === 0 or lights array is empty
    spot.visible = true;
    spot.intensity = 0;
    const darkZeroIntensityDiag = gi.update({
      lights: [spot],
      bounceTargets: [floor],
      sceneLightsOnly: true,
    });
    expect(darkZeroIntensityDiag.totalVplIntensity).toBe(0);
    expect(darkZeroIntensityDiag.bounceHemiIntensity).toBe(0);

    // 4. When `sceneLightsOnly === false`, studio sky bounce is permitted to softly bounce off the warm floor
    const studioSkyDiag = gi.update({
      lights: [],
      bounceTargets: [floor],
      sceneLightsOnly: false,
    });
    expect(studioSkyDiag.totalVplIntensity).toBeGreaterThan(0);

    gi.dispose();
  });

  it('configures StudioPostGiPipeline AO tiers, NPR mode bypass, STAGE_LAYER isolation, and leak-free disposal', () => {
    // Jimenez Multi-Bounce AO keeps 0 -> 0 and 1 -> 1 exact while warming mid-tone skin crevices
    const skinAlbedo = new T.Color(0.82, 0.52, 0.42);
    expect(computeMultiBounceAo(0, skinAlbedo).toArray()).toEqual([0, 0, 0]);
    expect(computeMultiBounceAo(1, skinAlbedo).toArray()).toEqual([1, 1, 1]);
    const midCrease = computeMultiBounceAo(0.5, skinAlbedo);
    expect(midCrease.r).toBeGreaterThan(0.5);
    expect(midCrease.r).toBeGreaterThan(midCrease.b);

    // Mode gating
    expect(shouldApplyStudioAo('realistic', 'balanced', true)).toBe(true);
    expect(shouldApplyStudioAo('clay', 'ultra', true)).toBe(true);
    expect(shouldApplyStudioAo('flat', 'ultra', true)).toBe(false);
    expect(shouldApplyStudioAo('outline', 'balanced', true)).toBe(false);
    expect(shouldApplyStudioAo('realistic', 'performance', true)).toBe(false);

    const scene = new T.Scene();
    const camera = new T.PerspectiveCamera(50, 16 / 9, 0.1, 100);
    camera.layers.enableAll(); // both STAGE_LAYER (0) and HELPER_LAYER (1) enabled on viewport camera

    const postGi = new StudioPostGiPipeline(scene, camera, {
      width: 1200,
      height: 800,
      quality: 'balanced',
      aoIntensity: 1.1,
    });

    // Balanced uses 0.5x half-resolution GTAO targets (600 x 400)
    expect(postGi.enabled).toBe(true);
    expect(postGi.gtaoPass.width).toBe(600);
    expect(postGi.gtaoPass.height).toBe(400);

    // Switching to Ultra scales GTAO to 1.0x full resolution (1200 x 800)
    postGi.setQuality('ultra');
    expect(postGi.gtaoPass.width).toBe(1200);
    expect(postGi.gtaoPass.height).toBe(800);

    // Switching to Flat NPR mode automatically disables the pass
    postGi.setRenderMode('flat');
    expect(postGi.enabled).toBe(false);
    postGi.setRenderMode('realistic');
    expect(postGi.enabled).toBe(true);

    const blendDisposeSpy = vi.spyOn(postGi.gtaoPass.blendMaterial, 'dispose');
    const depthDisposeSpy = vi.spyOn(postGi.gtaoPass.depthTexture, 'dispose');
    postGi.dispose();
    expect(blendDisposeSpy).toHaveBeenCalledTimes(1);
    expect(depthDisposeSpy).toHaveBeenCalledTimes(1);
  });
});
