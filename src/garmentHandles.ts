import * as T from 'three';
import { garmentFitLimit, type Garment, type Vec3 } from './model';
import { HELPER_LAYER } from './npr';

export interface FitSelection {
  itemId: string;
  garment: Garment;
  node: string | null;
}

export class GarmentHandles extends T.Group {
  private edge = new T.OctahedronGeometry(1);
  private surface = new T.SphereGeometry(1, 12, 8);
  private materials = new Map<string,T.MeshBasicMaterial>();

  sync(nodes: {id:string; kind:'edge'|'surface'; world:T.Vector3; normal?:T.Vector3}[], selection: FitSelection,
    offsets: Record<string,Vec3> | undefined) {
    if (nodes.length !== this.children.length || nodes.some((n,i) => this.children[i].userData.node !== n.id)) this.clear();
    const style = getComputedStyle(document.documentElement);
    nodes.forEach((n,i) => {
      const active = selection.node === n.id, offset = offsets?.[n.id];
      const limit = offset && Math.hypot(...offset) >= garmentFitLimit(selection.garment)-1e-6;
      const token = limit ? '--cp-warning' : active ? '--cp-accent' : offset ? '--cp-success' : '--cp-surface';
      let material = this.materials.get(token);
      if (!material) {
        material = new T.MeshBasicMaterial({toneMapped:false, depthTest:false, depthWrite:false});
        this.materials.set(token,material);
      }
      material.color.setStyle(style.getPropertyValue(token).trim());
      let mesh = this.children[i] as T.Mesh | undefined;
      if (!mesh) {
        mesh = new T.Mesh(n.kind === 'edge' ? this.edge : this.surface,material);
        mesh.userData = {node:n.id,kind:n.kind};
        mesh.renderOrder = 19;
        mesh.layers.set(HELPER_LAYER);
        this.add(mesh);
      }
      mesh.material = material;
      mesh.userData.selected = active;
      mesh.userData.normal = n.normal;
      mesh.position.copy(n.world);
    });
    this.updateMatrixWorld(true);
  }

  sizeFor(camera: T.PerspectiveCamera, height: number) {
    const perPixel = 2*Math.tan(T.MathUtils.degToRad(camera.getEffectiveFOV()/2))/Math.max(1,height);
    const view = new T.Vector3();
    for (const handle of this.children) {
      const z = -view.copy(handle.position).applyMatrix4(camera.matrixWorldInverse).z;
      handle.scale.setScalar(Math.max(.0005, z*perPixel*(handle.userData.selected ? 6.5 : 4.5)));
      // Ignore covering layers, not the far side of the garment being edited.
      handle.visible = handle.userData.selected || !handle.userData.normal ||
        handle.userData.normal.dot(view.subVectors(camera.position,handle.position).normalize()) > -.10;
    }
    this.updateMatrixWorld(true);
  }

  dispose() {
    this.clear();
    this.edge.dispose(); this.surface.dispose();
    for (const material of this.materials.values()) material.dispose();
  }
}
