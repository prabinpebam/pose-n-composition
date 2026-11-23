import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  computeAnchoredTooltipPosition,
  computeViewportCursorTooltipPosition,
  type ExplicitTooltipPlacement,
  type PointerCoords,
  type PositionedTooltipCoords,
  type RectBox,
  type TooltipPlacement,
} from './tooltipPositioning';

export interface StudioTooltipSpec {
  title: string;
  shortcut?: string;
  description?: string;
  placement?: TooltipPlacement;
  disabled?: boolean;
  suppressed?: boolean;
  dismissOnPress?: boolean;
}

export interface ViewportHoverTip {
  readonly title: string;
  readonly description?: string;
  readonly shortcut?: string;
  readonly clientX: number;
  readonly clientY: number;
}

function readDomRectBox(el: HTMLElement): RectBox {
  const r = el.getBoundingClientRect();
  return {
    left: r.left,
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    width: r.width,
    height: r.height,
  };
}

function normalizeEventPointer(
  clientX: number,
  clientY: number,
  anchorRect: RectBox | null,
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

interface StudioTooltipBodyProps {
  title: string;
  shortcut?: string;
  description?: string;
}

function StudioTooltipBody({ title, shortcut, description }: StudioTooltipBodyProps): React.ReactElement {
  const descLines = description ? description.split('\n').filter(Boolean) : [];
  return (
    <>
      <div className="studio-tooltip-head">
        <span className="studio-tooltip-title">{title}</span>
        {shortcut && <kbd className="studio-tooltip-kbd">{shortcut}</kbd>}
      </div>
      {descLines.length > 0 && (
        <div className="studio-tooltip-desc">
          {descLines.map((line, idx) => (
            <div key={idx}>{line}</div>
          ))}
        </div>
      )}
    </>
  );
}

export interface StudioAnchoredTooltipPortalProps {
  anchorEl: HTMLElement | null;
  open: boolean;
  title: string;
  shortcut?: string;
  description?: string;
  placement?: TooltipPlacement;
  pointer: PointerCoords | null;
}

export function StudioAnchoredTooltipPortal({
  anchorEl,
  open,
  title,
  shortcut,
  description,
  placement = 'auto',
  pointer,
}: StudioAnchoredTooltipPortalProps): React.ReactElement | null {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<PositionedTooltipCoords | null>(null);

  const recompute = useCallback(() => {
    if (!open || !anchorEl || !tipRef.current || typeof window === 'undefined') return;
    if (!anchorEl.isConnected) {
      setCoords(null);
      return;
    }
    const anchorRect = readDomRectBox(anchorEl);
    if (anchorRect.width === 0 && anchorRect.height === 0) {
      setCoords(null);
      return;
    }
    const tipWidth = tipRef.current.offsetWidth || 168;
    const tipHeight = tipRef.current.offsetHeight || 32;
    const next = computeAnchoredTooltipPosition({
      anchorRect,
      tipWidth,
      tipHeight,
      placement,
      pointer,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setCoords(prev =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.resolvedPlacement === next.resolvedPlacement
        ? prev
        : next,
    );
  }, [open, anchorEl, placement, pointer, title, shortcut, description]);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    recompute();
  }, [open, recompute]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const handleViewportChange = () => recompute();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [open, recompute]);

  if (!open || !title || typeof document === 'undefined') {
    return null;
  }

  const resolvedPlacement: ExplicitTooltipPlacement = coords?.resolvedPlacement ?? 'top';

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      data-tooltip-placement={resolvedPlacement}
      className="studio-tooltip"
      style={{
        position: 'fixed',
        left: coords ? coords.left : 0,
        top: coords ? coords.top : 0,
        visibility: coords ? 'visible' : 'hidden',
        pointerEvents: 'none',
      }}
    >
      <StudioTooltipBody title={title} shortcut={shortcut} description={description} />
    </div>,
    document.body,
  );
}

export interface StudioTriggerTooltipHandlers<T extends HTMLElement> {
  onPointerEnter: (e: React.PointerEvent<T>) => void;
  onPointerMove: (e: React.PointerEvent<T>) => void;
  onPointerLeave: (e: React.PointerEvent<T>) => void;
  onPointerDown: (e: React.PointerEvent<T>) => void;
  onMouseEnter: (e: React.MouseEvent<T>) => void;
  onMouseMove: (e: React.MouseEvent<T>) => void;
  onMouseLeave: (e: React.MouseEvent<T>) => void;
  onFocus: (e: React.FocusEvent<T>) => void;
  onBlur: (e: React.FocusEvent<T>) => void;
}

export function useStudioTooltip<T extends HTMLElement = HTMLButtonElement>({
  title,
  shortcut,
  description,
  placement = 'auto',
  disabled = false,
  suppressed = false,
  dismissOnPress = true,
}: StudioTooltipSpec): {
  triggerRef: React.RefObject<T | null>;
  triggerProps: StudioTriggerTooltipHandlers<T>;
  tooltipNode: React.ReactElement | null;
  dismissTooltip: () => void;
} {
  const triggerRef = useRef<T | null>(null);
  const [open, setOpen] = useState(false);
  const [pointer, setPointer] = useState<PointerCoords | null>(null);

  const dismissTooltip = useCallback(() => {
    setOpen(false);
    setPointer(null);
  }, []);

  useEffect(() => {
    if (disabled || suppressed || !title) {
      setOpen(false);
      setPointer(null);
    }
  }, [disabled, suppressed, title]);

  const updateFromClientCoords = useCallback(
    (clientX: number, clientY: number) => {
      if (disabled || suppressed || !title) return;
      const rect = triggerRef.current ? readDomRectBox(triggerRef.current) : null;
      const next = normalizeEventPointer(clientX, clientY, rect);
      setPointer(prev => (prev && prev.x === next.x && prev.y === next.y ? prev : next));
      setOpen(true);
    },
    [disabled, suppressed, title],
  );

  const triggerProps: StudioTriggerTooltipHandlers<T> = {
    onPointerEnter: e => {
      if (e.pointerType === 'touch') return;
      updateFromClientCoords(e.clientX, e.clientY);
    },
    onPointerMove: e => {
      if (e.pointerType === 'touch') return;
      updateFromClientCoords(e.clientX, e.clientY);
    },
    onPointerLeave: () => {
      dismissTooltip();
    },
    onPointerDown: () => {
      if (dismissOnPress) {
        dismissTooltip();
      }
    },
    onMouseEnter: e => {
      updateFromClientCoords(e.clientX, e.clientY);
    },
    onMouseMove: e => {
      updateFromClientCoords(e.clientX, e.clientY);
    },
    onMouseLeave: () => {
      dismissTooltip();
    },
    onFocus: e => {
      if (disabled || suppressed || !title) return;
      if (typeof e.currentTarget.matches === 'function') {
        try {
          if (!e.currentTarget.matches(':focus-visible')) return;
        } catch {
          // Ignore unsupported selector engines
        }
      }
      setPointer(null);
      setOpen(true);
    },
    onBlur: () => {
      dismissTooltip();
    },
  };

  const tooltipNode = (
    <StudioAnchoredTooltipPortal
      anchorEl={triggerRef.current}
      open={open && !disabled && !suppressed && Boolean(title)}
      title={title}
      shortcut={shortcut}
      description={description}
      placement={placement}
      pointer={pointer}
    />
  );

  return { triggerRef, triggerProps, tooltipNode, dismissTooltip };
}

export interface TooltipButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  tooltip: string;
  tooltipShortcut?: string;
  tooltipDescription?: string;
  tooltipPlacement?: TooltipPlacement;
}

export function TooltipButton({
  tooltip,
  tooltipShortcut,
  tooltipDescription,
  tooltipPlacement = 'top',
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  onPointerDown,
  onMouseEnter,
  onMouseMove,
  onMouseLeave,
  onFocus,
  onBlur,
  children,
  ...rest
}: TooltipButtonProps): React.ReactElement {
  const { triggerRef, triggerProps, tooltipNode } = useStudioTooltip<HTMLButtonElement>({
    title: tooltip,
    shortcut: tooltipShortcut,
    description: tooltipDescription,
    placement: tooltipPlacement,
  });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        {...rest}
        onPointerEnter={e => {
          triggerProps.onPointerEnter(e);
          onPointerEnter?.(e);
        }}
        onPointerMove={e => {
          triggerProps.onPointerMove(e);
          onPointerMove?.(e);
        }}
        onPointerLeave={e => {
          triggerProps.onPointerLeave(e);
          onPointerLeave?.(e);
        }}
        onPointerDown={e => {
          triggerProps.onPointerDown(e);
          onPointerDown?.(e);
        }}
        onMouseEnter={e => {
          triggerProps.onMouseEnter(e);
          onMouseEnter?.(e);
        }}
        onMouseMove={e => {
          triggerProps.onMouseMove(e);
          onMouseMove?.(e);
        }}
        onMouseLeave={e => {
          triggerProps.onMouseLeave(e);
          onMouseLeave?.(e);
        }}
        onFocus={e => {
          triggerProps.onFocus(e);
          onFocus?.(e);
        }}
        onBlur={e => {
          triggerProps.onBlur(e);
          onBlur?.(e);
        }}
      >
        {children}
      </button>
      {tooltipNode}
    </>
  );
}

export function ViewportCursorTooltip({
  tip,
}: {
  tip: ViewportHoverTip | null;
}): React.ReactElement | null {
  const tipRef = useRef<HTMLDivElement | null>(null);
  const [coords, setCoords] = useState<PositionedTooltipCoords | null>(null);

  useLayoutEffect(() => {
    if (!tip || !tipRef.current || typeof window === 'undefined') {
      setCoords(null);
      return;
    }
    const tipWidth = tipRef.current.offsetWidth || 168;
    const tipHeight = tipRef.current.offsetHeight || 32;
    const next = computeViewportCursorTooltipPosition({
      pointerX: tip.clientX,
      pointerY: tip.clientY,
      tipWidth,
      tipHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setCoords(prev =>
      prev &&
      prev.left === next.left &&
      prev.top === next.top &&
      prev.resolvedPlacement === next.resolvedPlacement
        ? prev
        : next,
    );
  }, [tip]);

  if (!tip || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      ref={tipRef}
      role="tooltip"
      data-tooltip-placement={coords?.resolvedPlacement ?? 'top'}
      data-viewport-cursor-tooltip="true"
      className="studio-tooltip studio-viewport-tooltip"
      style={{
        position: 'fixed',
        left: coords ? coords.left : 0,
        top: coords ? coords.top : 0,
        visibility: coords ? 'visible' : 'hidden',
        pointerEvents: 'none',
      }}
    >
      <StudioTooltipBody
        title={tip.title}
        shortcut={tip.shortcut}
        description={tip.description}
      />
    </div>,
    document.body,
  );
}

export function ViewportHoverTooltipHost({
  emitterRef,
}: {
  emitterRef: React.MutableRefObject<((tip: ViewportHoverTip | null) => void) | null>;
}): React.ReactElement | null {
  const [tip, setTip] = useState<ViewportHoverTip | null>(null);

  useEffect(() => {
    emitterRef.current = setTip;
    return () => {
      emitterRef.current = null;
    };
  }, [emitterRef]);

  return <ViewportCursorTooltip tip={tip} />;
}

