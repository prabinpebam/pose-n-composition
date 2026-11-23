import * as THREE from 'three';
import {
  evaluateBooleanChain,
  transformSpecToMatrix4,
} from './booleans';
import {
  bufferGeometryToEditableMesh,
  cloneEditableMesh,
  createQuadWireframeGeometry,
  editableMeshToBufferGeometry,
  transformSelectedComponents,
} from './editableMesh';
import { applyModifierStack } from './modifiers';
import { createPrimitiveEditableMesh } from './primitives';
import type {
  EditableMeshData,
  EvaluatedModelingResult,
  ModelingNodeSpec,
} from './types';

function evaluateBaseEditableMesh(node: ModelingNodeSpec): EditableMeshData {
  switch (node.nodeType) {
    case 'primitive':
      return createPrimitiveEditableMesh(node.primitive);
    case 'editable':
      return cloneEditableMesh(node.mesh);
    case 'geometry':
      return bufferGeometryToEditableMesh(node.geometry);
    case 'boolean': {
      if (node.operands.length === 0) {
        return { vertices: [], faces: [] };
      }
      const chainOperands = node.operands.map((child) => {
        const evalChild = evaluateModelingNode(child, { applyNodeTransform: false });
        return {
          mesh: evalChild.geometry,
          transform: child.transform,
        };
      });
      const csgGeo = evaluateBooleanChain(chainOperands, node.operation);
      for (const op of chainOperands) {
        op.mesh.dispose();
      }
      const editable = bufferGeometryToEditableMesh(csgGeo);
      csgGeo.dispose();
      return editable;
    }
  }
}

/**
 * Evaluates any `ModelingNodeSpec` (Parametric Primitive, EditableMesh, Imported Geometry,
 * or hierarchical CSG `Boole` Generator + attached non-destructive `ModifierSpec[]` stack)
 * into renderable `BufferGeometry`, true quad `wireframeGeometry`, and `EditableMeshData`.
 */
export function evaluateModelingNode(
  node: ModelingNodeSpec,
  options?: { applyNodeTransform?: boolean },
): EvaluatedModelingResult {
  let mesh = evaluateBaseEditableMesh(node);

  if (node.modifiers && node.modifiers.length > 0) {
    mesh = applyModifierStack(mesh, node.modifiers);
  }

  if (options?.applyNodeTransform && node.transform) {
    const mat = transformSpecToMatrix4(node.transform);
    const allVerts = mesh.vertices.map((_, i) => i);
    mesh = transformSelectedComponents(
      mesh,
      { mode: 'point', vertices: allVerts, edges: [], faces: [] },
      mat,
    ).mesh;
  }

  const phongAngleDeg = node.phongAngleDeg ?? mesh.phongAngleDeg ?? 40;
  mesh.phongAngleDeg = phongAngleDeg;

  const geometry = editableMeshToBufferGeometry(mesh, { phongAngleDeg });
  const wireframeGeometry = createQuadWireframeGeometry(mesh);

  return {
    geometry,
    wireframeGeometry,
    editableMesh: mesh,
  };
}

/**
 * Cinema 4D `Make Editable (C)` / `Current State to Object`:
 * Converts a Parametric Primitive, Boole Generator, or Imported Geometry node into an
 * `EditableMeshData` (optionally baking active modifiers when `bakeModifiers = true`).
 */
export function makeNodeEditable(
  node: ModelingNodeSpec,
  options?: { bakeModifiers?: boolean },
): { mesh: EditableMeshData; remainingModifiers: NonNullable<ModelingNodeSpec['modifiers']> } {
  const bake = options?.bakeModifiers ?? false;
  const baseMesh = evaluateBaseEditableMesh(node);

  if (bake && node.modifiers && node.modifiers.length > 0) {
    return {
      mesh: applyModifierStack(baseMesh, node.modifiers),
      remainingModifiers: [],
    };
  }

  return {
    mesh: baseMesh,
    remainingModifiers: node.modifiers ? structuredClone(node.modifiers) : [],
  };
}

export function disposeEvaluatedResult(result: EvaluatedModelingResult): void {
  result.geometry.dispose();
  result.wireframeGeometry.dispose();
}
