import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type PropKind = 'lamp' | 'table' | 'chair' | 'desk' | 'couch' | 'bed' | 'room';

export function makeProp(kind: PropKind, color: string): T.Group {
  const root = new T.Group();
  root.name = kind;
  const body = new T.MeshStandardMaterial({ color, roughness: 0.78 });
  const dark = new T.MeshStandardMaterial({ color: '#353a40', roughness: 0.65, metalness: 0.25 });
  const pale = new T.MeshStandardMaterial({ color: '#e9e3d7', roughness: 0.95 });
  const mesh = (name: string, geometry: T.BufferGeometry, material: T.MeshStandardMaterial,
    position: [number, number, number], fixedColor = false) => {
    const part = new T.Mesh(geometry, material);
    part.name = name;
    part.position.set(...position);
    part.castShadow = true;
    part.receiveShadow = true;
    if (fixedColor) part.userData.fixedColor = true;
    root.add(part);
    return part;
  };
  const box = (name: string, size: [number, number, number], position: [number, number, number],
    material = body, fixedColor = false, radius = 0) =>
    mesh(name, radius > 0
      ? new RoundedBoxGeometry(...size, 3, radius)
      : new T.BoxGeometry(...size), material, position, fixedColor);
  const cylinder = (name: string, radius: number, height: number, position: [number, number, number],
    material = dark, fixedColor = true) =>
    mesh(name, new T.CylinderGeometry(radius, radius, height, 20), material, position, fixedColor);
  const legs = (width: number, depth: number, height: number, thickness: number, material = dark) => {
    for (const x of [-width / 2, width / 2]) {
      for (const z of [-depth / 2, depth / 2]) {
        box('leg', [thickness, height, thickness], [x, height / 2, z], material, material !== body);
      }
    }
  };

  switch (kind) {
    case 'lamp': {
      cylinder('weighted base', 0.2, 0.05, [0, 0.025, 0], body, false);
      cylinder('stem', 0.018, 1.24, [0, 0.67, 0]);
      const shade = body.clone();
      shade.side = T.DoubleSide;
      mesh('open lampshade', new T.CylinderGeometry(0.13, 0.25, 0.36, 32, 1, true),
        shade, [0, 1.42, 0]);
      mesh('bulb', new T.SphereGeometry(0.055, 16, 12), pale, [0, 1.35, 0], true);
      for (const [radius, y] of [[0.25, 1.24], [0.13, 1.6]]) {
        const rim = mesh('shade rim', new T.TorusGeometry(radius, 0.006, 6, 32),
          dark, [0, y, 0], true);
        rim.rotation.x = Math.PI / 2;
      }
      break;
    }
    case 'table':
      box('tabletop', [1.5, 0.07, 0.86], [0, 0.725, 0], body, false, 0.018);
      legs(1.3, 0.66, 0.69, 0.065);
      box('front apron', [1.3, 0.1, 0.035], [0, 0.64, 0.3]);
      box('back apron', [1.3, 0.1, 0.035], [0, 0.64, -0.3]);
      break;
    case 'chair':
      legs(0.4, 0.4, 0.4, 0.045);
      box('seat', [0.52, 0.07, 0.54], [0, 0.435, 0], body, false, 0.025);
      for (const x of [-0.2, 0.2]) {
        box('back support', [0.04, 0.64, 0.04], [x, 0.7, -0.22], dark, true);
      }
      box('backrest', [0.48, 0.4, 0.065], [0, 0.81, -0.22], body, false, 0.025);
      break;
    case 'desk':
      box('desktop', [1.5, 0.065, 0.72], [0, 0.7275, 0], body, false, 0.015);
      box('drawer carcass', [0.38, 0.69, 0.62], [-0.49, 0.345, 0], dark, true);
      for (const y of [0.13, 0.345, 0.56]) {
        box('drawer front', [0.35, 0.19, 0.025], [-0.49, y, 0.325]);
        box('drawer handle', [0.12, 0.015, 0.025], [-0.49, y + 0.035, 0.35], dark, true);
      }
      for (const z of [-0.28, 0.28]) {
        box('desk leg', [0.055, 0.695, 0.055], [0.6, 0.3475, z], dark, true);
      }
      box('modesty panel', [0.9, 0.25, 0.035], [0.14, 0.55, -0.28]);
      break;
    case 'couch':
      legs(1.5, 0.56, 0.12, 0.07);
      box('sofa base', [1.82, 0.2, 0.8], [0, 0.22, 0], body, false, 0.045);
      box('sofa back', [1.86, 0.55, 0.17], [0, 0.645, -0.33], body, false, 0.05);
      for (const x of [-0.86, 0.86]) {
        box('armrest', [0.18, 0.35, 0.84], [x, 0.47, 0.01], body, false, 0.06);
      }
      for (const x of [-0.4, 0.4]) {
        box('seat cushion', [0.78, 0.16, 0.65], [x, 0.4, 0.045], body, false, 0.055);
        const cushion = box('back cushion', [0.76, 0.36, 0.16], [x, 0.67, -0.205],
          body, false, 0.055);
        cushion.rotation.x = 0.1;
      }
      break;
    case 'bed':
      legs(1.24, 1.76, 0.14, 0.085);
      box('bed frame', [1.56, 0.2, 2.12], [0, 0.24, 0], body, false, 0.025);
      box('headboard', [1.6, 0.8, 0.09], [0, 0.64, -1.08], body, false, 0.03);
      box('mattress', [1.48, 0.2, 2.02], [0, 0.44, 0], pale, true, 0.06);
      box('coverlet', [1.5, 0.045, 1.35], [0, 0.5625, 0.3], body, false, 0.02);
      for (const x of [-0.36, 0.36]) {
        box('pillow', [0.6, 0.12, 0.36], [x, 0.6, -0.72], pale, true, 0.055);
      }
      break;
    case 'room': {
      const floorMaterial = new T.MeshStandardMaterial({ color: '#a28c73', roughness: 0.92, side: T.DoubleSide });
      const floor = mesh('room floor', new T.PlaneGeometry(4, 3), floorMaterial, [0, 0, 0], true);
      floor.rotation.x = -Math.PI / 2;
      box('left wall', [0.12, 2.7, 3.12], [-2, 1.35, 0]);
      box('wall below window', [4, 0.9, 0.12], [0, 0.45, -1.5]);
      box('wall above window', [4, 0.7, 0.12], [0, 2.35, -1.5]);
      for (const x of [-1.35, 1.35]) {
        box('window wall pier', [1.3, 1.1, 0.12], [x, 1.45, -1.5]);
      }
      for (const x of [-0.73, 0.73]) {
        box('window jamb', [0.06, 1.16, 0.17], [x, 1.45, -1.47], pale, true);
      }
      box('window lintel', [1.52, 0.06, 0.17], [0, 2.03, -1.47], pale, true);
      box('window sill', [1.62, 0.06, 0.27], [0, 0.9, -1.42], pale, true);
      box('back skirting', [4, 0.08, 0.035], [0, 0.04, -1.42], pale, true);
      box('side skirting', [0.035, 0.08, 3], [-1.92, 0.04, 0], pale, true);
      break;
    }
    default:
      throw new Error(`Unknown prop kind: ${String(kind)}`);
  }
  return root;
}
