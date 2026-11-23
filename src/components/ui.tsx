import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TooltipButton } from './studioTooltip';

/* --- Studio SVG Icons (16x16, stroke-based, crisp at 1x/1.5x/2x DPI) --- */

export const Icons = {
  figure: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="3.2" r="1.9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.2 6.6h7.6M8 6.6v4.1m0 0-2.3 3.8M8 10.7l2.3 3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  prop: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.1 13.3 5v6L8 13.9 2.7 11V5L8 2.1Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.8 5.1 8 8l5.2-2.9M8 8v5.8" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  light: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.8" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.8v1.7M8 12.5v1.7M1.8 8h1.7M12.5 8h1.7M3.6 3.6l1.2 1.2M11.2 11.2l1.2 1.2M12.4 3.6l-1.2 1.2M4.8 11.2l-1.2 1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  scene: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="m2.5 10.5 3.3-3 2.7 2.4 2.2-1.9 2.8 2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pose: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="3" r="1.7" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.3 6.2 8 7.2l3.7-2.4M8 7.2v3.6m0 0-2.6 3.5M8 10.8l2.4 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  motion: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 4.2 12 8l-6.5 3.8V4.2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M2.5 4.5v7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  plus: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3.2v9.6M3.2 8h9.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.2 4.5h9.6M6.2 4.5V3.1c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7v1.4m-5.3 0 .6 8.3c0 .6.5 1 1.1 1h3.6c.6 0 1-.4 1.1-1l.6-8.3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevronDown: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m4.2 6.2 3.8 3.8 3.8-3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.3 8.3 3 3 6.4-6.6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  upload: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 10.5V3.2m0 0L5.2 6M8 3.2 10.8 6M2.8 11.2v1.3c0 .6.5 1.1 1.1 1.1h8.2c.6 0 1.1-.5 1.1-1.1v-1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  download: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 2.8v7.3m0 0L5.2 7.3M8 10.1l2.8-2.8M2.8 11.4v1.2c0 .6.5 1.1 1.1 1.1h8.2c.6 0 1.1-.5 1.1-1.1v-1.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  sun: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.6v1.6M8 12.8v1.6M1.6 8h1.6M12.8 8h1.6M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M12.5 3.5l-1.1 1.1M4.6 11.4l-1.1 1.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  moon: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M12.8 9.8A5.2 5.2 0 0 1 6.2 3.2a5.3 5.3 0 1 0 6.6 6.6Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  play: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5 3.4 12.4 8 5 12.6V3.4Z" fill="currentColor" />
    </svg>
  ),
  pause: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="4.2" y="3.3" width="2.7" height="9.4" rx="0.8" fill="currentColor" />
      <rect x="9.1" y="3.3" width="2.7" height="9.4" rx="0.8" fill="currentColor" />
    </svg>
  ),
  eye: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1.6 8s2.3-4.2 6.4-4.2S14.4 8 14.4 8s-2.3 4.2-6.4 4.2S1.6 8 1.6 8Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="1.9" stroke="currentColor" strokeWidth="1.35" />
    </svg>
  ),
  eyeOff: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.4 2.4 13.6 13.6M6.5 4.1A6.6 6.6 0 0 1 8 3.8c4.1 0 6.4 4.2 6.4 4.2a11.3 11.3 0 0 1-2.2 2.7M4.2 5.3A11.3 11.3 0 0 0 1.6 8s2.3 4.2 6.4 4.2c.9 0 1.7-.2 2.4-.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lock: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.2" y="7.2" width="9.6" height="6.6" rx="1.5" stroke="currentColor" strokeWidth="1.35" />
      <path d="M5.2 7.2V5.3a2.8 2.8 0 0 1 5.6 0v1.9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  ),
  unlock: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.2" y="7.2" width="9.6" height="6.6" rx="1.5" stroke="currentColor" strokeWidth="1.35" />
      <path d="M5.2 7.2V5.3a2.8 2.8 0 0 1 5.2-1.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  ),
  chevronRight: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m6.2 4.2 3.8 3.8-3.8 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  room: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.4 7.3 8 2.6l5.6 4.7v6.1H2.4V7.3Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M6.4 13.4V9.4h3.2v4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  ),
  lightSpot: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="3.1" r="1.4" stroke="currentColor" strokeWidth="1.35" />
      <path d="M6.9 4.3 3.1 12.6h9.8L9.1 4.3" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  ),
  lightParallel: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.2h10M3 8h10M3 11.8h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="m10.8 2.4 2.2 1.8-2.2 1.8M10.8 6.2 13 8l-2.2 1.8M10.8 10 13 11.8l-2.2 1.8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  lightOmni: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    </svg>
  ),
};

/* --- 1. Unified Custom SelectDropdown (Accessible Combobox + Portal Popover) --- */

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  meta?: string;
  icon?: ReactNode;
}

interface SelectDropdownProps {
  id?: string;
  ariaLabel: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  leadingIcon?: ReactNode;
  actionMenu?: boolean;
}

export function SelectDropdown({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  leadingIcon,
  actionMenu = false,
}: SelectDropdownProps) {
  const autoId = useId();
  const triggerId = id ?? `select-${autoId}`;
  const listboxId = `listbox-${autoId}`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [coords, setCoords] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight: number }>({
    top: 0,
    left: 0,
    width: 220,
    maxHeight: 300,
  });

  const selectedIndex = actionMenu ? -1 : options.findIndex(o => o.value === value);
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : undefined;

  const updatePosition = () => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom - 44;
    const spaceAbove = rect.top - 16;
    const desiredHeight = Math.min(320, options.length * 36 + 24);
    const preferAbove = spaceBelow < desiredHeight && spaceAbove > spaceBelow;
    const width = Math.max(rect.width, 200);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    if (preferAbove) {
      setCoords({
        bottom: window.innerHeight - rect.top + 4,
        left,
        width,
        maxHeight: Math.max(140, Math.min(320, spaceAbove)),
      });
    } else {
      setCoords({
        top: rect.bottom + 4,
        left,
        width,
        maxHeight: Math.max(140, Math.min(320, spaceBelow)),
      });
    }
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const initial = selectedIndex >= 0 ? selectedIndex : 0;
    setActiveIndex(initial);
    requestAnimationFrame(() => {
      itemRefs.current[initial]?.scrollIntoView({ block: 'nearest' });
    });
  }, [open, selectedIndex, options.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    const onViewportChange = () => updatePosition();
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onWindowKeyDown, true);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onWindowKeyDown, true);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [open]);

  const commit = (idx: number) => {
    const opt = options[idx];
    if (!opt) return;
    setOpen(false);
    onChange(opt.value);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!options.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const next = (activeIndex + 1) % options.length;
        setActiveIndex(next);
        itemRefs.current[next]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
      } else {
        const prev = (activeIndex - 1 + options.length) % options.length;
        setActiveIndex(prev);
        itemRefs.current[prev]?.scrollIntoView({ block: 'nearest' });
      }
    } else if (event.key === 'Home' && open) {
      event.preventDefault();
      setActiveIndex(0);
      itemRefs.current[0]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'End' && open) {
      event.preventDefault();
      const last = options.length - 1;
      setActiveIndex(last);
      itemRefs.current[last]?.scrollIntoView({ block: 'nearest' });
    } else if ((event.key === 'Enter' || event.key === ' ') && open) {
      event.preventDefault();
      commit(activeIndex);
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Tab' && open) {
      setOpen(false);
    }
  };

  let lastGroup: string | undefined;

  return (
    <>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        className={open ? 'select-trigger open' : 'select-trigger'}
        onClick={() => setOpen(v => !v)}
        onKeyDown={onKeyDown}
      >
        {(leadingIcon || selectedOption?.icon) && (
          <span className="select-trigger-icon">{selectedOption?.icon ?? leadingIcon}</span>
        )}
        <span className={selectedOption ? 'select-trigger-label' : 'select-trigger-label placeholder'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        {selectedOption?.meta && <span className="select-trigger-meta">{selectedOption.meta}</span>}
        <span className={open ? 'select-chevron rotated' : 'select-chevron'}>{Icons.chevronDown}</span>
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            className="select-popover"
            onKeyDown={onKeyDown}
            style={{
              top: coords.top,
              bottom: coords.bottom,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
          >
            <div className="select-popover-inner">
              {options.map((opt, idx) => {
                const showGroup = Boolean(opt.group && opt.group !== lastGroup);
                const hadPreviousGroup = lastGroup !== undefined;
                lastGroup = opt.group;
                const isSelected = !actionMenu && opt.value === value;
                const isActive = idx === activeIndex;
                return (
                  <div key={opt.value} className="select-option-wrap">
                    {showGroup && (
                      <div className={hadPreviousGroup ? 'select-group-header divided' : 'select-group-header'}>
                        {opt.group}
                      </div>
                    )}
                    <button
                      ref={el => {
                        itemRefs.current[idx] = el;
                      }}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      className={`select-option${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => commit(idx)}
                    >
                      {opt.icon && <span className="select-option-icon">{opt.icon}</span>}
                      <span className="select-option-label">{opt.label}</span>
                      {opt.meta && <span className="select-option-meta">{opt.meta}</span>}
                      <span className="select-option-check" aria-hidden="true">
                        {isSelected ? Icons.check : null}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}

/* --- 2. Unified SegmentedControl --- */

export interface SegmentItem<T extends string> {
  value: T;
  label: string;
  shortcut?: string;
  icon?: ReactNode;
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  role = 'group',
  value,
  items,
  onChange,
  fullWidth = false,
  disabled = false,
}: {
  ariaLabel: string;
  role?: 'group' | 'tablist';
  value: T;
  items: SegmentItem<T>[];
  onChange: (value: T) => void;
  fullWidth?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={fullWidth ? 'segmented full-width' : 'segmented'}
      role={role}
      aria-label={ariaLabel}
      style={fullWidth ? { gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` } : undefined}
    >
      {items.map(item => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-label={item.icon ? item.label : undefined}
            disabled={disabled}
            role={role === 'tablist' ? 'tab' : undefined}
            aria-selected={role === 'tablist' ? active : undefined}
            aria-pressed={role === 'group' ? active : undefined}
            className={active ? 'segment active' : 'segment'}
            onClick={() => onChange(item.value)}
          >
            {item.icon && <span aria-hidden="true">{item.icon}</span>}
            <span>{item.label}</span>
            {item.shortcut && <kbd>{item.shortcut}</kbd>}
          </button>
        );
      })}
    </div>
  );
}

/* --- 3. Unified SwitchRow (Boolean Toggle) --- */

export function SwitchRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <div className="switch-copy" onClick={() => onChange(!checked)}>
        <span className="switch-label">{label}</span>
        {description && <span className="switch-desc">{description}</span>}
      </div>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={checked}
        className={checked ? 'switch-track checked' : 'switch-track'}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-thumb" />
      </button>
    </div>
  );
}

/* --- 4. Unified Structured ListRow (Scene Outliner & Saved Studies) --- */

export function ListRow({
  icon,
  title,
  meta,
  selected = false,
  onSelect,
  onDelete,
  deleteLabel,
}: {
  icon: ReactNode;
  title: string;
  meta: string;
  selected?: boolean;
  onSelect: (event: MouseEvent) => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  return (
    <li className={selected ? 'list-row selected' : 'list-row'} onClick={onSelect}>
      <button type="button" className="list-row-main">
        <span className="list-row-badge">{icon}</span>
        <span className="list-row-copy">
          <span className="list-row-title">{title}</span>
          <span className="list-row-meta">{meta}</span>
        </span>
      </button>
      {onDelete && (
        <TooltipButton
          className="icon-btn danger-hover list-row-action"
          aria-label={deleteLabel ?? `Delete ${title}`}
          tooltip={deleteLabel ?? `Delete ${title}`}
          tooltipPlacement="top"
          onClick={event => {
            event.stopPropagation();
            onDelete();
          }}
        >
          {Icons.trash}
        </TooltipButton>
      )}
    </li>
  );
}

export function LayerTreeRow({
  icon,
  title,
  meta,
  depth = 0,
  isGroup = false,
  expanded = false,
  onToggleExpand,
  selected = false,
  visible = true,
  locked = false,
  inheritedLocked = false,
  generatorEnabled,
  onToggleGenerator,
  extraActions,
  onSelect,
  onToggleVisible,
  onToggleLock,
  onDelete,
  deleteLabel,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  depth?: 0 | 1 | 2;
  isGroup?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  selected?: boolean;
  visible?: boolean;
  locked?: boolean;
  inheritedLocked?: boolean;
  generatorEnabled?: boolean;
  onToggleGenerator?: () => void;
  extraActions?: ReactNode;
  onSelect?: (event: MouseEvent) => void;
  onToggleVisible?: () => void;
  onToggleLock?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  const effectiveLocked = locked || inheritedLocked;
  return (
    <li
      className={[
        'layer-row',
        depth === 2 ? 'layer-row-grandchild' : depth === 1 ? 'layer-row-child' : 'layer-row-root',
        isGroup ? 'layer-row-group' : '',
        selected ? 'selected' : '',
        !visible || generatorEnabled === false ? 'layer-hidden' : '',
        effectiveLocked ? 'layer-locked' : '',
      ].filter(Boolean).join(' ')}
      onClick={onSelect ?? onToggleExpand}
    >
      {onToggleExpand ? (
        <button
          type="button"
          className="layer-chevron"
          aria-label={expanded ? `Collapse ${title}` : `Expand ${title}`}
          aria-expanded={expanded}
          onClick={event => {
            event.stopPropagation();
            onToggleExpand();
          }}
        >
          {expanded ? Icons.chevronDown : Icons.chevronRight}
        </button>
      ) : depth === 0 ? (
        <span className="layer-chevron-spacer" aria-hidden="true" />
      ) : null}
      <button type="button" className="layer-row-main">
        <span className="layer-row-badge">{icon}</span>
        <span className="list-row-copy">
          <span className="list-row-title">{title}</span>
          {meta && <span className="list-row-meta">{meta}</span>}
        </span>
      </button>
      <div className="layer-row-actions">
        {extraActions}
        {onToggleGenerator && (
          <TooltipButton
            className={`icon-btn layer-action-btn ${generatorEnabled === false ? 'is-off' : 'is-gen-on'}`}
            aria-label={generatorEnabled === false ? `Enable ${title}` : `Disable ${title}`}
            tooltip={generatorEnabled === false ? `Enable ${title}` : `Disable ${title}`}
            tooltipDescription={
              generatorEnabled === false ? 'Generator/Modifier off' : 'Generator/Modifier active'
            }
            tooltipPlacement="top"
            aria-pressed={generatorEnabled !== false}
            onClick={event => {
              event.stopPropagation();
              onToggleGenerator();
            }}
          >
            {Icons.check}
          </TooltipButton>
        )}
        {onToggleVisible && (
          <TooltipButton
            className={`icon-btn layer-action-btn ${!visible ? 'is-off' : ''}`}
            aria-label={visible ? `Hide ${title}` : `Show ${title}`}
            tooltip={visible ? `Hide ${title}` : `Show ${title}`}
            tooltipPlacement="top"
            aria-pressed={!visible}
            onClick={event => {
              event.stopPropagation();
              onToggleVisible();
            }}
          >
            {visible ? Icons.eye : Icons.eyeOff}
          </TooltipButton>
        )}
        {onToggleLock && (
          <TooltipButton
            className={`icon-btn layer-action-btn ${effectiveLocked ? 'is-locked' : ''}`}
            aria-label={locked ? `Unlock ${title}` : `Lock ${title}`}
            tooltip={
              inheritedLocked && !locked
                ? `${title} locked by parent`
                : locked
                  ? `Unlock ${title}`
                  : `Lock ${title}`
            }
            tooltipPlacement="top"
            aria-pressed={effectiveLocked}
            onClick={event => {
              event.stopPropagation();
              onToggleLock();
            }}
          >
            {effectiveLocked ? Icons.lock : Icons.unlock}
          </TooltipButton>
        )}
        {onDelete && (
          <TooltipButton
            className="icon-btn danger-hover layer-action-btn"
            aria-label={deleteLabel ?? `Delete ${title}`}
            tooltip={effectiveLocked ? `Unlock ${title} to delete` : (deleteLabel ?? `Delete ${title}`)}
            tooltipPlacement="top"
            disabled={effectiveLocked}
            onClick={event => {
              event.stopPropagation();
              if (!effectiveLocked) onDelete();
            }}
          >
            {Icons.trash}
          </TooltipButton>
        )}
      </div>
    </li>
  );
}

/* --- 5. Unified ColorField, SliderField, and Vector3Field --- */

export interface ColorSwatchOption {
  value: string;
  label: string;
}

export function ColorField({
  label,
  value,
  onChange,
  resetValue,
  resetLabel = 'Original',
  swatches,
}: {
  label: string;
  value: string;
  onChange: (hex: string) => void;
  resetValue?: string;
  resetLabel?: string;
  swatches?: readonly ColorSwatchOption[];
}) {
  const isAtReset = Boolean(resetValue && value.toLowerCase() === resetValue.toLowerCase());
  const showReset = Boolean(resetValue && !isAtReset);
  return (
    <div className={swatches?.length ? 'color-field color-field-with-swatches' : 'color-field'}>
      <div className="color-field-row">
        <span className="field-inline-label">{label}</span>
        <div className="color-field-controls">
          {showReset && resetValue && (
            <button
              type="button"
              className="color-reset-btn"
              onClick={() => onChange(resetValue)}
              aria-label={`Reset ${label} to original`}
            >
              {resetLabel}
            </button>
          )}
          <label className="color-swatch-pill">
            <span
              className={isAtReset ? 'color-swatch-chip is-original' : 'color-swatch-chip'}
              style={isAtReset ? undefined : { backgroundColor: value }}
              aria-hidden="true"
            />
            <span className="color-swatch-hex">{isAtReset ? resetLabel : value.toUpperCase()}</span>
            <input
              type="color"
              aria-label={label}
              value={value}
              onChange={e => onChange(e.target.value)}
            />
          </label>
        </div>
      </div>
      {swatches && swatches.length > 0 && (
        <div className="color-quick-swatches" role="group" aria-label={`${label} presets`}>
          {swatches.map(swatch => {
            const active = value.toLowerCase() === swatch.value.toLowerCase();
            const isOriginalSwatch = Boolean(
              resetValue &&
                resetLabel === 'Original' &&
                swatch.value.toLowerCase() === resetValue.toLowerCase(),
            );
            const swatchClass = [
              'color-quick-swatch',
              isOriginalSwatch ? 'is-original' : '',
              active ? 'active' : '',
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <TooltipButton
                key={`${swatch.label}-${swatch.value}`}
                className={swatchClass}
                style={isOriginalSwatch ? undefined : { backgroundColor: swatch.value }}
                tooltip={swatch.label}
                tooltipDescription={
                  isOriginalSwatch ? 'Untouched source texture' : swatch.value.toUpperCase()
                }
                tooltipPlacement="top"
                aria-label={`${label}: ${swatch.label}`}
                aria-pressed={active}
                onClick={() => onChange(swatch.value)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export function SliderField({
  label,
  ariaLabel,
  value,
  min,
  max,
  step = 1,
  displayValue,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="slider-field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        <span className="field-readout">{displayValue}</span>
      </div>
      <input
        type="range"
        aria-label={ariaLabel ?? label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </div>
  );
}

const AXES = ['X', 'Y', 'Z'] as const;

export function NumericField({
  label,
  ariaLabel,
  prefix,
  value,
  min,
  max,
  step = 0.05,
  precision = 4,
  disabled = false,
  onChange,
}: {
  label?: string;
  ariaLabel: string;
  prefix?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  const format = (v: number) => String(Number(v.toFixed(precision)));
  const [draft, setDraft] = useState(() => format(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(format(value));
    setInvalid(false);
  }, [value, precision]);

  const apply = () => {
    if (disabled) return;
    if (draft === format(value)) return;
    const n = Number(draft);
    if (!draft.trim() || !Number.isFinite(n) || n < min || n > max) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (n !== value) onChange(n);
  };

  return (
    <div className={prefix ? 'num-cell' : 'num-field'}>
      {label && <span className="field-label">{label}</span>}
      <label className={`num-shell${invalid ? ' invalid' : ''}${disabled ? ' disabled' : ''}`}>
        {prefix && <span className="vec-axis">{prefix}</span>}
        <input
          type="number"
          aria-label={ariaLabel}
          aria-invalid={invalid}
          disabled={disabled}
          min={min}
          max={max}
          step={step}
          value={draft}
          onChange={e => {
            setDraft(e.target.value);
            setInvalid(false);
          }}
          onBlur={apply}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setDraft(format(value));
              setInvalid(false);
              e.currentTarget.blur();
            }
          }}
        />
      </label>
      {invalid && (
        <small className="error-text">
          {min}..{max}
        </small>
      )}
    </div>
  );
}

export function Vector3Field({
  label,
  value,
  min = -100,
  max = 100,
  step = 0.05,
  precision = 2,
  disabled = false,
  onChange,
  onReset,
}: {
  label: string;
  value: [number, number, number];
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  disabled?: boolean;
  onChange: (v: [number, number, number]) => void;
  onReset?: () => void;
}) {
  return (
    <div className="vec-field">
      <div className="field-head">
        <span className="field-label">{label}</span>
        {onReset && (
          <button type="button" className="text-btn" disabled={disabled} onClick={onReset}>
            Reset
          </button>
        )}
      </div>
      <div className="vec-grid">
        {AXES.map((axis, i) => (
          <NumericField
            key={axis}
            ariaLabel={`${label} ${axis}`}
            prefix={axis}
            value={value[i]}
            min={min}
            max={max}
            step={step}
            precision={precision}
            disabled={disabled}
            onChange={n => {
              const next: [number, number, number] = [...value];
              next[i] = n;
              onChange(next);
            }}
          />
        ))}
      </div>
    </div>
  );
}
