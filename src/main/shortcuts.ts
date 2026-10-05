export type Shortcut =
  | { readonly kind: 'select'; readonly index: number }
  | { readonly kind: 'reload' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'hide' };

/** The part of Electron's `Input` that shortcutFor reads. */
export interface KeyInput {
  readonly type: string;
  readonly key: string;
  readonly code: string;
  readonly meta: boolean;
  readonly control: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  readonly isAutoRepeat: boolean;
}

/**
 * The window shortcut that a key press stands for: ⌘1 to ⌘9, ⌘R, ⌘, and ⌘W.
 * The digits are read from the key position, so they work on layouts that
 * need Shift for digits. A held key counts once.
 */
export function shortcutFor(input: KeyInput): Shortcut | undefined {
  if (input.type !== 'keyDown' || input.isAutoRepeat) return undefined;
  if (!input.meta || input.control || input.alt || input.shift) return undefined;
  const digit = /^Digit([1-9])$/.exec(input.code)?.[1];
  if (digit !== undefined) return { kind: 'select', index: Number(digit) - 1 };
  switch (input.key.toLowerCase()) {
    case 'r':
      return { kind: 'reload' };
    case ',':
      return { kind: 'settings' };
    case 'w':
      return { kind: 'hide' };
    default:
      return undefined;
  }
}
