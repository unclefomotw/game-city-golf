// Which kind of input the player is using, so hints only describe that one (PLT-3, ADR-012).
// Starts from a guess based on the primary pointer, then follows the last input actually used.

export type InputKind = 'mouse' | 'touch';

/** Kind implied by a PointerEvent's pointerType; unknown types keep the current kind. */
export function inputKindFromPointer(pointerType: string, current: InputKind): InputKind {
  if (pointerType === 'mouse') return 'mouse';
  // A pen has no keyboard or wheel either, so its gestures match the touch hints.
  if (pointerType === 'touch' || pointerType === 'pen') return 'touch';
  return current;
}

/** Listens on the whole window and returns a getter for the current kind. */
export function trackInputKind(win: Window = window): () => InputKind {
  let kind: InputKind = win.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
  // Capture phase so widgets that stop propagation still count.
  win.addEventListener('pointerdown', (e) => (kind = inputKindFromPointer(e.pointerType, kind)), true);
  win.addEventListener('keydown', () => (kind = 'mouse'), true);
  return () => kind;
}
