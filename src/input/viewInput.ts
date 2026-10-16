// Pointer + keyboard input on the square view (PLT-3, UI-3).
// Pointer Events cover mouse and touch with one code path (ADR-004).
//
// - one pointer starting near the ball (while aiming): slingshot aim
// - one pointer elsewhere: rotate the camera / look around
// - two pointers: pinch to zoom (orbit) or move forward/back (free)
// - mouse wheel: same as pinch
// - WASD/QE/Shift: free-camera movement

import type { MoveInput } from '../render/cameraRig';

export type ViewInputHooks = {
  /** Ball position in canvas pixels, or null if aiming is not possible now. */
  aimAnchor(): { x: number; y: number } | null;
  /** Pointer position relative to the ball, in canvas pixels. */
  onAim(dx: number, dy: number): void;
  onAimEnd(): void;
  rotate(dx: number, dy: number): void;
  zoom(factor: number): void;
  /** Max pixel distance from the ball to start aiming. */
  grabRadius(): number;
};

type Gesture = 'none' | 'aim' | 'look' | 'pinch';

export class ViewInput {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture = 'none';
  private pinchDist = 0;
  private readonly keys = new Set<string>();

  constructor(
    private readonly el: HTMLElement,
    private readonly hooks: ViewInputHooks,
  ) {
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get isAiming(): boolean {
    return this.gesture === 'aim';
  }

  keyboardMove(): MoveInput {
    const k = (code: string) => (this.keys.has(code) ? 1 : 0);
    return {
      forward: k('KeyW') - k('KeyS'),
      right: k('KeyD') - k('KeyA'),
      up: k('KeyE') - k('KeyQ'),
      fast: this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'),
    };
  }

  private local(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onDown = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      if (this.gesture === 'aim') this.hooks.onAimEnd();
      this.gesture = 'pinch';
      this.pinchDist = this.currentPinchDist();
      return;
    }
    if (this.pointers.size > 2) return;
    const anchor = this.hooks.aimAnchor();
    if (e.button === 0 && anchor && Math.hypot(p.x - anchor.x, p.y - anchor.y) <= this.hooks.grabRadius()) {
      this.gesture = 'aim';
      this.hooks.onAim(p.x - anchor.x, p.y - anchor.y);
    } else {
      this.gesture = 'look';
    }
  };

  private onMove = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    if (this.gesture === 'aim') {
      const anchor = this.hooks.aimAnchor();
      if (anchor) this.hooks.onAim(p.x - anchor.x, p.y - anchor.y);
    } else if (this.gesture === 'look') {
      this.hooks.rotate(p.x - prev.x, p.y - prev.y);
    } else if (this.gesture === 'pinch' && this.pointers.size === 2) {
      const d = this.currentPinchDist();
      if (this.pinchDist > 0 && d > 0) this.hooks.zoom(d / this.pinchDist);
      this.pinchDist = d;
    }
  };

  private onUp = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.gesture === 'aim') this.hooks.onAimEnd();
    // After a pinch, wait until all fingers lift before starting a new gesture.
    this.gesture = this.pointers.size === 0 ? 'none' : this.gesture === 'pinch' ? 'pinch' : 'none';
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.hooks.zoom(Math.exp(-e.deltaY * 0.0015));
  };

  private currentPinchDist(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
}
