import { useEffect, useMemo, useRef, useState } from 'react';
import { TooltipButton } from './studioTooltip';
import { CHARACTERS, defaultModelId } from '../characterCatalog';
import {
  AI_DRESS_PROMPT_GUIDE,
  DEFAULT_MANNEQUIN_DRESS_ID,
  MANNEQUIN_DRESS_PRESETS,
  downloadMannequinDressTemplate,
  isMannequinDressPresetId,
  type MannequinDressPresetId,
} from '../mannequin-dress';
import {
  BOOLEAN_OP_LABELS,
  DEFAULT_HAIR_COLOR,
  FINGER_IDS,
  GARMENT_COLORS, TRENCH_GRIPS, garmentFitLimit, setFitOffset, type Garment, type TrenchGrip,
  HAND_CURL_MAX,
  HAND_CURL_MIN,
  HAND_OPPOSITION_MAX,
  HAND_OPPOSITION_MIN,
  HAND_PRESETS,
  HAND_SPREAD_MAX,
  HAND_SPREAD_MIN,
  MODIFIER_LABELS,
  PRIMITIVE_LABELS,
  applyMasterHandCurl,
  clone,
  computeMasterHandCurl,
  defaultCharacterHairStyle,
  defaultHandPose,
  defaultOutfitColor,
  defaultSkinColor,
  handPreset,
  hasAuthoredHair,
  hasCharacterOutfitSlot,
  isBody,
  isNeutralHandPose,
  normalizeCharacterHandPoses,
  type CharacterHandPoses,
  type FingerId,
  type HairStyleId,
  type HandPoseSpec,
  type HandPresetName,
  type HandSide,
  type Item,
  type Joint,
} from '../model';
import {
  BOOLEAN_OP_TYPES,
  MODIFIER_TYPES,
  PLATONIC_TYPES,
  PRIMITIVE_KINDS,
  buildHalfEdgeOrAdjacency,
  createDefaultPrimitiveSpec,
  type AxisId,
  type BooleanOpType,
  type ComponentSelection,
  type EditableMeshData,
  type ModelingMode,
  type ModifierSpec,
  type ModifierType,
  type PlatonicType,
  type PrimitiveKind,
  type PrimitiveSpec,
} from '../modeling';
import { getRuntimeImportedAsset } from '../storage';
import {
  C4DIcons,
  getBooleanIcon,
  getModifierIcon,
  getPrimitiveIcon,
} from './c4dPalette';
import {
  ColorField,
  Icons,
  NumericField,
  SegmentedControl,
  SelectDropdown,
  SliderField,
  SwitchRow,
  Vector3Field,
  type SelectOption,
} from './ui';

export const MATERIAL_SWATCHES = [
  { value: '#d8dee9', label: 'Studio Clay' },
  { value: '#e5c07b', label: 'Warm Brass' },
  { value: '#e06c75', label: 'Coral Clay' },
  { value: '#61afef', label: 'Cobalt' },
  { value: '#98c379', label: 'Sage' },
  { value: '#abb2bf', label: 'Brushed Steel' },
  { value: '#3b4252', label: 'Charcoal' },
] as const;

export const STUDIO_SKIN_TONE_SWATCHES = [
  { value: '#ffe6d8', label: 'Porcelain' },
  { value: '#ffdecc', label: 'Fair Peach' },
  { value: '#e4b895', label: 'Warm Sand' },
  { value: '#d49b72', label: 'Golden Tan' },
  { value: '#8d5524', label: 'Rich Umber' },
  { value: '#593421', label: 'Deep Espresso' },
] as const;

export const AUTHORED_SKIN_TONE_SWATCHES = [
  { value: '#ffffff', label: 'Original' },
  ...STUDIO_SKIN_TONE_SWATCHES,
] as const;

export const STUDIO_DRESS_COLOR_SWATCHES = [
  { value: '#f5efe6', label: 'Ivory' },
  { value: '#f5d6e0', label: 'Blush Rose' },
  { value: '#b8294b', label: 'Crimson' },
  { value: '#1f4fd6', label: 'Cobalt' },
  { value: '#1d7a5f', label: 'Emerald' },
  { value: '#d9822b', label: 'Amber' },
  { value: '#6d3bb8', label: 'Violet' },
  { value: '#2b303a', label: 'Charcoal' },
] as const;

export const AUTHORED_DRESS_COLOR_SWATCHES = [
  { value: '#ffffff', label: 'Original' },
  ...STUDIO_DRESS_COLOR_SWATCHES,
] as const;

export const STUDIO_HAIR_COLOR_SWATCHES = [
  { value: '#f2e2c4', label: 'Platinum Blonde' },
  { value: '#c99352', label: 'Honey Blonde' },
  { value: '#8c4427', label: 'Auburn' },
  { value: '#5c3828', label: 'Chestnut' },
  { value: '#3b2720', label: 'Espresso' },
  { value: '#1c1918', label: 'Jet Black' },
] as const;

export const AUTHORED_HAIR_COLOR_SWATCHES = [
  { value: '#ffffff', label: 'Original' },
  ...STUDIO_HAIR_COLOR_SWATCHES,
] as const;

const AXIS_ITEMS: { value: AxisId; label: string }[] = [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
];

/* ============================================================================
 * 1. Parametric Primitive Attribute Panel (11 Primitives + Fillet / Chamfer)
 * ============================================================================ */

export function PrimitiveObjectPanel({
  spec,
  disabled = false,
  onChangeSpec,
  onMakeEditable,
}: {
  spec: PrimitiveSpec;
  disabled?: boolean;
  onChangeSpec: (next: PrimitiveSpec) => void;
  onMakeEditable: () => void;
}) {
  const kindOptions = useMemo<SelectOption[]>(
    () =>
      PRIMITIVE_KINDS.map(k => ({
        value: k,
        label: PRIMITIVE_LABELS[k],
        icon: getPrimitiveIcon(k),
      })),
    [],
  );

  const patchParams = <K extends PrimitiveKind>(
    expectedKind: K,
    patch: Partial<Extract<PrimitiveSpec, { kind: K }>['params']>,
  ) => {
    if (spec.kind !== expectedKind) return;
    onChangeSpec({
      kind: expectedKind,
      params: { ...spec.params, ...patch },
    } as PrimitiveSpec);
  };

  const renderFilletSection = (
    fillet: boolean,
    filletRadius: number,
    filletSubdivisions: number,
    maxRadius: number,
    onUpdate: (patch: { fillet?: boolean; filletRadius?: number; filletSubdivisions?: number }) => void,
  ) => (
    <div className="c4d-mod-card" style={{ marginTop: 10 }}>
      <div className="c4d-mod-card-head">
        <span className="c4d-mod-card-title">
          {C4DIcons.primFilletCube}
          <span>Fillet / Chamfer</span>
        </span>
        <span className="pill-badge">
          {!fillet ? 'Sharp' : filletSubdivisions <= 1 ? '45° Chamfer' : `Fillet (${filletSubdivisions} seg)`}
        </span>
      </div>
      <div className="c4d-mod-card-body">
        <SwitchRow
          label="Enable Fillet / Chamfer"
          description="1 subdivision = crisp 45° chamfer; 2+ = smooth rounded fillet"
          checked={fillet}
          onChange={next => onUpdate({ fillet: next })}
        />
        {fillet && (
          <>
            <SliderField
              label="Fillet radius"
              value={filletRadius}
              min={0.005}
              max={Math.max(0.05, Number(maxRadius.toFixed(2)))}
              step={0.01}
              displayValue={`${filletRadius.toFixed(2)} m`}
              onChange={r => onUpdate({ filletRadius: r })}
            />
            <SliderField
              label="Fillet subdivisions"
              value={filletSubdivisions}
              min={1}
              max={8}
              step={1}
              displayValue={filletSubdivisions <= 1 ? '1 (Chamfer)' : `${filletSubdivisions} (Smooth)`}
              onChange={sub => onUpdate({ filletSubdivisions: Math.round(sub) })}
            />
          </>
        )}
      </div>
    </div>
  );

  return (
    <section aria-label="Parametric primitive settings">
      <div className="section-head">
        <h3>Primitive parameters</h3>
        <TooltipButton
          className="text-btn"
          disabled={disabled}
          onClick={onMakeEditable}
          tooltip="Make Editable"
          tooltipShortcut="C"
          tooltipDescription="Convert parametric primitive into an editable quad polygon mesh"
          tooltipPlacement="top"
        >
          {C4DIcons.makeEditable} Make Editable
        </TooltipButton>
      </div>

      <div style={disabled ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
        <div className="select-field">
          <span className="field-label">Primitive type</span>
          <SelectDropdown
            ariaLabel="Primitive type"
            value={spec.kind}
            options={kindOptions}
            onChange={nextKind => {
              const typed = nextKind as PrimitiveKind;
              if (typed !== spec.kind) {
                onChangeSpec(createDefaultPrimitiveSpec(typed) as PrimitiveSpec);
              }
            }}
          />
        </div>

        {spec.kind === 'cube' && (
          <>
            <div className="three">
              <NumericField
                label="Size X (m)"
                ariaLabel="Cube width"
                value={spec.params.width}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={width => patchParams('cube', { width })}
              />
              <NumericField
                label="Size Y (m)"
                ariaLabel="Cube height"
                value={spec.params.height}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={height => patchParams('cube', { height })}
              />
              <NumericField
                label="Size Z (m)"
                ariaLabel="Cube depth"
                value={spec.params.depth}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={depth => patchParams('cube', { depth })}
              />
            </div>
            <div className="three">
              <NumericField
                label="Seg X"
                ariaLabel="Segments X"
                value={spec.params.segX}
                min={1}
                max={32}
                step={1}
                precision={0}
                onChange={segX => patchParams('cube', { segX: Math.round(segX) })}
              />
              <NumericField
                label="Seg Y"
                ariaLabel="Segments Y"
                value={spec.params.segY}
                min={1}
                max={32}
                step={1}
                precision={0}
                onChange={segY => patchParams('cube', { segY: Math.round(segY) })}
              />
              <NumericField
                label="Seg Z"
                ariaLabel="Segments Z"
                value={spec.params.segZ}
                min={1}
                max={32}
                step={1}
                precision={0}
                onChange={segZ => patchParams('cube', { segZ: Math.round(segZ) })}
              />
            </div>
            {renderFilletSection(
              spec.params.fillet,
              spec.params.filletRadius,
              spec.params.filletSubdivisions,
              Math.min(spec.params.width, spec.params.height, spec.params.depth) * 0.48,
              patch => patchParams('cube', patch),
            )}
          </>
        )}

        {spec.kind === 'sphere' && (
          <>
            <SliderField
              label="Radius"
              value={spec.params.radius}
              min={0.05}
              max={20}
              step={0.05}
              displayValue={`${spec.params.radius.toFixed(2)} m`}
              onChange={radius => patchParams('sphere', { radius })}
            />
            <div className="two">
              <NumericField
                label="Width segs"
                ariaLabel="Sphere width segments"
                value={spec.params.widthSegments}
                min={4}
                max={64}
                step={2}
                precision={0}
                onChange={widthSegments => patchParams('sphere', { widthSegments: Math.round(widthSegments) })}
              />
              <NumericField
                label="Height segs"
                ariaLabel="Sphere height segments"
                value={spec.params.heightSegments}
                min={3}
                max={64}
                step={1}
                precision={0}
                onChange={heightSegments => patchParams('sphere', { heightSegments: Math.round(heightSegments) })}
              />
            </div>
            <SwitchRow
              label="Hemisphere"
              description="Slice upper dome with clean base cap"
              checked={spec.params.hemisphere}
              onChange={hemisphere => patchParams('sphere', { hemisphere })}
            />
            <SliderField
              label="Slice angle"
              value={spec.params.sliceDeg}
              min={15}
              max={360}
              step={5}
              displayValue={`${Math.round(spec.params.sliceDeg)}°`}
              onChange={sliceDeg => patchParams('sphere', { sliceDeg })}
            />
          </>
        )}

        {spec.kind === 'cylinder' && (
          <>
            <div className="three">
              <NumericField
                label="Top R (m)"
                ariaLabel="Cylinder top radius"
                value={spec.params.radiusTop}
                min={0.01}
                max={20}
                step={0.05}
                precision={2}
                onChange={radiusTop => patchParams('cylinder', { radiusTop })}
              />
              <NumericField
                label="Bot R (m)"
                ariaLabel="Cylinder bottom radius"
                value={spec.params.radiusBottom}
                min={0.01}
                max={20}
                step={0.05}
                precision={2}
                onChange={radiusBottom => patchParams('cylinder', { radiusBottom })}
              />
              <NumericField
                label="Height (m)"
                ariaLabel="Cylinder height"
                value={spec.params.height}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={height => patchParams('cylinder', { height })}
              />
            </div>
            <div className="two">
              <NumericField
                label="Rotation segs"
                ariaLabel="Cylinder radial segments"
                value={spec.params.radialSegments}
                min={3}
                max={64}
                step={1}
                precision={0}
                onChange={radialSegments => patchParams('cylinder', { radialSegments: Math.round(radialSegments) })}
              />
              <NumericField
                label="Height segs"
                ariaLabel="Cylinder height segments"
                value={spec.params.heightSegments}
                min={1}
                max={32}
                step={1}
                precision={0}
                onChange={heightSegments => patchParams('cylinder', { heightSegments: Math.round(heightSegments) })}
              />
            </div>
            {renderFilletSection(
              spec.params.fillet,
              spec.params.filletRadius,
              spec.params.filletSubdivisions,
              Math.min(spec.params.radiusTop, spec.params.radiusBottom, spec.params.height * 0.45),
              patch => patchParams('cylinder', patch),
            )}
          </>
        )}

        {spec.kind === 'cone' && (
          <>
            <div className="three">
              <NumericField
                label="Bot R (m)"
                ariaLabel="Cone bottom radius"
                value={spec.params.radiusBottom}
                min={0.05}
                max={20}
                step={0.05}
                precision={2}
                onChange={radiusBottom => patchParams('cone', { radiusBottom })}
              />
              <NumericField
                label="Top R (m)"
                ariaLabel="Cone top radius"
                value={spec.params.radiusTop}
                min={0}
                max={20}
                step={0.05}
                precision={2}
                onChange={radiusTop => patchParams('cone', { radiusTop })}
              />
              <NumericField
                label="Height (m)"
                ariaLabel="Cone height"
                value={spec.params.height}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={height => patchParams('cone', { height })}
              />
            </div>
            <div className="two">
              <NumericField
                label="Rotation segs"
                ariaLabel="Cone radial segments"
                value={spec.params.radialSegments}
                min={3}
                max={64}
                step={1}
                precision={0}
                onChange={radialSegments => patchParams('cone', { radialSegments: Math.round(radialSegments) })}
              />
              <NumericField
                label="Height segs"
                ariaLabel="Cone height segments"
                value={spec.params.heightSegments}
                min={1}
                max={32}
                step={1}
                precision={0}
                onChange={heightSegments => patchParams('cone', { heightSegments: Math.round(heightSegments) })}
              />
            </div>
            {renderFilletSection(
              spec.params.fillet,
              spec.params.filletRadius,
              spec.params.filletSubdivisions,
              Math.min(spec.params.radiusBottom * 0.45, spec.params.height * 0.4),
              patch => patchParams('cone', patch),
            )}
          </>
        )}

        {spec.kind === 'pyramid' && (
          <>
            <div className="three">
              <NumericField
                label="Width (m)"
                ariaLabel="Pyramid width"
                value={spec.params.width}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={width => patchParams('pyramid', { width })}
              />
              <NumericField
                label="Height (m)"
                ariaLabel="Pyramid height"
                value={spec.params.height}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={height => patchParams('pyramid', { height })}
              />
              <NumericField
                label="Depth (m)"
                ariaLabel="Pyramid depth"
                value={spec.params.depth}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={depth => patchParams('pyramid', { depth })}
              />
            </div>
            <SliderField
              label="Subdivisions"
              value={spec.params.segments}
              min={1}
              max={16}
              step={1}
              displayValue={`${spec.params.segments}`}
              onChange={segments => patchParams('pyramid', { segments: Math.round(segments) })}
            />
            {renderFilletSection(
              spec.params.fillet,
              spec.params.filletRadius,
              spec.params.filletSubdivisions,
              Math.min(spec.params.width, spec.params.height, spec.params.depth) * 0.3,
              patch => patchParams('pyramid', patch),
            )}
          </>
        )}

        {spec.kind === 'torus' && (
          <>
            <div className="two">
              <NumericField
                label="Ring R (m)"
                ariaLabel="Torus ring radius"
                value={spec.params.radius}
                min={0.05}
                max={25}
                step={0.05}
                precision={2}
                onChange={radius => patchParams('torus', { radius })}
              />
              <NumericField
                label="Pipe R (m)"
                ariaLabel="Torus pipe radius"
                value={spec.params.tube}
                min={0.01}
                max={10}
                step={0.02}
                precision={2}
                onChange={tube => patchParams('torus', { tube })}
              />
            </div>
            <div className="two">
              <NumericField
                label="Ring segs"
                ariaLabel="Torus tubular segments"
                value={spec.params.tubularSegments}
                min={6}
                max={72}
                step={2}
                precision={0}
                onChange={tubularSegments => patchParams('torus', { tubularSegments: Math.round(tubularSegments) })}
              />
              <NumericField
                label="Pipe segs"
                ariaLabel="Torus radial segments"
                value={spec.params.radialSegments}
                min={4}
                max={48}
                step={2}
                precision={0}
                onChange={radialSegments => patchParams('torus', { radialSegments: Math.round(radialSegments) })}
              />
            </div>
            <SliderField
              label="Slice arc"
              value={spec.params.arcDeg}
              min={15}
              max={360}
              step={5}
              displayValue={`${Math.round(spec.params.arcDeg)}°`}
              onChange={arcDeg => patchParams('torus', { arcDeg })}
            />
          </>
        )}

        {spec.kind === 'capsule' && (
          <>
            <div className="two">
              <NumericField
                label="Radius (m)"
                ariaLabel="Capsule radius"
                value={spec.params.radius}
                min={0.05}
                max={15}
                step={0.05}
                precision={2}
                onChange={radius => patchParams('capsule', { radius })}
              />
              <NumericField
                label="Height (m)"
                ariaLabel="Capsule total height"
                value={spec.params.height}
                min={0.1}
                max={40}
                step={0.05}
                precision={2}
                onChange={height => patchParams('capsule', { height })}
              />
            </div>
            <div className="two">
              <NumericField
                label="Rotation segs"
                ariaLabel="Capsule radial segments"
                value={spec.params.radialSegments}
                min={6}
                max={64}
                step={2}
                precision={0}
                onChange={radialSegments => patchParams('capsule', { radialSegments: Math.round(radialSegments) })}
              />
              <NumericField
                label="Cap segs"
                ariaLabel="Capsule cap segments"
                value={spec.params.capSegments}
                min={2}
                max={24}
                step={1}
                precision={0}
                onChange={capSegments => patchParams('capsule', { capSegments: Math.round(capSegments) })}
              />
            </div>
          </>
        )}

        {spec.kind === 'tube' && (
          <>
            <div className="three">
              <NumericField
                label="Inner R (m)"
                ariaLabel="Tube inner radius"
                value={spec.params.innerRadius}
                min={0.02}
                max={20}
                step={0.05}
                precision={2}
                onChange={innerRadius => patchParams('tube', { innerRadius })}
              />
              <NumericField
                label="Outer R (m)"
                ariaLabel="Tube outer radius"
                value={spec.params.outerRadius}
                min={0.05}
                max={25}
                step={0.05}
                precision={2}
                onChange={outerRadius => patchParams('tube', { outerRadius })}
              />
              <NumericField
                label="Height (m)"
                ariaLabel="Tube height"
                value={spec.params.height}
                min={0.05}
                max={50}
                step={0.05}
                precision={2}
                onChange={height => patchParams('tube', { height })}
              />
            </div>
            <div className="two">
              <NumericField
                label="Rotation segs"
                ariaLabel="Tube radial segments"
                value={spec.params.radialSegments}
                min={6}
                max={64}
                step={2}
                precision={0}
                onChange={radialSegments => patchParams('tube', { radialSegments: Math.round(radialSegments) })}
              />
              <NumericField
                label="Height segs"
                ariaLabel="Tube height segments"
                value={spec.params.heightSegments}
                min={1}
                max={32}
                step={1}
                precision={0}
                onChange={heightSegments => patchParams('tube', { heightSegments: Math.round(heightSegments) })}
              />
            </div>
            {renderFilletSection(
              spec.params.fillet,
              spec.params.filletRadius,
              spec.params.filletSubdivisions,
              Math.min((spec.params.outerRadius - spec.params.innerRadius) * 0.45, spec.params.height * 0.45),
              patch => patchParams('tube', patch),
            )}
          </>
        )}

        {spec.kind === 'plane' && (
          <>
            <div className="two">
              <NumericField
                label="Width (m)"
                ariaLabel="Plane width"
                value={spec.params.width}
                min={0.1}
                max={100}
                step={0.1}
                precision={2}
                onChange={width => patchParams('plane', { width })}
              />
              <NumericField
                label="Depth (m)"
                ariaLabel="Plane depth"
                value={spec.params.depth}
                min={0.1}
                max={100}
                step={0.1}
                precision={2}
                onChange={depth => patchParams('plane', { depth })}
              />
            </div>
            <div className="two">
              <NumericField
                label="Seg X"
                ariaLabel="Plane segments X"
                value={spec.params.segX}
                min={1}
                max={64}
                step={1}
                precision={0}
                onChange={segX => patchParams('plane', { segX: Math.round(segX) })}
              />
              <NumericField
                label="Seg Z"
                ariaLabel="Plane segments Z"
                value={spec.params.segZ}
                min={1}
                max={64}
                step={1}
                precision={0}
                onChange={segZ => patchParams('plane', { segZ: Math.round(segZ) })}
              />
            </div>
          </>
        )}

        {spec.kind === 'disc' && (
          <>
            <div className="two">
              <NumericField
                label="Inner R (m)"
                ariaLabel="Disc inner radius"
                value={spec.params.innerRadius}
                min={0}
                max={25}
                step={0.05}
                precision={2}
                onChange={innerRadius => patchParams('disc', { innerRadius })}
              />
              <NumericField
                label="Outer R (m)"
                ariaLabel="Disc outer radius"
                value={spec.params.outerRadius}
                min={0.05}
                max={30}
                step={0.05}
                precision={2}
                onChange={outerRadius => patchParams('disc', { outerRadius })}
              />
            </div>
            <div className="two">
              <NumericField
                label="Rotation segs"
                ariaLabel="Disc radial segments"
                value={spec.params.radialSegments}
                min={4}
                max={64}
                step={2}
                precision={0}
                onChange={radialSegments => patchParams('disc', { radialSegments: Math.round(radialSegments) })}
              />
              <NumericField
                label="Disc rings"
                ariaLabel="Disc ring segments"
                value={spec.params.ringSegments}
                min={1}
                max={24}
                step={1}
                precision={0}
                onChange={ringSegments => patchParams('disc', { ringSegments: Math.round(ringSegments) })}
              />
            </div>
          </>
        )}

        {spec.kind === 'platonic' && (
          <>
            <div className="select-field">
              <span className="field-label">Polyhedron type</span>
              <SelectDropdown
                ariaLabel="Polyhedron type"
                value={spec.params.polyhedron}
                options={PLATONIC_TYPES.map(t => ({
                  value: t,
                  label: t.charAt(0).toUpperCase() + t.slice(1),
                }))}
                onChange={p => patchParams('platonic', { polyhedron: p as PlatonicType })}
              />
            </div>
            <SliderField
              label="Radius"
              value={spec.params.radius}
              min={0.05}
              max={20}
              step={0.05}
              displayValue={`${spec.params.radius.toFixed(2)} m`}
              onChange={radius => patchParams('platonic', { radius })}
            />
            <SliderField
              label="Subdivisions"
              value={spec.params.subdivisions}
              min={0}
              max={3}
              step={1}
              displayValue={`${spec.params.subdivisions}`}
              onChange={subdivisions => patchParams('platonic', { subdivisions: Math.round(subdivisions) })}
            />
            {renderFilletSection(
              spec.params.fillet,
              spec.params.filletRadius,
              spec.params.filletSubdivisions,
              spec.params.radius * 0.35,
              patch => patchParams('platonic', patch),
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ============================================================================
 * 2. Editable Polygon Mesh Attribute Panel (Points / Edges / Polygons + Tools)
 * ============================================================================ */

export function EditableMeshObjectPanel({
  mesh,
  modelingMode,
  selection,
  disabled = false,
  onSetModelingMode,
  onRunMeshAction,
}: {
  mesh: EditableMeshData;
  modelingMode: ModelingMode;
  selection: ComponentSelection;
  disabled?: boolean;
  onSetModelingMode: (mode: ModelingMode) => void;
  onRunMeshAction: (
    action:
      | 'extrude'
      | 'inset'
      | 'bevel'
      | 'loopCut'
      | 'weld'
      | 'bridge'
      | 'connect'
      | 'subdivide'
      | 'dissolve'
      | 'flipNormals'
      | 'closeHole'
      | 'edgeLoop'
      | 'edgeRing'
      | 'grow'
      | 'shrink'
      | 'selectAll'
      | 'clearSelection'
      | 'invertSelection',
  ) => void;
}) {
  const edgeCount = useMemo(() => buildHalfEdgeOrAdjacency(mesh).edges.length, [mesh]);
  const selectedCount =
    modelingMode === 'point'
      ? selection.vertices.length
      : modelingMode === 'edge'
        ? selection.edges.length
        : modelingMode === 'polygon'
          ? selection.faces.length
          : 0;

  return (
    <section aria-label="Editable polygon mesh tools">
      <div className="section-head">
        <h3>Editable Quad Mesh</h3>
        <span className="pill-badge">
          {modelingMode === 'object' ? 'Object mode' : `${selectedCount} selected`}
        </span>
      </div>

      <div className="c4d-stat-row">
        <div className="c4d-stat-pill">
          <strong>{mesh.vertices.length}</strong>
          <span>Points</span>
        </div>
        <div className="c4d-stat-pill">
          <strong>{edgeCount}</strong>
          <span>Edges</span>
        </div>
        <div className="c4d-stat-pill">
          <strong>{mesh.faces.length}</strong>
          <span>Polygons</span>
        </div>
      </div>

      <SegmentedControl
        ariaLabel="Component edit mode"
        fullWidth
        disabled={disabled}
        value={modelingMode}
        items={[
          { value: 'object', label: 'Object' },
          { value: 'point', label: 'Points' },
          { value: 'edge', label: 'Edges' },
          { value: 'polygon', label: 'Polys' },
        ]}
        onChange={onSetModelingMode}
      />

      {modelingMode === 'object' ? (
        <p className="muted" style={{ marginTop: 8 }}>
          Switch to <strong>Points</strong>, <strong>Edges</strong>, or <strong>Polys</strong> above (or on the left dock) to pick components directly in the 3D viewport, double-click edge loops, and run C4D mesh operators.
        </p>
      ) : (
        <div style={disabled ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
          <div className="three" style={{ marginBottom: 6 }}>
            <button type="button" onClick={() => onRunMeshAction('selectAll')}>
              All
            </button>
            <button type="button" onClick={() => onRunMeshAction('invertSelection')}>
              Invert
            </button>
            <button type="button" onClick={() => onRunMeshAction('clearSelection')}>
              Clear
            </button>
          </div>
          <div className="c4d-tool-grid">
            <button type="button" onClick={() => onRunMeshAction('extrude')}>
              {C4DIcons.toolExtrude} Extrude
            </button>
            <button type="button" onClick={() => onRunMeshAction('inset')}>
              {C4DIcons.toolInset} Inset
            </button>
            <button type="button" onClick={() => onRunMeshAction('bevel')}>
              {C4DIcons.toolBevel} Bevel / Fillet
            </button>
            <button type="button" onClick={() => onRunMeshAction('loopCut')}>
              {C4DIcons.toolLoopCut} Loop Cut
            </button>
            <button type="button" onClick={() => onRunMeshAction('bridge')}>
              {C4DIcons.toolBridge} Bridge
            </button>
            <button type="button" onClick={() => onRunMeshAction('weld')}>
              {C4DIcons.toolWeld} Weld
            </button>
            <button type="button" onClick={() => onRunMeshAction('connect')}>
              {C4DIcons.toolConnect} Connect / Split
            </button>
            <button type="button" onClick={() => onRunMeshAction('subdivide')}>
              {C4DIcons.toolSubdivide} Subdivide
            </button>
            <button type="button" onClick={() => onRunMeshAction('dissolve')}>
              {C4DIcons.toolDissolve} Dissolve
            </button>
            <button type="button" onClick={() => onRunMeshAction('closeHole')}>
              {C4DIcons.toolCloseHole} Close Hole
            </button>
            <button type="button" onClick={() => onRunMeshAction('flipNormals')}>
              {C4DIcons.toolFlipNormals} Flip Normals
            </button>
            <button type="button" onClick={() => onRunMeshAction('edgeLoop')}>
              {C4DIcons.toolEdgeLoop} Edge Loop
            </button>
            <button type="button" onClick={() => onRunMeshAction('grow')}>
              {C4DIcons.toolGrowSelection} Grow Sel
            </button>
            <button type="button" onClick={() => onRunMeshAction('shrink')}>
              {C4DIcons.toolShrinkSelection} Shrink Sel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ============================================================================
 * 3. Live C4D `Boole` Generator Attribute Panel
 * ============================================================================ */

export function BooleObjectPanel({
  booleItem,
  selectedOperandId,
  availableOperandCandidates,
  disabled = false,
  onChangeOp,
  onToggleEnabled,
  onSelectOperand,
  onSwapOperands,
  onExtractOperands,
  onAssignSceneOperand,
  onSpawnCutterPrimitive,
  onMakeEditable,
}: {
  booleItem: Item;
  selectedOperandId: string | null;
  availableOperandCandidates: readonly Item[];
  disabled?: boolean;
  onChangeOp: (op: BooleanOpType) => void;
  onToggleEnabled: (enabled: boolean) => void;
  onSelectOperand: (operandId: string) => void;
  onSwapOperands: () => void;
  onExtractOperands: () => void;
  onAssignSceneOperand: (sceneItemId: string) => void;
  onSpawnCutterPrimitive: (kind: PrimitiveKind) => void;
  onMakeEditable: () => void;
}) {
  const op: BooleanOpType = booleItem.booleanOp ?? 'subtract';
  const operands = booleItem.operands ?? [];

  return (
    <section aria-label="Boole CSG generator settings">
      <div className="section-head">
        <h3>Boole Generator</h3>
        <button
          type="button"
          className="text-btn"
          disabled={disabled || operands.length === 0}
          onClick={onMakeEditable}
        >
          {C4DIcons.makeEditable} Bake Mesh
        </button>
      </div>

      <div style={disabled ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
        <div className="select-field">
          <span className="field-label">Boolean type</span>
          <SelectDropdown
            ariaLabel="Boolean type"
            value={op}
            options={BOOLEAN_OP_TYPES.map(t => ({
              value: t,
              label: BOOLEAN_OP_LABELS[t],
              icon: getBooleanIcon(t),
            }))}
            onChange={v => onChangeOp(v as BooleanOpType)}
          />
        </div>

        <SwitchRow
          label="Generator active"
          description="Disable to inspect raw operand meshes without CSG"
          checked={booleItem.booleanEnabled !== false}
          onChange={onToggleEnabled}
        />

        <div className="section-head" style={{ marginTop: 10 }}>
          <span className="field-label">Operands ({operands.length}/2)</span>
          <div style={{ display: 'inline-flex', gap: 4 }}>
            <TooltipButton
              className="text-btn"
              disabled={operands.length < 2}
              onClick={onSwapOperands}
              tooltip="Swap Operand A and Operand B"
              tooltipPlacement="top"
            >
              {C4DIcons.swap} Swap A↔B
            </TooltipButton>
            <TooltipButton
              className="text-btn"
              disabled={operands.length === 0}
              onClick={onExtractOperands}
              tooltip="Unpack operands back to scene objects"
              tooltipPlacement="top"
            >
              Unpack
            </TooltipButton>
          </div>
        </div>

        {operands.length === 0 ? (
          <div className="empty-card">
            Empty Boole generator. Assign an object below or add a primitive operand.
          </div>
        ) : (
          <div className="stack-gap">
            {operands.map((child, index) => {
              const role = index === 0 ? 'A (Base)' : index === 1 ? 'B (Cutter)' : `#${index + 1}`;
              const active = selectedOperandId === child.id;
              return (
                <button
                  key={child.id}
                  type="button"
                  className={active ? 'full-btn active' : 'full-btn'}
                  style={{ justifyContent: 'space-between' }}
                  onClick={() => onSelectOperand(child.id)}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span className="pill-badge">{role}</span>
                    <span>{child.name}</span>
                  </span>
                  <span className="meta-note">Move in 3D →</span>
                </button>
              );
            })}
          </div>
        )}

        {operands.length < 2 && (
          <div className="c4d-mod-card" style={{ marginTop: 10 }}>
            <div className="c4d-mod-card-head">
              <span className="c4d-mod-card-title">
                {operands.length === 0 ? 'Add Operand A (Base)' : 'Add Operand B (Cutter)'}
              </span>
            </div>
            <div className="c4d-mod-card-body">
              {availableOperandCandidates.length > 0 && (
                <SelectDropdown
                  ariaLabel="Move scene object into Boole"
                  value=""
                  actionMenu
                  placeholder="Pick existing scene object…"
                  options={availableOperandCandidates.map(c => ({
                    value: c.id,
                    label: c.name,
                  }))}
                  onChange={onAssignSceneOperand}
                />
              )}
              <div className="three" style={{ marginBlock: 2 }}>
                <button type="button" onClick={() => onSpawnCutterPrimitive('sphere')}>
                  + Sphere
                </button>
                <button type="button" onClick={() => onSpawnCutterPrimitive('cylinder')}>
                  + Cylinder
                </button>
                <button type="button" onClick={() => onSpawnCutterPrimitive('cube')}>
                  + Cube
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/* ============================================================================
 * 4. Imported 3D Asset Attribute Panel
 * ============================================================================ */

export function ImportedAssetObjectPanel({
  item,
  disabled = false,
  onSnapToFloor,
  onMakeEditable,
}: {
  item: Item;
  disabled?: boolean;
  onSnapToFloor: () => void;
  onMakeEditable: () => void;
}) {
  const runtime = item.assetId ? getRuntimeImportedAsset(item.assetId) : undefined;

  return (
    <section aria-label="Imported 3D asset info">
      <div className="section-head">
        <h3>Imported 3D Asset</h3>
        <span className="pill-badge">{(item.sourceFormat ?? '3d').toUpperCase()}</span>
      </div>
      <p className="muted" style={{ marginBottom: 6 }}>
        Source file: <code>{item.fileName ?? item.name}</code>
      </p>
      {runtime && (
        <div className="c4d-stat-row">
          <div className="c4d-stat-pill">
            <strong>{runtime.meshCount}</strong>
            <span>Meshes</span>
          </div>
          <div className="c4d-stat-pill">
            <strong>{runtime.vertexCount.toLocaleString()}</strong>
            <span>Vertices</span>
          </div>
          <div className="c4d-stat-pill">
            <strong>{runtime.faceCount.toLocaleString()}</strong>
            <span>Triangles</span>
          </div>
        </div>
      )}
      <div className="two">
        <button type="button" disabled={disabled} onClick={onSnapToFloor}>
          {C4DIcons.snapFloor} Snap to floor
        </button>
        <button type="button" disabled={disabled} onClick={onMakeEditable}>
          {C4DIcons.makeEditable} Make Editable
        </button>
      </div>
    </section>
  );
}

/* ============================================================================
 * 5. Character Appearance & Material Panel + Surface Material & Phong Tag Panel
 * ============================================================================ */

const CUSTOM_DRESS_SELECT_VALUE = '__custom_dress_map__';
interface ClothControls {
  busy:boolean; preview:boolean; settle:(item:Item)=>void; cancel:()=>void;
  equipHeld:(item:Item,grip?:TrenchGrip)=>void;
  fit: import('../garmentHandles').FitSelection | null;
  editFit:(item:Item,id:Garment|null)=>void;
  cameraView:boolean;
}

export function MannequinDressMapControls({
  item,
  cloth,
  disabled = false,
  onEdit,
}: {
  item: Item;
  cloth: ClothControls;
  disabled?: boolean;
  onEdit: (patch: Partial<Item>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  if (!isBody(item.kind)) return null;
  const bodyKind = item.kind;
  const modelId = item.modelId ?? defaultModelId(bodyKind);
  if (CHARACTERS[modelId]?.source) return null;

  const hasCustomMap = Boolean(item.customDressMapDataUrl);
  const activePresetId: MannequinDressPresetId = item.dressMapId ?? DEFAULT_MANNEQUIN_DRESS_ID;
  const activePresetMeta =
    MANNEQUIN_DRESS_PRESETS.find(p => p.id === activePresetId) ?? MANNEQUIN_DRESS_PRESETS[0]!;

  const selectOptions: SelectOption[] = [
    ...(hasCustomMap
      ? [{ value: CUSTOM_DRESS_SELECT_VALUE, label: 'Custom Uploaded Map (Active)' }]
      : []),
    ...MANNEQUIN_DRESS_PRESETS.map(p => ({
      value: p.id,
      label: p.label,
    })),
  ];

  const handleSelectChange = (val: string) => {
    setUploadError(null);
    if (val === CUSTOM_DRESS_SELECT_VALUE) return;
    if (!isMannequinDressPresetId(val)) return;
    const presetMeta = MANNEQUIN_DRESS_PRESETS.find(p => p.id === val);
    const currentOutfitHex = (item.outfitColor ?? defaultOutfitColor(bodyKind)).toLowerCase();
    const isDefaultMonochrome = currentOutfitHex === defaultOutfitColor(bodyKind).toLowerCase();
    const patch: Partial<Item> = {
      dressMapId: val,
      customDressMapDataUrl: undefined,
    };
    if (presetMeta?.recommendsOriginalColor && isDefaultMonochrome) {
      patch.outfitColor = '#ffffff';
    }
    onEdit(patch);
  };

  const handleFilePicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadError(null);
    if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
      setUploadError('Choose a PNG, JPEG, or WebP dress map.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string' && reader.result.startsWith('data:image/')) {
        onEdit({
          customDressMapDataUrl: reader.result,
          outfitColor: '#ffffff',
        });
      } else {
        setUploadError('Could not decode uploaded dress image.');
      }
    };
    reader.onerror = () => {
      setUploadError('Failed to read dress image file.');
    };
    reader.readAsDataURL(file);
  };

  return (
    <>
    {modelId === 'mannequin-female' && (
      <fieldset className="mannequin-dress-box wardrobe-controls" disabled={disabled}>
        <legend className="field-label">3D wardrobe</legend>
        {(['tank', 'skirt'] as const).map(key => (
          <label key={key}><input type="checkbox" checked={!!item.wardrobe?.[key]}
            onChange={e => onEdit({ wardrobe: { ...item.wardrobe, [key]: e.target.checked || undefined } })} />
            {key === 'tank' ? 'Tank top' : 'Pencil skirt'}
          </label>
        ))}
        <SelectDropdown ariaLabel="Outer garment" value={item.wardrobe?.outer ?? 'none'}
          options={[{ value: 'none', label: 'No outer garment' }, { value: 'jacket', label: 'Jacket' },
            { value: 'trench', label: 'Unbuttoned trench coat' }, { value: 'trenchHeld', label: 'Trench coat — held open' }]}
          onChange={outer => outer === 'trenchHeld' ? cloth.equipHeld(item) : onEdit({ wardrobe: { ...item.wardrobe,
            outer: outer === 'jacket' || outer === 'trench' ? outer : undefined, grip:undefined } })} />
        {item.wardrobe?.outer==='trenchHeld' && <SelectDropdown ariaLabel="Opening gesture" value={item.wardrobe.grip??'both'}
          options={Object.entries(TRENCH_GRIPS).map(([value,{label}])=>({value,label}))}
          onChange={v=>cloth.equipHeld(item,v as TrenchGrip)} />}
        {([item.wardrobe?.tank && 'tank', item.wardrobe?.skirt && 'skirt', item.wardrobe?.outer] as const).map(id=>{
          if (!id) return null;
          const label = id==='trenchHeld'?'Held trench':id[0].toUpperCase()+id.slice(1);
          const active = cloth.fit?.garment === id && cloth.fit.itemId === item.id;
          const node = active && cloth.fit?.node;
          const offset = node && item.wardrobe?.fit?.[id]?.[node];
          const distance = offset ? Math.hypot(...offset) : 0;
          return <div key={id} className="garment-fit-controls">
          <ColorField label={`${label} color`}
            value={item.wardrobe?.colors?.[id] ?? GARMENT_COLORS[id]} resetValue={GARMENT_COLORS[id]}
            swatches={STUDIO_DRESS_COLOR_SWATCHES}
            onChange={value=>onEdit({wardrobe:{...item.wardrobe,colors:{...item.wardrobe?.colors,[id]:value}}})} />
          <div className="cloth-actions">
            <button type="button" aria-pressed={active} className="text-btn" disabled={cloth.preview || cloth.cameraView}
              onClick={()=>cloth.editFit(item,active ? null : id)}>{active ? 'Finish editing' : `Edit ${label} fit`}</button>
            {active && <button type="button" className="text-btn" disabled={!offset}
              onClick={()=>{if(node && item.wardrobe) onEdit({wardrobe:setFitOffset(item.wardrobe,id,node)});}}>Reset node</button>}
          </div>
          {active && <p className="mannequin-dress-desc">
            {node ? `${distance >= garmentFitLimit(id)-1e-6 ? 'At limit' : offset ? 'Modified' : 'Selected'} · ${(distance*100).toFixed(1)} / ${garmentFitLimit(id)*100} cm. ` : ''}
            Drag a diamond on an edge or a dot on the fabric. Use the arrows for depth; orbit for the back.
          </p>}
          </div>;
        })}
        {(item.wardrobe?.tank || item.wardrobe?.skirt || item.wardrobe?.outer) && <>
          <span className="field-label">{cloth.preview ? 'Apply the preview pose before settling.' :
            cloth.busy ? 'Settling cloth…' : item.wardrobe.drape ? 'Drape saved for this pose' : 'Pose the figure, then settle the cloth.'}</span>
          <div className="cloth-actions">
            <button type="button" className="text-btn" disabled={cloth.preview} onClick={()=>cloth.busy?cloth.cancel():cloth.settle(item)}>
              {cloth.busy?'Cancel settle':'Settle cloth'}
            </button>
            <button type="button" className="text-btn" disabled={!item.wardrobe.drape || cloth.busy}
              onClick={()=>onEdit({wardrobe:{...item.wardrobe,drape:undefined}})}>Reset drape</button>
          </div>
        </>}
      </fieldset>
    )}
    <div className="mannequin-dress-box" aria-label="Dress and outfit image map controls">
      <div className="mannequin-dress-head">
        <span className="field-label">Dress / Outfit Map</span>
        {hasCustomMap ? (
          <span className="pill-badge">Custom Map</span>
        ) : (
          <span className="pill-badge">2048×2048 UV</span>
        )}
      </div>
      <div className="select-field">
        <SelectDropdown
          ariaLabel="Dress / Outfit Map"
          value={hasCustomMap ? CUSTOM_DRESS_SELECT_VALUE : activePresetId}
          options={selectOptions}
          onChange={handleSelectChange}
        />
      </div>
      <p className="mannequin-dress-desc">
        {hasCustomMap
          ? 'Custom Front/Back image map applied directly over the 2048×2048 mannequin UV layout.'
          : activePresetMeta.description}
      </p>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label="Upload custom dress image map"
        disabled={disabled}
        onChange={handleFilePicked}
      />
      <div className="mannequin-dress-actions">
        <TooltipButton
          className="text-btn mannequin-dress-btn"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
          tooltip="Upload Dress Map"
          tooltipDescription="Apply any custom or AI-generated 2048×2048 Front/Back PNG, JPEG, or WebP outfit map"
          tooltipPlacement="top"
        >
          {Icons.upload} Upload Dress Map
        </TooltipButton>
        {hasCustomMap && (
          <TooltipButton
            className="text-btn mannequin-dress-btn"
            disabled={disabled}
            onClick={() => {
              setUploadError(null);
              onEdit({ customDressMapDataUrl: undefined });
            }}
            tooltip="Clear Custom Map"
            tooltipDescription="Revert from the custom uploaded image map back to the selected built-in outfit"
            tooltipPlacement="top"
          >
            Clear Custom Map
          </TooltipButton>
        )}
        <TooltipButton
          className="text-btn mannequin-dress-btn"
          disabled={disabled}
          onClick={() => {
            downloadMannequinDressTemplate(bodyKind);
          }}
          tooltip="Download AI Dress Template"
          tooltipDescription={AI_DRESS_PROMPT_GUIDE}
          tooltipPlacement="top"
        >
          {Icons.download} Download AI Dress Template
        </TooltipButton>
      </div>
      {uploadError && (
        <p className="mannequin-dress-error" role="status">
          {uploadError}
        </p>
      )}
    </div>
    </>
  );
}

export function CharacterMaterialPanel({
  item,
  cloth,
  hairOptions,
  disabled = false,
  onEdit,
}: {
  item: Item;
  cloth: ClothControls;
  hairOptions: SelectOption[];
  disabled?: boolean;
  onEdit: (patch: Partial<Item>) => void;
}) {
  if (!isBody(item.kind)) return null;
  const modelId = item.modelId ?? defaultModelId(item.kind);
  const character = CHARACTERS[modelId];
  const isAuthoredRig = Boolean(character?.source);
  const hasDressSlot = hasCharacterOutfitSlot(modelId);
  const authoredHair = hasAuthoredHair(modelId);
  const activePresetMeta = !isAuthoredRig
    ? MANNEQUIN_DRESS_PRESETS.find(p => p.id === (item.dressMapId ?? DEFAULT_MANNEQUIN_DRESS_ID))
    : undefined;
  const prefersOriginalDressHex =
    isAuthoredRig || Boolean(item.customDressMapDataUrl) || Boolean(activePresetMeta?.recommendsOriginalColor);

  return (
    <section aria-label="Character materials and appearance">
      <div className="section-head">
        <h3>Character Materials</h3>
        <span className="pill-badge">{character?.label ?? item.kind}</span>
      </div>
      <div
        className="field-block"
        style={disabled ? { opacity: 0.55, pointerEvents: 'none' } : undefined}
      >
        <ColorField
          label="Skin tone"
          value={item.color}
          resetValue={isAuthoredRig ? '#ffffff' : defaultSkinColor(item.kind)}
          resetLabel={isAuthoredRig ? 'Original' : 'Default'}
          swatches={isAuthoredRig ? AUTHORED_SKIN_TONE_SWATCHES : STUDIO_SKIN_TONE_SWATCHES}
          onChange={color => onEdit({ color })}
        />
        {!isAuthoredRig && (
          <MannequinDressMapControls item={item} cloth={cloth} disabled={disabled} onEdit={onEdit} />
        )}
        {hasDressSlot ? (
          <ColorField
            label="Dress color"
            value={
              item.outfitColor ??
              (isAuthoredRig ? '#ffffff' : defaultOutfitColor(item.kind))
            }
            resetValue={prefersOriginalDressHex ? '#ffffff' : defaultOutfitColor(item.kind)}
            resetLabel={prefersOriginalDressHex ? 'Original' : 'Default'}
            swatches={AUTHORED_DRESS_COLOR_SWATCHES}
            onChange={outfitColor => onEdit({ outfitColor })}
          />
        ) : (
          <p className="muted" style={{ marginBlock: 2 }}>
            Unclothed anatomical base model — select a clothed character to customize dress color.
          </p>
        )}
        {!authoredHair && (
          <div className="select-field">
            <span className="field-label">Hairstyle</span>
            <SelectDropdown
              ariaLabel="Hairstyle"
              value={item.hairStyle ?? defaultCharacterHairStyle(item.kind, modelId)}
              options={hairOptions}
              onChange={v => onEdit({ hairStyle: v as HairStyleId })}
            />
          </div>
        )}
        <ColorField
          label={authoredHair ? 'Hair tint' : 'Hair & brow color'}
          value={item.hairColor ?? (authoredHair ? '#ffffff' : DEFAULT_HAIR_COLOR)}
          resetValue={authoredHair ? '#ffffff' : DEFAULT_HAIR_COLOR}
          resetLabel={authoredHair ? 'Original' : 'Default'}
          swatches={authoredHair ? AUTHORED_HAIR_COLOR_SWATCHES : STUDIO_HAIR_COLOR_SWATCHES}
          onChange={hairColor => onEdit({ hairColor })}
        />
      </div>
    </section>
  );
}

export function MaterialTagPanel({
  item,
  disabled = false,
  onEdit,
}: {
  item: Item;
  disabled?: boolean;
  onEdit: (patch: Partial<Item>) => void;
}) {
  const roughness = item.roughness ?? 0.62;
  const metalness = item.metalness ?? 0.06;
  const phongAngle = item.phongAngleDeg ?? 40;

  return (
    <section aria-label="Surface material and Phong tag">
      <div className="section-head">
        <h3>Material & Phong Tag</h3>
        <span className="pill-badge">{Math.round(phongAngle)}° Phong</span>
      </div>
      <div className="field-block" style={disabled ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
        <ColorField
          label="Surface color"
          value={item.color}
          swatches={MATERIAL_SWATCHES}
          onChange={color => onEdit({ color })}
        />
        <SliderField
          label="Roughness"
          value={roughness}
          min={0}
          max={1}
          step={0.02}
          displayValue={`${Math.round(roughness * 100)}%`}
          onChange={next => onEdit({ roughness: next })}
        />
        <SliderField
          label="Metalness"
          value={metalness}
          min={0}
          max={1}
          step={0.02}
          displayValue={`${Math.round(metalness * 100)}%`}
          onChange={next => onEdit({ metalness: next })}
        />
        <SliderField
          label="Phong smoothing angle"
          value={phongAngle}
          min={0}
          max={180}
          step={1}
          displayValue={`${Math.round(phongAngle)}°`}
          onChange={next =>
            onEdit({
              phongAngleDeg: next,
              ...(item.editableMesh
                ? { editableMesh: { ...item.editableMesh, phongAngleDeg: next } }
                : {}),
            })
          }
        />
      </div>
    </section>
  );
}

/* ============================================================================
 * 6. Non-Destructive Modifier Stack Panel (All 8 C4D Modifiers / Deformers)
 * ============================================================================ */

export function ModifierStackPanel({
  targetName,
  modifiers,
  focusedModifierId,
  disabled = false,
  onAddModifier,
  onUpdateModifier,
  onMoveModifier,
  onRemoveModifier,
  onBakeToMesh,
}: {
  targetName: string;
  modifiers: readonly ModifierSpec[];
  focusedModifierId: string | null;
  disabled?: boolean;
  onAddModifier: (type: ModifierType) => void;
  onUpdateModifier: (modId: string, updater: (mod: ModifierSpec) => ModifierSpec) => void;
  onMoveModifier: (modId: string, delta: -1 | 1) => void;
  onRemoveModifier: (modId: string) => void;
  onBakeToMesh?: () => void;
}) {
  return (
    <section aria-label="Non-destructive modifier stack">
      <div className="section-head">
        <h3>Modifiers · {targetName}</h3>
        <span className="pill-badge">{modifiers.length}</span>
      </div>
      <p className="muted">
        Attach non-destructive Cinema 4D generators & deformers in evaluation order (top → bottom).
      </p>

      <div className="c4d-tool-grid" style={disabled ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
        {MODIFIER_TYPES.map(type => (
          <button key={type} type="button" onClick={() => onAddModifier(type)}>
            {getModifierIcon(type)}
            <span>{MODIFIER_LABELS[type].split(' / ')[0]}</span>
          </button>
        ))}
      </div>

      {modifiers.length === 0 ? (
        <div className="empty-card">
          No modifiers attached yet. Click any modifier above (or from the top <strong>Modifiers ▾</strong> palette) to attach it to <strong>{targetName}</strong>.
        </div>
      ) : (
        <div className="c4d-mod-stack" style={disabled ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
          {modifiers.map((mod, idx) => {
            const focused = mod.id === focusedModifierId;
            return (
              <div key={mod.id} className={focused ? 'c4d-mod-card focused' : 'c4d-mod-card'}>
                <div className="c4d-mod-card-head">
                  <span className="c4d-mod-card-title">
                    {getModifierIcon(mod.type)}
                    <span>{mod.name}</span>
                  </span>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <TooltipButton
                      className={`icon-btn layer-action-btn ${mod.enabled ? 'is-gen-on' : 'is-off'}`}
                      aria-label={mod.enabled ? `Disable ${mod.name}` : `Enable ${mod.name}`}
                      tooltip={mod.enabled ? `Disable ${mod.name}` : `Enable ${mod.name}`}
                      tooltipDescription={mod.enabled ? 'Modifier enabled' : 'Modifier disabled'}
                      tooltipPlacement="top"
                      onClick={() =>
                        onUpdateModifier(mod.id, m => ({ ...m, enabled: !m.enabled }))
                      }
                    >
                      {Icons.check}
                    </TooltipButton>
                    <TooltipButton
                      className="icon-btn layer-action-btn"
                      aria-label={`Move ${mod.name} up`}
                      tooltip="Move earlier in stack"
                      tooltipPlacement="top"
                      disabled={idx === 0}
                      onClick={() => onMoveModifier(mod.id, -1)}
                    >
                      ↑
                    </TooltipButton>
                    <TooltipButton
                      className="icon-btn layer-action-btn"
                      aria-label={`Move ${mod.name} down`}
                      tooltip="Move later in stack"
                      tooltipPlacement="top"
                      disabled={idx === modifiers.length - 1}
                      onClick={() => onMoveModifier(mod.id, 1)}
                    >
                      ↓
                    </TooltipButton>
                    <TooltipButton
                      className="icon-btn danger-hover layer-action-btn"
                      aria-label={`Remove ${mod.name}`}
                      tooltip={`Remove ${mod.name}`}
                      tooltipPlacement="top"
                      onClick={() => onRemoveModifier(mod.id)}
                    >
                      {Icons.trash}
                    </TooltipButton>
                  </div>
                </div>

                <div className="c4d-mod-card-body">
                  {mod.type === 'bevel' && (
                    <>
                      <SliderField
                        label="Offset width"
                        value={mod.params.width}
                        min={0.002}
                        max={0.5}
                        step={0.005}
                        displayValue={`${mod.params.width.toFixed(3)} m`}
                        onChange={width =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'bevel' ? { ...m, params: { ...m.params, width } } : m,
                          )
                        }
                      />
                      <SliderField
                        label="Subdivisions"
                        value={mod.params.segments}
                        min={1}
                        max={6}
                        step={1}
                        displayValue={mod.params.segments <= 1 ? '1 (Chamfer)' : `${mod.params.segments} (Fillet)`}
                        onChange={segments =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'bevel'
                              ? { ...m, params: { ...m.params, segments: Math.round(segments) } }
                              : m,
                          )
                        }
                      />
                      <SliderField
                        label="Angle threshold"
                        value={mod.params.angleThresholdDeg}
                        min={5}
                        max={120}
                        step={1}
                        displayValue={`${Math.round(mod.params.angleThresholdDeg)}°`}
                        onChange={angleThresholdDeg =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'bevel'
                              ? { ...m, params: { ...m.params, angleThresholdDeg } }
                              : m,
                          )
                        }
                      />
                    </>
                  )}

                  {mod.type === 'subdivision' && (
                    <>
                      <SegmentedControl
                        ariaLabel="Subdivision levels"
                        fullWidth
                        value={String(mod.params.levels) as '1' | '2' | '3'}
                        items={[
                          { value: '1', label: 'Level 1' },
                          { value: '2', label: 'Level 2' },
                          { value: '3', label: 'Level 3' },
                        ]}
                        onChange={lvl =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'subdivision'
                              ? { ...m, params: { ...m.params, levels: Number(lvl) as 1 | 2 | 3 } }
                              : m,
                          )
                        }
                      />
                      <SwitchRow
                        label="Catmull-Clark smoothing"
                        checked={mod.params.smooth !== false}
                        onChange={smooth =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'subdivision' ? { ...m, params: { ...m.params, smooth } } : m,
                          )
                        }
                      />
                    </>
                  )}

                  {mod.type === 'mirror' && (
                    <>
                      <SegmentedControl
                        ariaLabel="Symmetry plane axis"
                        fullWidth
                        value={mod.params.axis}
                        items={AXIS_ITEMS}
                        onChange={axis =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'mirror' ? { ...m, params: { ...m.params, axis } } : m,
                          )
                        }
                      />
                      <SliderField
                        label="Mirror plane offset"
                        value={mod.params.offset}
                        min={-5}
                        max={5}
                        step={0.05}
                        displayValue={`${mod.params.offset.toFixed(2)} m`}
                        onChange={offset =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'mirror' ? { ...m, params: { ...m.params, offset } } : m,
                          )
                        }
                      />
                      <SwitchRow
                        label="Weld seam"
                        checked={mod.params.bisect}
                        onChange={bisect =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'mirror' ? { ...m, params: { ...m.params, bisect } } : m,
                          )
                        }
                      />
                    </>
                  )}

                  {mod.type === 'solidify' && (
                    <>
                      <SliderField
                        label="Wall thickness"
                        value={mod.params.thickness}
                        min={-1}
                        max={1}
                        step={0.01}
                        displayValue={`${mod.params.thickness.toFixed(2)} m`}
                        onChange={thickness =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'solidify' ? { ...m, params: { ...m.params, thickness } } : m,
                          )
                        }
                      />
                      <SwitchRow
                        label="Even thickness"
                        checked={mod.params.evenThickness}
                        onChange={evenThickness =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'solidify' ? { ...m, params: { ...m.params, evenThickness } } : m,
                          )
                        }
                      />
                    </>
                  )}

                  {mod.type === 'bend' && (
                    <>
                      <SegmentedControl
                        ariaLabel="Bend axis"
                        fullWidth
                        value={mod.params.axis}
                        items={AXIS_ITEMS}
                        onChange={axis =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'bend' ? { ...m, params: { ...m.params, axis } } : m,
                          )
                        }
                      />
                      <SliderField
                        label="Bend strength"
                        value={mod.params.angleDeg}
                        min={-180}
                        max={180}
                        step={1}
                        displayValue={`${Math.round(mod.params.angleDeg)}°`}
                        onChange={angleDeg =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'bend' ? { ...m, params: { ...m.params, angleDeg } } : m,
                          )
                        }
                      />
                      <SliderField
                        label="Bend direction"
                        value={mod.params.directionDeg}
                        min={-180}
                        max={180}
                        step={5}
                        displayValue={`${Math.round(mod.params.directionDeg)}°`}
                        onChange={directionDeg =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'bend' ? { ...m, params: { ...m.params, directionDeg } } : m,
                          )
                        }
                      />
                    </>
                  )}

                  {mod.type === 'twist' && (
                    <>
                      <SegmentedControl
                        ariaLabel="Twist axis"
                        fullWidth
                        value={mod.params.axis}
                        items={AXIS_ITEMS}
                        onChange={axis =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'twist' ? { ...m, params: { ...m.params, axis } } : m,
                          )
                        }
                      />
                      <SliderField
                        label="Twist angle"
                        value={mod.params.angleDeg}
                        min={-360}
                        max={360}
                        step={5}
                        displayValue={`${Math.round(mod.params.angleDeg)}°`}
                        onChange={angleDeg =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'twist' ? { ...m, params: { ...m.params, angleDeg } } : m,
                          )
                        }
                      />
                    </>
                  )}

                  {mod.type === 'taper' && (
                    <>
                      <SegmentedControl
                        ariaLabel="Taper axis"
                        fullWidth
                        value={mod.params.axis}
                        items={AXIS_ITEMS}
                        onChange={axis =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'taper' ? { ...m, params: { ...m.params, axis } } : m,
                          )
                        }
                      />
                      <SliderField
                        label="Taper strength"
                        value={mod.params.strength}
                        min={-0.95}
                        max={2}
                        step={0.05}
                        displayValue={`${Math.round(mod.params.strength * 100)}%`}
                        onChange={strength =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'taper' ? { ...m, params: { ...m.params, strength } } : m,
                          )
                        }
                      />
                      <SliderField
                        label="Curvature"
                        value={mod.params.curvature}
                        min={-1}
                        max={1}
                        step={0.05}
                        displayValue={`${Math.round(mod.params.curvature * 100)}%`}
                        onChange={curvature =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'taper' ? { ...m, params: { ...m.params, curvature } } : m,
                          )
                        }
                      />
                    </>
                  )}

                  {mod.type === 'array' && (
                    <>
                      <SegmentedControl
                        ariaLabel="Array cloner mode"
                        fullWidth
                        value={mod.params.mode}
                        items={[
                          { value: 'linear', label: 'Linear' },
                          { value: 'radial', label: 'Radial' },
                        ]}
                        onChange={arrayMode =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'array' ? { ...m, params: { ...m.params, mode: arrayMode } } : m,
                          )
                        }
                      />
                      <SliderField
                        label="Clone count"
                        value={mod.params.count}
                        min={1}
                        max={24}
                        step={1}
                        displayValue={`${mod.params.count}`}
                        onChange={count =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'array'
                              ? { ...m, params: { ...m.params, count: Math.round(count) } }
                              : m,
                          )
                        }
                      />
                      {mod.params.mode === 'linear' ? (
                        <Vector3Field
                          label="Step offset (m)"
                          value={mod.params.offset}
                          min={-20}
                          max={20}
                          step={0.1}
                          onChange={offset =>
                            onUpdateModifier(mod.id, m =>
                              m.type === 'array' ? { ...m, params: { ...m.params, offset } } : m,
                            )
                          }
                        />
                      ) : (
                        <SliderField
                          label="Radial ring radius"
                          value={mod.params.radius}
                          min={0.1}
                          max={25}
                          step={0.1}
                          displayValue={`${mod.params.radius.toFixed(2)} m`}
                          onChange={radius =>
                            onUpdateModifier(mod.id, m =>
                              m.type === 'array' ? { ...m, params: { ...m.params, radius } } : m,
                            )
                          }
                        />
                      )}
                      <Vector3Field
                        label="Step rotation (°)"
                        value={mod.params.stepRotationDeg}
                        min={-180}
                        max={180}
                        step={5}
                        precision={1}
                        onChange={stepRotationDeg =>
                          onUpdateModifier(mod.id, m =>
                            m.type === 'array' ? { ...m, params: { ...m.params, stepRotationDeg } } : m,
                          )
                        }
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}

          {onBakeToMesh && (
            <button type="button" className="full-btn" onClick={onBakeToMesh}>
              {C4DIcons.makeEditable} Bake Modifier Stack to Editable Mesh
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/* ============================================================================
 * 6. Hand & Finger Articulation Panel (Pose Tab)
 * ============================================================================ */

export type HandEditTarget = 'left' | 'right' | 'both';

const FINGER_LABELS: Record<FingerId, string> = {
  thumb: 'Thumb',
  index: 'Index',
  middle: 'Middle',
  ring: 'Ring',
  pinky: 'Pinky',
};

function matchesHandPreset(spec: HandPoseSpec | undefined, presetName: HandPresetName): boolean {
  const target = handPreset(presetName);
  const s = spec ?? defaultHandPose();
  return (
    Math.abs(s.thumb - target.thumb) < 0.025 &&
    Math.abs(s.index - target.index) < 0.025 &&
    Math.abs(s.middle - target.middle) < 0.025 &&
    Math.abs(s.ring - target.ring) < 0.025 &&
    Math.abs(s.pinky - target.pinky) < 0.025 &&
    Math.abs(s.spread - target.spread) < 0.035 &&
    Math.abs(s.thumbOpposition - target.thumbOpposition) < 0.035
  );
}

export function HandArticulationPanel({
  handPose,
  activeJoint,
  hasFingers,
  onChangeHandPose,
  onSelectWristJoint,
}: {
  handPose?: CharacterHandPoses;
  activeJoint: Joint | null;
  hasFingers: boolean;
  onChangeHandPose: (next: CharacterHandPoses | undefined) => void;
  onSelectWristJoint?: (joint: 'leftWrist' | 'rightWrist') => void;
}) {
  const [targetSide, setTargetSide] = useState<HandEditTarget>(() =>
    activeJoint === 'rightWrist' ? 'right' : 'left',
  );

  useEffect(() => {
    if (activeJoint === 'leftWrist') setTargetSide('left');
    else if (activeJoint === 'rightWrist') setTargetSide('right');
  }, [activeJoint]);

  const displaySide: HandSide = targetSide === 'right' ? 'right' : 'left';
  const activeSpec =
    targetSide === 'both'
      ? handPose?.left ?? handPose?.right ?? defaultHandPose()
      : handPose?.[displaySide] ?? defaultHandPose();

  const updateTargetSpecs = (updater: (prev: HandPoseSpec | undefined) => HandPoseSpec | undefined) => {
    const next: CharacterHandPoses = handPose ? clone(handPose) : {};
    if (targetSide === 'left' || targetSide === 'both') {
      const updatedL = updater(next.left);
      if (updatedL && !isNeutralHandPose(updatedL)) next.left = updatedL;
      else delete next.left;
    }
    if (targetSide === 'right' || targetSide === 'both') {
      const updatedR = updater(next.right);
      if (updatedR && !isNeutralHandPose(updatedR)) next.right = updatedR;
      else delete next.right;
    }
    onChangeHandPose(normalizeCharacterHandPoses(next));
  };

  const masterCurl = computeMasterHandCurl(activeSpec);
  const canReset =
    targetSide === 'both'
      ? !isNeutralHandPose(handPose?.left) || !isNeutralHandPose(handPose?.right)
      : !isNeutralHandPose(handPose?.[displaySide]);

  const formatPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`;

  return (
    <div className="hand-pose-panel" role="region" aria-label="Hand and finger articulation">
      <div className="field-head">
        <span className="field-label">Hand &amp; Fingers</span>
        {onSelectWristJoint && (
          <div className="hand-wrist-jump">
            <button
              type="button"
              className={activeJoint === 'leftWrist' ? 'chip-mini active' : 'chip-mini'}
              onClick={() => {
                setTargetSide('left');
                onSelectWristJoint('leftWrist');
              }}
            >
              L Wrist
            </button>
            <button
              type="button"
              className={activeJoint === 'rightWrist' ? 'chip-mini active' : 'chip-mini'}
              onClick={() => {
                setTargetSide('right');
                onSelectWristJoint('rightWrist');
              }}
            >
              R Wrist
            </button>
          </div>
        )}
      </div>

      {!hasFingers ? (
        <p className="muted" style={{ margin: 0 }}>
          This character uses a simplified mitten hand mesh (no individual finger bones). Wrist flexion, twist, and tilt remain unrestricted.
        </p>
      ) : (
        <>
          <SegmentedControl
            ariaLabel="Hand posing target"
            fullWidth
            value={targetSide}
            items={[
              { value: 'left', label: 'L Hand' },
              { value: 'right', label: 'R Hand' },
              { value: 'both', label: 'Both' },
            ]}
            onChange={v => setTargetSide(v as HandEditTarget)}
          />

          <span className="field-label">Hand gestures</span>
          <div className="hand-preset-grid" role="group" aria-label="Hand pose presets">
            {HAND_PRESETS.map(p => {
              const isCurrent =
                targetSide === 'both'
                  ? matchesHandPreset(handPose?.left, p) && matchesHandPreset(handPose?.right, p)
                  : matchesHandPreset(handPose?.[displaySide], p);
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={isCurrent}
                  className={isCurrent ? 'hand-preset-chip active' : 'hand-preset-chip'}
                  onClick={() => updateTargetSpecs(() => handPreset(p))}
                >
                  {p === 'Open' ? 'Open Palm' : p}
                </button>
              );
            })}
          </div>

          <div className="hand-slider-stack">
            <SliderField
              label="Master Curl"
              value={Number(masterCurl.toFixed(2))}
              min={HAND_CURL_MIN}
              max={HAND_CURL_MAX}
              step={0.02}
              displayValue={formatPct(masterCurl)}
              onChange={v => updateTargetSpecs(prev => applyMasterHandCurl(prev, v))}
            />
            <SliderField
              label="Finger Spread"
              value={Number(activeSpec.spread.toFixed(2))}
              min={HAND_SPREAD_MIN}
              max={HAND_SPREAD_MAX}
              step={0.02}
              displayValue={formatPct(activeSpec.spread)}
              onChange={spread =>
                updateTargetSpecs(prev => ({
                  ...(prev ? clone(prev) : defaultHandPose()),
                  spread,
                }))
              }
            />
          </div>

          <details
            className="hand-digits-details"
            open={activeJoint === 'leftWrist' || activeJoint === 'rightWrist'}
          >
            <summary>Individual Fingers (Thumb – Pinky)</summary>
            <div className="hand-slider-stack">
              {FINGER_IDS.map(finger => (
                <SliderField
                  key={finger}
                  label={`${FINGER_LABELS[finger]} Curl`}
                  value={Number(activeSpec[finger].toFixed(2))}
                  min={HAND_CURL_MIN}
                  max={HAND_CURL_MAX}
                  step={0.02}
                  displayValue={formatPct(activeSpec[finger])}
                  onChange={val =>
                    updateTargetSpecs(prev => ({
                      ...(prev ? clone(prev) : defaultHandPose()),
                      [finger]: val,
                    }))
                  }
                />
              ))}
              <SliderField
                label="Thumb Oppose"
                value={Number(activeSpec.thumbOpposition.toFixed(2))}
                min={HAND_OPPOSITION_MIN}
                max={HAND_OPPOSITION_MAX}
                step={0.02}
                displayValue={formatPct(activeSpec.thumbOpposition)}
                onChange={thumbOpposition =>
                  updateTargetSpecs(prev => ({
                    ...(prev ? clone(prev) : defaultHandPose()),
                    thumbOpposition,
                  }))
                }
              />
            </div>
          </details>

          <button
            type="button"
            className="full-btn"
            disabled={!canReset}
            onClick={() => updateTargetSpecs(() => undefined)}
          >
            Reset {targetSide === 'both' ? 'Both Hands' : targetSide === 'left' ? 'Left Hand' : 'Right Hand'}
          </button>
        </>
      )}
    </div>
  );
}

