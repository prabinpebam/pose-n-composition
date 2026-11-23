/**
 * Viewport-first input routing and DOM selection/drag guards.
 *
 * Implements the standard 3D DCC / Figma / Blender Web / Three.js Editor input model:
 * 1. Single-key viewport shortcuts (`W`, `E`, `R`, `F`, `C`, `1`–`5`, `Delete`/`Backspace`, `?`)
 *    always route to the 3D viewport UNLESS active focus is inside a genuine text-typing field.
 *    Non-text UI controls (`<button>`, `<input type="range">`, `<input type="color">`, switches,
 *    closed dropdown triggers, Layer tree rows) never swallow viewport shortcuts.
 * 2. Clicking or dragging the 3D viewport clears any active DOM text selection, moves focus
 *    cleanly onto the viewport canvas, and suppresses native HTML5 selection drag (`dragstart`
 *    / `selectstart`) so `pointercancel` can never lock up orbit or pan gestures.
 */

export const TEXT_EDITING_INPUT_TYPES: ReadonlySet<string> = new Set([
  'text',
  'search',
  'number',
  'email',
  'password',
  'tel',
  'url',
]);

interface ElementLike {
  nodeType?: number;
  tagName?: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  isContentEditable?: boolean;
  parentElement?: ElementLike | null;
  getAttribute?: (name: string) => string | null;
  hasAttribute?: (name: string) => boolean;
  closest?: (selector: string) => ElementLike | null;
  blur?: () => void;
  focus?: (options?: { preventScroll?: boolean }) => void;
}

function resolveElementLike(target: EventTarget | null | undefined): ElementLike | null {
  if (!target || typeof target !== 'object') return null;
  const candidate = target as ElementLike;
  // Text node (nodeType === 3) -> inspect parentElement
  if (candidate.nodeType === 3 && candidate.parentElement) {
    return candidate.parentElement;
  }
  if (typeof candidate.tagName === 'string') {
    return candidate;
  }
  return null;
}

function isDisabledOrReadOnly(el: ElementLike): boolean {
  if (el.disabled === true || el.readOnly === true) return true;
  if (typeof el.hasAttribute === 'function') {
    if (el.hasAttribute('disabled') || el.hasAttribute('readonly')) return true;
  } else if (typeof el.getAttribute === 'function') {
    if (el.getAttribute('disabled') !== null || el.getAttribute('readonly') !== null) return true;
  }
  return false;
}

function isContentEditableElement(el: ElementLike): boolean {
  if (typeof el.isContentEditable === 'boolean') {
    if (el.isContentEditable) return true;
    // In browsers where `isContentEditable` is implemented, `false` is authoritative unless
    // testing with lightweight mocks that set `contenteditable` attributes without computing `isContentEditable`.
    const ownAttr = el.getAttribute?.('contenteditable');
    if (ownAttr === null || ownAttr === undefined) return false;
  }
  let cur: ElementLike | null | undefined = el;
  while (cur) {
    const attr = cur.getAttribute?.('contenteditable');
    if (attr !== null && attr !== undefined) {
      const normalized = attr.trim().toLowerCase();
      if (normalized === 'false') return false;
      if (normalized === '' || normalized === 'true' || normalized === 'plaintext-only') return true;
    }
    cur = cur.parentElement;
  }
  return false;
}

/**
 * Returns `true` ONLY when `target` is an interactive text-typing field where letter/number
 * keys are intended to insert or edit text:
 * - `<textarea>` (enabled and not readOnly)
 * - `[contenteditable="true"]`
 * - `<input>` (enabled and not readOnly) with normalized `type` in
 *   `'text' | 'search' | 'number' | 'email' | 'password' | 'tel' | 'url'` (including `<input>` without `type`).
 *
 * Returns `false` for buttons, sliders (`range`), color pickers (`color`), checkboxes, radios,
 * file inputs, `<select>`, custom `SelectDropdown` triggers, tabs, layer rows, and `<canvas>`.
 */
export function isTextEditingTarget(target: EventTarget | null | undefined): boolean {
  const el = resolveElementLike(target);
  if (!el || !el.tagName) return false;

  const tag = el.tagName.toUpperCase();
  if (tag === 'TEXTAREA') {
    return !isDisabledOrReadOnly(el);
  }

  if (tag === 'INPUT') {
    if (isDisabledOrReadOnly(el)) return false;
    const rawType =
      typeof el.type === 'string' && el.type.length > 0
        ? el.type
        : (el.getAttribute?.('type') ?? 'text');
    const normalizedType = rawType.trim().toLowerCase() || 'text';
    return TEXT_EDITING_INPUT_TYPES.has(normalizedType);
  }

  if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'CANVAS') {
    return false;
  }

  return isContentEditableElement(el);
}

export function isSingleLineTextInput(target: EventTarget | null | undefined): boolean {
  const el = resolveElementLike(target);
  if (!el || !el.tagName) return false;
  return el.tagName.toUpperCase() === 'INPUT' && isTextEditingTarget(target);
}

export function hasOpenSelectDropdown(doc?: Document | null): boolean {
  const root = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!root || typeof root.querySelector !== 'function') return false;
  return Boolean(root.querySelector('.select-popover, [role="combobox"][aria-expanded="true"]'));
}

export type StudioShortcutCommand =
  | { action: 'none'; preventDefault: false }
  | { action: 'blur-text-input'; target: HTMLElement; preventDefault: true }
  | { action: 'escape'; preventDefault: true }
  | { action: 'undo'; preventDefault: true }
  | { action: 'redo'; preventDefault: true }
  | { action: 'render-mode'; modeIndex: number; preventDefault: true }
  | { action: 'mode-translate'; preventDefault: true }
  | { action: 'mode-rotate'; preventDefault: true }
  | { action: 'mode-scale'; preventDefault: true }
  | { action: 'frame-selection'; preventDefault: true }
  | { action: 'delete-selection'; preventDefault: true }
  | { action: 'toggle-camera'; preventDefault: true }
  | { action: 'open-help'; preventDefault: true };

export interface ShortcutKeyEventLike {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  defaultPrevented?: boolean;
  target?: EventTarget | null;
}

export interface StudioShortcutContext {
  activeElement?: EventTarget | null;
  hasOpenDropdown?: boolean;
  helpOpen?: boolean;
  blocked?: boolean;
  selectionCount?: number;
}

const OPEN_DROPDOWN_KEYS = new Set([
  'Escape',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
  'Enter',
  ' ',
]);

/**
 * Resolves a `keydown` event into a deterministic studio command using viewport-first focus rules.
 */
export function resolveStudioShortcut(
  event: ShortcutKeyEventLike,
  context: StudioShortcutContext = {},
): StudioShortcutCommand {
  if (event.defaultPrevented || context.blocked) {
    return { action: 'none', preventDefault: false };
  }

  const editingTarget = isTextEditingTarget(event.target)
    ? event.target
    : isTextEditingTarget(context.activeElement)
      ? context.activeElement
      : null;

  if (editingTarget) {
    if (event.key === 'Escape' || (event.key === 'Enter' && isSingleLineTextInput(editingTarget))) {
      const blurEl = resolveElementLike(editingTarget);
      if (blurEl && typeof blurEl.blur === 'function') {
        return {
          action: 'blur-text-input',
          target: blurEl as unknown as HTMLElement,
          preventDefault: true,
        };
      }
    }
    return { action: 'none', preventDefault: false };
  }

  if (context.hasOpenDropdown && OPEN_DROPDOWN_KEYS.has(event.key)) {
    return { action: 'none', preventDefault: false };
  }

  if (event.key === 'Escape') {
    return { action: 'escape', preventDefault: true };
  }

  if (context.helpOpen) {
    return { action: 'none', preventDefault: false };
  }

  const mod = Boolean(event.ctrlKey || event.metaKey);
  const alt = Boolean(event.altKey);
  const lower = event.key.toLowerCase();

  if (mod && !alt) {
    if (lower === 'z') {
      return { action: event.shiftKey ? 'redo' : 'undo', preventDefault: true };
    }
    if (lower === 'y') {
      return { action: 'redo', preventDefault: true };
    }
    return { action: 'none', preventDefault: false };
  }

  if (mod || alt) {
    return { action: 'none', preventDefault: false };
  }

  if (/^[1-5]$/.test(event.key)) {
    return { action: 'render-mode', modeIndex: Number(event.key) - 1, preventDefault: true };
  }
  if (lower === 'w') {
    return { action: 'mode-translate', preventDefault: true };
  }
  if (lower === 'e') {
    return { action: 'mode-rotate', preventDefault: true };
  }
  if (lower === 'r') {
    if ((context.selectionCount ?? 0) < 2) {
      return { action: 'mode-scale', preventDefault: true };
    }
    return { action: 'none', preventDefault: false };
  }
  if (lower === 'f') {
    return { action: 'frame-selection', preventDefault: true };
  }
  if (event.key === 'Delete' || event.key === 'Backspace') {
    return { action: 'delete-selection', preventDefault: true };
  }
  if (lower === 'c') {
    return { action: 'toggle-camera', preventDefault: true };
  }
  if (event.key === '?') {
    return { action: 'open-help', preventDefault: true };
  }

  return { action: 'none', preventDefault: false };
}

/**
 * Clears any active DOM text selection in `doc` so Chromium/Firefox cannot initiate
 * a native HTML5 selection drag (`dragstart` -> `pointercancel`) on subsequent drags.
 */
export function clearDomTextSelection(doc?: Document | null): void {
  const root = doc ?? (typeof document !== 'undefined' ? document : null);
  const win = root?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  try {
    const selection = win?.getSelection?.();
    if (selection && selection.rangeCount > 0) {
      selection.removeAllRanges();
    }
  } catch {
    // Ignore selection API errors in non-browser test environments.
  }
}

/**
 * Prepares the 3D viewport element on `pointerdown` / `mousedown`:
 * 1. Clears any live DOM text selection (`window.getSelection().removeAllRanges()`).
 * 2. Blurs any focused UI button/slider/input and focuses the viewport canvas (`tabIndex = -1`)
 *    without scrolling, so subsequent `Space`/`Enter`/single-key shortcuts go to the viewport.
 * 3. Calls `event.preventDefault()` to suppress native selection drag initiation.
 */
export function claimViewportPointerInteraction(
  viewportElement: HTMLElement | null | undefined,
  event?: { preventDefault?: () => void } | null,
): void {
  const doc = viewportElement?.ownerDocument ?? (typeof document !== 'undefined' ? document : null);
  clearDomTextSelection(doc);

  if (doc && viewportElement) {
    const active = doc.activeElement as ElementLike | null;
    if (active && active !== (viewportElement as unknown as ElementLike) && active !== (doc.body as unknown as ElementLike)) {
      active.blur?.();
    }
    if (typeof viewportElement.getAttribute === 'function' && viewportElement.getAttribute('tabindex') === null) {
      viewportElement.tabIndex = -1;
    }
    try {
      viewportElement.focus?.({ preventScroll: true });
    } catch {
      // Ignore environments without focus options support.
    }
  }

  event?.preventDefault?.();
}

/**
 * Installs capture-phase `selectstart` and `dragstart` blockers on `doc` for the duration
 * of an active viewport pointer gesture (tumble, pan, gizmo drag, or marquee), returning a
 * cleanup function to invoke when the gesture ends.
 */
export function lockDocumentSelectionDuringDrag(doc?: Document | null): () => void {
  const root = doc ?? (typeof document !== 'undefined' ? document : null);
  if (!root || typeof root.addEventListener !== 'function') {
    return () => {};
  }
  const blockEvent = (event: Event) => {
    event.preventDefault();
  };
  root.addEventListener('selectstart', blockEvent, true);
  root.addEventListener('dragstart', blockEvent, true);
  return () => {
    root.removeEventListener('selectstart', blockEvent, true);
    root.removeEventListener('dragstart', blockEvent, true);
  };
}
