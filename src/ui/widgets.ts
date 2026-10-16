// Small touch-and-mouse widgets for the control panel (UI-2, UI-3).

/**
 * SHOT-3: pick where the club strikes the ball, like cue-ball english in
 * billiards. Left/right = side spin, top/bottom = top/back spin.
 */
export class SpinPad {
  side = 0;
  top = 0;
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onChange: () => void,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const set = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      const len = Math.hypot(x, y);
      if (len > 1) [x, y] = [x / len, y / len];
      // Snap near the centre so "no spin" is easy to hit.
      if (len < 0.12) [x, y] = [0, 0];
      this.side = x;
      this.top = y;
      this.draw();
      this.onChange();
    };
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      set(e);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (canvas.hasPointerCapture(e.pointerId)) set(e);
    });
    this.draw();
  }

  reset(): void {
    this.side = 0;
    this.top = 0;
    this.draw();
    this.onChange();
  }

  draw(): void {
    const { canvas, ctx } = this;
    const size = canvas.clientWidth || 96;
    const dpr = Math.min(window.devicePixelRatio, 2);
    if (canvas.width !== size * dpr) {
      canvas.width = size * dpr;
      canvas.height = size * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = size / 2;
    const r = c - 4;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#f4f4f4';
    ctx.strokeStyle = '#888';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(c - r, c);
    ctx.lineTo(c + r, c);
    ctx.moveTo(c, c - r);
    ctx.lineTo(c, c + r);
    ctx.stroke();
    ctx.fillStyle = '#e53935';
    ctx.beginPath();
    ctx.arc(c + this.side * r * 0.85, c - this.top * r * 0.85, 7, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** ADR-007: on-screen joystick for free-camera movement, placed outside the square view. */
export class Joystick {
  x = 0;
  y = 0;

  constructor(base: HTMLElement) {
    const knob = base.querySelector<HTMLElement>('.knob')!;
    const set = (e: PointerEvent) => {
      const r = base.getBoundingClientRect();
      const radius = r.width / 2;
      let dx = (e.clientX - (r.left + radius)) / radius;
      let dy = (e.clientY - (r.top + radius)) / radius;
      const len = Math.hypot(dx, dy);
      if (len > 1) [dx, dy] = [dx / len, dy / len];
      this.x = dx;
      this.y = dy;
      knob.style.transform = `translate(${dx * radius * 0.6}px, ${dy * radius * 0.6}px)`;
    };
    const release = () => {
      this.x = 0;
      this.y = 0;
      knob.style.transform = '';
    };
    base.addEventListener('pointerdown', (e) => {
      base.setPointerCapture(e.pointerId);
      set(e);
    });
    base.addEventListener('pointermove', (e) => {
      if (base.hasPointerCapture(e.pointerId)) set(e);
    });
    base.addEventListener('pointerup', release);
    base.addEventListener('pointercancel', release);
  }
}

/** A button that reports whether it is held down, for continuous actions. */
export class HoldButton {
  held = false;

  constructor(el: HTMLElement, onPress?: () => void) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.held = true;
      onPress?.();
    });
    const up = () => (this.held = false);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}
