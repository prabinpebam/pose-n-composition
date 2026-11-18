import { describe, expect, it } from 'vitest';
import * as T from 'three';
import { makeProp, type PropKind } from './props';

const kinds: PropKind[] = ['lamp', 'table', 'chair', 'desk', 'couch', 'bed', 'room'];

describe('original procedural props', () => {
  it('keeps all seven props together with grounded finite geometry and shadow materials', () => {
    const scene = new T.Scene();
    const props = kinds.map(kind => makeProp(kind, '#ab7252'));
    scene.add(...props);
    scene.updateMatrixWorld(true);
    expect(scene.children).toHaveLength(kinds.length);
    for (const prop of props) {
      expect(prop.parent).toBe(scene);
      const bounds = new T.Box3().setFromObject(prop);
      expect(bounds.isEmpty()).toBe(false);
      expect([...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)).toBe(true);
      expect(bounds.min.y).toBeCloseTo(0, 6);
      let meshes = 0;
      prop.traverse(node => {
        if (!(node instanceof T.Mesh)) return;
        meshes++;
        expect(node.material).toBeInstanceOf(T.MeshStandardMaterial);
        expect(node.castShadow).toBe(true);
        expect(node.receiveShadow).toBe(true);
        const positions = node.geometry.getAttribute('position');
        expect(positions.count).toBeGreaterThan(0);
        expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
      });
      expect(meshes).toBeGreaterThan(0);
    }
  });

  it('leaves a genuine window opening surrounded by solid wall geometry', () => {
    const room = makeProp('room', '#aaaaaa');
    room.updateMatrixWorld(true);
    const hitsAt = (x: number, y: number) =>
      new T.Raycaster(new T.Vector3(x, y, 0), new T.Vector3(0, 0, -1), 0, 3)
        .intersectObject(room, true);
    for (const x of [-0.5, 0, 0.5]) {
      for (const y of [1.1, 1.45, 1.8]) expect(hitsAt(x, y)).toHaveLength(0);
    }
    for (const [x, y] of [[-1.2, 1.45], [1.2, 1.45], [0, 0.5], [0, 2.4]]) {
      expect(hitsAt(x, y).length).toBeGreaterThan(0);
    }
  });

  it('recolors one instance without changing another instance or fixed-color details', () => {
    for (const kind of kinds) {
      const first = makeProp(kind, '#ab7252'), second = makeProp(kind, '#ab7252');
      const fixedColors = new Map<T.MeshStandardMaterial, string>();
      first.traverse(node => {
        if (node instanceof T.Mesh && node.material instanceof T.MeshStandardMaterial && node.userData.fixedColor) {
          fixedColors.set(node.material, node.material.color.getHexString());
        }
      });
      let recolored = 0;
      first.traverse(node => {
        if (node instanceof T.Mesh && node.material instanceof T.MeshStandardMaterial && !node.userData.fixedColor) {
          node.material.color.set('#00ff00');
          recolored++;
        }
      });
      expect(recolored).toBeGreaterThan(0);
      first.traverse(node => {
        if (node instanceof T.Mesh && node.material instanceof T.MeshStandardMaterial && !node.userData.fixedColor) {
          expect(node.material.color.getHexString()).toBe('00ff00');
        }
      });
      second.traverse(node => {
        if (node instanceof T.Mesh && node.material instanceof T.MeshStandardMaterial && !node.userData.fixedColor) {
          expect(node.material.color.getHexString()).toBe('ab7252');
        }
      });
      for (const [material, originalColor] of fixedColors) {
        expect(material.color.getHexString()).toBe(originalColor);
      }
    }
  });

  it('keeps lamp furnishings separate from actual scene light emitters', () => {
    const lamp = makeProp('lamp', '#ab7252');
    const lights: T.Light[] = [];
    lamp.traverse(node => { if (node instanceof T.Light) lights.push(node); });
    expect(lights).toHaveLength(0);
  });
});
