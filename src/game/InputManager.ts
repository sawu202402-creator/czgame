export interface StickState {
  active: boolean;
  id: number;
  startX: number;
  startY: number;
  curX: number;
  curY: number;
  dx: number;
  dy: number;
}

export class InputManager {
  private keys = new Set<string>();
  public mouseScreenX = 0;
  public mouseScreenY = 0;
  public mouseDown = false;
  public usingTouch = false;
  public autoFireEnabled = false;

  public moveStick: StickState = { active: false, id: -1, startX: 0, startY: 0, curX: 0, curY: 0, dx: 0, dy: 0 };
  public aimStick: StickState = { active: false, id: -1, startX: 0, startY: 0, curX: 0, curY: 0, dx: 0, dy: 0 };

  private onSwitchWeaponCb: (() => void) | null = null;
  private onReloadCb: (() => void) | null = null;
  private onToggleArmoryCb: (() => void) | null = null;
  private onThrowGrenadeCb: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      this.autoFireEnabled = true;
    }

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const code = e.code;
      this.keys.add(code);
      if (code === 'KeyQ' || code === 'Digit1' || code === 'Digit2') {
        this.onSwitchWeaponCb?.();
      } else if (code === 'KeyR') {
        this.onReloadCb?.();
      } else if (code === 'KeyB' || code === 'Tab') {
        e.preventDefault();
        this.onToggleArmoryCb?.();
      } else if (code === 'KeyG' || code === 'Space') {
        if (code === 'Space') e.preventDefault();
        this.onThrowGrenadeCb?.();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
    });

    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });

    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.onThrowGrenadeCb?.();
    });

    this.canvas.addEventListener('mousemove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      this.mouseScreenX = e.clientX - rect.left;
      this.mouseScreenY = e.clientY - rect.top;
      this.usingTouch = false;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        const rect = this.canvas.getBoundingClientRect();
        this.mouseScreenX = e.clientX - rect.left;
        this.mouseScreenY = e.clientY - rect.top;
        this.mouseDown = true;
        this.usingTouch = false;
      }
    });

    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        this.mouseDown = false;
      }
    });

    this.canvas.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        this.usingTouch = true;
        this.autoFireEnabled = true;
        const rect = this.canvas.getBoundingClientRect();
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const x = t.clientX - rect.left;
          const y = t.clientY - rect.top;
          if (x < rect.width * 0.5 && !this.moveStick.active) {
            this.moveStick = { active: true, id: t.identifier, startX: x, startY: y, curX: x, curY: y, dx: 0, dy: 0 };
          } else if (!this.aimStick.active) {
            this.aimStick = { active: true, id: t.identifier, startX: x, startY: y, curX: x, curY: y, dx: 0, dy: 0 };
          }
        }
      },
      { passive: false }
    );

    this.canvas.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const maxR = 52;
        for (let i = 0; i < e.changedTouches.length; i++) {
          const t = e.changedTouches[i];
          const x = t.clientX - rect.left;
          const y = t.clientY - rect.top;
          if (this.moveStick.active && t.identifier === this.moveStick.id) {
            const vx = x - this.moveStick.startX;
            const vy = y - this.moveStick.startY;
            const dist = Math.hypot(vx, vy) || 1;
            const clamped = Math.min(dist, maxR);
            this.moveStick.curX = this.moveStick.startX + (vx / dist) * clamped;
            this.moveStick.curY = this.moveStick.startY + (vy / dist) * clamped;
            this.moveStick.dx = dist > 6 ? (vx / dist) * (clamped / maxR) : 0;
            this.moveStick.dy = dist > 6 ? (vy / dist) * (clamped / maxR) : 0;
          } else if (this.aimStick.active && t.identifier === this.aimStick.id) {
            const vx = x - this.aimStick.startX;
            const vy = y - this.aimStick.startY;
            const dist = Math.hypot(vx, vy) || 1;
            const clamped = Math.min(dist, maxR);
            this.aimStick.curX = this.aimStick.startX + (vx / dist) * clamped;
            this.aimStick.curY = this.aimStick.startY + (vy / dist) * clamped;
            this.aimStick.dx = dist > 8 ? vx / dist : 0;
            this.aimStick.dy = dist > 8 ? vy / dist : 0;
          }
        }
      },
      { passive: false }
    );

    const endTouch = (e: TouchEvent) => {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.moveStick.active && t.identifier === this.moveStick.id) {
          this.moveStick.active = false;
          this.moveStick.dx = 0;
          this.moveStick.dy = 0;
        }
        if (this.aimStick.active && t.identifier === this.aimStick.id) {
          this.aimStick.active = false;
          this.aimStick.dx = 0;
          this.aimStick.dy = 0;
        }
      }
    };

    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  }

  public bindActions(
    onSwitchWeapon: () => void,
    onReload: () => void,
    onToggleArmory: () => void,
    onThrowGrenade: () => void
  ): void {
    this.onSwitchWeaponCb = onSwitchWeapon;
    this.onReloadCb = onReload;
    this.onToggleArmoryCb = onToggleArmory;
    this.onThrowGrenadeCb = onThrowGrenade;
  }

  public getMoveVector(): { x: number; y: number } {
    if (this.moveStick.active && (this.moveStick.dx !== 0 || this.moveStick.dy !== 0)) {
      return { x: this.moveStick.dx, y: this.moveStick.dy };
    }
    let x = 0;
    let y = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) y -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) y += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) x -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) x += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }

  public resetStates(): void {
    this.keys.clear();
    this.mouseDown = false;
    this.moveStick.active = false;
    this.moveStick.dx = 0;
    this.moveStick.dy = 0;
    this.aimStick.active = false;
    this.aimStick.dx = 0;
    this.aimStick.dy = 0;
  }
}
