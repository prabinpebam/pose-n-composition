import { describe, expect, it } from 'vitest';
import {
  claimViewportPointerInteraction,
  clearDomTextSelection,
  isTextEditingTarget,
  lockDocumentSelectionDuringDrag,
  resolveStudioShortcut,
} from './inputRouting';

interface MockElementOptions {
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  isContentEditable?: boolean;
  attrs?: Record<string, string>;
  parentElement?: EventTarget | null;
}

function makeElement(tagName: string, opts: MockElementOptions = {}): EventTarget & {
  tagName: string;
  type?: string;
  disabled?: boolean;
  readOnly?: boolean;
  isContentEditable?: boolean;
  tabIndex: number;
  blurred: boolean;
  focused: boolean;
} {
  const attrs = new Map<string, string>(Object.entries(opts.attrs ?? {}));
  if (opts.type !== undefined && !attrs.has('type')) {
    attrs.set('type', opts.type);
  }
  if (opts.disabled) attrs.set('disabled', '');
  if (opts.readOnly) attrs.set('readonly', '');

  const normalizedTag = tagName.toUpperCase();
  const resolvedType =
    normalizedTag === 'INPUT'
      ? (opts.type ?? attrs.get('type') ?? 'text').toLowerCase()
      : opts.type;

  const el = {
    nodeType: 1,
    tagName: normalizedTag,
    type: resolvedType,
    disabled: Boolean(opts.disabled),
    readOnly: Boolean(opts.readOnly),
    isContentEditable: opts.isContentEditable,
    parentElement: opts.parentElement ?? null,
    tabIndex: attrs.has('tabindex') ? Number(attrs.get('tabindex')) : 0,
    blurred: false,
    focused: false,
    getAttribute(name: string): string | null {
      const lower = name.toLowerCase();
      if (lower === 'tabindex') {
        return attrs.has('tabindex') ? attrs.get('tabindex')! : null;
      }
      return attrs.has(lower) ? attrs.get(lower)! : null;
    },
    hasAttribute(name: string): boolean {
      return attrs.has(name.toLowerCase());
    },
    blur() {
      el.blurred = true;
    },
    focus() {
      el.focused = true;
    },
  };

  return el as unknown as EventTarget & typeof el;
}

describe('inputRouting', () => {
  describe('isTextEditingTarget', () => {
    it('returns true ONLY for genuine text-typing inputs, textareas, and contenteditable targets', () => {
      expect(isTextEditingTarget(makeElement('input', { type: 'text' }))).toBe(true);
      expect(isTextEditingTarget(makeElement('input'))).toBe(true); // <input> with no type attribute
      expect(isTextEditingTarget(makeElement('input', { type: 'number' }))).toBe(true);
      expect(isTextEditingTarget(makeElement('input', { type: 'search' }))).toBe(true);
      expect(isTextEditingTarget(makeElement('input', { type: 'email' }))).toBe(true);
      expect(isTextEditingTarget(makeElement('input', { type: 'password' }))).toBe(true);
      expect(isTextEditingTarget(makeElement('input', { type: 'tel' }))).toBe(true);
      expect(isTextEditingTarget(makeElement('input', { type: 'url' }))).toBe(true);
      expect(isTextEditingTarget(makeElement('textarea'))).toBe(true);

      const editableDiv = makeElement('div', {
        isContentEditable: true,
        attrs: { contenteditable: 'true' },
      });
      const childSpan = makeElement('span', {
        isContentEditable: true,
        parentElement: editableDiv,
      });
      expect(isTextEditingTarget(editableDiv)).toBe(true);
      expect(isTextEditingTarget(childSpan)).toBe(true);
    });

    it('returns false for buttons, sliders, color pickers, checkboxes, selects, combobox triggers, canvas, and disabled/readOnly fields', () => {
      expect(isTextEditingTarget(null)).toBe(false);
      expect(isTextEditingTarget(undefined)).toBe(false);
      expect(isTextEditingTarget(makeElement('button'))).toBe(false);
      expect(isTextEditingTarget(makeElement('button', { attrs: { role: 'combobox', 'aria-expanded': 'false' } }))).toBe(false);
      expect(isTextEditingTarget(makeElement('button', { attrs: { role: 'switch' } }))).toBe(false);
      expect(isTextEditingTarget(makeElement('button', { attrs: { role: 'tab' } }))).toBe(false);
      expect(isTextEditingTarget(makeElement('li', { attrs: { role: 'treeitem' } }))).toBe(false);
      expect(isTextEditingTarget(makeElement('input', { type: 'range' }))).toBe(false);
      expect(isTextEditingTarget(makeElement('input', { type: 'color' }))).toBe(false);
      expect(isTextEditingTarget(makeElement('input', { type: 'checkbox' }))).toBe(false);
      expect(isTextEditingTarget(makeElement('input', { type: 'radio' }))).toBe(false);
      expect(isTextEditingTarget(makeElement('input', { type: 'file' }))).toBe(false);
      expect(isTextEditingTarget(makeElement('input', { type: 'button' }))).toBe(false);
      expect(isTextEditingTarget(makeElement('select'))).toBe(false);
      expect(isTextEditingTarget(makeElement('div'))).toBe(false);
      expect(isTextEditingTarget(makeElement('canvas'))).toBe(false);

      // Disabled or readOnly text/number inputs and textareas cannot be typed into
      expect(isTextEditingTarget(makeElement('input', { type: 'text', disabled: true }))).toBe(false);
      expect(isTextEditingTarget(makeElement('input', { type: 'number', readOnly: true }))).toBe(false);
      expect(isTextEditingTarget(makeElement('textarea', { disabled: true }))).toBe(false);
      expect(isTextEditingTarget(makeElement('textarea', { readOnly: true }))).toBe(false);
    });
  });

  describe('resolveStudioShortcut', () => {
    it('routes W, E, R, F, C, 1-5, Delete, Backspace, and Ctrl+Z to viewport actions even when non-text UI controls hold focus', () => {
      const uiTargets = [
        makeElement('button'), // Toolbar or Preset button
        makeElement('button', { attrs: { class: 'layer-row-main' } }), // Layer Manager row
        makeElement('button', { attrs: { role: 'combobox', 'aria-expanded': 'false' } }), // Closed SelectDropdown trigger
        makeElement('input', { type: 'range' }), // SliderField
        makeElement('input', { type: 'color' }), // ColorField
        makeElement('input', { type: 'checkbox' }), // Skeleton tree checkbox
      ];

      for (const focusedControl of uiTargets) {
        expect(resolveStudioShortcut({ key: 'w', target: focusedControl }, { activeElement: focusedControl })).toEqual({
          action: 'mode-translate',
          preventDefault: true,
        });
        expect(resolveStudioShortcut({ key: 'e', target: focusedControl }, { activeElement: focusedControl })).toEqual({
          action: 'mode-rotate',
          preventDefault: true,
        });
        expect(
          resolveStudioShortcut({ key: 'r', target: focusedControl }, { activeElement: focusedControl, selectionCount: 1 }),
        ).toEqual({
          action: 'mode-scale',
          preventDefault: true,
        });
        expect(resolveStudioShortcut({ key: 'f', target: focusedControl }, { activeElement: focusedControl })).toEqual({
          action: 'frame-selection',
          preventDefault: true,
        });
        expect(resolveStudioShortcut({ key: 'c', target: focusedControl }, { activeElement: focusedControl })).toEqual({
          action: 'toggle-camera',
          preventDefault: true,
        });
        expect(resolveStudioShortcut({ key: '2', target: focusedControl }, { activeElement: focusedControl })).toEqual({
          action: 'render-mode',
          modeIndex: 1,
          preventDefault: true,
        });
        expect(resolveStudioShortcut({ key: 'Delete', target: focusedControl }, { activeElement: focusedControl })).toEqual({
          action: 'delete-selection',
          preventDefault: true,
        });
        expect(resolveStudioShortcut({ key: 'z', ctrlKey: true, target: focusedControl }, { activeElement: focusedControl })).toEqual({
          action: 'undo',
          preventDefault: true,
        });
      }
    });

    it('never hijacks typing inside text or numeric inputs, while Escape / Enter blurs back to the viewport', () => {
      const textInput = makeElement('input', { type: 'text' });
      const numInput = makeElement('input', { type: 'number' });
      const textarea = makeElement('textarea');

      for (const field of [textInput, numInput, textarea]) {
        for (const key of ['w', 'e', 'r', 'f', 'c', '1', 'Delete', 'Backspace', '?']) {
          expect(resolveStudioShortcut({ key, target: field }, { activeElement: field })).toEqual({
            action: 'none',
            preventDefault: false,
          });
        }
        // Native Ctrl+Z inside text input is preserved for text editing
        expect(resolveStudioShortcut({ key: 'z', ctrlKey: true, target: field }, { activeElement: field })).toEqual({
          action: 'none',
          preventDefault: false,
        });
      }

      // Escape blurs single-line inputs and textareas
      expect(resolveStudioShortcut({ key: 'Escape', target: textInput }, { activeElement: textInput }).action).toBe(
        'blur-text-input',
      );
      expect(resolveStudioShortcut({ key: 'Escape', target: numInput }, { activeElement: numInput }).action).toBe(
        'blur-text-input',
      );
      expect(resolveStudioShortcut({ key: 'Escape', target: textarea }, { activeElement: textarea }).action).toBe(
        'blur-text-input',
      );

      // Enter blurs single-line inputs, but inserts a newline in <textarea>
      expect(resolveStudioShortcut({ key: 'Enter', target: textInput }, { activeElement: textInput }).action).toBe(
        'blur-text-input',
      );
      expect(resolveStudioShortcut({ key: 'Enter', target: textarea }, { activeElement: textarea }).action).toBe('none');
    });

    it('yields Escape and menu navigation keys when a SelectDropdown popover is open, without blocking single-key letter shortcuts', () => {
      const trigger = makeElement('button', { attrs: { role: 'combobox', 'aria-expanded': 'true' } });
      expect(
        resolveStudioShortcut({ key: 'Escape', target: trigger }, { activeElement: trigger, hasOpenDropdown: true }),
      ).toEqual({
        action: 'none',
        preventDefault: false,
      });
      expect(
        resolveStudioShortcut({ key: 'ArrowDown', target: trigger }, { activeElement: trigger, hasOpenDropdown: true }),
      ).toEqual({
        action: 'none',
        preventDefault: false,
      });
      // When closed, Escape clears viewport joint/help state as expected
      expect(
        resolveStudioShortcut({ key: 'Escape', target: trigger }, { activeElement: trigger, hasOpenDropdown: false }),
      ).toEqual({
        action: 'escape',
        preventDefault: true,
      });
    });

    it('does not intercept browser modifier shortcuts like Ctrl+R or Ctrl+C', () => {
      const body = makeElement('body');
      expect(resolveStudioShortcut({ key: 'r', ctrlKey: true, target: body }, { activeElement: body }).action).toBe('none');
      expect(resolveStudioShortcut({ key: 'c', ctrlKey: true, target: body }, { activeElement: body }).action).toBe('none');
    });
  });

  describe('DOM selection clearing & drag-lockup prevention', () => {
    it('clears DOM selection, blurs active UI controls, focuses viewport canvas, and blocks selectstart/dragstart during drag', () => {
      let selectionCleared = 0;
      const focusedBtn = makeElement('button');
      const docListeners = new Map<string, Set<(e: Event) => void>>();

      const fakeDoc = {
        activeElement: focusedBtn,
        body: makeElement('body'),
        defaultView: {
          getSelection: () => ({
            rangeCount: 1,
            removeAllRanges: () => {
              selectionCleared += 1;
            },
          }),
        },
        addEventListener(type: string, fn: (e: Event) => void) {
          if (!docListeners.has(type)) docListeners.set(type, new Set());
          docListeners.get(type)!.add(fn);
        },
        removeEventListener(type: string, fn: (e: Event) => void) {
          docListeners.get(type)?.delete(fn);
        },
      } as unknown as Document;

      const canvas = makeElement('canvas') as unknown as HTMLElement & {
        ownerDocument: Document;
        focused: boolean;
        tabIndex: number;
      };
      canvas.ownerDocument = fakeDoc;

      let defaultPrevented = false;
      claimViewportPointerInteraction(canvas, {
        preventDefault: () => {
          defaultPrevented = true;
        },
      });

      expect(selectionCleared).toBe(1);
      expect(focusedBtn.blurred).toBe(true);
      expect(canvas.tabIndex).toBe(-1);
      expect(canvas.focused).toBe(true);
      expect(defaultPrevented).toBe(true);

      // Verify lockDocumentSelectionDuringDrag blocks both selectstart and dragstart until released
      const unlock = lockDocumentSelectionDuringDrag(fakeDoc);
      let selectPrevented = false;
      let dragPrevented = false;
      for (const fn of docListeners.get('selectstart') ?? []) {
        fn({ preventDefault: () => { selectPrevented = true; } } as unknown as Event);
      }
      for (const fn of docListeners.get('dragstart') ?? []) {
        fn({ preventDefault: () => { dragPrevented = true; } } as unknown as Event);
      }
      expect(selectPrevented).toBe(true);
      expect(dragPrevented).toBe(true);

      unlock();
      expect(docListeners.get('selectstart')?.size ?? 0).toBe(0);
      expect(docListeners.get('dragstart')?.size ?? 0).toBe(0);

      clearDomTextSelection(fakeDoc);
      expect(selectionCleared).toBe(2);
    });
  });
});
