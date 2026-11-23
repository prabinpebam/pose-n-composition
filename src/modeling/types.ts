import type * as THREE from 'three';

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

export const PRIMITIVE_KINDS = [
  'cube',
  'sphere',
  'cylinder',
  'cone',
  'pyramid',
  'torus',
  'capsule',
  'tube',
  'plane',
  'disc',
  'platonic',
] as const;

export type PrimitiveKind = (typeof PRIMITIVE_KINDS)[number];

export const PLATONIC_TYPES = [
  'tetrahedron',
  'octahedron',
  'dodecahedron',
  'icosahedron',
] as const;

export type PlatonicType = (typeof PLATONIC_TYPES)[number];

export interface CubeParams {
  width: number;
  height: number;
  depth: number;
  segX: number;
  segY: number;
  segZ: number;
  fillet: boolean;
  filletRadius: number;
  filletSubdivisions: number;
}

export interface SphereParams {
  radius: number;
  widthSegments: number;
  heightSegments: number;
  hemisphere: boolean;
  sliceDeg: number;
}

export interface CylinderParams {
  radiusTop: number;
  radiusBottom: number;
  height: number;
  radialSegments: number;
  heightSegments: number;
  fillet: boolean;
  filletRadius: number;
  filletSubdivisions: number;
}

export interface ConeParams {
  radiusBottom: number;
  radiusTop: number;
  height: number;
  radialSegments: number;
  heightSegments: number;
  fillet: boolean;
  filletRadius: number;
  filletSubdivisions: number;
}

export interface PyramidParams {
  width: number;
  height: number;
  depth: number;
  segments: number;
  fillet: boolean;
  filletRadius: number;
  filletSubdivisions: number;
}

export interface TorusParams {
  radius: number;
  tube: number;
  radialSegments: number;
  tubularSegments: number;
  arcDeg: number;
}

export interface CapsuleParams {
  radius: number;
  height: number;
  radialSegments: number;
  capSegments: number;
}

export interface TubeParams {
  innerRadius: number;
  outerRadius: number;
  height: number;
  radialSegments: number;
  heightSegments: number;
  fillet: boolean;
  filletRadius: number;
  filletSubdivisions: number;
}

export interface PlaneParams {
  width: number;
  depth: number;
  segX: number;
  segZ: number;
}

export interface DiscParams {
  innerRadius: number;
  outerRadius: number;
  radialSegments: number;
  ringSegments: number;
}

export interface PlatonicParams {
  polyhedron: PlatonicType;
  radius: number;
  subdivisions: number;
  fillet: boolean;
  filletRadius: number;
  filletSubdivisions: number;
}

export interface PrimitiveParamsMap {
  cube: CubeParams;
  sphere: SphereParams;
  cylinder: CylinderParams;
  cone: ConeParams;
  pyramid: PyramidParams;
  torus: TorusParams;
  capsule: CapsuleParams;
  tube: TubeParams;
  plane: PlaneParams;
  disc: DiscParams;
  platonic: PlatonicParams;
}

export type PrimitiveSpec = {
  [K in PrimitiveKind]: {
    kind: K;
    params: PrimitiveParamsMap[K];
  };
}[PrimitiveKind];

export interface MeshFace {
  verts: number[];
  materialIndex?: number;
  uvs?: Vec2[];
}

export interface EditableMeshData {
  vertices: Vec3[];
  faces: MeshFace[];
  phongAngleDeg?: number;
}

export const MODELING_MODES = ['object', 'point', 'edge', 'polygon'] as const;
export type ModelingMode = (typeof MODELING_MODES)[number];

export const COMPONENT_ELEMENT_TYPES = ['point', 'edge', 'polygon'] as const;
export type ComponentElementType = (typeof COMPONENT_ELEMENT_TYPES)[number];

export interface ComponentSelection {
  mode: ComponentElementType;
  vertices: number[];
  edges: number[];
  faces: number[];
}

export interface MeshEdge {
  index: number;
  a: number;
  b: number;
  faces: number[];
  isBoundary: boolean;
}

export interface MeshAdjacency {
  edges: MeshEdge[];
  edgeKeyToIndex: Map<string, number>;
  vertexEdges: number[][];
  vertexFaces: number[][];
  faceEdges: number[][];
  faceNormals: Vec3[];
  vertexNormals: Vec3[];
}

export interface GizmoFrame {
  origin: Vec3;
  normal: Vec3;
  tangent: Vec3;
  bitangent: Vec3;
}

export interface MeshOperationResult {
  mesh: EditableMeshData;
  selection: ComponentSelection;
}

export const MODIFIER_TYPES = [
  'bevel',
  'subdivision',
  'mirror',
  'solidify',
  'bend',
  'twist',
  'taper',
  'array',
] as const;

export type ModifierType = (typeof MODIFIER_TYPES)[number];

export type AxisId = 'x' | 'y' | 'z';

export interface BevelModifierParams {
  width: number;
  segments: number;
  angleThresholdDeg: number;
  profile?: number;
}

export interface SubdivisionModifierParams {
  levels: 1 | 2 | 3;
  smooth?: boolean;
}

export interface MirrorModifierParams {
  axis: AxisId;
  offset: number;
  bisect: boolean;
  mergeThreshold: number;
}

export interface SolidifyModifierParams {
  thickness: number;
  evenThickness: boolean;
}

export interface BendModifierParams {
  angleDeg: number;
  axis: AxisId;
  directionDeg: number;
}

export interface TwistModifierParams {
  angleDeg: number;
  axis: AxisId;
}

export interface TaperModifierParams {
  strength: number;
  axis: AxisId;
  curvature: number;
}

export interface ArrayModifierParams {
  mode: 'linear' | 'radial';
  count: number;
  offset: Vec3;
  radius: number;
  stepRotationDeg: Vec3;
}

export interface ModifierParamsMap {
  bevel: BevelModifierParams;
  subdivision: SubdivisionModifierParams;
  mirror: MirrorModifierParams;
  solidify: SolidifyModifierParams;
  bend: BendModifierParams;
  twist: TwistModifierParams;
  taper: TaperModifierParams;
  array: ArrayModifierParams;
}

export type ModifierSpec = {
  [K in ModifierType]: {
    id: string;
    type: K;
    name: string;
    enabled: boolean;
    params: ModifierParamsMap[K];
  };
}[ModifierType];

export const BOOLEAN_OP_TYPES = ['union', 'subtract', 'intersect'] as const;
export type BooleanOpType = (typeof BOOLEAN_OP_TYPES)[number];

export interface TransformSpec {
  position: Vec3;
  rotation: Vec3;
  scale: Vec3;
}

export interface BaseModelingNode {
  id?: string;
  name?: string;
  transform?: TransformSpec;
  modifiers?: ModifierSpec[];
  phongAngleDeg?: number;
}

export interface PrimitiveModelingNode extends BaseModelingNode {
  nodeType: 'primitive';
  primitive: PrimitiveSpec;
}

export interface EditableModelingNode extends BaseModelingNode {
  nodeType: 'editable';
  mesh: EditableMeshData;
}

export interface GeometryModelingNode extends BaseModelingNode {
  nodeType: 'geometry';
  geometry: THREE.BufferGeometry;
}

export interface BooleanOperandSpec {
  node: ModelingNodeSpec;
  operation?: BooleanOpType;
}

export interface BooleanModelingNode extends BaseModelingNode {
  nodeType: 'boolean';
  operation: BooleanOpType;
  operands: ModelingNodeSpec[];
}

export type ModelingNodeSpec =
  | PrimitiveModelingNode
  | EditableModelingNode
  | GeometryModelingNode
  | BooleanModelingNode;

export interface EvaluatedModelingResult {
  geometry: THREE.BufferGeometry;
  wireframeGeometry: THREE.BufferGeometry;
  editableMesh: EditableMeshData;
}
