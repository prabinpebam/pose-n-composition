import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { BooleanOpType, ModifierType, PrimitiveKind } from '../modeling/types';
import {
  computeAnchoredTooltipPosition,
  computeFlyoutMenuPosition,
  type PointerCoords,
  type TooltipPlacement,
} from './tooltipPositioning';
import { useStudioTooltip } from './studioTooltip';

export type { TooltipPlacement } from './tooltipPositioning';

/* ============================================================================
 * Cinema 4D 17x17 Vector Icon Set (`currentColor` + `var(--cp-accent)` highlights)
 * Zero hardcoded hex/rgb values — 100% theme-adaptive across Light & Dark Studio.
 * ============================================================================ */

const svgProps = {
  width: 17,
  height: 17,
  viewBox: '0 0 18 18',
  fill: 'none',
  'aria-hidden': true as const,
};

export const C4DIcons = {
  /* --- Modes & Coordinate Spaces --- */
  objectMode: (
    <svg {...svgProps}>
      <path d="M9 2.2 14.8 5.5v7L9 15.8 3.2 12.5v-7L9 2.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3.4 5.6 9 8.8l5.6-3.2M9 8.8v6.8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 2.2V0.9M14.8 12.5l1.1.7M3.2 12.5l-1.1.7" stroke="var(--cp-accent)" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  pointMode: (
    <svg {...svgProps}>
      <path d="M4.2 4.8h9.6v8.4H4.2V4.8Z" stroke="currentColor" strokeWidth="1.2" strokeDasharray="1.8 1.8" />
      <circle cx="4.2" cy="4.8" r="2" fill="var(--cp-accent)" />
      <circle cx="13.8" cy="4.8" r="1.8" fill="currentColor" />
      <circle cx="4.2" cy="13.2" r="1.8" fill="currentColor" />
      <circle cx="13.8" cy="13.2" r="2" fill="var(--cp-accent)" />
      <circle cx="9" cy="9" r="2" fill="var(--cp-accent)" />
    </svg>
  ),
  edgeMode: (
    <svg {...svgProps}>
      <path d="M9 2.4 14.7 5.7v6.6L9 15.6 3.3 12.3V5.7L9 2.4Z" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.65" strokeLinejoin="round" />
      <path d="M3.3 5.7 9 9l5.7-3.3M9 9v6.6" stroke="var(--cp-accent)" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  polygonMode: (
    <svg {...svgProps}>
      <path d="M9 2.3 14.8 5.6v6.8L9 15.7 3.2 12.4V5.6L9 2.3Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M9 9 14.7 5.7v6.6L9 15.6V9Z" fill="var(--cp-accent)" fillOpacity="0.45" />
      <path d="M3.3 5.7 9 9l5.7-3.3M9 9v6.6" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  ),
  makeEditable: (
    <svg {...svgProps}>
      <circle cx="5.2" cy="5.4" r="2.6" stroke="currentColor" strokeWidth="1.35" />
      <path d="M8.6 5.4h2.5m0 0-1.3-1.3m1.3 1.3-1.3 1.3" stroke="var(--cp-accent)" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.8 10.1 12.5 8l3.3 2.1v3.8L12.5 16l-3.7-2.1v-3.8Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <circle cx="8.8" cy="10.1" r="1.2" fill="var(--cp-accent)" />
      <circle cx="12.5" cy="8" r="1.2" fill="var(--cp-accent)" />
      <circle cx="15.8" cy="10.1" r="1.2" fill="var(--cp-accent)" />
    </svg>
  ),
  wireframeOverlay: (
    <svg {...svgProps}>
      <rect x="2.8" y="2.8" width="12.4" height="12.4" rx="1.6" stroke="currentColor" strokeWidth="1.35" />
      <path d="M2.8 7h12.4M2.8 11h12.4M7 2.8v12.4M11 2.8v12.4" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  ),
  worldSpace: (
    <svg {...svgProps}>
      <circle cx="9" cy="9" r="6.3" stroke="currentColor" strokeWidth="1.35" />
      <ellipse cx="9" cy="9" rx="3" ry="6.3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.8 9h12.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  localSpace: (
    <svg {...svgProps}>
      <path d="M9 9V3.1m0 0L7.3 4.8M9 3.1l1.7 1.7" stroke="var(--cp-accent)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 9l5.2 3m0 0-2.1.4m2.1-.4-.6-2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 9 3.8 12" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <circle cx="9" cy="9" r="1.4" fill="currentColor" />
    </svg>
  ),
  moveTool: (
    <svg {...svgProps}>
      <path d="M9 2.2v13.6M2.2 9h13.6M9 2.2 7.2 4M9 2.2 10.8 4M9 15.8 7.2 14M9 15.8 10.8 14M2.2 9 4 7.2M2.2 9 4 10.8M15.8 9 14 7.2M15.8 9 14 10.8" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  rotateTool: (
    <svg {...svgProps}>
      <path d="M14.5 8.5a5.6 5.6 0 1 0-1.5 4.3" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M12.2 5.4h2.7V2.7" stroke="var(--cp-accent)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  scaleTool: (
    <svg {...svgProps}>
      <rect x="2.8" y="7.8" width="7.4" height="7.4" rx="1" stroke="currentColor" strokeWidth="1.35" />
      <path d="M10.8 7.2 15 3m0 0h-3.1M15 3v3.1" stroke="var(--cp-accent)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),

  /* --- 11 Parametric Primitives (+ Fillet Cube) --- */
  primCube: (
    <svg {...svgProps}>
      <path d="M9 2.2 14.8 5.5v7L9 15.8 3.2 12.5v-7L9 2.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3.4 5.6 9 8.8l5.6-3.2M9 8.8v6.9" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  primFilletCube: (
    <svg {...svgProps}>
      <rect x="3.1" y="3.1" width="11.8" height="11.8" rx="3.4" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5.2 6.8h7.6M6.8 5.2v7.6" stroke="var(--cp-accent)" strokeWidth="1.15" strokeLinecap="round" />
    </svg>
  ),
  primSphere: (
    <svg {...svgProps}>
      <circle cx="9" cy="9" r="6.3" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="9" cy="9" rx="6.3" ry="2.4" stroke="currentColor" strokeWidth="1.15" />
      <ellipse cx="9" cy="9" rx="2.4" ry="6.3" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  ),
  primCylinder: (
    <svg {...svgProps}>
      <ellipse cx="9" cy="4.4" rx="5.2" ry="2.1" stroke="currentColor" strokeWidth="1.35" />
      <path d="M3.8 4.4v9.2c0 1.16 2.33 2.1 5.2 2.1s5.2-.94 5.2-2.1V4.4" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  ),
  primCone: (
    <svg {...svgProps}>
      <path d="M9 2.5 3.6 13.4c0 1.2 2.42 2.1 5.4 2.1s5.4-.9 5.4-2.1L9 2.5Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M3.7 13.3c.5-.9 2.7-1.6 5.3-1.6s4.8.7 5.3 1.6" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.6 1.6" />
    </svg>
  ),
  primPyramid: (
    <svg {...svgProps}>
      <path d="M9 2.4 2.8 12.6 9 15.6l6.2-3L9 2.4Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M9 2.4v13.2" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  ),
  primTorus: (
    <svg {...svgProps}>
      <ellipse cx="9" cy="9.3" rx="6.5" ry="4.4" stroke="currentColor" strokeWidth="1.4" />
      <ellipse cx="9" cy="9.1" rx="2.6" ry="1.5" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  ),
  primCapsule: (
    <svg {...svgProps}>
      <rect x="4.8" y="2.2" width="8.4" height="13.6" rx="4.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.9 6.6h8.2M4.9 11.4h8.2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  primTube: (
    <svg {...svgProps}>
      <ellipse cx="9" cy="4.7" rx="5.6" ry="2.3" stroke="currentColor" strokeWidth="1.35" />
      <ellipse cx="9" cy="4.7" rx="2.5" ry="1" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3.4 4.7v8.6c0 1.27 2.5 2.3 5.6 2.3s5.6-1.03 5.6-2.3V4.7" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  ),
  primPlane: (
    <svg {...svgProps}>
      <path d="M9 4.2 15.8 8.6 9 13.8 2.2 8.6 9 4.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5.6 6.4 12.4 11.2M12.4 6.4 5.6 11.2" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  primDisc: (
    <svg {...svgProps}>
      <ellipse cx="9" cy="9" rx="6.4" ry="4.1" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9" cy="9" r="1.2" fill="currentColor" />
      <path d="M9 4.9v8.2M2.6 9h12.8" stroke="currentColor" strokeWidth="1.05" />
    </svg>
  ),
  primPlatonic: (
    <svg {...svgProps}>
      <path d="M9 2 15.2 6.2l-2.4 9.1H5.2L2.8 6.2 9 2Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M9 2v6.6m0 0L2.8 6.2M9 8.6l6.2-2.4M9 8.6l-3.8 6.7M9 8.6l3.8 6.7" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
    </svg>
  ),

  /* --- Generators / Booleans --- */
  booleGroup: (
    <svg {...svgProps}>
      <circle cx="7" cy="7.6" r="4.3" stroke="currentColor" strokeWidth="1.35" />
      <rect x="7.4" y="6.8" width="7.2" height="7.2" rx="1.1" stroke="var(--cp-accent)" strokeWidth="1.35" />
    </svg>
  ),
  booleUnion: (
    <svg {...svgProps}>
      <circle cx="6.8" cy="9" r="4.2" fill="var(--cp-accent)" fillOpacity="0.28" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="11.2" cy="9" r="4.2" fill="var(--cp-accent)" fillOpacity="0.28" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  ),
  booleSubtract: (
    <svg {...svgProps}>
      <circle cx="6.8" cy="9" r="4.3" fill="var(--cp-accent)" fillOpacity="0.35" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="11.3" cy="9" r="4.1" stroke="currentColor" strokeWidth="1.3" strokeDasharray="1.8 1.6" />
    </svg>
  ),
  booleIntersect: (
    <svg {...svgProps}>
      <circle cx="6.8" cy="9" r="4.2" stroke="currentColor" strokeWidth="1.25" strokeOpacity="0.7" />
      <circle cx="11.2" cy="9" r="4.2" stroke="currentColor" strokeWidth="1.25" strokeOpacity="0.7" />
      <path d="M9 5.5a4.2 4.2 0 0 1 0 7 4.2 4.2 0 0 1 0-7Z" fill="var(--cp-accent)" />
    </svg>
  ),

  /* --- 8 Non-Destructive Modifiers / Deformers --- */
  modBevel: (
    <svg {...svgProps}>
      <path d="M3.2 14.8V7.6L7.6 3.2h7.2v11.6H3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3.2 7.6 7.6 3.2" stroke="var(--cp-accent)" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  ),
  modSubdivision: (
    <svg {...svgProps}>
      <rect x="2.6" y="2.6" width="12.8" height="12.8" rx="1.4" stroke="currentColor" strokeWidth="1.1" strokeDasharray="1.8 1.8" />
      <circle cx="9" cy="9" r="4.6" stroke="var(--cp-accent)" strokeWidth="1.5" />
    </svg>
  ),
  modMirror: (
    <svg {...svgProps}>
      <path d="M9 2v14" stroke="var(--cp-accent)" strokeWidth="1.4" strokeDasharray="2 1.6" strokeLinecap="round" />
      <path d="M7.2 4.6 2.8 9l4.4 4.4V4.6Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M10.8 4.6 15.2 9l-4.4 4.4V4.6Z" fill="var(--cp-accent)" fillOpacity="0.28" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  ),
  modSolidify: (
    <svg {...svgProps}>
      <path d="M3.2 11.4 9 14.8l5.8-3.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.2 7.2 9 3.8l5.8 3.4L9 10.6 3.2 7.2Z" fill="var(--cp-accent)" fillOpacity="0.26" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M3.2 7.2v4.2M9 10.6v4.2M14.8 7.2v4.2" stroke="var(--cp-accent)" strokeWidth="1.3" />
    </svg>
  ),
  modBend: (
    <svg {...svgProps}>
      <path d="M4.2 14.8V9.5c0-3.4 2.6-6 6.2-6h3.8v4.2h-3.4c-1.3 0-2.2.8-2.2 2.2v4.9H4.2Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M7.2 14.2c0-3.8 2.4-6.4 6.6-6.4" stroke="var(--cp-accent)" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  modTwist: (
    <svg {...svgProps}>
      <path d="M5 3.2h8L6.2 9h5.6L5 14.8h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 2.2v13.6" stroke="var(--cp-accent)" strokeWidth="1.1" strokeDasharray="1.8 1.6" />
    </svg>
  ),
  modTaper: (
    <svg {...svgProps}>
      <path d="M6.4 3.2h5.2l2.8 11.6H3.6L6.4 3.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M5 9h8" stroke="var(--cp-accent)" strokeWidth="1.25" />
    </svg>
  ),
  modArray: (
    <svg {...svgProps}>
      <rect x="2.4" y="6.8" width="4.4" height="6.8" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="6.8" y="4.8" width="4.4" height="6.8" rx="0.8" stroke="currentColor" strokeWidth="1.3" />
      <rect x="11.2" y="2.8" width="4.4" height="6.8" rx="0.8" stroke="var(--cp-accent)" strokeWidth="1.4" />
    </svg>
  ),

  /* --- Polygon / Edge / Point Modeling Tools --- */
  toolExtrude: (
    <svg {...svgProps}>
      <path d="M3 12.2 9 15.2l6-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="5.4" y="5.6" width="7.2" height="6.2" rx="0.8" fill="var(--cp-accent)" fillOpacity="0.28" stroke="currentColor" strokeWidth="1.35" />
      <path d="M9 5.2V1.8m0 0L7.3 3.5M9 1.8l1.7 1.7" stroke="var(--cp-accent)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  toolInset: (
    <svg {...svgProps}>
      <rect x="2.8" y="2.8" width="12.4" height="12.4" rx="1.2" stroke="currentColor" strokeWidth="1.35" />
      <rect x="6.1" y="6.1" width="5.8" height="5.8" rx="0.6" fill="var(--cp-accent)" fillOpacity="0.32" stroke="var(--cp-accent)" strokeWidth="1.35" />
      <path d="M2.8 2.8 6.1 6.1M15.2 2.8l-3.3 3.3M2.8 15.2l3.3-3.3M15.2 15.2l-3.3-3.3" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  ),
  toolBevel: (
    <svg {...svgProps}>
      <path d="M3.2 14.8V8.4c0-2.9 2.3-5.2 5.2-5.2h6.4v11.6H3.2Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M3.2 8.4c0-2.9 2.3-5.2 5.2-5.2" stroke="var(--cp-accent)" strokeWidth="2.1" strokeLinecap="round" />
    </svg>
  ),
  toolLoopCut: (
    <svg {...svgProps}>
      <rect x="2.8" y="3.4" width="12.4" height="11.2" rx="1.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M2 9h14" stroke="var(--cp-accent)" strokeWidth="2" strokeLinecap="round" />
    </svg>
  ),
  toolBridge: (
    <svg {...svgProps}>
      <rect x="2.2" y="4.2" width="4" height="9.6" rx="0.8" stroke="currentColor" strokeWidth="1.35" />
      <rect x="11.8" y="4.2" width="4" height="9.6" rx="0.8" stroke="currentColor" strokeWidth="1.35" />
      <path d="M6.2 6.2h5.6M6.2 11.8h5.6" stroke="var(--cp-accent)" strokeWidth="1.6" strokeDasharray="1.8 1.5" />
    </svg>
  ),
  toolWeld: (
    <svg {...svgProps}>
      <circle cx="4.2" cy="4.8" r="1.6" stroke="currentColor" strokeWidth="1.25" />
      <circle cx="4.2" cy="13.2" r="1.6" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6.2 5.6 11.4 8.4M6.2 12.4l5.2-2.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      <circle cx="13.4" cy="9" r="2.2" fill="var(--cp-accent)" />
    </svg>
  ),
  toolConnect: (
    <svg {...svgProps}>
      <rect x="3.2" y="3.2" width="11.6" height="11.6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.6 14.4 14.4 3.6" stroke="var(--cp-accent)" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="3.6" cy="14.4" r="1.7" fill="var(--cp-accent)" />
      <circle cx="14.4" cy="3.6" r="1.7" fill="var(--cp-accent)" />
    </svg>
  ),
  toolSubdivide: (
    <svg {...svgProps}>
      <rect x="2.8" y="2.8" width="12.4" height="12.4" rx="1.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M9 2.8v12.4M2.8 9h12.4" stroke="var(--cp-accent)" strokeWidth="1.45" />
    </svg>
  ),
  toolDissolve: (
    <svg {...svgProps}>
      <rect x="2.8" y="2.8" width="12.4" height="12.4" rx="1.2" stroke="currentColor" strokeWidth="1.35" />
      <path d="M9 3.4v11.2" stroke="var(--cp-accent)" strokeWidth="1.35" strokeDasharray="1.8 2" strokeLinecap="round" />
    </svg>
  ),
  toolFlipNormals: (
    <svg {...svgProps}>
      <path d="M3 12.6h12" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M6.5 12.6V4.4m0 0L4.7 6.2m1.8-1.8 1.8 1.8" stroke="var(--cp-accent)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M11.8 4.4v6.2m0 0-1.6-1.6m1.6 1.6 1.6-1.6" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  toolCloseHole: (
    <svg {...svgProps}>
      <path d="M9 2.4 15 6v6l-6 3.6L3 12V6l6-3.6Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M9 5.6 12.2 7.5v3L9 12.4 5.8 10.5v-3L9 5.6Z" fill="var(--cp-accent)" fillOpacity="0.45" stroke="var(--cp-accent)" strokeWidth="1.2" />
    </svg>
  ),
  toolEdgeLoop: (
    <svg {...svgProps}>
      <ellipse cx="9" cy="9" rx="6.4" ry="3.2" stroke="var(--cp-accent)" strokeWidth="1.9" />
      <circle cx="9" cy="9" r="6.4" stroke="currentColor" strokeWidth="1.15" strokeOpacity="0.65" />
    </svg>
  ),
  toolEdgeRing: (
    <svg {...svgProps}>
      <rect x="2.8" y="4.2" width="12.4" height="9.6" rx="1.2" stroke="currentColor" strokeWidth="1.25" />
      <path d="M6 4.2v9.6M9 4.2v9.6M12 4.2v9.6" stroke="var(--cp-accent)" strokeWidth="1.65" />
    </svg>
  ),
  toolGrowSelection: (
    <svg {...svgProps}>
      <rect x="6.4" y="6.4" width="5.2" height="5.2" fill="var(--cp-accent)" rx="0.6" />
      <rect x="2.8" y="2.8" width="12.4" height="12.4" rx="1.4" stroke="currentColor" strokeWidth="1.3" strokeDasharray="2 1.6" />
    </svg>
  ),
  toolShrinkSelection: (
    <svg {...svgProps}>
      <rect x="2.8" y="2.8" width="12.4" height="12.4" rx="1.4" stroke="currentColor" strokeWidth="1.2" strokeOpacity="0.6" />
      <rect x="6.6" y="6.6" width="4.8" height="4.8" rx="0.6" stroke="var(--cp-accent)" strokeWidth="1.6" />
    </svg>
  ),

  /* --- Importer & Object Manager Inline Column Badges --- */
  import3d: (
    <svg {...svgProps}>
      <path d="M9 2.2v8.2m0 0L6.3 7.7M9 10.4l2.7-2.7" stroke="var(--cp-accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.2 10.8v3c0 .9.7 1.6 1.6 1.6h8.4c.9 0 1.6-.7 1.6-1.6v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  generatorCheckOn: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" fill="var(--cp-success)" fillOpacity="0.2" stroke="var(--cp-success)" strokeWidth="1.35" />
      <path d="m5.1 8.2 2 2 3.9-4.1" stroke="var(--cp-success)" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  generatorCheckOff: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.2" stroke="var(--cp-text-muted)" strokeWidth="1.35" />
      <path d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" stroke="var(--cp-text-muted)" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  ),
  phongTag: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="5.6" cy="8" r="3.6" fill="currentColor" fillOpacity="0.25" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="10.4" cy="8" r="3.6" fill="var(--cp-accent)" fillOpacity="0.35" stroke="var(--cp-accent)" strokeWidth="1.2" />
    </svg>
  ),

  /* --- Top Command Bar, Viewport & Object Manager Utility Icons --- */
  undo: (
    <svg {...svgProps}>
      <path d="M5.2 6.8H11a3.8 3.8 0 0 1 0 7.6H7.8" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M7.6 4.2 4.8 6.8l2.8 2.6" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  redo: (
    <svg {...svgProps}>
      <path d="M12.8 6.8H7a3.8 3.8 0 0 0 0 7.6h3.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <path d="M10.4 4.2l2.8 2.6-2.8 2.6" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  newScene: (
    <svg {...svgProps}>
      <path d="M4.2 2.8h6.4l3.2 3.2v9.2H4.2V2.8Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M10.4 2.8v3.4h3.4" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" />
      <path d="M9 8.4v4.4M6.8 10.6h4.4" stroke="var(--cp-accent)" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  ),
  camera: (
    <svg {...svgProps}>
      <rect x="2.4" y="4.8" width="9.8" height="8.4" rx="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12.2 7.6 15.6 5.6v6.8l-3.4-2V7.6Z" stroke="var(--cp-accent)" strokeWidth="1.35" strokeLinejoin="round" />
      <circle cx="7.3" cy="9" r="1.9" stroke="currentColor" strokeWidth="1.25" />
    </svg>
  ),
  shading: (
    <svg {...svgProps}>
      <circle cx="9" cy="9" r="6.2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M9 2.8a6.2 6.2 0 0 1 0 12.4V2.8Z" fill="var(--cp-accent)" fillOpacity="0.45" />
      <path d="M9 2.8v12.4" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  ),
  renderQuality: (
    <svg {...svgProps}>
      <path d="M9 2.2 15.2 7l-6.2 8.8L2.8 7 9 2.2Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M2.8 7h12.4M9 2.2 6.6 7 9 15.8 11.4 7 9 2.2Z" stroke="var(--cp-accent)" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  globalIllumination: (
    <svg {...svgProps}>
      <path d="M2.6 14.4h12.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.2 5.2 8.4 14.2l4.8-6.4m0 0h-2.5m2.5 0v2.5" stroke="var(--cp-accent)" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4.2" cy="5.2" r="1.5" fill="currentColor" />
    </svg>
  ),
  sceneLightsOnly: (
    <svg {...svgProps}>
      <path d="M3 3h2.8l7.6 5.2-5.2 5.2L3 5.8V3Z" fill="var(--cp-accent)" fillOpacity="0.28" stroke="var(--cp-accent)" strokeWidth="1.3" strokeLinejoin="round" />
      <circle cx="11.6" cy="11.6" r="3.4" stroke="currentColor" strokeWidth="1.35" />
      <path d="M9.2 9.2a3.4 3.4 0 0 1 4.8 4.8L9.2 9.2Z" fill="currentColor" fillOpacity="0.65" />
    </svg>
  ),
  grid: (
    <svg {...svgProps}>
      <path d="M2.4 13.4 6.2 6.2h5.6l3.8 7.2H2.4Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9 6.2v7.2M4.3 9.8h9.4" stroke="currentColor" strokeWidth="1.15" />
    </svg>
  ),
  joints: (
    <svg {...svgProps}>
      <circle cx="5" cy="13" r="1.9" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="9.2" cy="8.2" r="2" fill="var(--cp-accent)" fillOpacity="0.35" stroke="var(--cp-accent)" strokeWidth="1.35" />
      <circle cx="13.4" cy="4.6" r="1.7" stroke="currentColor" strokeWidth="1.35" />
      <path d="M6.3 11.6 7.9 9.7M10.7 6.9l1.4-1.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  ),
  library: (
    <svg {...svgProps}>
      <path d="M2.8 4.4h4.6l1.5 1.8h6.3v7.6H2.8V4.4Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M2.8 8.2h12.4" stroke="var(--cp-accent)" strokeWidth="1.25" />
    </svg>
  ),
  exportImg: (
    <svg {...svgProps}>
      <rect x="2.6" y="3.4" width="12.8" height="11.2" rx="1.6" stroke="currentColor" strokeWidth="1.35" />
      <circle cx="6.3" cy="7" r="1.3" fill="var(--cp-accent)" />
      <path d="M3.4 13.2 7.4 9.4l2.8 2.6 2-1.8 2.4 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  frameSelection: (
    <svg {...svgProps}>
      <path d="M3.2 6.2V3.2h3M11.8 3.2h3v3M14.8 11.8v3h-3M6.2 14.8h-3v-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2.3" stroke="var(--cp-accent)" strokeWidth="1.4" />
    </svg>
  ),
  snapFloor: (
    <svg {...svgProps}>
      <rect x="5.5" y="3" width="7" height="5.6" rx="1" stroke="currentColor" strokeWidth="1.35" />
      <path d="M9 8.8v4.2m0 0-2-2m2 2 2-2" stroke="var(--cp-accent)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 15h12" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  ),
  swap: (
    <svg {...svgProps}>
      <path d="M4 6.2h9.6m0 0-2.2-2.2m2.2 2.2-2.2 2.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M14 11.8H4.4m0 0 2.2-2.2m-2.2 2.2 2.2 2.2" stroke="var(--cp-accent)" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  duplicate: (
    <svg {...svgProps}>
      <rect x="6.2" y="6.2" width="8.6" height="8.6" rx="1.4" stroke="currentColor" strokeWidth="1.35" />
      <path d="M11.8 6.2V4.4a1.2 1.2 0 0 0-1.2-1.2H4.4a1.2 1.2 0 0 0-1.2 1.2v6.2a1.2 1.2 0 0 0 1.2 1.2h1.8" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  help: (
    <svg {...svgProps}>
      <circle cx="9" cy="9" r="6.4" stroke="currentColor" strokeWidth="1.35" />
      <path d="M7.2 7.1a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.7-.9 1.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
      <circle cx="9" cy="12.7" r="0.9" fill="var(--cp-accent)" />
    </svg>
  ),
} as const;

export type C4DIconName = keyof typeof C4DIcons;

export function getPrimitiveIcon(kind: PrimitiveKind, fillet = false): ReactNode {
  if (kind === 'cube' && fillet) return C4DIcons.primFilletCube;
  switch (kind) {
    case 'cube':
      return C4DIcons.primCube;
    case 'sphere':
      return C4DIcons.primSphere;
    case 'cylinder':
      return C4DIcons.primCylinder;
    case 'cone':
      return C4DIcons.primCone;
    case 'pyramid':
      return C4DIcons.primPyramid;
    case 'torus':
      return C4DIcons.primTorus;
    case 'capsule':
      return C4DIcons.primCapsule;
    case 'tube':
      return C4DIcons.primTube;
    case 'plane':
      return C4DIcons.primPlane;
    case 'disc':
      return C4DIcons.primDisc;
    case 'platonic':
      return C4DIcons.primPlatonic;
  }
}

export function getBooleanIcon(op: BooleanOpType): ReactNode {
  switch (op) {
    case 'union':
      return C4DIcons.booleUnion;
    case 'subtract':
      return C4DIcons.booleSubtract;
    case 'intersect':
      return C4DIcons.booleIntersect;
  }
}

export function getModifierIcon(type: ModifierType): ReactNode {
  switch (type) {
    case 'bevel':
      return C4DIcons.modBevel;
    case 'subdivision':
      return C4DIcons.modSubdivision;
    case 'mirror':
      return C4DIcons.modMirror;
    case 'solidify':
      return C4DIcons.modSolidify;
    case 'bend':
      return C4DIcons.modBend;
    case 'twist':
      return C4DIcons.modTwist;
    case 'taper':
      return C4DIcons.modTaper;
    case 'array':
      return C4DIcons.modArray;
  }
}

/* ============================================================================
 * Viewport-Clamped Cursor-Safe Portal Tooltip Pill (Never Clipped or Covered)
 * ============================================================================ */

function normalizeButtonPointer(
  clientX: number,
  clientY: number,
  anchorRect: DOMRect | null,
): PointerCoords {
  if (
    clientX === 0 &&
    clientY === 0 &&
    anchorRect &&
    (anchorRect.right > 4 || anchorRect.bottom > 4)
  ) {
    return {
      x: Math.round(anchorRect.left + anchorRect.width / 2),
      y: Math.round(anchorRect.top + anchorRect.height * 0.75),
    };
  }
  return { x: clientX, y: clientY };
}

/* ============================================================================
 * `C4DIconButton` — Compact 30x30 / 28x28 C4D Command & Tool Dock Button
 * ============================================================================ */

export interface C4DIconButtonProps {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  description?: string;
  active?: boolean;
  disabled?: boolean;
  size?: 'default' | 'dense';
  tooltipPlacement?: TooltipPlacement;
  hasFlyout?: boolean;
  suppressTooltip?: boolean;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerLeave?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  ariaHaspopup?: 'menu' | 'dialog' | 'listbox';
  ariaExpanded?: boolean;
}

export function C4DIconButton({
  icon,
  label,
  shortcut,
  description,
  active = false,
  disabled = false,
  size = 'default',
  tooltipPlacement = 'auto',
  hasFlyout = false,
  suppressTooltip = false,
  onClick,
  onContextMenu,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  ariaHaspopup,
  ariaExpanded,
}: C4DIconButtonProps) {
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [pointer, setPointer] = useState<PointerCoords | null>(null);
  const [tipPos, setTipPos] = useState<{
    left: number;
    top: number;
    resolvedPlacement: string;
  } | null>(null);

  const showTip = hovered && !suppressTooltip;

  useEffect(() => {
    if (suppressTooltip) {
      setHovered(false);
      setPointer(null);
    }
  }, [suppressTooltip]);

  useLayoutEffect(() => {
    if (!showTip || !btnRef.current || !tipRef.current || typeof window === 'undefined') {
      setTipPos(null);
      return;
    }
    const anchorRect = btnRef.current.getBoundingClientRect();
    const tipWidth = tipRef.current.offsetWidth || 160;
    const tipHeight = tipRef.current.offsetHeight || 30;
    const next = computeAnchoredTooltipPosition({
      anchorRect,
      tipWidth,
      tipHeight,
      placement: tooltipPlacement,
      pointer,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setTipPos((prev) =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.resolvedPlacement === next.resolvedPlacement
        ? prev
        : next,
    );
  }, [showTip, tooltipPlacement, pointer, label, shortcut, description]);

  const updatePointer = (clientX: number, clientY: number) => {
    if (suppressTooltip) return;
    const rect = btnRef.current ? btnRef.current.getBoundingClientRect() : null;
    const next = normalizeButtonPointer(clientX, clientY, rect);
    setPointer((prev) => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
    setHovered(true);
  };

  const px = size === 'dense' ? 28 : 30;

  const buttonStyle: CSSProperties = {
    position: 'relative',
    width: px,
    height: px,
    minWidth: px,
    minHeight: px,
    padding: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    border: active
      ? '1px solid var(--cp-accent)'
      : hovered && !disabled
        ? '1px solid var(--cp-border-strong)'
        : '1px solid transparent',
    background: active
      ? 'var(--cp-accent-soft)'
      : hovered && !disabled
        ? 'var(--cp-surface-soft)'
        : 'transparent',
    color: active ? 'var(--cp-accent)' : disabled ? 'var(--cp-text-muted)' : 'var(--cp-text)',
    opacity: disabled ? 0.45 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    transition: 'background 110ms ease, border-color 110ms ease, color 110ms ease',
    outline: 'none',
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={shortcut ? `${label} (${shortcut})` : label}
        aria-pressed={active}
        aria-describedby={showTip ? tooltipId : undefined}
        aria-haspopup={ariaHaspopup}
        aria-expanded={ariaExpanded}
        disabled={disabled}
        style={buttonStyle}
        onClick={disabled ? undefined : onClick}
        onContextMenu={disabled ? undefined : onContextMenu}
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return;
          updatePointer(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (e.pointerType === 'touch') return;
          updatePointer(e.clientX, e.clientY);
        }}
        onPointerDown={(e) => {
          setHovered(false);
          setPointer(null);
          if (!disabled) onPointerDown?.(e);
        }}
        onPointerUp={disabled ? undefined : onPointerUp}
        onMouseEnter={(e) => updatePointer(e.clientX, e.clientY)}
        onMouseMove={(e) => updatePointer(e.clientX, e.clientY)}
        onMouseLeave={() => {
          setHovered(false);
          setPointer(null);
        }}
        onFocus={(e) => {
          if (suppressTooltip) return;
          if (typeof e.currentTarget.matches === 'function') {
            try {
              if (!e.currentTarget.matches(':focus-visible')) return;
            } catch {
              // Ignore unsupported selector engines
            }
          }
          setPointer(null);
          setHovered(true);
        }}
        onBlur={() => {
          setHovered(false);
          setPointer(null);
        }}
        onPointerLeave={(e) => {
          setHovered(false);
          setPointer(null);
          onPointerLeave?.(e);
        }}
      >
        {icon}
        {hasFlyout && (
          <svg
            width="6"
            height="6"
            viewBox="0 0 6 6"
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: 2,
              bottom: 2,
              color: active ? 'var(--cp-accent)' : 'var(--cp-text-muted)',
              pointerEvents: 'none',
            }}
          >
            <path d="M6 0v6H0L6 0Z" fill="currentColor" />
          </svg>
        )}
      </button>

      {showTip &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={tipRef}
            id={tooltipId}
            role="tooltip"
            data-tooltip-placement={tipPos?.resolvedPlacement ?? 'bottom'}
            className="studio-tooltip"
            style={{
              position: 'fixed',
              left: tipPos ? tipPos.left : 0,
              top: tipPos ? tipPos.top : 0,
              visibility: tipPos ? 'visible' : 'hidden',
              zIndex: 10000,
              pointerEvents: 'none',
              background: 'var(--cp-panel-strong)',
              color: 'var(--cp-text)',
              border: '1px solid var(--cp-border-strong)',
              borderRadius: 7,
              padding: description ? '5px 8px' : '4px 8px',
              boxShadow: 'var(--cp-shadow)',
              maxWidth: 240,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--cp-text)' }}>{label}</span>
              {shortcut && (
                <kbd
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    fontFamily: 'inherit',
                    padding: '1px 5px',
                    borderRadius: 4,
                    background: 'var(--cp-surface-soft)',
                    border: '1px solid var(--cp-border)',
                    color: 'var(--cp-text-soft)',
                  }}
                >
                  {shortcut}
                </kbd>
              )}
            </div>
            {description && (
              <span style={{ fontSize: 11, color: 'var(--cp-text-muted)', lineHeight: 1.3 }}>
                {description}
              </span>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/* ============================================================================
 * `C4DFlyoutButton` — Primary Command Button + Corner Flyout Sub-Palette
 * Click main icon -> runs `onPrimaryClick` (spawns default / last-selected item).
 * Hold >= 240ms, Right-Click, or Click bottom-right flyout corner -> opens sub-palette!
 * ============================================================================ */

export interface C4DFlyoutItem<T extends string = string> {
  id: T;
  label: string;
  icon: ReactNode;
  shortcut?: string;
  description?: string;
  disabled?: boolean;
}

export interface C4DFlyoutButtonProps<T extends string = string> {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  description?: string;
  items: readonly C4DFlyoutItem<T>[];
  activeItemId?: T;
  active?: boolean;
  disabled?: boolean;
  size?: 'default' | 'dense';
  columns?: 1 | 2 | 3 | 4;
  tooltipPlacement?: TooltipPlacement;
  flyoutPlacement?: 'bottom' | 'right';
  onPrimaryClick: () => void;
  onSelectItem: (id: T, item: C4DFlyoutItem<T>) => void;
}

export function C4DFlyoutButton<T extends string = string>({
  icon,
  label,
  shortcut,
  description,
  items,
  activeItemId,
  active = false,
  disabled = false,
  size = 'default',
  columns = 2,
  tooltipPlacement = 'bottom',
  flyoutPlacement = 'bottom',
  onPrimaryClick,
  onSelectItem,
}: C4DFlyoutButtonProps<T>) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const holdTimerRef = useRef<number | null>(null);
  const openedByHoldRef = useRef(false);

  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ left: number; top: number } | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearHoldTimer, [clearHoldTimer]);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !menuRef.current) return;
    const anchor = wrapRef.current.getBoundingClientRect();
    const rect = menuRef.current.getBoundingClientRect();
    const placement = flyoutPlacement === 'right' ? 'right' : 'bottom';
    setMenuPos(computeFlyoutMenuPosition(anchor, rect.width, rect.height, placement));
  }, [open, flyoutPlacement, items.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDownDoc = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (wrapRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDownDoc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDownDoc);
    window.addEventListener('keydown', onKeyDownDoc);
    return () => {
      window.removeEventListener('pointerdown', onPointerDownDoc);
      window.removeEventListener('keydown', onKeyDownDoc);
    };
  }, [open]);

  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    openedByHoldRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      openedByHoldRef.current = true;
      setOpen(true);
    }, 240);
  };

  const handlePointerUp = () => {
    clearHoldTimer();
  };

  const handleClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    clearHoldTimer();
    if (openedByHoldRef.current) {
      openedByHoldRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;
    // Bottom-right 11x11px corner opens the flyout palette directly; main area runs primary action
    if (relX >= rect.width - 11 && relY >= rect.height - 11) {
      setOpen((prev) => !prev);
      return;
    }
    setOpen(false);
    onPrimaryClick();
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    clearHoldTimer();
    setOpen((prev) => !prev);
  };

  return (
    <div ref={wrapRef} style={{ display: 'inline-flex', position: 'relative' }}>
      <C4DIconButton
        icon={icon}
        label={label}
        shortcut={shortcut}
        description={description ?? 'Click to create · Hold or right-click for palette'}
        active={active || open}
        disabled={disabled}
        size={size}
        hasFlyout
        suppressTooltip={open}
        tooltipPlacement={tooltipPlacement}
        ariaHaspopup="menu"
        ariaExpanded={open}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={clearHoldTimer}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      />

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            style={{
              position: 'fixed',
              left: menuPos ? menuPos.left : -9999,
              top: menuPos ? menuPos.top : -9999,
              zIndex: 9998,
              background: 'var(--cp-panel-strong)',
              border: '1px solid var(--cp-border-strong)',
              borderRadius: 9,
              padding: 6,
              boxShadow: 'var(--cp-shadow)',
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(132px, 1fr))`,
              gap: 4,
              minWidth: columns === 1 ? 176 : 276,
              maxHeight: 'min(440px, calc(100vh - 24px))',
              overflowY: 'auto',
            }}
          >
            {items.map((item) => {
              const isItemActive = item.id === activeItemId;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    if (item.disabled) return;
                    setOpen(false);
                    onSelectItem(item.id, item);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 8px',
                    borderRadius: 6,
                    border: isItemActive ? '1px solid var(--cp-accent)' : '1px solid transparent',
                    background: isItemActive ? 'var(--cp-accent-soft)' : 'transparent',
                    color: item.disabled
                      ? 'var(--cp-text-muted)'
                      : isItemActive
                        ? 'var(--cp-accent)'
                        : 'var(--cp-text)',
                    opacity: item.disabled ? 0.45 : 1,
                    cursor: item.disabled ? 'not-allowed' : 'pointer',
                    textAlign: 'left',
                    fontSize: 12,
                    fontWeight: isItemActive ? 600 : 500,
                  }}
                >
                  <span style={{ display: 'inline-flex', flexShrink: 0 }}>{item.icon}</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.label}
                  </span>
                  {item.shortcut && (
                    <kbd
                      style={{
                        fontSize: 10,
                        padding: '0 4px',
                        borderRadius: 4,
                        background: 'var(--cp-surface-soft)',
                        border: '1px solid var(--cp-border)',
                        color: 'var(--cp-text-muted)',
                      }}
                    >
                      {item.shortcut}
                    </kbd>
                  )}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}

/* ============================================================================
 * `C4DOperatorCaddy` — Interactive Viewport Modeling Operator HUD Caddy
 * Live numeric drag-scrubbing + step buttons + boolean switches + Apply / Reset
 * ============================================================================ */

export type C4DCaddyField =
  | {
      key: string;
      kind: 'number';
      label: string;
      value: number;
      min?: number;
      max?: number;
      step?: number;
      precision?: number;
      unit?: string;
    }
  | {
      key: string;
      kind: 'integer';
      label: string;
      value: number;
      min?: number;
      max?: number;
    }
  | {
      key: string;
      kind: 'boolean';
      label: string;
      value: boolean;
    }
  | {
      key: string;
      kind: 'select';
      label: string;
      value: string;
      options: readonly { value: string; label: string }[];
    };

export interface C4DOperatorCaddyProps {
  title: string;
  icon?: ReactNode;
  shortcut?: string;
  fields: readonly C4DCaddyField[];
  anchor?: 'bottom-left' | 'bottom-center';
  onChangeField: (key: string, value: number | boolean | string) => void;
  onApply: () => void;
  onReset: () => void;
  onCancel?: () => void;
}

function clampFieldNumber(val: number, min?: number, max?: number): number {
  let out = Number.isFinite(val) ? val : 0;
  if (min !== undefined) out = Math.max(min, out);
  if (max !== undefined) out = Math.min(max, out);
  return out;
}

function CaddyScrubLabel({
  label,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  label: string;
  onPointerDown: (e: ReactPointerEvent<HTMLLabelElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLLabelElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLLabelElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLLabelElement>) => void;
}) {
  const { triggerRef, triggerProps, tooltipNode, dismissTooltip } =
    useStudioTooltip<HTMLLabelElement>({
      title: label,
      description: 'Drag horizontally to scrub value',
      placement: 'top',
    });

  return (
    <>
      <label
        ref={triggerRef}
        onPointerEnter={triggerProps.onPointerEnter}
        onPointerMove={(e) => {
          if (e.buttons === 0) triggerProps.onPointerMove(e);
          onPointerMove(e);
        }}
        onPointerLeave={triggerProps.onPointerLeave}
        onPointerDown={(e) => {
          dismissTooltip();
          onPointerDown(e);
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onMouseEnter={triggerProps.onMouseEnter}
        onMouseMove={(e) => {
          if (e.buttons === 0) triggerProps.onMouseMove(e);
        }}
        onMouseLeave={triggerProps.onMouseLeave}
        style={{
          fontSize: 11.5,
          color: 'var(--cp-text-soft)',
          cursor: 'ew-resize',
          userSelect: 'none',
        }}
      >
        {label}
      </label>
      {tooltipNode}
    </>
  );
}

export function C4DOperatorCaddy({
  title,
  icon,
  shortcut,
  fields,
  anchor = 'bottom-left',
  onChangeField,
  onApply,
  onReset,
  onCancel,
}: C4DOperatorCaddyProps) {
  const scrubRef = useRef<{
    key: string;
    startX: number;
    startVal: number;
    step: number;
    min?: number;
    max?: number;
    isInt: boolean;
  } | null>(null);

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
      e.preventDefault();
      onApply();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  const startLabelScrub = (
    e: ReactPointerEvent<HTMLLabelElement>,
    field: Extract<C4DCaddyField, { kind: 'number' | 'integer' }>,
  ) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubRef.current = {
      key: field.key,
      startX: e.clientX,
      startVal: field.value,
      step: field.kind === 'integer' ? 1 : (field.step ?? 0.02),
      min: field.min,
      max: field.max,
      isInt: field.kind === 'integer',
    };
  };

  const moveLabelScrub = (e: ReactPointerEvent<HTMLLabelElement>) => {
    const s = scrubRef.current;
    if (!s) return;
    const dx = e.clientX - s.startX;
    const sensitivity = s.isInt ? 14 : 6;
    const raw = s.startVal + (dx / sensitivity) * s.step;
    const next = clampFieldNumber(s.isInt ? Math.round(raw) : Number(raw.toFixed(4)), s.min, s.max);
    onChangeField(s.key, next);
  };

  const endLabelScrub = () => {
    scrubRef.current = null;
  };

  const containerStyle: CSSProperties = {
    position: 'absolute',
    bottom: 48,
    left: anchor === 'bottom-center' ? '50%' : 14,
    transform: anchor === 'bottom-center' ? 'translateX(-50%)' : undefined,
    zIndex: 40,
    width: 268,
    background: 'var(--cp-panel-strong)',
    border: '1px solid var(--cp-border-strong)',
    borderRadius: 10,
    boxShadow: 'var(--cp-shadow)',
    color: 'var(--cp-text)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  };

  return (
    <div
      role="region"
      aria-label={`${title} Tool Options`}
      onKeyDown={handleKeyDown}
      style={containerStyle}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 10px',
          background: 'var(--cp-surface-soft)',
          borderBottom: '1px solid var(--cp-border)',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {icon && <span style={{ display: 'inline-flex', color: 'var(--cp-accent)' }}>{icon}</span>}
          <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap' }}>{title}</span>
          {shortcut && (
            <kbd
              style={{
                fontSize: 10,
                padding: '0 4px',
                borderRadius: 4,
                background: 'var(--cp-surface)',
                border: '1px solid var(--cp-border)',
                color: 'var(--cp-text-muted)',
              }}
            >
              {shortcut}
            </kbd>
          )}
        </div>
        {onCancel && (
          <button
            type="button"
            aria-label="Close tool options"
            onClick={onCancel}
            style={{
              width: 20,
              height: 20,
              padding: 0,
              borderRadius: 5,
              border: '1px solid transparent',
              background: 'transparent',
              color: 'var(--cp-text-muted)',
              cursor: 'pointer',
              justifyContent: 'center',
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Parameter Rows */}
      <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {fields.map((field) => {
          if (field.kind === 'number' || field.kind === 'integer') {
            const step = field.kind === 'integer' ? 1 : (field.step ?? 0.02);
            const dec = field.kind === 'integer' ? 0 : (field.precision ?? 2);
            return (
              <div
                key={field.key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
              >
                <CaddyScrubLabel
                  label={field.label}
                  onPointerDown={(e) => startLabelScrub(e, field)}
                  onPointerMove={moveLabelScrub}
                  onPointerUp={endLabelScrub}
                  onPointerCancel={endLabelScrub}
                />
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <button
                    type="button"
                    aria-label={`Decrease ${field.label}`}
                    onClick={() =>
                      onChangeField(
                        field.key,
                        clampFieldNumber(
                          Number((field.value - step).toFixed(dec)),
                          field.min,
                          field.max,
                        ),
                      )
                    }
                    style={{
                      width: 20,
                      height: 22,
                      padding: 0,
                      justifyContent: 'center',
                      borderRadius: 5,
                      border: '1px solid var(--cp-border)',
                      background: 'var(--cp-surface)',
                      color: 'var(--cp-text)',
                      cursor: 'pointer',
                    }}
                  >
                    −
                  </button>
                  <input
                    type="number"
                    aria-label={field.label}
                    value={Number(field.value.toFixed(dec))}
                    min={field.min}
                    max={field.max}
                    step={step}
                    onChange={(e) => {
                      const parsed = Number.parseFloat(e.target.value);
                      if (!Number.isFinite(parsed)) return;
                      onChangeField(
                        field.key,
                        clampFieldNumber(
                          field.kind === 'integer' ? Math.round(parsed) : parsed,
                          field.min,
                          field.max,
                        ),
                      );
                    }}
                    style={{
                      width: 66,
                      height: 22,
                      padding: '0 6px',
                      borderRadius: 5,
                      border: '1px solid var(--cp-border)',
                      background: 'var(--cp-surface)',
                      color: 'var(--cp-text)',
                      fontSize: 11.5,
                      textAlign: 'right',
                    }}
                  />
                  <button
                    type="button"
                    aria-label={`Increase ${field.label}`}
                    onClick={() =>
                      onChangeField(
                        field.key,
                        clampFieldNumber(
                          Number((field.value + step).toFixed(dec)),
                          field.min,
                          field.max,
                        ),
                      )
                    }
                    style={{
                      width: 20,
                      height: 22,
                      padding: 0,
                      justifyContent: 'center',
                      borderRadius: 5,
                      border: '1px solid var(--cp-border)',
                      background: 'var(--cp-surface)',
                      color: 'var(--cp-text)',
                      cursor: 'pointer',
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          }

          if (field.kind === 'boolean') {
            return (
              <div
                key={field.key}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
              >
                <span style={{ fontSize: 11.5, color: 'var(--cp-text-soft)' }}>{field.label}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={field.value}
                  onClick={() => onChangeField(field.key, !field.value)}
                  style={{
                    height: 22,
                    padding: '0 9px',
                    borderRadius: 999,
                    border: field.value ? '1px solid var(--cp-accent)' : '1px solid var(--cp-border)',
                    background: field.value ? 'var(--cp-accent-soft)' : 'var(--cp-surface)',
                    color: field.value ? 'var(--cp-accent)' : 'var(--cp-text-muted)',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {field.value ? 'On' : 'Off'}
                </button>
              </div>
            );
          }

          return (
            <div
              key={field.key}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
            >
              <span style={{ fontSize: 11.5, color: 'var(--cp-text-soft)' }}>{field.label}</span>
              <div
                role="group"
                aria-label={field.label}
                style={{
                  display: 'inline-flex',
                  padding: 2,
                  borderRadius: 6,
                  background: 'var(--cp-surface-soft)',
                  border: '1px solid var(--cp-border)',
                  gap: 2,
                }}
              >
                {field.options.map((opt) => {
                  const selected = opt.value === field.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => onChangeField(field.key, opt.value)}
                      style={{
                        height: 18,
                        padding: '0 7px',
                        borderRadius: 4,
                        border: selected ? '1px solid var(--cp-accent)' : '1px solid transparent',
                        background: selected ? 'var(--cp-accent-soft)' : 'transparent',
                        color: selected ? 'var(--cp-accent)' : 'var(--cp-text-muted)',
                        fontSize: 11,
                        fontWeight: selected ? 600 : 500,
                        cursor: 'pointer',
                      }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer Actions */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 6,
          padding: '6px 10px',
          borderTop: '1px solid var(--cp-border)',
          background: 'var(--cp-surface-soft)',
        }}
      >
        <button
          type="button"
          onClick={onReset}
          style={{
            height: 24,
            padding: '0 10px',
            borderRadius: 6,
            border: '1px solid var(--cp-border)',
            background: 'var(--cp-surface)',
            color: 'var(--cp-text)',
            fontSize: 11.5,
            cursor: 'pointer',
          }}
        >
          Reset
        </button>
        <button
          type="button"
          onClick={onApply}
          style={{
            height: 24,
            padding: '0 12px',
            borderRadius: 6,
            border: '1px solid var(--cp-accent)',
            background: 'var(--cp-accent)',
            color: 'var(--cp-accent-fg)',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
