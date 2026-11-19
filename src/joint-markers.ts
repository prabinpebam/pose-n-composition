import * as T from 'three';

interface Viewport { left: number; top: number; width: number; height: number }
const visibleRadius = 5;
const hitRadius = 10;

export function pickJointMarker<M extends T.Object3D>(
  markers: readonly M[], camera: T.PerspectiveCamera, viewport: Viewport, x: number, y: number,
): M | null {
  let closest: M | null = null, distance = Infinity, depth = Infinity;
  for (const marker of markers) {
    let visible = true;
    for (let node: T.Object3D | null = marker; node; node = node.parent) if (!node.visible) visible = false;
    if (!visible) continue;
    const point = marker.getWorldPosition(new T.Vector3()).project(camera);
    if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
    const dx = viewport.left + (point.x + 1) * viewport.width / 2 - x;
    const dy = viewport.top + (1 - point.y) * viewport.height / 2 - y;
    const d = dx * dx + dy * dy;
    if (d <= hitRadius * hitRadius && (d < distance || (d === distance && point.z < depth))) {
      closest = marker; distance = d; depth = point.z;
    }
  }
  return closest;
}

export function sizeJointMarker(marker: T.Mesh<T.SphereGeometry>, camera: T.PerspectiveCamera, height: number): void {
  const depth = -marker.getWorldPosition(new T.Vector3()).applyMatrix4(camera.matrixWorldInverse).z;
  if (depth <= 0) return;
  const radius = visibleRadius * 2 * depth * Math.tan(T.MathUtils.degToRad(camera.fov / 2)) / (camera.zoom * height);
  const parentScale = marker.parent?.getWorldScale(new T.Vector3()) ?? new T.Vector3(1, 1, 1);
  marker.scale.set(1 / parentScale.x, 1 / parentScale.y, 1 / parentScale.z).multiplyScalar(radius / marker.geometry.parameters.radius);
}
