/* ============================================================================
 * Cursor-Footprint-Safe Viewport Tooltip Geometry
 *
 * Standard OS hardware cursor arrows (Windows 100%–150% DPI scaling) extend
 * downward and to the right from `(pointerX, pointerY)`, occupying roughly
 * `[pointerX .. pointerX + 24] x [pointerY .. pointerY + 32]` CSS pixels.
 * Headless browser screenshots omit the OS hardware cursor, so any tooltip
 * intersecting `[pointerX - 4 .. pointerX + 26] x [pointerY - 4 .. pointerY + 36]`
 * will be physically occluded under the user's mouse arrow on screen.
 * ============================================================================ */

export type ExplicitTooltipPlacement = 'top' | 'bottom' | 'left' | 'right';
export type TooltipPlacement = ExplicitTooltipPlacement | 'auto';

export interface RectBox {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

export interface PointerCoords {
  readonly x: number;
  readonly y: number;
}

export interface PositionedTooltipCoords {
  readonly left: number;
  readonly top: number;
  readonly resolvedPlacement: ExplicitTooltipPlacement;
}

/** Strict hardware arrow bounds `[pointerX, pointerX + 24] x [pointerY, pointerY + 32]`. */
export const OS_CURSOR_ARROW_OFFSETS = {
  left: 0,
  right: 24,
  top: 0,
  bottom: 32,
} as const;

/** Padded safety box `[pointerX - 4, pointerX + 26] x [pointerY - 4, pointerY + 36]`. */
export const CURSOR_FOOTPRINT_OFFSETS = {
  left: -4,
  right: 26,
  top: -4,
  bottom: 36,
} as const;

export const DEFAULT_VIEWPORT_MARGIN = 8;

export function makeRectBox(left: number, top: number, width: number, height: number): RectBox {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
  };
}

export function getOsCursorArrowBox(pointerX: number, pointerY: number): RectBox {
  const left = pointerX + OS_CURSOR_ARROW_OFFSETS.left;
  const right = pointerX + OS_CURSOR_ARROW_OFFSETS.right;
  const top = pointerY + OS_CURSOR_ARROW_OFFSETS.top;
  const bottom = pointerY + OS_CURSOR_ARROW_OFFSETS.bottom;
  return makeRectBox(left, top, right - left, bottom - top);
}

export function getCursorFootprintBox(pointerX: number, pointerY: number): RectBox {
  const left = pointerX + CURSOR_FOOTPRINT_OFFSETS.left;
  const right = pointerX + CURSOR_FOOTPRINT_OFFSETS.right;
  const top = pointerY + CURSOR_FOOTPRINT_OFFSETS.top;
  const bottom = pointerY + CURSOR_FOOTPRINT_OFFSETS.bottom;
  return makeRectBox(left, top, right - left, bottom - top);
}

/** Strict open-interval AABB overlap test (`true` iff intersection area > 0). */
export function rectsOverlap(a: RectBox, b: RectBox): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

export function resolveAutoTooltipPlacement(
  anchorRect: Pick<RectBox, 'left' | 'top' | 'right' | 'bottom'>,
  viewportWidth: number,
  _viewportHeight: number,
): ExplicitTooltipPlacement {
  if (anchorRect.right <= 64 && anchorRect.top >= 36) {
    return 'right';
  }
  if (anchorRect.bottom <= 56) {
    return 'bottom';
  }
  if (anchorRect.left >= viewportWidth - 360) {
    return 'top';
  }
  return 'top';
}

function clamp(val: number, min: number, max: number): number {
  return Math.min(Math.max(min, val), Math.max(min, max));
}

function resolveCursorDisjointFallback(
  initialLeft: number,
  initialTop: number,
  initialPlacement: ExplicitTooltipPlacement,
  tipWidth: number,
  tipHeight: number,
  cursor: RectBox,
  margin: number,
  maxLeft: number,
  maxTop: number,
): PositionedTooltipCoords {
  const current = makeRectBox(initialLeft, initialTop, tipWidth, tipHeight);
  if (!rectsOverlap(current, cursor)) {
    return { left: initialLeft, top: initialTop, resolvedPlacement: initialPlacement };
  }

  const candidates: PositionedTooltipCoords[] = [];

  // 1. Above cursor tip (`bottom <= cursor.top - 6`) — zero OS cursor pixels exist above hotspot
  const aboveTop = Math.round(cursor.top - 6 - tipHeight);
  if (aboveTop >= margin && aboveTop <= maxTop) {
    candidates.push({
      left: clamp(initialLeft, margin, maxLeft),
      top: aboveTop,
      resolvedPlacement: 'top',
    });
  }

  // 2. Below cursor arrow tail (`top >= cursor.bottom + 2`)
  const belowTop = Math.round(cursor.bottom + 2);
  if (belowTop >= margin && belowTop <= maxTop) {
    candidates.push({
      left: clamp(initialLeft, margin, maxLeft),
      top: belowTop,
      resolvedPlacement: 'bottom',
    });
  }

  // 3. Left of cursor (`right <= cursor.left - 6`) — zero OS cursor pixels exist left of hotspot
  const leftX = Math.round(cursor.left - 6 - tipWidth);
  if (leftX >= margin && leftX <= maxLeft) {
    candidates.push({
      left: leftX,
      top: clamp(initialTop, margin, maxTop),
      resolvedPlacement: 'left',
    });
  }

  // 4. Right of cursor arrow body (`left >= cursor.right + 2`)
  const rightX = Math.round(cursor.right + 2);
  if (rightX >= margin && rightX <= maxLeft) {
    candidates.push({
      left: rightX,
      top: clamp(initialTop, margin, maxTop),
      resolvedPlacement: 'right',
    });
  }

  let best: PositionedTooltipCoords | null = null;
  let bestDistSq = Infinity;
  for (const cand of candidates) {
    const box = makeRectBox(cand.left, cand.top, tipWidth, tipHeight);
    if (rectsOverlap(box, cursor)) continue;
    const dx = cand.left - initialLeft;
    const dy = cand.top - initialTop;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = cand;
    }
  }

  return best ?? { left: initialLeft, top: initialTop, resolvedPlacement: initialPlacement };
}

export interface AnchoredTooltipParams {
  anchorRect: Pick<RectBox, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>;
  tipWidth: number;
  tipHeight: number;
  placement?: TooltipPlacement;
  pointer?: PointerCoords | null;
  viewportWidth?: number;
  viewportHeight?: number;
  margin?: number;
}

/**
 * Computes deterministic viewport-clamped coordinates for a UI control tooltip,
 * guaranteeing zero overlap with the OS cursor footprint `[pointerX - 4 .. pointerX + 26] x [pointerY - 4 .. pointerY + 36]`.
 */
export function computeAnchoredTooltipPosition({
  anchorRect,
  tipWidth,
  tipHeight,
  placement = 'auto',
  pointer = null,
  viewportWidth,
  viewportHeight,
  margin = DEFAULT_VIEWPORT_MARGIN,
}: AnchoredTooltipParams): PositionedTooltipCoords {
  const vw = viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const vh = viewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 800);
  const maxLeft = Math.max(margin, vw - tipWidth - margin);
  const maxTop = Math.max(margin, vh - tipHeight - margin);

  const basePlacement: ExplicitTooltipPlacement =
    placement === 'auto' ? resolveAutoTooltipPlacement(anchorRect, vw, vh) : placement;

  const cursor = pointer ? getCursorFootprintBox(pointer.x, pointer.y) : null;

  const centeredLeft = Math.round(anchorRect.left + anchorRect.width / 2 - tipWidth / 2);
  const centeredTop = Math.round(anchorRect.top + anchorRect.height / 2 - tipHeight / 2);

  let resolved: ExplicitTooltipPlacement = basePlacement;
  let left = clamp(centeredLeft, margin, maxLeft);
  let top = margin;

  const computeTopY = (): number =>
    Math.round(
      cursor
        ? Math.min(anchorRect.top - tipHeight - 10, cursor.top - 6 - tipHeight)
        : anchorRect.top - tipHeight - 10,
    );

  const computeBottomY = (): number =>
    Math.round(
      cursor
        ? Math.max(anchorRect.bottom + 10, cursor.bottom + 2)
        : anchorRect.bottom + 10,
    );

  const computeRightX = (): number =>
    Math.round(
      cursor
        ? Math.max(anchorRect.right + 12, cursor.right + 2)
        : anchorRect.right + 12,
    );

  const computeLeftX = (): number =>
    Math.round(
      cursor
        ? Math.min(anchorRect.left - tipWidth - 10, cursor.left - 6 - tipWidth)
        : anchorRect.left - tipWidth - 10,
    );

  if (basePlacement === 'top') {
    const candidateY = computeTopY();
    if (candidateY >= margin) {
      top = clamp(candidateY, margin, maxTop);
      resolved = 'top';
    } else {
      top = clamp(computeBottomY(), margin, maxTop);
      resolved = 'bottom';
    }
  } else if (basePlacement === 'bottom') {
    const candidateY = computeBottomY();
    if (candidateY <= maxTop) {
      top = clamp(candidateY, margin, maxTop);
      resolved = 'bottom';
    } else {
      const flippedY = computeTopY();
      top = clamp(flippedY >= margin ? flippedY : candidateY, margin, maxTop);
      resolved = flippedY >= margin ? 'top' : 'bottom';
    }
  } else if (basePlacement === 'right') {
    top = clamp(centeredTop, margin, maxTop);
    const candidateX = computeRightX();
    if (candidateX <= maxLeft) {
      left = clamp(candidateX, margin, maxLeft);
      resolved = 'right';
    } else {
      const flippedX = computeLeftX();
      left = clamp(flippedX >= margin ? flippedX : candidateX, margin, maxLeft);
      resolved = flippedX >= margin ? 'left' : 'right';
    }
  } else {
    top = clamp(centeredTop, margin, maxTop);
    const candidateX = computeLeftX();
    if (candidateX >= margin) {
      left = clamp(candidateX, margin, maxLeft);
      resolved = 'left';
    } else {
      left = clamp(computeRightX(), margin, maxLeft);
      resolved = 'right';
    }
  }

  if (!cursor) {
    return { left, top, resolvedPlacement: resolved };
  }

  return resolveCursorDisjointFallback(
    left,
    top,
    resolved,
    tipWidth,
    tipHeight,
    cursor,
    margin,
    maxLeft,
    maxTop,
  );
}

export interface ViewportCursorTooltipParams {
  pointerX: number;
  pointerY: number;
  tipWidth: number;
  tipHeight: number;
  viewportWidth?: number;
  viewportHeight?: number;
  margin?: number;
}

/**
 * Places 3D viewport cursor-following hover tooltips (rig joints, light handles,
 * mesh vertices/edges/faces, Loop Cut) cleanly ABOVE the cursor hotspot (`bottom = pointerY - 14`),
 * flipping below the entire cursor arrow tail (`top = pointerY + 40`) only near the top screen edge.
 */
export function computeViewportCursorTooltipPosition({
  pointerX,
  pointerY,
  tipWidth,
  tipHeight,
  viewportWidth,
  viewportHeight,
  margin = DEFAULT_VIEWPORT_MARGIN,
}: ViewportCursorTooltipParams): PositionedTooltipCoords {
  const vw = viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const vh = viewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 800);
  const maxLeft = Math.max(margin, vw - tipWidth - margin);
  const maxTop = Math.max(margin, vh - tipHeight - margin);
  const cursor = getCursorFootprintBox(pointerX, pointerY);

  const left = clamp(Math.round(pointerX - tipWidth / 2), margin, maxLeft);
  const aboveTop = Math.round(pointerY - 14 - tipHeight);

  if (aboveTop >= margin) {
    return resolveCursorDisjointFallback(
      left,
      clamp(aboveTop, margin, maxTop),
      'top',
      tipWidth,
      tipHeight,
      cursor,
      margin,
      maxLeft,
      maxTop,
    );
  }

  const belowTop = Math.round(cursor.bottom + 4);
  return resolveCursorDisjointFallback(
    left,
    clamp(belowTop, margin, maxTop),
    'bottom',
    tipWidth,
    tipHeight,
    cursor,
    margin,
    maxLeft,
    maxTop,
  );
}

/**
 * Clamps interactive clickable flyout menus (`role="menu"`) right adjacent to their anchor button.
 */
export function computeFlyoutMenuPosition(
  anchorRect: Pick<RectBox, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>,
  menuWidth: number,
  menuHeight: number,
  placement: 'bottom' | 'right' = 'bottom',
  viewportWidth?: number,
  viewportHeight?: number,
  margin = DEFAULT_VIEWPORT_MARGIN,
): { left: number; top: number } {
  const vw = viewportWidth ?? (typeof window !== 'undefined' ? window.innerWidth : 1280);
  const vh = viewportHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 800);
  const gap = 6;
  const maxLeft = Math.max(margin, vw - menuWidth - margin);
  const maxTop = Math.max(margin, vh - menuHeight - margin);

  let left = Math.round(anchorRect.left + anchorRect.width / 2 - menuWidth / 2);
  let top = Math.round(anchorRect.bottom + gap);

  if (placement === 'right') {
    left = Math.round(anchorRect.right + gap);
    top = Math.round(anchorRect.top + anchorRect.height / 2 - menuHeight / 2);
    if (left + menuWidth > vw - margin) {
      left = Math.round(anchorRect.left - menuWidth - gap);
    }
  } else if (top + menuHeight > vh - margin) {
    top = Math.round(anchorRect.top - menuHeight - gap);
  }

  return {
    left: clamp(left, margin, maxLeft),
    top: clamp(top, margin, maxTop),
  };
}
