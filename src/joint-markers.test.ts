import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { pickJointMarker, sizeJointMarker } from './joint-markers';

const viewport = { left: 220, top: 119, width: 900, height: 800 };
function fixture() {
  const camera = new T.PerspectiveCamera(42, viewport.width / viewport.height, 0.02, 500);
  camera.position.z = 5; camera.updateMatrixWorld(true);
  const parent = new T.Group();
  const marker = new T.Mesh(new T.SphereGeometry(0.022), new T.MeshBasicMaterial({ depthTest: false }));
  parent.add(marker); parent.updateMatrixWorld(true);
  return { camera, parent, marker };
}
describe('viewport joint targets', () => {
  it('picks the visible overlay node behind skin, including a forgiving screen-space edge', () => {
    const { camera, parent, marker } = fixture();
    const skin = new T.Mesh(new T.BoxGeometry(1, 1, 1), new T.MeshBasicMaterial());
    parent.add(skin); skin.position.z = 0.5; parent.updateMatrixWorld(true);
    const ray = new T.Raycaster(camera.position, new T.Vector3(0, 0, -1));
    expect(ray.intersectObject(parent, true)[0].object).toBe(skin);
    expect(pickJointMarker([marker], camera, viewport, 679, 519)).toBe(marker);
    expect(pickJointMarker([marker], camera, viewport, 681, 519)).toBeNull();
  });
  it('chooses the closest screen target and rejects hidden, behind-camera and clipped nodes', () => {
    const { camera, parent, marker } = fixture(), nearby = marker.clone();
    nearby.position.x = 0.08; parent.add(nearby); parent.updateMatrixWorld(true);
    expect(pickJointMarker([nearby, marker], camera, viewport, 670, 519)).toBe(marker);
    marker.visible = false;
    expect(pickJointMarker([marker], camera, viewport, 670, 519)).toBeNull();
    marker.visible = true; parent.visible = false;
    expect(pickJointMarker([marker], camera, viewport, 670, 519)).toBeNull();
    parent.visible = true; marker.position.z = 6;
    expect(pickJointMarker([marker], camera, viewport, 670, 519)).toBeNull();
    marker.position.set(100, 0, 0);
    expect(pickJointMarker([marker], camera, viewport, 670, 519)).toBeNull();
  });
  it('keeps nodes five CSS pixels in radius across zoom, distance and root scale', () => {
    const { camera, parent, marker } = fixture();
    for (const [distance, scale, zoom] of [[5, 1, 1], [20, 3, 1], [2, 0.1, 2]]) {
      camera.position.z = distance; camera.zoom = zoom; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      parent.scale.set(scale, scale * 2, scale); parent.updateMatrixWorld(true);
      sizeJointMarker(marker, camera, viewport.height); parent.updateMatrixWorld(true);
      const center = marker.getWorldPosition(new T.Vector3()).project(camera);
      const edge = marker.localToWorld(new T.Vector3(0.022, 0, 0)).project(camera);
      expect((edge.x - center.x) * viewport.width / 2).toBeCloseTo(5, 6);
      expect(pickJointMarker([marker], camera, viewport, 679, 519)).toBe(marker);
    }
  });
});
